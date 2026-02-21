import { ScheduleStatus, ScheduleType } from "../database/schema.js";
import { createTestDatabase } from "../database/test-utils.js";
import { describe, expect, it } from "vitest";
import { SchedulerService } from "./service.js";

const BASE_INPUT = {
  chatId: "1",
  createdByUserId: "1",
  threadId: null,
  directMessagesTopicId: null,
  sourceText: "test",
  title: null,
  taskPrompt: "do something",
};

function createService() {
  const db = createTestDatabase();
  return new SchedulerService({ db, timezone: "UTC" });
}

describe("SchedulerService.createSchedule", () => {
  it("throws when taskPrompt is empty", async () => {
    const service = createService();

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
      const service = createService();

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.one_off,
        }),
      ).rejects.toThrow("run_at_iso is required for one_off jobs");
    });

    it("throws when runAtIso is not a valid date", async () => {
      const service = createService();

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.one_off,
          runAtIso: "not-a-date",
        }),
      ).rejects.toThrow("run_at_iso must be a valid ISO datetime");
    });

    it("throws when runAtIso is in the past", async () => {
      const service = createService();

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.one_off,
          runAtIso: "2020-01-01T00:00:00.000Z",
        }),
      ).rejects.toThrow("run_at_iso must be in the future");
    });

    it("creates a one_off schedule with correct nextRunAt", async () => {
      const service = createService();

      const futureDate = new Date(Date.now() + 3_600_000).toISOString();
      const result = await service.createSchedule({
        ...BASE_INPUT,
        jobType: ScheduleType.one_off,
        runAtIso: futureDate,
      });

      expect(result.nextRunAt).toEqual(new Date(futureDate));
      expect(result.schedule.type).toBe(ScheduleType.one_off);
      expect(result.schedule.status).toBe(ScheduleStatus.active);
      const expectedSeconds = Math.floor(new Date(futureDate).getTime() / 1000);
      expect(Math.floor(result.schedule.runAt!.getTime() / 1000)).toBe(expectedSeconds);
      expect(Math.floor(result.schedule.nextRunAt!.getTime() / 1000)).toBe(expectedSeconds);
      expect(result.schedule.cronExpression).toBeNull();
    });
  });

  describe("recurring jobs", () => {
    it("throws when cronExpression is missing", async () => {
      const service = createService();

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
        }),
      ).rejects.toThrow("cron_expression is required for recurring jobs");
    });

    it("throws when cronExpression is empty", async () => {
      const service = createService();

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
          cronExpression: "   ",
        }),
      ).rejects.toThrow("cron_expression is required for recurring jobs");
    });

    it("throws when cronExpression is invalid syntax", async () => {
      const service = createService();

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
          cronExpression: "not a cron",
        }),
      ).rejects.toThrow("cron_expression is invalid");
    });

    it("throws when cron interval is less than 5 minutes", async () => {
      const service = createService();

      await expect(
        service.createSchedule({
          ...BASE_INPUT,
          jobType: ScheduleType.recurring,
          cronExpression: "* * * * *",
        }),
      ).rejects.toThrow(
        "cron_expression must have an interval of at least 5 minutes",
      );
    });

    it("creates a recurring schedule with a computed nextRunAt", async () => {
      const service = createService();

      const result = await service.createSchedule({
        ...BASE_INPUT,
        jobType: ScheduleType.recurring,
        cronExpression: "0 9 * * *",
      });

      expect(result.nextRunAt).toBeInstanceOf(Date);
      expect(result.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
      expect(result.schedule.type).toBe(ScheduleType.recurring);
      expect(result.schedule.cronExpression).toBe("0 9 * * *");
      expect(result.schedule.runAt).toBeNull();
    });
  });

  it("trims title whitespace and normalizes empty to null", async () => {
    const service = createService();

    const result = await service.createSchedule({
      ...BASE_INPUT,
      title: "   ",
      jobType: ScheduleType.one_off,
      runAtIso: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(result.schedule.title).toBeNull();
  });

  it("persists targetChatRef when provided", async () => {
    const service = createService();

    const result = await service.createSchedule({
      ...BASE_INPUT,
      jobType: ScheduleType.one_off,
      runAtIso: new Date(Date.now() + 3_600_000).toISOString(),
      targetChatRef: "chat-abc",
    });

    expect(result.schedule.targetChatRef).toBe("chat-abc");
  });

  it("sets targetChatRef to null when not provided", async () => {
    const service = createService();

    const result = await service.createSchedule({
      ...BASE_INPUT,
      jobType: ScheduleType.one_off,
      runAtIso: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(result.schedule.targetChatRef).toBeNull();
  });
});
