import { and, asc, desc, eq, lt } from "drizzle-orm";
import { CronTime, validateCronExpression } from "cron";
import type { Database } from "../database/client.js";
import {
  ScheduleRunStatus,
  ScheduleStatus,
  ScheduleType,
  scheduleRuns,
  schedules,
  type Schedule,
  type ScheduleRun,
} from "../database/schema.js";
import type {
  CancelScheduleInput,
  CancelScheduleResult,
  CreateScheduleInput,
  CreateScheduleResult,
  ScheduleForRuntime,
  ScheduleRunContext,
} from "./types.js";

const MIN_RECURRING_INTERVAL_MS = 5 * 60 * 1000;
const RUN_RETENTION_DAYS = 30;

type SchedulerServiceInput = {
  db: Database;
  timezone: string;
};

type ScheduleRunUpdateData = {
  status?: ScheduleRunStatus;
  attempt?: number;
  sessionKey?: string | null;
  assistantMessageId?: number | null;
  error?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export class SchedulerService {
  private readonly db: Database;
  private readonly timezone: string;

  constructor({ db, timezone }: SchedulerServiceInput) {
    this.db = db;
    this.timezone = timezone;
  }

  getTimezone(): string {
    return this.timezone;
  }

  async createSchedule({
    chatId,
    createdByUserId,
    threadId,
    directMessagesTopicId,
    sourceText,
    title,
    taskPrompt,
    jobType,
    runAtIso,
    cronExpression,
    targetChatRef,
  }: CreateScheduleInput): Promise<CreateScheduleResult> {
    if (taskPrompt.trim().length === 0) {
      throw new Error("task is required");
    }

    let runAt: Date | null = null;
    let normalizedCronExpression: string | null = null;
    let nextRunAt: Date | null = null;

    if (jobType === ScheduleType.one_off) {
      if (!runAtIso) {
        throw new Error("run_at_iso is required for one_off jobs");
      }

      const parsedRunAt = new Date(runAtIso);
      if (Number.isNaN(parsedRunAt.getTime())) {
        throw new Error("run_at_iso must be a valid ISO datetime");
      }

      if (parsedRunAt.getTime() <= Date.now()) {
        throw new Error("run_at_iso must be in the future");
      }

      runAt = parsedRunAt;
      nextRunAt = parsedRunAt;
    } else {
      if (!cronExpression || cronExpression.trim().length === 0) {
        throw new Error("cron_expression is required for recurring jobs");
      }

      const cronValidation = validateCronExpression(cronExpression);
      if (!cronValidation.valid) {
        throw new Error("cron_expression is invalid");
      }

      ensureMinimumRecurringInterval({
        cronExpression,
        timezone: this.timezone,
      });

      normalizedCronExpression = cronExpression.trim();
      nextRunAt = getNextRunAt({
        cronExpression: normalizedCronExpression,
        timezone: this.timezone,
        fromDate: new Date(),
      });
    }

    const rows = await this.db
      .insert(schedules)
      .values({
        chatId: Number(chatId),
        createdByUserId: Number(createdByUserId),
        threadId: threadId ? Number(threadId) : null,
        directMessagesTopicId: directMessagesTopicId ? Number(directMessagesTopicId) : null,
        sourceText,
        title: normalizeNullableString({ value: title }),
        taskPrompt: taskPrompt.trim(),
        type: jobType,
        runAt,
        cronExpression: normalizedCronExpression,
        timezone: this.timezone,
        status: ScheduleStatus.active,
        nextRunAt,
        targetChatRef: targetChatRef ?? null,
      })
      .returning();

    return {
      schedule: rows[0],
      nextRunAt,
    };
  }

  async listSchedules({
    chatId,
    includeInactive = false,
  }: {
    chatId: string;
    includeInactive?: boolean;
  }): Promise<Schedule[]> {
    return this.db.query.schedules.findMany({
      where: and(
        eq(schedules.chatId, Number(chatId)),
        ...(includeInactive ? [] : [eq(schedules.status, ScheduleStatus.active)]),
      ),
      orderBy: [asc(schedules.status), asc(schedules.nextRunAt), desc(schedules.createdAt)],
    });
  }

  async cancelSchedule({
    chatId,
    scheduleId,
    query,
  }: CancelScheduleInput): Promise<CancelScheduleResult> {
    if (scheduleId) {
      const schedule = await this.db.query.schedules.findFirst({
        where: and(
          eq(schedules.id, scheduleId),
          eq(schedules.chatId, Number(chatId)),
          eq(schedules.status, ScheduleStatus.active),
        ),
      });

      if (!schedule) {
        return { status: "not_found" };
      }

      const rows = await this.db
        .update(schedules)
        .set({
          status: ScheduleStatus.canceled,
          canceledAt: new Date(),
          nextRunAt: null,
        })
        .where(eq(schedules.id, schedule.id))
        .returning();

      return { status: "canceled", schedule: rows[0] };
    }

    if (!query || query.trim().length === 0) {
      return { status: "not_found" };
    }

    const normalizedQuery = query.trim().toLowerCase();
    const activeSchedules = await this.db
      .select({
        id: schedules.id,
        title: schedules.title,
        taskPrompt: schedules.taskPrompt,
        nextRunAt: schedules.nextRunAt,
        status: schedules.status,
      })
      .from(schedules)
      .where(
        and(eq(schedules.chatId, Number(chatId)), eq(schedules.status, ScheduleStatus.active)),
      );

    const matched = activeSchedules.filter((schedule) => {
      const haystacks = [schedule.title ?? "", schedule.taskPrompt];
      return haystacks.some((candidate) => candidate.toLowerCase().includes(normalizedQuery));
    });

    if (matched.length === 0) {
      return { status: "not_found" };
    }

    if (matched.length > 1) {
      return {
        status: "ambiguous",
        candidates: matched.slice(0, 8),
      };
    }

    const target = matched[0];
    const rows = await this.db
      .update(schedules)
      .set({
        status: ScheduleStatus.canceled,
        canceledAt: new Date(),
        nextRunAt: null,
      })
      .where(eq(schedules.id, target.id))
      .returning();

    return { status: "canceled", schedule: rows[0] };
  }

  async getScheduleForRuntime({
    scheduleId,
  }: {
    scheduleId: string;
  }): Promise<ScheduleForRuntime | null> {
    const schedule = await this.db.query.schedules.findFirst({
      where: eq(schedules.id, scheduleId),
      columns: {
        id: true,
        chatId: true,
        threadId: true,
        directMessagesTopicId: true,
        type: true,
        cronExpression: true,
        runAt: true,
        timezone: true,
        status: true,
        taskPrompt: true,
        title: true,
        targetChatRef: true,
      },
    });
    return schedule ?? null;
  }

  async listActiveSchedulesForRuntime(): Promise<ScheduleForRuntime[]> {
    return this.db.query.schedules.findMany({
      where: eq(schedules.status, ScheduleStatus.active),
      columns: {
        id: true,
        chatId: true,
        threadId: true,
        directMessagesTopicId: true,
        type: true,
        cronExpression: true,
        runAt: true,
        timezone: true,
        status: true,
        taskPrompt: true,
        title: true,
        targetChatRef: true,
      },
    });
  }

  async createRun({
    scheduleId,
    scheduledFor,
    status = ScheduleRunStatus.pending,
    attempt = 1,
    sessionKey,
    startedAt,
    error,
  }: {
    scheduleId: string;
    scheduledFor: Date;
    status?: ScheduleRunStatus;
    attempt?: number;
    sessionKey?: string;
    startedAt?: Date;
    error?: string;
  }): Promise<ScheduleRun> {
    const rows = await this.db
      .insert(scheduleRuns)
      .values({
        scheduleId,
        scheduledFor,
        status,
        attempt,
        sessionKey,
        startedAt,
        error,
      })
      .returning();

    return rows[0];
  }

  async updateRun({ runId, data }: { runId: string; data: ScheduleRunUpdateData }): Promise<void> {
    await this.db.update(scheduleRuns).set(data).where(eq(scheduleRuns.id, runId));
  }

  async completeAfterSkippedDowntime({
    scheduleId,
    scheduledFor,
  }: {
    scheduleId: string;
    scheduledFor: Date;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(scheduleRuns).values({
        scheduleId,
        scheduledFor,
        status: ScheduleRunStatus.skipped_downtime,
        finishedAt: new Date(),
        error: "Skipped due to scheduler downtime",
      });

      await tx
        .update(schedules)
        .set({
          status: ScheduleStatus.completed,
          nextRunAt: null,
          lastRunAt: new Date(),
        })
        .where(eq(schedules.id, scheduleId));
    });
  }

  async markScheduleAfterExecution({
    scheduleId,
    succeededAt,
  }: {
    scheduleId: string;
    succeededAt: Date;
  }): Promise<void> {
    const schedule = await this.db.query.schedules.findFirst({
      where: eq(schedules.id, scheduleId),
      columns: { type: true, cronExpression: true },
    });

    if (!schedule) {
      return;
    }

    if (schedule.type === ScheduleType.one_off) {
      await this.db
        .update(schedules)
        .set({
          status: ScheduleStatus.completed,
          nextRunAt: null,
          lastRunAt: succeededAt,
        })
        .where(eq(schedules.id, scheduleId));
      return;
    }

    if (!schedule.cronExpression) {
      throw new Error(`Recurring schedule ${scheduleId} is missing cronExpression`);
    }

    const nextRunAt = getNextRunAt({
      cronExpression: schedule.cronExpression,
      timezone: this.timezone,
      fromDate: succeededAt,
    });

    await this.db
      .update(schedules)
      .set({ lastRunAt: succeededAt, nextRunAt })
      .where(eq(schedules.id, scheduleId));
  }

  async cleanupOldRuns({ now = new Date() }: { now?: Date } = {}): Promise<number> {
    const cutoff = new Date(now.getTime() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.db
      .delete(scheduleRuns)
      .where(lt(scheduleRuns.createdAt, cutoff))
      .returning();

    return deleted.length;
  }

  async getRunContextForSessionKey({
    sessionKey,
  }: {
    sessionKey: string;
  }): Promise<ScheduleRunContext | null> {
    const run = await this.db.query.scheduleRuns.findFirst({
      where: eq(scheduleRuns.sessionKey, sessionKey),
      with: {
        schedule: {
          columns: { id: true, taskPrompt: true },
        },
      },
      orderBy: [desc(scheduleRuns.createdAt)],
    });

    if (!run) {
      return null;
    }

    return {
      scheduleId: run.schedule.id,
      taskPrompt: run.schedule.taskPrompt,
      scheduledFor: run.scheduledFor,
    };
  }
}

function normalizeNullableString({ value }: { value: string | null }): string | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function ensureMinimumRecurringInterval({
  cronExpression,
  timezone,
}: {
  cronExpression: string;
  timezone: string;
}): void {
  const cronTime = new CronTime(cronExpression, timezone);
  const nextTwo = cronTime.sendAt(2);
  const first = Array.isArray(nextTwo) ? nextTwo[0] : nextTwo;
  const second = Array.isArray(nextTwo) ? nextTwo[1] : cronTime.sendAt();

  const deltaMs = second.toMillis() - first.toMillis();
  if (!Number.isFinite(deltaMs) || deltaMs < MIN_RECURRING_INTERVAL_MS) {
    throw new Error("cron_expression must have an interval of at least 5 minutes");
  }
}

function getNextRunAt({
  cronExpression,
  timezone,
  fromDate,
}: {
  cronExpression: string;
  timezone: string;
  fromDate: Date;
}): Date {
  const cronTime = new CronTime(cronExpression, timezone);
  const next = cronTime.getNextDateFrom(fromDate);
  return new Date(next.toMillis());
}
