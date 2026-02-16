import type { Schedule, ScheduleRun, ScheduleType } from "@prisma/client";

export type CreateScheduleInput = {
  chatId: bigint;
  createdByUserId: bigint;
  threadId: bigint | null;
  directMessagesTopicId: bigint | null;
  sourceText: string;
  title: string | null;
  taskPrompt: string;
  jobType: ScheduleType;
  runAtIso?: string;
  cronExpression?: string;
};

export type CreateScheduleResult = {
  schedule: Schedule;
  nextRunAt: Date | null;
};

export type CancelScheduleInput = {
  chatId: bigint;
  scheduleId?: string;
  query?: string;
};

export type CancelScheduleResult =
  | {
      status: "canceled";
      schedule: Schedule;
    }
  | {
      status: "not_found";
    }
  | {
      status: "ambiguous";
      candidates: Pick<Schedule, "id" | "title" | "taskPrompt" | "nextRunAt" | "status">[];
    };

export type ScheduleForRuntime = Pick<
  Schedule,
  | "id"
  | "chatId"
  | "threadId"
  | "directMessagesTopicId"
  | "type"
  | "cronExpression"
  | "runAt"
  | "timezone"
  | "status"
  | "taskPrompt"
  | "title"
>;

export type ScheduleRunWithSchedule = ScheduleRun & {
  schedule: Pick<
    Schedule,
    "id" | "chatId" | "threadId" | "directMessagesTopicId" | "taskPrompt" | "timezone" | "type"
  >;
};

export type ScheduleRunContext = {
  scheduleId: string;
  taskPrompt: string;
  scheduledFor: Date;
};
