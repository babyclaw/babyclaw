import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import type { SelfToolDeps } from "../utils/tool-deps.js";
import { withToolLogging } from "./errors.js";

type CreateSelfToolsInput = {
  context: ToolExecutionContext;
  getActiveTurnCount: () => number;
} & SelfToolDeps;

export function createSelfTools({
  context,
  getStatus,
  adminSocketPath,
  logOutput,
  logLevel,
  schedulerActive,
  heartbeatActive,
  getActiveTurnCount,
  restartGateway,
}: CreateSelfToolsInput): ToolSet {
  return {
    self_status: tool({
      description:
        "Get the gateway's runtime status including state, uptime, config path, log settings, and active subsystems. " +
        "Use this to discover paths for config and logs before managing them via shell.",
      inputSchema: z.object({}),
      execute: async () =>
        withToolLogging({
          context,
          toolName: "self_status",
          defaultCode: "SELF_STATUS_FAILED",
          action: async () => {
            const status = getStatus();
            return {
              ok: true,
              state: status.state,
              uptimeMs: status.uptimeMs,
              pid: status.pid,
              version: status.version,
              configPath: status.configPath,
              adminSocketPath,
              logOutput,
              logLevel,
              schedulerActive,
              heartbeatActive,
              activeTurns: getActiveTurnCount(),
            } as const;
          },
        }),
    }),

    self_restart: tool({
      description:
        "Gracefully shut down and restart the gateway. The process manager will bring it back. " +
        "Requires confirm: true to prevent accidental restarts. " +
        "Use after editing the config file to apply changes.",
      inputSchema: z.object({
        confirm: z
          .literal(true, {
            error: "confirm must be true to proceed with restart",
          }),
      }),
      execute: async ({ confirm }) =>
        withToolLogging({
          context,
          toolName: "self_restart",
          defaultCode: "SELF_RESTART_FAILED",
          input: { confirm },
          action: async () => {
            setImmediate(() => {
              void restartGateway();
            });

            return {
              ok: true,
              message: "Gateway restart initiated. The process manager will bring it back shortly.",
            } as const;
          },
        }),
    }),
  };
}
