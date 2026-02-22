import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillEntry, SkillsConfig } from "../workspace/skills/types.js";

vi.mock("../ai/prompts.js", () => ({
  readToolNotes: vi.fn(async () => null),
}));

vi.mock("../onboarding/personality.js", () => ({
  readPersonalityFiles: vi.fn(async () => ({})),
  hasCompletePersonalityFiles: vi.fn(() => false),
}));

vi.mock("../workspace/bootstrap.js", () => ({
  readWorkspaceGuide: vi.fn(async () => null),
}));

const mockWorkspaceSkills: SkillEntry[] = [];
const mockBundledSkills: SkillEntry[] = [];

vi.mock("../workspace/skills/index.js", () => ({
  scanWorkspaceSkills: vi.fn(async () => []),
  getEligibleSkills: vi.fn(() => mockWorkspaceSkills),
}));

vi.mock("../bundled-skills/index.js", () => ({
  getEnabledBundledSkills: vi.fn(() => mockBundledSkills),
}));

import { loadAgentContext } from "./context.js";

const emptyConfig: SkillsConfig = { entries: {} };
const emptyFullConfig: Record<string, unknown> = {};

afterEach(() => {
  mockWorkspaceSkills.length = 0;
  mockBundledSkills.length = 0;
});

function makeSkill(overrides: { slug: string; name?: string; relativePath?: string }): SkillEntry {
  return {
    slug: overrides.slug,
    relativePath: overrides.relativePath ?? `skills/${overrides.slug}/SKILL.md`,
    frontmatter: {
      name: overrides.name ?? overrides.slug,
      description: `${overrides.slug} skill`,
      userInvocable: true,
      disableModelInvocation: false,
    },
  };
}

describe("loadAgentContext", () => {
  it("returns workspace skills when no bundled skills exist", async () => {
    const ws = makeSkill({ slug: "weather" });
    mockWorkspaceSkills.push(ws);

    const result = await loadAgentContext({
      workspacePath: "/tmp/test",
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].slug).toBe("weather");
  });

  it("returns bundled skills when no workspace skills exist", async () => {
    const bundled = makeSkill({
      slug: "browser-use",
      relativePath: "bundled-skills/browser-use/SKILL.md",
    });
    mockBundledSkills.push(bundled);

    const result = await loadAgentContext({
      workspacePath: "/tmp/test",
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].slug).toBe("browser-use");
  });

  it("workspace skills take precedence over bundled skills with same slug", async () => {
    const wsSkill = makeSkill({
      slug: "weather",
      name: "weather-workspace",
      relativePath: "skills/weather/SKILL.md",
    });
    const bundledSkill = makeSkill({
      slug: "weather",
      name: "weather-bundled",
      relativePath: "bundled-skills/weather/SKILL.md",
    });
    mockWorkspaceSkills.push(wsSkill);
    mockBundledSkills.push(bundledSkill);

    const result = await loadAgentContext({
      workspacePath: "/tmp/test",
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].frontmatter.name).toBe("weather-workspace");
    expect(result.skills[0].relativePath).toBe("skills/weather/SKILL.md");
  });

  it("includes non-overlapping bundled skills alongside workspace skills", async () => {
    mockWorkspaceSkills.push(makeSkill({ slug: "weather" }));
    mockBundledSkills.push(
      makeSkill({
        slug: "browser-use",
        relativePath: "bundled-skills/browser-use/SKILL.md",
      }),
    );

    const result = await loadAgentContext({
      workspacePath: "/tmp/test",
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });

    expect(result.skills).toHaveLength(2);
    const slugs = result.skills.map((s) => s.slug);
    expect(slugs).toContain("weather");
    expect(slugs).toContain("browser-use");
  });

  it("workspace skills appear before bundled skills in the list", async () => {
    mockWorkspaceSkills.push(makeSkill({ slug: "ws-skill" }));
    mockBundledSkills.push(
      makeSkill({ slug: "bundled-skill", relativePath: "bundled-skills/bundled-skill/SKILL.md" }),
    );

    const result = await loadAgentContext({
      workspacePath: "/tmp/test",
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });

    expect(result.skills[0].slug).toBe("ws-skill");
    expect(result.skills[1].slug).toBe("bundled-skill");
  });
});
