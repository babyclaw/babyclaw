import { ScheduleRunStatus, ScheduleType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SchedulerExecutor } from "./executor.js";

function createMockChannelSender(): any {
  return {
    platform: "telegram",
    sendMessage: vi.fn(async () => ({ platformMessageId: "999" })),
  };
}

function createMockAiAgent(): any {
  return {
    chatWithTools: vi.fn(async () => "Generated output"),
  };
}

function createMockSessionManager(): any {
  return {
    appendMessages: vi.fn(async () => {}),
  };
}

function createMockSchedulerService(): any {
  return {
    getTimezone: vi.fn(() => "UTC"),
    getScheduleForRuntime: vi.fn(),
    createRun: vi.fn(async () => ({ id: "run-1" })),
    updateRun: vi.fn(async () => {}),
    markScheduleAfterExecution: vi.fn(async () => {}),
    getRunContextForSessionKey: vi.fn(async () => null),
  };
}

function createMockMessageLinkRepository(): any {
  return {
    upsertMessageLink: vi.fn(async () => {}),
  };
}

function createMockChatRegistry(): any {
  return {
    findById: vi.fn(),
  };
}

function createMockDeliveryService(): any {
  return {
    deliver: vi.fn(async () => ({
      platformMessageId: "42",
      bridgeSessionKey: "bridge:telegram:-1009876:uuid",
    })),
  };
}

function createExecutor(overrides: Record<string, any> = {}) {
  return new SchedulerExecutor({
    channelSender: createMockChannelSender(),
    workspacePath: "/tmp/test",
    aiAgent: createMockAiAgent(),
    sessionManager: createMockSessionManager(),
    schedulerService: createMockSchedulerService(),
    messageLinkRepository: createMockMessageLinkRepository(),
    chatRegistry: createMockChatRegistry(),
    deliveryService: createMockDeliveryService(),
    syncSchedule: vi.fn(async () => {}),
    enableGenericTools: false,
    braveSearchApiKey: null,
    shellConfig: { mode: "allowlist" as const, allowedCommands: [] },
    skillsConfig: { entries: {} },
    fullConfig: {},
    getStatus: () => ({
      state: "running" as const,
      uptimeMs: 1000,
      configPath: "/tmp/test-config.json",
      pid: process.pid,
      version: "1.0.0",
    }),
    adminSocketPath: "/tmp/test.sock",
    logOutput: "stdout",
    logLevel: "info",
    schedulerActive: true,
    heartbeatActive: false,
    restartGateway: vi.fn(async () => {}),
    ...overrides,
  });
}

describe("SchedulerExecutor - cross-chat delivery", () => {
  it("uses deliveryService when targetChatRef is set", async () => {
    const chatRegistry = createMockChatRegistry();
    const deliveryService = createMockDeliveryService();
    const schedulerService = createMockSchedulerService();
    const sessionManager = createMockSessionManager();
    const messageLinkRepository = createMockMessageLinkRepository();

    chatRegistry.findById.mockResolvedValue({
      id: "chat-family",
      platform: "telegram",
      platformChatId: "-1009876",
      alias: "family",
    });

    schedulerService.getScheduleForRuntime.mockResolvedValue({
      id: "sched-1",
      chatId: 1n,
      threadId: null,
      directMessagesTopicId: null,
      type: ScheduleType.one_off,
      cronExpression: null,
      runAt: new Date(),
      timezone: "UTC",
      status: "active",
      taskPrompt: "Say hello to family",
      title: "Family Greeting",
      targetChatRef: "chat-family",
    });

    const executor = createExecutor({
      chatRegistry,
      deliveryService,
      schedulerService,
      sessionManager,
      messageLinkRepository,
    });

    await executor.executeSchedule({ scheduleId: "sched-1" });

    expect(chatRegistry.findById).toHaveBeenCalledWith({ id: "chat-family" });
    expect(deliveryService.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPlatformChatId: "-1009876",
        seedContext: expect.stringContaining("Say hello to family"),
      }),
    );
    expect(messageLinkRepository.upsertMessageLink).not.toHaveBeenCalled();
  });

  it("uses channelSender.sendMessage when targetChatRef is null", async () => {
    const schedulerService = createMockSchedulerService();
    const deliveryService = createMockDeliveryService();
    const messageLinkRepository = createMockMessageLinkRepository();
    const channelSender = createMockChannelSender();

    schedulerService.getScheduleForRuntime.mockResolvedValue({
      id: "sched-2",
      chatId: 1n,
      threadId: null,
      directMessagesTopicId: null,
      type: ScheduleType.one_off,
      cronExpression: null,
      runAt: new Date(),
      timezone: "UTC",
      status: "active",
      taskPrompt: "Regular task",
      title: null,
      targetChatRef: null,
    });

    const executor = createExecutor({
      schedulerService,
      deliveryService,
      messageLinkRepository,
      channelSender,
    });

    await executor.executeSchedule({ scheduleId: "sched-2" });

    expect(deliveryService.deliver).not.toHaveBeenCalled();
    expect(channelSender.sendMessage).toHaveBeenCalled();
    expect(messageLinkRepository.upsertMessageLink).toHaveBeenCalled();
  });

  it("updates run with bridge session key for cross-chat delivery", async () => {
    const chatRegistry = createMockChatRegistry();
    const deliveryService = createMockDeliveryService();
    const schedulerService = createMockSchedulerService();

    chatRegistry.findById.mockResolvedValue({
      id: "chat-work",
      platform: "telegram",
      platformChatId: "-1005555",
      alias: "work",
    });

    schedulerService.getScheduleForRuntime.mockResolvedValue({
      id: "sched-3",
      chatId: 1n,
      threadId: null,
      directMessagesTopicId: null,
      type: ScheduleType.one_off,
      cronExpression: null,
      runAt: new Date(),
      timezone: "UTC",
      status: "active",
      taskPrompt: "Status update",
      title: null,
      targetChatRef: "chat-work",
    });

    const executor = createExecutor({
      chatRegistry,
      deliveryService,
      schedulerService,
    });

    await executor.executeSchedule({ scheduleId: "sched-3" });

    const updateCalls = schedulerService.updateRun.mock.calls;
    const successUpdate = updateCalls.find(
      (c: any) => c[0].data.status === ScheduleRunStatus.succeeded,
    );
    expect(successUpdate).toBeDefined();
    expect(successUpdate[0].data.sessionKey).toBe("bridge:telegram:-1009876:uuid");
  });
});
