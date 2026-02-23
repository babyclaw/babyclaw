import { listBundledSlugs, readBundledSkillContent, getBundledSkillInfo } from "@babyclaw/skills";
import { parseFrontmatter, buildFrontmatter } from "../workspace/skills/scanner.js";
import {
  getSkillKey,
  type SkillEntry,
  type SkillFrontmatter,
  type SkillsConfig,
} from "../workspace/skills/types.js";
import { checkSkillEligibility } from "../workspace/skills/eligibility.js";

export type BundledSkillStatus = {
  slug: string;
  frontmatter: SkillFrontmatter | null;
  enabled: boolean;
  eligible: boolean;
  ineligibilityReason: string | null;
  hasInstallSpecs: boolean;
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
        hasInstallSpecs: false,
      };
    }

    const raw = parseFrontmatter({ content });
    const frontmatter = raw ? buildFrontmatter({ raw }) : null;

    const skillKey = getSkillKey({ frontmatter, slug });
    const entry = skillsConfig.entries[skillKey];
    // Bundled skills are opt-in: disabled by default, enabled only when explicitly set to true.
    const enabled = entry?.enabled === true;

    const { eligible, reason } = frontmatter
      ? checkSkillEligibility({ frontmatter, skillsConfig, fullConfig })
      : { eligible: false, reason: "Invalid frontmatter" };

    const hasInstallSpecs = (frontmatter?.openclaw?.install?.length ?? 0) > 0;

    return {
      slug,
      frontmatter,
      enabled,
      eligible,
      ineligibilityReason: reason,
      hasInstallSpecs,
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
