import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { AdminServer } from "./server.js";
import { AdminClient } from "./client.js";

function makeSocketPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "admin-client-test-"));
  return join(dir, "test.sock");
}

describe("AdminClient", () => {
  let server: AdminServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it("retrieves status from a running server", async () => {
    const socketPath = makeSocketPath();
    server = new AdminServer({
      socketPath,
      routes: {
        "/status": () => ({
          state: "running",
          uptimeMs: 5000,
          version: "1.0.0",
          pid: 42,
        }),
      },
    });
    await server.start();

    const client = new AdminClient({ socketPath });
    const status = await client.status();

    expect(status.state).toBe("running");
    expect(status.uptimeMs).toBe(5000);
    expect(status.version).toBe("1.0.0");
    expect(status.pid).toBe(42);
  });

  it("retrieves health check", async () => {
    const socketPath = makeSocketPath();
    server = new AdminServer({
      socketPath,
      routes: {
        "/health": () => ({ ok: true }),
      },
    });
    await server.start();

    const client = new AdminClient({ socketPath });
    const health = await client.health();

    expect(health.ok).toBe(true);
  });

  it("throws a clear message when server is not running (ENOENT)", async () => {
    const socketPath = join(tmpdir(), "nonexistent-socket-" + Date.now() + ".sock");
    const client = new AdminClient({ socketPath });

    await expect(client.status()).rejects.toThrow("Gateway is not running");
  });
});
