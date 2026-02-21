import { readFileSync } from "node:fs";
import { MessageRole } from "../database/schema.js";
import type { Chat } from "../database/schema.js";
import { generateText, type ImagePart, type LanguageModel, type ModelMessage, type TextPart, type TextStreamPart, type ToolSet } from "ai";
import type { CommandApprovalService } from "../approval/service.js";
import {
  buildScheduleFollowupSystemNote,
  getMainSessionSystemMessage,
  getNonMainSessionSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSelfManagementSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkingMemorySystemMessage,
  getWorkspaceGuideSystemMessage,
} from "../ai/prompts.js";
import type { ChannelRouter } from "../channel/router.js";
import type { AgentStreamEvent, ImageAttachment, NormalizedInboundEvent } from "../channel/types.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";
import {
  bootstrapWorkspace,
  readBootstrapGuide,
} from "../workspace/bootstrap.js";
import { ActiveTurnManager } from "../session/active-turns.js";
import { SessionManager } from "../session/manager.js";
import type { SessionIdentity } from "../session/types.js";
import { createUnifiedTools } from "../tools/registry.js";
import {
  buildUserContent,
  extractTextFromUserContent,
  getUserMetadata,
  isCommandText,
  isStopMessage,
  type ReplyReference,
} from "./helpers.js";
import { loadAgentContext } from "./context.js";
import type { MemoryExtractionQueue } from "../memory/queue.js";
import type { SessionTitleGenerator } from "../session/title-generator.js";
import type { ToolDependencies } from "../utils/tool-deps.js";

type AgentTurnOrchestratorInput = {
  toolDeps: ToolDependencies;
  chatModel: LanguageModel;
  visionModel?: LanguageModel;
  channelRouter: ChannelRouter;
  commandApprovalService?: CommandApprovalService;
  useReplyChainKey: boolean;
  historyLimit: number;
  memoryExtractionQueue?: MemoryExtractionQueue;
  titleGenerator?: SessionTitleGenerator;
};

export class AgentTurnOrchestrator {
  private readonly toolDeps: ToolDependencies;
  private readonly chatModel: LanguageModel;
  private readonly visionModel?: LanguageModel;
  private readonly channelRouter: ChannelRouter;
  private readonly commandApprovalService?: CommandApprovalService;
  private readonly useReplyChainKey: boolean;
  private readonly historyLimit: number;
  private readonly memoryExtractionQueue?: MemoryExtractionQueue;
  private readonly titleGenerator?: SessionTitleGenerator;
  private readonly activeTurnManager = new ActiveTurnManager();
  private readonly log: Logger;

  constructor({
    toolDeps,
    chatModel,
    visionModel,
    channelRouter,
    commandApprovalService,
    useReplyChainKey,
    historyLimit,
    memoryExtractionQueue,
    titleGenerator,
  }: AgentTurnOrchestratorInput) {
    this.toolDeps = toolDeps;
    this.chatModel = chatModel;
    this.visionModel = visionModel;
    this.channelRouter = channelRouter;
    this.commandApprovalService = commandApprovalService;
    this.useReplyChainKey = useReplyChainKey;
    this.historyLimit = historyLimit;
    this.memoryExtractionQueue = memoryExtractionQueue;
    this.titleGenerator = titleGenerator;
    this.log = getLogger().child({ component: "orchestrator" });
  }

