import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AgentTurnOrchestrator } from "./orchestrator.js";
import type { TurnSignals } from "./types.js";
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
let capturedTurnSignals: TurnSignals | null = null;

vi.mock("../tools/registry.js", () => ({
  createUnifiedTools: vi.fn(({ turnSignals }: { turnSignals?: TurnSignals }) => {
    if (turnSignals) {
      capturedTurnSignals = turnSignals;
    }
    return {};
  }),
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
  afterEach(() => {
    capturedTurnSignals = null;
  });

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

  describe("wait_and_continue continuation", () => {
    function mockChatStreamWithContinuation({
      deps,
      seconds,
      note,
    }: {
      deps: ReturnType<typeof createMockDeps>;
      seconds: number;
      note: string;
    }): void {
      (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mockImplementation(
        (): { textStream: AsyncIterable<string>; text: Promise<string> } => {
          if (capturedTurnSignals) {
            capturedTurnSignals.continuation = { seconds, note };
          }
          return {
            textStream: (async function* (): AsyncGenerator<string> {})(),
            text: Promise.resolve(""),
          };
        },
      );
      deps.adapter.streamDraft = vi.fn(async () => "");
    }

    it("sends a waiting message when the tool sets continuation", async () => {
      const deps = createMockDeps();
      mockChatStreamWithContinuation({ deps, seconds: 30, note: "build running" });
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "run build" }),
      });

      await vi.waitFor(() => {
        const calls = (deps.adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
        const waitCall = calls.find((c: any) => c[0].text.includes("Waiting"));
        expect(waitCall).toBeDefined();
        expect(waitCall![0].text).toContain("30s");
        expect(waitCall![0].text).toContain("build running");
      });
    });

    it("saves the waiting message to session history", async () => {
      const deps = createMockDeps();
      mockChatStreamWithContinuation({ deps, seconds: 60, note: "deploying" });
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "deploy" }),
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.appendMessages).toHaveBeenCalled();
      });

      const calls = (deps.sessionManager.appendMessages as any).mock.calls;
      const call = calls[calls.length - 1]?.[0];
      expect(call.messages).toHaveLength(2);
      expect(call.messages[0].role).toBe("user");
      expect(call.messages[1].role).toBe("assistant");
      expect(call.messages[1].content).toContain("Waiting");
      expect(call.messages[1].content).toContain("deploying");
    });

    it("does not store a message link (returns early before send)", async () => {
      const deps = createMockDeps();
      mockChatStreamWithContinuation({ deps, seconds: 10, note: "waiting" });
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "do thing" }),
      });

      await vi.waitFor(() => {
        expect(deps.adapter.sendMessage).toHaveBeenCalled();
      });

      expect(deps.messageLinkRepository.upsertMessageLink).not.toHaveBeenCalled();
    });

    it("formats duration in minutes for waits >= 60s", async () => {
      const deps = createMockDeps();
      mockChatStreamWithContinuation({ deps, seconds: 150, note: "long task" });
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "start" }),
      });

      await vi.waitFor(() => {
        const calls = (deps.adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
        const waitCall = calls.find((c: any) => c[0].text.includes("Waiting"));
        expect(waitCall).toBeDefined();
        expect(waitCall![0].text).toContain("2m 30s");
      });
    });

    it("resumes with a continuation turn after the timer fires", async () => {
      vi.useFakeTimers();

      const deps = createMockDeps();
      let callCount = 0;
      (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mockImplementation(
        (): { textStream: AsyncIterable<string>; text: Promise<string> } => {
          callCount++;
          if (callCount === 1 && capturedTurnSignals) {
            capturedTurnSignals.continuation = { seconds: 5, note: "check output" };
            return {
              textStream: (async function* (): AsyncGenerator<string> {})(),
              text: Promise.resolve(""),
            };
          }
          return {
            textStream: (async function* (): AsyncGenerator<string> {
              yield "Done checking";
            })(),
            text: Promise.resolve("Done checking"),
          };
        },
      );
      deps.adapter.streamDraft = vi.fn(async ({ textStream }: any) => {
        let result = "";
        for await (const chunk of textStream) {
          result += chunk;
        }
        return result;
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "start process" }),
      });

      await vi.waitFor(() => {
        const calls = (deps.adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.some((c: any) => c[0].text.includes("Waiting"))).toBe(true);
      });

      expect(callCount).toBe(1);

      vi.advanceTimersByTime(5000);

      await vi.waitFor(() => {
        expect(callCount).toBe(2);
      });

      await vi.waitFor(() => {
        const calls = (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = calls[calls.length - 1]?.[0];
        const userMsg = lastCall?.messages?.find(
          (m: any) => m.role === "user" && m.content?.includes("[CONTINUATION]"),
        );
        expect(userMsg).toBeDefined();
        expect(userMsg.content).toContain("check output");
      });

      vi.useRealTimers();
    });

    it("cancels pending continuation when user sends a stop message", async () => {
      const deps = createMockDeps();
      mockChatStreamWithContinuation({ deps, seconds: 600, note: "waiting" });
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "start" }),
      });

      await vi.waitFor(() => {
        const calls = (deps.adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.some((c: any) => c[0].text.includes("Waiting"))).toBe(true);
      });

      (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mockClear();

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "stop", messageId: "101" }),
      });

      // The continuation was cancelled by the stop handler. Since the delay is
      // 600s the timer cannot fire during this test even with real timers.
      // Verify no continuation turn was launched.
      expect(deps.aiAgent.chatStreamWithTools).not.toHaveBeenCalled();
    });

    it("cancels pending continuation when user sends a new message", async () => {
      const deps = createMockDeps();
      let callCount = 0;
      (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mockImplementation(
        (): { textStream: AsyncIterable<string>; text: Promise<string> } => {
          callCount++;
          if (callCount === 1 && capturedTurnSignals) {
            capturedTurnSignals.continuation = { seconds: 600, note: "waiting" };
            return {
              textStream: (async function* (): AsyncGenerator<string> {})(),
              text: Promise.resolve(""),
            };
          }
          return {
            textStream: (async function* (): AsyncGenerator<string> {
              yield "response";
            })(),
            text: Promise.resolve("response"),
          };
        },
      );
      deps.adapter.streamDraft = vi.fn(async ({ textStream }: any) => {
        let result = "";
        for await (const chunk of textStream) {
          result += chunk;
        }
        return result;
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "start" }),
      });

      await vi.waitFor(() => {
        const calls = (deps.adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls.some((c: any) => c[0].text.includes("Waiting"))).toBe(true);
      });

      expect(callCount).toBe(1);

      // New message should cancel the pending continuation and start a fresh turn
      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "actually do this instead", messageId: "102" }),
      });

      await vi.waitFor(() => {
        expect(callCount).toBe(2);
      });

      // The second call should be a normal turn (from the new user message),
      // NOT a continuation turn. Check the user message content.
      const secondCallMessages = (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>)
        .mock.calls[1]?.[0]?.messages;
      const userMsg = secondCallMessages?.find((m: any) => m.role === "user");
      expect(userMsg?.content).toContain("actually do this instead");
      expect(userMsg?.content).not.toContain("[CONTINUATION]");
    });
  });
});
