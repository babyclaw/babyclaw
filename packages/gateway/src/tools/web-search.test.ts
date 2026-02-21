import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createWebSearchTools } from "./web-search.js";

const CONTEXT: ToolExecutionContext = {
  workspaceRoot: "/tmp",
  botTimezone: "UTC",
  runSource: "chat",
  isMainSession: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createWebSearchTools", () => {
  it("returns BRAVE_API_KEY_MISSING when braveApiKey is not configured", async () => {
    const tools = createWebSearchTools({
      context: CONTEXT,
      braveApiKey: null,
    });

    const result = await (tools.web_search as any).execute({
      query: "babyclaw",
      count: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("BRAVE_API_KEY_MISSING");
  });

  it("uses braveApiKey provided via config injection", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "BabyClaw",
                  url: "https://example.com",
                  description: "A result",
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const tools = createWebSearchTools({
      context: CONTEXT,
      braveApiKey: "from-config",
    });

    const result = await (tools.web_search as any).execute({
      query: "babyclaw",
      count: 1,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "from-config",
        }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.result_count).toBe(1);
  });
});
