import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContinuationManager } from "./continuation.js";

describe("ContinuationManager", () => {
  let manager: ContinuationManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ContinuationManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("schedule", () => {
    it("calls onResume after the specified delay", () => {
      const onResume = vi.fn();
      manager.schedule({ sessionKey: "s1", delayMs: 5000, onResume });

      expect(onResume).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4999);
      expect(onResume).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onResume).toHaveBeenCalledOnce();
    });

    it("removes the entry after the timer fires", () => {
      const onResume = vi.fn();
      manager.schedule({ sessionKey: "s1", delayMs: 1000, onResume });

      expect(manager.hasPending({ sessionKey: "s1" })).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(manager.hasPending({ sessionKey: "s1" })).toBe(false);
    });

    it("cancels a previous timer when rescheduling the same session key", () => {
      const onResume1 = vi.fn();
      const onResume2 = vi.fn();

      manager.schedule({ sessionKey: "s1", delayMs: 5000, onResume: onResume1 });
      manager.schedule({ sessionKey: "s1", delayMs: 3000, onResume: onResume2 });

      vi.advanceTimersByTime(5000);
      expect(onResume1).not.toHaveBeenCalled();
      expect(onResume2).toHaveBeenCalledOnce();
    });

    it("manages independent timers for different session keys", () => {
      const onResume1 = vi.fn();
      const onResume2 = vi.fn();

      manager.schedule({ sessionKey: "s1", delayMs: 1000, onResume: onResume1 });
      manager.schedule({ sessionKey: "s2", delayMs: 2000, onResume: onResume2 });

      vi.advanceTimersByTime(1000);
      expect(onResume1).toHaveBeenCalledOnce();
      expect(onResume2).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);
      expect(onResume2).toHaveBeenCalledOnce();
    });
  });

  describe("cancel", () => {
    it("returns true and prevents onResume when a pending entry exists", () => {
      const onResume = vi.fn();
      manager.schedule({ sessionKey: "s1", delayMs: 5000, onResume });

      const result = manager.cancel({ sessionKey: "s1" });

      expect(result).toBe(true);
      expect(manager.hasPending({ sessionKey: "s1" })).toBe(false);

      vi.advanceTimersByTime(10000);
      expect(onResume).not.toHaveBeenCalled();
    });

    it("returns false when no pending entry exists", () => {
      const result = manager.cancel({ sessionKey: "nonexistent" });
      expect(result).toBe(false);
    });

    it("returns false on second cancel for the same key", () => {
      const onResume = vi.fn();
      manager.schedule({ sessionKey: "s1", delayMs: 5000, onResume });

      expect(manager.cancel({ sessionKey: "s1" })).toBe(true);
      expect(manager.cancel({ sessionKey: "s1" })).toBe(false);
    });
  });

  describe("hasPending", () => {
    it("returns false when nothing is scheduled", () => {
      expect(manager.hasPending({ sessionKey: "s1" })).toBe(false);
    });

    it("returns true while a timer is pending", () => {
      manager.schedule({ sessionKey: "s1", delayMs: 5000, onResume: vi.fn() });
      expect(manager.hasPending({ sessionKey: "s1" })).toBe(true);
    });

    it("returns false after the timer has fired", () => {
      manager.schedule({ sessionKey: "s1", delayMs: 1000, onResume: vi.fn() });
      vi.advanceTimersByTime(1000);
      expect(manager.hasPending({ sessionKey: "s1" })).toBe(false);
    });

    it("returns false after cancellation", () => {
      manager.schedule({ sessionKey: "s1", delayMs: 5000, onResume: vi.fn() });
      manager.cancel({ sessionKey: "s1" });
      expect(manager.hasPending({ sessionKey: "s1" })).toBe(false);
    });
  });
});
