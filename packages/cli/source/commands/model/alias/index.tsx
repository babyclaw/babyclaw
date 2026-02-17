import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import {
  getConfigPath,
  loadConfigRaw,
  type SimpleclawConfig,
} from "@simpleclaw/gateway";
import { colors } from "../../../ui/theme.js";
import { useExit } from "../../../ui/hooks.js";

type State = "loading" | "done" | "no-config";

export default function AliasIndex() {
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
    return <Text color={colors.muted}>Loading aliases...</Text>;
  }

  if (state === "no-config" || !config) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>
          No valid config found at {getConfigPath()}
        </Text>
        <Text color={colors.muted}>
          {"  "}Run <Text color={colors.info}>simpleclaw config init</Text>{" "}
          first.
        </Text>
      </Box>
    );
  }

  const entries = Object.entries(config.ai.aliases);

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold> Model Aliases</Text>
      {entries.length === 0 ? (
        <Box paddingLeft={2}>
          <Text color={colors.muted}>
            No aliases configured. Use{" "}
            <Text color={colors.info}>simpleclaw model alias set</Text> to
            create one.
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingLeft={2}>
          {entries.map(([name, ref]) => (
            <Text key={name}>
              <Text color={colors.warning} bold>
                {name}
              </Text>
              <Text color={colors.muted}> → </Text>
              <Text>{ref}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
