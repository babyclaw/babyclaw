import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSubPath,
  normalizeSeparators,
  pathExists,
  resolveBundledSkillPath,
  resolveWorkspacePath,
} from "./path.js";

const WORKSPACE = "/tmp/test-workspace";

describe("resolveWorkspacePath", () => {
  it("resolves a relative path within workspace", () => {
    const result = resolveWorkspacePath({
      workspaceRoot: WORKSPACE,
      requestedPath: "notes.txt",
    });
    expect(result).toBe(resolve(WORKSPACE, "notes.txt"));
  });

  it("resolves nested relative paths", () => {
    const result = resolveWorkspacePath({
      workspaceRoot: WORKSPACE,
      requestedPath: "sub/dir/file.md",
    });
    expect(result).toBe(resolve(WORKSPACE, "sub/dir/file.md"));
  });

  it("allows the workspace root itself (dot path)", () => {
    const result = resolveWorkspacePath({
      workspaceRoot: WORKSPACE,
      requestedPath: ".",
    });
    expect(result).toBe(resolve(WORKSPACE));
  });

  it("normalizes backslashes to forward slashes", () => {
    const result = resolveWorkspacePath({
      workspaceRoot: WORKSPACE,
      requestedPath: "sub\\dir\\file.txt",
    });
    expect(result).toBe(resolve(WORKSPACE, "sub/dir/file.txt"));
  });

  it("throws on empty path", () => {
    expect(() => resolveWorkspacePath({ workspaceRoot: WORKSPACE, requestedPath: "" })).toThrow(
      "Path is required",
    );
  });

  it("throws on whitespace-only path", () => {
    expect(() => resolveWorkspacePath({ workspaceRoot: WORKSPACE, requestedPath: "   " })).toThrow(
      "Path is required",
    );
  });

  it("throws on path traversal with ../", () => {
    expect(() =>
      resolveWorkspacePath({
        workspaceRoot: WORKSPACE,
        requestedPath: "../../../etc/passwd",
      }),
    ).toThrow("Path escapes workspace root");
  });

  it("throws on absolute path outside workspace", () => {
    expect(() =>
      resolveWorkspacePath({
        workspaceRoot: WORKSPACE,
        requestedPath: "/etc/passwd",
      }),
    ).toThrow("Path escapes workspace root");
  });
});

describe("normalizeSeparators", () => {
  it("replaces backslashes with forward slashes", () => {
    expect(normalizeSeparators({ path: "a\\b\\c" })).toBe("a/b/c");
  });

  it("leaves forward slashes untouched", () => {
    expect(normalizeSeparators({ path: "a/b/c" })).toBe("a/b/c");
  });

  it("handles mixed separators", () => {
    expect(normalizeSeparators({ path: "a\\b/c\\d" })).toBe("a/b/c/d");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeSeparators({ path: "" })).toBe("");
  });
});

describe("isSubPath", () => {
  it("returns true when child is directly inside parent", () => {
    expect(isSubPath({ parent: "/a/b", child: `/a/b${sep}c` })).toBe(true);
  });

  it("returns true when child equals parent", () => {
    expect(isSubPath({ parent: "/a/b", child: "/a/b" })).toBe(true);
  });

  it("returns false when child is outside parent", () => {
    expect(isSubPath({ parent: "/a/b", child: "/a/c" })).toBe(false);
  });

  it("returns false for prefix-collision paths", () => {
    expect(isSubPath({ parent: "/a/b", child: "/a/bc" })).toBe(false);
  });

  it("handles parent with trailing separator", () => {
    expect(isSubPath({ parent: `/a/b${sep}`, child: `/a/b${sep}c` })).toBe(true);
  });
});

const BUNDLED_DIR = "/tmp/test-bundled-skills";

describe("resolveBundledSkillPath", () => {
  it("resolves a valid bundled skill path", () => {
    const result = resolveBundledSkillPath({
      bundledSkillsDir: BUNDLED_DIR,
      requestedPath: "bundled-skills/weather/SKILL.md",
    });
    expect(result).toBe(resolve(BUNDLED_DIR, "weather/SKILL.md"));
  });

  it("throws on path traversal", () => {
    expect(() =>
      resolveBundledSkillPath({
        bundledSkillsDir: BUNDLED_DIR,
        requestedPath: "bundled-skills/../../etc/passwd",
      }),
    ).toThrow("Path escapes bundled skills root");
  });

  it("throws on empty relative path after prefix", () => {
    expect(() =>
      resolveBundledSkillPath({
        bundledSkillsDir: BUNDLED_DIR,
        requestedPath: "bundled-skills/",
      }),
    ).toThrow("Path is required");
  });
});

describe("pathExists", () => {
  let tempDir: string;

  it("returns true for a path that exists", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "path-test-"));
    const filePath = join(tempDir, "exists.txt");
    await writeFile(filePath, "hello");

    expect(await pathExists({ absolutePath: filePath })).toBe(true);
    await rm(tempDir, { recursive: true });
  });

  it("returns false for a path that does not exist", async () => {
    expect(await pathExists({ absolutePath: "/tmp/__does_not_exist_12345__" })).toBe(false);
  });
});
