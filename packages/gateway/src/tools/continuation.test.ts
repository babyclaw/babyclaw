import { describe, expect, it } from "vitest";
import type { TurnSignals } from "../agent/types.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createContinuationTools } from "./continuation.js";

const context: ToolExecutionContext = {
  workspaceRoot: "/tmp",
  botTimezone: "UTC",
  runSource: "chat",
  isMainSession: false,
};

function makeTurnSignals(): TurnSignals {
  return { continuation: null };
}

describe("createContinuationTools", () => {
  it("returns a tool set containing wait_and_continue", () => {
    const tools = createContinuationTools({
      turnSignals: makeTurnSignals(),
      context,
    });

    expect(tools).toHaveProperty("wait_and_continue");
    expect(tools.wait_and_continue).toHaveProperty("execute");
  });

  describe("wait_and_continue", () => {
    it("writes seconds and note to turnSignals.continuation", async () => {
      const turnSignals = makeTurnSignals();
      const tools = createContinuationTools({ turnSignals, context });

      await (tools.wait_and_continue as any).execute({
        seconds: 30,
        continuation_note: "waiting for build to finish",
      });

      expect(turnSignals.continuation).toEqual({
        seconds: 30,
        note: "waiting for build to finish",
      });
    });

    it("returns ok: true with status and seconds", async () => {
      const turnSignals = makeTurnSignals();
      const tools = createContinuationTools({ turnSignals, context });

      const result = await (tools.wait_and_continue as any).execute({
        seconds: 60,
        continuation_note: "deploying",
      });

      expect(result).toEqual({
        ok: true,
        status: "scheduled",
        seconds: 60,
        message: "Turn will end now. Resuming in 60s.",
      });
    });

    it("overwrites a previous continuation value", async () => {
      const turnSignals = makeTurnSignals();
      turnSignals.continuation = { seconds: 10, note: "old" };

      const tools = createContinuationTools({ turnSignals, context });

      await (tools.wait_and_continue as any).execute({
        seconds: 120,
        continuation_note: "new note",
      });

      expect(turnSignals.continuation).toEqual({
        seconds: 120,
        note: "new note",
      });
    });
  });
});
