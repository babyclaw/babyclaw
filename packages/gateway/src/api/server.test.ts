import { createServer, request } from "node:http";
import { describe, expect, it } from "vitest";
import type { ChatCompletionsHandler } from "./completions.js";
import { ApiServer } from "./server.js";

type HttpResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.once("error", reject);
  });
}

async function sendHttpRequest({
  port,
  method,
  path,
  headers,
  body,
}: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResponse> {
  return await new Promise<HttpResponse>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let chunks = "";
        res.on("data", (chunk: Buffer) => {
          chunks += chunk.toString("utf8");
        });
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: chunks,
          });
        });
      },
    );
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe("ApiServer", () => {
  it("routes authorized requests to the completions handler", async () => {
    const port = await getFreePort();
    let capturedBody: unknown = null;
    const handler: ChatCompletionsHandler = {
      async handle({ body, response }) {
        capturedBody = body;
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
      },
    };
    const server = new ApiServer({
      port,
      apiKey: "secret",
      chatCompletionsHandler: handler,
    });

    await server.start();
    try {
      const response = await sendHttpRequest({
        port,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "x", messages: [{ role: "user", content: "hello" }] }),
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ ok: true });
      expect(capturedBody).toEqual({
        model: "x",
        messages: [{ role: "user", content: "hello" }],
      });
    } finally {
      await server.stop();
    }
  });

  it("rejects requests with invalid API key", async () => {
    const port = await getFreePort();
    const handler: ChatCompletionsHandler = {
      async handle() {
        throw new Error("handler should not run");
      },
    };
    const server = new ApiServer({
      port,
      apiKey: "secret",
      chatCompletionsHandler: handler,
    });

    await server.start();
    try {
      const response = await sendHttpRequest({
        port,
        method: "POST",
        path: "/v1/chat/completions",
        headers: {
          Authorization: "Bearer wrong",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "x", messages: [{ role: "user", content: "hello" }] }),
      });

      expect(response.status).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: {
          message: "Invalid API key provided.",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      });
    } finally {
      await server.stop();
    }
  });

  it("returns 404 for unknown routes", async () => {
    const port = await getFreePort();
    const handler: ChatCompletionsHandler = {
      async handle() {
        throw new Error("handler should not run");
      },
    };
    const server = new ApiServer({
      port,
      apiKey: "secret",
      chatCompletionsHandler: handler,
    });

    await server.start();
    try {
      const response = await sendHttpRequest({
        port,
        method: "POST",
        path: "/v1/unknown",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: "{}",
      });

      expect(response.status).toBe(404);
      expect(JSON.parse(response.body)).toEqual({
        error: {
          message: "Not found.",
          type: "invalid_request_error",
          code: "not_found",
        },
      });
    } finally {
      await server.stop();
    }
  });

  it("returns 405 for unsupported methods", async () => {
    const port = await getFreePort();
    const handler: ChatCompletionsHandler = {
      async handle() {
        throw new Error("handler should not run");
      },
    };
    const server = new ApiServer({
      port,
      apiKey: "secret",
      chatCompletionsHandler: handler,
    });

    await server.start();
    try {
      const response = await sendHttpRequest({
        port,
        method: "GET",
        path: "/v1/chat/completions",
      });

      expect(response.status).toBe(405);
      expect(JSON.parse(response.body)).toEqual({
        error: {
          message: "Method not allowed.",
          type: "invalid_request_error",
          code: "method_not_allowed",
        },
      });
    } finally {
      await server.stop();
    }
  });

  it("handles CORS preflight with 204", async () => {
    const port = await getFreePort();
    const handler: ChatCompletionsHandler = {
      async handle() {
        throw new Error("handler should not run");
      },
    };
    const server = new ApiServer({
      port,
      apiKey: "secret",
      chatCompletionsHandler: handler,
    });

    await server.start();
    try {
      const response = await sendHttpRequest({
        port,
        method: "OPTIONS",
        path: "/v1/chat/completions",
      });

      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      expect(response.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
    } finally {
      await server.stop();
    }
  });
});
