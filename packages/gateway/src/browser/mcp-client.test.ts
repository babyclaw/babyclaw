import { describe, expect, it } from "vitest";
import { buildBrowserMcpEnv } from "./mcp-client.js";

describe("buildBrowserMcpEnv", () => {
  it("maps configured model, API key, and base URL into browser MCP env", () => {
    const env = buildBrowserMcpEnv({
      baseEnv: {
        PATH: "/usr/bin",
      },
      config: {
        llmApiKey: "secret-key",
        llmBaseUrl: "https://gateway.example.com/v1",
        llmModel: "anthropic/claude-opus-4.6",
        headless: true,
      },
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.OPENAI_API_KEY).toBe("secret-key");
    expect(env.OPENAI_MODEL).toBe("anthropic/claude-opus-4.6");
    expect(env.BROWSER_USE_LLM_MODEL).toBe("anthropic/claude-opus-4.6");
    expect(env.OPENAI_API_BASE).toBe("https://gateway.example.com/v1");
    expect(env.OPENAI_BASE_URL).toBe("https://gateway.example.com/v1");
    expect(env.BROWSER_USE_HEADLESS).toBe("true");
  });

  it("does not force headless when explicitly disabled", () => {
    const env = buildBrowserMcpEnv({
      baseEnv: {},
      config: {
        llmApiKey: "secret-key",
        llmModel: "anthropic/claude-opus-4.6",
        headless: false,
      },
    });

    expect(env.BROWSER_USE_HEADLESS).toBeUndefined();
  });
});
