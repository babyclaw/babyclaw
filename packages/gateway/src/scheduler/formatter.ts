import type { ScheduleStatus, ScheduleType } from "@prisma/client";

export function formatSchedulesForCommand({
  schedules,
}: {
  schedules: {
    id: string;
    title: string | null;
    taskPrompt: string;
    status: ScheduleStatus;
    type: ScheduleType;
    nextRunAt: Date | null;
  }[];
}): string {
  if (schedules.length === 0) {
    return "No active schedules in this chat.";
  }

  return schedules
    .map((schedule, index) => {
      const title = schedule.title ?? schedule.taskPrompt;
      const nextRunLabel =
        schedule.nextRunAt === null ? "none" : schedule.nextRunAt.toISOString();

      return [
        `${index + 1}. **${title}**`,
        `id: ${schedule.id}`,
        `type: ${schedule.type}`,
        `next: ${nextRunLabel}`,
      ].join("\n");
    })
    .join("\n\n");
}
