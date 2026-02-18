import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolSet } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AiAgent } from "../ai/agent.js";
import type { BrowserMcpClient } from "../browser/mcp-client.js";
import type { SchedulerService } from "../scheduler/service.js";
import type { SkillsConfig } from "../workspace/skills/types.js";
import { OpenAiHttpError } from "./errors.js";
import { createChatCompletionsHandler } from "./completions.js";

type MockResponseState = {
  statusCode: number;
  headers: Record<string, string>;
  chunks: string[];
  ended: boolean;
};

class MockResponse {
  private readonly state: MockResponseState = {
    statusCode: 0,
    headers: {},
    chunks: [],
    ended: false,
  };

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.state.statusCode = statusCode;
    if (headers) {
      this.state.headers = { ...this.state.headers, ...headers };
    }
    return this;
  }

  write(chunk: string): boolean {
    this.state.chunks.push(chunk);
    return true;
  }

  end(chunk?: string): this {
    if (chunk) {
      this.state.chunks.push(chunk);
    }
    this.state.ended = true;
    return this;
  }

  getSnapshot(): MockResponseState {
    return {
      ...this.state,
      headers: { ...this.state.headers },
      chunks: [...this.state.chunks],
    };
  }
}

class StubAiAgent {
  lastInput: unknown = null;
  private nextText = "ok";
  private nextFullStreamParts: unknown[] = [{ type: "finish", finishReason: "stop" }];

  setResponse({
    text,
    fullStreamParts,
  }: {
    text: string;
    fullStreamParts: unknown[];
  }): void {
    this.nextText = text;
    this.nextFullStreamParts = fullStreamParts;
  }

  chatStreamWithTools(input: unknown): {
    textStream: AsyncIterable<string>;
    fullStream: AsyncIterable<unknown>;
    text: Promise<string>;
  } {
    this.lastInput = input;

    return {
      textStream: emptyStringStream(),
      fullStream: streamParts({ parts: this.nextFullStreamParts }),
      text: Promise.resolve(this.nextText),
    };
  }
}

async function* emptyStringStream(): AsyncGenerator<string> {
  return;
}

async function* streamParts({
  parts,
}: {
  parts: unknown[];
}): AsyncGenerator<unknown> {
  for (const part of parts) {
    yield part;
  }
}

type MakeHandlerInput = {
  workspacePath: string;
  aiAgent: StubAiAgent;
};

function makeHandler({
  workspacePath,
  aiAgent,
}: MakeHandlerInput) {
  const schedulerService = {
    getTimezone() {
      return "UTC";
    },
  } as unknown as SchedulerService;

  return createChatCompletionsHandler({
    workspacePath,
    aiAgent: aiAgent as unknown as AiAgent,
    schedulerService,
    syncSchedule: async () => {},
    enableGenericTools: true,
    braveSearchApiKey: null,
    shellConfig: {
      mode: "allowlist",
      allowedCommands: ["ls", "pwd"],
    },
    browserMcpClient: undefined as BrowserMcpClient | undefined,
    skillsConfig: { entries: {} } as SkillsConfig,
    fullConfig: {},
    getStatus: () => ({
      state: "running",
      uptimeMs: 1_000,
      configPath: "~/.simpleclaw/simpleclaw.json",
      pid: 12345,
      version: "1.0.0",
    }),
    adminSocketPath: "~/.simpleclaw/gateway.sock",
    logOutput: "stdout",
    logLevel: "info",
    schedulerActive: true,
    heartbeatActive: false,
    restartGateway: async () => {},
    responseModel: "anthropic:claude-sonnet-4-20250514",
    createTools: () => ({} as ToolSet),
  });
}

