import { MessageRole } from "@prisma/client";
import type { ModelMessage } from "ai";
import { Bot, type BotError } from "grammy";
import { AiAgent } from "./ai/agent.js";
import {
  buildScheduleFollowupSystemNote,
  getBrowserToolsSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
  readToolsIndex,
} from "./ai/prompts.js";
import type { BrowserMcpClient } from "./browser/mcp-client.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
} from "./onboarding/personality.js";
import {
  bootstrapWorkspace,
  readBootstrapGuide,
  readWorkspaceGuide,
} from "./workspace/bootstrap.js";
import { formatSchedulesForCommand } from "./scheduler/formatter.js";
import { SchedulerService } from "./scheduler/service.js";
import { ActiveTurnManager } from "./session/active-turns.js";
import { SessionManager } from "./session/manager.js";
import type { SessionIdentity } from "./session/types.js";
import { streamDraftToChat } from "./telegram/draft.js";
import {
  BotContext,
  buildUserContent,
  deriveLinkedSessionIdentity,
  getDirectMessagesTopicId,
  getMessageThreadId,
  getReplyReference,
  getSessionIdentity,
  getUserMetadata,
  isCommandText,
  isStopMessage,
  type ReplyReference,
} from "./telegram/helpers.js";
import { replyMarkdownV2 } from "./telegram/markdown.js";
import { MessageLinkRepository } from "./telegram/message-link.js";
import { createUnifiedTools } from "./tools/registry.js";

type CreateBotInput = {
  token: string;
  workspacePath: string;
  sessionManager: SessionManager;
  aiAgent: AiAgent;
  schedulerService: SchedulerService;
  messageLinkRepository: MessageLinkRepository;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  browserMcpClient?: BrowserMcpClient;
  useReplyChainKey?: boolean;
  historyLimit?: number;
};

type ProcessAgentTurnInput = {
  ctx: BotContext;
  sessionIdentity: SessionIdentity;
  userMessage: string;
  replyReference: ReplyReference | null;
  abortSignal: AbortSignal;
};

