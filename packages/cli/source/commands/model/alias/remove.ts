import { command } from "@gud/cli";
import {
  getConfigPath,
  loadConfigRaw,
  writeConfig,
} from "@babyclaw/gateway";
import { c } from "../../../ui/theme.js";

export default command({
  description: "Remove a model alias",
  options: {
    name: {
      type: "string",
      description: "Alias name to remove",
    },
  },
  handler: async ({ options, client }) => {
    try {
      const config = await loadConfigRaw();
      if (!config) {
        client.log(c.error(`No valid config found at ${getConfigPath()}`));
        client.log(
          c.muted("  Run ") +
            c.info("babyclaw config init") +
            c.muted(" first."),
        );
        process.exitCode = 1;
        return;
      }

      const entries = Object.entries(config.ai.aliases);
      let name = await options.name();

      if (!name) {
        if (entries.length === 0) {
          client.log(c.muted("No aliases configured. Nothing to remove."));
          return;
        }

        name = (await client.prompt({
          type: "select",
          message: "Select alias to remove",
          choices: entries.map(([n, ref]) => ({
            title: `${n} ${c.muted(`→ ${ref}`)}`,
            value: n,
          })),
        })) as string;
      }

      if (!(name in config.ai.aliases)) {
        client.log(c.warning(`Alias ${c.bold(name)} does not exist.`));
        client.log(
          c.muted("  Run ") +
            c.info("babyclaw model alias") +
            c.muted(" to see current aliases."),
        );
        return;
      }

      delete config.ai.aliases[name];
      await writeConfig({ config });

      client.log(c.success(`Removed alias ${c.bold(name)}`));
    } catch (err) {
      client.log(c.error("Failed to remove alias"));
      client.log(
        c.muted(err instanceof Error ? err.message : String(err)),
      );
      process.exitCode = 1;
    }
  },
});
