import { execFileSync } from "node:child_process";
import type { SkillEntry, SkillsConfig } from "./types.js";

type EligibilityInput = {
  skills: SkillEntry[];
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
};

export function getEligibleSkills({
  skills,
  skillsConfig,
  fullConfig,
}: EligibilityInput): SkillEntry[] {
  return skills.filter((skill) => shouldIncludeSkill({ skill, skillsConfig, fullConfig }));
}

function shouldIncludeSkill({
  skill,
  skillsConfig,
  fullConfig,
}: {
  skill: SkillEntry;
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
}): boolean {
  const { frontmatter } = skill;
  const openclaw = frontmatter.openclaw;
  const skillKey = openclaw?.skillKey ?? frontmatter.name;
  const entry = skillsConfig.entries[skillKey];

  if (entry?.enabled === false) return false;

  if (frontmatter.disableModelInvocation) return false;

  if (openclaw?.os && openclaw.os.length > 0) {
    if (!openclaw.os.includes(process.platform)) return false;
  }

  if (openclaw?.always) return true;

  const requires = openclaw?.requires;
  if (!requires) return true;

  if (requires.bins && requires.bins.length > 0) {
    if (!requires.bins.every((bin) => binaryExists({ name: bin }))) return false;
  }

  if (requires.anyBins && requires.anyBins.length > 0) {
    if (!requires.anyBins.some((bin) => binaryExists({ name: bin }))) return false;
  }

  if (requires.env && requires.env.length > 0) {
    const primaryEnv = openclaw?.primaryEnv;
    const hasApiKeyInConfig = Boolean(entry?.apiKey);

    for (const envVar of requires.env) {
      if (process.env[envVar]) continue;
      if (primaryEnv === envVar && hasApiKeyInConfig) continue;
      return false;
    }
  }

  if (requires.config && requires.config.length > 0) {
    for (const configPath of requires.config) {
      if (!getConfigValue({ config: fullConfig, path: configPath })) return false;
    }
  }

  return true;
}

export function binaryExists({ name }: { name: string }): boolean {
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function getConfigValue({
  config,
  path,
}: {
  config: Record<string, unknown>;
  path: string;
}): unknown {
  const segments = path.split(".");
  let current: unknown = config;

  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
