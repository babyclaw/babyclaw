import { command } from "@gud/cli";
import { loadConfigRaw, listBundledSkills } from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "List available bundled skills",
  handler: async ({ client }) => {
    const config = await loadConfigRaw();
    if (!config) {
      client.log(c.error("✗ No configuration found. Run babyclaw setup first."));
      process.exitCode = 1;
      return;
    }

    const skillsConfig = config.skills ?? { entries: {} };
    const fullConfig = config as unknown as Record<string, unknown>;

    const skills = listBundledSkills({ skillsConfig, fullConfig });

    if (skills.length === 0) {
      client.log(c.muted("  No bundled skills available."));
      return;
    }

    client.log("");
    client.log(c.bold("  Bundled Skills"));
    client.log("");

    for (const skill of skills) {
      const name = skill.frontmatter?.name ?? skill.slug;
      const desc = skill.frontmatter?.description ?? "";

      let status: string;
      if (skill.enabled) {
        status = c.success("enabled");
      } else if (!skill.eligible) {
        status = c.error("ineligible");
      } else {
        status = c.muted("disabled");
      }

      client.log(`  ${c.bold(name)} ${c.muted("·")} ${status}`);
      if (desc) {
        client.log(`    ${c.muted(desc)}`);
      }
      if (!skill.eligible && skill.ineligibilityReason) {
        client.log(`    ${c.warning(skill.ineligibilityReason)}`);
      }
    }

    client.log("");
    client.log(c.muted("  Enable a skill with ") + c.info("babyclaw skill enable --slug <name>"));
  },
});