  async handleInboundEvent({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): Promise<void> {
    const text = event.messageText.trim();
    const hasImages = event.images && event.images.length > 0;
    if (text.length === 0 && !hasImages) return;

    if (text.length > 0 && isCommandText({ text })) return;

    this.log.debug({
      platform: event.platform,
      chatId: event.chatId,
      senderId: event.senderId,
      isEdited: event.isEdited,
      hasThread: !!event.threadId,
      textLength: text.length,
    }, "Inbound event received");

    if (isStopMessage({ text })) {
      const sessionIdentity = this.deriveSessionIdentity({ event });
      const cancelled = await this.activeTurnManager.cancel({
        sessionKey: sessionIdentity.key,
      });
      if (cancelled !== undefined) {
        this.log.info({ sessionKey: sessionIdentity.key }, "Agent turn cancelled by user");
        const adapter = this.channelRouter.getAdapter({ platform: event.platform });
        await adapter.sendMessage({
          chatId: event.chatId,
          text: "Stopped.",
          threadId: event.threadId,
        });
      }
      return;
    }

    if (event.isEdited) {
      await this.handleEditedMessage({ event });
      return;
    }

    await this.handleNewMessage({ event });
  }

  private async handleNewMessage({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): Promise<void> {
    await bootstrapWorkspace({ workspacePath: this.toolDeps.workspacePath });

    const linkedSessionIdentity = await this.resolveLinkedSession({ event });
    const sessionIdentity =
      linkedSessionIdentity ?? this.deriveSessionIdentity({ event });

    const existingMessage = await this.activeTurnManager.cancel({
      sessionKey: sessionIdentity.key,
    });
    const mergedText =
      existingMessage !== undefined
        ? existingMessage + "\n\n" + event.messageText.trim()
        : event.messageText.trim();

    const replyReference = this.extractReplyReference({ event });
    const isMainSession = await this.isMainSession({ event });
    const linkedChats = await this.toolDeps.chatRegistry.listLinkedChats({
      platform: event.platform,
    });

    this.launchAgentTurn({
      event,
      sessionIdentity,
      userMessage: mergedText,
      replyReference,
      isMainSession,
      linkedChats,
    });
  }

  private async handleEditedMessage({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): Promise<void> {
    const sessionIdentity = this.deriveSessionIdentity({ event });

    const existing = this.activeTurnManager.get({
      sessionKey: sessionIdentity.key,
    });
    if (!existing) return;

    await this.activeTurnManager.cancel({ sessionKey: sessionIdentity.key });

    const replyReference = this.extractReplyReference({ event });
    const isMainSession = await this.isMainSession({ event });
    const linkedChats = await this.toolDeps.chatRegistry.listLinkedChats({
      platform: event.platform,
    });

    this.launchAgentTurn({
      event,
      sessionIdentity,
      userMessage: event.messageText.trim(),
      replyReference,
      isMainSession,
      linkedChats,
    });
  }

  private launchAgentTurn({
    event,
    sessionIdentity,
    userMessage,
    replyReference,
    isMainSession,
    linkedChats,
  }: {
    event: NormalizedInboundEvent;
    sessionIdentity: SessionIdentity;
    userMessage: string;
    replyReference: ReplyReference | null;
    isMainSession: boolean;
    linkedChats: Chat[];
  }): void {
    const sessionKey = sessionIdentity.key;
    const abortController = new AbortController();
    const turnStartedAt = Date.now();

    const turnLog = this.log.child({
      sessionKey,
      chatId: event.chatId,
      platform: event.platform,
    });

    turnLog.info({ isMainSession, messageLength: userMessage.length }, "Agent turn starting");

    const completion = this.processAgentTurn({
      event,
      sessionIdentity,
      userMessage,
      replyReference,
      abortSignal: abortController.signal,
      isMainSession,
      linkedChats,
    })
      .then(() => {
        turnLog.info(
          { durationMs: Date.now() - turnStartedAt },
          "Agent turn completed",
        );
      })
      .catch((err) => {
        if (abortController.signal.aborted) return;
        turnLog.error(
          { err, durationMs: Date.now() - turnStartedAt },
          "Agent turn failed",
        );
        const adapter = this.channelRouter.getAdapter({ platform: event.platform });
        adapter
          .sendMessage({
            chatId: event.chatId,
            text: "I hit an internal error while processing that message.",
            threadId: event.threadId,
          })
          .catch((replyErr: unknown) => {
            turnLog.error({ err: replyErr }, "Failed to send error reply");
          });
      })
      .finally(() => {
        this.activeTurnManager.remove({ sessionKey, abortController });
      });

    this.activeTurnManager.register({
      sessionKey,
      abortController,
      completion,
      userMessage,
    });
  }

  private async processAgentTurn({
    event,
    sessionIdentity,
    userMessage,
    replyReference,
    abortSignal,
    isMainSession,
    linkedChats,
  }: {
    event: NormalizedInboundEvent;
    sessionIdentity: SessionIdentity;
    userMessage: string;
    replyReference: ReplyReference | null;
    abortSignal: AbortSignal;
    isMainSession: boolean;
    linkedChats: Chat[];
  }): Promise<void> {
    if (abortSignal.aborted) return;

    const {
      workspacePath,
      aiAgent,
      sessionManager,
      schedulerService,
      messageLinkRepository,
      skillsConfig,
      fullConfig,
      selfToolDeps,
    } = this.toolDeps;

    const adapter = this.channelRouter.getAdapter({ platform: event.platform });

    const [agentContext, bootstrapContent, workingMemory] =
      await Promise.all([
        loadAgentContext({ workspacePath, skillsConfig, fullConfig }),
        readBootstrapGuide({ workspacePath }),
        sessionManager.getWorkingMemory({ sessionKey: sessionIdentity.key }),
      ]);

    if (abortSignal.aborted) return;

    const { personalityFiles: completePersonality, toolNotesContent: toolsIndexContent, agentsContent, skills } = agentContext;

    const hasImages = event.images && event.images.length > 0;

    let userContent: ReturnType<typeof buildUserContent>;
    let persistImages: ImageAttachment[] | undefined;

    if (hasImages && this.visionModel) {
      const description = await describeImages({
        model: this.visionModel,
        images: event.images!,
        userText: userMessage,
      });

      if (abortSignal.aborted) return;

      const imageCount = event.images!.length;
      const imageNoun = imageCount === 1 ? "image" : "images";
      const enrichedText =
        userMessage.length > 0
          ? `${userMessage}\n\n[The user attached ${imageCount} ${imageNoun} to this message. Contents of the ${imageNoun}:]\n${description}`
          : `[The user sent ${imageCount} ${imageNoun} with no accompanying text. Contents of the ${imageNoun}:]\n${description}`;

      userContent = buildUserContent({
        messageText: enrichedText,
        replyReference,
      });
    } else {
      userContent = buildUserContent({
        messageText: userMessage,
        replyReference,
        images: event.images,
      });
      persistImages = event.images;
    }

    const history = await sessionManager.getMessages({
      identity: sessionIdentity,
      limit: this.historyLimit,
    });

    if (abortSignal.aborted) return;

    const scheduleRunContext =
      await schedulerService.getRunContextForSessionKey({
        sessionKey: sessionIdentity.key,
      });

    if (abortSignal.aborted) return;

    const currentChatRecord = linkedChats.find(
      (c) => c.platformChatId === event.chatId,
    );

    const messages: ModelMessage[] = [
      getSharedSystemMessage({
        workspacePath,
        personalityFiles: completePersonality,
      }),
      getWorkspaceGuideSystemMessage({ agentsContent, bootstrapContent }),
      getSkillsSystemMessage({
        skills,
        toolNotesContent: toolsIndexContent,
      }),
      getSchedulerGuidanceSystemMessage(),
      getSelfManagementSystemMessage({
        configPath: selfToolDeps.getStatus().configPath ?? "~/.babyclaw/babyclaw.json",
        adminSocketPath: selfToolDeps.adminSocketPath,
        logOutput: selfToolDeps.logOutput,
      }),
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
      getWorkingMemorySystemMessage({ workingMemory }),
      ...history,
      { role: "user", content: userContent },
    ];

    const tools = createUnifiedTools({
      toolDeps: this.toolDeps,
      executionContext: {
        workspaceRoot: workspacePath,
        botTimezone: schedulerService.getTimezone(),
        platform: event.platform,
        chatId: event.chatId,
        threadId: event.threadId,
        directMessagesTopicId: event.directMessagesTopicId,
        runSource: "chat",
        isMainSession,
      },
      createdByUserId: event.senderId,
      sourceText: userMessage,
      getActiveTurnCount: () => this.activeTurnManager.count(),
      chatModel: this.chatModel,
      channelSender: adapter,
      commandApprovalService: this.commandApprovalService,
      sessionKey: sessionIdentity.key,
    });

    this.log.debug(
      { sessionKey: sessionIdentity.key, messageCount: messages.length, hasImages },
      "Sending messages to AI model",
    );

    const streamResult = aiAgent.chatStreamWithTools({
      messages,
      tools,
      maxSteps: 50,
      abortSignal,
    });

    (streamResult.text as Promise<string>).catch(() => {});

    let assistantResponse: string;
    let alreadySentMessageId: string | undefined;
    try {
      if (adapter.streamTurn && event.draftSupported) {
        const turnResult = await adapter.streamTurn({
          chatId: event.chatId,
          threadId: event.threadId,
          agentStream: toAgentStream({ fullStream: streamResult.fullStream }),
        });
        assistantResponse = turnResult.fullText;
        alreadySentMessageId = turnResult.lastPlatformMessageId;
      } else if (adapter.streamDraft && event.draftSupported) {
        assistantResponse = await adapter.streamDraft({
          chatId: event.chatId,
          threadId: event.threadId,
          textStream: streamResult.textStream,
        });
      } else {
        assistantResponse = (await streamResult.text).trim();
      }
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
          content: extractTextFromUserContent({ content: userContent }),
          metadata: getUserMetadata({ replyReference, images: persistImages }),
        },
        {
          role: MessageRole.assistant,
          content: assistantResponse,
        },
      ],
    });

    if (isMainSession && this.memoryExtractionQueue) {
      await sessionManager.touchLastActivity({ sessionKey: sessionIdentity.key });
      this.memoryExtractionQueue.enqueue({ sessionKey: sessionIdentity.key });
    }

    if (history.length === 0 && this.titleGenerator) {
      const titleUserMessage = userMessage;
      const titleAdapter = adapter;
      const titleEvent = event;
      const titleSessionKey = sessionIdentity.key;
      this.titleGenerator
        .generate({ userMessage: titleUserMessage })
        .then(async (title) => {
          await sessionManager.setTitle({ sessionKey: titleSessionKey, title });
          await titleAdapter.setSessionTitle?.({
            chatId: titleEvent.chatId,
            threadId: titleEvent.threadId,
            title,
          });
          this.log.info({ sessionKey: titleSessionKey, title }, "Session title generated");
        })
        .catch((err) => {
          this.log.warn({ err, sessionKey: titleSessionKey }, "Failed to generate session title");
        });
    }

    let platformMessageId: string;
    if (alreadySentMessageId) {
      platformMessageId = alreadySentMessageId;
    } else {
      const sendResult = await adapter.sendMessage({
        chatId: event.chatId,
        text: assistantResponse,
        threadId: event.threadId,
      });
      platformMessageId = sendResult.platformMessageId;
    }

    this.log.debug(
      { sessionKey: sessionIdentity.key, responseLength: assistantResponse.length, messageId: platformMessageId },
      "Response sent to channel",
    );

    await messageLinkRepository.upsertMessageLink({
      platform: event.platform,
      platformChatId: event.chatId,
      platformMessageId,
      sessionKey: sessionIdentity.key,
    });
  }

