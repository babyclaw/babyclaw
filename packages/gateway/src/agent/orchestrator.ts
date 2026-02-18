import { MessageRole } from "@prisma/client";
import type { Chat } from "@prisma/client";
import { hasToolCall, type ModelMessage } from "ai";
import { AiAgent } from "../ai/agent.js";
import type { CommandApprovalService } from "../approval/service.js";
import {
  buildScheduleFollowupSystemNote,
  getBrowserToolsSystemMessage,
  getMainSessionSystemMessage,
  getNonMainSessionSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSelfManagementSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
  readToolNotes,
} from "../ai/prompts.js";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { ChannelRouter } from "../channel/router.js";
import type { NormalizedInboundEvent } from "../channel/types.js";
import type { MessageLinkRepository } from "../channel/message-link.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
} from "../onboarding/personality.js";
import {
  bootstrapWorkspace,
  readBootstrapGuide,
  readWorkspaceGuide,
} from "../workspace/bootstrap.js";
import { SchedulerService } from "../scheduler/service.js";
import { ActiveTurnManager } from "../session/active-turns.js";
import { SessionManager } from "../session/manager.js";
import type { SessionIdentity } from "../session/types.js";
import { createUnifiedTools } from "../tools/registry.js";
import { ContinuationManager } from "./continuation.js";
import {
  buildUserContent,
  getUserMetadata,
  isCommandText,
  isStopMessage,
  type ReplyReference,
} from "./helpers.js";
import type { TurnSignals } from "./types.js";
import { scanWorkspaceSkills, getEligibleSkills } from "../workspace/skills/index.js";
import type { SkillsConfig } from "../workspace/skills/types.js";
import type { GatewayStatus } from "../runtime.js";

type AgentTurnOrchestratorInput = {
  workspacePath: string;
  sessionManager: SessionManager;
  aiAgent: AiAgent;
  schedulerService: SchedulerService;
  messageLinkRepository: MessageLinkRepository;
  chatRegistry: ChatRegistry;
  deliveryService: CrossChatDeliveryService;
  channelRouter: ChannelRouter;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  braveSearchApiKey: string | null;
  shellConfig: ShellConfig;
  browserMcpClient?: BrowserMcpClient;
  commandApprovalService?: CommandApprovalService;
  useReplyChainKey: boolean;
  historyLimit: number;
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
  getStatus: () => GatewayStatus;
  adminSocketPath: string;
  logOutput: string;
  logLevel: string;
  schedulerActive: boolean;
  heartbeatActive: boolean;
  restartGateway: () => Promise<void>;
};

export class AgentTurnOrchestrator {
  private readonly workspacePath: string;
  private readonly sessionManager: SessionManager;
  private readonly aiAgent: AiAgent;
  private readonly schedulerService: SchedulerService;
  private readonly messageLinkRepository: MessageLinkRepository;
  private readonly chatRegistry: ChatRegistry;
  private readonly deliveryService: CrossChatDeliveryService;
  private readonly channelRouter: ChannelRouter;
  private readonly syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  private readonly enableGenericTools: boolean;
  private readonly braveSearchApiKey: string | null;
  private readonly shellConfig: ShellConfig;
  private readonly browserMcpClient?: BrowserMcpClient;
  private readonly commandApprovalService?: CommandApprovalService;
  private readonly useReplyChainKey: boolean;
  private readonly historyLimit: number;
  private readonly skillsConfig: SkillsConfig;
  private readonly fullConfig: Record<string, unknown>;
  private readonly getStatus: () => GatewayStatus;
  private readonly adminSocketPath: string;
  private readonly logOutput: string;
  private readonly logLevel: string;
  private readonly schedulerActive: boolean;
  private readonly heartbeatActive: boolean;
  private readonly restartGateway: () => Promise<void>;
  private readonly activeTurnManager = new ActiveTurnManager();
  private readonly continuationManager = new ContinuationManager();
  private readonly log: Logger;

  constructor({
    workspacePath,
    sessionManager,
    aiAgent,
    schedulerService,
    messageLinkRepository,
    chatRegistry,
    deliveryService,
    channelRouter,
    syncSchedule,
    enableGenericTools,
    braveSearchApiKey,
    shellConfig,
    browserMcpClient,
    commandApprovalService,
    useReplyChainKey,
    historyLimit,
    skillsConfig,
    fullConfig,
    getStatus,
    adminSocketPath,
    logOutput,
    logLevel,
    schedulerActive,
    heartbeatActive,
    restartGateway,
  }: AgentTurnOrchestratorInput) {
    this.workspacePath = workspacePath;
    this.sessionManager = sessionManager;
    this.aiAgent = aiAgent;
    this.schedulerService = schedulerService;
    this.messageLinkRepository = messageLinkRepository;
    this.chatRegistry = chatRegistry;
    this.deliveryService = deliveryService;
    this.channelRouter = channelRouter;
    this.syncSchedule = syncSchedule;
    this.enableGenericTools = enableGenericTools;
    this.braveSearchApiKey = braveSearchApiKey;
    this.shellConfig = shellConfig;
    this.browserMcpClient = browserMcpClient;
    this.commandApprovalService = commandApprovalService;
    this.useReplyChainKey = useReplyChainKey;
    this.historyLimit = historyLimit;
    this.skillsConfig = skillsConfig;
    this.fullConfig = fullConfig;
    this.getStatus = getStatus;
    this.adminSocketPath = adminSocketPath;
    this.logOutput = logOutput;
    this.logLevel = logLevel;
    this.schedulerActive = schedulerActive;
    this.heartbeatActive = heartbeatActive;
    this.restartGateway = restartGateway;
    this.log = getLogger().child({ component: "orchestrator" });
  }

