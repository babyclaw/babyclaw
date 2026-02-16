import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { MAX_TOOL_PAYLOAD_BYTES } from "../utils/payload.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateWebSearchToolsInput = {
  context: ToolExecutionContext;
  braveApiKey: string | null;
};

const BRAVE_SEARCH_ENDPOINT =
  "https://api.search.brave.com/res/v1/web/search";

const MAX_COUNT = 20;
const DEFAULT_COUNT = 5;

type BraveWebResult = {
  title: string;
  url: string;
  description: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveWebResult[];
  };
  query?: {
    altered?: string;
  };
};

export function createWebSearchTools({
  context,
  braveApiKey,
}: CreateWebSearchToolsInput): ToolSet {
  return {
    web_search: tool({
      description:
        "Search the web using Brave Search. Returns titles, URLs, descriptions, and ages for each result. Use this to find current information, look up documentation, research topics, or verify facts.",
      inputSchema: z.object({
        query: z.string().trim().min(1).describe("The search query"),
        count: z
          .number()
          .int()
          .positive()
          .max(MAX_COUNT)
          .optional()
          .default(DEFAULT_COUNT)
          .describe("Number of results to return (default 5, max 20)"),
        freshness: z
          .enum(["pd", "pw", "pm", "py"])
          .optional()
          .describe(
            "Filter by freshness: pd = past day, pw = past week, pm = past month, py = past year",
          ),
      }),
      execute: async ({ query, count, freshness }) =>
        withToolLogging({
          context,
          toolName: "web_search",
          defaultCode: "WEB_SEARCH_FAILED",
          action: async () => {
            if (!braveApiKey) {
              throw new ToolExecutionError({
                code: "BRAVE_API_KEY_MISSING",
                message: "Brave Search API key is not configured.",
                hint:
                  "Set tools.webSearch.braveApiKey in the Simpleclaw JSON config file.",
              });
            }

            const url = buildSearchUrl({ query, count, freshness });

            const response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": braveApiKey,
              },
            });

            if (!response.ok) {
              const body = await response.text().catch(() => "");
              throw new ToolExecutionError({
                code: "WEB_SEARCH_FAILED",
                message: `Brave Search API returned ${response.status}: ${body}`,
                retryable: response.status >= 500 || response.status === 429,
                hint:
                  response.status === 429
                    ? "Rate limit exceeded. Try again shortly."
                    : undefined,
              });
            }

            const data = (await response.json()) as BraveSearchResponse;
            const rawResults = data.web?.results ?? [];

            const results = truncateResults({
              results: rawResults.map((r) => ({
                title: r.title,
                url: r.url,
                description: r.description,
                ...(r.age ? { age: r.age } : {}),
              })),
            });

            return {
              ok: true,
              result_count: results.length,
              ...(data.query?.altered
                ? { altered_query: data.query.altered }
                : {}),
              results,
            } as const;
          },
        }),
    }),
  };
}

function buildSearchUrl({
  query,
  count,
  freshness,
}: {
  query: string;
  count: number;
  freshness?: string;
}): string {
  const params = new URLSearchParams({
    q: query,
    count: String(count),
  });

  if (freshness) {
    params.set("freshness", freshness);
  }

  return `${BRAVE_SEARCH_ENDPOINT}?${params.toString()}`;
}

/**
 * Progressively drop results until the JSON payload fits within the tool
 * payload budget. This avoids blowing up context windows with huge search
 * result sets.
 */
function truncateResults({
  results,
}: {
  results: BraveWebResult[];
}): BraveWebResult[] {
  const budget = MAX_TOOL_PAYLOAD_BYTES;
  let current = [...results];

  while (current.length > 0) {
    const json = JSON.stringify(current);
    if (Buffer.byteLength(json, "utf8") <= budget) {
      return current;
    }
    current.pop();
  }

  return current;
}
