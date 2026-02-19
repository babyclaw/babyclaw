import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SessionManager } from "../session/manager.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { withToolLogging } from "./errors.js";

type CreateWorkingMemoryToolsInput = {
  sessionManager: SessionManager;
  sessionKey: string;
  context: ToolExecutionContext;
};

export function createWorkingMemoryTools({
  sessionManager,
  sessionKey,
  context,
}: CreateWorkingMemoryToolsInput): ToolSet {
  return {
    update_working_memory: tool({
      description: [
        "Save important ephemeral information for this session to your working memory.",
        "Use this proactively to note tmux/screen session names, temporary file paths, URLs, port numbers,",
        "container IDs, branch names, intermediate results, or anything needed to complete the task efficiently.",
        "Each call replaces the full working memory content, so always include everything you want to retain.",
      ].join(" "),
      inputSchema: z.object({
        content: z
          .string()
          .trim()
          .min(1)
          .max(10000)
          .describe("The full working memory content. Replaces any previous content."),
      }),
      execute: async ({ content }) =>
        withToolLogging({
          context,
          toolName: "update_working_memory",
          defaultCode: "WORKING_MEMORY_UPDATE_FAILED",
          input: { contentLength: content.length },
          action: async () => {
            await sessionManager.updateWorkingMemory({ sessionKey, content });
            return { ok: true } as const;
          },
        }),
    }),
  };
}
