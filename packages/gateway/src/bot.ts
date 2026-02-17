import { MessageRole } from "@prisma/client";
import type { Chat } from "@prisma/client";
import type { ModelMessage } from "ai";
import { Bot, type BotError } from "grammy";
import { AiAgent } from "./ai/agent.js";
import {
  buildScheduleFollowupSystemNote,
  getBrowserToolsSystemMessage,
  getMainSessionSystemMessage,
  getNonMainSessionSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
  readToolsIndex,
} from "./ai/prompts.js";
import type { BrowserMcpClient } from "./browser/mcp-client.js";
import type { CrossChatDeliveryService } from "./chat/delivery.js";
import type { ChatRegistry } from "./chat/registry.js";
import { TelegramMessageSender } from "./chat/telegram-sender.js";
import type { ShellConfig } from "./config/shell-defaults.js";
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

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

export type HeartbeatStatusGetter = () => {
  enabled: boolean;
  nextRunAt: Date | null;
};

type CreateBotInput = {
  token: string;
  workspacePath: string;
  sessionManager: SessionManager;
  aiAgent: AiAgent;
  schedulerService: SchedulerService;
  messageLinkRepository: MessageLinkRepository;
  chatRegistry: ChatRegistry;
  deliveryService: CrossChatDeliveryService;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  braveSearchApiKey: string | null;
  shellConfig: ShellConfig;
  browserMcpClient?: BrowserMcpClient;
  useReplyChainKey?: boolean;
  historyLimit?: number;
  getHeartbeatStatus?: HeartbeatStatusGetter;
};

type ProcessAgentTurnInput = {
  ctx: BotContext;
  sessionIdentity: SessionIdentity;
  userMessage: string;
  replyReference: ReplyReference | null;
  abortSignal: AbortSignal;
  isMainSession: boolean;
  linkedChats: Chat[];
};

