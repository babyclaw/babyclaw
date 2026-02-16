import { ScheduleStatus, ScheduleType } from "@prisma/client";
import { CronJob } from "cron";
import { SchedulerExecutor } from "./executor.js";
import { SchedulerService } from "./service.js";
import type { ScheduleForRuntime } from "./types.js";

type SchedulerRuntimeInput = {
  schedulerService: SchedulerService;
  schedulerExecutor: SchedulerExecutor;
};

const RUN_RETENTION_CRON = "0 0 * * *";

export class SchedulerRuntime {
  private readonly schedulerService: SchedulerService;
  private readonly schedulerExecutor: SchedulerExecutor;
  private readonly jobs = new Map<string, CronJob>();
  private cleanupJob: CronJob | null = null;

  constructor({ schedulerService, schedulerExecutor }: SchedulerRuntimeInput) {
    this.schedulerService = schedulerService;
    this.schedulerExecutor = schedulerExecutor;
  }

  async start(): Promise<void> {
    await this.schedulerService.cleanupOldRuns();

    const schedules = await this.schedulerService.listActiveSchedulesForRuntime();
    for (const schedule of schedules) {
      await this.syncScheduleRecord({ schedule });
    }

    this.cleanupJob = CronJob.from({
      cronTime: RUN_RETENTION_CRON,
      timeZone: this.schedulerService.getTimezone(),
      start: true,
      onTick: () => {
        void this.schedulerService.cleanupOldRuns();
      },
    });
  }

  stop(): void {
    for (const job of this.jobs.values()) {
      job.stop();
    }
    this.jobs.clear();

    if (this.cleanupJob) {
      this.cleanupJob.stop();
      this.cleanupJob = null;
    }
  }

  async syncSchedule({ scheduleId }: { scheduleId: string }): Promise<void> {
    const schedule = await this.schedulerService.getScheduleForRuntime({
      scheduleId,
    });

    if (!schedule || schedule.status !== ScheduleStatus.active) {
      this.unregisterSchedule({ scheduleId });
      return;
    }

    await this.syncScheduleRecord({ schedule });
  }

  private async syncScheduleRecord({
    schedule,
  }: {
    schedule: ScheduleForRuntime;
  }): Promise<void> {
    if (schedule.type === ScheduleType.one_off) {
      if (!schedule.runAt) {
        this.unregisterSchedule({ scheduleId: schedule.id });
        return;
      }

      if (schedule.runAt.getTime() < Date.now()) {
        await this.schedulerService.completeAfterSkippedDowntime({
          scheduleId: schedule.id,
          scheduledFor: schedule.runAt,
        });
        this.unregisterSchedule({ scheduleId: schedule.id });
        return;
      }
    }

    this.registerSchedule({ schedule });
  }

  private registerSchedule({ schedule }: { schedule: ScheduleForRuntime }): void {
    this.unregisterSchedule({ scheduleId: schedule.id });

    if (schedule.type === ScheduleType.recurring) {
      if (!schedule.cronExpression) {
        return;
      }

      const job = CronJob.from({
        cronTime: schedule.cronExpression,
        timeZone: schedule.timezone,
        start: true,
        onTick: () => {
          void this.fireSchedule({ scheduleId: schedule.id });
        },
      });

      this.jobs.set(schedule.id, job);
      return;
    }

    if (!schedule.runAt) {
      return;
    }

    const job = CronJob.from({
      cronTime: schedule.runAt,
      start: true,
      onTick: () => {
        void this.fireSchedule({ scheduleId: schedule.id });
      },
    });
    this.jobs.set(schedule.id, job);
  }

  private unregisterSchedule({ scheduleId }: { scheduleId: string }): void {
    const existing = this.jobs.get(scheduleId);
    if (!existing) {
      return;
    }

    existing.stop();
    this.jobs.delete(scheduleId);
  }

  private async fireSchedule({ scheduleId }: { scheduleId: string }): Promise<void> {
    try {
      await this.schedulerExecutor.executeSchedule({ scheduleId });
    } catch (error) {
      console.error(`Failed to execute schedule ${scheduleId}:`, error);
    } finally {
      await this.syncSchedule({ scheduleId });
    }
  }
}
