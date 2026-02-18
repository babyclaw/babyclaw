import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { TurnSignals } from "../agent/types.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { withToolLogging } from "./errors.js";

type CreateContinuationToolsInput = {
  turnSignals: TurnSignals;
  context: ToolExecutionContext;
};

export function createContinuationTools({
  turnSignals,
  context,
}: CreateContinuationToolsInput): ToolSet {
  return {
    wait_and_continue: tool({
      description: [
        "End your current turn and automatically resume after a delay.",
        "Use when you started a long-running process (build, deployment, script, coding agent) and need to check back later.",
        "Write a thorough continuation_note including: what you did so far, what you are waiting for, and what to do when you resume.",
        "Your continuation_note is the only context your future self will receive beyond conversation history, so be specific.",
        "For waits longer than 10 minutes, use create_schedule instead.",
      ].join(" "),
      inputSchema: z.object({
        seconds: z
          .number()
          .int()
          .min(5)
          .max(600)
          .describe("How many seconds to wait before resuming (5-600)."),
        continuation_note: z
          .string()
          .trim()
          .min(1)
          .max(2000)
          .describe(
            "A detailed note for your future self: what you did, what you are waiting for, and what to do next.",
          ),
      }),
      execute: async ({ seconds, continuation_note }) =>
        withToolLogging({
          context,
          toolName: "wait_and_continue",
          defaultCode: "WAIT_FAILED",
          input: { seconds, noteLength: continuation_note.length },
          action: async () => {
            turnSignals.continuation = {
              seconds,
              note: continuation_note,
            };

            return {
              ok: true,
              status: "scheduled",
              seconds,
              message: `Turn will end now. Resuming in ${seconds}s.`,
            } as const;
          },
        }),
    }),
  };
}
