import { command } from "@gud/cli";
import {
  getConfigPath,
  getDefaultConfigTemplate,
  loadConfigRaw,
  writeConfig,
  babyclawConfigSchema,
  SUPPORTED_PROVIDERS,
  type BabyclawConfig,
} from "@babyclaw/gateway";

const SHELL_MODES = ["allowlist", "full-access"] as const;
import { c, getRandomBanner } from "../ui/theme.js";
import { promptForModel } from "../ui/model-prompt.js";
import {
  detectPlatform,
  install as installService,
  start as startService,
  getStatus as getServiceStatus,
} from "../service/adapter.js";

type ProviderEntry = {
  id: string;
  apiKey: string;
  baseUrl: string;
};

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export default command({
  description: "Interactive first-time setup wizard",
  handler: async ({ client }) => {
    // ── 1. Welcome ──────────────────────────────────────────────────────
    client.log(c.brand(getRandomBanner()));
    client.log("");
    client.log(c.bold("  Welcome to BabyClaw setup!"));
    client.log(c.muted("  This wizard will walk you through the full configuration.\n"));

    let baseConfig: BabyclawConfig;
    const existing = await loadConfigRaw();
    let telegramToken = "";

    if (existing) {
      client.log(c.warning("  A config file already exists at:"));
      client.log(c.muted(`  ${getConfigPath()}\n`));

      const action = await client.prompt({
        type: "select",
        message: "What would you like to do?",
        choices: [
          { title: "Update existing configuration", value: "update" },
          { title: "Start fresh (overwrite)", value: "fresh" },
          { title: "Cancel", value: "cancel" },
        ],
      });

      if (action === "cancel") {
        client.log(c.muted("  Setup cancelled."));
        return;
      }

      if (action === "update") {
        baseConfig = existing;
        telegramToken = existing.channels?.telegram?.botToken ?? "";
      } else {
        const template = JSON.parse(getDefaultConfigTemplate());
        baseConfig = babyclawConfigSchema.parse(template);
      }
    } else {
      const template = JSON.parse(getDefaultConfigTemplate());
      baseConfig = babyclawConfigSchema.parse(template);
    }

    // ── 2. Telegram Bot Token ───────────────────────────────────────────
    client.log("");
    client.log(c.bold("  Step 1 · Telegram Bot Token"));
    client.log(c.muted("  Get one from @BotFather on Telegram. Leave empty to skip.\n"));

    const tokenInput = await client.prompt({
      type: "password",
      message: "Telegram bot token",
      initial: telegramToken,
    });

    telegramToken = (tokenInput as string) ?? "";

    if (!telegramToken) {
      client.log(c.warning("  Skipped — Telegram channel will be disabled."));
    }

    // ── 3. AI Providers ─────────────────────────────────────────────────
    const providers: ProviderEntry[] = existing
      ? Object.entries(existing.ai.providers).map(([id, cfg]) => ({
          id,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl ?? "",
        }))
      : [];

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
      client.log(c.bold("  Step 2 · AI Providers"));
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

    // ── 4. Model Selection ──────────────────────────────────────────────
    let chatModel = baseConfig.ai.models.chat;

    client.log("");
    client.log(c.bold("  Step 3 · Model Selection"));
    client.log(c.muted("  Format: provider:model-id — type to search or enter any model\n"));

    chatModel = await promptForModel({ client, providers, initial: chatModel });

    // ── 5. Timezone ─────────────────────────────────────────────────────
    client.log("");
    client.log(c.bold("  Step 4 · Scheduler Timezone"));

    let timezone = baseConfig.scheduler.timezone;
    let validTz = false;
    while (!validTz) {
      timezone = (await client.prompt({
        type: "text",
        message: "IANA timezone (e.g. America/New_York, Europe/London)",
        initial: timezone,
      })) as string;

      if (isValidTimezone(timezone)) {
        validTz = true;
      } else {
        client.log(c.error(`  "${timezone}" is not a valid IANA timezone.`));
      }
    }

    // ── 6. Tool Settings ────────────────────────────────────────────────
    client.log("");
    client.log(c.bold("  Step 5 · Tool Settings"));

    const shellMode = (await client.prompt({
      type: "select",
      message: "Shell access mode",
      choices: SHELL_MODES.map((mode) => ({
        title:
          mode === "allowlist"
            ? "allowlist (safer — only pre-approved commands)"
            : "full-access (unrestricted shell)",
        value: mode,
      })),
    })) as (typeof SHELL_MODES)[number];

    client.log(c.muted("  Brave Search API enables web search. Leave empty to skip."));
    const braveKey = (await client.prompt({
      type: "password",
      message: "Brave Search API key (optional)",
      initial: baseConfig.tools.webSearch.braveApiKey ?? "",
    })) as string;

    // ── 7. Review + Save ────────────────────────────────────────────────
    client.log("");
    client.log(c.bold("  Review Configuration"));
    client.log("");

    client.log(
      `  ${c.brand(c.bold("Telegram:"))}  ${telegramToken ? c.success("configured") : c.muted("skipped")}`,
    );

    client.log(`  ${c.brand(c.bold("Providers:"))}`);
    for (const p of providers) {
      const url = p.baseUrl ? c.muted(` [${p.baseUrl}]`) : "";
      client.log(`    ${c.success("●")} ${p.id}${url}`);
    }

    client.log(`  ${c.brand(c.bold("Models:"))}`);
    client.log(`    chat:    ${c.info(chatModel)}`);

    client.log(`  ${c.brand(c.bold("Timezone:"))}  ${c.info(timezone)}`);

    client.log(`  ${c.brand(c.bold("Tools:"))}`);
    client.log(`    shell:   ${c.info(shellMode)}`);
    client.log(`    search:  ${braveKey ? c.success("configured") : c.muted("disabled")}`);
    client.log("");

    const confirmed = await client.confirm("Save configuration?");
    if (!confirmed) {
      client.log(c.muted("  Setup cancelled. Nothing was saved."));
      return;
    }

    const providersObj: Record<string, { apiKey: string; baseUrl?: string }> = {};
    for (const p of providers) {
      providersObj[p.id] = {
        apiKey: p.apiKey,
        ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      };
    }

    const config: BabyclawConfig = {
      ...baseConfig,
      channels: telegramToken ? { telegram: { botToken: telegramToken } } : {},
      ai: {
        providers: providersObj,
        models: { chat: chatModel },
        aliases: baseConfig.ai.aliases,
      },
      scheduler: { timezone },
      tools: {
        ...baseConfig.tools,
        shell: {
          ...baseConfig.tools.shell,
          mode: shellMode,
        },
        webSearch: {
          braveApiKey: braveKey || null,
        },
      },
    };

    try {
      await writeConfig({ config });
      client.log(c.success(`\n  ✓ Config saved to ${getConfigPath()}`));
    } catch (err) {
      client.log(c.error("\n  ✗ Failed to save configuration"));
      client.log(c.muted(`  ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
      return;
    }

    // ── 8. Service Install (optional) ───────────────────────────────────
    const plat = detectPlatform();
    if (plat !== "unsupported") {
      const serviceInfo = getServiceStatus();

      if (!serviceInfo.installed) {
        client.log("");
        const installIt = await client.confirm(
          "Install BabyClaw as a system service? (auto-starts on boot)",
        );

        if (installIt) {
          try {
            const result = installService();
            client.log(c.success("  ✓ Service installed!"));
            client.log(c.muted(`    ${result.path}`));

            const startIt = await client.confirm("Start the service now?");
            if (startIt) {
              try {
                startService();
                client.log(c.success("  ✓ Service started!"));
              } catch (err) {
                client.log(c.error("  ✗ Failed to start service"));
                client.log(c.muted(`    ${err instanceof Error ? err.message : String(err)}`));
              }
            }
          } catch (err) {
            client.log(c.error("  ✗ Failed to install service"));
            client.log(c.muted(`    ${err instanceof Error ? err.message : String(err)}`));
          }
        }
      } else {
        client.log(c.muted("\n  Service is already installed."));
        if (!serviceInfo.running) {
          const startIt = await client.confirm("Start the service now?");
          if (startIt) {
            try {
              startService();
              client.log(c.success("  ✓ Service started!"));
            } catch (err) {
              client.log(c.error("  ✗ Failed to start service"));
              client.log(c.muted(`    ${err instanceof Error ? err.message : String(err)}`));
            }
          }
        }
      }
    }

    // ── 9. Finish ───────────────────────────────────────────────────────
    client.log("");
    client.log(c.success(c.bold("  Setup complete! 🦀")));
    client.log(
      c.muted("  Run ") + c.info("babyclaw doctor") + c.muted(" to verify everything is working."),
    );
  },
});
