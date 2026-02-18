import { ScheduleType } from "@prisma/client";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ChatRegistry } from "../chat/registry.js";
import { SchedulerService } from "../scheduler/service.js";
import { toErrorMessage } from "../utils/errors.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateSchedulerToolsInput = {
  schedulerService: SchedulerService;
  syncSchedule: (args: { scheduleId: string }) => Promise<void>;
  chatId: string;
  createdByUserId: string;
  threadId: string | null;
  directMessagesTopicId: string | null;
  sourceText: string;
  executionContext: ToolExecutionContext;
  chatRegistry?: ChatRegistry;
};

export function createSchedulerTools({
  schedulerService,
  syncSchedule,
  chatId,
  createdByUserId,
  threadId,
  directMessagesTopicId,
  sourceText,
  executionContext,
  chatRegistry,
}: CreateSchedulerToolsInput): ToolSet {
  return {
    get_current_time: tool({
      description:
        "Get the current timestamp in the bot timezone. Call this before scheduling relative requests like 'in 30 minutes' or 'tomorrow morning'.",
      inputSchema: z.object({}),
      execute: async () =>
        withToolLogging({
          context: executionContext,
          toolName: "get_current_time",
          defaultCode: "GET_CURRENT_TIME_FAILED",
          action: async () => {
            const now = new Date();
            const timezone = schedulerService.getTimezone();
            const formatter = new Intl.DateTimeFormat("en-US", {
              timeZone: timezone,
              weekday: "long",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });
            const parts = formatter.formatToParts(now);
            const valueByType = toValueByType({ parts });

            const year = valueByType.year ?? "0000";
            const month = valueByType.month ?? "01";
            const day = valueByType.day ?? "01";
            const hour = valueByType.hour ?? "00";
            const minute = valueByType.minute ?? "00";
            const second = valueByType.second ?? "00";

            return {
              now_iso: now.toISOString(),
              unix_ms: now.getTime(),
              timezone,
              weekday: valueByType.weekday ?? "",
              local_date: `${year}-${month}-${day}`,
              local_time: `${hour}:${minute}:${second}`,
            } as const;
          },
        }),
    }),
    create_schedule: tool({
      description: [
        "Create a reminder or recurring automation from user intent.",
        "Only call when user clearly asks to schedule something.",
        "For recurring jobs, you must provide cron_expression.",
        "Timezone is fixed by the system. Fuzzy defaults: morning=09:00, afternoon=14:00, evening=19:00.",
        "In the main session, you can target a linked chat by providing target_alias.",
      ].join(" "),
      inputSchema: z.object({
        job_type: z.enum([ScheduleType.one_off, ScheduleType.recurring]),
        task: z.string().trim().min(1),
        run_at_iso: z.string().datetime().optional(),
        cron_expression: z.string().trim().min(1).optional(),
        title: z.string().trim().min(1).optional(),
        target_alias: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Alias of a linked chat to deliver output to (main session only)"),
      }),
      execute: async ({ job_type, task, run_at_iso, cron_expression, title, target_alias }) =>
        withToolLogging({
          context: executionContext,
          toolName: "create_schedule",
          defaultCode: "CREATE_SCHEDULE_FAILED",
          input: { job_type, task, run_at_iso, cron_expression, title, target_alias },
          action: async () => {
            let targetChatRef: string | null = null;

            if (target_alias && executionContext.isMainSession && chatRegistry && executionContext.platform) {
              const targetChat = await chatRegistry.resolveAlias({
                platform: executionContext.platform,
                alias: target_alias,
              });
              if (!targetChat) {
                throw new ToolExecutionError({
                  code: "ALIAS_NOT_FOUND",
                  message: `No chat found with alias "${target_alias}".`,
                  hint: "Use list_known_chats to see available aliases.",
                });
              }
              if (!targetChat.linkedAt) {
                throw new ToolExecutionError({
                  code: "CHAT_NOT_LINKED",
                  message: `Chat "${target_alias}" is not linked.`,
                });
              }
              targetChatRef = targetChat.id;
            }

            let created;
            try {
              created = await schedulerService.createSchedule({
                chatId,
                createdByUserId,
                threadId,
                directMessagesTopicId,
                sourceText,
                title: title ?? null,
                taskPrompt: task,
                jobType: job_type,
                runAtIso: run_at_iso,
                cronExpression: cron_expression,
                targetChatRef,
              });
            } catch (error) {
              const message = toErrorMessage({ error });
              if (message.includes("run_at_iso must be in the future")) {
                throw new ToolExecutionError({
                  code: "SCHEDULE_TIME_IN_PAST",
                  message:
                    "run_at_iso is in the past. Call get_current_time, recompute a future timestamp, and retry create_schedule.",
                  hint: "Use current bot time and provide a future ISO datetime.",
                });
              }

              if (message.includes("run_at_iso must be a valid ISO datetime")) {
                throw new ToolExecutionError({
                  code: "INVALID_SCHEDULE_TIME",
                  message:
                    "run_at_iso is invalid. Use get_current_time and provide a full ISO datetime string before retrying.",
                  hint: "Use format like 2026-02-15T18:30:00Z.",
                });
              }

              throw new ToolExecutionError({
                code: "CREATE_SCHEDULE_FAILED",
                message,
              });
            }

            await syncSchedule({
              scheduleId: created.schedule.id,
            });

            return {
              status: "created",
              schedule_id: created.schedule.id,
              schedule_type: created.schedule.type,
              title: created.schedule.title,
              task: created.schedule.taskPrompt,
              target_alias: target_alias ?? null,
              next_run_at: created.nextRunAt?.toISOString() ?? null,
            } as const;
          },
        }),
    }),
    list_schedules: tool({
      description:
        "List schedules in the current chat. Use include_inactive when the user asks for canceled or completed schedules.",
      inputSchema: z.object({
        include_inactive: z.boolean().optional().default(false),
      }),
      execute: async ({ include_inactive }) =>
        withToolLogging({
          context: executionContext,
          toolName: "list_schedules",
          defaultCode: "LIST_SCHEDULES_FAILED",
          input: { include_inactive },
          action: async () => {
            const schedules = await schedulerService.listSchedules({
              chatId,
              includeInactive: include_inactive,
            });

            return {
              status: "ok",
              count: schedules.length,
              schedules: schedules.map((schedule) => ({
                id: schedule.id,
                type: schedule.type,
                status: schedule.status,
                title: schedule.title,
                task: schedule.taskPrompt,
                target_chat_ref: schedule.targetChatRef ?? null,
                next_run_at: schedule.nextRunAt?.toISOString() ?? null,
                created_at: schedule.createdAt.toISOString(),
              })),
            } as const;
          },
        }),
    }),
    cancel_schedule: tool({
      description: [
        "Cancel an active schedule by id or by free-text query.",
        "If query matches multiple schedules, this tool returns status=ambiguous with candidates.",
      ].join(" "),
      inputSchema: z.object({
        schedule_id: z.string().trim().min(1).optional(),
        query: z.string().trim().min(1).optional(),
      }),
      execute: async ({ schedule_id, query }) =>
        withToolLogging({
          context: executionContext,
          toolName: "cancel_schedule",
          defaultCode: "CANCEL_SCHEDULE_FAILED",
          input: { schedule_id, query },
          action: async () => {
            const result = await schedulerService.cancelSchedule({
              chatId,
              scheduleId: schedule_id,
              query,
            });

            if (result.status === "canceled") {
              await syncSchedule({
                scheduleId: result.schedule.id,
              });

              return {
                status: "canceled",
                schedule_id: result.schedule.id,
                title: result.schedule.title,
                next_run_at: result.schedule.nextRunAt?.toISOString() ?? null,
              } as const;
            }

            if (result.status === "ambiguous") {
              return {
                status: "ambiguous",
                candidates: result.candidates.map((candidate) => ({
                  id: candidate.id,
                  title: candidate.title,
                  task: candidate.taskPrompt,
                  next_run_at: candidate.nextRunAt?.toISOString() ?? null,
                })),
              } as const;
            }

            return {
              status: "not_found",
              message: "No active schedule matched that request.",
            } as const;
          },
        }),
    }),
  };
}

function toValueByType({
  parts,
}: {
  parts: Intl.DateTimeFormatPart[];
}): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return values;
}
