import { stat } from "node:fs/promises";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ChannelSender, FileType } from "../channel/types.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { resolveWorkspacePath } from "../utils/path.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateMediaToolsInput = {
  channelSender: ChannelSender;
  executionContext: ToolExecutionContext;
};

const FILE_TYPES = ["image", "document", "audio", "video", "animation"] as const;

export function createMediaTools({
  channelSender,
  executionContext,
}: CreateMediaToolsInput): ToolSet {
  return {
    send_file: tool({
      description:
        "Send a file from the workspace to the current chat. Supports image, document, audio, video, and animation types. The channel decides whether it can handle the given type.",
      inputSchema: z.object({
        path: z.string().trim().min(1).describe("File path relative to the workspace root"),
        type: z
          .enum(FILE_TYPES)
          .describe("File type hint so the channel picks the right delivery method"),
        caption: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Optional caption sent alongside the file"),
      }),
      execute: async ({ path, type, caption }) =>
        withToolLogging({
          context: executionContext,
          toolName: "send_file",
          defaultCode: "SEND_FILE_FAILED",
          input: { path, type, hasCaption: caption !== undefined },
          action: async () => {
            if (!executionContext.chatId) {
              throw new ToolExecutionError({
                code: "NO_CHAT_CONTEXT",
                message: "send_file requires a chat context.",
              });
            }

            const absolutePath = resolveWorkspacePath({
              workspaceRoot: executionContext.workspaceRoot,
              requestedPath: path,
            });

            try {
              await stat(absolutePath);
            } catch {
              throw new ToolExecutionError({
                code: "FILE_NOT_FOUND",
                message: `File not found: ${path}`,
              });
            }

            const result = await channelSender.sendFile({
              chatId: executionContext.chatId,
              threadId: executionContext.threadId,
              filePath: absolutePath,
              fileType: type as FileType,
              caption,
            });

            return {
              ok: true,
              platform_message_id: result.platformMessageId,
            } as const;
          },
        }),
    }),
  };
}
