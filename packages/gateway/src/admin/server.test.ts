import { describe, it, expect, afterEach } from "vitest";
import { request } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { AdminServer } from "./server.js";

function makeSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "admin-server-test-"));
  return join(dir, "test.sock");
}

function httpGet({
  socketPath,
  path,
}: {
  socketPath: string;
  path: string;
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode!,
          body: JSON.parse(data),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("AdminServer", () => {
  let server: AdminServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("responds to registered routes with JSON", async () => {
    const socketPath = makeSocketPath();
    server = new AdminServer({
      socketPath,
      routes: {
        "/status": () => ({ state: "running", pid: 123 }),
      },
    });

    await server.start();

    const res = await httpGet({ socketPath, path: "/status" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "running", pid: 123 });
  });

  it("returns 404 for unknown routes", async () => {
    const socketPath = makeSocketPath();
    server = new AdminServer({
      socketPath,
      routes: {},
    });

    await server.start();

    const res = await httpGet({ socketPath, path: "/nope" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("handles async route handlers", async () => {
    const socketPath = makeSocketPath();
    server = new AdminServer({
      socketPath,
      routes: {
        "/async": async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { delayed: true };
        },
      },
    });

    await server.start();

    const res = await httpGet({ socketPath, path: "/async" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ delayed: true });
  });

  it("returns 500 when a handler throws", async () => {
    const socketPath = makeSocketPath();
    server = new AdminServer({
      socketPath,
      routes: {
        "/boom": () => {
          throw new Error("kaboom");
        },
      },
    });

    await server.start();

    const res = await httpGet({ socketPath, path: "/boom" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "internal_error", message: "kaboom" });
  });

  it("cleans up socket on stop", async () => {
    const socketPath = makeSocketPath();
    server = new AdminServer({
      socketPath,
      routes: {
        "/health": () => ({ ok: true }),
      },
    });

    await server.start();
    await server.stop();
    server = null;

    const { existsSync } = await import("node:fs");
    expect(existsSync(socketPath)).toBe(false);
  });
});
