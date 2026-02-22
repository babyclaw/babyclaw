import { command } from "@gud/cli";
import {
  loadConfigRaw,
  writeConfig,
  listBundledSkills,
  getBundledSkillPath,
  runSkillSetup,
  resolveLanguageModel,
  resolveWorkspaceRoot,
  type BabyclawConfig,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Enable a bundled skill",
  options: {
    slug: {
      type: "string",
      description: "Bundled skill slug to enable",
      required: true,
    },
    "skip-setup": {
      type: "boolean",
      description: "Skip automatic dependency setup",
    },
  },
  handler: async ({ options, client }) => {
    const slug = await options.slug({ prompt: "Bundled skill slug" });
    const skipSetup = await options["skip-setup"]();

    const config = await loadConfigRaw();
    if (!config) {
      client.log(c.error("✗ No configuration found. Run babyclaw setup first."));
      process.exitCode = 1;
      return;
    }

    const workspacePath = resolveWorkspaceRoot({
      configRoot: config.workspace.root,
    });

    const skillsConfig = config.skills ?? { entries: {} };
    const fullConfig = config as unknown as Record<string, unknown>;

    const bundled = listBundledSkills({ skillsConfig, fullConfig });
    const skill = bundled.find((s) => s.slug === slug);

    if (!skill) {
      client.log(c.error(`✗ Bundled skill "${slug}" not found.`));
      client.log(
        c.muted("  Run ") + c.info("babyclaw skill bundled") + c.muted(" to see available skills."),
      );
      process.exitCode = 1;
      return;
    }

    if (!skill.eligible) {
      client.log(c.error(`✗ Skill "${slug}" is not eligible on this system.`));
      if (skill.ineligibilityReason) {
        client.log(c.muted(`  ${skill.ineligibilityReason}`));
      }
      process.exitCode = 1;
      return;
    }

    if (skill.enabled) {
      client.log(c.warning(`⚠ Skill "${slug}" is already enabled.`));
      return;
    }

    try {
      const skillKey = skill.frontmatter?.openclaw?.skillKey ?? skill.frontmatter?.name ?? slug;
      const updatedConfig: BabyclawConfig = {
        ...config,
        skills: {
          ...config.skills,
          entries: {
            ...config.skills.entries,
            [skillKey]: {
              ...config.skills.entries[skillKey],
              enabled: true,
            },
          },
        },
      };
      await writeConfig({ config: updatedConfig });

      let setupResult = null;
      let setupError: string | null = null;

      const skillPath = getBundledSkillPath({ slug });

      if (!skipSetup && skillPath) {
        try {
          const model = resolveLanguageModel({ config });
          setupResult = await runSkillSetup({
            model,
            skillPath,
            workspacePath,
          });
        } catch (err) {
          setupError = err instanceof Error ? err.message : String(err);
        }
      }

      const displayName = skill.frontmatter?.name ?? slug;
      client.log(c.success("✓ Enabled ") + c.bold(displayName));

      if (setupResult && !setupResult.skipped) {
        client.log(c.success("  ✓ Dependencies set up"));
      }
      if (setupError) {
        client.log(c.warning("  ⚠ Dependency setup failed"));
        client.log(c.muted(`    ${setupError}`));
      }

      client.log(c.muted("  The skill will be available on the next agent session."));
    } catch (error) {
      client.log(c.error(`✗ Failed to enable skill "${slug}"`));
      client.log(c.muted(`  ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
    }
  },
});
