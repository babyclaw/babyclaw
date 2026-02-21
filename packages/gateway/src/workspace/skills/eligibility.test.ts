import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  binaryExists,
  getConfigValue,
  getEligibleSkills,
} from "./eligibility.js";
import type { SkillEntry, SkillsConfig } from "./types.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

function makeSkill(overrides: Partial<SkillEntry["frontmatter"]> = {}): SkillEntry {
  return {
    slug: "test-skill",
    relativePath: "skills/test-skill.md",
    frontmatter: {
      name: "test-skill",
      description: "A test skill",
      userInvocable: true,
      disableModelInvocation: false,
      ...overrides,
    },
  };
}

const emptyConfig: SkillsConfig = { entries: {} };
const emptyFullConfig: Record<string, unknown> = {};

describe("getEligibleSkills", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns all skills when none are filtered out", () => {
    const skills = [makeSkill({ name: "a" }), makeSkill({ name: "b" })];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(2);
  });

  it("returns empty array when all skills are filtered out", () => {
    const skills = [
      makeSkill({ name: "a", disableModelInvocation: true }),
      makeSkill({ name: "b", disableModelInvocation: true }),
    ];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(0);
  });

  it("returns only eligible skills from a mixed set", () => {
    const skills = [
      makeSkill({ name: "keep" }),
      makeSkill({ name: "drop", disableModelInvocation: true }),
    ];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(1);
    expect(result[0].frontmatter.name).toBe("keep");
  });
});

