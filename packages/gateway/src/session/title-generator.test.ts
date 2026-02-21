import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(async () => ({ text: "Debug Postgres Connection" })),
  };
});

const { generateText } = await import("ai");
const { SessionTitleGenerator } = await import("./title-generator.js");

describe("SessionTitleGenerator", () => {
  beforeEach(() => {
    vi.mocked(generateText).mockReset();
    vi.mocked(generateText).mockResolvedValue({ text: "Debug Postgres Connection" } as any);
  });

  it("generates a title from user message", async () => {
    const generator = new SessionTitleGenerator({ model: {} as any });
    const title = await generator.generate({
      userMessage: "I need help debugging my postgres connection",
    });

    expect(title).toBe("Debug Postgres Connection");
    expect(generateText).toHaveBeenCalledOnce();
    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.messages).toHaveLength(2);
    expect(call.messages![0]).toEqual({
      role: "system",
      content: expect.stringContaining("4-5 word title"),
    });
    expect(call.messages![1]).toEqual({
      role: "user",
      content: "I need help debugging my postgres connection",
    });
  });

  it("uses custom prompt when provided", async () => {
    const customPrompt = "Summarize in 3 words.";
    const generator = new SessionTitleGenerator({ model: {} as any, prompt: customPrompt });
    await generator.generate({ userMessage: "test" });

    const call = vi.mocked(generateText).mock.calls[0][0];
    expect(call.messages![0]).toEqual({ role: "system", content: customPrompt });
  });

  it("truncates titles exceeding max length", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "A".repeat(100),
    } as any);

    const generator = new SessionTitleGenerator({ model: {} as any });
    const title = await generator.generate({ userMessage: "test" });

    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("trims whitespace from generated titles", async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "  Some Title  \n",
    } as any);

    const generator = new SessionTitleGenerator({ model: {} as any });
    const title = await generator.generate({ userMessage: "test" });

    expect(title).toBe("Some Title");
  });
});
