import { ScheduleStatus, ScheduleType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SchedulerService } from "./service.js";

function createMockPrisma(): any {
  return {
    schedule: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "mock-id",
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
        canceledAt: null,
        lastRunAt: null,
      })),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    scheduleRun: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
}

const BASE_INPUT = {
  chatId: 1n,
  createdByUserId: 1n,
  threadId: null,
  directMessagesTopicId: null,
  sourceText: "test",
  title: null,
  taskPrompt: "do something",
};

describe("SchedulerService.createSchedule", () => {
  it("throws when taskPrompt is empty", async () => {
    const service = new SchedulerService({
      prisma: createMockPrisma(),
      timezone: "UTC",
    });

    await expect(
      service.createSchedule({
        ...BASE_INPUT,
        taskPrompt: "   ",
        jobType: ScheduleType.one_off,
        runAtIso: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow("task is required");
  });

  describe("one_off jobs", () => {
    it("throws when runAtIso is missing", async () => {
      const service = new SchedulerService({
        prisma: createMockPrisma(),
        timezone: "UTC",
      });

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.one_off,
        }),
      ).rejects.toThrow("run_at_iso is required for one_off jobs");
    });

    it("throws when runAtIso is not a valid date", async () => {
      const service = new SchedulerService({
        prisma: createMockPrisma(),
        timezone: "UTC",
      });

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.one_off,
          runAtIso: "not-a-date",
        }),
      ).rejects.toThrow("run_at_iso must be a valid ISO datetime");
    });

    it("throws when runAtIso is in the past", async () => {
      const service = new SchedulerService({
        prisma: createMockPrisma(),
        timezone: "UTC",
      });

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.one_off,
          runAtIso: "2020-01-01T00:00:00.000Z",
        }),
      ).rejects.toThrow("run_at_iso must be in the future");
    });

    it("creates a one_off schedule with correct nextRunAt", async () => {
      const mockPrisma = createMockPrisma();
      const service = new SchedulerService({
        prisma: mockPrisma,
        timezone: "UTC",
      });

      const futureDate = new Date(Date.now() + 3_600_000).toISOString();
      const result = await service.createSchedule({
        ...BASE_INPUT,
        jobType: ScheduleType.one_off,
        runAtIso: futureDate,
      });

      expect(result.nextRunAt).toEqual(new Date(futureDate));
      expect(mockPrisma.schedule.create).toHaveBeenCalledOnce();

      const createArg = mockPrisma.schedule.create.mock.calls[0][0];
      expect(createArg.data.type).toBe(ScheduleType.one_off);
      expect(createArg.data.status).toBe(ScheduleStatus.active);
      expect(createArg.data.runAt).toEqual(new Date(futureDate));
      expect(createArg.data.nextRunAt).toEqual(new Date(futureDate));
      expect(createArg.data.cronExpression).toBeNull();
    });
  });

  describe("recurring jobs", () => {
    it("throws when cronExpression is missing", async () => {
      const service = new SchedulerService({
        prisma: createMockPrisma(),
        timezone: "UTC",
      });

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
        }),
      ).rejects.toThrow("cron_expression is required for recurring jobs");
    });

    it("throws when cronExpression is empty", async () => {
      const service = new SchedulerService({
        prisma: createMockPrisma(),
        timezone: "UTC",
      });

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
          cronExpression: "   ",
        }),
      ).rejects.toThrow("cron_expression is required for recurring jobs");
    });

    it("throws when cronExpression is invalid syntax", async () => {
      const service = new SchedulerService({
        prisma: createMockPrisma(),
        timezone: "UTC",
      });

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
          cronExpression: "not a cron",
        }),
      ).rejects.toThrow("cron_expression is invalid");
    });

    it("throws when cron interval is less than 5 minutes", async () => {
      const service = new SchedulerService({
        prisma: createMockPrisma(),
        timezone: "UTC",
      });

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
          cronExpression: "* * * * *", // every minute
        }),
      ).rejects.toThrow(
        "cron_expression must have an interval of at least 5 minutes",
      );
    });

    it("creates a recurring schedule with a computed nextRunAt", async () => {
      const mockPrisma = createMockPrisma();
      const service = new SchedulerService({
        prisma: mockPrisma,
        timezone: "UTC",
      });

      const result = await service.createSchedule({
        ...BASE_INPUT,
        jobType: ScheduleType.recurring,
        cronExpression: "0 9 * * *", // daily at 9am
      });

      expect(result.nextRunAt).toBeInstanceOf(Date);
      expect(result.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

      const createArg = mockPrisma.schedule.create.mock.calls[0][0];
      expect(createArg.data.type).toBe(ScheduleType.recurring);
      expect(createArg.data.cronExpression).toBe("0 9 * * *");
      expect(createArg.data.runAt).toBeNull();
    });
  });

  it("trims title whitespace and normalizes empty to null", async () => {
    const mockPrisma = createMockPrisma();
    const service = new SchedulerService({
      prisma: mockPrisma,
      timezone: "UTC",
    });

    await service.createSchedule({
      ...BASE_INPUT,
      title: "   ",
      jobType: ScheduleType.one_off,
      runAtIso: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const createArg = mockPrisma.schedule.create.mock.calls[0][0];
    expect(createArg.data.title).toBeNull();
  });
});
