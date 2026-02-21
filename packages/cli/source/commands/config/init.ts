import { command } from "@gud/cli";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  getConfigPath,
  getDefaultConfigTemplate,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Create a fresh configuration file",
  options: {
    force: {
      type: "boolean",
      description: "Overwrite existing config file",
    },
  },
  handler: async ({ options, client }) => {
    const force = await options.force();
    const configPath = getConfigPath();

    try {
      if (existsSync(configPath) && !force) {
        client.log(c.warning("⚠ Config file already exists at:"));
        client.log(c.muted(`  ${configPath}`));
        const overwrite = await client.confirm(
          "Overwrite existing config?",
          false,
        );
        if (!overwrite) return;
      }

      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, getDefaultConfigTemplate(), "utf8");

      client.log(c.success("✓ Config created!"));
      client.log(c.muted(`  ${configPath}`));
      client.log(
        c.muted("  Next: run ") +
          c.info("babyclaw model configure") +
          c.muted(" to set up AI providers, or edit ") +
          c.info("channels.telegram.botToken") +
          c.muted(" and ") +
          c.info("ai.providers") +
          c.muted(" manually."),
      );
    } catch (error) {
      client.log(c.error("✗ Failed to create config"));
      client.log(
        c.muted(error instanceof Error ? error.message : String(error)),
      );
      process.exitCode = 1;
    }
  },
});
