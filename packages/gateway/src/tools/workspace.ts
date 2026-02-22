import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  BUNDLED_SKILLS_PREFIX,
  normalizeSeparators,
  pathExists,
  resolveBundledSkillPath,
  resolveWorkspacePath,
} from "../utils/path.js";
import {
  ensureJsonWithinLimit,
  ensurePayloadWithinLimit,
  MAX_TOOL_PAYLOAD_BYTES,
} from "../utils/payload.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateWorkspaceToolsInput = {
  context: ToolExecutionContext;
};

const MAX_LIST_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 100;

export function createWorkspaceTools({ context }: CreateWorkspaceToolsInput): ToolSet {
  return {
    workspace_read: tool({
      description: "Read a text or JSON file from the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        format: z.enum(["text", "json"]).optional().default("text"),
      }),
      execute: async ({ path, format }) =>
        withToolLogging({
          context,
          toolName: "workspace_read",
          defaultCode: "WORKSPACE_READ_FAILED",
          input: { path, format },
          action: async () => {
            const isBundled = path.startsWith(BUNDLED_SKILLS_PREFIX);
            let absolutePath: string;

            if (isBundled) {
              if (!context.bundledSkillsDir) {
                throw new ToolExecutionError({
                  code: "BUNDLED_SKILLS_UNAVAILABLE",
                  message: "Bundled skills directory is not configured",
                });
              }
              absolutePath = resolveBundledSkillPath({
                bundledSkillsDir: context.bundledSkillsDir,
                requestedPath: path,
              });
            } else {
              absolutePath = resolveWorkspacePath({
                workspaceRoot: context.workspaceRoot,
                requestedPath: path,
              });
            }

            const raw = await readFile(absolutePath, "utf8");
            ensurePayloadWithinLimit({
              value: raw,
              maxBytes: MAX_TOOL_PAYLOAD_BYTES,
            });

            if (format === "json") {
              let parsed: unknown;
              try {
                parsed = JSON.parse(raw);
              } catch {
                throw new ToolExecutionError({
                  code: "INVALID_JSON",
                  message: `File is not valid JSON: ${path}`,
                  hint: "Read as text or fix JSON syntax.",
                });
              }

              ensureJsonWithinLimit({
                value: parsed,
                maxBytes: MAX_TOOL_PAYLOAD_BYTES,
              });

              return {
                ok: true,
                path,
                format,
                value: parsed,
              } as const;
            }

            return {
              ok: true,
              path,
              format,
              content: raw,
            } as const;
          },
        }),
    }),
    workspace_write: tool({
      description: "Write a text or JSON file in workspace. Modes: create, overwrite, append.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        format: z.enum(["text", "json"]).optional().default("text"),
        mode: z.enum(["create", "overwrite", "append"]),
        content: z.string().optional(),
        value: z.unknown().optional(),
      }),
      execute: async ({ path, format, mode, content, value }) =>
        withToolLogging({
          context,
          toolName: "workspace_write",
          defaultCode: "WORKSPACE_WRITE_FAILED",
          input: {
            path,
            format,
            mode,
            contentLength: content?.length,
            hasValue: value !== undefined,
          },
          action: async () => {
            if (path.startsWith(BUNDLED_SKILLS_PREFIX)) {
              throw new ToolExecutionError({
                code: "BUNDLED_SKILLS_READONLY",
                message: "Bundled skills are read-only and cannot be written to",
              });
            }

            const absolutePath = resolveWorkspacePath({
              workspaceRoot: context.workspaceRoot,
              requestedPath: path,
            });
            const exists = await pathExists({ absolutePath });

            if (mode === "create" && exists) {
              throw new ToolExecutionError({
                code: "FILE_ALREADY_EXISTS",
                message: `File already exists: ${path}`,
                hint: "Use mode=overwrite or mode=append.",
              });
            }

            if (mode === "overwrite" && !exists) {
              throw new ToolExecutionError({
                code: "FILE_NOT_FOUND",
                message: `Cannot overwrite missing file: ${path}`,
                hint: "Use mode=create or mode=append.",
              });
            }

            let payload: string;
            if (format === "json") {
              if (typeof value === "undefined") {
                throw new ToolExecutionError({
                  code: "INVALID_INPUT",
                  message: "value is required when format=json",
                });
              }
              if (mode === "append") {
                throw new ToolExecutionError({
                  code: "INVALID_MODE",
                  message: "append mode is not supported for format=json",
                  hint: "Use mode=overwrite or mode=create for JSON.",
                });
              }

              ensureJsonWithinLimit({
                value,
                maxBytes: MAX_TOOL_PAYLOAD_BYTES,
              });
              payload = `${JSON.stringify(value, null, 2)}\n`;
            } else {
              if (typeof content !== "string") {
                throw new ToolExecutionError({
                  code: "INVALID_INPUT",
                  message: "content is required when format=text",
                });
              }

              ensurePayloadWithinLimit({
                value: content,
                maxBytes: MAX_TOOL_PAYLOAD_BYTES,
              });
              payload = content;
            }

            await mkdir(dirname(absolutePath), { recursive: true });

            if (mode === "append") {
              await writeFile(absolutePath, payload, {
                encoding: "utf8",
                flag: "a",
              });
            } else {
              const writeFlag = mode === "create" ? "wx" : "w";
              await writeFile(absolutePath, payload, {
                encoding: "utf8",
                flag: writeFlag,
              });
            }

            const info = await stat(absolutePath);
            return {
              ok: true,
              path,
              mode,
              format,
              bytes: info.size,
            } as const;
          },
        }),
    }),
    workspace_list: tool({
      description:
        "List files and directories under a workspace path with optional recursive traversal and cursor pagination.",
      inputSchema: z.object({
        path: z.string().trim().optional().default("."),
        recursive: z.boolean().optional().default(false),
        cursor: z.string().trim().min(1).optional(),
        limit: z
          .number()
          .int()
          .positive()
          .max(MAX_LIST_LIMIT)
          .optional()
          .default(DEFAULT_LIST_LIMIT),
      }),
      execute: async ({ path, recursive, cursor, limit }) =>
        withToolLogging({
          context,
          toolName: "workspace_list",
          defaultCode: "WORKSPACE_LIST_FAILED",
          input: { path, recursive, cursor, limit },
          action: async () => {
            const absolutePath = resolveWorkspacePath({
              workspaceRoot: context.workspaceRoot,
              requestedPath: path,
            });

            const entries = await collectEntries({
              workspaceRoot: context.workspaceRoot,
              absolutePath,
              recursive,
            });

            let startIndex = 0;
            if (cursor) {
              startIndex = entries.findIndex((entry) => entry.path > cursor);
              if (startIndex === -1) {
                return {
                  ok: true,
                  path,
                  items: [],
                  next_cursor: null,
                } as const;
              }
            }

            const page = entries.slice(startIndex, startIndex + limit);
            const nextCursor =
              startIndex + limit < entries.length ? page[page.length - 1].path : null;

            ensureJsonWithinLimit({
              value: page,
              maxBytes: MAX_TOOL_PAYLOAD_BYTES,
            });

            return {
              ok: true,
              path,
              items: page,
              next_cursor: nextCursor,
            } as const;
          },
        }),
    }),
    workspace_delete: tool({
      description: "Delete a file or directory from workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path, recursive }) =>
        withToolLogging({
          context,
          toolName: "workspace_delete",
          defaultCode: "WORKSPACE_DELETE_FAILED",
          input: { path, recursive },
          action: async () => {
            const absolutePath = resolveWorkspacePath({
              workspaceRoot: context.workspaceRoot,
              requestedPath: path,
            });

            const stats = await stat(absolutePath);
            if (stats.isDirectory() && !recursive) {
              throw new ToolExecutionError({
                code: "DIRECTORY_RECURSIVE_REQUIRED",
                message: `Directory delete requires recursive=true: ${path}`,
              });
            }

            await rm(absolutePath, {
              recursive,
              force: false,
            });

            return {
              ok: true,
              path,
              deleted: true,
            } as const;
          },
        }),
    }),
    workspace_move: tool({
      description: "Move or rename a workspace path.",
      inputSchema: z.object({
        from_path: z.string().trim().min(1),
        to_path: z.string().trim().min(1),
        overwrite: z.boolean().optional().default(false),
      }),
      execute: async ({ from_path, to_path, overwrite }) =>
        withToolLogging({
          context,
          toolName: "workspace_move",
          defaultCode: "WORKSPACE_MOVE_FAILED",
          input: { from_path, to_path, overwrite },
          action: async () => {
            const fromAbsolute = resolveWorkspacePath({
              workspaceRoot: context.workspaceRoot,
              requestedPath: from_path,
            });
            const toAbsolute = resolveWorkspacePath({
              workspaceRoot: context.workspaceRoot,
              requestedPath: to_path,
            });

            if (!(await pathExists({ absolutePath: fromAbsolute }))) {
              throw new ToolExecutionError({
                code: "FILE_NOT_FOUND",
                message: `Source path does not exist: ${from_path}`,
              });
            }

            const destinationExists = await pathExists({
              absolutePath: toAbsolute,
            });
            if (destinationExists && !overwrite) {
              throw new ToolExecutionError({
                code: "DESTINATION_EXISTS",
                message: `Destination already exists: ${to_path}`,
                hint: "Set overwrite=true to replace destination.",
              });
            }

            if (destinationExists && overwrite) {
              const destStats = await stat(toAbsolute);
              await rm(toAbsolute, {
                recursive: destStats.isDirectory(),
                force: false,
              });
            }

            await mkdir(dirname(toAbsolute), { recursive: true });
            await rename(fromAbsolute, toAbsolute);

            return {
              ok: true,
              from_path,
              to_path,
              overwritten: destinationExists && overwrite,
            } as const;
          },
        }),
    }),
  };
}

