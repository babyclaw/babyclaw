import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryExtractionQueue } from "./queue.js";

function createMockExtractor() {
  return {
    extract: vi.fn(async () => {}),
  } as unknown as import("./extractor.js").MemoryExtractor;
}

function createMockSessionManager() {
  return {
    getRawMessages: vi.fn(async () => ({
      sessionCreatedAt: new Date("2026-02-19T12:00:00Z"),
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    })),
    updateMemoriesExtractedAt: vi.fn(async () => {}),
  } as unknown as import("../session/manager.js").SessionManager;
}

describe("MemoryExtractionQueue", () => {
  let extractor: ReturnType<typeof createMockExtractor>;
  let sessionManager: ReturnType<typeof createMockSessionManager>;
  let queue: MemoryExtractionQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    extractor = createMockExtractor();
    sessionManager = createMockSessionManager();
    queue = new MemoryExtractionQueue({ extractor, sessionManager });
  });

  afterEach(() => {
    queue.stop();
    vi.useRealTimers();
  });

  describe("enqueue (debounced)", () => {
    it("does not process immediately", () => {
      queue.enqueue({ sessionKey: "s1" });

      expect(extractor.extract).not.toHaveBeenCalled();
    });

    it("processes after the 5-minute debounce", async () => {
      queue.enqueue({ sessionKey: "s1" });

      vi.advanceTimersByTime(5 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(sessionManager.getRawMessages).toHaveBeenCalledWith({
        sessionKey: "s1",
      });
      expect(extractor.extract).toHaveBeenCalledOnce();
    });

    it("resets the debounce timer on repeated enqueue", async () => {
      queue.enqueue({ sessionKey: "s1" });

      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(extractor.extract).not.toHaveBeenCalled();

      queue.enqueue({ sessionKey: "s1" });

      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(extractor.extract).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(extractor.extract).toHaveBeenCalledOnce();
    });

    it("manages independent debounce timers for different keys", async () => {
      queue.enqueue({ sessionKey: "s1" });
      vi.advanceTimersByTime(2 * 60 * 1000);
      queue.enqueue({ sessionKey: "s2" });

      vi.advanceTimersByTime(3 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(sessionManager.getRawMessages).toHaveBeenCalledWith({
        sessionKey: "s1",
      });

      vi.advanceTimersByTime(2 * 60 * 1000);
      await vi.runAllTimersAsync();

      expect(sessionManager.getRawMessages).toHaveBeenCalledWith({
        sessionKey: "s2",
      });
    });
  });

  describe("enqueueImmediate", () => {
    it("processes without debounce", async () => {
      queue.enqueueImmediate({ sessionKey: "s1" });

      await vi.runAllTimersAsync();

      expect(extractor.extract).toHaveBeenCalledOnce();
      expect(sessionManager.updateMemoriesExtractedAt).toHaveBeenCalledWith({
        sessionKey: "s1",
      });
    });

    it("deduplicates if same key already pending behind another", async () => {
      let resolveFirst: () => void;
      const firstBlocks = new Promise<void>((r) => { resolveFirst = r; });

      (sessionManager.getRawMessages as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async () => {
          await firstBlocks;
          return [{ role: "user", content: "msg" }];
        });

      queue.enqueueImmediate({ sessionKey: "s1" });
      queue.enqueueImmediate({ sessionKey: "s2" });
      queue.enqueueImmediate({ sessionKey: "s2" });

      resolveFirst!();
      await vi.runAllTimersAsync();

      const s2Calls = (sessionManager.getRawMessages as ReturnType<typeof vi.fn>)
        .mock.calls.filter((c: Array<{ sessionKey: string }>) => c[0].sessionKey === "s2");
      expect(s2Calls).toHaveLength(1);
    });
  });

  describe("serial processing", () => {
    it("processes multiple sessions sequentially", async () => {
      const order: string[] = [];
      (extractor.extract as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          const key = (sessionManager.getRawMessages as ReturnType<typeof vi.fn>)
            .mock.lastCall?.[0]?.sessionKey;
          order.push(key);
        },
      );

      (sessionManager.getRawMessages as ReturnType<typeof vi.fn>)
        .mockImplementation(async ({ sessionKey }: { sessionKey: string }) => ({
          sessionCreatedAt: new Date("2026-02-19T12:00:00Z"),
          messages: [{ role: "user", content: `msg from ${sessionKey}` }],
        }));

      queue.enqueueImmediate({ sessionKey: "s1" });
      queue.enqueueImmediate({ sessionKey: "s2" });
      queue.enqueueImmediate({ sessionKey: "s3" });

      await vi.runAllTimersAsync();

      expect(extractor.extract).toHaveBeenCalledTimes(3);
    });
  });

  describe("skip empty sessions", () => {
    it("does not call extract when session has no messages", async () => {
      (sessionManager.getRawMessages as ReturnType<typeof vi.fn>).mockResolvedValue(
        { sessionCreatedAt: new Date(), messages: [] },
      );

      queue.enqueueImmediate({ sessionKey: "s1" });
      await vi.runAllTimersAsync();

      expect(extractor.extract).not.toHaveBeenCalled();
      expect(
        sessionManager.updateMemoriesExtractedAt,
      ).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("prevents debounced items from firing", () => {
      queue.enqueue({ sessionKey: "s1" });
      queue.stop();

      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(extractor.extract).not.toHaveBeenCalled();
    });

    it("prevents immediate items from processing after stop", async () => {
      queue.stop();
      queue.enqueueImmediate({ sessionKey: "s1" });

      await vi.runAllTimersAsync();

      expect(extractor.extract).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("continues processing next session after extraction error", async () => {
      let callCount = 0;
      (extractor.extract as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          callCount++;
          if (callCount === 1) throw new Error("AI failed");
        },
      );

      queue.enqueueImmediate({ sessionKey: "s1" });
      queue.enqueueImmediate({ sessionKey: "s2" });

      await vi.runAllTimersAsync();

      expect(extractor.extract).toHaveBeenCalledTimes(2);
      expect(sessionManager.updateMemoriesExtractedAt).toHaveBeenCalledTimes(1);
      expect(sessionManager.updateMemoriesExtractedAt).toHaveBeenCalledWith({
        sessionKey: "s2",
      });
    });
  });

  describe("updates memoriesLastExtractedAt", () => {
    it("calls updateMemoriesExtractedAt after successful extraction", async () => {
      queue.enqueueImmediate({ sessionKey: "s1" });
      await vi.runAllTimersAsync();

      expect(sessionManager.updateMemoriesExtractedAt).toHaveBeenCalledWith({
        sessionKey: "s1",
      });
    });
  });
});
