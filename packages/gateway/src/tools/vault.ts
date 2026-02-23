import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { VaultRepository } from "../vault/repository.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateVaultToolsInput = {
  context: ToolExecutionContext;
  vaultRepository: VaultRepository;
};

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

export function normalizeVaultKey({ key }: { key: string }): string {
  const normalized = key.trim().replace(/\\/g, "/");

  if (!KEY_PATTERN.test(normalized)) {
    throw new ToolExecutionError({
      code: "INVALID_VAULT_KEY",
      message: `Invalid vault key: ${key}`,
      hint: 'Use alphanumeric keys with optional ./_/- separators, e.g. "github/token".',
    });
  }

  if (normalized.includes("..") || normalized.startsWith("/") || normalized.endsWith("/")) {
    throw new ToolExecutionError({
      code: "INVALID_VAULT_KEY",
      message: `Invalid vault key path segments: ${key}`,
      hint: "Do not use path traversal or leading/trailing slashes.",
    });
  }

  return normalized;
}

const vaultInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("get"),
    key: z.string().trim().min(1).describe("The vault key to retrieve"),
  }),
  z.object({
    action: z.literal("set"),
    key: z.string().trim().min(1).describe("The vault key to store under"),
    value: z.string().min(1).describe("The secret value"),
    label: z
      .string()
      .trim()
      .optional()
      .describe("Optional human-readable description of this credential"),
  }),
  z.object({
    action: z.literal("delete"),
    key: z.string().trim().min(1).describe("The vault key to delete"),
  }),
  z.object({
    action: z.literal("list"),
  }),
]);

export type VaultInput = z.infer<typeof vaultInputSchema>;

export function createVaultTools({ context, vaultRepository }: CreateVaultToolsInput): ToolSet {
  return {
    vault: tool({
      description: [
        "Secure credential vault for storing and retrieving API keys, tokens, passwords, and other secrets.",
        'Actions: "get" (retrieve by key), "set" (store/update), "delete" (remove), "list" (show all keys without values).',
        'Key format: "service/type" e.g. "github/token", "elevenlabs/api-key".',
      ].join(" "),
      inputSchema: vaultInputSchema,
      execute: async (input) =>
        withToolLogging({
          context,
          toolName: "vault",
          defaultCode: "VAULT_FAILED",
          input: redactVaultInput({ input }),
          action: async () => {
            switch (input.action) {
              case "get":
                return handleGet({ vaultRepository, key: input.key });
              case "set":
                return handleSet({
                  vaultRepository,
                  key: input.key,
                  value: input.value,
                  label: input.label,
                });
              case "delete":
                return handleDelete({ vaultRepository, key: input.key });
              case "list":
                return handleList({ vaultRepository });
            }
          },
        }),
    }),
  };
}

async function handleGet({
  vaultRepository,
  key,
}: {
  vaultRepository: VaultRepository;
  key: string;
}) {
  const normalizedKey = normalizeVaultKey({ key });
  const entry = await vaultRepository.get({ key: normalizedKey });

  if (!entry) {
    return { ok: true, found: false, key: normalizedKey } as const;
  }

  return {
    ok: true,
    found: true,
    key: normalizedKey,
    label: entry.label,
    value: entry.value,
  } as const;
}

async function handleSet({
  vaultRepository,
  key,
  value,
  label,
}: {
  vaultRepository: VaultRepository;
  key: string;
  value: string;
  label?: string;
}) {
  const normalizedKey = normalizeVaultKey({ key });
  const { created } = await vaultRepository.set({
    key: normalizedKey,
    value,
    label,
  });

  return {
    ok: true,
    key: normalizedKey,
    created,
  } as const;
}

async function handleDelete({
  vaultRepository,
  key,
}: {
  vaultRepository: VaultRepository;
  key: string;
}) {
  const normalizedKey = normalizeVaultKey({ key });
  const { deleted } = await vaultRepository.delete({ key: normalizedKey });

  return {
    ok: true,
    key: normalizedKey,
    deleted,
  } as const;
}

async function handleList({ vaultRepository }: { vaultRepository: VaultRepository }) {
  const items = await vaultRepository.list();

  return {
    ok: true,
    items: items.map((item) => ({
      key: item.key,
      label: item.label,
      updated_at: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : null,
    })),
  } as const;
}

function redactVaultInput({ input }: { input: VaultInput }): Record<string, unknown> {
  if (input.action === "set") {
    return { action: input.action, key: input.key, label: input.label, value: "[REDACTED]" };
  }
  return { ...input };
}
