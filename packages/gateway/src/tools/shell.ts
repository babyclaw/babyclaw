import { exec } from "node:child_process";
import { basename } from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { CommandApprovalService } from "../approval/service.js";
import type { ShellConfig } from "../config/shell-defaults.js";
import { resolveWorkspacePath } from "../utils/path.js";
import { MAX_TOOL_PAYLOAD_BYTES } from "../utils/payload.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateShellToolsInput = {
  context: ToolExecutionContext;
  shellConfig: ShellConfig;
  commandApprovalService?: CommandApprovalService;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = MAX_TOOL_PAYLOAD_BYTES;

const SHELL_OPERATORS = /\|{1,2}|&&|;/;

export function normalizeAllowedCommands({ commands }: { commands: string[] }): Set<string> {
  const normalized = new Set<string>();

  for (const raw of commands) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }
    normalized.add(basename(trimmed));
  }

  return normalized;
}

export function createShellTools({ context, shellConfig, commandApprovalService }: CreateShellToolsInput): ToolSet {
  const isFullAccess = shellConfig.mode === "full-access";
  const allowedCommands = isFullAccess
    ? null
    : normalizeAllowedCommands({ commands: shellConfig.allowedCommands });

  const description = isFullAccess
    ? `Run a shell command in the workspace directory. Full access mode: any command is allowed. Supports pipes and chaining.`
    : commandApprovalService
      ? `Run a shell command in the workspace directory. Commands are restricted to an allowlist. Non-allowlisted commands may be sent to the owner for approval. Supports pipes and chaining.`
      : `Run a shell command in the workspace directory. Commands are restricted to an allowlist of common dev tools (git, node, npm, pnpm, curl, grep, etc.). Supports pipes and chaining.`;

  return {
    shell_exec: tool({
      description,
      inputSchema: z.object({
        command: z.string().trim().min(1),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .max(MAX_TIMEOUT_MS)
          .optional()
          .default(DEFAULT_TIMEOUT_MS),
        working_directory: z.string().trim().min(1).optional(),
      }),
      execute: async ({ command, timeout_ms, working_directory }) =>
        withToolLogging({
          context,
          toolName: "shell_exec",
          defaultCode: "SHELL_EXEC_FAILED",
          input: { command, timeout_ms, working_directory },
          action: async () => {
            let approvedByOwner = false;

            if (allowedCommands) {
              try {
                validateCommandAllowlist({ command, allowedCommands });
              } catch (err) {
                if (
                  err instanceof ToolExecutionError &&
                  err.code === "COMMAND_NOT_ALLOWED" &&
                  commandApprovalService &&
                  context.chatId
                ) {
                  const disallowedNames = extractCommandNames({ command }).filter(
                    (n) => !allowedCommands.has(n),
                  );
                  const result = await commandApprovalService.requestApproval({
                    command,
                    disallowedNames,
                    chatId: context.chatId,
                    threadId: context.threadId,
                  });
                  if (!result.approved) {
                    throw new ToolExecutionError({
                      code: "COMMAND_DENIED_BY_OWNER",
                      message: "The owner denied this command.",
                    });
                  }
                  approvedByOwner = true;
                } else {
                  throw err;
                }
              }
            }

            // const commandNames = extractCommandNames({ command });
            // if (commandNames.includes("sleep")) {
            //   return {
            //     ok: false,
            //     error: "SLEEP_NOT_ALLOWED",
            //     message:
            //       "Do not use `sleep` in shell commands. Use the `wait_and_continue` tool to pause and resume after a delay.",
            //   } as const;
            // }

            const cwd = working_directory
              ? resolveWorkspacePath({
                  workspaceRoot: context.workspaceRoot,
                  requestedPath: working_directory,
                })
              : context.workspaceRoot;

            const result = await executeCommand({
              command,
              cwd,
              timeoutMs: timeout_ms,
            });

            return {
              ok: true,
              ...(approvedByOwner ? { approved_by_owner: true } : {}),
              exit_code: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              timed_out: result.timedOut,
              truncated: result.truncated,
            } as const;
          },
        }),
    }),
  };
}

export function extractCommandNames({ command }: { command: string }): string[] {
  const segments = command.split(SHELL_OPERATORS);
  const names: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let firstToken = "";
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (const char of trimmed) {
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
        continue;
      }
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
        break;
      }

      firstToken += char;
    }

    const withoutEnvVars = skipEnvAssignments({ segment: trimmed });
    if (withoutEnvVars !== trimmed) {
      const reassigned = extractCommandNames({ command: withoutEnvVars });
      names.push(...reassigned);
      continue;
    }

    if (firstToken.length > 0) {
      names.push(basename(firstToken));
    }
  }

  return names;
}

function skipEnvAssignments({ segment }: { segment: string }): string {
  let remaining = segment;
  const envPattern = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/;

  while (envPattern.test(remaining)) {
    remaining = remaining.replace(envPattern, "");
  }

  return remaining;
}

export function validateCommandAllowlist({
  command,
  allowedCommands,
}: {
  command: string;
  allowedCommands: Set<string>;
}): void {
  const names = extractCommandNames({ command });

  if (names.length === 0) {
    throw new ToolExecutionError({
      code: "COMMAND_EMPTY",
      message: "No executable command found in input.",
      hint: "Provide a valid shell command.",
    });
  }

  for (const name of names) {
    if (!allowedCommands.has(name)) {
      throw new ToolExecutionError({
        code: "COMMAND_NOT_ALLOWED",
        message: `Command not in allowlist: ${name}`,
        hint: `Allowed commands: ${[...allowedCommands].sort().join(", ")}`,
      });
    }
  }
}

type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

function executeCommand({
  command,
  cwd,
  timeoutMs,
}: {
  command: string;
  cwd: string;
  timeoutMs: number;
}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        shell: "/bin/sh",
        env: { ...process.env, LANG: "en_US.UTF-8" },
      },
      (error, stdout, stderr) => {
        let timedOut = false;
        let exitCode = 0;

        if (error) {
          exitCode = error.code != null ? (typeof error.code === "number" ? error.code : 1) : 1;
          if ("killed" in error && error.killed) {
            timedOut = true;
          }
        }

        const truncatedStdout = truncateOutput({ output: stdout });
        const truncatedStderr = truncateOutput({ output: stderr });
        const truncated =
          truncatedStdout.length < stdout.length ||
          truncatedStderr.length < stderr.length;

        resolve({
          exitCode,
          stdout: truncatedStdout,
          stderr: truncatedStderr,
          timedOut,
          truncated,
        });
      },
    );

    child.on("error", (spawnError) => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: spawnError.message,
        timedOut: false,
        truncated: false,
      });
    });
  });
}

const MAX_SINGLE_OUTPUT_BYTES = Math.floor(MAX_OUTPUT_BYTES / 2);

export function truncateOutput({ output }: { output: string }): string {
  if (Buffer.byteLength(output, "utf8") <= MAX_SINGLE_OUTPUT_BYTES) {
    return output;
  }

  const buffer = Buffer.from(output, "utf8");
  const truncated = buffer.subarray(0, MAX_SINGLE_OUTPUT_BYTES).toString("utf8");
  return `${truncated}\n... [truncated]`;
}
