import { join } from "node:path";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFileSync: mockExecFileSync }));
vi.mock("node:fs", () => ({ existsSync: mockExistsSync }));
vi.mock("../workspace/skills/eligibility.js", () => ({
  clearBinaryExistsCache: vi.fn(),
}));

import {
  augmentProcessPath,
  buildAugmentedPath,
  getToolBinDirs,
  resetToolBinDirsCache,
} from "./env-path.js";
import { clearBinaryExistsCache } from "../workspace/skills/eligibility.js";

const home = homedir();

function failAllProbes() {
  mockExecFileSync.mockImplementation(() => {
    throw new Error("not found");
  });
}

beforeEach(() => {
  resetToolBinDirsCache();
  vi.clearAllMocks();
  delete process.env.GOBIN;
  delete process.env.GOPATH;
});

describe("getToolBinDirs", () => {
  it("returns well-known dirs that exist on disk", () => {
    failAllProbes();
    mockExistsSync.mockImplementation((p: string) => p.includes(".local/bin"));

    const dirs = getToolBinDirs();
    expect(dirs.length).toBeGreaterThanOrEqual(1);
    expect(dirs.some((d) => d.includes(".local/bin"))).toBe(true);
    expect(dirs.some((d) => d.includes(".cargo/bin"))).toBe(false);
  });

  it("includes uv tool bin dir when uv is available", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "uv") return "/custom/uv/bin\n";
      throw new Error("not found");
    });
    mockExistsSync.mockImplementation((p: string) => p === "/custom/uv/bin");

    const dirs = getToolBinDirs();
    expect(dirs[0]).toBe("/custom/uv/bin");
  });

  it("includes npm global bin dir when npm is available", () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === "npm") return "/home/user/.nvm/versions/node/v20/\n";
      throw new Error("not found");
    });
    const npmBin = join("/home/user/.nvm/versions/node/v20", "bin");
    mockExistsSync.mockImplementation((p: string) => p === npmBin);

    const dirs = getToolBinDirs();
    expect(dirs).toContain(npmBin);
  });

  it("includes GOBIN when set", () => {
    failAllProbes();
    process.env.GOBIN = "/custom/go/bin";
    mockExistsSync.mockImplementation((p: string) => p === "/custom/go/bin");

    const dirs = getToolBinDirs();
    expect(dirs).toContain("/custom/go/bin");
  });

  it("includes GOPATH/bin when GOPATH is set", () => {
    failAllProbes();
    process.env.GOPATH = "/home/user/mygo";
    const goPathBin = join("/home/user/mygo", "bin");
    mockExistsSync.mockImplementation((p: string) => p === goPathBin);

    const dirs = getToolBinDirs();
    expect(dirs).toContain(goPathBin);
  });

  it("includes /opt/homebrew/bin when it exists", () => {
    failAllProbes();
    mockExistsSync.mockImplementation((p: string) => p === "/opt/homebrew/bin");

    const dirs = getToolBinDirs();
    expect(dirs).toContain("/opt/homebrew/bin");
  });

  it("includes linuxbrew bin when it exists", () => {
    failAllProbes();
    mockExistsSync.mockImplementation((p: string) => p === "/home/linuxbrew/.linuxbrew/bin");

    const dirs = getToolBinDirs();
    expect(dirs).toContain("/home/linuxbrew/.linuxbrew/bin");
  });

  it("deduplicates when uv bin dir matches a well-known dir", () => {
    const localBin = join(home, ".local", "bin");
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === "uv") return localBin + "\n";
      throw new Error("not found");
    });
    mockExistsSync.mockImplementation((p: string) => p === localBin);

    const dirs = getToolBinDirs();
    const count = dirs.filter((d) => d === localBin).length;
    expect(count).toBe(1);
  });

  it("caches results across calls", () => {
    failAllProbes();
    mockExistsSync.mockReturnValue(false);

    getToolBinDirs();
    const firstCallCount = mockExistsSync.mock.calls.length;

    getToolBinDirs();
    expect(mockExistsSync).toHaveBeenCalledTimes(firstCallCount);
  });

  it("re-probes when refresh is true", () => {
    failAllProbes();
    mockExistsSync.mockReturnValue(false);

    getToolBinDirs();
    const firstCallCount = mockExistsSync.mock.calls.length;

    getToolBinDirs({ refresh: true });
    expect(mockExistsSync.mock.calls.length).toBe(firstCallCount * 2);
  });

  it("handles probe timeouts gracefully", () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error("timeout"), { killed: true });
    });
    mockExistsSync.mockReturnValue(false);

    expect(() => getToolBinDirs()).not.toThrow();
  });
});

describe("buildAugmentedPath", () => {
  it("prepends discovered dirs to the base path", () => {
    failAllProbes();
    mockExistsSync.mockImplementation((p: string) => p.includes(".local/bin"));

    const result = buildAugmentedPath({ basePath: "/usr/bin:/bin" });
    expect(result).toMatch(/\.local\/bin/);
    expect(result.endsWith(":/usr/bin:/bin")).toBe(true);
  });

  it("does not duplicate dirs already in base path", () => {
    const localBin = join(home, ".local", "bin");
    failAllProbes();
    mockExistsSync.mockImplementation((p: string) => p === localBin);

    const base = `/usr/bin:${localBin}:/bin`;
    const result = buildAugmentedPath({ basePath: base });
    expect(result).toBe(base);
  });

  it("returns base path unchanged when no dirs discovered", () => {
    failAllProbes();
    mockExistsSync.mockReturnValue(false);

    const base = "/usr/bin:/bin";
    expect(buildAugmentedPath({ basePath: base })).toBe(base);
  });
});

describe("augmentProcessPath", () => {
  const originalPath = process.env.PATH;

  afterEach(() => {
    process.env.PATH = originalPath;
  });

  it("mutates process.env.PATH and clears binary cache", () => {
    failAllProbes();
    mockExistsSync.mockImplementation((p: string) => p.includes(".cargo/bin"));
    process.env.PATH = "/usr/bin:/bin";

    augmentProcessPath();

    expect(process.env.PATH).toMatch(/\.cargo\/bin/);
    expect(clearBinaryExistsCache).toHaveBeenCalled();
  });

  it("does not clear cache when PATH is unchanged", () => {
    failAllProbes();
    mockExistsSync.mockReturnValue(false);
    process.env.PATH = "/usr/bin:/bin";

    augmentProcessPath();

    expect(clearBinaryExistsCache).not.toHaveBeenCalled();
  });
});
