import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateBrowserToolsInput = {
  mcpClient: BrowserMcpClient;
  context: ToolExecutionContext;
};

/**
 * Extract text content from an MCP tool result.
 */
function extractMcpText({ result }: { result: { content: Array<{ type: string; text?: string }>; isError?: boolean } }): string {
  const textParts = result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);

  const text = textParts.join("\n").trim();

  if (result.isError) {
    throw new ToolExecutionError({
      code: "BROWSER_MCP_ERROR",
      message: text || "Browser MCP tool returned an error with no message.",
      retryable: true,
      hint: "The browser tool encountered an error. Check the task and try again.",
    });
  }

  return text;
}

export function createBrowserTools({ mcpClient, context }: CreateBrowserToolsInput): ToolSet {
  /**
   * Shared helper: calls an MCP tool and returns a standardized { ok, data } envelope.
   */
  async function callMcp({ name, args }: { name: string; args: Record<string, unknown> }): Promise<{ ok: true; data: string }> {
    const result = await mcpClient.callTool({ name, arguments: args });
    const text = extractMcpText({ result });
    return { ok: true, data: text } as const;
  }

  return {
    browser_navigate: tool({
      description:
        "Navigate the browser to a specific URL. Returns the page state after navigation.",
      inputSchema: z.object({
        url: z.string().trim().min(1).describe("The URL to navigate to."),
      }),
      execute: async ({ url }) =>
        withToolLogging({
          context,
          toolName: "browser_navigate",
          defaultCode: "BROWSER_NAVIGATE_FAILED",
          input: { url },
          action: () => callMcp({ name: "browser_navigate", args: { url } }),
        }),
    }),

    browser_get_state: tool({
      description:
        "Get the current browser page state including URL, title, and interactive elements with their indices. " +
        "Call this after navigation or interactions to understand what is on the page before clicking or typing.",
      inputSchema: z.object({}),
      execute: async () =>
        withToolLogging({
          context,
          toolName: "browser_get_state",
          defaultCode: "BROWSER_GET_STATE_FAILED",
          action: () => callMcp({ name: "browser_get_state", args: {} }),
        }),
    }),

    browser_click: tool({
      description:
        "Click on an interactive element on the page by its index number. " +
        "Use browser_get_state first to see available elements and their indices.",
      inputSchema: z.object({
        index: z
          .number()
          .int()
          .nonnegative()
          .describe("The index of the element to click, from browser_get_state output."),
      }),
      execute: async ({ index }) =>
        withToolLogging({
          context,
          toolName: "browser_click",
          defaultCode: "BROWSER_CLICK_FAILED",
          input: { index },
          action: () => callMcp({ name: "browser_click", args: { index } }),
        }),
    }),

    browser_type: tool({
      description:
        "Type text into an interactive element on the page. Use browser_get_state to find the target element index first.",
      inputSchema: z.object({
        index: z
          .number()
          .int()
          .nonnegative()
          .describe("The index of the element to type into."),
        text: z.string().describe("The text to type into the element."),
      }),
      execute: async ({ index, text }) =>
        withToolLogging({
          context,
          toolName: "browser_type",
          defaultCode: "BROWSER_TYPE_FAILED",
          input: { index, textLength: text.length },
          action: () => callMcp({ name: "browser_type", args: { index, text } }),
        }),
    }),

    browser_scroll: tool({
      description:
        "Scroll the page up or down. Use direction to specify scroll direction.",
      inputSchema: z.object({
        direction: z
          .enum(["up", "down"])
          .describe("Direction to scroll the page."),
        amount: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Number of pixels to scroll. Defaults to one viewport height."),
      }),
      execute: async ({ direction, amount }) =>
        withToolLogging({
          context,
          toolName: "browser_scroll",
          defaultCode: "BROWSER_SCROLL_FAILED",
          input: { direction, amount },
          action: () =>
            callMcp({
              name: "browser_scroll",
              args: { direction, ...(amount !== undefined ? { amount } : {}) },
            }),
        }),
    }),

    browser_extract_content: tool({
      description:
        "Extract structured text content from the current page. " +
        "Use this to get the main content, article text, or specific information from the page.",
      inputSchema: z.object({
        instruction: z
          .string()
          .trim()
          .min(1)
          .describe("What content to extract from the page (e.g. 'main article text', 'product prices', 'all links')."),
      }),
      execute: async ({ instruction }) =>
        withToolLogging({
          context,
          toolName: "browser_extract_content",
          defaultCode: "BROWSER_EXTRACT_FAILED",
          input: { instruction },
          action: () =>
            callMcp({ name: "browser_extract_content", args: { instruction } }),
        }),
    }),

    browser_go_back: tool({
      description: "Navigate back to the previous page in browser history.",
      inputSchema: z.object({}),
      execute: async () =>
        withToolLogging({
          context,
          toolName: "browser_go_back",
          defaultCode: "BROWSER_GO_BACK_FAILED",
          action: () => callMcp({ name: "browser_go_back", args: {} }),
        }),
    }),

    // ─── Session management ────────────────────────────────────────────

    browser_list_sessions: tool({
      description:
        "List all active browser sessions. Each session represents an open browser instance.",
      inputSchema: z.object({}),
      execute: async () =>
        withToolLogging({
          context,
          toolName: "browser_list_sessions",
          defaultCode: "BROWSER_LIST_SESSIONS_FAILED",
          action: () => callMcp({ name: "browser_list_sessions", args: {} }),
        }),
    }),

    browser_close_session: tool({
      description:
        "Close a specific browser session by its ID. Use browser_list_sessions to find session IDs.",
      inputSchema: z.object({
        session_id: z
          .string()
          .trim()
          .min(1)
          .describe("The ID of the browser session to close."),
      }),
      execute: async ({ session_id }) =>
        withToolLogging({
          context,
          toolName: "browser_close_session",
          defaultCode: "BROWSER_CLOSE_SESSION_FAILED",
          input: { session_id },
          action: () =>
            callMcp({ name: "browser_close_session", args: { session_id } }),
        }),
    }),
  };
}
