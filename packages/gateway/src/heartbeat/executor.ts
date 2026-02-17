import { MessageRole } from "@prisma/client";
import type { AiAgent } from "../ai/agent.js";
import {
  buildHeartbeatVerdictMessages,
  getBrowserToolsSystemMessage,
  getHeartbeatSystemMessage,
  getMainSessionSystemMessage,
  getSchedulerGuidanceSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
  readToolsIndex,
} from "../ai/prompts.js";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { ChannelSender } from "../channel/types.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
} from "../onboarding/personality.js";
import type { SchedulerService } from "../scheduler/service.js";
import { SessionManager } from "../session/manager.js";
import type { MessageLinkRepository } from "../channel/message-link.js";
import { createUnifiedTools } from "../tools/registry.js";
import { toErrorMessage } from "../utils/errors.js";
import {
  readHeartbeatInstructions,
  readWorkspaceGuide,
} from "../workspace/bootstrap.js";
import type { HeartbeatService } from "./service.js";
import { heartbeatResultSchema, type HeartbeatConfig } from "./types.js";

type HeartbeatExecutorInput = {
  workspacePath: string;
  aiAgent: AiAgent;
  sessionManager: SessionManager;
  schedulerService: SchedulerService;
  heartbeatService: HeartbeatService;
  chatRegistry: ChatRegistry;
  channelSender: ChannelSender;
  deliveryService: CrossChatDeliveryService;
  messageLinkRepository: MessageLinkRepository;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  braveSearchApiKey: string | null;
  shellConfig: ShellConfig;
  browserMcpClient?: BrowserMcpClient;
  heartbeatConfig: HeartbeatConfig;
  historyLimit: number;
};

export class HeartbeatExecutor {
  private readonly workspacePath: string;
  private readonly aiAgent: AiAgent;
  private readonly sessionManager: SessionManager;
  private readonly schedulerService: SchedulerService;
  private readonly heartbeatService: HeartbeatService;
  private readonly chatRegistry: ChatRegistry;
  private readonly channelSender: ChannelSender;
  private readonly deliveryService: CrossChatDeliveryService;
  private readonly messageLinkRepository: MessageLinkRepository;
  private readonly syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  private readonly enableGenericTools: boolean;
  private readonly braveSearchApiKey: string | null;
  private readonly shellConfig: ShellConfig;
  private readonly browserMcpClient?: BrowserMcpClient;
  private readonly heartbeatConfig: HeartbeatConfig;
  private readonly historyLimit: number;
  private running = false;

  constructor({
    workspacePath,
    aiAgent,
    sessionManager,
    schedulerService,
    heartbeatService,
    chatRegistry,
    channelSender,
    deliveryService,
    messageLinkRepository,
    syncSchedule,
    enableGenericTools,
    braveSearchApiKey,
    shellConfig,
    browserMcpClient,
    heartbeatConfig,
    historyLimit,
  }: HeartbeatExecutorInput) {
    this.workspacePath = workspacePath;
    this.aiAgent = aiAgent;
    this.sessionManager = sessionManager;
    this.schedulerService = schedulerService;
    this.heartbeatService = heartbeatService;
    this.chatRegistry = chatRegistry;
    this.channelSender = channelSender;
    this.deliveryService = deliveryService;
    this.messageLinkRepository = messageLinkRepository;
    this.syncSchedule = syncSchedule;
    this.enableGenericTools = enableGenericTools;
    this.braveSearchApiKey = braveSearchApiKey;
    this.shellConfig = shellConfig;
    this.browserMcpClient = browserMcpClient;
    this.heartbeatConfig = heartbeatConfig;
    this.historyLimit = historyLimit;
  }