describe("shouldIncludeSkill (via getEligibleSkills)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("excludes skill when entry.enabled is false", () => {
    const skills = [makeSkill({ name: "disabled-skill" })];
    const skillsConfig: SkillsConfig = {
      entries: { "disabled-skill": { enabled: false } },
    };
    const result = getEligibleSkills({
      skills,
      skillsConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(0);
  });

  it("includes skill when entry.enabled is true", () => {
    const skills = [makeSkill({ name: "enabled-skill" })];
    const skillsConfig: SkillsConfig = {
      entries: { "enabled-skill": { enabled: true } },
    };
    const result = getEligibleSkills({
      skills,
      skillsConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(1);
  });

  it("uses openclaw.skillKey over frontmatter.name for config lookup", () => {
    const skills = [
      makeSkill({
        name: "original-name",
        openclaw: { skillKey: "custom-key" },
      }),
    ];
    const skillsConfig: SkillsConfig = {
      entries: { "custom-key": { enabled: false } },
    };
    const result = getEligibleSkills({
      skills,
      skillsConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(0);
  });

  it("excludes skill when disableModelInvocation is true", () => {
    const skills = [makeSkill({ disableModelInvocation: true })];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(0);
  });

  it("excludes skill when OS does not match", () => {
    const skills = [
      makeSkill({
        openclaw: { os: ["win32"] },
      }),
    ];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    if (process.platform === "win32") {
      expect(result).toHaveLength(1);
    } else {
      expect(result).toHaveLength(0);
    }
  });

  it("includes skill when current OS is in the list", () => {
    const skills = [
      makeSkill({
        openclaw: { os: [process.platform] },
      }),
    ];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(1);
  });

  it("includes skill when os array is empty (no restriction)", () => {
    const skills = [makeSkill({ openclaw: { os: [] } })];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(1);
  });

  it("includes skill unconditionally when openclaw.always is true", () => {
    const skills = [
      makeSkill({
        openclaw: {
          always: true,
          requires: { bins: ["nonexistent-binary-xyz"] },
        },
      }),
    ];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(1);
  });

  it("includes skill when there are no requires at all", () => {
    const skills = [makeSkill({ openclaw: {} })];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(1);
  });

  it("includes skill when openclaw is undefined (no requires)", () => {
    const skills = [makeSkill()];
    const result = getEligibleSkills({
      skills,
      skillsConfig: emptyConfig,
      fullConfig: emptyFullConfig,
    });
    expect(result).toHaveLength(1);
  });

  describe("requires.bins", () => {
    it("includes skill when all required binaries exist", () => {
      mockedExecFileSync.mockReturnValue(Buffer.from(""));
      const skills = [
        makeSkill({
          openclaw: { requires: { bins: ["node", "git"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(1);
    });

    it("excludes skill when a required binary is missing", () => {
      mockedExecFileSync
        .mockReturnValueOnce(Buffer.from(""))
        .mockImplementationOnce(() => {
          throw new Error("not found");
        });
      const skills = [
        makeSkill({
          openclaw: { requires: { bins: ["node", "missing-bin"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("requires.anyBins", () => {
    it("includes skill when at least one binary exists", () => {
      mockedExecFileSync
        .mockImplementationOnce(() => {
          throw new Error("not found");
        })
        .mockReturnValueOnce(Buffer.from(""));
      const skills = [
        makeSkill({
          openclaw: { requires: { anyBins: ["missing", "found"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(1);
    });

    it("excludes skill when no binaries exist", () => {
      mockedExecFileSync.mockImplementation(() => {
        throw new Error("not found");
      });
      const skills = [
        makeSkill({
          openclaw: { requires: { anyBins: ["missing1", "missing2"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("requires.env", () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = originalEnv;
    });

    it("includes skill when all required env vars are set", () => {
      process.env = { ...originalEnv, MY_KEY: "value", OTHER_KEY: "val2" };
      const skills = [
        makeSkill({
          openclaw: { requires: { env: ["MY_KEY", "OTHER_KEY"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(1);
    });

    it("excludes skill when a required env var is missing", () => {
      process.env = { ...originalEnv };
      delete process.env.MISSING_VAR;
      const skills = [
        makeSkill({
          openclaw: { requires: { env: ["MISSING_VAR"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(0);
    });

    it("includes skill when env var is missing but has apiKey in config for primaryEnv", () => {
      process.env = { ...originalEnv };
      delete process.env.API_KEY_VAR;
      const skills = [
        makeSkill({
          name: "api-skill",
          openclaw: {
            primaryEnv: "API_KEY_VAR",
            requires: { env: ["API_KEY_VAR"] },
          },
        }),
      ];
      const skillsConfig: SkillsConfig = {
        entries: { "api-skill": { enabled: true, apiKey: "secret" } },
      };
      const result = getEligibleSkills({
        skills,
        skillsConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(1);
    });

    it("excludes skill when env var is missing and primaryEnv does not match", () => {
      process.env = { ...originalEnv };
      delete process.env.SOME_KEY;
      const skills = [
        makeSkill({
          name: "mismatch-skill",
          openclaw: {
            primaryEnv: "OTHER_KEY",
            requires: { env: ["SOME_KEY"] },
          },
        }),
      ];
      const skillsConfig: SkillsConfig = {
        entries: { "mismatch-skill": { enabled: true, apiKey: "secret" } },
      };
      const result = getEligibleSkills({
        skills,
        skillsConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(0);
    });

    it("excludes skill when env var matches primaryEnv but apiKey is absent", () => {
      process.env = { ...originalEnv };
      delete process.env.API_KEY_VAR;
      const skills = [
        makeSkill({
          name: "no-apikey",
          openclaw: {
            primaryEnv: "API_KEY_VAR",
            requires: { env: ["API_KEY_VAR"] },
          },
        }),
      ];
      const skillsConfig: SkillsConfig = {
        entries: { "no-apikey": { enabled: true } },
      };
      const result = getEligibleSkills({
        skills,
        skillsConfig,
        fullConfig: emptyFullConfig,
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("requires.config", () => {
    it("includes skill when all required config paths are truthy", () => {
      const skills = [
        makeSkill({
          openclaw: { requires: { config: ["telegram.token"] } },
        }),
      ];
      const fullConfig = { telegram: { token: "abc123" } };
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig,
      });
      expect(result).toHaveLength(1);
    });

    it("excludes skill when a required config path is missing", () => {
      const skills = [
        makeSkill({
          openclaw: { requires: { config: ["telegram.token"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: { telegram: {} },
      });
      expect(result).toHaveLength(0);
    });

    it("excludes skill when config path resolves to a falsy value", () => {
      const skills = [
        makeSkill({
          openclaw: { requires: { config: ["feature.enabled"] } },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: { feature: { enabled: false } },
      });
      expect(result).toHaveLength(0);
    });
  });

  describe("combined requirements", () => {
    it("passes when bins, env and config all satisfy", () => {
      const origEnv = process.env;
      process.env = { ...origEnv, SOME_ENV: "1" };
      mockedExecFileSync.mockReturnValue(Buffer.from(""));

      const skills = [
        makeSkill({
          openclaw: {
            requires: {
              bins: ["node"],
              env: ["SOME_ENV"],
              config: ["db.host"],
            },
          },
        }),
      ];
      const result = getEligibleSkills({
        skills,
        skillsConfig: emptyConfig,
        fullConfig: { db: { host: "localhost" } },
      });
      expect(result).toHaveLength(1);
      process.env = origEnv;
    });
  });
});

describe("binaryExists", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true when 'which' succeeds", () => {
    mockedExecFileSync.mockReturnValue(Buffer.from("/usr/bin/node"));
    expect(binaryExists({ name: "node" })).toBe(true);
    expect(mockedExecFileSync).toHaveBeenCalledWith("which", ["node"], {
      stdio: "ignore",
    });
  });

  it("returns false when 'which' throws", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(binaryExists({ name: "nonexistent" })).toBe(false);
  });
});

describe("getConfigValue", () => {
  it("returns the value at a simple key", () => {
    expect(getConfigValue({ config: { key: "val" }, path: "key" })).toBe("val");
  });

  it("returns the value at a nested path", () => {
    const config = { a: { b: { c: 42 } } };
    expect(getConfigValue({ config, path: "a.b.c" })).toBe(42);
  });

  it("returns undefined for a missing key", () => {
    expect(getConfigValue({ config: {}, path: "missing" })).toBeUndefined();
  });

  it("returns undefined when traversal hits a non-object", () => {
    const config = { a: "string" };
    expect(getConfigValue({ config, path: "a.b" })).toBeUndefined();
  });

  it("returns undefined when traversal hits null", () => {
    const config = { a: null } as unknown as Record<string, unknown>;
    expect(getConfigValue({ config, path: "a.b" })).toBeUndefined();
  });

  it("returns the full object when path resolves to an object", () => {
    const nested = { x: 1 };
    const config = { top: nested };
    expect(getConfigValue({ config, path: "top" })).toBe(nested);
  });
});
