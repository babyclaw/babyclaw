import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillEntry, SkillFrontmatter, OpenClawSkillMetadata } from "./types.js";

const SKILL_FILENAME = "SKILL.md";
export const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export type RawFrontmatter = Record<string, unknown>;

export function parseFrontmatter({ content }: { content: string }): RawFrontmatter | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match?.[1]) return null;

  try {
    const parsed: unknown = parseYaml(match[1]);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as RawFrontmatter;
  } catch {
    return null;
  }
}

function extractOpenclawMetadata({
  raw,
}: {
  raw: RawFrontmatter;
}): OpenClawSkillMetadata | undefined {
  const metadata = raw.metadata;
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata) as Record<string, unknown>;
      return (parsed.openclaw ?? parsed.simpleclaw) as OpenClawSkillMetadata | undefined;
    } catch {
      return undefined;
    }
  }

  if (typeof metadata === "object" && metadata !== null) {
    const obj = metadata as Record<string, unknown>;
    return (obj.openclaw ?? obj.simpleclaw) as OpenClawSkillMetadata | undefined;
  }

  return undefined;
}

export function buildFrontmatter({ raw }: { raw: RawFrontmatter }): SkillFrontmatter | null {
  const name = raw.name;
  const description = raw.description;
  if (typeof name !== "string" || typeof description !== "string") return null;

  const openclaw = extractOpenclawMetadata({ raw });

  return {
    name,
    description,
    homepage: typeof raw.homepage === "string" ? raw.homepage : undefined,
    userInvocable: raw["user-invocable"] !== false,
    disableModelInvocation: raw["disable-model-invocation"] === true,
    commandDispatch:
      typeof raw["command-dispatch"] === "string"
        ? raw["command-dispatch"]
        : undefined,
    commandTool:
      typeof raw["command-tool"] === "string" ? raw["command-tool"] : undefined,
    commandArgMode:
      typeof raw["command-arg-mode"] === "string"
        ? raw["command-arg-mode"]
        : undefined,
    openclaw,
  };
}

export async function scanWorkspaceSkills({
  workspacePath,
}: {
  workspacePath: string;
}): Promise<SkillEntry[]> {
  const skillsDir = join(workspacePath, "skills");

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: SkillEntry[] = [];

  const reads = entries
    .filter((entry) => entry.isDirectory())
    .map(async (dir) => {
      const skillPath = join(skillsDir, dir.name, SKILL_FILENAME);
      try {
        const content = await readFile(skillPath, "utf8");
        const raw = parseFrontmatter({ content });
        if (!raw) return;

        const frontmatter = buildFrontmatter({ raw });
        if (!frontmatter) return;

        results.push({
          frontmatter,
          slug: dir.name,
          relativePath: `skills/${dir.name}/${SKILL_FILENAME}`,
        });
      } catch {
        // SKILL.md doesn't exist or is unreadable — skip
      }
    });

  await Promise.all(reads);

  results.sort((a, b) => a.slug.localeCompare(b.slug));

  return results;
}
