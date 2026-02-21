import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { createShellTools } from "../tools/shell.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import type { SkillInstallSpec } from "../workspace/skills/types.js";
import { parseFrontmatter, buildFrontmatter, FRONTMATTER_RE } from "../workspace/skills/scanner.js";
import { getLogger } from "../logging/index.js";

export type SkillSetupResult = {
  skipped: boolean;
  agentResponse: string;
};

type SetupPrompt = {
  prompt: string;
  hasSetupSteps: boolean;
};

type RunSkillSetupInput = {
  model: LanguageModel;
  skillPath: string;
  workspacePath: string;
};

const SETUP_SYSTEM_PROMPT = [
  "You are a skill dependency installer.",
  "Your job is to install the dependencies and prerequisites required by a skill.",
  "",
  "Instructions:",
  "1. If structured install specs are provided, execute them first using shell_exec.",
  "2. Then review the full skill body for any additional setup or install instructions that the structured metadata may not cover.",
  "3. Use shell_exec to run install commands. Verify each step succeeded before moving on.",
  "4. If a dependency is already installed, skip it.",
  "5. If an install step fails, report it but continue with remaining steps.",
  "6. When done, summarize what was installed and any failures.",
  "7. If there is nothing to install, say so briefly.",
  "",
  "Do NOT execute the skill itself -- only install its dependencies.",
].join("\n");

function specToCommand({ spec }: { spec: SkillInstallSpec }): string | null {
  switch (spec.kind) {
    case "brew":
      return spec.formula ? `brew install ${spec.formula}` : null;
    case "node":
      return spec.package ? `npm install -g ${spec.package}` : null;
    case "go":
      return spec.module ? `go install ${spec.module}@latest` : null;
    case "uv":
      return spec.package ? `uv tool install ${spec.package}` : null;
    case "download": {
      if (!spec.url) return null;
      const parts: string[] = [];
      if (spec.extract && spec.archive) {
        const target = spec.targetDir ? ` -C ${spec.targetDir}` : "";
        const strip =
          spec.stripComponents != null ? ` --strip-components=${spec.stripComponents}` : "";
        parts.push(`curl -fsSL ${spec.url} | tar xz${strip}${target}`);
      } else {
        parts.push(`curl -fsSL -o ${spec.archive ?? "download"} ${spec.url}`);
      }
      return parts.join(" && ");
    }
    default:
      return null;
  }
}

function filterSpecsByOs({ specs }: { specs: SkillInstallSpec[] }): SkillInstallSpec[] {
  return specs.filter((spec) => {
    if (!spec.os || spec.os.length === 0) return true;
    return spec.os.includes(process.platform);
  });
}

export function buildSetupPrompt({ skillContent }: { skillContent: string }): SetupPrompt {
  const log = getLogger().child({ component: "skill-setup" });

  const raw = parseFrontmatter({ content: skillContent });
  const frontmatter = raw ? buildFrontmatter({ raw }) : null;
  const installSpecs = frontmatter?.openclaw?.install ?? [];
  const filteredSpecs = filterSpecsByOs({ specs: installSpecs });

  log.debug(
    {
      totalSpecs: installSpecs.length,
      filteredSpecs: filteredSpecs.length,
      platform: process.platform,
      skillName: frontmatter?.name,
    },
    "Parsed skill frontmatter for setup",
  );

  const body = skillContent.replace(FRONTMATTER_RE, "").trim();

  const lines: string[] = [];

  if (filteredSpecs.length > 0) {
    lines.push("## Structured install specs from skill metadata\n");
    for (const spec of filteredSpecs) {
      const cmd = specToCommand({ spec });
      const label = spec.label ?? spec.kind;
      if (cmd) {
        lines.push(`- [${label}] \`${cmd}\``);
        log.debug({ kind: spec.kind, command: cmd }, "Generated install command");
      } else {
        lines.push(
          `- [${label}] (unable to generate command — review spec: ${JSON.stringify(spec)})`,
        );
        log.warn({ kind: spec.kind, spec }, "Unable to generate command for install spec");
      }
      if (spec.bins && spec.bins.length > 0) {
        lines.push(`  Verify binaries after install: ${spec.bins.join(", ")}`);
      }
    }
    lines.push("");
  }

  if (body.length > 0) {
    lines.push("## Full skill content\n");
    lines.push(
      "Review this for any additional install/setup instructions beyond the structured specs above.\n",
    );
    lines.push(body);
  }

  const hasSetupSteps = filteredSpecs.length > 0 || body.length > 0;

  log.debug(
    { hasSetupSteps, specCount: filteredSpecs.length, bodyLength: body.length },
    "Build setup prompt result",
  );

  return {
    prompt: lines.join("\n"),
    hasSetupSteps,
  };
}

export async function runSkillSetup({
  model,
  skillPath,
  workspacePath,
}: RunSkillSetupInput): Promise<SkillSetupResult> {
  const log = getLogger().child({ component: "skill-setup", skillPath });

  const skillFile = join(skillPath, "SKILL.md");
  let skillContent: string;
  try {
    skillContent = await readFile(skillFile, "utf8");
    log.debug({ skillFile, contentLength: skillContent.length }, "Read SKILL.md");
  } catch (err) {
    log.debug({ skillFile, err }, "No SKILL.md found — skipping setup");
    return { skipped: true, agentResponse: "" };
  }

  const { prompt, hasSetupSteps } = buildSetupPrompt({ skillContent });

  if (!hasSetupSteps) {
    log.debug("No setup steps found — skipping");
    return { skipped: true, agentResponse: "" };
  }

  const context: ToolExecutionContext = {
    workspaceRoot: workspacePath,
    botTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    runSource: "chat",
    isMainSession: false,
  };

  const tools = createShellTools({
    context,
    shellConfig: { mode: "full-access", allowedCommands: [] },
  });

  log.info({ promptLength: prompt.length }, "Starting skill setup agent");
  const startedAt = Date.now();

  const result = await generateText({
    model,
    messages: [
      { role: "system", content: SETUP_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    tools,
    stopWhen: stepCountIs(20),
    onStepFinish({ text, toolCalls, toolResults }) {
      log.debug(
        {
          toolCallCount: toolCalls.length,
          toolNames: toolCalls.map((tc) => tc.toolName),
          hasText: text.length > 0,
          resultCount: toolResults.length,
        },
        "Setup agent step finished",
      );
    },
  });

  const durationMs = Date.now() - startedAt;
  log.info(
    {
      steps: result.steps.length,
      durationMs,
      responseLength: result.text.length,
    },
    "Skill setup agent completed",
  );

  return {
    skipped: false,
    agentResponse: result.text.trim(),
  };
}