export function createBot({
  token,
  workspacePath,
  sessionManager,
  aiAgent,
  schedulerService,
  messageLinkRepository,
  syncSchedule,
  enableGenericTools,
  browserMcpClient,
  useReplyChainKey = false,
  historyLimit = 40,
}: CreateBotInput): Bot<BotContext> {
  const bot = new Bot<BotContext>(token, {
    ContextConstructor: BotContext,
  });

  const activeTurnManager = new ActiveTurnManager();

  bot.use(async (ctx, next) => {
    if (!ctx.chat) {
      await next();
      return;
    }

    const linkedSessionIdentity = await deriveLinkedSessionIdentity({
      ctx,
      messageLinkRepository,
    });

    const sessionIdentity =
      linkedSessionIdentity ??
      SessionManager.deriveSessionIdentity({
        ctx,
        useReplyChainKey,
      });
    ctx.state.sessionIdentity = sessionIdentity;
    await next();
  });

  bot.command("schedules", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    const schedules = await schedulerService.listSchedules({
      chatId: BigInt(ctx.chat.id),
      includeInactive: false,
    });

    await replyMarkdownV2({
      ctx,
      text: formatSchedulesForCommand({
        schedules,
      }),
    });
  });

  async function processAgentTurn({
    ctx,
    sessionIdentity,
    userMessage,
    replyReference,
    abortSignal,
  }: ProcessAgentTurnInput): Promise<void> {
    if (abortSignal.aborted) return;

    const [personalityFiles, toolsIndexContent, agentsContent, bootstrapContent] =
      await Promise.all([
        readPersonalityFiles({ workspacePath }),
        readToolsIndex({ workspacePath }),
        readWorkspaceGuide({ workspacePath }),
        readBootstrapGuide({ workspacePath }),
      ]);

    if (abortSignal.aborted) return;

    const completePersonality = hasCompletePersonalityFiles(personalityFiles)
      ? personalityFiles
      : undefined;

    const userContent = buildUserContent({
      messageText: userMessage,
      replyReference,
    });

    const history = await sessionManager.getMessages({
      identity: sessionIdentity,
      limit: historyLimit,
    });

    if (abortSignal.aborted) return;

    const scheduleRunContext =
      await schedulerService.getRunContextForSessionKey({
        sessionKey: sessionIdentity.key,
      });

    if (abortSignal.aborted) return;

    const messages: ModelMessage[] = [
      getSharedSystemMessage({
        workspacePath,
        personalityFiles: completePersonality,
      }),
      getWorkspaceGuideSystemMessage({ agentsContent, bootstrapContent }),
      getSkillsSystemMessage({ toolsIndexContent }),
      getSchedulerGuidanceSystemMessage(),
      ...(browserMcpClient ? [getBrowserToolsSystemMessage()] : []),
      ...(scheduleRunContext
        ? [
            {
              role: "system" as const,
              content: buildScheduleFollowupSystemNote({
                taskPrompt: scheduleRunContext.taskPrompt,
                scheduledFor: scheduleRunContext.scheduledFor,
              }),
            },
          ]
        : []),
      ...history,
      { role: "user", content: userContent },
    ];

    const isPrivateChat = ctx.chat!.type === "private";
    const messageThreadId = getMessageThreadId({ ctx });

    const tools = createUnifiedTools({
      executionContext: {
        workspaceRoot: workspacePath,
        botTimezone: schedulerService.getTimezone(),
        chatId: BigInt(ctx.chat!.id),
        threadId:
          messageThreadId === undefined ? undefined : BigInt(messageThreadId),
        directMessagesTopicId: getDirectMessagesTopicId({ ctx }) ?? undefined,
        runSource: "chat",
      },
      schedulerService,
      syncSchedule,
      createdByUserId: BigInt(ctx.from?.id ?? ctx.chat!.id),
      sourceText: userMessage,
      enableGenericTools,
      browserMcpClient,
    });

    const streamResult = aiAgent.chatStreamWithTools({
      messages,
      tools,
      maxSteps: 50,
      abortSignal,
    });

    await ctx.replyWithChatAction("typing").catch(() => {});

    // Prevent unhandled rejection: .text rejects independently on abort,
    // and we may early-return before ever awaiting it.
    (streamResult.text as Promise<string>).catch(() => {});

    let assistantResponse: string;
    try {
      assistantResponse = await streamDraftToChat({
        api: ctx.api,
        chatId: ctx.chat!.id,
        textStream: streamResult.textStream,
        supportsDraft: isPrivateChat,
        messageThreadId,
        throttleMs: 300,
      });
    } catch (err) {
      if (abortSignal.aborted) return;
      throw err;
    }

    if (abortSignal.aborted) return;

    if (assistantResponse.length === 0) {
      assistantResponse = (await streamResult.text).trim();
    }

    if (assistantResponse.length === 0) {
      assistantResponse = "Done.";
    }

    await sessionManager.appendMessages({
      identity: sessionIdentity,
      messages: [
        {
          role: MessageRole.user,
          content: userContent,
          metadata: getUserMetadata({
            replyReference,
          }),
        },
        {
          role: MessageRole.assistant,
          content: assistantResponse,
        },
      ],
    });

    const sentMessage = await replyMarkdownV2({ ctx, text: assistantResponse });
    await messageLinkRepository.upsertMessageLink({
      chatId: BigInt(ctx.chat!.id),
      messageId: BigInt(sentMessage.message_id),
      sessionKey: sessionIdentity.key,
    });
  }

  function launchAgentTurn({
    ctx,
    sessionIdentity,
    userMessage,
    replyReference,
  }: {
    ctx: BotContext;
    sessionIdentity: SessionIdentity;
    userMessage: string;
    replyReference: ReplyReference | null;
  }): void {
    const sessionKey = sessionIdentity.key;
    const abortController = new AbortController();

    const completion = processAgentTurn({
      ctx,
      sessionIdentity,
      userMessage,
      replyReference,
      abortSignal: abortController.signal,
    })
      .catch((err) => {
        if (abortController.signal.aborted) return;
        console.error("Agent turn error:", err);
        ctx
          .reply("I hit an internal error while processing that message.")
          .catch((replyErr) => {
            console.error("Failed to send error reply:", replyErr);
          });
      })
      .finally(() => {
        activeTurnManager.remove({ sessionKey, abortController });
      });

    activeTurnManager.register({
      sessionKey,
      abortController,
      completion,
      userMessage,
    });
  }

  bot.on("message:text", async (ctx) => {
    const text = ctx.msg.text.trim();
    if (text.length === 0) {
      return;
    }

    if (isCommandText({ text })) {
      return;
    }

    if (isStopMessage({ text })) {
      const sessionIdentity = getSessionIdentity({ ctx, useReplyChainKey });
      const cancelled = await activeTurnManager.cancel({
        sessionKey: sessionIdentity.key,
      });
      if (cancelled !== undefined) {
        await ctx.reply("Stopped.");
      }
      return;
    }

    await bootstrapWorkspace({ workspacePath });

    const sessionIdentity = getSessionIdentity({
      ctx,
      useReplyChainKey,
    });
    const sessionKey = sessionIdentity.key;

    const existingMessage = await activeTurnManager.cancel({ sessionKey });
    const mergedText =
      existingMessage !== undefined ? existingMessage + "\n\n" + text : text;

    const replyReference = getReplyReference({ ctx });

    launchAgentTurn({
      ctx,
      sessionIdentity,
      userMessage: mergedText,
      replyReference,
    });
  });

  bot.on("edited_message:text", async (ctx) => {
    const text = ctx.msg.text.trim();
    if (text.length === 0) {
      return;
    }

    if (isCommandText({ text })) {
      return;
    }

    const sessionIdentity = getSessionIdentity({
      ctx,
      useReplyChainKey,
    });
    const sessionKey = sessionIdentity.key;

    const existing = activeTurnManager.get({ sessionKey });
    if (!existing) {
      return;
    }

    await activeTurnManager.cancel({ sessionKey });

    const replyReference = getReplyReference({ ctx });

    launchAgentTurn({
      ctx,
      sessionIdentity,
      userMessage: text,
      replyReference,
    });
  });

  bot.catch(async (error: BotError<BotContext>) => {
    const ctx = error.ctx;
    console.error("Unhandled Telegram bot error:", error.error);
    if (!ctx.chat) {
      return;
    }

    try {
      await ctx.reply("I hit an internal error while processing that message.");
    } catch (replyError) {
      console.error("Failed to send Telegram error reply:", replyError);
    }
  });

  return bot;
}

export type { BotContext };
