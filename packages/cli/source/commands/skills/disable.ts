import { command } from "@gud/cli";
import {
  loadConfigRaw,
  writeConfig,
  listBundledSkills,
  type BabyclawConfig,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Disable a bundled skill",
  options: {
    slug: {
      type: "string",
      description: "Bundled skill slug to disable",
      required: true,
    },
  },
  handler: async ({ options, client }) => {
    const slug = await options.slug({ prompt: "Bundled skill slug" });

    const config = await loadConfigRaw();
    if (!config) {
      client.log(c.error("✗ No configuration found. Run babyclaw setup first."));
      process.exitCode = 1;
      return;
    }

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

    if (!skill.enabled) {
      client.log(c.warning(`⚠ Skill "${slug}" is already disabled.`));
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
              enabled: false,
            },
          },
        },
      };
      await writeConfig({ config: updatedConfig });

      const displayName = skill.frontmatter?.name ?? slug;
      client.log(c.success("✓ Disabled ") + c.bold(displayName));
      client.log(c.muted("  The skill will be removed on the next agent session."));
    } catch (error) {
      client.log(c.error(`✗ Failed to disable skill "${slug}"`));
      client.log(c.muted(`  ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
    }
  },
});
