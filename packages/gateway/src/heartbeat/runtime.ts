import { CronJob } from "cron";
import type { HeartbeatExecutor } from "./executor.js";
import type { HeartbeatService } from "./service.js";
import type { HeartbeatConfig } from "./types.js";

type HeartbeatRuntimeInput = {
  heartbeatService: HeartbeatService;
  heartbeatExecutor: HeartbeatExecutor;
  heartbeatConfig: HeartbeatConfig;
  timezone: string;
};

const MASTER_TICK_MS = 60_000;
const CLEANUP_CRON = "0 1 * * *";

export class HeartbeatRuntime {
  private readonly heartbeatService: HeartbeatService;
  private readonly heartbeatExecutor: HeartbeatExecutor;
  private readonly heartbeatConfig: HeartbeatConfig;
  private readonly timezone: string;

  private nextRunAt: Date | null = null;
  private masterTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupJob: CronJob | null = null;

  constructor({
    heartbeatService,
    heartbeatExecutor,
    heartbeatConfig,
    timezone,
  }: HeartbeatRuntimeInput) {
    this.heartbeatService = heartbeatService;
    this.heartbeatExecutor = heartbeatExecutor;
    this.heartbeatConfig = heartbeatConfig;
    this.timezone = timezone;
  }

  async start(): Promise<void> {
    if (!this.heartbeatConfig.enabled) {
      return;
    }

    const lastRunAt = await this.heartbeatService.getLastRunAt();
    if (lastRunAt) {
      const nextCandidate = new Date(
        lastRunAt.getTime() + this.heartbeatConfig.intervalMinutes * 60_000,
      );
      this.nextRunAt = nextCandidate > new Date() ? nextCandidate : new Date();
    } else {
      this.nextRunAt = new Date();
    }

    this.masterTimer = setInterval(() => {
      void this.tick();
    }, MASTER_TICK_MS);

    this.cleanupJob = CronJob.from({
      cronTime: CLEANUP_CRON,
      timeZone: this.timezone,
      start: true,
      onTick: () => {
        void this.heartbeatService.cleanupOldRuns();
      },
    });

    console.log(
      `[heartbeat] Started. Interval: ${this.heartbeatConfig.intervalMinutes}m. Next run at: ${this.nextRunAt.toISOString()}`,
    );
  }

  stop(): void {
    if (this.masterTimer) {
      clearInterval(this.masterTimer);
      this.masterTimer = null;
    }

    if (this.cleanupJob) {
      this.cleanupJob.stop();
      this.cleanupJob = null;
    }

    this.nextRunAt = null;
  }

  getNextRunAt(): Date | null {
    return this.nextRunAt;
  }

  private async tick(): Promise<void> {
    if (!this.nextRunAt || Date.now() < this.nextRunAt.getTime()) {
      return;
    }

    if (!this.isWithinActiveHours()) {
      this.bumpNextRun();
      return;
    }

    this.bumpNextRun();

    try {
      await this.heartbeatExecutor.execute();
    } catch (error) {
      console.error("[heartbeat] Tick failed:", error);
    }
  }

  private bumpNextRun(): void {
    this.nextRunAt = new Date(
      Date.now() + this.heartbeatConfig.intervalMinutes * 60_000,
    );
  }

  private isWithinActiveHours(): boolean {
    const { start, end } = this.heartbeatConfig.activeHours;
    if (!start || !end) {
      return true;
    }

    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: this.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const currentTime = formatter.format(now);

    if (start <= end) {
      return currentTime >= start && currentTime < end;
    }

    return currentTime >= start || currentTime < end;
  }
}
