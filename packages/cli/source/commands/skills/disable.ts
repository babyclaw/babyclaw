import { command } from "@gud/cli";
import {
  loadConfigRaw,
  writeConfig,
  listBundledSkills,
  getSkillKey,
  AdminClient,
  getAdminSocketPath,
  type BabyclawConfig,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Disable a bundled skill",
  options: {
    slug: {
      type: "string",
      description: "Bundled skill slug to disable",
    },
  },
  handler: async ({ options, client }) => {
    const config = await loadConfigRaw();
    if (!config) {
      client.log(c.error("✗ No configuration found. Run babyclaw setup first."));
      process.exitCode = 1;
      return;
    }

    const skillsConfig = config.skills ?? { entries: {} };
    const fullConfig = config as unknown as Record<string, unknown>;

    const bundled = listBundledSkills({ skillsConfig, fullConfig });

    let slug = await options.slug();

    if (!slug) {
      const disableable = bundled.filter((s) => s.enabled);
      if (disableable.length === 0) {
        client.log(c.muted("  No skills are currently enabled."));
        return;
      }

      const choices = disableable.map((s) => ({
        title: `${s.frontmatter?.name ?? s.slug} ${c.muted("—")} ${c.muted(s.frontmatter?.description ?? "")}`,
        value: s.slug,
      }));
      choices.push({ title: c.muted("Cancel"), value: "__cancel__" });

      const selected = await client.prompt({
        type: "select",
        message: "Select a skill to disable",
        choices,
      });

      if (selected === "__cancel__") return;
      slug = selected as string;
    }

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
      const skillKey = getSkillKey({ frontmatter: skill.frontmatter, slug });
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

      try {
        const admin = new AdminClient({ socketPath: getAdminSocketPath() });
        await admin.reloadSkills();
      } catch {
        // Gateway may not be running -- that's fine, config is saved
      }

      const displayName = skill.frontmatter?.name ?? slug;
      client.log(c.success("✓ Disabled ") + c.bold(displayName));
      client.log(c.muted("  The skill has been removed."));
    } catch (error) {
      client.log(c.error(`✗ Failed to disable skill "${slug}"`));
      client.log(c.muted(`  ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
    }
  },
});
