import { request } from "node:http";

type AdminClientInput = {
  socketPath: string;
};

type AdminRequestInput = {
  path: string;
};

export class AdminClient {
  private readonly socketPath: string;

  constructor({ socketPath }: AdminClientInput) {
    this.socketPath = socketPath;
  }

  async status(): Promise<{
    state: string;
    uptimeMs: number | null;
    version: string;
    pid: number;
  }> {
    return this.get({ path: "/status" });
  }

  async health(): Promise<{ ok: boolean }> {
    return this.get({ path: "/health" });
  }

  async shutdown(): Promise<{ ok: boolean }> {
    return this.get({ path: "/shutdown" });
  }

  async reloadSkills(): Promise<{ ok: boolean }> {
    return this.get({ path: "/reload-skills" });
  }

  private get<T>({ path }: AdminRequestInput): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath,
          path,
          method: "GET",
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Invalid JSON response from gateway: ${data}`));
            }
          });
        },
      );

      req.on("error", (error) => {
        if ("code" in error && (error as NodeJS.ErrnoException).code === "ECONNREFUSED") {
          reject(new Error("Gateway is not running (connection refused)"));
          return;
        }
        if ("code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("Gateway is not running (socket not found)"));
          return;
        }
        reject(error);
      });

      req.end();
    });
  }
}
