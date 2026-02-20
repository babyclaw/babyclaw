import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type PersonalityFiles = {
  identity: string | null;
  soul: string | null;
  user: string | null;
};

export type CompletePersonalityFiles = {
  identity: string;
  soul: string;
  user: string;
};

type WorkspaceInput = {
  workspacePath: string;
};

function getPersonalityFilePaths({
  workspacePath,
}: WorkspaceInput): { identityPath: string; soulPath: string; userPath: string } {
  return {
    identityPath: join(workspacePath, "IDENTITY.md"),
    soulPath: join(workspacePath, "SOUL.md"),
    userPath: join(workspacePath, "USER.md"),
  };
}

export async function readPersonalityFiles({
  workspacePath,
}: WorkspaceInput): Promise<PersonalityFiles> {
  const { identityPath, soulPath, userPath } = getPersonalityFilePaths({ workspacePath });
  const [identity, soul, user] = await Promise.all([
    readOptionalFile({ path: identityPath }),
    readOptionalFile({ path: soulPath }),
    readOptionalFile({ path: userPath }),
  ]);

  return {
    identity,
    soul,
    user,
  };
}

export function hasCompletePersonalityFiles(
  files: PersonalityFiles,
): files is CompletePersonalityFiles {
  return (
    typeof files.identity === "string" &&
    files.identity.trim().length > 0 &&
    typeof files.soul === "string" &&
    files.soul.trim().length > 0 &&
    typeof files.user === "string" &&
    files.user.trim().length > 0
  );
}

async function readOptionalFile({ path }: { path: string }): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const maybeErrno = error as NodeJS.ErrnoException;
    if (maybeErrno.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
