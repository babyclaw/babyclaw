import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { createClawhubTools } from "./clawhub.js";

const { mockInstallSkill, mockRunSkillSetup } = vi.hoisted(() => ({
  mockInstallSkill: vi.fn(),
  mockRunSkillSetup: vi.fn(),
}));

vi.mock("../clawhub/installer.js", () => ({
  installSkillFromClawHub: (...args: unknown[]) => mockInstallSkill(...args),
  SkillAlreadyInstalledError: class extends Error {
    slug: string;
    skillPath: string;
    constructor({ slug, skillPath }: { slug: string; skillPath: string }) {
      super(`Already installed: ${slug}`);
      this.slug = slug;
      this.skillPath = skillPath;
    }
  },
}));

vi.mock("../clawhub/client.js", () => ({
  ClawHubError: class extends Error {
    statusCode: number;
    slug: string;
    constructor({ statusCode, slug, message }: { statusCode: number; slug: string; message: string }) {
      super(message);
      this.statusCode = statusCode;
      this.slug = slug;
    }
  },
}));

vi.mock("../clawhub/skill-setup.js", () => ({
  runSkillSetup: (...args: unknown[]) => mockRunSkillSetup(...args),
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

function toolOptions() {
  return { messages: [] as any[], toolCallId: "1", abortSignal: new AbortController().signal };
}

function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    workspaceRoot: "/workspace",
    botTimezone: "UTC",
    runSource: "chat",
    isMainSession: true,
    chatId: "chat-1",
    ...overrides,
  };
}

const INSTALL_RESULT = {
  slug: "weather-cli",
  version: "1.0.0",
  displayName: "Weather CLI",
  files: ["SKILL.md"],
  skillPath: "/workspace/skills/weather-cli",
};

describe("clawhub_install", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockInstallSkill.mockResolvedValue(INSTALL_RESULT);
  });

  it("installs and runs setup when model is provided", async () => {
    mockRunSkillSetup.mockResolvedValueOnce({
      skipped: false,
      agentResponse: "Installed weather-cli via brew.",
    });

    const fakeModel = { id: "test-model" } as any;
    const tools = createClawhubTools({ context: makeContext(), model: fakeModel });

    const result = await tools.clawhub_install.execute!(
      { slug: "weather-cli", force: false, skipSetup: false },
      toolOptions(),
    );

    expect(mockInstallSkill).toHaveBeenCalledOnce();
    expect(mockRunSkillSetup).toHaveBeenCalledWith({
      model: fakeModel,
      skillPath: "/workspace/skills/weather-cli",
      workspacePath: "/workspace",
    });

    expect(result).toMatchObject({
      ok: true,
      slug: "weather-cli",
      setupSummary: "Installed weather-cli via brew.",
      message: expect.stringContaining("installed and set up"),
    });
  });

  it("installs without setup when skipSetup is true", async () => {
    const fakeModel = { id: "test-model" } as any;
    const tools = createClawhubTools({ context: makeContext(), model: fakeModel });

    const result = await tools.clawhub_install.execute!(
      { slug: "weather-cli", force: false, skipSetup: true },
      toolOptions(),
    );

    expect(mockInstallSkill).toHaveBeenCalledOnce();
    expect(mockRunSkillSetup).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      ok: true,
      slug: "weather-cli",
      setupSummary: undefined,
    });
  });

  it("installs without setup when no model is provided", async () => {
    const tools = createClawhubTools({ context: makeContext() });

    const result = await tools.clawhub_install.execute!(
      { slug: "weather-cli", force: false, skipSetup: false },
      toolOptions(),
    );

    expect(mockRunSkillSetup).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      setupSummary: undefined,
      message: expect.not.stringContaining("set up"),
    });
  });

  it("reports setup as skipped when no setup steps found", async () => {
    mockRunSkillSetup.mockResolvedValueOnce({
      skipped: true,
      agentResponse: "",
    });

    const tools = createClawhubTools({ context: makeContext(), model: {} as any });

    const result = await tools.clawhub_install.execute!(
      { slug: "weather-cli", force: false, skipSetup: false },
      toolOptions(),
    );

    expect(mockRunSkillSetup).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      setupSummary: undefined,
      message: expect.not.stringContaining("set up"),
    });
  });

  it("handles setup failure gracefully (non-fatal)", async () => {
    mockRunSkillSetup.mockRejectedValueOnce(new Error("brew not found"));

    const tools = createClawhubTools({ context: makeContext(), model: {} as any });

    const result = await tools.clawhub_install.execute!(
      { slug: "weather-cli", force: false, skipSetup: false },
      toolOptions(),
    );

    expect(result).toMatchObject({
      ok: true,
      slug: "weather-cli",
      setupSummary: "Setup failed: brew not found",
      message: expect.stringContaining("installed and set up"),
    });
  });

  it("returns error for already-installed skill", async () => {
    const { SkillAlreadyInstalledError } = await import("../clawhub/installer.js");
    mockInstallSkill.mockRejectedValueOnce(
      new SkillAlreadyInstalledError({ slug: "test", skillPath: "/workspace/skills/test" }),
    );

    const tools = createClawhubTools({ context: makeContext() });

    const result = await tools.clawhub_install.execute!(
      { slug: "test", force: false, skipSetup: false },
      toolOptions(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: "SKILL_ALREADY_INSTALLED",
      }),
    });
    expect(mockRunSkillSetup).not.toHaveBeenCalled();
  });

  it("returns error for ClawHub API errors", async () => {
    const { ClawHubError } = await import("../clawhub/client.js");
    mockInstallSkill.mockRejectedValueOnce(
      new ClawHubError({ statusCode: 404, slug: "nope", message: "Not found" }),
    );

    const tools = createClawhubTools({ context: makeContext() });

    const result = await tools.clawhub_install.execute!(
      { slug: "nope", force: false, skipSetup: false },
      toolOptions(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: expect.objectContaining({
        code: "CLAWHUB_API_ERROR",
      }),
    });
    expect(mockRunSkillSetup).not.toHaveBeenCalled();
  });

  it("passes force flag through to installSkillFromClawHub", async () => {
    const tools = createClawhubTools({ context: makeContext() });

    await tools.clawhub_install.execute!(
      { slug: "test", force: true, skipSetup: true },
      toolOptions(),
    );

    expect(mockInstallSkill).toHaveBeenCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it("passes version through to installSkillFromClawHub", async () => {
    const tools = createClawhubTools({ context: makeContext() });

    await tools.clawhub_install.execute!(
      { slug: "test", version: "2.1.0", force: false, skipSetup: true },
      toolOptions(),
    );

    expect(mockInstallSkill).toHaveBeenCalledWith(
      expect.objectContaining({ version: "2.1.0" }),
    );
  });
});
