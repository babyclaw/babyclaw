import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapWorkspace,
  readBootstrapGuide,
  readHeartbeatInstructions,
  readWorkspaceGuide,
} from "./bootstrap.js";
import { ALL_TEMPLATES } from "./templates.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);

const WS = "/tmp/test-workspace";

function enoent(): Error {
  const err = new Error("ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("bootstrapWorkspace", () => {
  it("writes all templates in a fresh workspace (no personality files)", async () => {
    mockedReadFile.mockRejectedValue(enoent());
    mockedWriteFile.mockResolvedValue();

    await bootstrapWorkspace({ workspacePath: WS });

    expect(mockedWriteFile).toHaveBeenCalledTimes(ALL_TEMPLATES.length);
    for (const tpl of ALL_TEMPLATES) {
      expect(mockedWriteFile).toHaveBeenCalledWith(
        join(WS, tpl.filename),
        tpl.content,
        "utf8",
      );
    }
  });

  it("skips BOOTSTRAP.md when IDENTITY.md exists (existing workspace)", async () => {
    mockedReadFile.mockImplementation(async (path: any) => {
      if (String(path) === join(WS, "IDENTITY.md"))
        return Buffer.from("exists");
      throw enoent();
    });
    mockedWriteFile.mockResolvedValue();

    await bootstrapWorkspace({ workspacePath: WS });

    const writtenFiles = mockedWriteFile.mock.calls.map(([p]) => String(p));
    expect(writtenFiles).not.toContain(join(WS, "BOOTSTRAP.md"));
    expect(writtenFiles).not.toContain(join(WS, "IDENTITY.md"));
  });

  it("skips BOOTSTRAP.md when SOUL.md exists (existing workspace)", async () => {
    mockedReadFile.mockImplementation(async (path: any) => {
      if (String(path) === join(WS, "SOUL.md")) return Buffer.from("exists");
      throw enoent();
    });
    mockedWriteFile.mockResolvedValue();

    await bootstrapWorkspace({ workspacePath: WS });

    const writtenFiles = mockedWriteFile.mock.calls.map(([p]) => String(p));
    expect(writtenFiles).not.toContain(join(WS, "BOOTSTRAP.md"));
    expect(writtenFiles).not.toContain(join(WS, "SOUL.md"));
  });

  it("skips files that already exist on disk", async () => {
    mockedReadFile.mockImplementation(async (path: any) => {
      if (String(path) === join(WS, "AGENTS.md"))
        return Buffer.from("existing content");
      throw enoent();
    });
    mockedWriteFile.mockResolvedValue();

    await bootstrapWorkspace({ workspacePath: WS });

    const writtenFiles = mockedWriteFile.mock.calls.map(([p]) => String(p));
    expect(writtenFiles).not.toContain(join(WS, "AGENTS.md"));
    expect(writtenFiles).toContain(join(WS, "BOOTSTRAP.md"));
  });

  it("writes nothing when all template files already exist", async () => {
    mockedReadFile.mockResolvedValue(Buffer.from("exists"));
    mockedWriteFile.mockResolvedValue();

    await bootstrapWorkspace({ workspacePath: WS });

    expect(mockedWriteFile).not.toHaveBeenCalled();
  });
});

describe("readWorkspaceGuide", () => {
  it("returns content when AGENTS.md exists and is non-empty", async () => {
    mockedReadFile.mockResolvedValue("# My Guide\nSome content" as any);

    const result = await readWorkspaceGuide({ workspacePath: WS });

    expect(mockedReadFile).toHaveBeenCalledWith(
      join(WS, "AGENTS.md"),
      "utf8",
    );
    expect(result).toBe("# My Guide\nSome content");
  });

  it("returns undefined when AGENTS.md does not exist", async () => {
    mockedReadFile.mockRejectedValue(enoent());

    const result = await readWorkspaceGuide({ workspacePath: WS });

    expect(result).toBeUndefined();
  });

  it("returns undefined when AGENTS.md is empty", async () => {
    mockedReadFile.mockResolvedValue("   \n  " as any);

    const result = await readWorkspaceGuide({ workspacePath: WS });

    expect(result).toBeUndefined();
  });
});

describe("readBootstrapGuide", () => {
  it("returns content when BOOTSTRAP.md exists and is non-empty", async () => {
    mockedReadFile.mockResolvedValue("# Bootstrap\nDo stuff" as any);

    const result = await readBootstrapGuide({ workspacePath: WS });

    expect(mockedReadFile).toHaveBeenCalledWith(
      join(WS, "BOOTSTRAP.md"),
      "utf8",
    );
    expect(result).toBe("# Bootstrap\nDo stuff");
  });

  it("returns undefined when BOOTSTRAP.md does not exist", async () => {
    mockedReadFile.mockRejectedValue(enoent());

    const result = await readBootstrapGuide({ workspacePath: WS });

    expect(result).toBeUndefined();
  });

  it("returns undefined when BOOTSTRAP.md is empty", async () => {
    mockedReadFile.mockResolvedValue("  " as any);

    const result = await readBootstrapGuide({ workspacePath: WS });

    expect(result).toBeUndefined();
  });
});

describe("readHeartbeatInstructions", () => {
  it("returns null when HEARTBEAT.md does not exist", async () => {
    mockedReadFile.mockRejectedValue(enoent());

    const result = await readHeartbeatInstructions({ workspacePath: WS });

    expect(result).toBeNull();
  });

  it("returns null when HEARTBEAT.md is empty", async () => {
    mockedReadFile.mockResolvedValue("  \n  " as any);

    const result = await readHeartbeatInstructions({ workspacePath: WS });

    expect(result).toBeNull();
  });

  it("returns null when HEARTBEAT.md contains only headers and blank lines", async () => {
    mockedReadFile.mockResolvedValue(
      "# HEARTBEAT.md\n\n# Some heading\n\n" as any,
    );

    const result = await readHeartbeatInstructions({ workspacePath: WS });

    expect(result).toBeNull();
  });

  it("returns raw content when HEARTBEAT.md has meaningful lines", async () => {
    const content = "# HEARTBEAT.md\n\nCheck emails every 2 hours\n";
    mockedReadFile.mockResolvedValue(content as any);

    const result = await readHeartbeatInstructions({ workspacePath: WS });

    expect(result).toBe(content.trim());
  });

  it("returns raw content when meaningful text is mixed with headers", async () => {
    const content = "# Tasks\n\n- Check inbox\n- Review calendar\n";
    mockedReadFile.mockResolvedValue(content as any);

    const result = await readHeartbeatInstructions({ workspacePath: WS });

    expect(result).toBe(content.trim());
  });
});
