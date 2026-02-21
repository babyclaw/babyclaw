import { ScheduleType } from "../database/schema.js";
import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createSchedulerTools } from "./scheduler.js";

function createMockSchedulerService(): any {
  return {
    getTimezone: vi.fn(() => "UTC"),
    createSchedule: vi.fn(async () => ({
      schedule: {
        id: "sched-1",
        type: ScheduleType.one_off,
        title: "Test",
        taskPrompt: "do something",
      },
      nextRunAt: new Date("2030-01-01T09:00:00Z"),
    })),
    listSchedules: vi.fn(async () => []),
  };
}

function createMockChatRegistry(): any {
  return {
    resolveAlias: vi.fn(),
  };
}

const baseParams = {
  chatId: "1",
  createdByUserId: "1",
  threadId: null,
  directMessagesTopicId: null,
  sourceText: "test",
  syncSchedule: vi.fn(async () => {}),
};

describe("createSchedulerTools - cross-chat targeting", () => {
  it("resolves target_alias to Chat cuid when isMainSession", async () => {
    const schedulerService = createMockSchedulerService();
    const chatRegistry = createMockChatRegistry();
    chatRegistry.resolveAlias.mockResolvedValue({
      id: "chat-family",
      alias: "family",
      linkedAt: new Date(),
    });

    const executionContext: ToolExecutionContext = {
      workspaceRoot: "/tmp",
      botTimezone: "UTC",
      platform: "telegram",
      runSource: "chat",
      isMainSession: true,
    };

    const tools = createSchedulerTools({
      schedulerService,
      ...baseParams,
      executionContext,
      chatRegistry,
    });

    await tools.create_schedule.execute!(
      {
        job_type: ScheduleType.one_off,
        task: "Say hi",
        run_at_iso: "2030-01-01T09:00:00Z",
        target_alias: "family",
      },
      { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
    );

    expect(chatRegistry.resolveAlias).toHaveBeenCalledWith({
      platform: "telegram",
      alias: "family",
    });
    expect(schedulerService.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        targetChatRef: "chat-family",
      }),
    );
  });

  it("ignores target_alias when not isMainSession", async () => {
    const schedulerService = createMockSchedulerService();
    const chatRegistry = createMockChatRegistry();

    const executionContext: ToolExecutionContext = {
      workspaceRoot: "/tmp",
      botTimezone: "UTC",
      platform: "telegram",
      runSource: "chat",
      isMainSession: false,
    };

    const tools = createSchedulerTools({
      schedulerService,
      ...baseParams,
      executionContext,
      chatRegistry,
    });

    await tools.create_schedule.execute!(
      {
        job_type: ScheduleType.one_off,
        task: "Say hi",
        run_at_iso: "2030-01-01T09:00:00Z",
        target_alias: "family",
      },
      { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
    );

    expect(chatRegistry.resolveAlias).not.toHaveBeenCalled();
    expect(schedulerService.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        targetChatRef: null,
      }),
    );
  });

  it("returns ALIAS_NOT_FOUND when target_alias does not resolve", async () => {
    const schedulerService = createMockSchedulerService();
    const chatRegistry = createMockChatRegistry();
    chatRegistry.resolveAlias.mockResolvedValue(null);

    const executionContext: ToolExecutionContext = {
      workspaceRoot: "/tmp",
      botTimezone: "UTC",
      platform: "telegram",
      runSource: "chat",
      isMainSession: true,
    };

    const tools = createSchedulerTools({
      schedulerService,
      ...baseParams,
      executionContext,
      chatRegistry,
    });

    const result: any = await tools.create_schedule.execute!(
      {
        job_type: ScheduleType.one_off,
        task: "Say hi",
        run_at_iso: "2030-01-01T09:00:00Z",
        target_alias: "nonexistent",
      },
      { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("ALIAS_NOT_FOUND");
  });

  it("includes target_alias in result when provided", async () => {
    const schedulerService = createMockSchedulerService();
    const chatRegistry = createMockChatRegistry();
    chatRegistry.resolveAlias.mockResolvedValue({
      id: "chat-work",
      alias: "work",
      linkedAt: new Date(),
    });

    const executionContext: ToolExecutionContext = {
      workspaceRoot: "/tmp",
      botTimezone: "UTC",
      platform: "telegram",
      runSource: "chat",
      isMainSession: true,
    };

    const tools = createSchedulerTools({
      schedulerService,
      ...baseParams,
      executionContext,
      chatRegistry,
    });

    const result: any = await tools.create_schedule.execute!(
      {
        job_type: ScheduleType.one_off,
        task: "Report status",
        run_at_iso: "2030-01-01T09:00:00Z",
        target_alias: "work",
      },
      { messages: [], toolCallId: "1", abortSignal: new AbortController().signal },
    );

    expect(result.target_alias).toBe("work");
  });
});
