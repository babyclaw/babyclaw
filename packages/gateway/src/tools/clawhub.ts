import { tool, type LanguageModel, type ToolSet } from "ai";
import { z } from "zod";
import { ClawHubError } from "../clawhub/client.js";
import { installSkillFromClawHub, SkillAlreadyInstalledError } from "../clawhub/installer.js";
import { runSkillSetup } from "../clawhub/skill-setup.js";
import { getLogger } from "../logging/index.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateClawhubToolsInput = {
  context: ToolExecutionContext;
  model?: LanguageModel;
};

export function createClawhubTools({ context, model }: CreateClawhubToolsInput): ToolSet {
  return {
    clawhub_install: tool({
      description:
        "Install a skill from ClawHub (clawhub.ai) into the workspace skills directory. " +
        "Skills extend your capabilities by teaching you how to perform specific tasks. " +
        "After installation the skill will be available in the next agent turn. " +
        "Use this when the user asks you to install a skill or when you discover a skill slug that would help.",
      inputSchema: z.object({
        slug: z
          .string()
          .trim()
          .min(1)
          .describe("The skill slug on ClawHub (e.g. 'gcalcli-calendar')"),
        version: z
          .string()
          .optional()
          .describe("Specific version to install. Omit to install the latest version."),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("Overwrite if the skill is already installed"),
        skipSetup: z
          .boolean()
          .optional()
          .default(false)
          .describe("Skip automatic dependency setup after installation"),
      }),
      execute: async ({ slug, version, force, skipSetup }) =>
        withToolLogging({
          context,
          toolName: "clawhub_install",
          defaultCode: "CLAWHUB_INSTALL_FAILED",
          input: { slug, version, force, skipSetup },
          action: async () => {
            try {
              const result = await installSkillFromClawHub({
                slug,
                version,
                workspacePath: context.workspaceRoot,
                force,
              });

              let setupSummary: string | undefined;
              const log = getLogger().child({ component: "clawhub-install", slug: result.slug });

              if (skipSetup) {
                log.debug("Skill setup skipped (skipSetup=true)");
              } else if (!model) {
                log.debug("Skill setup skipped (no model available)");
              } else {
                log.info({ skillPath: result.skillPath }, "Starting post-install setup");
                try {
                  const setupResult = await runSkillSetup({
                    model,
                    skillPath: result.skillPath,
                    workspacePath: context.workspaceRoot,
                  });
                  if (setupResult.skipped) {
                    log.info("Skill setup skipped (no setup steps detected)");
                  } else {
                    log.info(
                      { responseLength: setupResult.agentResponse.length },
                      "Skill setup completed successfully",
                    );
                    setupSummary = setupResult.agentResponse;
                  }
                } catch (err) {
                  log.warn({ err }, "Skill setup failed (non-fatal — files are still installed)");
                  setupSummary = `Setup failed: ${err instanceof Error ? err.message : String(err)}`;
                }
              }

              return {
                ok: true as const,
                slug: result.slug,
                version: result.version,
                displayName: result.displayName,
                files: result.files,
                skillPath: result.skillPath,
                setupSummary,
                message: setupSummary
                  ? `Skill "${result.displayName}" (${result.version}) installed and set up. It will be available on the next turn.`
                  : `Skill "${result.displayName}" (${result.version}) installed. It will be available on the next turn.`,
              };
            } catch (error) {
              if (error instanceof SkillAlreadyInstalledError) {
                throw new ToolExecutionError({
                  code: "SKILL_ALREADY_INSTALLED",
                  message: error.message,
                  hint: "Set force to true to overwrite the existing installation.",
                });
              }

              if (error instanceof ClawHubError) {
                throw new ToolExecutionError({
                  code: "CLAWHUB_API_ERROR",
                  message: error.message,
                  retryable: error.statusCode >= 500 || error.statusCode === 429,
                });
              }

              throw error;
            }
          },
        }),
    }),
  };
}
