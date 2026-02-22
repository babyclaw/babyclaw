import { command } from "@gud/cli";
import {
  loadConfigRaw,
  writeConfig,
  listBundledSkills,
  getBundledSkillPath,
  runSkillSetup,
  resolveLanguageModel,
  resolveWorkspaceRoot,
  getSkillKey,
  AdminClient,
  getAdminSocketPath,
  type BabyclawConfig,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Enable a bundled skill",
  options: {
    slug: {
      type: "string",
      description: "Bundled skill slug to enable",
    },
    "skip-setup": {
      type: "boolean",
      description: "Skip automatic dependency setup",
    },
  },
  handler: async ({ options, client }) => {
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

    let slug = await options.slug();

    if (!slug) {
      const enableable = bundled.filter((s) => s.eligible && !s.enabled);
      if (enableable.length === 0) {
        client.log(c.muted("  No skills available to enable."));
        return;
      }

      const choices = enableable.map((s) => ({
        title: `${s.frontmatter?.name ?? s.slug} ${c.muted("—")} ${c.muted(s.frontmatter?.description ?? "")}`,
        value: s.slug,
      }));
      choices.push({ title: c.muted("Cancel"), value: "__cancel__" });

      const selected = await client.prompt({
        type: "select",
        message: "Select a skill to enable",
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
      const skillKey = getSkillKey({ frontmatter: skill.frontmatter, slug });
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

      try {
        const admin = new AdminClient({ socketPath: getAdminSocketPath() });
        await admin.reloadSkills();
      } catch {
        // Gateway may not be running -- that's fine, config is saved
      }

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

      client.log(c.muted("  The skill is now available."));
    } catch (error) {
      client.log(c.error(`✗ Failed to enable skill "${slug}"`));
      client.log(c.muted(`  ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
    }
  },
});
