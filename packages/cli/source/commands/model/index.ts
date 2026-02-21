import { command } from "@gud/cli";
import {
  getConfigPath,
  loadConfigRaw,
  SUPPORTED_PROVIDERS,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

function getProviderDisplayName(id: string): string {
  const meta = SUPPORTED_PROVIDERS.find((p) => p.id === id);
  return meta?.displayName ?? id;
}

export default command({
  description: "Show current model configuration",
  handler: async ({ client }) => {
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

    const providerEntries = Object.entries(config.ai.providers);
    const aliasEntries = Object.entries(config.ai.aliases);

    client.log(c.bold(" Model Configuration"));
    client.log("");

    client.log(`  ${c.brand(c.bold("Providers"))}`);
    if (providerEntries.length === 0) {
      client.log(c.muted("    (none configured)"));
    } else {
      for (const [key, provider] of providerEntries) {
        const name = c.bold(getProviderDisplayName(key));
        const detail = c.muted(` (${key}) — ${maskApiKey(provider.apiKey)}`);
        const url = provider.baseUrl
          ? c.muted(` [${provider.baseUrl}]`)
          : "";
        client.log(`    ${c.success("●")} ${name}${detail}${url}`);
      }
    }
    client.log("");

    client.log(`  ${c.brand(c.bold("Active Models"))}`);
    client.log(`    ${c.info("chat    ")}${config.ai.models.chat}`);
    client.log("");

    client.log(`  ${c.brand(c.bold("Aliases"))}`);
    if (aliasEntries.length === 0) {
      client.log(
        c.muted("    (none defined — use ") +
          c.info("babyclaw model alias set") +
          c.muted(" to create)"),
      );
    } else {
      for (const [name, ref] of aliasEntries) {
        client.log(
          `    ${c.warning(name)}${c.muted(" → ")}${ref}`,
        );
      }
    }
  },
});
