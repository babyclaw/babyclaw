import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type RouteHandler = () => Promise<unknown> | unknown;

type AdminServerInput = {
  socketPath: string;
  routes: Record<string, RouteHandler>;
};

export class AdminServer {
  private server: Server | null = null;
  private readonly socketPath: string;
  private readonly routes: Record<string, RouteHandler>;

  constructor({ socketPath, routes }: AdminServerInput) {
    this.socketPath = socketPath;
    this.routes = routes;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const dir = dirname(this.socketPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(this.socketPath)) {
      await unlink(this.socketPath);
    }

    const server = createServer((req, res) => {
      void this.handleRequest({ req, res });
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.socketPath, () => {
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

    try {
      await unlink(this.socketPath);
    } catch {
      // Socket file may already be gone
    }
  }

  private async handleRequest({
    req,
    res,
  }: {
    req: IncomingMessage;
    res: ServerResponse;
  }): Promise<void> {
    const url = req.url ?? "/";
    const handler = this.routes[url];

    if (!handler) {
      this.sendJson({ res, status: 404, body: { error: "not_found" } });
      return;
    }

    try {
      const result = await handler();
      this.sendJson({ res, status: 200, body: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson({ res, status: 500, body: { error: "internal_error", message } });
    }
  }

  private sendJson({
    res,
    status,
    body,
  }: {
    res: ServerResponse;
    status: number;
    body: unknown;
  }): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }
}