  async handleInboundEvent({
    event,
  }: {
    event: NormalizedInboundEvent;
  }): Promise<void> {
    const text = event.messageText.trim();
    if (text.length === 0) return;

    if (isCommandText({ text })) return;

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
      this.continuationManager.cancel({ sessionKey: sessionIdentity.key });
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
    await bootstrapWorkspace({ workspacePath: this.workspacePath });

    const linkedSessionIdentity = await this.resolveLinkedSession({ event });
    const sessionIdentity =
      linkedSessionIdentity ?? this.deriveSessionIdentity({ event });

    this.continuationManager.cancel({ sessionKey: sessionIdentity.key });
    const existingMessage = await this.activeTurnManager.cancel({
      sessionKey: sessionIdentity.key,
    });
    const mergedText =
      existingMessage !== undefined
        ? existingMessage + "\n\n" + event.messageText.trim()
        : event.messageText.trim();

    const replyReference = this.extractReplyReference({ event });
    const isMainSession = await this.isMainSession({ event });
    const linkedChats = await this.chatRegistry.listLinkedChats({
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
    const linkedChats = await this.chatRegistry.listLinkedChats({
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

    const adapter = this.channelRouter.getAdapter({ platform: event.platform });

    const [personalityFiles, toolsIndexContent, agentsContent, bootstrapContent, allSkills] =
      await Promise.all([
        readPersonalityFiles({ workspacePath: this.workspacePath }),
        readToolNotes({ workspacePath: this.workspacePath }),
        readWorkspaceGuide({ workspacePath: this.workspacePath }),
        readBootstrapGuide({ workspacePath: this.workspacePath }),
        scanWorkspaceSkills({ workspacePath: this.workspacePath }),
      ]);

    if (abortSignal.aborted) return;

    const skills = getEligibleSkills({
      skills: allSkills,
      skillsConfig: this.skillsConfig,
      fullConfig: this.fullConfig,
    });

    const completePersonality = hasCompletePersonalityFiles(personalityFiles)
      ? personalityFiles
      : undefined;

    const userContent = buildUserContent({
      messageText: userMessage,
      replyReference,
    });

    const history = await this.sessionManager.getMessages({
      identity: sessionIdentity,
      limit: this.historyLimit,
    });

    if (abortSignal.aborted) return;

    const scheduleRunContext =
      await this.schedulerService.getRunContextForSessionKey({
        sessionKey: sessionIdentity.key,
      });

    if (abortSignal.aborted) return;

    const currentChatRecord = linkedChats.find(
      (c) => c.platformChatId === event.chatId,
    );

    const messages: ModelMessage[] = [
      getSharedSystemMessage({
        workspacePath: this.workspacePath,
        personalityFiles: completePersonality,
      }),
      getWorkspaceGuideSystemMessage({ agentsContent, bootstrapContent }),
      getSkillsSystemMessage({
        skills,
        toolNotesContent: toolsIndexContent,
      }),
      getSchedulerGuidanceSystemMessage(),
      getSelfManagementSystemMessage({
        configPath: this.getStatus().configPath ?? "~/.simpleclaw/simpleclaw.json",
        adminSocketPath: this.adminSocketPath,
        logOutput: this.logOutput,
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
      ...(this.browserMcpClient ? [getBrowserToolsSystemMessage()] : []),
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

    const turnSignals: TurnSignals = { continuation: null };

    const tools = createUnifiedTools({
      executionContext: {
        workspaceRoot: this.workspacePath,
        botTimezone: this.schedulerService.getTimezone(),
        platform: event.platform,
        chatId: event.chatId,
        threadId: event.threadId,
        directMessagesTopicId: event.directMessagesTopicId,
        runSource: "chat",
        isMainSession,
      },
      schedulerService: this.schedulerService,
      syncSchedule: this.syncSchedule,
      createdByUserId: event.senderId,
      sourceText: userMessage,
      enableGenericTools: this.enableGenericTools,
      braveSearchApiKey: this.braveSearchApiKey,
      shellConfig: this.shellConfig,
      browserMcpClient: this.browserMcpClient,
      chatRegistry: this.chatRegistry,
      channelSender: adapter,
      deliveryService: this.deliveryService,
      commandApprovalService: this.commandApprovalService,
      turnSignals,
      getStatus: this.getStatus,
      adminSocketPath: this.adminSocketPath,
      logOutput: this.logOutput,
      logLevel: this.logLevel,
      schedulerActive: this.schedulerActive,
      heartbeatActive: this.heartbeatActive,
      getActiveTurnCount: () => this.activeTurnManager.count(),
      restartGateway: this.restartGateway,
    });

    this.log.debug(
      { sessionKey: sessionIdentity.key, messageCount: messages.length },
      "Sending messages to AI model",
    );

    const streamResult = this.aiAgent.chatStreamWithTools({
      messages,
      tools,
      maxSteps: 50,
      abortSignal,
      extraStopConditions: [hasToolCall("wait_and_continue")],
    });

    (streamResult.text as Promise<string>).catch(() => {});

    let assistantResponse: string;
    try {
      if (adapter.streamDraft && event.draftSupported) {
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

    if (turnSignals.continuation && !abortSignal.aborted) {
      const { seconds, note } = turnSignals.continuation;
      this.log.info(
        { sessionKey: sessionIdentity.key, waitSeconds: seconds, note },
        "Agent requesting continuation wait",
      );
      const waitingMessage = `Waiting ${formatWaitDuration({ seconds })} -- ${note}`;

      await adapter.sendMessage({
        chatId: event.chatId,
        text: waitingMessage,
        threadId: event.threadId,
      });

      await this.sessionManager.appendMessages({
        identity: sessionIdentity,
        messages: [
          {
            role: MessageRole.user,
            content: userContent,
            metadata: getUserMetadata({ replyReference }),
          },
          {
            role: MessageRole.assistant,
            content: waitingMessage,
          },
        ],
      });

      this.continuationManager.schedule({
        sessionKey: sessionIdentity.key,
        delayMs: seconds * 1000,
        onResume: () =>
          this.resumeContinuation({
            event,
            sessionIdentity,
            isMainSession,
            continuationNote: note,
            waitedSeconds: seconds,
          }),
      });

      return;
    }

    if (assistantResponse.length === 0) {
      assistantResponse = "Done.";
    }

    await this.sessionManager.appendMessages({
      identity: sessionIdentity,
      messages: [
        {
          role: MessageRole.user,
          content: userContent,
          metadata: getUserMetadata({ replyReference }),
        },
        {
          role: MessageRole.assistant,
          content: assistantResponse,
        },
      ],
    });

    const sendResult = await adapter.sendMessage({
      chatId: event.chatId,
      text: assistantResponse,
      threadId: event.threadId,
    });

    this.log.debug(
      { sessionKey: sessionIdentity.key, responseLength: assistantResponse.length, messageId: sendResult.platformMessageId },
      "Response sent to channel",
    );

    await this.messageLinkRepository.upsertMessageLink({
      platform: event.platform,
      platformChatId: event.chatId,
      platformMessageId: sendResult.platformMessageId,
      sessionKey: sessionIdentity.key,
    });
  }

  private resumeContinuation({
    event,
    sessionIdentity,
    isMainSession,
    continuationNote,
    waitedSeconds,
  }: {
    event: NormalizedInboundEvent;
    sessionIdentity: SessionIdentity;
    isMainSession: boolean;
    continuationNote: string;
    waitedSeconds: number;
  }): void {
    const existing = this.activeTurnManager.get({
      sessionKey: sessionIdentity.key,
    });
    if (existing) {
      this.log.debug(
        { sessionKey: sessionIdentity.key },
        "Skipping continuation resume - active turn exists",
      );
      return;
    }

    const continuationMessage = [
      `[CONTINUATION] Resuming after ${waitedSeconds}s wait.`,
      `Your previous continuation note: ${continuationNote}`,
      "Check on any processes you were waiting for and continue your task.",
    ].join("\n");

    this.log.info(
      { sessionKey: sessionIdentity.key, waitedSeconds },
      "Resuming continuation",
    );

    this.chatRegistry
      .listLinkedChats({ platform: event.platform })
      .then((linkedChats) => {
        this.launchAgentTurn({
          event,
          sessionIdentity,
          userMessage: continuationMessage,
          replyReference: null,
          isMainSession,
          linkedChats,
        });
      })
      .catch((err) => {
        this.log.error({ err, sessionKey: sessionIdentity.key }, "Failed to resume continuation");
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

    const link = await this.messageLinkRepository.findByChatAndMessage({
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
    const mainChat = await this.chatRegistry.getMainChat();
    if (!mainChat) return false;
    return mainChat.platformChatId === event.chatId;
  }
}

function formatWaitDuration({ seconds }: { seconds: number }): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}
