import { command } from "@gud/cli";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { getConfigPath } from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Open config in your editor",
  handler: async ({ client }) => {
    const configPath = getConfigPath();

    if (!existsSync(configPath)) {
      client.log(c.error("✗ No config file found at:"));
      client.log(c.muted(`  ${configPath}`));
      client.log(c.muted("  Run ") + c.info("babyclaw config init") + c.muted(" first."));
      process.exitCode = 1;
      return;
    }

    const editor = process.env["EDITOR"] || process.env["VISUAL"] || "vi";

    try {
      execSync(`${editor} ${JSON.stringify(configPath)}`, {
        stdio: "inherit",
      });
    } catch {
      const content = await readFile(configPath, "utf8");
      process.stdout.write(`\nCurrent config at ${configPath}:\n\n`);
      process.stdout.write(content);
      process.stdout.write("\nEdit this file manually, then run 'babyclaw config validate'.\n");
      return;
    }

    client.log(c.success("✓ Editor closed."));
    client.log(
      c.muted("  Run ") + c.info("babyclaw config validate") + c.muted(" to check for issues."),
    );
  },
});
