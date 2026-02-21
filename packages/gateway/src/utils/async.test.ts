import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wait } from "./async.js";

describe("wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the specified duration", async () => {
    const promise = wait({ ms: 500 });
    vi.advanceTimersByTime(500);
    await expect(promise).resolves.toBeUndefined();
  });

  it("does not resolve before the specified duration", async () => {
    let resolved = false;
    const promise = wait({ ms: 1000 }).then(() => {
      resolved = true;
    });

    vi.advanceTimersByTime(999);
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1);
    await promise;
    expect(resolved).toBe(true);
  });

  it("resolves immediately with ms=0", async () => {
    const promise = wait({ ms: 0 });
    vi.advanceTimersByTime(0);
    await expect(promise).resolves.toBeUndefined();
  });
});
