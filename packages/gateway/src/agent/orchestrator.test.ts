import { describe, expect, it, vi, beforeEach } from "vitest";
import { AgentTurnOrchestrator } from "./orchestrator.js";
import type { ChannelAdapter, NormalizedInboundEvent } from "../channel/types.js";
import { ChannelRouter } from "../channel/router.js";

vi.mock("../workspace/bootstrap.js", () => ({
  bootstrapWorkspace: vi.fn(async () => {}),
  readBootstrapGuide: vi.fn(async () => null),
  readWorkspaceGuide: vi.fn(async () => null),
}));

vi.mock("../onboarding/personality.js", () => ({
  readPersonalityFiles: vi.fn(async () => ({})),
  hasCompletePersonalityFiles: vi.fn(() => false),
}));

vi.mock("../ai/prompts.js", () => ({
  readToolNotes: vi.fn(async () => null),
  getSharedSystemMessage: vi.fn(() => ({ role: "system", content: "shared" })),
  getWorkspaceGuideSystemMessage: vi.fn(() => ({ role: "system", content: "workspace" })),
  getSkillsSystemMessage: vi.fn(() => ({ role: "system", content: "skills" })),
  getSchedulerGuidanceSystemMessage: vi.fn(() => ({ role: "system", content: "scheduler" })),
  getMainSessionSystemMessage: vi.fn(() => ({ role: "system", content: "main" })),
  getNonMainSessionSystemMessage: vi.fn(() => ({ role: "system", content: "non-main" })),
  getBrowserToolsSystemMessage: vi.fn(() => ({ role: "system", content: "browser" })),
  buildScheduleFollowupSystemNote: vi.fn(() => "schedule followup"),
  buildScheduledTaskUserContent: vi.fn(() => "scheduled task"),
  getScheduledExecutionSystemMessage: vi.fn(() => ({ role: "system", content: "scheduled" })),
}));

vi.mock("../workspace/skills/index.js", () => ({
  scanWorkspaceSkills: vi.fn(async () => []),
  getEligibleSkills: vi.fn(({ skills }: any) => skills),
}));

