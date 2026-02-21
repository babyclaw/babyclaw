import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryExtractor } from "./extractor.js";

function createMockAiAgent() {
  return {
    chat: vi.fn(async () => ""),
  } as unknown as import("../ai/agent.js").AiAgent;
}

const SESSION_DATE = new Date("2026-02-19T12:00:00Z");
const SESSION_DATE_STR = "2026-02-19";

function extractCall(args: {
  sessionDate?: Date;
  messages?: Array<{ role: string; content: string }>;
}) {
  return { sessionDate: SESSION_DATE, ...args };
}

describe("MemoryExtractor", () => {
  let workspacePath: string;
  let aiAgent: ReturnType<typeof createMockAiAgent>;
  let extractor: MemoryExtractor;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "mem-test-"));
    aiAgent = createMockAiAgent();
    extractor = new MemoryExtractor({ aiAgent, workspacePath });
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("does nothing when messages array is empty", async () => {
    await extractor.extract(extractCall({ messages: [] }));

    expect(aiAgent.chat).not.toHaveBeenCalled();
  });

  it("does nothing when all messages are system role", async () => {
    await extractor.extract(
      extractCall({
        messages: [{ role: "system", content: "You are helpful." }],
      }),
    );

    expect(aiAgent.chat).not.toHaveBeenCalled();
  });

  it("formats transcript with User/Assistant labels", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("- User likes cats");

    await extractor.extract(
      extractCall({
        messages: [
          { role: "user", content: "I love cats" },
          { role: "assistant", content: "That's great!" },
        ],
      }),
    );

    expect(aiAgent.chat).toHaveBeenCalledOnce();
    const callArgs = (aiAgent.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userPrompt = callArgs.messages[1].content as string;
    expect(userPrompt).toContain("User: I love cats");
    expect(userPrompt).toContain("Assistant: That's great!");
  });

  it("wraps transcript in XML tags", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("NOTHING_TO_EXTRACT");

    await extractor.extract(
      extractCall({
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    const callArgs = (aiAgent.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userPrompt = callArgs.messages[1].content as string;
    expect(userPrompt).toContain("<conversation_transcript>");
    expect(userPrompt).toContain("</conversation_transcript>");
  });

  it("uses sessionDate for the memory file name", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("- Important memory");

    const pastDate = new Date("2025-03-15T10:00:00Z");

    await extractor.extract({
      messages: [{ role: "user", content: "something important" }],
      sessionDate: pastDate,
    });

    const filePath = join(workspacePath, "memory", "2025-03-15.md");
    const content = await readFile(filePath, "utf8");
    expect(content).toContain("# Memories - 2025-03-15");
    expect(content).toContain("- Important memory");
  });

  it("creates memory file with header when none exists", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      "- User prefers TypeScript over JavaScript",
    );

    await extractor.extract(
      extractCall({
        messages: [
          { role: "user", content: "I prefer TypeScript" },
          { role: "assistant", content: "Noted!" },
        ],
      }),
    );

    const filePath = join(workspacePath, "memory", `${SESSION_DATE_STR}.md`);
    const content = await readFile(filePath, "utf8");

    expect(content).toContain(`# Memories - ${SESSION_DATE_STR}`);
    expect(content).toContain("- User prefers TypeScript over JavaScript");
  });

  it("appends to existing memory file without duplicating header", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const memoryDir = join(workspacePath, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      join(memoryDir, `${SESSION_DATE_STR}.md`),
      `# Memories - ${SESSION_DATE_STR}\n\n- Existing memory\n`,
      "utf8",
    );

    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue(
      "- New memory about project deadline",
    );

    await extractor.extract(
      extractCall({
        messages: [
          { role: "user", content: "The deadline is Friday" },
          { role: "assistant", content: "Got it!" },
        ],
      }),
    );

    const filePath = join(memoryDir, `${SESSION_DATE_STR}.md`);
    const content = await readFile(filePath, "utf8");

    expect(content).toContain("- Existing memory");
    expect(content).toContain("- New memory about project deadline");
    const headerCount = (content.match(/# Memories/g) ?? []).length;
    expect(headerCount).toBe(1);
  });

  it("includes existing memories in prompt so AI can avoid duplicates", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const memoryDir = join(workspacePath, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, `${SESSION_DATE_STR}.md`), "- Already known fact\n", "utf8");

    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("NOTHING_TO_EXTRACT");

    await extractor.extract(
      extractCall({
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    const callArgs = (aiAgent.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userPrompt = callArgs.messages[1].content as string;
    expect(userPrompt).toContain("<existing_memories_today>");
    expect(userPrompt).toContain("- Already known fact");
    expect(userPrompt).toContain("</existing_memories_today>");
  });

  it("does not write file when AI returns NOTHING_TO_EXTRACT", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("NOTHING_TO_EXTRACT");

    await extractor.extract(
      extractCall({
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
        ],
      }),
    );

    const filePath = join(workspacePath, "memory", `${SESSION_DATE_STR}.md`);
    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("does not write file when AI returns empty string", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("   ");

    await extractor.extract(
      extractCall({
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
        ],
      }),
    );

    const filePath = join(workspacePath, "memory", `${SESSION_DATE_STR}.md`);
    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("filters out system messages from the transcript", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("NOTHING_TO_EXTRACT");

    await extractor.extract(
      extractCall({
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi there" },
        ],
      }),
    );

    const callArgs = (aiAgent.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userPrompt = callArgs.messages[1].content as string;
    expect(userPrompt).not.toContain("You are a helpful assistant");
    expect(userPrompt).toContain("User: hello");
    expect(userPrompt).toContain("Assistant: hi there");
  });

  it("sends the extraction system prompt", async () => {
    (aiAgent.chat as ReturnType<typeof vi.fn>).mockResolvedValue("NOTHING_TO_EXTRACT");

    await extractor.extract(
      extractCall({
        messages: [{ role: "user", content: "test" }],
      }),
    );

    const callArgs = (aiAgent.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemPrompt = callArgs.messages[0].content as string;
    expect(systemPrompt).toContain("memory extraction system");
    expect(systemPrompt).toContain("NOTHING_TO_EXTRACT");
  });
});
