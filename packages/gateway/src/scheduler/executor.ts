import { MessageRole, ScheduleRunStatus, ScheduleType } from "../database/schema.js";
import type { ChannelSender } from "../channel/types.js";
import {
  buildScheduledTaskUserContent,
  getScheduledExecutionSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getVaultSystemMessage,
  getWorkspaceGuideSystemMessage,
} from "../ai/prompts.js";
import { loadAgentContext } from "../agent/context.js";
import { SessionManager } from "../session/manager.js";
import { createUnifiedTools } from "../tools/registry.js";
import { toErrorMessage } from "../utils/errors.js";
import type { ToolDependencies } from "../utils/tool-deps.js";
import { wait } from "../utils/async.js";
import { getLogger } from "../logging/index.js";
import type { Logger } from "../logging/index.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

type SchedulerExecutorInput = {
  toolDeps: ToolDependencies;
  channelSender: ChannelSender;
};

export class SchedulerExecutor {
  private readonly toolDeps: ToolDependencies;
  private readonly channelSender: ChannelSender;
  private readonly runningScheduleIds = new Set<string>();
  private readonly log: Logger;

  constructor({ toolDeps, channelSender }: SchedulerExecutorInput) {
    this.toolDeps = toolDeps;
    this.channelSender = channelSender;
    this.log = getLogger().child({ component: "scheduler-executor" });
  }

  async executeSchedule({
    scheduleId,
    scheduledFor = new Date(),
  }: {
    scheduleId: string;
    scheduledFor?: Date;
  }): Promise<void> {
    const {
      schedulerService,
      sessionManager,
      messageLinkRepository,
      chatRegistry,
      deliveryService,
    } = this.toolDeps;

    const schedule = await schedulerService.getScheduleForRuntime({ scheduleId });
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
      await schedulerService.createRun({
        scheduleId,
        scheduledFor,
        status: ScheduleRunStatus.skipped_overlap,
        error: "Skipped because previous run is still in progress",
        startedAt: new Date(),
      });

      await schedulerService.markScheduleAfterExecution({
        scheduleId,
        succeededAt: new Date(),
      });
      return;
    }

    this.runningScheduleIds.add(scheduleId);

    const run = await schedulerService.createRun({
      scheduleId,
      scheduledFor,
      status: ScheduleRunStatus.running,
      attempt: 1,
      startedAt: new Date(),
    });

    const sessionKey = `schedule:${schedule.id}:run:${run.id}`;
    await schedulerService.updateRun({
      runId: run.id,
      data: {
        sessionKey,
      },
    });

    let lastError: unknown = null;

    try {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await schedulerService.updateRun({
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
            ? await chatRegistry.findById({ id: schedule.targetChatRef })
            : null;

          if (targetChat) {
            const deliveryResult = await deliveryService.deliver({
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
            await sessionManager.appendMessages({
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

            await messageLinkRepository.upsertMessageLink({
              platform: this.channelSender.platform,
              platformChatId: String(schedule.chatId),
              platformMessageId: sentMessageId,
              sessionKey,
              scheduleId: schedule.id,
              scheduleRunId: run.id,
            });
          }

          const finishedAt = new Date();
          await schedulerService.updateRun({
            runId: run.id,
            data: {
              status: ScheduleRunStatus.succeeded,
              assistantMessageId: Number(sentMessageId),
              sessionKey: effectiveSessionKey,
              finishedAt,
              error: null,
            },
          });

          await schedulerService.markScheduleAfterExecution({
            scheduleId,
            succeededAt: finishedAt,
          });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) {
            await wait({
              ms: RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
            });
            continue;
          }
        }
      }

      const finishedAt = new Date();
      const errorMessage = toErrorMessage({ error: lastError });
      await schedulerService.updateRun({
        runId: run.id,
        data: {
          status: ScheduleRunStatus.failed,
          error: errorMessage,
          finishedAt,
        },
      });

      await schedulerService.markScheduleAfterExecution({
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
    const { workspacePath, aiAgent, schedulerService, skillsConfig, fullConfig } = this.toolDeps;

    const { personalityFiles, toolNotesContent, agentsContent, skills } = await loadAgentContext({
      workspacePath,
      skillsConfig,
      fullConfig,
    });

    const sharedSystemMessage = getSharedSystemMessage({
      workspacePath,
      personalityFiles,
    });

    const workspaceGuideMessage = getWorkspaceGuideSystemMessage({
      agentsContent,
    });

    const chatIdStr = String(chatId);
    const tools = createUnifiedTools({
      toolDeps: this.toolDeps,
      executionContext: {
        workspaceRoot: workspacePath,
        bundledSkillsDir: this.toolDeps.bundledSkillsDir,
        botTimezone: schedulerService.getTimezone(),
        platform: this.channelSender.platform,
        chatId: chatIdStr,
        threadId: threadId !== null ? String(threadId) : undefined,
        directMessagesTopicId:
          directMessagesTopicId !== null ? String(directMessagesTopicId) : undefined,
        runSource: "scheduled",
        isMainSession: false,
      },
      createdByUserId: chatIdStr,
      sourceText: taskPrompt,
      getActiveTurnCount: () => 0,
    });

    const text = await aiAgent.chatWithTools({
      messages: [
        sharedSystemMessage,
        workspaceGuideMessage,
        getSkillsSystemMessage({ skills, toolNotesContent }),
        getVaultSystemMessage(),
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
    const text = [header, `task: ${taskPrompt}`, `error: ${errorMessage}`].join("\n");

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
