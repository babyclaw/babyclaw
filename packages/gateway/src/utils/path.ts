import { resolve, sep } from "node:path";

export function resolveWorkspacePath({
  workspaceRoot,
  requestedPath,
}: {
  workspaceRoot: string;
  requestedPath: string;
}): string {
  const normalizedRequested = requestedPath.replaceAll("\\", "/").trim();
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

function isSubPath({ parent, child }: { parent: string; child: string }): boolean {
  if (parent === child) {
    return true;
  }

  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child.startsWith(normalizedParent);
}
