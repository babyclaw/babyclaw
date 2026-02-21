import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGenerateText, mockReadFile } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock("../logging/index.js", () => {
  const noop = () => {};
  const logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
    isLevelEnabled: () => false,
  };
  return { getLogger: () => logger };
});

vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
    stepCountIs: (n: number) => ({ type: "step-count", count: n }),
  };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual("node:fs/promises");
  return {
    ...actual,
    readFile: (...args: unknown[]) => mockReadFile(...args),
  };
});

vi.mock("../tools/shell.js", () => ({
  createShellTools: vi.fn(() => ({
    shell_exec: { execute: vi.fn() },
  })),
}));

import { buildSetupPrompt, runSkillSetup } from "./skill-setup.js";

const BREW_SKILL = `---
name: Weather CLI
description: Get weather forecasts
metadata:
  openclaw:
    install:
      - kind: brew
        formula: weather-cli
        bins: [weather]
        label: Weather CLI tool
---
# Weather CLI

Use this skill to check weather.
`;

const NODE_SKILL = `---
name: Linter
description: Code linting
metadata:
  openclaw:
    install:
      - kind: node
        package: eslint
        bins: [eslint]
---
Lint your code.
`;

const GO_SKILL = `---
name: Go Tool
description: A Go binary
metadata:
  openclaw:
    install:
      - kind: go
        module: github.com/example/tool
        bins: [tool]
---
`;

const UV_SKILL = `---
name: Python Tool
description: UV-based tool
metadata:
  openclaw:
    install:
      - kind: uv
        package: ruff
        bins: [ruff]
---
`;

const DOWNLOAD_SKILL_EXTRACT = `---
name: Binary Download
description: Download with extraction
metadata:
  openclaw:
    install:
      - kind: download
        url: https://example.com/tool.tar.gz
        archive: tool.tar.gz
        extract: true
        stripComponents: 1
        targetDir: /usr/local/bin
---
`;

const DOWNLOAD_SKILL_SIMPLE = `---
name: Binary Download
description: Simple download
metadata:
  openclaw:
    install:
      - kind: download
        url: https://example.com/binary
        archive: my-binary
---
`;

const OS_FILTERED_SKILL = `---
name: macOS Only
description: Only runs on macOS
metadata:
  openclaw:
    install:
      - kind: brew
        formula: macos-tool
        os: [darwin]
      - kind: brew
        formula: linux-tool
        os: [linux]
      - kind: node
        package: universal-tool
---
`;

const MULTI_SPEC_SKILL = `---
name: Full Stack
description: Multiple deps
metadata:
  openclaw:
    install:
      - kind: brew
        formula: redis
        bins: [redis-server, redis-cli]
      - kind: node
        package: prisma
        bins: [prisma]
      - kind: go
        module: github.com/example/migrate
        bins: [migrate]
---
## Setup

After installing the dependencies above, run:
\`\`\`
prisma generate
\`\`\`
`;

const NO_METADATA_SKILL = `---
name: Simple Skill
description: Just instructions, no metadata
---
## Installation

Run \`npm install -g my-tool\` to set up this skill.
`;

const EMPTY_SKILL = `---
name: Empty
description: Nothing to install
---
`;

const INVALID_SPEC_SKILL = `---
name: Bad Spec
description: Missing required fields
metadata:
  openclaw:
    install:
      - kind: brew
      - kind: node
      - kind: download
---
`;

