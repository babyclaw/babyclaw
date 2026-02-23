import { describe, expect, it, vi } from "vitest";
import { HeartbeatExecutor } from "./executor.js";

vi.mock("../ai/prompts.js", () => ({
  readToolNotes: vi.fn(async () => null),
  getSharedSystemMessage: vi.fn(() => ({ role: "system", content: "shared" })),
  getWorkspaceGuideSystemMessage: vi.fn(() => ({ role: "system", content: "workspace" })),
  getSkillsSystemMessage: vi.fn(() => ({ role: "system", content: "skills" })),
  getSchedulerGuidanceSystemMessage: vi.fn(() => ({ role: "system", content: "scheduler" })),
  getVaultSystemMessage: vi.fn(() => ({ role: "system", content: "vault" })),
  getMainSessionSystemMessage: vi.fn(() => ({ role: "system", content: "main" })),
  getHeartbeatSystemMessage: vi.fn(() => ({ role: "system", content: "heartbeat" })),
  buildHeartbeatVerdictMessages: vi.fn(() => []),
}));

vi.mock("../onboarding/personality.js", () => ({
  readPersonalityFiles: vi.fn(async () => ({})),
  hasCompletePersonalityFiles: vi.fn(() => false),
}));

vi.mock("../workspace/skills/index.js", () => ({
  scanWorkspaceSkills: vi.fn(async () => []),
  getEligibleSkills: vi.fn(({ skills }: any) => skills),
}));

vi.mock("../bundled-skills/index.js", () => ({
  getEnabledBundledSkills: vi.fn(() => []),
}));

vi.mock("../workspace/bootstrap.js", () => ({
  readHeartbeatInstructions: vi.fn(async () => "Check things"),
  readWorkspaceGuide: vi.fn(async () => null),
}));

vi.mock("../tools/registry.js", () => ({
  createUnifiedTools: vi.fn(() => ({})),
}));

function createMockChannelSender(): any {
  return {
    platform: "telegram",
    sendMessage: vi.fn(async () => ({ platformMessageId: "hb-msg-1" })),
  };
}

function createMockAiAgent(): any {
  return {
    chatWithTools: vi.fn(async () => "Phase 1 output"),
    forceToolCall: vi.fn(async () => ({
      action: "alert",
      message: "Something needs your attention",
      summary: "Found an issue",
    })),
  };
}

function createMockSessionManager(): any {
  return {
    getMessages: vi.fn(async () => []),
    appendMessages: vi.fn(async () => {}),
  };
}

function createMockHeartbeatService(): any {
  return {
    recordRun: vi.fn(async () => {}),
  };
}

function createMockChatRegistry(): any {
  return {
    getMainChat: vi.fn(async () => ({
      id: "main",
      platform: "telegram",
      platformChatId: "12345",
      isMain: true,
    })),
    listLinkedChats: vi.fn(async () => []),
  };
}

function createMockMessageLinkRepository(): any {
  return {
    upsertMessageLink: vi.fn(async () => {}),
  };
}

function createExecutor(overrides: Record<string, any> = {}) {
  const aiAgent = overrides.aiAgent ?? createMockAiAgent();
  const sessionManager = overrides.sessionManager ?? createMockSessionManager();
  const chatRegistry = overrides.chatRegistry ?? createMockChatRegistry();
  const messageLinkRepository =
    overrides.messageLinkRepository ?? createMockMessageLinkRepository();
  const channelSender = overrides.channelSender ?? createMockChannelSender();

  return new HeartbeatExecutor({
    toolDeps: {
      workspacePath: "/tmp/test",
      bundledSkillsDir: "/tmp/test-bundled-skills",
      aiAgent,
      sessionManager,
      schedulerService: {
        getTimezone: vi.fn(() => "UTC"),
        getRunContextForSessionKey: vi.fn(async () => null),
      } as any,
      chatRegistry,
      deliveryService: {} as any,
      messageLinkRepository,
      syncSchedule: vi.fn(async () => {}),
      enableGenericTools: false,
      braveSearchApiKey: null,
      shellConfig: { mode: "allowlist" as const, allowedCommands: [] },
      skillsConfig: { entries: {} },
      fullConfig: {},
      selfToolDeps: {
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
        heartbeatActive: true,
        restartGateway: vi.fn(async () => {}),
      },
      vaultRepository: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => ({ created: true })),
        delete: vi.fn(async () => ({ deleted: false })),
        list: vi.fn(async () => []),
      } as any,
    },
    channelSender,
    heartbeatService: overrides.heartbeatService ?? createMockHeartbeatService(),
    heartbeatConfig: {
      enabled: true,
      intervalMinutes: 30,
      activeHours: { start: null, end: null },
      prompt: "Check things",
    },
    historyLimit: 40,
  });
}

describe("HeartbeatExecutor", () => {
  it("stores message link when heartbeat sends an alert", async () => {
    const channelSender = createMockChannelSender();
    const messageLinkRepository = createMockMessageLinkRepository();
    const aiAgent = createMockAiAgent();

    aiAgent.forceToolCall.mockResolvedValue({
      action: "alert",
      message: "Something needs your attention",
      summary: "Found an issue",
    });

    const executor = createExecutor({
      channelSender,
      messageLinkRepository,
      aiAgent,
    });

    await executor.execute();

    expect(channelSender.sendMessage).toHaveBeenCalledWith({
      chatId: "12345",
      text: "Something needs your attention",
    });

    expect(messageLinkRepository.upsertMessageLink).toHaveBeenCalledWith({
      platform: "telegram",
      platformChatId: "12345",
      platformMessageId: "hb-msg-1",
      sessionKey: "telegram:12345",
    });
  });

  it("does not store message link when heartbeat verdict is ok", async () => {
    const channelSender = createMockChannelSender();
    const messageLinkRepository = createMockMessageLinkRepository();
    const aiAgent = createMockAiAgent();

    aiAgent.forceToolCall.mockResolvedValue({
      action: "ok",
      message: null,
      summary: "All clear",
    });

    const executor = createExecutor({
      channelSender,
      messageLinkRepository,
      aiAgent,
    });

    await executor.execute();

    expect(channelSender.sendMessage).not.toHaveBeenCalled();
    expect(messageLinkRepository.upsertMessageLink).not.toHaveBeenCalled();
  });
});
