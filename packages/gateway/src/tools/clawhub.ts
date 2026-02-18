import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { ClawHubError } from "../clawhub/client.js";
import {
  installSkillFromClawHub,
  SkillAlreadyInstalledError,
} from "../clawhub/installer.js";
import type { ToolExecutionContext } from "../utils/tool-context.js";
import { ToolExecutionError, withToolLogging } from "./errors.js";

type CreateClawhubToolsInput = {
  context: ToolExecutionContext;
};

export function createClawhubTools({
  context,
}: CreateClawhubToolsInput): ToolSet {
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
          .describe(
            "Specific version to install. Omit to install the latest version.",
          ),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe("Overwrite if the skill is already installed"),
      }),
      execute: async ({ slug, version, force }) =>
        withToolLogging({
          context,
          toolName: "clawhub_install",
          defaultCode: "CLAWHUB_INSTALL_FAILED",
          input: { slug, version, force },
          action: async () => {
            try {
              const result = await installSkillFromClawHub({
                slug,
                version,
                workspacePath: context.workspaceRoot,
                force,
              });

              return {
                ok: true as const,
                slug: result.slug,
                version: result.version,
                displayName: result.displayName,
                files: result.files,
                skillPath: result.skillPath,
                message: `Skill "${result.displayName}" (${result.version}) installed. It will be available on the next turn.`,
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