  async execute(): Promise<void> {
    if (this.running) {
      await this.heartbeatService.recordRun({
        startedAt: new Date(),
        finishedAt: new Date(),
        outcome: "skipped_overlap",
        summary: "Skipped because previous heartbeat is still running",
      });
      return;
    }

    this.running = true;
    const startedAt = new Date();

    try {
      const mainChat = await this.chatRegistry.getMainChat();
      if (!mainChat) {
        return;
      }

      const instructions = await readHeartbeatInstructions({
        workspacePath: this.workspacePath,
      });
      if (!instructions) {
        await this.heartbeatService.recordRun({
          startedAt,
          finishedAt: new Date(),
          outcome: "skipped_empty",
          summary: "HEARTBEAT.md is empty or missing",
        });
        return;
      }

      const platformChatId = mainChat.platformChatId;

      const sessionIdentity = SessionManager.deriveSessionIdentity({
        platform: mainChat.platform,
        chatId: platformChatId,
      });

      const linkedChats = await this.chatRegistry.listLinkedChats({
        platform: mainChat.platform,
      });

      const [personalityFiles, toolsIndexContent, agentsContent] =
        await Promise.all([
          readPersonalityFiles({ workspacePath: this.workspacePath }),
          readToolsIndex({ workspacePath: this.workspacePath }),
          readWorkspaceGuide({ workspacePath: this.workspacePath }),
        ]);

      const history = await this.sessionManager.getMessages({
        identity: sessionIdentity,
        limit: this.historyLimit,
      });

      const messages = [
        getSharedSystemMessage({
          workspacePath: this.workspacePath,
          personalityFiles: hasCompletePersonalityFiles(personalityFiles)
            ? personalityFiles
            : undefined,
        }),
        getWorkspaceGuideSystemMessage({ agentsContent }),
        getSkillsSystemMessage({ toolsIndexContent }),
        getSchedulerGuidanceSystemMessage(),
        getMainSessionSystemMessage({ linkedChats }),
        getHeartbeatSystemMessage({ instructions }),
        ...(this.browserMcpClient ? [getBrowserToolsSystemMessage()] : []),
        ...history,
        { role: "user" as const, content: this.heartbeatConfig.prompt },
      ];

      const tools = createUnifiedTools({
        executionContext: {
          workspaceRoot: this.workspacePath,
          botTimezone: this.schedulerService.getTimezone(),
          platform: mainChat.platform,
          chatId: platformChatId,
          runSource: "heartbeat",
          isMainSession: true,
        },
        schedulerService: this.schedulerService,
        syncSchedule: this.syncSchedule,
        createdByUserId: platformChatId,
        sourceText: this.heartbeatConfig.prompt,
        enableGenericTools: this.enableGenericTools,
        braveSearchApiKey: this.braveSearchApiKey,
        shellConfig: this.shellConfig,
        browserMcpClient: this.browserMcpClient,
        chatRegistry: this.chatRegistry,
        channelSender: this.channelSender,
        deliveryService: this.deliveryService,
      });

      const phase1Response = await this.aiAgent.chatWithTools({
        messages,
        tools,
        maxSteps: 50,
      });

      const verdictMessages = buildHeartbeatVerdictMessages({
        phase1Response,
      });

      const verdict = await this.aiAgent.forceToolCall({
        messages: verdictMessages,
        toolName: "heartbeat_result",
        description:
          "Report the heartbeat check result. Use ok if nothing needs attention, alert if something should be delivered.",
        inputSchema: heartbeatResultSchema,
      });

      if (verdict.action === "alert" && verdict.message) {
        await this.channelSender.sendMessage({
          chatId: platformChatId,
          text: verdict.message,
        });

        await this.sessionManager.appendMessages({
          identity: sessionIdentity,
          messages: [
            {
              role: MessageRole.user,
              content: "[heartbeat tick]",
            },
            {
              role: MessageRole.assistant,
              content: verdict.message,
            },
          ],
        });
      } else {
        await this.sessionManager.appendMessages({
          identity: sessionIdentity,
          messages: [
            {
              role: MessageRole.user,
              content: "[heartbeat tick]",
            },
            {
              role: MessageRole.assistant,
              content: "[heartbeat: all clear]",
            },
          ],
        });
      }

      await this.heartbeatService.recordRun({
        startedAt,
        finishedAt: new Date(),
        outcome: verdict.action === "alert" ? "alerted" : "ok",
        summary: verdict.summary,
      });
    } catch (error) {
      console.error("Heartbeat execution failed:", error);
      await this.heartbeatService.recordRun({
        startedAt,
        finishedAt: new Date(),
        outcome: "error",
        error: toErrorMessage({ error }),
      });
    } finally {
      this.running = false;
    }
  }
}
