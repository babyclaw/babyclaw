import { listBundledSlugs, readBundledSkillContent, getBundledSkillInfo } from "@babyclaw/skills";
import { parseFrontmatter, buildFrontmatter } from "../workspace/skills/scanner.js";
import type { SkillEntry, SkillFrontmatter, SkillsConfig } from "../workspace/skills/types.js";
import { binaryExists, getConfigValue } from "../workspace/skills/eligibility.js";

export type BundledSkillStatus = {
  slug: string;
  frontmatter: SkillFrontmatter | null;
  enabled: boolean;
  eligible: boolean;
  ineligibilityReason: string | null;
};

export function listBundledSkills({
  skillsConfig,
  fullConfig,
}: {
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
}): BundledSkillStatus[] {
  const slugs = listBundledSlugs();

  return slugs.map((slug) => {
    const content = readBundledSkillContent({ slug });
    if (!content) {
      return {
        slug,
        frontmatter: null,
        enabled: false,
        eligible: false,
        ineligibilityReason: "Could not read SKILL.md",
      };
    }

    const raw = parseFrontmatter({ content });
    const frontmatter = raw ? buildFrontmatter({ raw }) : null;

    const skillKey = frontmatter?.openclaw?.skillKey ?? frontmatter?.name ?? slug;
    const entry = skillsConfig.entries[skillKey];
    const enabled = entry?.enabled === true;

    const { eligible, reason } = checkBundledEligibility({
      frontmatter,
      skillsConfig,
      fullConfig,
    });

    return {
      slug,
      frontmatter,
      enabled,
      eligible,
      ineligibilityReason: reason,
    };
  });
}

export function getEnabledBundledSkills({
  skillsConfig,
  fullConfig,
}: {
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
}): SkillEntry[] {
  const all = listBundledSkills({ skillsConfig, fullConfig });

  return all
    .filter((s) => s.enabled && s.eligible && s.frontmatter)
    .map((s) => ({
      frontmatter: s.frontmatter!,
      slug: s.slug,
      relativePath: `bundled-skills/${s.slug}/SKILL.md`,
    }));
}

export function getBundledSkillPath({ slug }: { slug: string }): string | null {
  const info = getBundledSkillInfo({ slug });
  return info?.skillDir ?? null;
}

function checkBundledEligibility({
  frontmatter,
  skillsConfig,
  fullConfig,
}: {
  frontmatter: SkillFrontmatter | null;
  skillsConfig: SkillsConfig;
  fullConfig: Record<string, unknown>;
}): { eligible: boolean; reason: string | null } {
  if (!frontmatter) {
    return { eligible: false, reason: "Invalid frontmatter" };
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
      return {
        eligible: false,
        reason: `Missing binaries: ${missing.join(", ")}`,
      };
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