describe("createChatCompletionsHandler", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("returns OpenAI-compatible non-streaming response", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-handler-"));
    const aiAgent = new StubAiAgent();
    aiAgent.setResponse({
      text: "Hello from API",
      fullStreamParts: [{ type: "finish", finishReason: "stop" }],
    });
    const handler = makeHandler({
      workspacePath: tempDir,
      aiAgent,
    });
    const response = new MockResponse();

    await handler.handle({
      body: {
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello" }],
      },
      response: response as unknown as import("node:http").ServerResponse,
    });

    const snapshot = response.getSnapshot();
    expect(snapshot.statusCode).toBe(200);
    const body = JSON.parse(snapshot.chunks.join(""));
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("anthropic:claude-sonnet-4-20250514");
    expect(body.choices).toEqual([
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Hello from API",
        },
        finish_reason: "stop",
      },
    ]);
  });

  it("streams SSE chunks with role delta, content deltas, final chunk, and [DONE]", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-stream-"));
    const aiAgent = new StubAiAgent();
    aiAgent.setResponse({
      text: "Hello",
      fullStreamParts: [
        { type: "text-delta", text: "Hel" },
        { type: "text-delta", text: "lo" },
        { type: "finish", finishReason: "length" },
      ],
    });
    const handler = makeHandler({
      workspacePath: tempDir,
      aiAgent,
    });
    const response = new MockResponse();

    await handler.handle({
      body: {
        model: "gpt-4o-mini",
        stream: true,
        messages: [{ role: "user", content: "stream this" }],
      },
      response: response as unknown as import("node:http").ServerResponse,
    });

    const raw = response.getSnapshot().chunks.join("");
    const events = raw
      .split("\n\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    expect(events.at(-1)).toBe("data: [DONE]");

    const roleChunk = JSON.parse(events[0]!.slice("data: ".length)) as Record<string, unknown>;
    expect(roleChunk.object).toBe("chat.completion.chunk");
    expect((roleChunk.choices as Array<Record<string, unknown>>)[0]?.delta).toEqual({
      role: "assistant",
    });

    const finalChunk = JSON.parse(events.at(-2)!.slice("data: ".length)) as Record<string, unknown>;
    expect((finalChunk.choices as Array<Record<string, unknown>>)[0]?.finish_reason).toBe("length");
  });

  it("rejects client-defined tools with OpenAI-style error", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-tools-"));
    const aiAgent = new StubAiAgent();
    const handler = makeHandler({
      workspacePath: tempDir,
      aiAgent,
    });
    const response = new MockResponse();

    await expect(
      handler.handle({
        body: {
          model: "gpt-4o-mini",
          tools: [{ type: "function", function: { name: "x" } }],
          messages: [{ role: "user", content: "hi" }],
        },
        response: response as unknown as import("node:http").ServerResponse,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        type: "invalid_request_error",
        param: "tools",
      } satisfies Partial<OpenAiHttpError>),
    );
  });

  it("forwards supported generation parameters to the agent", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-params-"));
    const aiAgent = new StubAiAgent();
    const handler = makeHandler({
      workspacePath: tempDir,
      aiAgent,
    });
    const response = new MockResponse();

    await handler.handle({
      body: {
        model: "gpt-4o-mini",
        temperature: 0.3,
        top_p: 0.8,
        max_completion_tokens: 111,
        stop: ["END"],
        messages: [{ role: "user", content: "test" }],
      },
      response: response as unknown as import("node:http").ServerResponse,
    });

    expect(aiAgent.lastInput).toEqual(
      expect.objectContaining({
        temperature: 0.3,
        topP: 0.8,
        maxOutputTokens: 111,
        stopSequences: ["END"],
      }),
    );
  });

  it("rejects malformed message role with param path", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "simpleclaw-api-role-"));
    const aiAgent = new StubAiAgent();
    const handler = makeHandler({
      workspacePath: tempDir,
      aiAgent,
    });
    const response = new MockResponse();

    await expect(
      handler.handle({
        body: {
          model: "gpt-4o-mini",
          messages: [{ role: "bot", content: "nope" }],
        },
        response: response as unknown as import("node:http").ServerResponse,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 400,
        type: "invalid_request_error",
        param: "messages[0].role",
      } satisfies Partial<OpenAiHttpError>),
    );
  });
});
