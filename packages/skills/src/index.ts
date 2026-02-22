import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(PACKAGE_DIR, "skills");

function resolveSkillDir({ slug }: { slug: string }): string | null {
  const resolved = resolve(SKILLS_DIR, slug);
  if (!resolved.startsWith(SKILLS_DIR + "/")) return null;
  return resolved;
}

export type BundledSkillInfo = {
  slug: string;
  skillDir: string;
  skillFilePath: string;
};

export function getBundledSkillsDir(): string {
  return SKILLS_DIR;
}

export function listBundledSlugs(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];

  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      return existsSync(join(SKILLS_DIR, entry.name, "SKILL.md"));
    })
    .map((entry) => entry.name)
    .sort();
}

export function getBundledSkillInfo({ slug }: { slug: string }): BundledSkillInfo | null {
  const skillDir = resolveSkillDir({ slug });
  if (!skillDir) return null;

  const skillFilePath = join(skillDir, "SKILL.md");
  if (!existsSync(skillFilePath)) return null;

  return { slug, skillDir, skillFilePath };
}

export function readBundledSkillContent({ slug }: { slug: string }): string | null {
  const info = getBundledSkillInfo({ slug });
  if (!info) return null;

  return readFileSync(info.skillFilePath, "utf8");
}

export function listBundledSkillFiles({ slug }: { slug: string }): string[] {
  const info = getBundledSkillInfo({ slug });
  if (!info) return [];

  return collectFiles({ dir: info.skillDir, base: "" });
}

function collectFiles({ dir, base }: { dir: string; base: string }): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...collectFiles({ dir: join(dir, entry.name), base: relative }));
    } else {
      results.push(relative);
    }
  }

  return results;
}
