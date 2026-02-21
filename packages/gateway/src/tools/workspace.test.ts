import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createWorkspaceTools } from "./workspace.js";

let workspaceRoot: string;
let tools: ReturnType<typeof createWorkspaceTools>;

const toolOpts = { messages: [], toolCallId: "t1", abortSignal: new AbortController().signal };

function exec(toolName: string, input: Record<string, unknown>) {
  const t = tools[toolName];
  return t.execute!(input as any, toolOpts as any);
}

beforeEach(async () => {
  workspaceRoot = join(tmpdir(), `ws-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(workspaceRoot, { recursive: true });

  const context: ToolExecutionContext = {
    workspaceRoot,
    botTimezone: "UTC",
    runSource: "chat",
    isMainSession: false,
  };

  tools = createWorkspaceTools({ context });
});

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// workspace_read
// ---------------------------------------------------------------------------
describe("workspace_read", () => {
  it("reads a text file", async () => {
    await writeFile(join(workspaceRoot, "hello.txt"), "world");

    const result: any = await exec("workspace_read", { path: "hello.txt", format: "text" });

    expect(result.ok).toBe(true);
    expect(result.content).toBe("world");
    expect(result.format).toBe("text");
  });

  it("reads a json file and returns parsed value", async () => {
    await writeFile(join(workspaceRoot, "data.json"), JSON.stringify({ x: 1 }));

    const result: any = await exec("workspace_read", { path: "data.json", format: "json" });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ x: 1 });
    expect(result.format).toBe("json");
  });

  it("returns error for invalid json", async () => {
    await writeFile(join(workspaceRoot, "bad.json"), "not-json{");

    const result: any = await exec("workspace_read", { path: "bad.json", format: "json" });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_JSON");
  });

  it("returns error for missing file", async () => {
    const result: any = await exec("workspace_read", { path: "nope.txt", format: "text" });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("WORKSPACE_READ_FAILED");
  });
});

// ---------------------------------------------------------------------------
// workspace_write
// ---------------------------------------------------------------------------
describe("workspace_write", () => {
  it("creates a new text file", async () => {
    const result: any = await exec("workspace_write", {
      path: "new.txt",
      format: "text",
      mode: "create",
      content: "hello",
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("create");
    expect(await readFile(join(workspaceRoot, "new.txt"), "utf8")).toBe("hello");
  });

  it("creates parent directories automatically", async () => {
    const result: any = await exec("workspace_write", {
      path: "deep/nested/file.txt",
      format: "text",
      mode: "create",
      content: "deep",
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(workspaceRoot, "deep/nested/file.txt"), "utf8")).toBe("deep");
  });

  it("fails to create when file already exists", async () => {
    await writeFile(join(workspaceRoot, "exists.txt"), "original");

    const result: any = await exec("workspace_write", {
      path: "exists.txt",
      format: "text",
      mode: "create",
      content: "new",
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("FILE_ALREADY_EXISTS");
  });

  it("overwrites an existing file", async () => {
    await writeFile(join(workspaceRoot, "target.txt"), "old");

    const result: any = await exec("workspace_write", {
      path: "target.txt",
      format: "text",
      mode: "overwrite",
      content: "new",
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(workspaceRoot, "target.txt"), "utf8")).toBe("new");
  });

  it("fails to overwrite a missing file", async () => {
    const result: any = await exec("workspace_write", {
      path: "missing.txt",
      format: "text",
      mode: "overwrite",
      content: "new",
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("FILE_NOT_FOUND");
  });

  it("appends to a file", async () => {
    await writeFile(join(workspaceRoot, "log.txt"), "line1\n");

    const result: any = await exec("workspace_write", {
      path: "log.txt",
      format: "text",
      mode: "append",
      content: "line2\n",
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(workspaceRoot, "log.txt"), "utf8")).toBe("line1\nline2\n");
  });

  it("append creates the file if it does not exist", async () => {
    const result: any = await exec("workspace_write", {
      path: "fresh.txt",
      format: "text",
      mode: "append",
      content: "first",
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(workspaceRoot, "fresh.txt"), "utf8")).toBe("first");
  });

  it("creates a json file with pretty-printed content", async () => {
    const result: any = await exec("workspace_write", {
      path: "config.json",
      format: "json",
      mode: "create",
      value: { key: "val" },
    });

    expect(result.ok).toBe(true);
    const raw = await readFile(join(workspaceRoot, "config.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ key: "val" });
    expect(raw).toContain("\n");
  });

  it("rejects json format without value", async () => {
    const result: any = await exec("workspace_write", {
      path: "bad.json",
      format: "json",
      mode: "create",
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("rejects json format with append mode", async () => {
    const result: any = await exec("workspace_write", {
      path: "data.json",
      format: "json",
      mode: "append",
      value: { a: 1 },
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_MODE");
  });

  it("rejects text format without content", async () => {
    const result: any = await exec("workspace_write", {
      path: "empty.txt",
      format: "text",
      mode: "create",
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// workspace_list
// ---------------------------------------------------------------------------
describe("workspace_list", () => {
  it("lists files and directories sorted alphabetically", async () => {
    await writeFile(join(workspaceRoot, "b.txt"), "b");
    await writeFile(join(workspaceRoot, "a.txt"), "a");
    await mkdir(join(workspaceRoot, "c_dir"));

    const result: any = await exec("workspace_list", { path: ".", recursive: false, limit: 100 });

    expect(result.ok).toBe(true);
    const paths = result.items.map((i: any) => i.path);
    expect(paths).toEqual(["a.txt", "b.txt", "c_dir"]);
  });

  it("lists entries recursively", async () => {
    await mkdir(join(workspaceRoot, "sub"), { recursive: true });
    await writeFile(join(workspaceRoot, "root.txt"), "r");
    await writeFile(join(workspaceRoot, "sub/child.txt"), "c");

    const result: any = await exec("workspace_list", { path: ".", recursive: true, limit: 100 });

    expect(result.ok).toBe(true);
    const paths = result.items.map((i: any) => i.path);
    expect(paths).toContain("root.txt");
    expect(paths).toContain("sub");
    expect(paths).toContain("sub/child.txt");
  });

  it("does not recurse when recursive=false", async () => {
    await mkdir(join(workspaceRoot, "sub"), { recursive: true });
    await writeFile(join(workspaceRoot, "sub/hidden.txt"), "h");

    const result: any = await exec("workspace_list", { path: ".", recursive: false, limit: 100 });

    const paths = result.items.map((i: any) => i.path);
    expect(paths).toContain("sub");
    expect(paths).not.toContain("sub/hidden.txt");
  });

  it("paginates with limit and returns next_cursor", async () => {
    await writeFile(join(workspaceRoot, "a.txt"), "a");
    await writeFile(join(workspaceRoot, "b.txt"), "b");
    await writeFile(join(workspaceRoot, "c.txt"), "c");

    const page1: any = await exec("workspace_list", { path: ".", recursive: false, limit: 2 });

    expect(page1.ok).toBe(true);
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).toBe("b.txt");

    const page2: any = await exec("workspace_list", {
      path: ".",
      recursive: false,
      limit: 2,
      cursor: page1.next_cursor,
    });

    expect(page2.ok).toBe(true);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].path).toBe("c.txt");
    expect(page2.next_cursor).toBeNull();
  });

  it("returns empty items when cursor is past end", async () => {
    await writeFile(join(workspaceRoot, "a.txt"), "a");

    const result: any = await exec("workspace_list", {
      path: ".",
      recursive: false,
      limit: 100,
      cursor: "z.txt",
    });

    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.next_cursor).toBeNull();
  });

  it("includes correct type for files and directories", async () => {
    await writeFile(join(workspaceRoot, "file.txt"), "f");
    await mkdir(join(workspaceRoot, "dir"));

    const result: any = await exec("workspace_list", { path: ".", recursive: false, limit: 100 });

    const file = result.items.find((i: any) => i.path === "file.txt");
    const dir = result.items.find((i: any) => i.path === "dir");
    expect(file.type).toBe("file");
    expect(dir.type).toBe("directory");
  });
});

// ---------------------------------------------------------------------------
// workspace_delete
// ---------------------------------------------------------------------------
describe("workspace_delete", () => {
  it("deletes a file", async () => {
    await writeFile(join(workspaceRoot, "doomed.txt"), "bye");

    const result: any = await exec("workspace_delete", { path: "doomed.txt", recursive: false });

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(true);
  });

  it("rejects deleting a directory without recursive=true", async () => {
    await mkdir(join(workspaceRoot, "keeper"));

    const result: any = await exec("workspace_delete", { path: "keeper", recursive: false });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("DIRECTORY_RECURSIVE_REQUIRED");
  });

  it("deletes a directory recursively", async () => {
    await mkdir(join(workspaceRoot, "tree/sub"), { recursive: true });
    await writeFile(join(workspaceRoot, "tree/sub/f.txt"), "x");

    const result: any = await exec("workspace_delete", { path: "tree", recursive: true });

    expect(result.ok).toBe(true);
    expect(result.deleted).toBe(true);
  });

  it("returns error for missing path", async () => {
    const result: any = await exec("workspace_delete", { path: "ghost.txt", recursive: false });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("WORKSPACE_DELETE_FAILED");
  });
});

// ---------------------------------------------------------------------------
// workspace_move
// ---------------------------------------------------------------------------
describe("workspace_move", () => {
  it("moves a file to a new location", async () => {
    await writeFile(join(workspaceRoot, "src.txt"), "data");

    const result: any = await exec("workspace_move", {
      from_path: "src.txt",
      to_path: "dst.txt",
      overwrite: false,
    });

    expect(result.ok).toBe(true);
    expect(result.overwritten).toBe(false);
    expect(await readFile(join(workspaceRoot, "dst.txt"), "utf8")).toBe("data");
  });

  it("creates parent directories for destination", async () => {
    await writeFile(join(workspaceRoot, "file.txt"), "data");

    const result: any = await exec("workspace_move", {
      from_path: "file.txt",
      to_path: "new/dir/file.txt",
      overwrite: false,
    });

    expect(result.ok).toBe(true);
    expect(await readFile(join(workspaceRoot, "new/dir/file.txt"), "utf8")).toBe("data");
  });

  it("fails when source does not exist", async () => {
    const result: any = await exec("workspace_move", {
      from_path: "missing.txt",
      to_path: "dst.txt",
      overwrite: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("FILE_NOT_FOUND");
  });

  it("fails when destination exists and overwrite=false", async () => {
    await writeFile(join(workspaceRoot, "a.txt"), "a");
    await writeFile(join(workspaceRoot, "b.txt"), "b");

    const result: any = await exec("workspace_move", {
      from_path: "a.txt",
      to_path: "b.txt",
      overwrite: false,
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("DESTINATION_EXISTS");
  });

  it("overwrites destination when overwrite=true", async () => {
    await writeFile(join(workspaceRoot, "a.txt"), "new");
    await writeFile(join(workspaceRoot, "b.txt"), "old");

    const result: any = await exec("workspace_move", {
      from_path: "a.txt",
      to_path: "b.txt",
      overwrite: true,
    });

    expect(result.ok).toBe(true);
    expect(result.overwritten).toBe(true);
    expect(await readFile(join(workspaceRoot, "b.txt"), "utf8")).toBe("new");
  });
});
