import { execFileSync } from "node:child_process";
import { getSkillKey, type SkillEntry, type SkillFrontmatter, type SkillsConfig } from "./types.js";

export type EligibilityResult = { eligible: boolean; reason: string | null };

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
  return skills.filter((skill) => {
    const { frontmatter, slug } = skill;
    const entry = skillsConfig.entries[getSkillKey({ frontmatter, slug })];

    // Workspace skills are opt-out: enabled by default, disabled only when explicitly set to false.
    if (entry?.enabled === false) return false;

    return checkSkillEligibility({ frontmatter, skillsConfig, fullConfig }).eligible;
  });
}

export function checkSkillEligibility({
  frontmatter,
  skillsConfig,
  fullConfig,
}: {
  frontmatter: SkillFrontmatter;
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
}): EligibilityResult {
  if (frontmatter.disableModelInvocation) {
    return { eligible: false, reason: "Model invocation disabled" };
  }

  const openclaw = frontmatter.openclaw;

  if (openclaw?.os && openclaw.os.length > 0) {
    if (!openclaw.os.includes(process.platform)) {
      return {
        eligible: false,
        reason: `Requires OS: ${openclaw.os.join(", ")} (current: ${process.platform})`,
      };
    }
  }

  if (openclaw?.always) {
    return { eligible: true, reason: null };
  }

  const requires = openclaw?.requires;
  if (!requires) {
    return { eligible: true, reason: null };
  }

  if (requires.bins && requires.bins.length > 0) {
    const missing = requires.bins.filter((bin) => !binaryExists({ name: bin }));
    if (missing.length > 0) {
      return { eligible: false, reason: `Missing binaries: ${missing.join(", ")}` };
    }
  }

  if (requires.anyBins && requires.anyBins.length > 0) {
    if (!requires.anyBins.some((bin) => binaryExists({ name: bin }))) {
      return {
        eligible: false,
        reason: `Requires at least one of: ${requires.anyBins.join(", ")}`,
      };
    }
  }

  if (requires.env && requires.env.length > 0) {
    const skillKey = openclaw?.skillKey ?? frontmatter.name;
    const entry = skillsConfig.entries[skillKey];
    const primaryEnv = openclaw?.primaryEnv;
    const hasApiKeyInConfig = Boolean(entry?.apiKey);

    for (const envVar of requires.env) {
      if (process.env[envVar]) continue;
      if (primaryEnv === envVar && hasApiKeyInConfig) continue;
      return { eligible: false, reason: `Missing environment variable: ${envVar}` };
    }
  }

  if (requires.config && requires.config.length > 0) {
    for (const configPath of requires.config) {
      if (!getConfigValue({ config: fullConfig, path: configPath })) {
        return { eligible: false, reason: `Missing config value: ${configPath}` };
      }
    }
  }

  return { eligible: true, reason: null };
}

const binaryExistsCache = new Map<string, boolean>();

export function clearBinaryExistsCache(): void {
  binaryExistsCache.clear();
}

export function binaryExists({ name }: { name: string }): boolean {
  const cached = binaryExistsCache.get(name);
  if (cached !== undefined) return cached;

  let exists: boolean;
  try {
    execFileSync("which", [name], { stdio: "ignore" });
    exists = true;
  } catch {
    exists = false;
  }

  binaryExistsCache.set(name, exists);
  return exists;
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
