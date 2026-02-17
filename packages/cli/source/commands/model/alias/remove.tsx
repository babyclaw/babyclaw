import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import zod from "zod";
import {
  getConfigPath,
  loadConfigRaw,
  writeConfig,
} from "@simpleclaw/gateway";
import { colors } from "../../../ui/theme.js";
import { useExit } from "../../../ui/hooks.js";

export const options = zod.object({
  name: zod.string().min(1).describe("Alias name to remove"),
});

type Props = {
  options: zod.infer<typeof options>;
};

type State = "loading" | "done" | "not-found" | "no-config" | "error";

export default function AliasRemove({ options: opts }: Props) {
  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useExit({ done: state !== "loading" });

  useEffect(() => {
    void (async () => {
      try {
        const config = await loadConfigRaw();
        if (!config) {
          setState("no-config");
          return;
        }

        if (!(opts.name in config.ai.aliases)) {
          setState("not-found");
          return;
        }

        delete config.ai.aliases[opts.name];
        await writeConfig({ config });
        setState("done");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    })();
  }, [opts.name]);

  if (state === "loading") {
    return <Text color={colors.muted}>Removing alias...</Text>;
  }

  if (state === "no-config") {
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

  if (state === "not-found") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.warning}>
          Alias <Text bold>{opts.name}</Text> does not exist.
        </Text>
        <Text color={colors.muted}>
          {"  "}Run{" "}
          <Text color={colors.info}>simpleclaw model alias</Text> to see
          current aliases.
        </Text>
      </Box>
    );
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>Failed to remove alias</Text>
        <Text color={colors.muted}>{errorMsg}</Text>
      </Box>
    );
  }

  return (
    <Text color={colors.success}>
      Removed alias <Text bold>{opts.name}</Text>
    </Text>
  );
}
