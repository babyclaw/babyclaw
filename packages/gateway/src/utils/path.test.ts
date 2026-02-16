import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "./path.js";

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
    expect(() =>
      resolveWorkspacePath({ workspaceRoot: WORKSPACE, requestedPath: "" }),
    ).toThrow("Path is required");
  });

  it("throws on whitespace-only path", () => {
    expect(() =>
      resolveWorkspacePath({ workspaceRoot: WORKSPACE, requestedPath: "   " }),
    ).toThrow("Path is required");
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