function createMockAdapter(): ChannelAdapter {
  return {
    platform: "test",
    capabilities: {
      supportsDraft: true,
      supportsMarkdown: true,
      supportsTypingIndicator: false,
      supportsEditing: false,
    },
    sendMessage: vi.fn(async () => ({ platformMessageId: "msg-1" })),
    streamDraft: vi.fn(async () => "streamed response"),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
}

function createMockDeps(overrides: Record<string, any> = {}) {
  const adapter = createMockAdapter();
  const channelRouter = new ChannelRouter();
  channelRouter.register({ adapter });

  return {
    adapter,
    channelRouter,
    sessionManager: {
      getMessages: vi.fn(async () => []),
      appendMessages: vi.fn(async () => {}),
    },
    aiAgent: {
      chatStreamWithTools: vi.fn((): { textStream: AsyncIterable<string>; text: Promise<string> } => ({
        textStream: (async function* (): AsyncGenerator<string> {
          yield "Hello ";
          yield "world";
        })(),
        text: Promise.resolve("Hello world"),
      })),
    },
    schedulerService: {
      getTimezone: vi.fn(() => "UTC"),
      getRunContextForSessionKey: vi.fn(async () => null),
    },
    messageLinkRepository: {
      upsertMessageLink: vi.fn(async () => {}),
      findByChatAndMessage: vi.fn(async () => null),
    },
    chatRegistry: {
      getMainChat: vi.fn(async () => ({
        id: "main",
        platformChatId: "12345",
        isMain: true,
      })),
      listLinkedChats: vi.fn(async () => []),
    },
    deliveryService: {
      deliver: vi.fn(async () => ({
        platformMessageId: "42",
        bridgeSessionKey: "bridge:test",
      })),
    },
    syncSchedule: vi.fn(async () => {}),
    ...overrides,
  };
}

function createOrchestrator(deps: ReturnType<typeof createMockDeps>) {
  return new AgentTurnOrchestrator({
    workspacePath: "/tmp/test-workspace",
    sessionManager: deps.sessionManager as any,
    aiAgent: deps.aiAgent as any,
    schedulerService: deps.schedulerService as any,
    messageLinkRepository: deps.messageLinkRepository as any,
    chatRegistry: deps.chatRegistry as any,
    deliveryService: deps.deliveryService as any,
    channelRouter: deps.channelRouter,
    syncSchedule: deps.syncSchedule,
    enableGenericTools: false,
    braveSearchApiKey: null,
    shellConfig: { mode: "allowlist" as const, allowedCommands: [] },
    useReplyChainKey: false,
    historyLimit: 40,
    skillsConfig: { entries: {} },
    fullConfig: {},
  });
}

function makeEvent(overrides: Partial<NormalizedInboundEvent> = {}): NormalizedInboundEvent {
  return {
    platform: "test",
    chatId: "12345",
    senderId: "user-1",
    messageId: "100",
    messageText: "Hello agent",
    isEdited: false,
    draftSupported: true,
    ...overrides,
  };
}

describe("AgentTurnOrchestrator", () => {
  describe("handleInboundEvent", () => {
    it("ignores empty messages", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "   " }),
      });

      expect(deps.aiAgent.chatStreamWithTools).not.toHaveBeenCalled();
    });

    it("ignores command messages", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "/link family" }),
      });

      expect(deps.aiAgent.chatStreamWithTools).not.toHaveBeenCalled();
    });

    it("handles stop messages by cancelling active turns", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "stop" }),
      });

      expect(deps.adapter.sendMessage).not.toHaveBeenCalled();
    });

    it("processes a normal message through the agent", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Hello agent" }),
      });

      await vi.waitFor(() => {
        expect(deps.aiAgent.chatStreamWithTools).toHaveBeenCalled();
      });

      await vi.waitFor(() => {
        expect(deps.adapter.sendMessage).toHaveBeenCalled();
      });
    });

    it("sends reply via the correct adapter", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Hello" }),
      });

      await vi.waitFor(() => {
        expect(deps.adapter.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            chatId: "12345",
          }),
        );
      });
    });

    it("uses streamDraft when adapter supports it and event allows it", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ draftSupported: true }),
      });

      await vi.waitFor(() => {
        expect(deps.adapter.streamDraft).toHaveBeenCalled();
      });
    });

    it("saves messages to session after processing", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Hello" }),
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.appendMessages).toHaveBeenCalled();
      });

      const calls = (deps.sessionManager.appendMessages as any).mock.calls;
      const call = calls[calls.length - 1]?.[0];
      expect(call.messages).toHaveLength(2);
      expect(call.messages[0].role).toBe("user");
      expect(call.messages[1].role).toBe("assistant");
    });

    it("stores message link after sending", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent(),
      });

      await vi.waitFor(() => {
        expect(deps.messageLinkRepository.upsertMessageLink).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: "test",
            platformChatId: "12345",
            platformMessageId: "msg-1",
          }),
        );
      });
    });

    it("resolves linked session via reply-to message", async () => {
      const deps = createMockDeps();
      (deps.messageLinkRepository.findByChatAndMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
        platform: "test",
        platformChatId: "12345",
        platformMessageId: "99",
        sessionKey: "linked:session:key",
        scheduleId: null,
        scheduleRunId: null,
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ replyToMessageId: "99" }),
      });

      await vi.waitFor(() => {
        expect(deps.messageLinkRepository.findByChatAndMessage).toHaveBeenCalledWith({
          platform: "test",
          platformChatId: "12345",
          platformMessageId: "99",
        });
      });
    });

    it("ignores edited messages when no active turn exists", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ isEdited: true }),
      });

      expect(deps.aiAgent.chatStreamWithTools).not.toHaveBeenCalled();
    });

    it("includes reply context in user content when replyToText present", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          replyToMessageId: "50",
          replyToText: "Previous message",
          messageText: "My reply",
        }),
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.appendMessages).toHaveBeenCalled();
      });

      const calls = (deps.sessionManager.appendMessages as any).mock.calls;
      const call = calls[calls.length - 1]?.[0];
      expect(call.messages[0].content).toContain("Reply context");
      expect(call.messages[0].content).toContain("Previous message");
    });

    it("sends error reply when agent turn fails", async () => {
      const deps = createMockDeps();

      (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mockImplementation(
        (): { textStream: AsyncIterable<string>; text: Promise<string> } => {
          const stream = (async function* (): AsyncGenerator<string> {
            yield "start";
            throw new Error("AI failed");
          })();
          return {
            textStream: stream,
            text: Promise.reject(new Error("AI failed")),
          };
        },
      );

      deps.adapter.streamDraft = vi.fn(async ({ textStream }: any) => {
        for await (const _chunk of textStream) {
          // consume the stream -- will throw
        }
        return "";
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent(),
      });

      await vi.waitFor(
        () => {
          const calls = (deps.adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
          const errorCall = calls.find((c: any) =>
            c[0].text.includes("internal error"),
          );
          expect(errorCall).toBeDefined();
        },
        { timeout: 3000 },
      );
    });
  });
});
