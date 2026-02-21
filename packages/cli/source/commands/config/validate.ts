import { command } from "@gud/cli";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getConfigPath, babyclawConfigSchema } from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Validate your current config",
  handler: async ({ client }) => {
    const configPath = getConfigPath();

    try {
      if (!existsSync(configPath)) {
        client.log(c.error("✗ No config file found at:"));
        client.log(c.muted(`  ${configPath}`));
        client.log(c.muted("  Run ") + c.info("babyclaw config init") + c.muted(" to create one."));
        process.exitCode = 1;
        return;
      }

      const raw = await readFile(configPath, "utf8");
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        client.log(c.error("✗ Config is invalid"));
        client.log(c.muted(`  ${configPath}`));
        client.log(c.warning("  • Config file is not valid JSON."));
        process.exitCode = 1;
        return;
      }

      const result = babyclawConfigSchema.safeParse(json);
      if (result.success) {
        client.log(c.success("✓ Config is valid!"));
        client.log(c.muted(`  ${configPath}`));
      } else {
        client.log(c.error("✗ Config is invalid"));
        client.log(c.muted(`  ${configPath}`));
        for (const issue of result.error.issues) {
          const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
          client.log(c.warning(`  • ${path}: ${issue.message}`));
        }
        process.exitCode = 1;
      }
    } catch (error) {
      client.log(c.error("✗ Error reading config"));
      client.log(c.muted(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    }
  },
});
