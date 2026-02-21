import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { isSubPath, normalizeSeparators } from "../utils/path.js";
import { ensureJsonWithinLimit, ensurePayloadWithinLimit, MAX_TOOL_PAYLOAD_BYTES } from "../utils/payload.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateStateToolsInput = {
  context: ToolExecutionContext;
};

type StateDocument = {
  key: string;
  version: number;
  updatedAt: string;
  value: unknown;
};

const STATE_ROOT_DIR = ".babyclaw/state";
const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 50;

export function createStateTools({ context }: CreateStateToolsInput): ToolSet {
  return {
    state_get: tool({
      description: "Get a JSON state document by key from managed workspace state.",
      inputSchema: z.object({
        key: z.string().trim().min(1),
      }),
      execute: async ({ key }) =>
        withToolLogging({
          context,
          toolName: "state_get",
          defaultCode: "STATE_GET_FAILED",
          input: { key },
          action: async () => {
            const normalizedKey = normalizeStateKey({ key });
            const stateRoot = await ensureStateRoot({ context });
            const document = await readStateDocumentIfExists({
              stateRoot,
              key: normalizedKey,
            });

            if (!document) {
              return {
                ok: true,
                found: false,
                key: normalizedKey,
              } as const;
            }

            ensureJsonWithinLimit({
              value: document.value,
              maxBytes: MAX_TOOL_PAYLOAD_BYTES,
            });

            return {
              ok: true,
              found: true,
              key: normalizedKey,
              version: document.version,
              updated_at: document.updatedAt,
              value: document.value,
            } as const;
          },
        }),
    }),
    state_set: tool({
      description:
        "Create or update a managed JSON state document with optional CAS expected_version.",
      inputSchema: z.object({
        key: z.string().trim().min(1),
        value: z.unknown(),
        mode: z.enum(["create", "overwrite", "upsert"]).optional().default("upsert"),
        expected_version: z.number().int().nonnegative().optional(),
      }),
      execute: async ({ key, value, mode, expected_version }) =>
        withToolLogging({
          context,
          toolName: "state_set",
          defaultCode: "STATE_SET_FAILED",
          input: { key, mode, expected_version },
          action: async () => {
            const normalizedKey = normalizeStateKey({ key });
            ensureJsonWithinLimit({
              value,
              maxBytes: MAX_TOOL_PAYLOAD_BYTES,
            });

            const stateRoot = await ensureStateRoot({ context });
            const existing = await readStateDocumentIfExists({
              stateRoot,
              key: normalizedKey,
            });

            if (mode === "create" && existing) {
              throw new ToolExecutionError({
                code: "STATE_ALREADY_EXISTS",
                message: `State key already exists: ${normalizedKey}`,
                hint: "Use mode=upsert or mode=overwrite.",
              });
            }

            if (mode === "overwrite" && !existing) {
              throw new ToolExecutionError({
                code: "STATE_NOT_FOUND",
                message: `State key not found for overwrite: ${normalizedKey}`,
                hint: "Use mode=create or mode=upsert.",
              });
            }

            if (typeof expected_version === "number") {
              const currentVersion = existing?.version;
              if (currentVersion !== expected_version) {
                throw new ToolExecutionError({
                  code: "STATE_VERSION_CONFLICT",
                  message: `State version mismatch for key ${normalizedKey}`,
                  hint: `Expected ${expected_version}, current ${currentVersion ?? "none"}.`,
                });
              }
            }

            const version = (existing?.version ?? 0) + 1;
            const updatedAt = new Date().toISOString();
            const document: StateDocument = {
              key: normalizedKey,
              version,
              updatedAt,
              value,
            };

            await writeStateDocument({
              stateRoot,
              key: normalizedKey,
              document,
            });

            return {
              ok: true,
              key: normalizedKey,
              version,
              updated_at: updatedAt,
              value,
            } as const;
          },
        }),
    }),
    state_patch: tool({
      description:
        "Apply JSON Merge Patch to an existing managed state document. Requires expected_version for CAS.",
      inputSchema: z.object({
        key: z.string().trim().min(1),
        patch: z.unknown(),
        expected_version: z.number().int().positive(),
      }),
      execute: async ({ key, patch, expected_version }) =>
        withToolLogging({
          context,
          toolName: "state_patch",
          defaultCode: "STATE_PATCH_FAILED",
          input: { key, expected_version },
          action: async () => {
            const normalizedKey = normalizeStateKey({ key });
            const stateRoot = await ensureStateRoot({ context });
            const existing = await readStateDocumentIfExists({
              stateRoot,
              key: normalizedKey,
            });

            if (!existing) {
              throw new ToolExecutionError({
                code: "STATE_NOT_FOUND",
                message: `State key not found: ${normalizedKey}`,
                hint: "Use state_set with mode=create to initialize this key.",
              });
            }

            if (existing.version !== expected_version) {
              throw new ToolExecutionError({
                code: "STATE_VERSION_CONFLICT",
                message: `State version mismatch for key ${normalizedKey}`,
                hint: `Expected ${expected_version}, current ${existing.version}.`,
              });
            }

            const nextValue = applyJsonMergePatch({
              target: existing.value,
              patch,
            });
            ensureJsonWithinLimit({
              value: nextValue,
              maxBytes: MAX_TOOL_PAYLOAD_BYTES,
            });

            const version = existing.version + 1;
            const updatedAt = new Date().toISOString();
            const document: StateDocument = {
              key: normalizedKey,
              version,
              updatedAt,
              value: nextValue,
            };

            await writeStateDocument({
              stateRoot,
              key: normalizedKey,
              document,
            });

            return {
              ok: true,
              key: normalizedKey,
              version,
              updated_at: updatedAt,
              value: nextValue,
            } as const;
          },
        }),
    }),
    state_list: tool({
      description:
        "List managed state keys with optional prefix filtering and cursor-based pagination.",
      inputSchema: z.object({
        prefix: z.string().trim().optional(),
        cursor: z.string().trim().min(1).optional(),
        limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional().default(DEFAULT_LIST_LIMIT),
      }),
      execute: async ({ prefix, cursor, limit }) =>
        withToolLogging({
          context,
          toolName: "state_list",
          defaultCode: "STATE_LIST_FAILED",
          input: { prefix, cursor, limit },
          action: async () => {
            const normalizedPrefix = normalizeOptionalPrefix({ prefix });
            const stateRoot = await ensureStateRoot({ context });
            const allKeys = await listAllStateKeys({ stateRoot });
            const filteredKeys = allKeys.filter((key) => key.startsWith(normalizedPrefix));

            let startIndex = 0;
            if (cursor) {
              startIndex = filteredKeys.findIndex((key) => key > cursor);
              if (startIndex === -1) {
                return {
                  ok: true,
                  prefix: normalizedPrefix,
                  items: [],
                  next_cursor: null,
                } as const;
              }
            }

            const page = filteredKeys.slice(startIndex, startIndex + limit);
            const items = await Promise.all(
              page.map(async (key) => {
                try {
                  const document = await readStateDocument({ stateRoot, key });
                  return {
                    key,
                    version: document.version,
                    updated_at: document.updatedAt,
                    valid: true,
                  };
                } catch {
                  return {
                    key,
                    version: null,
                    updated_at: null,
                    valid: false,
                  };
                }
              }),
            );

            const nextCursor =
              startIndex + limit < filteredKeys.length
                ? page[page.length - 1]
                : null;

            return {
              ok: true,
              prefix: normalizedPrefix,
              items,
              next_cursor: nextCursor,
            } as const;
          },
        }),
    }),
  };
}

