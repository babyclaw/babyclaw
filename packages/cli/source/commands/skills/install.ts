import { command } from "@gud/cli";
import { resolve } from "node:path";
import {
  loadConfigRaw,
  installSkillFromClawHub,
  runSkillSetup,
  resolveLanguageModel,
  SkillAlreadyInstalledError,
  ClawHubError,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Install a skill from ClawHub",
  options: {
    slug: {
      type: "string",
      description: "Skill slug on ClawHub (e.g. gcalcli-calendar)",
      required: true,
    },
    version: {
      type: "string",
      description: "Install a specific version (defaults to latest)",
    },
    force: {
      type: "boolean",
      description: "Overwrite if the skill is already installed",
    },
    "skip-setup": {
      type: "boolean",
      description: "Skip automatic dependency setup after installation",
    },
  },
  handler: async ({ options, client }) => {
    const slug = await options.slug({ prompt: "Skill slug (e.g. gcalcli-calendar)" });
    const version = await options.version();
    const force = await options.force();
    const skipSetup = await options["skip-setup"]();

    try {
      const config = await loadConfigRaw();
      const workspacePath = resolve(
        process.cwd(),
        config?.workspace?.root ?? ".",
      );

      const installResult = await installSkillFromClawHub({
        slug,
        version: version || undefined,
        workspacePath,
        force: force || false,
      });

      let setupResult = null;
      let setupError: string | null = null;

      if (!skipSetup && config) {
        try {
          const model = resolveLanguageModel({ config });
          setupResult = await runSkillSetup({
            model,
            skillPath: installResult.skillPath,
            workspacePath,
          });
        } catch (err) {
          setupError = err instanceof Error ? err.message : String(err);
        }
      }

      client.log(
        c.success("✓ Installed ") +
          c.bold(installResult.displayName) +
          c.muted(` (${installResult.version})`),
      );
      client.log(
        c.muted(
          `  ${installResult.files.length} file${installResult.files.length !== 1 ? "s" : ""} → ${installResult.skillPath}`,
        ),
      );

      if (setupResult && !setupResult.skipped) {
        client.log(c.success("  ✓ Dependencies set up"));
      }
      if (setupError) {
        client.log(
          c.warning(
            "  ⚠ Setup failed (skill files are still installed)",
          ),
        );
        client.log(c.muted(`    ${setupError}`));
      }

      client.log(
        c.muted(
          "  The skill will be available on the next agent session.",
        ),
      );
    } catch (error) {
      if (error instanceof SkillAlreadyInstalledError) {
        client.log(
          c.warning(`⚠ Skill "${slug}" is already installed.`),
        );
        client.log(
          c.muted("  Use ") + c.info("--force") + c.muted(" to overwrite."),
        );
        return;
      }

      if (error instanceof ClawHubError && error.statusCode === 404) {
        client.log(c.error(`✗ Skill "${slug}" not found on ClawHub.`));
        client.log(
          c.muted("  Browse available skills at ") +
            c.info("https://clawhub.ai/skills"),
        );
        process.exitCode = 1;
        return;
      }

      client.log(c.error(`✗ Failed to install skill "${slug}"`));
      client.log(
        c.muted(
          `  ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      process.exitCode = 1;
    }
  },
});
