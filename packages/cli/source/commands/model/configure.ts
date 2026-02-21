import { command } from "@gud/cli";
import {
  getConfigPath,
  loadConfigRaw,
  writeConfig,
  getDefaultConfigTemplate,
  babyclawConfigSchema,
  SUPPORTED_PROVIDERS,
  type BabyclawConfig,
} from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";
import { promptForModel } from "../../ui/model-prompt.js";

type ProviderEntry = {
  id: string;
  apiKey: string;
  baseUrl: string;
};

export default command({
  description: "Interactive model provider setup wizard",
  handler: async ({ client }) => {
    let baseConfig: BabyclawConfig;
    const existing = await loadConfigRaw();
    if (existing) {
      baseConfig = existing;
    } else {
      const template = JSON.parse(getDefaultConfigTemplate());
      baseConfig = babyclawConfigSchema.parse(template);
    }

    const providers: ProviderEntry[] = existing
      ? Object.entries(existing.ai.providers).map(([id, cfg]) => ({
          id,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl ?? "",
        }))
      : [];

    let chatModel = baseConfig.ai.models.chat;

    let addingProviders = true;
    while (addingProviders) {
      const providerChoices = SUPPORTED_PROVIDERS.map((p) => {
        const configured = providers.find((e) => e.id === p.id);
        return {
          title: configured ? `${p.displayName} (configured)` : p.displayName,
          value: p.id,
        };
      });
      providerChoices.push({
        title:
          providers.length > 0 ? "Done adding providers →" : "(add at least one provider first)",
        value: "__done__",
      });

      client.log("");
      client.log(c.bold(" Model Provider Setup"));
      if (providers.length > 0) {
        client.log(c.muted(`  Configured: ${providers.map((p) => p.id).join(", ")}`));
      }

      const selected = await client.prompt({
        type: "select",
        message: "Select a provider to configure (or Done when finished)",
        choices: providerChoices,
      });

      if (selected === "__done__") {
        if (providers.length === 0) {
          client.log(c.warning("  Add at least one provider before continuing."));
          continue;
        }
        addingProviders = false;
        continue;
      }

      const providerId = selected as string;
      const meta = SUPPORTED_PROVIDERS.find((p) => p.id === providerId);
      const existingEntry = providers.find((p) => p.id === providerId);

      client.log(c.bold(`  Configure ${meta?.displayName ?? providerId}`));

      const apiKey = await client.prompt({
        type: "password",
        message: "API Key",
        initial: existingEntry?.apiKey,
      });

      const baseUrl = await client.prompt({
        type: "text",
        message: "Base URL (leave empty for default)",
        initial: existingEntry?.baseUrl,
      });

      const entry: ProviderEntry = {
        id: providerId,
        apiKey: apiKey as string,
        baseUrl: (baseUrl as string) ?? "",
      };

      const idx = providers.findIndex((p) => p.id === entry.id);
      if (idx >= 0) {
        providers[idx] = entry;
      } else {
        providers.push(entry);
      }
    }

    client.log("");
    client.log(c.bold(" Model Selection"));
    client.log(c.muted("  Type to search or enter a custom provider:model-id"));

    chatModel = await promptForModel({ client, providers, initial: chatModel });

    client.log("");
    client.log(c.bold(" Review Configuration"));
    client.log(`  ${c.brand(c.bold("Providers:"))}`);
    for (const p of providers) {
      const url = p.baseUrl ? c.muted(` [${p.baseUrl}]`) : "";
      client.log(`    ${c.success("●")} ${p.id}${url}`);
    }
    client.log(`  ${c.brand(c.bold("Models:"))}`);
    client.log(`    chat: ${c.info(chatModel)}`);
    client.log("");

    const confirmed = await client.confirm("Save configuration?");
    if (!confirmed) {
      client.log(c.muted("  Configuration not saved."));
      return;
    }

    try {
      const providersObj: Record<string, { apiKey: string; baseUrl?: string }> = {};
      for (const p of providers) {
        providersObj[p.id] = {
          apiKey: p.apiKey,
          ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
        };
      }

      const config: BabyclawConfig = {
        ...baseConfig,
        ai: {
          providers: providersObj,
          models: { chat: chatModel },
          aliases: baseConfig.ai.aliases,
        },
      };

      await writeConfig({ config });

      client.log(c.success(`Configuration saved to ${getConfigPath()}`));
      client.log(
        c.muted("  Run ") +
          c.info("babyclaw config validate") +
          c.muted(" to verify, or ") +
          c.info("babyclaw model") +
          c.muted(" to review."),
      );
    } catch (err) {
      client.log(c.error("Failed to save configuration"));
      client.log(c.muted(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  },
});
