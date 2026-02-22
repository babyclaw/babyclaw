import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let tempDir: string;
let skillsDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "skills-test-"));
  skillsDir = join(tempDir, "skills");
  mkdirSync(skillsDir);

  mkdirSync(join(skillsDir, "weather"));
  writeFileSync(
    join(skillsDir, "weather", "SKILL.md"),
    "---\nname: weather\ndescription: Get weather\n---\nUse curl.",
  );

  mkdirSync(join(skillsDir, "nested", "sub"), { recursive: true });
  writeFileSync(
    join(skillsDir, "nested", "SKILL.md"),
    "---\nname: nested\ndescription: Nested\n---\n",
  );
  writeFileSync(join(skillsDir, "nested", "sub", "helper.md"), "helper");

  mkdirSync(join(skillsDir, "no-skill"));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

vi.mock("node:url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:url")>();
  return {
    ...actual,
    fileURLToPath: () => join(tempDir, "dist", "index.js"),
  };
});

describe("listBundledSlugs", () => {
  it("returns slugs for directories with SKILL.md", async () => {
    const { listBundledSlugs } = await import("./index.js");
    const slugs = listBundledSlugs();
    expect(slugs).toContain("weather");
    expect(slugs).toContain("nested");
  });

  it("excludes directories without SKILL.md", async () => {
    const { listBundledSlugs } = await import("./index.js");
    const slugs = listBundledSlugs();
    expect(slugs).not.toContain("no-skill");
  });

  it("returns sorted slugs", async () => {
    const { listBundledSlugs } = await import("./index.js");
    const slugs = listBundledSlugs();
    expect(slugs).toEqual([...slugs].sort());
  });
});

describe("getBundledSkillInfo", () => {
  it("returns info for an existing skill", async () => {
    const { getBundledSkillInfo } = await import("./index.js");
    const info = getBundledSkillInfo({ slug: "weather" });
    expect(info).not.toBeNull();
    expect(info!.slug).toBe("weather");
    expect(info!.skillFilePath).toContain("SKILL.md");
  });

  it("returns null for a nonexistent skill", async () => {
    const { getBundledSkillInfo } = await import("./index.js");
    expect(getBundledSkillInfo({ slug: "nope" })).toBeNull();
  });

  it("returns null for a directory without SKILL.md", async () => {
    const { getBundledSkillInfo } = await import("./index.js");
    expect(getBundledSkillInfo({ slug: "no-skill" })).toBeNull();
  });
});

describe("readBundledSkillContent", () => {
  it("reads SKILL.md content", async () => {
    const { readBundledSkillContent } = await import("./index.js");
    const content = readBundledSkillContent({ slug: "weather" });
    expect(content).toContain("name: weather");
    expect(content).toContain("Use curl.");
  });

  it("returns null for nonexistent skill", async () => {
    const { readBundledSkillContent } = await import("./index.js");
    expect(readBundledSkillContent({ slug: "nope" })).toBeNull();
  });
});

describe("listBundledSkillFiles", () => {
  it("lists all files recursively", async () => {
    const { listBundledSkillFiles } = await import("./index.js");
    const files = listBundledSkillFiles({ slug: "nested" });
    expect(files).toContain("SKILL.md");
    expect(files).toContain("sub/helper.md");
  });

  it("returns empty array for nonexistent skill", async () => {
    const { listBundledSkillFiles } = await import("./index.js");
    expect(listBundledSkillFiles({ slug: "nope" })).toEqual([]);
  });
});
