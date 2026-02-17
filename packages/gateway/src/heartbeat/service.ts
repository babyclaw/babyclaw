import type { HeartbeatOutcome, PrismaClient } from "@prisma/client";

type HeartbeatServiceInput = {
  prisma: PrismaClient;
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
  private readonly prisma: PrismaClient;

  constructor({ prisma }: HeartbeatServiceInput) {
    this.prisma = prisma;
  }

  async recordRun({
    startedAt,
    finishedAt,
    outcome,
    summary,
    error,
  }: RecordRunInput): Promise<void> {
    await this.prisma.heartbeatRun.create({
      data: {
        startedAt,
        finishedAt: finishedAt ?? null,
        outcome,
        summary: summary ?? null,
        error: error ?? null,
      },
    });
  }

  async getLastRunAt(): Promise<Date | null> {
    const last = await this.prisma.heartbeatRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });

    return last?.startedAt ?? null;
  }

  async cleanupOldRuns(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.heartbeatRun.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  }
}
