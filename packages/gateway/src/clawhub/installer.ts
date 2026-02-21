import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSkillInfo, getSkillVersionFiles, getSkillFileContent, ClawHubError } from "./client.js";

export type InstallSkillResult = {
  slug: string;
  version: string;
  displayName: string;
  files: string[];
  skillPath: string;
};

export class SkillAlreadyInstalledError extends Error {
  readonly slug: string;
  readonly skillPath: string;

  constructor({ slug, skillPath }: { slug: string; skillPath: string }) {
    super(`Skill "${slug}" is already installed at ${skillPath}. Use force to overwrite.`);
    this.slug = slug;
    this.skillPath = skillPath;
  }
}

export async function installSkillFromClawHub({
  slug,
  version,
  workspacePath,
  force = false,
}: {
  slug: string;
  version?: string;
  workspacePath: string;
  force?: boolean;
}): Promise<InstallSkillResult> {
  const normalizedSlug = slug.trim().toLowerCase();

  const info = await getSkillInfo({ slug: normalizedSlug });

  if (info.moderation?.isMalwareBlocked) {
    throw new ClawHubError({
      statusCode: 403,
      slug: normalizedSlug,
      message: `Skill "${normalizedSlug}" is blocked: flagged as malicious by VirusTotal.`,
    });
  }

  const resolvedVersion = version ?? info.latestVersion?.version ?? undefined;

  if (!resolvedVersion) {
    throw new Error(`Skill "${normalizedSlug}" has no published versions.`);
  }

  const versionDetail = await getSkillVersionFiles({
    slug: normalizedSlug,
    version: resolvedVersion,
  });

  const skillDir = join(workspacePath, "skills", normalizedSlug);

  if (existsSync(skillDir) && !force) {
    throw new SkillAlreadyInstalledError({
      slug: normalizedSlug,
      skillPath: skillDir,
    });
  }

  const writtenFiles: string[] = [];

  for (const file of versionDetail.version.files) {
    const content = await getSkillFileContent({
      slug: normalizedSlug,
      path: file.path,
      version: resolvedVersion,
    });

    const filePath = join(skillDir, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    writtenFiles.push(file.path);
  }

  return {
    slug: normalizedSlug,
    version: resolvedVersion,
    displayName: info.skill.displayName,
    files: writtenFiles,
    skillPath: skillDir,
  };
}