export function normalizeStateKey({ key }: { key: string }): string {
  const normalized = normalizeSeparators({ path: key.trim() });
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(normalized)) {
    throw new ToolExecutionError({
      code: "INVALID_STATE_KEY",
      message: `Invalid state key: ${key}`,
      hint: "Use alphanumeric keys with optional ./_/- separators.",
    });
  }

  if (normalized.includes("..") || normalized.startsWith("/") || normalized.endsWith("/")) {
    throw new ToolExecutionError({
      code: "INVALID_STATE_KEY",
      message: `Invalid state key path segments: ${key}`,
      hint: "Do not use path traversal or leading/trailing slashes.",
    });
  }

  return normalized;
}

function normalizeOptionalPrefix({ prefix }: { prefix: string | undefined }): string {
  if (!prefix) {
    return "";
  }

  return normalizeSeparators({ path: prefix.trim() });
}

async function ensureStateRoot({ context }: { context: ToolExecutionContext }): Promise<string> {
  const stateRoot = resolve(context.workspaceRoot, STATE_ROOT_DIR);
  await mkdir(stateRoot, { recursive: true });
  return stateRoot;
}

function getStateFilePath({
  stateRoot,
  key,
}: {
  stateRoot: string;
  key: string;
}): string {
  const candidate = resolve(stateRoot, `${key}.json`);
  if (!isSubPath({ parent: stateRoot, child: candidate })) {
    throw new ToolExecutionError({
      code: "INVALID_STATE_KEY",
      message: `State key escapes state root: ${key}`,
    });
  }

  return candidate;
}

