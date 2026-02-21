import { command } from "@gud/cli";
import { getConfigPath, loadConfigRaw } from "@babyclaw/gateway";
import { c } from "../../../ui/theme.js";

export default command({
  description: "List model aliases",
  handler: async ({ client }) => {
    const config = await loadConfigRaw();
    if (!config) {
      client.log(c.error(`No valid config found at ${getConfigPath()}`));
      client.log(c.muted("  Run ") + c.info("babyclaw config init") + c.muted(" first."));
      process.exitCode = 1;
      return;
    }

    const entries = Object.entries(config.ai.aliases);

    client.log(c.bold(" Model Aliases"));
    if (entries.length === 0) {
      client.log(
        c.muted("  No aliases configured. Use ") +
          c.info("babyclaw model alias set") +
          c.muted(" to create one."),
      );
    } else {
      for (const [name, ref] of entries) {
        client.log(`  ${c.warning(c.bold(name))}${c.muted(" → ")}${ref}`);
      }
    }
  },
});