export function createBot({
  token,
  workspacePath,
  sessionManager,
  aiAgent,
  schedulerService,
  messageLinkRepository,
  chatRegistry,
  deliveryService,
  syncSchedule,
  enableGenericTools,
  braveSearchApiKey,
  shellConfig,
  browserMcpClient,
  useReplyChainKey = false,
  historyLimit = 40,
  getHeartbeatStatus,
}: CreateBotInput): Bot<BotContext> {
  const bot = new Bot<BotContext>(token, {
    ContextConstructor: BotContext,
  });

  const messageSender = new TelegramMessageSender({ api: bot.api });
  const activeTurnManager = new ActiveTurnManager();

  bot.use(async (ctx, next) => {
    if (!ctx.chat) {
      await next();
      return;
    }

    const platformChatId = String(ctx.chat.id);

    await chatRegistry.upsert({
      platform: "telegram",
      platformChatId,
      type: ctx.chat.type,
      title: getChatTitle({ ctx }),
    });

    const mainChat = await chatRegistry.getMainChat();

    if (!mainChat && ctx.chat.type === "private") {
      await chatRegistry.markAsMain({
        platform: "telegram",
        platformChatId,
      });
    }

    const isLinkCommand = isLinkOrUnlinkCommand({ ctx });
    const linked = await chatRegistry.isLinked({
      platform: "telegram",
      platformChatId,
    });

    if (!linked && !isLinkCommand) {
      return;
    }

    const currentChat = await chatRegistry.getMainChat();
    const isMainSession = currentChat?.platformChatId === platformChatId;

    ctx.state.isMainSession = isMainSession;

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

  bot.command("link", async (ctx) => {
    if (!ctx.chat || !ctx.from) {
      return;
    }

    const mainChat = await chatRegistry.getMainChat();
    if (!mainChat) {
      await ctx.reply("No main chat has been set up yet.");
      return;
    }

    if (String(ctx.from.id) !== mainChat.platformChatId) {
      await ctx.reply("Only the owner can link chats.");
      return;
    }

    const alias = ctx.match?.toString().trim().toLowerCase();
    if (!alias || !ALIAS_PATTERN.test(alias)) {
      await ctx.reply(
        "Usage: /link <alias>\nAlias must be 2-32 characters, lowercase alphanumeric and hyphens.",
      );
      return;
    }

    try {
      await chatRegistry.link({
        platform: "telegram",
        platformChatId: String(ctx.chat.id),
        alias,
      });
      await ctx.reply(`Linked as "${alias}". I'll respond here now.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("Unique constraint")) {
        await ctx.reply(`The alias "${alias}" is already in use.`);
      } else {
        await ctx.reply("Failed to link this chat.");
      }
    }
  });

  bot.command("unlink", async (ctx) => {
    if (!ctx.chat || !ctx.from) {
      return;
    }

    const mainChat = await chatRegistry.getMainChat();
    if (!mainChat) {
      return;
    }

    if (String(ctx.from.id) !== mainChat.platformChatId) {
      await ctx.reply("Only the owner can unlink chats.");
      return;
    }

    const platformChatId = String(ctx.chat.id);
    if (mainChat.platformChatId === platformChatId) {
      await ctx.reply("Cannot unlink the main chat.");
      return;
    }

    await chatRegistry.unlink({
      platform: "telegram",
      platformChatId,
    });
    await ctx.reply("Unlinked. I'll stop responding here.");
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

  bot.command("heartbeat", async (ctx) => {
    if (!ctx.chat) {
      return;
    }

    if (!getHeartbeatStatus) {
      await ctx.reply("Heartbeat system is not available.");
      return;
    }

    const status = getHeartbeatStatus();
    if (!status.enabled) {
      await ctx.reply("Heartbeat is disabled in configuration.");
      return;
    }

    const nextRunLabel = status.nextRunAt
      ? status.nextRunAt.toISOString()
      : "not scheduled";

    await ctx.reply(`Heartbeat is enabled.\nNext run: ${nextRunLabel}`);
  });

  async function processAgentTurn({
    ctx,
    sessionIdentity,
    userMessage,
    replyReference,
    abortSignal,
    isMainSession,
    linkedChats,
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

    const currentChatRecord = linkedChats.find(
      (c) => c.platformChatId === String(ctx.chat!.id),
    );

    const messages: ModelMessage[] = [
      getSharedSystemMessage({
        workspacePath,
        personalityFiles: completePersonality,
      }),
      getWorkspaceGuideSystemMessage({ agentsContent, bootstrapContent }),
      getSkillsSystemMessage({ toolsIndexContent }),
      getSchedulerGuidanceSystemMessage(),
      ...(isMainSession
        ? [getMainSessionSystemMessage({ linkedChats })]
        : currentChatRecord
          ? [
              getNonMainSessionSystemMessage({
                chatTitle: currentChatRecord.title ?? "Unknown",
                alias: currentChatRecord.alias ?? undefined,
              }),
            ]
          : []),
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
        isMainSession,
      },
      schedulerService,
      syncSchedule,
      createdByUserId: BigInt(ctx.from?.id ?? ctx.chat!.id),
      sourceText: userMessage,
      enableGenericTools,
      braveSearchApiKey,
      shellConfig,
      browserMcpClient,
      chatRegistry,
      messageSender,
      deliveryService,
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
    isMainSession,
    linkedChats,
  }: {
    ctx: BotContext;
    sessionIdentity: SessionIdentity;
    userMessage: string;
    replyReference: ReplyReference | null;
    isMainSession: boolean;
    linkedChats: Chat[];
  }): void {
    const sessionKey = sessionIdentity.key;
    const abortController = new AbortController();

    const completion = processAgentTurn({
      ctx,
      sessionIdentity,
      userMessage,
      replyReference,
      abortSignal: abortController.signal,
      isMainSession,
      linkedChats,
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
    const isMainSession = ctx.state.isMainSession ?? false;
    const linkedChats = await chatRegistry.listLinkedChats({ platform: "telegram" });

    launchAgentTurn({
      ctx,
      sessionIdentity,
      userMessage: mergedText,
      replyReference,
      isMainSession,
      linkedChats,
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
    const isMainSession = ctx.state.isMainSession ?? false;
    const linkedChats = await chatRegistry.listLinkedChats({ platform: "telegram" });

    launchAgentTurn({
      ctx,
      sessionIdentity,
      userMessage: text,
      replyReference,
      isMainSession,
      linkedChats,
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

function getChatTitle({ ctx }: { ctx: BotContext }): string | null {
  if (!ctx.chat) return null;
  const chat = ctx.chat as unknown as Record<string, unknown>;
  if (typeof chat.title === "string") return chat.title;
  if (typeof chat.first_name === "string") {
    const last = typeof chat.last_name === "string" ? ` ${chat.last_name}` : "";
    return `${chat.first_name}${last}`;
  }
  return null;
}

function isLinkOrUnlinkCommand({ ctx }: { ctx: BotContext }): boolean {
  const message = ctx.message as { text?: string } | undefined;
  if (!message?.text) return false;
  const text = message.text.trim();
  return text.startsWith("/link") || text.startsWith("/unlink");
}

export type { BotContext };
