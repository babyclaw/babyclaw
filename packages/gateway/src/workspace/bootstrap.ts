import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ALL_TEMPLATES } from "./templates.js";

type WorkspaceInput = {
  workspacePath: string;
};

/**
 * Copies template files into the workspace if they don't already exist.
 * For existing workspaces (where IDENTITY.md or SOUL.md already exist),
 * BOOTSTRAP.md is skipped since bootstrap has already happened.
 */
export async function bootstrapWorkspace({
  workspacePath,
}: WorkspaceInput): Promise<void> {
  const isExistingWorkspace = await hasAnyPersonalityFile({ workspacePath });

  const writes = ALL_TEMPLATES.map(async ({ filename, content }) => {
    if (filename === "BOOTSTRAP.md" && isExistingWorkspace) {
      return;
    }

    const filePath = join(workspacePath, filename);
    if (await fileExists({ path: filePath })) {
      return;
    }

    await writeFile(filePath, content, "utf8");
  });

  await Promise.all(writes);
}

export async function readWorkspaceGuide({
  workspacePath,
}: WorkspaceInput): Promise<string | undefined> {
  return readOptionalFile({ path: join(workspacePath, "AGENTS.md") });
}

export async function readBootstrapGuide({
  workspacePath,
}: WorkspaceInput): Promise<string | undefined> {
  return readOptionalFile({ path: join(workspacePath, "BOOTSTRAP.md") });
}

export async function readHeartbeatInstructions({
  workspacePath,
}: WorkspaceInput): Promise<string | null> {
  const raw = await readOptionalFile({
    path: join(workspacePath, "HEARTBEAT.md"),
  });
  if (!raw) return null;

  const meaningful = raw
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    })
    .join("\n")
    .trim();

  return meaningful.length > 0 ? raw : null;
}

async function hasAnyPersonalityFile({
  workspacePath,
}: WorkspaceInput): Promise<boolean> {
  const candidates = ["IDENTITY.md", "SOUL.md"];
  const checks = await Promise.all(
    candidates.map((name) => fileExists({ path: join(workspacePath, name) })),
  );
  return checks.some(Boolean);
}

async function fileExists({ path }: { path: string }): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalFile({
  path,
}: {
  path: string;
}): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return content.trim().length > 0 ? content.trim() : undefined;
  } catch {
    return undefined;
  }
}
