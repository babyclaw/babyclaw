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
  readToolNotes,
} from "../ai/prompts.js";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { ChannelSender } from "../channel/types.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";
import { scanWorkspaceSkills, getEligibleSkills } from "../workspace/skills/index.js";
import type { SkillsConfig } from "../workspace/skills/types.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
} from "../onboarding/personality.js";
import type { GatewayStatus } from "../runtime.js";
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
  private readonly skillsConfig: SkillsConfig;
  private readonly fullConfig: Record<string, unknown>;
  private readonly getStatus: () => GatewayStatus;
  private readonly adminSocketPath: string;
  private readonly logOutput: string;
  private readonly logLevel: string;
  private readonly schedulerActive: boolean;
  private readonly heartbeatActive: boolean;
  private readonly restartGateway: () => Promise<void>;
  private readonly log: Logger;
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
    skillsConfig,
    fullConfig,
    getStatus,
    adminSocketPath,
    logOutput,
    logLevel,
    schedulerActive,
    heartbeatActive,
    restartGateway,
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
    this.skillsConfig = skillsConfig;
    this.fullConfig = fullConfig;
    this.getStatus = getStatus;
    this.adminSocketPath = adminSocketPath;
    this.logOutput = logOutput;
    this.logLevel = logLevel;
    this.schedulerActive = schedulerActive;
    this.heartbeatActive = heartbeatActive;
    this.restartGateway = restartGateway;
    this.log = getLogger().child({ component: "heartbeat-executor" });
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
    this.log.info("Heartbeat execution starting");

    try {
      const mainChat = await this.chatRegistry.getMainChat();
      if (!mainChat) {
        this.log.warn("No main chat found, skipping heartbeat");
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

      const [personalityFiles, toolNotesContent, agentsContent, allSkills] =
        await Promise.all([
          readPersonalityFiles({ workspacePath: this.workspacePath }),
          readToolNotes({ workspacePath: this.workspacePath }),
          readWorkspaceGuide({ workspacePath: this.workspacePath }),
          scanWorkspaceSkills({ workspacePath: this.workspacePath }),
        ]);

      const skills = getEligibleSkills({
        skills: allSkills,
        skillsConfig: this.skillsConfig,
        fullConfig: this.fullConfig,
      });

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
        getSkillsSystemMessage({ skills, toolNotesContent }),
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
        getStatus: this.getStatus,
        adminSocketPath: this.adminSocketPath,
        logOutput: this.logOutput,
        logLevel: this.logLevel,
        schedulerActive: this.schedulerActive,
        heartbeatActive: this.heartbeatActive,
        getActiveTurnCount: () => 0,
        restartGateway: this.restartGateway,
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

      this.log.info(
        { action: verdict.action, durationMs: new Date().getTime() - startedAt.getTime() },
        "Heartbeat verdict reached",
      );

      if (verdict.action === "alert" && verdict.message) {
        const sendResult = await this.channelSender.sendMessage({
          chatId: platformChatId,
          text: verdict.message,
        });

        await this.messageLinkRepository.upsertMessageLink({
          platform: mainChat.platform,
          platformChatId,
          platformMessageId: sendResult.platformMessageId,
          sessionKey: sessionIdentity.key,
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
      this.log.error(
        { err: error, durationMs: new Date().getTime() - startedAt.getTime() },
        "Heartbeat execution failed",
      );
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