async function collectEntries({
  workspaceRoot,
  absolutePath,
  recursive,
}: {
  workspaceRoot: string;
  absolutePath: string;
  recursive: boolean;
}): Promise<{ path: string; type: "file" | "directory"; size: number }[]> {
  const entries: { path: string; type: "file" | "directory"; size: number }[] = [];

  async function walkDirectory({ currentPath }: { currentPath: string }): Promise<void> {
    const dirEntries = await readdir(currentPath, {
      withFileTypes: true,
    });

    for (const dirEntry of dirEntries) {
      const entryAbsolutePath = join(currentPath, dirEntry.name);
      const stats = await stat(entryAbsolutePath);
      const relPath = toRelativeWorkspacePath({
        workspaceRoot,
        absolutePath: entryAbsolutePath,
      });

      if (dirEntry.isDirectory()) {
        entries.push({
          path: relPath,
          type: "directory",
          size: stats.size,
        });

        if (recursive) {
          await walkDirectory({ currentPath: entryAbsolutePath });
        }

        continue;
      }

      if (dirEntry.isFile()) {
        entries.push({
          path: relPath,
          type: "file",
          size: stats.size,
        });
      }
    }
  }

  await walkDirectory({ currentPath: absolutePath });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function toRelativeWorkspacePath({
  workspaceRoot,
  absolutePath,
}: {
  workspaceRoot: string;
  absolutePath: string;
}): string {
  const rel = normalizeSeparators({ path: relative(resolve(workspaceRoot), absolutePath) });
  return rel.length === 0 ? "." : rel;
}
