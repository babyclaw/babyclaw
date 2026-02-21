import { desc, lt } from "drizzle-orm";
import type { Database } from "../database/client.js";
import { heartbeatRuns, type HeartbeatOutcome } from "../database/schema.js";

type HeartbeatServiceInput = {
  db: Database;
};

type RecordRunInput = {
  startedAt: Date;
  finishedAt?: Date;
  outcome: HeartbeatOutcome;
  summary?: string;
  error?: string;
};

const RETENTION_DAYS = 7;

export class HeartbeatService {
  private readonly db: Database;

  constructor({ db }: HeartbeatServiceInput) {
    this.db = db;
  }

  async recordRun({
    startedAt,
    finishedAt,
    outcome,
    summary,
    error,
  }: RecordRunInput): Promise<void> {
    await this.db.insert(heartbeatRuns).values({
      startedAt,
      finishedAt: finishedAt ?? null,
      outcome,
      summary: summary ?? null,
      error: error ?? null,
    });
  }

  async getLastRunAt(): Promise<Date | null> {
    const last = await this.db.query.heartbeatRuns.findFirst({
      orderBy: [desc(heartbeatRuns.startedAt)],
      columns: { startedAt: true },
    });

    return last?.startedAt ?? null;
  }

  async cleanupOldRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.db.delete(heartbeatRuns).where(lt(heartbeatRuns.createdAt, cutoff));
  }
}
