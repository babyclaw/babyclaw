import { MessageRole, ScheduleRunStatus, ScheduleType } from "../database/schema.js";
import { AiAgent } from "../ai/agent.js";
import type { ChannelSender } from "../channel/types.js";
import type { CrossChatDeliveryService } from "../chat/delivery.js";
import type { ChatRegistry } from "../chat/registry.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";
import { scanWorkspaceSkills, getEligibleSkills } from "../workspace/skills/index.js";
import type { SkillsConfig } from "../workspace/skills/types.js";
import {
  buildScheduledTaskUserContent,
  getScheduledExecutionSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
  readToolNotes,
} from "../ai/prompts.js";
import { readWorkspaceGuide } from "../workspace/bootstrap.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
} from "../onboarding/personality.js";
import { SessionManager } from "../session/manager.js";
import { MessageLinkRepository } from "../channel/message-link.js";
import { createUnifiedTools } from "../tools/registry.js";
import type { GatewayStatus } from "../runtime.js";
import { toErrorMessage } from "../utils/errors.js";
import { SchedulerService } from "./service.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

type SchedulerExecutorInput = {
  channelSender: ChannelSender;
  workspacePath: string;
  aiAgent: AiAgent;
  sessionManager: SessionManager;
  schedulerService: SchedulerService;
  messageLinkRepository: MessageLinkRepository;
  chatRegistry: ChatRegistry;
  deliveryService: CrossChatDeliveryService;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  braveSearchApiKey: string | null;
  shellConfig: ShellConfig;
  browserMcpClient?: import("../browser/mcp-client.js").BrowserMcpClient;
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

export class SchedulerExecutor {
  private readonly channelSender: ChannelSender;
  private readonly workspacePath: string;
  private readonly aiAgent: AiAgent;
  private readonly sessionManager: SessionManager;
  private readonly schedulerService: SchedulerService;
  private readonly messageLinkRepository: MessageLinkRepository;
  private readonly chatRegistry: ChatRegistry;
  private readonly deliveryService: CrossChatDeliveryService;
  private readonly syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  private readonly enableGenericTools: boolean;
  private readonly braveSearchApiKey: string | null;
  private readonly shellConfig: ShellConfig;
  private readonly browserMcpClient?: import("../browser/mcp-client.js").BrowserMcpClient;
  private readonly skillsConfig: SkillsConfig;
  private readonly fullConfig: Record<string, unknown>;
  private readonly getStatus: () => GatewayStatus;
  private readonly adminSocketPath: string;
  private readonly logOutput: string;
  private readonly logLevel: string;
  private readonly schedulerActive: boolean;
  private readonly heartbeatActive: boolean;
  private readonly restartGateway: () => Promise<void>;
  private readonly runningScheduleIds = new Set<string>();
  private readonly log: Logger;

  constructor({
    channelSender,
    workspacePath,
    aiAgent,
    sessionManager,
    schedulerService,
    messageLinkRepository,
    chatRegistry,
    deliveryService,
    syncSchedule,
    enableGenericTools,
    braveSearchApiKey,
    shellConfig,
    browserMcpClient,
    skillsConfig,
    fullConfig,
    getStatus,
    adminSocketPath,
    logOutput,
    logLevel,
    schedulerActive,
    heartbeatActive,
    restartGateway,
  }: SchedulerExecutorInput) {
    this.channelSender = channelSender;
    this.workspacePath = workspacePath;
    this.aiAgent = aiAgent;
    this.sessionManager = sessionManager;
    this.schedulerService = schedulerService;
    this.messageLinkRepository = messageLinkRepository;
    this.chatRegistry = chatRegistry;
    this.deliveryService = deliveryService;
    this.syncSchedule = syncSchedule;
    this.enableGenericTools = enableGenericTools;
    this.braveSearchApiKey = braveSearchApiKey;
    this.shellConfig = shellConfig;
    this.browserMcpClient = browserMcpClient;
    this.skillsConfig = skillsConfig;
    this.fullConfig = fullConfig;
    this.getStatus = getStatus;
    this.adminSocketPath = adminSocketPath;
    this.logOutput = logOutput;
    this.logLevel = logLevel;
    this.schedulerActive = schedulerActive;
    this.heartbeatActive = heartbeatActive;
    this.restartGateway = restartGateway;
    this.log = getLogger().child({ component: "scheduler-executor" });
  }

  async executeSchedule({
    scheduleId,
    scheduledFor = new Date(),
  }: {
    scheduleId: string;
    scheduledFor?: Date;
  }): Promise<void> {
    const schedule = await this.schedulerService.getScheduleForRuntime({ scheduleId });
    if (!schedule || schedule.status !== "active") {
      this.log.debug({ scheduleId }, "Schedule not found or inactive, skipping");
      return;
    }

    this.log.info(
      { scheduleId, title: schedule.title, taskPrompt: schedule.taskPrompt },
      "Executing schedule",
    );

    if (this.runningScheduleIds.has(scheduleId)) {
      this.log.warn({ scheduleId }, "Skipping schedule - previous run still in progress");
      await this.schedulerService.createRun({
        scheduleId,
        scheduledFor,
        status: ScheduleRunStatus.skipped_overlap,
        error: "Skipped because previous run is still in progress",
        startedAt: new Date(),
      });

      await this.schedulerService.markScheduleAfterExecution({
        scheduleId,
        succeededAt: new Date(),
      });
      return;
    }

    this.runningScheduleIds.add(scheduleId);

    const run = await this.schedulerService.createRun({
      scheduleId,
      scheduledFor,
      status: ScheduleRunStatus.running,
      attempt: 1,
      startedAt: new Date(),
    });

    const sessionKey = `schedule:${schedule.id}:run:${run.id}`;
    await this.schedulerService.updateRun({
      runId: run.id,
      data: {
        sessionKey,
      },
    });

    let lastError: unknown = null;

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await this.schedulerService.updateRun({
          runId: run.id,
          data: {
            status: ScheduleRunStatus.running,
            attempt,
            startedAt: new Date(),
            error: null,
          },
        });

        try {
          const output = await this.generateScheduleOutput({
            scheduleId: schedule.id,
            chatId: schedule.chatId,
            threadId: schedule.threadId,
            directMessagesTopicId: schedule.directMessagesTopicId,
            taskPrompt: schedule.taskPrompt,
            scheduledFor,
          });

          let sentMessageId: string;
          let effectiveSessionKey = sessionKey;

          const targetChat = schedule.targetChatRef
            ? await this.chatRegistry.findById({ id: schedule.targetChatRef })
            : null;

          if (targetChat) {
            const deliveryResult = await this.deliveryService.deliver({
              channelSender: this.channelSender,
              targetPlatformChatId: targetChat.platformChatId,
              text: output,
              seedContext: `[Scheduled task] ${schedule.taskPrompt}`,
            });
            sentMessageId = deliveryResult.platformMessageId;
            effectiveSessionKey = deliveryResult.bridgeSessionKey;
          } else {
            const sendResult = await this.channelSender.sendMessage({
              chatId: String(schedule.chatId),
              text: output,
              threadId: schedule.threadId !== null ? String(schedule.threadId) : undefined,
            });
            sentMessageId = sendResult.platformMessageId;

            const identity = SessionManager.fromLinkedSessionKey({
              key: sessionKey,
              chatId: String(schedule.chatId),
              threadId: schedule.threadId !== null ? String(schedule.threadId) : null,
              replyToMessageId: null,
            });
            await this.sessionManager.appendMessages({
              identity,
              messages: [
                {
                  role: MessageRole.user,
                  content: buildScheduledTaskUserContent({
                    taskPrompt: schedule.taskPrompt,
                    scheduledFor,
                  }),
                },
                {
                  role: MessageRole.assistant,
                  content: output,
                },
              ],
            });

            await this.messageLinkRepository.upsertMessageLink({
              platform: this.channelSender.platform,
              platformChatId: String(schedule.chatId),
              platformMessageId: sentMessageId,
              sessionKey,
              scheduleId: schedule.id,
              scheduleRunId: run.id,
            });
          }

          const finishedAt = new Date();
          await this.schedulerService.updateRun({
            runId: run.id,
            data: {
              status: ScheduleRunStatus.succeeded,
              assistantMessageId: Number(sentMessageId),
              sessionKey: effectiveSessionKey,
              finishedAt,
              error: null,
            },
          });

          await this.schedulerService.markScheduleAfterExecution({
            scheduleId,
            succeededAt: finishedAt,
          });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            await wait({ ms: RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] });
            continue;
          }
        }
      }

      const finishedAt = new Date();
      const errorMessage = toErrorMessage({ error: lastError });
      await this.schedulerService.updateRun({
        runId: run.id,
        data: {
          status: ScheduleRunStatus.failed,
          error: errorMessage,
          finishedAt,
        },
      });

      await this.schedulerService.markScheduleAfterExecution({
        scheduleId,
        succeededAt: finishedAt,
      });

      await this.sendFailureNotification({
        chatId: schedule.chatId,
        threadId: schedule.threadId,
        title: schedule.title,
        taskPrompt: schedule.taskPrompt,
        errorMessage,
      });
    } finally {
      this.runningScheduleIds.delete(scheduleId);
    }

    if (schedule.type === ScheduleType.one_off) {
      return;
    }
  }

  private async generateScheduleOutput({
    scheduleId,
    chatId,
    threadId,
    directMessagesTopicId,
    taskPrompt,
    scheduledFor,
  }: {
    scheduleId: string;
    chatId: number;
    threadId: number | null;
    directMessagesTopicId: number | null;
    taskPrompt: string;
    scheduledFor: Date;
  }): Promise<string> {
    const [personalityFiles, toolNotesContent, agentsContent, allSkills] = await Promise.all([
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

    const sharedSystemMessage = getSharedSystemMessage({
      workspacePath: this.workspacePath,
      personalityFiles: hasCompletePersonalityFiles(personalityFiles)
        ? personalityFiles
        : undefined,
    });

    const workspaceGuideMessage = getWorkspaceGuideSystemMessage({
      agentsContent,
    });

    const chatIdStr = String(chatId);
    const tools = createUnifiedTools({
      executionContext: {
        workspaceRoot: this.workspacePath,
        botTimezone: this.schedulerService.getTimezone(),
        platform: this.channelSender.platform,
        chatId: chatIdStr,
        threadId: threadId !== null ? String(threadId) : undefined,
        directMessagesTopicId: directMessagesTopicId !== null ? String(directMessagesTopicId) : undefined,
        runSource: "scheduled",
        isMainSession: false,
      },
      schedulerService: this.schedulerService,
      syncSchedule: this.syncSchedule,
      createdByUserId: chatIdStr,
      sourceText: taskPrompt,
      enableGenericTools: this.enableGenericTools,
      braveSearchApiKey: this.braveSearchApiKey,
      shellConfig: this.shellConfig,
      browserMcpClient: this.browserMcpClient,
      getStatus: this.getStatus,
      adminSocketPath: this.adminSocketPath,
      logOutput: this.logOutput,
      logLevel: this.logLevel,
      schedulerActive: this.schedulerActive,
      heartbeatActive: this.heartbeatActive,
      getActiveTurnCount: () => 0,
      restartGateway: this.restartGateway,
    });

    const text = await this.aiAgent.chatWithTools({
      messages: [
        sharedSystemMessage,
        workspaceGuideMessage,
        getSkillsSystemMessage({ skills, toolNotesContent }),
        getScheduledExecutionSystemMessage(),
        {
          role: "user",
          content: buildScheduledTaskUserContent({
            taskPrompt,
            scheduledFor,
          }),
        },
      ],
      tools,
      maxSteps: 50,
    });

    return text.trim();
  }

  private async sendFailureNotification({
    chatId,
    threadId,
    title,
    taskPrompt,
    errorMessage,
  }: {
    chatId: number;
    threadId: number | null;
    title: string | null;
    taskPrompt: string;
    errorMessage: string;
  }): Promise<void> {
    const header = title ? `Schedule failed: ${title}` : "A scheduled run failed";
    const text = [
      header,
      `task: ${taskPrompt}`,
      `error: ${errorMessage}`,
    ].join("\n");

    try {
      await this.channelSender.sendMessage({
        chatId: String(chatId),
        text,
        threadId: threadId !== null ? String(threadId) : undefined,
      });
    } catch (error) {
      this.log.error({ err: error, title }, "Failed to send schedule failure notification");
    }
  }
}

async function wait({ ms }: { ms: number }): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
