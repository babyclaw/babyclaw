import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockGetSkillInfo,
  mockGetSkillVersionFiles,
  mockGetSkillFileContent,
  mockExistsSync,
  mockMkdir,
  mockWriteFile,
} = vi.hoisted(() => ({
  mockGetSkillInfo: vi.fn(),
  mockGetSkillVersionFiles: vi.fn(),
  mockGetSkillFileContent: vi.fn(),
  mockExistsSync: vi.fn(),
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock("./client.js", () => ({
  getSkillInfo: (...args: unknown[]) => mockGetSkillInfo(...args),
  getSkillVersionFiles: (...args: unknown[]) =>
    mockGetSkillVersionFiles(...args),
  getSkillFileContent: (...args: unknown[]) =>
    mockGetSkillFileContent(...args),
  ClawHubError: class extends Error {
    statusCode: number;
    slug: string;
    constructor({
      statusCode,
      slug,
      message,
    }: {
      statusCode: number;
      slug: string;
      message: string;
    }) {
      super(message);
      this.statusCode = statusCode;
      this.slug = slug;
    }
  },
}));

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

import {
  installSkillFromClawHub,
  SkillAlreadyInstalledError,
} from "./installer.js";
import { ClawHubError } from "./client.js";

function makeSkillInfo(overrides: Record<string, unknown> = {}) {
  return {
    skill: { slug: "test-skill", displayName: "Test Skill" },
    latestVersion: { version: "1.0.0", createdAt: 1000, changelog: "" },
    moderation: { isSuspicious: false, isMalwareBlocked: false },
    ...overrides,
  };
}

function makeVersionDetail(
  files = [
    {
      path: "SKILL.md",
      size: 100,
      sha256: "abc",
      contentType: "text/markdown",
    },
  ],
) {
  return {
    skill: { slug: "test-skill", displayName: "Test Skill" },
    version: { version: "1.0.0", createdAt: 1000, changelog: "", files },
  };
}

describe("SkillAlreadyInstalledError", () => {
  it("exposes slug and skillPath", () => {
    const err = new SkillAlreadyInstalledError({
      slug: "my-skill",
      skillPath: "/ws/skills/my-skill",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.slug).toBe("my-skill");
    expect(err.skillPath).toBe("/ws/skills/my-skill");
    expect(err.message).toContain("already installed");
  });
});

describe("installSkillFromClawHub", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(false);
  });

  it("normalizes slug to trimmed lowercase", async () => {
    mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
    mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
    mockGetSkillFileContent.mockResolvedValueOnce("content");

    const result = await installSkillFromClawHub({
      slug: "  My-Skill  ",
      workspacePath: "/ws",
    });

    expect(result.slug).toBe("my-skill");
    expect(mockGetSkillInfo).toHaveBeenCalledWith({ slug: "my-skill" });
  });

  describe("malware blocking", () => {
    it("throws ClawHubError when skill is malware-blocked", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(
        makeSkillInfo({
          moderation: { isSuspicious: false, isMalwareBlocked: true },
        }),
      );

      const err = await installSkillFromClawHub({
        slug: "evil-skill",
        workspacePath: "/ws",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(ClawHubError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain("malicious");
      expect(err.message).toContain("VirusTotal");
      expect(mockGetSkillVersionFiles).not.toHaveBeenCalled();
    });

    it("proceeds when moderation is null", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(
        makeSkillInfo({ moderation: null }),
      );
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
      mockGetSkillFileContent.mockResolvedValueOnce("content");

      const result = await installSkillFromClawHub({
        slug: "test-skill",
        workspacePath: "/ws",
      });

      expect(result.slug).toBe("test-skill");
    });

    it("proceeds when isMalwareBlocked is false", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
      mockGetSkillFileContent.mockResolvedValueOnce("content");

      const result = await installSkillFromClawHub({
        slug: "test-skill",
        workspacePath: "/ws",
      });

      expect(result.slug).toBe("test-skill");
    });
  });

  describe("version resolution", () => {
    it("uses explicit version when provided", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
      mockGetSkillFileContent.mockResolvedValueOnce("content");

      const result = await installSkillFromClawHub({
        slug: "test-skill",
        version: "2.5.0",
        workspacePath: "/ws",
      });

      expect(result.version).toBe("2.5.0");
      expect(mockGetSkillVersionFiles).toHaveBeenCalledWith({
        slug: "test-skill",
        version: "2.5.0",
      });
    });

    it("falls back to latestVersion when no explicit version given", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
      mockGetSkillFileContent.mockResolvedValueOnce("content");

      const result = await installSkillFromClawHub({
        slug: "test-skill",
        workspacePath: "/ws",
      });

      expect(result.version).toBe("1.0.0");
    });

    it("throws when no version is available at all", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(
        makeSkillInfo({ latestVersion: null }),
      );

      await expect(
        installSkillFromClawHub({ slug: "test-skill", workspacePath: "/ws" }),
      ).rejects.toThrow("no published versions");
    });
  });

  describe("already-installed check", () => {
    it("throws SkillAlreadyInstalledError when dir exists and force is false", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
      mockExistsSync.mockReturnValueOnce(true);

      const err = await installSkillFromClawHub({
        slug: "test-skill",
        workspacePath: "/ws",
      }).catch((e) => e);

      expect(err).toBeInstanceOf(SkillAlreadyInstalledError);
      expect(err.slug).toBe("test-skill");
      expect(err.skillPath).toContain("skills/test-skill");
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("proceeds when dir exists and force is true", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
      mockGetSkillFileContent.mockResolvedValueOnce("content");
      mockExistsSync.mockReturnValueOnce(true);

      const result = await installSkillFromClawHub({
        slug: "test-skill",
        workspacePath: "/ws",
        force: true,
      });

      expect(result.slug).toBe("test-skill");
      expect(mockWriteFile).toHaveBeenCalled();
    });
  });

  describe("file writing", () => {
    it("creates directories and writes each file", async () => {
      const files = [
        {
          path: "SKILL.md",
          size: 10,
          sha256: "a",
          contentType: "text/markdown",
        },
        {
          path: "scripts/setup.sh",
          size: 20,
          sha256: "b",
          contentType: "text/plain",
        },
      ];
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail(files));
      mockGetSkillFileContent
        .mockResolvedValueOnce("# Skill")
        .mockResolvedValueOnce("#!/bin/bash");

      const result = await installSkillFromClawHub({
        slug: "test-skill",
        workspacePath: "/ws",
      });

      expect(result.files).toEqual(["SKILL.md", "scripts/setup.sh"]);

      expect(mockMkdir).toHaveBeenCalledTimes(2);
      expect(mockMkdir).toHaveBeenCalledWith("/ws/skills/test-skill", {
        recursive: true,
      });
      expect(mockMkdir).toHaveBeenCalledWith("/ws/skills/test-skill/scripts", {
        recursive: true,
      });

      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/ws/skills/test-skill/SKILL.md",
        "# Skill",
        "utf8",
      );
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/ws/skills/test-skill/scripts/setup.sh",
        "#!/bin/bash",
        "utf8",
      );
    });

    it("fetches each file with the resolved version", async () => {
      const files = [
        { path: "a.md", size: 1, sha256: "x", contentType: null },
        { path: "b.md", size: 1, sha256: "y", contentType: null },
      ];
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail(files));
      mockGetSkillFileContent
        .mockResolvedValueOnce("a")
        .mockResolvedValueOnce("b");

      await installSkillFromClawHub({
        slug: "test-skill",
        version: "3.0.0",
        workspacePath: "/ws",
      });

      expect(mockGetSkillFileContent).toHaveBeenCalledWith({
        slug: "test-skill",
        path: "a.md",
        version: "3.0.0",
      });
      expect(mockGetSkillFileContent).toHaveBeenCalledWith({
        slug: "test-skill",
        path: "b.md",
        version: "3.0.0",
      });
    });

    it("handles skills with no files", async () => {
      mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
      mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail([]));

      const result = await installSkillFromClawHub({
        slug: "test-skill",
        workspacePath: "/ws",
      });

      expect(result.files).toEqual([]);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockMkdir).not.toHaveBeenCalled();
    });
  });

  it("returns the correct result shape", async () => {
    mockGetSkillInfo.mockResolvedValueOnce(makeSkillInfo());
    mockGetSkillVersionFiles.mockResolvedValueOnce(makeVersionDetail());
    mockGetSkillFileContent.mockResolvedValueOnce("content");

    const result = await installSkillFromClawHub({
      slug: "test-skill",
      workspacePath: "/ws",
    });

    expect(result).toEqual({
      slug: "test-skill",
      version: "1.0.0",
      displayName: "Test Skill",
      files: ["SKILL.md"],
      skillPath: "/ws/skills/test-skill",
    });
  });
});