  private deriveSessionIdentity({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): SessionIdentity {
    return SessionManager.deriveSessionIdentity({
      platform: event.platform,
      chatId: event.chatId,
      threadId: event.threadId ?? null,
      replyToMessageId: event.replyToMessageId ?? null,
      useReplyChainKey: this.useReplyChainKey,
    });
  }

  private async resolveLinkedSession({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): Promise<SessionIdentity | null> {
    if (!event.replyToMessageId) return null;

    const link = await this.toolDeps.messageLinkRepository.findByChatAndMessage({
      platform: event.platform,
      platformChatId: event.chatId,
      platformMessageId: event.replyToMessageId,
    });

    if (!link) return null;

    return SessionManager.fromLinkedSessionKey({
      key: link.sessionKey,
      chatId: event.chatId,
      threadId: event.threadId ?? null,
      replyToMessageId: event.replyToMessageId,
    });
  }

  private extractReplyReference({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): ReplyReference | null {
    if (!event.replyToMessageId) return null;

    return {
      messageId: event.replyToMessageId,
      text: event.replyToText ?? null,
    };
  }

  private async isMainSession({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): Promise<boolean> {
    const mainChat = await this.toolDeps.chatRegistry.getMainChat();
    if (!mainChat) return false;
    return mainChat.platformChatId === event.chatId;
  }
}

async function describeImages({
  model,
  images,
  userText,
}: {
  model: LanguageModel;
  images: ImageAttachment[];
  userText: string;
}): Promise<string> {
  const imageParts: Array<TextPart | ImagePart> = images.map((img) => ({
    type: "image" as const,
    image: readFileSync(img.localPath),
    mediaType: img.mimeType,
  }));

  const prompt =
    userText.length > 0
      ? `The user sent the following message along with ${images.length} image(s):\n"${userText}"\n\nDescribe each image in detail, including any text, UI elements, code, errors, or other relevant content visible in the image.`
      : `The user sent ${images.length} image(s) without any text. Describe each image in detail, including any text, UI elements, code, errors, or other relevant content visible in the image.`;

  const result = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: prompt }, ...imageParts],
      },
    ],
  });

  return result.text.trim();
}

async function* toAgentStream({
  fullStream,
}: {
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>;
}): AsyncGenerator<AgentStreamEvent> {
  for await (const part of fullStream) {
    switch (part.type) {
      case "reasoning-delta":
        yield { type: "reasoning-delta", text: part.text };
        break;
      case "text-delta":
        yield { type: "text-delta", text: part.text };
        break;
      case "finish-step":
        yield { type: "step-finish" };
        break;
      case "finish":
        yield { type: "finish" };
        break;
    }
  }
}
