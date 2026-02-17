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
  name: zod.string().min(1).describe("Alias name (e.g. fast, smart)"),
  model: zod
    .string()
    .min(1)
    .describe("Model reference in provider:modelId format"),
});

type Props = {
  options: zod.infer<typeof options>;
};

type State = "loading" | "done" | "no-config" | "error";

export default function AliasSet({ options: opts }: Props) {
  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [wasUpdate, setWasUpdate] = useState(false);

  useExit({ done: state !== "loading" });

  useEffect(() => {
    void (async () => {
      try {
        const config = await loadConfigRaw();
        if (!config) {
          setState("no-config");
          return;
        }

        const aliasName = opts.name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!aliasName) {
          setErrorMsg(
            "Invalid alias name. Use only lowercase letters, numbers, hyphens, and underscores.",
          );
          setState("error");
          return;
        }

        if (!opts.model.includes(":")) {
          setErrorMsg(
            `Invalid model reference "${opts.model}". Expected format: provider:modelId`,
          );
          setState("error");
          return;
        }

        setWasUpdate(aliasName in config.ai.aliases);
        config.ai.aliases[aliasName] = opts.model;
        await writeConfig({ config });
        setState("done");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    })();
  }, [opts.name, opts.model]);

  if (state === "loading") {
    return <Text color={colors.muted}>Setting alias...</Text>;
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

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>Failed to set alias</Text>
        <Text color={colors.muted}>{errorMsg}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.success}>
        {wasUpdate ? "Updated" : "Created"} alias{" "}
        <Text color={colors.warning} bold>
          {opts.name}
        </Text>
        <Text color={colors.muted}> → </Text>
        <Text>{opts.model}</Text>
      </Text>
    </Box>
  );
}
