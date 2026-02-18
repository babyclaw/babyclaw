import type { ServerResponse } from "node:http";

export type OpenAiErrorShape = {
  message: string;
  type: "invalid_request_error" | "authentication_error" | "server_error";
  param?: string;
  code?: string;
};

type OpenAiHttpErrorInput = OpenAiErrorShape & {
  status: number;
};

export class OpenAiHttpError extends Error {
  readonly status: number;
  readonly type: OpenAiErrorShape["type"];
  readonly param?: string;
  readonly code?: string;

  constructor({ status, message, type, param, code }: OpenAiHttpErrorInput) {
    super(message);
    this.name = "OpenAiHttpError";
    this.status = status;
    this.type = type;
    this.param = param;
    this.code = code;
  }
}

export function sendJson({
  response,
  status,
  body,
  extraHeaders,
}: {
  response: ServerResponse;
  status: number;
  body: unknown;
  extraHeaders?: Record<string, string>;
}): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

export function sendOpenAiError({
  response,
  status,
  message,
  type,
  param,
  code,
  extraHeaders,
}: {
  response: ServerResponse;
  status: number;
  message: string;
  type: OpenAiErrorShape["type"];
  param?: string;
  code?: string;
  extraHeaders?: Record<string, string>;
}): void {
  sendJson({
    response,
    status,
    body: {
      error: {
        message,
        type,
        ...(param ? { param } : {}),
        ...(code ? { code } : {}),
      },
    },
    extraHeaders,
  });
}

export function sendOpenAiErrorFromException({
  response,
  error,
  extraHeaders,
}: {
  response: ServerResponse;
  error: unknown;
  extraHeaders?: Record<string, string>;
}): void {
  if (error instanceof OpenAiHttpError) {
    sendOpenAiError({
      response,
      status: error.status,
      message: error.message,
      type: error.type,
      param: error.param,
      code: error.code,
      extraHeaders,
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Internal server error";
  sendOpenAiError({
    response,
    status: 500,
    message,
    type: "server_error",
    code: "internal_error",
    extraHeaders,
  });
}
