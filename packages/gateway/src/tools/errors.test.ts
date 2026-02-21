import { describe, expect, it } from "vitest";
import { ToolExecutionError, toToolErrorPayload, withToolLogging } from "./errors.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";

describe("ToolExecutionError", () => {
  it("sets code, message, and defaults retryable to false", () => {
    const err = new ToolExecutionError({ code: "NOT_FOUND", message: "gone" });
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("gone");
    expect(err.retryable).toBe(false);
    expect(err.hint).toBeUndefined();
  });

  it("accepts retryable and hint", () => {
    const err = new ToolExecutionError({
      code: "RATE_LIMIT",
      message: "slow down",
      retryable: true,
      hint: "wait 5s",
    });
    expect(err.retryable).toBe(true);
    expect(err.hint).toBe("wait 5s");
  });

  it("is an instance of Error", () => {
    const err = new ToolExecutionError({ code: "X", message: "y" });
    expect(err).toBeInstanceOf(Error);
  });
});

describe("toToolErrorPayload", () => {
  it("extracts fields from ToolExecutionError", () => {
    const err = new ToolExecutionError({
      code: "CUSTOM",
      message: "custom msg",
      retryable: true,
      hint: "do X",
    });
    const payload = toToolErrorPayload({ error: err });
    expect(payload).toEqual({
      code: "CUSTOM",
      message: "custom msg",
      retryable: true,
      hint: "do X",
    });
  });

  it("wraps a generic Error with the default code", () => {
    const payload = toToolErrorPayload({ error: new Error("boom") });
    expect(payload).toEqual({
      code: "TOOL_EXECUTION_FAILED",
      message: "boom",
      retryable: false,
    });
  });

  it("uses a custom defaultCode for generic Error", () => {
    const payload = toToolErrorPayload({
      error: new Error("boom"),
      defaultCode: "MY_CODE",
    });
    expect(payload.code).toBe("MY_CODE");
  });

  it("handles non-Error values", () => {
    const payload = toToolErrorPayload({ error: "string error" });
    expect(payload).toEqual({
      code: "TOOL_EXECUTION_FAILED",
      message: "string error",
      retryable: false,
    });
  });

  it("handles null/undefined error values", () => {
    expect(toToolErrorPayload({ error: null }).message).toBe("null");
    expect(toToolErrorPayload({ error: undefined }).message).toBe("undefined");
  });
});

describe("withToolLogging", () => {
  const context: ToolExecutionContext = {
    workspaceRoot: "/tmp",
    botTimezone: "UTC",
    runSource: "chat",
    isMainSession: false,
  };

  it("returns the action result on success", async () => {
    const result = await withToolLogging({
      context,
      toolName: "test",
      action: async () => ({ ok: true as const, data: 42 }),
    });
    expect(result).toEqual({ ok: true, data: 42 });
  });

  it("returns a failure result when the action throws", async () => {
    const result = await withToolLogging({
      context,
      toolName: "test",
      action: async () => {
        throw new Error("broken");
      },
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "TOOL_EXECUTION_FAILED",
        message: "broken",
        retryable: false,
      },
    });
  });

  it("uses the custom defaultCode on failure", async () => {
    const result = await withToolLogging({
      context,
      toolName: "test",
      defaultCode: "CUSTOM_FAIL",
      action: async () => {
        throw new Error("oops");
      },
    });
    if ("error" in result) {
      expect(result.error.code).toBe("CUSTOM_FAIL");
    }
  });
});