async function readStateDocumentIfExists({
  stateRoot,
  key,
}: {
  stateRoot: string;
  key: string;
}): Promise<StateDocument | null> {
  try {
    return await readStateDocument({ stateRoot, key });
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readStateDocument({
  stateRoot,
  key,
}: {
  stateRoot: string;
  key: string;
}): Promise<StateDocument> {
  const filePath = getStateFilePath({ stateRoot, key });
  const raw = await readFile(filePath, "utf8");
  const parsed = safeParseJson({
    raw,
    key,
  });

  if (!isStateDocument(parsed) || parsed.key !== key) {
    throw new ToolExecutionError({
      code: "STATE_FILE_INVALID",
      message: `State file is invalid for key ${key}`,
      hint: "Fix or recreate the state file content as valid JSON state document format.",
    });
  }

  return parsed;
}

async function writeStateDocument({
  stateRoot,
  key,
  document,
}: {
  stateRoot: string;
  key: string;
  document: StateDocument;
}): Promise<void> {
  const filePath = getStateFilePath({ stateRoot, key });
  const payload = JSON.stringify(document, null, 2);
  ensurePayloadWithinLimit({
    value: payload,
    maxBytes: MAX_TOOL_PAYLOAD_BYTES,
  });

  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(tmpPath, `${payload}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function safeParseJson({ raw, key }: { raw: string; key: string }): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ToolExecutionError({
      code: "STATE_FILE_INVALID",
      message: `State file contains invalid JSON for key ${key}`,
      hint: "Fix JSON syntax in the corresponding state file.",
    });
  }
}

export function isStateDocument(value: unknown): value is StateDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as Partial<StateDocument>;
  return (
    typeof maybe.key === "string" &&
    typeof maybe.version === "number" &&
    Number.isFinite(maybe.version) &&
    maybe.version > 0 &&
    typeof maybe.updatedAt === "string" &&
    "value" in maybe
  );
}

export function applyJsonMergePatch({ target, patch }: { target: unknown; patch: unknown }): unknown {
  if (!isPlainObject(patch)) {
    return patch;
  }

  const base = isPlainObject(target) ? { ...target } : {};

  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === null) {
      delete base[key];
      continue;
    }

    if (isPlainObject(patchValue)) {
      base[key] = applyJsonMergePatch({
        target: base[key],
        patch: patchValue,
      });
      continue;
    }

    base[key] = patchValue;
  }

  return base;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listAllStateKeys({ stateRoot }: { stateRoot: string }): Promise<string[]> {
  const keys: string[] = [];

  async function walkDirectory({ currentPath }: { currentPath: string }): Promise<void> {
    const entries = await readdir(currentPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walkDirectory({ currentPath: absolutePath });
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const relativePath = relative(stateRoot, absolutePath)
        .replaceAll("\\", "/")
        .replace(/\.json$/u, "");
      keys.push(relativePath);
    }
  }

  await walkDirectory({ currentPath: stateRoot });
  keys.sort();
  return keys;
}
