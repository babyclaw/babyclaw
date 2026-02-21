import { describe, expect, it, vi, afterEach } from "vitest";
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
  getSelfManagementSystemMessage: vi.fn(() => ({ role: "system", content: "self" })),
  getMainSessionSystemMessage: vi.fn(() => ({ role: "system", content: "main" })),
  getNonMainSessionSystemMessage: vi.fn(() => ({ role: "system", content: "non-main" })),
  buildScheduleFollowupSystemNote: vi.fn(() => "schedule followup"),
  buildScheduledTaskUserContent: vi.fn(() => "scheduled task"),
  getScheduledExecutionSystemMessage: vi.fn(() => ({ role: "system", content: "scheduled" })),
  getWorkingMemorySystemMessage: vi.fn(() => ({ role: "system", content: "working-memory" })),
}));

vi.mock("../workspace/skills/index.js", () => ({
  scanWorkspaceSkills: vi.fn(async () => []),
  getEligibleSkills: vi.fn(({ skills }: any) => skills),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(async () => ({ text: "A detailed description of the image contents." })),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => Buffer.from("fake-image-data")),
    existsSync: vi.fn(() => true),
  };
});
const { generateText } = await import("ai");

vi.mock("../tools/registry.js", () => ({
  createUnifiedTools: vi.fn(() => ({})),
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
    sendImage: vi.fn(async () => ({ platformMessageId: "img-1" })),
    sendFile: vi.fn(async () => ({ platformMessageId: "file-1" })),
    streamDraft: vi.fn(async () => "streamed response"),
    streamTurn: vi.fn(async ({ agentStream }: any) => {
      const texts: string[] = [];
      let stepText = "";
      let lastId: string | undefined;
      for await (const event of agentStream) {
        if (event.type === "text-delta") stepText += event.text;
        if (event.type === "step-finish") {
          if (stepText.trim()) {
            texts.push(stepText.trim());
            lastId = "msg-turn-1";
          }
          stepText = "";
        }
      }
      return { fullText: texts.join("\n\n"), lastPlatformMessageId: lastId };
    }),
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
      getMessages: vi.fn(async () => [] as Array<{ role: string; content: string }>),
      appendMessages: vi.fn(async () => {}),
      getWorkingMemory: vi.fn(async () => null),
      setTitle: vi.fn(async () => {}),
      touchLastActivity: vi.fn(async () => {}),
    },
    aiAgent: {
      chatStreamWithTools: vi.fn(() => ({
        textStream: (async function* () {
          yield "Hello ";
          yield "world";
        })(),
        fullStream: (async function* () {
          yield { type: "text-delta", id: "1", text: "Hello " };
          yield { type: "text-delta", id: "1", text: "world" };
          yield {
            type: "finish-step",
            response: {},
            usage: {},
            finishReason: "stop",
            rawFinishReason: "stop",
            providerMetadata: undefined,
          };
          yield { type: "finish", finishReason: "stop", rawFinishReason: "stop" };
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

function createOrchestrator(
  deps: ReturnType<typeof createMockDeps>,
  orchestratorOverrides: Record<string, any> = {},
) {
  return new AgentTurnOrchestrator({
    toolDeps: {
      workspacePath: "/tmp/test-workspace",
      aiAgent: deps.aiAgent as any,
      sessionManager: deps.sessionManager as any,
      schedulerService: deps.schedulerService as any,
      messageLinkRepository: deps.messageLinkRepository as any,
      chatRegistry: deps.chatRegistry as any,
      deliveryService: deps.deliveryService as any,
      syncSchedule: deps.syncSchedule,
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
        heartbeatActive: false,
        restartGateway: vi.fn(async () => {}),
      },
    },
    chatModel: {} as any,
    channelRouter: deps.channelRouter,
    useReplyChainKey: false,
    historyLimit: 40,
    ...orchestratorOverrides,
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
    vi.mocked(generateText).mockClear();
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
        expect(deps.adapter.streamTurn).toHaveBeenCalled();
      });
    });

    it("sends reply via the correct adapter", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Hello" }),
      });

      await vi.waitFor(() => {
        expect(deps.adapter.streamTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            chatId: "12345",
          }),
        );
      });
    });

    it("uses streamTurn when adapter supports it and event allows draft", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ draftSupported: true }),
      });

      await vi.waitFor(() => {
        expect(deps.adapter.streamTurn).toHaveBeenCalled();
      });
      expect(deps.adapter.streamDraft).not.toHaveBeenCalled();
    });

    it("falls back to streamDraft when streamTurn is not available", async () => {
      const deps = createMockDeps();
      deps.adapter.streamTurn = undefined;
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
            platformMessageId: "msg-turn-1",
          }),
        );
      });
    });

    it("resolves linked session via reply-to message", async () => {
      const deps = createMockDeps();
      (
        deps.messageLinkRepository.findByChatAndMessage as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
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

    it("processes a message with images through the agent", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          messageText: "What is in this photo?",
          images: [{ localPath: "/tmp/test.jpg", mimeType: "image/jpeg" }],
        }),
      });

      await vi.waitFor(() => {
        expect(deps.aiAgent.chatStreamWithTools).toHaveBeenCalled();
      });

      const call = (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      const userMsg = call?.messages?.find((m: any) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(Array.isArray(userMsg.content)).toBe(true);
      expect(userMsg.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({ type: "image" }),
        ]),
      );
    });

    it("accepts image-only messages with empty text", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          messageText: "",
          images: [{ localPath: "/tmp/test.jpg", mimeType: "image/jpeg" }],
        }),
      });

      await vi.waitFor(() => {
        expect(deps.aiAgent.chatStreamWithTools).toHaveBeenCalled();
      });
    });

    it("stores image paths in user message metadata", async () => {
      const deps = createMockDeps();
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          messageText: "Describe this",
          images: [{ localPath: "/tmp/photo.png", mimeType: "image/png" }],
        }),
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.appendMessages).toHaveBeenCalled();
      });

      const calls = (deps.sessionManager.appendMessages as any).mock.calls;
      const call = calls[calls.length - 1]?.[0];
      const userMsg = call.messages[0];
      expect(userMsg.metadata).toBeDefined();
      const meta = JSON.parse(userMsg.metadata);
      expect(meta.images).toEqual([{ localPath: "/tmp/photo.png", mimeType: "image/png" }]);
    });

    it("describes images via vision model and sends text-only to main model", async () => {
      const deps = createMockDeps();
      const mockVisionModel = { modelId: "vision-model" } as any;
      const orchestrator = createOrchestrator(deps, { visionModel: mockVisionModel });

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          messageText: "What is this?",
          images: [{ localPath: "/tmp/test.jpg", mimeType: "image/jpeg" }],
        }),
      });

      await vi.waitFor(() => {
        expect(deps.aiAgent.chatStreamWithTools).toHaveBeenCalled();
      });

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({ model: mockVisionModel }),
      );

      const call = (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      expect(call.model).toBeUndefined();

      const userMsg = call?.messages?.find((m: any) => m.role === "user");
      expect(typeof userMsg.content).toBe("string");
      expect(userMsg.content).toContain("What is this?");
      expect(userMsg.content).toContain(
        "[The user attached 1 image to this message. Contents of the image:]",
      );
      expect(userMsg.content).toContain("A detailed description of the image contents.");
    });

    it("does not store image metadata when visionModel describes images", async () => {
      const deps = createMockDeps();
      const mockVisionModel = { modelId: "vision-model" } as any;
      const orchestrator = createOrchestrator(deps, { visionModel: mockVisionModel });

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          messageText: "Describe this",
          images: [{ localPath: "/tmp/photo.png", mimeType: "image/png" }],
        }),
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.appendMessages).toHaveBeenCalled();
      });

      const calls = (deps.sessionManager.appendMessages as any).mock.calls;
      const call = calls[calls.length - 1]?.[0];
      const userMsg = call.messages[0];
      if (userMsg.metadata) {
        const meta = JSON.parse(userMsg.metadata);
        expect(meta.images).toBeUndefined();
      }
    });

    it("describes image-only messages (empty text) via vision model", async () => {
      const deps = createMockDeps();
      const mockVisionModel = { modelId: "vision-model" } as any;
      const orchestrator = createOrchestrator(deps, { visionModel: mockVisionModel });

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          messageText: "",
          images: [{ localPath: "/tmp/test.jpg", mimeType: "image/jpeg" }],
        }),
      });

      await vi.waitFor(() => {
        expect(deps.aiAgent.chatStreamWithTools).toHaveBeenCalled();
      });

      expect(generateText).toHaveBeenCalled();

      const call = (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      const userMsg = call?.messages?.find((m: any) => m.role === "user");
      expect(typeof userMsg.content).toBe("string");
      expect(userMsg.content).toContain(
        "[The user sent 1 image with no accompanying text. Contents of the image:]",
      );
    });

    it("does not call generateText for text-only messages even with visionModel", async () => {
      const deps = createMockDeps();
      const mockVisionModel = { modelId: "vision-model" } as any;
      const orchestrator = createOrchestrator(deps, { visionModel: mockVisionModel });

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "No images here" }),
      });

      await vi.waitFor(() => {
        expect(deps.aiAgent.chatStreamWithTools).toHaveBeenCalled();
      });

      expect(generateText).not.toHaveBeenCalled();
      const call = (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      expect(call.model).toBeUndefined();
    });

    it("sends error reply when agent turn fails", async () => {
      const deps = createMockDeps();

      (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return {
          textStream: (async function* () {
            yield "start";
            throw new Error("AI failed");
          })(),
          fullStream: (async function* () {
            yield { type: "text-delta", id: "1", text: "start" };
            throw new Error("AI failed");
          })(),
          text: Promise.reject(new Error("AI failed")),
        };
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent(),
      });

      await vi.waitFor(
        () => {
          const calls = (deps.adapter.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
          const errorCall = calls.find((c: any) => c[0].text.includes("internal error"));
          expect(errorCall).toBeDefined();
        },
        { timeout: 3000 },
      );
    });
  });

  describe("session title generation", () => {
    it("generates title on first message when titleGenerator is provided", async () => {
      const deps = createMockDeps();
      const titleGenerator = {
        generate: vi.fn(async () => "Debug Postgres Connection"),
      };
      deps.sessionManager.setTitle = vi.fn(async () => {});
      const orchestrator = createOrchestrator(deps, { titleGenerator });

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Help me debug postgres" }),
      });

      await vi.waitFor(() => {
        expect(titleGenerator.generate).toHaveBeenCalledWith({
          userMessage: "Help me debug postgres",
        });
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.setTitle).toHaveBeenCalledWith({
          sessionKey: "test:12345",
          title: "Debug Postgres Connection",
        });
      });
    });

    it("calls adapter.setSessionTitle when available", async () => {
      const deps = createMockDeps();
      const titleGenerator = {
        generate: vi.fn(async () => "Fix API Endpoint"),
      };
      deps.sessionManager.setTitle = vi.fn(async () => {});
      deps.adapter.setSessionTitle = vi.fn(async () => {});
      const orchestrator = createOrchestrator(deps, { titleGenerator });

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Fix my API endpoint", threadId: "999" }),
      });

      await vi.waitFor(() => {
        expect(deps.adapter.setSessionTitle).toHaveBeenCalledWith({
          chatId: "12345",
          threadId: "999",
          title: "Fix API Endpoint",
        });
      });
    });

    it("does not generate title when history is non-empty", async () => {
      const deps = createMockDeps();
      deps.sessionManager.getMessages = vi.fn(async () => [
        { role: "user", content: "previous message" },
        { role: "assistant", content: "previous response" },
      ]);
      const titleGenerator = {
        generate: vi.fn(async () => "Should Not Generate"),
      };
      const orchestrator = createOrchestrator(deps, { titleGenerator });

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Follow up question" }),
      });

      await new Promise((r) => setTimeout(r, 100));
      expect(titleGenerator.generate).not.toHaveBeenCalled();
    });

    it("does not generate title when titleGenerator is not provided", async () => {
      const deps = createMockDeps();
      deps.sessionManager.setTitle = vi.fn(async () => {});
      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({ messageText: "Hello" }),
      });

      await new Promise((r) => setTimeout(r, 100));
      expect(deps.sessionManager.setTitle).not.toHaveBeenCalled();
    });
  });

  describe("cross-thread replies", () => {
    it("uses linked session when replying to a bot message from a different thread context", async () => {
      const deps = createMockDeps();
      (
        deps.messageLinkRepository.findByChatAndMessage as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        platform: "test",
        platformChatId: "12345",
        platformMessageId: "42",
        sessionKey: "test:12345",
        scheduleId: null,
        scheduleRunId: null,
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          threadId: "auto-999",
          replyToMessageId: "42",
          replyToText: "heartbeat alert text",
          messageText: "What is this about?",
        }),
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.getMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            identity: expect.objectContaining({ key: "test:12345" }),
          }),
        );
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.appendMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            identity: expect.objectContaining({
              key: "test:12345",
              scope: "reply-chain",
            }),
          }),
        );
      });
    });

    it("includes reply text in AI messages for cross-thread reply", async () => {
      const deps = createMockDeps();
      (
        deps.messageLinkRepository.findByChatAndMessage as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        platform: "test",
        platformChatId: "12345",
        platformMessageId: "42",
        sessionKey: "test:12345",
        scheduleId: null,
        scheduleRunId: null,
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          threadId: "auto-999",
          replyToMessageId: "42",
          replyToText: "heartbeat alert text",
          messageText: "What is this about?",
        }),
      });

      await vi.waitFor(() => {
        expect(deps.aiAgent.chatStreamWithTools).toHaveBeenCalled();
      });

      const call = (deps.aiAgent.chatStreamWithTools as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      const userMsg = call?.messages?.find((m: any) => m.role === "user");
      expect(userMsg).toBeDefined();
      expect(userMsg.content).toContain("Reply context");
      expect(userMsg.content).toContain("heartbeat alert text");
      expect(userMsg.content).toContain("What is this about?");
    });

    it("falls back to thread-derived session when no message link exists", async () => {
      const deps = createMockDeps();
      (
        deps.messageLinkRepository.findByChatAndMessage as ReturnType<typeof vi.fn>
      ).mockResolvedValue(null);

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          threadId: "auto-999",
          replyToMessageId: "42",
          messageText: "What is this about?",
        }),
      });

      await vi.waitFor(() => {
        expect(deps.sessionManager.getMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            identity: expect.objectContaining({ key: "test:12345:auto-999" }),
          }),
        );
      });
    });

    it("stores message link after replying in the new thread", async () => {
      const deps = createMockDeps();
      (
        deps.messageLinkRepository.findByChatAndMessage as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        platform: "test",
        platformChatId: "12345",
        platformMessageId: "42",
        sessionKey: "test:12345",
        scheduleId: null,
        scheduleRunId: null,
      });

      const orchestrator = createOrchestrator(deps);

      await orchestrator.handleInboundEvent({
        event: makeEvent({
          threadId: "auto-999",
          replyToMessageId: "42",
          replyToText: "heartbeat alert text",
          messageText: "What is this about?",
        }),
      });

      await vi.waitFor(() => {
        expect(deps.messageLinkRepository.upsertMessageLink).toHaveBeenCalledWith(
          expect.objectContaining({
            platform: "test",
            platformChatId: "12345",
            sessionKey: "test:12345",
          }),
        );
      });
    });
  });
});
