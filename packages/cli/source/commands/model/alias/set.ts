import { command } from "@gud/cli";
import { getConfigPath, loadConfigRaw, writeConfig } from "@babyclaw/gateway";
import { c } from "../../../ui/theme.js";

export default command({
  description: "Create or update a model alias",
  options: {
    name: {
      type: "string",
      description: "Alias name (e.g. fast, smart)",
      required: true,
    },
    model: {
      type: "string",
      description: "Model reference in provider:modelId format",
      required: true,
    },
  },
  handler: async ({ options, client }) => {
    const name = await options.name({
      prompt: "Alias name",
      validate: (val) => {
        if (!val) return "Alias name is required";
        const cleaned = val.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!cleaned) return "Use only lowercase letters, numbers, hyphens, and underscores";
        return true;
      },
    });

    const model = await options.model({
      prompt: "Model reference (provider:modelId)",
      validate: (val) => {
        if (!val) return "Model reference is required";
        if (!val.includes(":")) return "Expected format: provider:modelId";
        return true;
      },
    });

    try {
      const config = await loadConfigRaw();
      if (!config) {
        client.log(c.error(`No valid config found at ${getConfigPath()}`));
        client.log(c.muted("  Run ") + c.info("babyclaw config init") + c.muted(" first."));
        process.exitCode = 1;
        return;
      }

      const aliasName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const wasUpdate = aliasName in config.ai.aliases;
      config.ai.aliases[aliasName] = model;
      await writeConfig({ config });

      client.log(
        c.success(`${wasUpdate ? "Updated" : "Created"} alias `) +
          c.warning(c.bold(aliasName)) +
          c.muted(" → ") +
          model,
      );
    } catch (err) {
      client.log(c.error("Failed to set alias"));
      client.log(c.muted(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  },
});
