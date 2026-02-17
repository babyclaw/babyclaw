import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import {
  getConfigPath,
  loadConfigRaw,
  SUPPORTED_PROVIDERS,
  type SimpleclawConfig,
} from "@simpleclaw/gateway";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "..." + key.slice(-4);
}

function getProviderDisplayName(id: string): string {
  const meta = SUPPORTED_PROVIDERS.find((p) => p.id === id);
  return meta?.displayName ?? id;
}

type State = "loading" | "done" | "no-config";

export default function ModelIndex() {
  const [state, setState] = useState<State>("loading");
  const [config, setConfig] = useState<SimpleclawConfig | null>(null);

  useExit({ done: state !== "loading" });

  useEffect(() => {
    void (async () => {
      const loaded = await loadConfigRaw();
      if (!loaded) {
        setState("no-config");
        return;
      }
      setConfig(loaded);
      setState("done");
    })();
  }, []);

  if (state === "loading") {
    return <Text color={colors.muted}>Loading model configuration...</Text>;
  }

  if (state === "no-config" || !config) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>
          No valid config found at {getConfigPath()}
        </Text>
        <Text color={colors.muted}>
          {"  "}Run{" "}
          <Text color={colors.info}>simpleclaw config init</Text> first.
        </Text>
      </Box>
    );
  }

  const providerEntries = Object.entries(config.ai.providers);
  const aliasEntries = Object.entries(config.ai.aliases);

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold> Model Configuration</Text>

      <Box flexDirection="column" paddingLeft={2}>
        <Text bold color={colors.brand}>
          Providers
        </Text>
        {providerEntries.length === 0 ? (
          <Text color={colors.muted}>  (none configured)</Text>
        ) : (
          providerEntries.map(([key, provider]) => (
            <Text key={key}>
              {"  "}
              <Text color={colors.success}>●</Text>{" "}
              <Text bold>{getProviderDisplayName(key)}</Text>
              <Text color={colors.muted}>
                {" "}
                ({key}) — {maskApiKey(provider.apiKey)}
              </Text>
              {provider.baseUrl && (
                <Text color={colors.muted}> [{provider.baseUrl}]</Text>
              )}
            </Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        <Text bold color={colors.brand}>
          Active Models
        </Text>
        <Text>
          {"  "}
          <Text color={colors.info}>chat    </Text>
          <Text>{config.ai.models.chat}</Text>
        </Text>
        <Text>
          {"  "}
          <Text color={colors.info}>browser </Text>
          <Text>{config.ai.models.browser}</Text>
        </Text>
      </Box>

      <Box flexDirection="column" paddingLeft={2}>
        <Text bold color={colors.brand}>
          Aliases
        </Text>
        {aliasEntries.length === 0 ? (
          <Text color={colors.muted}>
            {"  "}(none defined — use{" "}
            <Text color={colors.info}>simpleclaw model alias set</Text> to
            create)
          </Text>
        ) : (
          aliasEntries.map(([name, ref]) => (
            <Text key={name}>
              {"  "}
              <Text color={colors.warning}>{name}</Text>
              <Text color={colors.muted}> → </Text>
              <Text>{ref}</Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
