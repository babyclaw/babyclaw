import type { Schedule, ScheduleType } from "@prisma/client";

export type CreateScheduleInput = {
  chatId: string;
  createdByUserId: string;
  threadId: string | null;
  directMessagesTopicId: string | null;
  sourceText: string;
  title: string | null;
  taskPrompt: string;
  jobType: ScheduleType;
  runAtIso?: string;
  cronExpression?: string;
  targetChatRef?: string | null;
};

export type CreateScheduleResult = {
  schedule: Schedule;
  nextRunAt: Date | null;
};

export type CancelScheduleInput = {
  chatId: string;
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
  | "targetChatRef"
>;

export type ScheduleRunContext = {
  scheduleId: string;
  taskPrompt: string;
  scheduledFor: Date;
};
