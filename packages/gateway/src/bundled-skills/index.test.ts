import { afterEach, describe, expect, it, vi } from "vitest";
import type { SkillsConfig } from "../workspace/skills/types.js";

const MOCK_SLUGS = ["weather", "git-helper", "internal-only"];
const MOCK_SKILLS: Record<string, string> = {
  weather: [
    "---",
    "name: weather",
    "description: Get weather forecasts",
    'metadata: \'{"openclaw": {"requires": {"bins": ["curl"]}}}\'',
    "---",
    "Use curl to fetch weather.",
  ].join("\n"),
  "git-helper": [
    "---",
    "name: git-helper",
    "description: Git utilities",
    "---",
    "Use git commands.",
  ].join("\n"),
  "internal-only": [
    "---",
    "name: internal-only",
    "description: Internal dispatch skill",
    "disable-model-invocation: true",
    "---",
    "Internal use only.",
  ].join("\n"),
};

vi.mock("@babyclaw/skills", () => ({
  listBundledSlugs: () => MOCK_SLUGS,
  readBundledSkillContent: ({ slug }: { slug: string }) => MOCK_SKILLS[slug] ?? null,
  getBundledSkillInfo: ({ slug }: { slug: string }) => {
    if (MOCK_SLUGS.includes(slug)) {
      return {
        slug,
        skillDir: `/pkg/skills/${slug}`,
        skillFilePath: `/pkg/skills/${slug}/SKILL.md`,
      };
    }
    return null;
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { execFileSync } from "node:child_process";
import { listBundledSkills, getEnabledBundledSkills, getBundledSkillPath } from "./index.js";

const mockedExecFileSync = vi.mocked(execFileSync);
const emptyConfig: SkillsConfig = { entries: {} };
const emptyFullConfig: Record<string, unknown> = {};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listBundledSkills", () => {
  it("returns all bundled skills with correct metadata", () => {
    const result = listBundledSkills({ skillsConfig: emptyConfig, fullConfig: emptyFullConfig });
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.slug)).toEqual(["weather", "git-helper", "internal-only"]);
  });

  it("marks skills as disabled by default", () => {
    const result = listBundledSkills({ skillsConfig: emptyConfig, fullConfig: emptyFullConfig });
    expect(result.every((s) => s.enabled === false)).toBe(true);
  });

  it("marks skill as enabled when config says so", () => {
    const config: SkillsConfig = { entries: { weather: { enabled: true } } };
    const result = listBundledSkills({ skillsConfig: config, fullConfig: emptyFullConfig });
    const weather = result.find((s) => s.slug === "weather")!;
    expect(weather.enabled).toBe(true);
  });

  it("marks skill as ineligible when required bins are missing", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const result = listBundledSkills({ skillsConfig: emptyConfig, fullConfig: emptyFullConfig });
    const weather = result.find((s) => s.slug === "weather")!;
    expect(weather.eligible).toBe(false);
    expect(weather.ineligibilityReason).toContain("curl");
  });

  it("marks skill as eligible when no requirements", () => {
    const result = listBundledSkills({ skillsConfig: emptyConfig, fullConfig: emptyFullConfig });
    const git = result.find((s) => s.slug === "git-helper")!;
    expect(git.eligible).toBe(true);
    expect(git.ineligibilityReason).toBeNull();
  });

  it("marks skill as ineligible when disableModelInvocation is true", () => {
    const result = listBundledSkills({ skillsConfig: emptyConfig, fullConfig: emptyFullConfig });
    const internal = result.find((s) => s.slug === "internal-only")!;
    expect(internal.eligible).toBe(false);
    expect(internal.ineligibilityReason).toContain("Model invocation disabled");
  });
});

describe("getEnabledBundledSkills", () => {
  it("returns empty when nothing is enabled", () => {
    const result = getEnabledBundledSkills({
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(0);
  });

  it("returns enabled and eligible skills as SkillEntry", () => {
    const config: SkillsConfig = {
      entries: { "git-helper": { enabled: true } },
    };
    const result = getEnabledBundledSkills({ skillsConfig: config, fullConfig: emptyFullConfig });
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("git-helper");
    expect(result[0].relativePath).toBe("bundled-skills/git-helper/SKILL.md");
    expect(result[0].frontmatter.name).toBe("git-helper");
  });

  it("excludes enabled but ineligible skills", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const config: SkillsConfig = {
      entries: { weather: { enabled: true } },
    };
    const result = getEnabledBundledSkills({ skillsConfig: config, fullConfig: emptyFullConfig });
    expect(result).toHaveLength(0);
  });
});

describe("getBundledSkillPath", () => {
  it("returns the skill directory path", () => {
    expect(getBundledSkillPath({ slug: "weather" })).toBe("/pkg/skills/weather");
  });

  it("returns null for unknown slug", () => {
    expect(getBundledSkillPath({ slug: "nope" })).toBeNull();
  });
});
