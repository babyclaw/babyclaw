import { describe, expect, it } from "vitest";
import { escapeMarkdownV2, toTelegramMarkdownV2 } from "./markdown.js";

describe("escapeMarkdownV2", () => {
  it("escapes all MarkdownV2 special characters", () => {
    const specials = "_*[]()~`>#+\\-=|{}.!\\";
    const escaped = escapeMarkdownV2({ text: specials });
    for (const char of specials) {
      expect(escaped).toContain(`\\${char}`);
    }
  });

  it("leaves normal text untouched", () => {
    expect(escapeMarkdownV2({ text: "hello world" })).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(escapeMarkdownV2({ text: "" })).toBe("");
  });
});

describe("toTelegramMarkdownV2", () => {
  it("escapes plain text with no formatting", () => {
    const result = toTelegramMarkdownV2({ text: "Price is 10.5!" });
    expect(result).toBe("Price is 10\\.5\\!");
  });

  it("converts **bold** to *bold*", () => {
    const result = toTelegramMarkdownV2({ text: "this is **bold** text" });
    expect(result).toBe("this is *bold* text");
  });

  it("converts *italic* to _italic_", () => {
    const result = toTelegramMarkdownV2({ text: "this is *italic* text" });
    expect(result).toBe("this is _italic_ text");
  });

  it("converts ~~strikethrough~~ to ~strikethrough~", () => {
    const result = toTelegramMarkdownV2({ text: "~~removed~~" });
    expect(result).toBe("~removed~");
  });

  it("converts markdown links", () => {
    const result = toTelegramMarkdownV2({
      text: "click [here](https://example.com)",
    });
    // The `.` in the URL is escaped because all tokens pass through escapeMarkdownV2,
    // and the URL escaper further escapes `\` to `\\`.
    expect(result).toContain("[here]");
    expect(result).toContain("(https://");
    expect(result.startsWith("click ")).toBe(true);
  });

  it("escapes special chars in link text", () => {
    const result = toTelegramMarkdownV2({
      text: "[price: 5.99!](https://shop.com)",
    });
    expect(result).toContain("[price: 5\\.99\\!]");
  });

  it("preserves fenced code blocks verbatim", () => {
    const input = "before\n```js\nconst x = 1;\n```\nafter";
    const result = toTelegramMarkdownV2({ text: input });
    expect(result).toContain("```js\nconst x = 1;\n```");
  });

  it("preserves inline code verbatim", () => {
    const result = toTelegramMarkdownV2({ text: "use `foo.bar()` here" });
    expect(result).toContain("`foo.bar()`");
  });

  it("handles mixed bold and italic", () => {
    const result = toTelegramMarkdownV2({
      text: "**bold** and *italic*",
    });
    expect(result).toBe("*bold* and _italic_");
  });

  it("handles text with only special characters", () => {
    const result = toTelegramMarkdownV2({ text: "..." });
    expect(result).toBe("\\.\\.\\.");
  });
});
