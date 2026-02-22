import { resolve, sep } from "node:path";
import { stat } from "node:fs/promises";

export const BUNDLED_SKILLS_PREFIX = "bundled-skills/";

export function normalizeSeparators({ path }: { path: string }): string {
  return path.replaceAll("\\", "/");
}

export function resolveBundledSkillPath({
  bundledSkillsDir,
  requestedPath,
}: {
  bundledSkillsDir: string;
  requestedPath: string;
}): string {
  const relative = requestedPath.slice(BUNDLED_SKILLS_PREFIX.length);
  const normalized = normalizeSeparators({ path: relative }).trim();
  if (normalized.length === 0) {
    throw new Error("Path is required");
  }

  const absoluteRoot = resolve(bundledSkillsDir);
  const absoluteTarget = resolve(absoluteRoot, normalized);
  if (!isSubPath({ parent: absoluteRoot, child: absoluteTarget })) {
    throw new Error("Path escapes bundled skills root");
  }

  return absoluteTarget;
}

export function resolveWorkspacePath({
  workspaceRoot,
  requestedPath,
}: {
  workspaceRoot: string;
  requestedPath: string;
}): string {
  const normalizedRequested = normalizeSeparators({ path: requestedPath }).trim();
  if (normalizedRequested.length === 0) {
    throw new Error("Path is required");
  }

  const absoluteRoot = resolve(workspaceRoot);
  const absoluteTarget = resolve(absoluteRoot, normalizedRequested);
  if (!isSubPath({ parent: absoluteRoot, child: absoluteTarget })) {
    throw new Error("Path escapes workspace root");
  }

  return absoluteTarget;
}

export function isSubPath({ parent, child }: { parent: string; child: string }): boolean {
  if (parent === child) {
    return true;
  }

  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child.startsWith(normalizedParent);
}

export async function pathExists({ absolutePath }: { absolutePath: string }): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