describe("buildSetupPrompt", () => {
  describe("spec-to-command mapping", () => {
    it("generates brew install command", () => {
      const { prompt, hasSetupSteps } = buildSetupPrompt({ skillContent: BREW_SKILL });
      expect(hasSetupSteps).toBe(true);
      expect(prompt).toContain("`brew install weather-cli`");
      expect(prompt).toContain("Verify binaries after install: weather");
    });

    it("generates npm install -g command for node specs", () => {
      const { prompt } = buildSetupPrompt({ skillContent: NODE_SKILL });
      expect(prompt).toContain("`npm install -g eslint`");
      expect(prompt).toContain("Verify binaries after install: eslint");
    });

    it("generates go install command", () => {
      const { prompt } = buildSetupPrompt({ skillContent: GO_SKILL });
      expect(prompt).toContain("`go install github.com/example/tool@latest`");
    });

    it("generates uv tool install command", () => {
      const { prompt } = buildSetupPrompt({ skillContent: UV_SKILL });
      expect(prompt).toContain("`uv tool install ruff`");
    });

    it("generates curl + tar command for download with extraction", () => {
      const { prompt } = buildSetupPrompt({ skillContent: DOWNLOAD_SKILL_EXTRACT });
      expect(prompt).toContain("curl -fsSL https://example.com/tool.tar.gz | tar xz");
      expect(prompt).toContain("--strip-components=1");
      expect(prompt).toContain("-C /usr/local/bin");
    });

    it("generates curl -o command for simple download", () => {
      const { prompt } = buildSetupPrompt({ skillContent: DOWNLOAD_SKILL_SIMPLE });
      expect(prompt).toContain("`curl -fsSL -o my-binary https://example.com/binary`");
    });
  });

  describe("OS filtering", () => {
    it("includes specs matching current platform and universal specs", () => {
      const { prompt } = buildSetupPrompt({ skillContent: OS_FILTERED_SKILL });
      expect(prompt).toContain("`npm install -g universal-tool`");

      if (process.platform === "darwin") {
        expect(prompt).toContain("`brew install macos-tool`");
        expect(prompt).not.toContain("linux-tool");
      } else if (process.platform === "linux") {
        expect(prompt).toContain("`brew install linux-tool`");
        expect(prompt).not.toContain("macos-tool");
      }
    });
  });

  describe("full skill body inclusion", () => {
    it("includes the skill body after the structured specs", () => {
      const { prompt } = buildSetupPrompt({ skillContent: BREW_SKILL });
      expect(prompt).toContain("## Structured install specs from skill metadata");
      expect(prompt).toContain("## Full skill content");
      expect(prompt).toContain("Use this skill to check weather.");
    });

    it("includes body even without structured specs", () => {
      const { prompt, hasSetupSteps } = buildSetupPrompt({ skillContent: NO_METADATA_SKILL });
      expect(hasSetupSteps).toBe(true);
      expect(prompt).not.toContain("## Structured install specs");
      expect(prompt).toContain("## Full skill content");
      expect(prompt).toContain("npm install -g my-tool");
    });

    it("includes freeform setup instructions alongside specs", () => {
      const { prompt } = buildSetupPrompt({ skillContent: MULTI_SPEC_SKILL });
      expect(prompt).toContain("`brew install redis`");
      expect(prompt).toContain("`npm install -g prisma`");
      expect(prompt).toContain("prisma generate");
    });
  });

  describe("edge cases", () => {
    it("returns hasSetupSteps=false for skills with empty body and no specs", () => {
      const { hasSetupSteps, prompt } = buildSetupPrompt({ skillContent: EMPTY_SKILL });
      expect(hasSetupSteps).toBe(false);
      expect(prompt).toBe("");
    });

    it("handles specs with missing required fields gracefully", () => {
      const { prompt, hasSetupSteps } = buildSetupPrompt({ skillContent: INVALID_SPEC_SKILL });
      expect(hasSetupSteps).toBe(true);
      expect(prompt).toContain("unable to generate command");
    });

    it("handles content with no frontmatter", () => {
      const { hasSetupSteps, prompt } = buildSetupPrompt({
        skillContent: "# Just Markdown\n\nNo frontmatter here.",
      });
      expect(hasSetupSteps).toBe(true);
      expect(prompt).toContain("Just Markdown");
    });

    it("handles completely empty content", () => {
      const { hasSetupSteps } = buildSetupPrompt({ skillContent: "" });
      expect(hasSetupSteps).toBe(false);
    });

    it("handles multiple bins in verify list", () => {
      const { prompt } = buildSetupPrompt({ skillContent: MULTI_SPEC_SKILL });
      expect(prompt).toContain("Verify binaries after install: redis-server, redis-cli");
    });

    it("uses spec label when available, falls back to kind", () => {
      const { prompt } = buildSetupPrompt({ skillContent: BREW_SKILL });
      expect(prompt).toContain("[Weather CLI tool]");

      const { prompt: nodePrompt } = buildSetupPrompt({ skillContent: NODE_SKILL });
      expect(nodePrompt).toContain("[node]");
    });
  });
});

describe("runSkillSetup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("skips when SKILL.md does not exist", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));

    const result = await runSkillSetup({
      model: {} as any,
      skillPath: "/tmp/nonexistent",
      workspacePath: "/tmp",
    });

    expect(result.skipped).toBe(true);
    expect(result.agentResponse).toBe("");
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("skips when skill has no setup steps", async () => {
    mockReadFile.mockResolvedValueOnce("---\nname: Empty\ndescription: nope\n---\n");

    const result = await runSkillSetup({
      model: {} as any,
      skillPath: "/tmp/empty-skill",
      workspacePath: "/tmp",
    });

    expect(result.skipped).toBe(true);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("calls generateText with correct messages and tools when setup steps exist", async () => {
    mockReadFile.mockResolvedValueOnce(BREW_SKILL);

    mockGenerateText.mockResolvedValueOnce({
      text: "Installed weather-cli via brew.",
      steps: [{ toolCalls: [], toolResults: [] }],
    });

    const fakeModel = { id: "test-model" } as any;
    const result = await runSkillSetup({
      model: fakeModel,
      skillPath: "/tmp/weather",
      workspacePath: "/workspace",
    });

    expect(result.skipped).toBe(false);
    expect(result.agentResponse).toBe("Installed weather-cli via brew.");

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.model).toBe(fakeModel);
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe("system");
    expect(callArgs.messages[0].content).toContain("skill dependency installer");
    expect(callArgs.messages[1].role).toBe("user");
    expect(callArgs.messages[1].content).toContain("brew install weather-cli");
    expect(callArgs.tools).toHaveProperty("shell_exec");
  });

  it("uses full-access shell config", async () => {
    mockReadFile.mockResolvedValueOnce(BREW_SKILL);

    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      steps: [],
    });

    const { createShellTools } = vi.mocked(await import("../tools/shell.js"));

    await runSkillSetup({
      model: {} as any,
      skillPath: "/tmp/skill",
      workspacePath: "/workspace",
    });

    expect(createShellTools).toHaveBeenCalledWith(
      expect.objectContaining({
        shellConfig: { mode: "full-access", allowedCommands: [] },
      }),
    );
  });

  it("propagates errors from generateText", async () => {
    mockReadFile.mockResolvedValueOnce(BREW_SKILL);

    mockGenerateText.mockRejectedValueOnce(new Error("Model API failure"));

    await expect(
      runSkillSetup({
        model: {} as any,
        skillPath: "/tmp/skill",
        workspacePath: "/workspace",
      }),
    ).rejects.toThrow("Model API failure");
  });

  it("trims whitespace from agent response", async () => {
    mockReadFile.mockResolvedValueOnce(BREW_SKILL);

    mockGenerateText.mockResolvedValueOnce({
      text: "  Done with trailing spaces  \n",
      steps: [],
    });

    const result = await runSkillSetup({
      model: {} as any,
      skillPath: "/tmp/skill",
      workspacePath: "/workspace",
    });

    expect(result.agentResponse).toBe("Done with trailing spaces");
  });
});
