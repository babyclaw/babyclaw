import { describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createMediaTools } from "./media.js";

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(async (path: string) => {
    if (path.includes("nonexistent")) {
      throw new Error("ENOENT: no such file or directory");
    }
    return { isFile: () => true, size: 1024 };
  }),
}));

function toolOptions() {
  return { messages: [] as any[], toolCallId: "1", abortSignal: new AbortController().signal };
}

function createMocks(contextOverrides: Partial<ToolExecutionContext> = {}) {
  const channelSender = {
    platform: "telegram",
    sendMessage: vi.fn(),
    sendImage: vi.fn(),
    sendFile: vi.fn(async () => ({
      platformMessageId: "99",
    })),
  } as any;

  const executionContext: ToolExecutionContext = {
    workspaceRoot: "/tmp",
    botTimezone: "UTC",
    runSource: "chat",
    isMainSession: true,
    chatId: "chat-42",
    ...contextOverrides,
  };

  return { channelSender, executionContext };
}

describe("createMediaTools", () => {
  describe("send_file", () => {
    it("sends an image file and returns ok", async () => {
      const { channelSender, executionContext } = createMocks();
      const tools = createMediaTools({ channelSender, executionContext });

      const result = await tools.send_file.execute!(
        { path: "photo.jpg", type: "image" },
        toolOptions(),
      );

      expect(channelSender.sendFile).toHaveBeenCalledWith({
        chatId: "chat-42",
        threadId: undefined,
        filePath: "/tmp/photo.jpg",
        fileType: "image",
        caption: undefined,
      });
      expect(result).toMatchObject({ ok: true, platform_message_id: "99" });
    });

    it.each(["document", "audio", "video", "animation"] as const)(
      "sends a %s file",
      async (type) => {
        const { channelSender, executionContext } = createMocks();
        const tools = createMediaTools({ channelSender, executionContext });

        const result = await tools.send_file.execute!(
          { path: `file.${type}`, type },
          toolOptions(),
        );

        expect(channelSender.sendFile).toHaveBeenCalledWith(
          expect.objectContaining({ fileType: type }),
        );
        expect(result).toMatchObject({ ok: true });
      },
    );

    it("forwards caption to the channel sender", async () => {
      const { channelSender, executionContext } = createMocks();
      const tools = createMediaTools({ channelSender, executionContext });

      await tools.send_file.execute!(
        { path: "photo.jpg", type: "image", caption: "Look at this!" },
        toolOptions(),
      );

      expect(channelSender.sendFile).toHaveBeenCalledWith(
        expect.objectContaining({ caption: "Look at this!" }),
      );
    });

    it("forwards threadId from execution context", async () => {
      const { channelSender, executionContext } = createMocks({ threadId: "topic-7" });
      const tools = createMediaTools({ channelSender, executionContext });

      await tools.send_file.execute!({ path: "photo.jpg", type: "image" }, toolOptions());

      expect(channelSender.sendFile).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "topic-7" }),
      );
    });

    it("rejects when chatId is missing from execution context", async () => {
      const { channelSender, executionContext } = createMocks({ chatId: undefined });
      const tools = createMediaTools({ channelSender, executionContext });

      const result: any = await tools.send_file.execute!(
        { path: "photo.jpg", type: "image" },
        toolOptions(),
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("NO_CHAT_CONTEXT");
      expect(channelSender.sendFile).not.toHaveBeenCalled();
    });

    it("rejects when the file does not exist", async () => {
      const { channelSender, executionContext } = createMocks();
      const tools = createMediaTools({ channelSender, executionContext });

      const result: any = await tools.send_file.execute!(
        { path: "nonexistent.jpg", type: "image" },
        toolOptions(),
      );

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("FILE_NOT_FOUND");
      expect(channelSender.sendFile).not.toHaveBeenCalled();
    });

    it("rejects when the path escapes workspace root", async () => {
      const { channelSender, executionContext } = createMocks();
      const tools = createMediaTools({ channelSender, executionContext });

      const result: any = await tools.send_file.execute!(
        { path: "../../etc/passwd", type: "document" },
        toolOptions(),
      );

      expect(result.ok).toBe(false);
      expect(channelSender.sendFile).not.toHaveBeenCalled();
    });

    it("returns error when channel throws (unsupported type)", async () => {
      const { channelSender, executionContext } = createMocks();
      channelSender.sendFile.mockRejectedValue(new Error("Unsupported file type: animation"));
      const tools = createMediaTools({ channelSender, executionContext });

      const result: any = await tools.send_file.execute!(
        { path: "photo.jpg", type: "animation" },
        toolOptions(),
      );

      expect(result.ok).toBe(false);
      expect(result.error.message).toContain("Unsupported file type");
    });
  });
});
