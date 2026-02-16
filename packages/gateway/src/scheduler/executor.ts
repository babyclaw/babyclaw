import { MessageRole, ScheduleRunStatus, ScheduleType } from "@prisma/client";
import type { Api } from "grammy";
import { AiAgent } from "../ai/agent.js";
import {
  buildScheduledTaskUserContent,
  getScheduledExecutionSystemMessage,
  getSharedSystemMessage,
  getSkillsSystemMessage,
  getWorkspaceGuideSystemMessage,
  readToolsIndex,
} from "../ai/prompts.js";
import { readWorkspaceGuide } from "../workspace/bootstrap.js";
import {
  hasCompletePersonalityFiles,
  readPersonalityFiles,
} from "../onboarding/personality.js";
import { SessionManager } from "../session/manager.js";
import { MessageLinkRepository } from "../telegram/message-link.js";
import { createUnifiedTools } from "../tools/registry.js";
import { sendMessageMarkdownV2 } from "../telegram/markdown.js";
import { toErrorMessage } from "../utils/errors.js";
import { SchedulerService } from "./service.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000];

type SchedulerExecutorInput = {
  api: Api;
  workspacePath: string;
  aiAgent: AiAgent;
  sessionManager: SessionManager;
  schedulerService: SchedulerService;
  messageLinkRepository: MessageLinkRepository;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  enableGenericTools: boolean;
  browserMcpClient?: import("../browser/mcp-client.js").BrowserMcpClient;
};

export class SchedulerExecutor {
  private readonly api: Api;
  private readonly workspacePath: string;
  private readonly aiAgent: AiAgent;
  private readonly sessionManager: SessionManager;
  private readonly schedulerService: SchedulerService;
  private readonly messageLinkRepository: MessageLinkRepository;
  private readonly syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  private readonly enableGenericTools: boolean;
  private readonly browserMcpClient?: import("../browser/mcp-client.js").BrowserMcpClient;
  private readonly runningScheduleIds = new Set<string>();

  constructor({
    api,
    workspacePath,
    aiAgent,
    sessionManager,
    schedulerService,
    messageLinkRepository,
    syncSchedule,
    enableGenericTools,
    browserMcpClient,
  }: SchedulerExecutorInput) {
    this.api = api;
    this.workspacePath = workspacePath;
    this.aiAgent = aiAgent;
    this.sessionManager = sessionManager;
    this.schedulerService = schedulerService;
    this.messageLinkRepository = messageLinkRepository;
    this.syncSchedule = syncSchedule;
    this.enableGenericTools = enableGenericTools;
    this.browserMcpClient = browserMcpClient;
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
      return;
    }

    if (this.runningScheduleIds.has(scheduleId)) {
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

          const sent = await this.sendScheduledMessage({
            chatId: schedule.chatId,
            text: output,
            threadId: schedule.threadId,
            directMessagesTopicId: schedule.directMessagesTopicId,
          });

          const identity = SessionManager.fromLinkedSessionKey({
            key: sessionKey,
            chatId: schedule.chatId,
            threadId: schedule.threadId,
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
            chatId: schedule.chatId,
            messageId: BigInt(sent.message_id),
            sessionKey,
            scheduleId: schedule.id,
            scheduleRunId: run.id,
          });

          const finishedAt = new Date();
          await this.schedulerService.updateRun({
            runId: run.id,
            data: {
              status: ScheduleRunStatus.succeeded,
              assistantMessageId: BigInt(sent.message_id),
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
        directMessagesTopicId: schedule.directMessagesTopicId,
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
    chatId: bigint;
    threadId: bigint | null;
    directMessagesTopicId: bigint | null;
    taskPrompt: string;
    scheduledFor: Date;
  }): Promise<string> {
    const [personalityFiles, toolsIndexContent, agentsContent] = await Promise.all([
      readPersonalityFiles({ workspacePath: this.workspacePath }),
      readToolsIndex({ workspacePath: this.workspacePath }),
      readWorkspaceGuide({ workspacePath: this.workspacePath }),
    ]);

    const sharedSystemMessage = getSharedSystemMessage({
      workspacePath: this.workspacePath,
      personalityFiles: hasCompletePersonalityFiles(personalityFiles)
        ? personalityFiles
        : undefined,
    });

    const workspaceGuideMessage = getWorkspaceGuideSystemMessage({
      agentsContent,
    });

    const tools = createUnifiedTools({
      executionContext: {
        workspaceRoot: this.workspacePath,
        botTimezone: this.schedulerService.getTimezone(),
        chatId,
        threadId: threadId ?? undefined,
        directMessagesTopicId: directMessagesTopicId ?? undefined,
        runSource: "scheduled",
      },
      schedulerService: this.schedulerService,
      syncSchedule: this.syncSchedule,
      createdByUserId: chatId,
      sourceText: taskPrompt,
      enableGenericTools: this.enableGenericTools,
      browserMcpClient: this.browserMcpClient,
    });

    const text = await this.aiAgent.chatWithTools({
      messages: [
        sharedSystemMessage,
        workspaceGuideMessage,
        getSkillsSystemMessage({ toolsIndexContent }),
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

  private async sendScheduledMessage({
    chatId,
    text,
    threadId,
    directMessagesTopicId,
  }: {
    chatId: bigint;
    text: string;
    threadId: bigint | null;
    directMessagesTopicId: bigint | null;
  }) {
    const chatIdAsString = chatId.toString();
    const thread = toSafeNumber({ value: threadId });
    const directTopic = toSafeNumber({ value: directMessagesTopicId });

    try {
      return await sendMessageMarkdownV2({
        api: this.api,
        chatId: chatIdAsString,
        text,
        options: {
          ...(thread === undefined ? {} : { message_thread_id: thread }),
          ...(directTopic === undefined
            ? {}
            : {
                direct_messages_topic_id: directTopic,
              }),
        },
      });
    } catch (error) {
      if (directTopic === undefined) {
        throw error;
      }

      return sendMessageMarkdownV2({
        api: this.api,
        chatId: chatIdAsString,
        text,
        options: {
          ...(thread === undefined ? {} : { message_thread_id: thread }),
        },
      });
    }
  }

  private async sendFailureNotification({
    chatId,
    threadId,
    directMessagesTopicId,
    title,
    taskPrompt,
    errorMessage,
  }: {
    chatId: bigint;
    threadId: bigint | null;
    directMessagesTopicId: bigint | null;
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
      await this.sendScheduledMessage({
        chatId,
        threadId,
        directMessagesTopicId,
        text,
      });
    } catch (error) {
      console.error("Failed to send schedule failure notification:", error);
    }
  }
}

function toSafeNumber({ value }: { value: bigint | null }): number | undefined {
  if (value === null) {
    return undefined;
  }

  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    return undefined;
  }

  return asNumber;
}

async function wait({ ms }: { ms: number }): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
