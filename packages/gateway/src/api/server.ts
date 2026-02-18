import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { ChatCompletionsHandler } from "./completions.js";
import {
  OpenAiHttpError,
  sendOpenAiError,
  sendOpenAiErrorFromException,
} from "./errors.js";

type ApiServerInput = {
  port: number;
  apiKey: string;
  chatCompletionsHandler: ChatCompletionsHandler;
  host?: string;
  maxRequestBytes?: number;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export class ApiServer {
  private server: Server | null = null;
  private readonly port: number;
  private readonly apiKey: string;
  private readonly chatCompletionsHandler: ChatCompletionsHandler;
  private readonly host: string;
  private readonly maxRequestBytes: number;

  constructor({
    port,
    apiKey,
    chatCompletionsHandler,
    host = DEFAULT_HOST,
    maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  }: ApiServerInput) {
    this.port = port;
    this.apiKey = apiKey;
    this.chatCompletionsHandler = chatCompletionsHandler;
    this.host = host;
    this.maxRequestBytes = maxRequestBytes;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer((request, response) => {
      void this.handleRequest({
        request,
        response,
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });

    this.server = server;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleRequest({
    request,
    response,
  }: {
    request: IncomingMessage;
    response: ServerResponse;
  }): Promise<void> {
    applyCorsHeaders({
      response,
    });

    const pathname = parsePathname({
      url: request.url,
    });

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (pathname !== "/v1/chat/completions") {
      sendOpenAiError({
        response,
        status: 404,
        message: "Not found.",
        type: "invalid_request_error",
        code: "not_found",
      });
      return;
    }

    if (request.method !== "POST") {
      sendOpenAiError({
        response,
        status: 405,
        message: "Method not allowed.",
        type: "invalid_request_error",
        code: "method_not_allowed",
      });
      return;
    }

    try {
      validateAuthorization({
        request,
        apiKey: this.apiKey,
      });
      validateContentType({
        request,
      });

      const parsedBody = await readJsonBody({
        request,
        maxBytes: this.maxRequestBytes,
      });

      const abortController = new AbortController();
      request.once("close", () => {
        abortController.abort();
      });

      await this.chatCompletionsHandler.handle({
        body: parsedBody,
        response,
        abortSignal: abortController.signal,
      });
    } catch (error) {
      if (response.headersSent) {
        if (!response.writableEnded) {
          response.end();
        }
        return;
      }
      sendOpenAiErrorFromException({
        response,
        error,
      });
    }
  }
}

function applyCorsHeaders({
  response,
}: {
  response: ServerResponse;
}): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function parsePathname({
  url,
}: {
  url: string | undefined;
}): string {
  if (!url) {
    return "/";
  }
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function validateAuthorization({
  request,
  apiKey,
}: {
  request: IncomingMessage;
  apiKey: string;
}): void {
  const authHeader = request.headers.authorization;
  const token = extractBearerToken({
    authHeader,
  });
  if (token === apiKey) {
    return;
  }

  throw new OpenAiHttpError({
    status: 401,
    type: "authentication_error",
    message: "Invalid API key provided.",
    code: "invalid_api_key",
  });
}

function extractBearerToken({
  authHeader,
}: {
  authHeader: string | undefined;
}): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2) {
    return null;
  }
  if (parts[0]?.toLowerCase() !== "bearer") {
    return null;
  }
  return parts[1] ?? null;
}

function validateContentType({
  request,
}: {
  request: IncomingMessage;
}): void {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string") {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Content-Type must be application/json.",
      param: "content-type",
      code: "invalid_content_type",
    });
  }

  if (contentType.toLowerCase().includes("application/json")) {
    return;
  }

  throw new OpenAiHttpError({
    status: 400,
    type: "invalid_request_error",
    message: "Content-Type must be application/json.",
    param: "content-type",
    code: "invalid_content_type",
  });
}

async function readJsonBody({
  request,
  maxBytes,
}: {
  request: IncomingMessage;
  maxBytes: number;
}): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new OpenAiHttpError({
        status: 413,
        type: "invalid_request_error",
        message: "Request body is too large.",
        code: "request_too_large",
      });
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim().length === 0) {
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: "Request body cannot be empty.",
      code: "invalid_json",
    });
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new OpenAiHttpError({
      status: 400,
      type: "invalid_request_error",
      message: `Invalid JSON body: ${message}`,
      code: "invalid_json",
    });
  }
}

export type { ApiServerInput };
