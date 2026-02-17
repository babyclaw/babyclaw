import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  getConfigPath,
  getDefaultConfigTemplate,
} from "@simpleclaw/gateway";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";
import zod from "zod";

export const options = zod.object({
  force: zod.boolean().default(false).describe("Overwrite existing config file"),
});

type Props = {
  options: zod.infer<typeof options>;
};

type State = "checking" | "exists" | "created" | "error";

export default function ConfigInit({ options: opts }: Props) {
  const [state, setState] = useState<State>("checking");
  const [configPath] = useState(() => getConfigPath());
  const [errorMsg, setErrorMsg] = useState("");

  useExit({ done: state !== "checking" });

  useEffect(() => {
    void (async () => {
      try {
        if (existsSync(configPath) && !opts.force) {
          setState("exists");
          return;
        }

        await mkdir(dirname(configPath), { recursive: true });
        await writeFile(configPath, getDefaultConfigTemplate(), "utf8");
        setState("created");
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : String(error));
        setState("error");
      }
    })();
  }, [configPath, opts.force]);

  if (state === "checking") {
    return <Text color={colors.muted}>Checking config...</Text>;
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Failed to create config</Text>
        <Text color={colors.muted}>{errorMsg}</Text>
      </Box>
    );
  }

  if (state === "exists") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.warning}>⚠ Config file already exists at:</Text>
        <Text color={colors.muted}>  {configPath}</Text>
        <Text color={colors.muted}>  Use --force to overwrite.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.success}>✓ Config created!</Text>
      <Text color={colors.muted}>  {configPath}</Text>
      <Text>
        <Text color={colors.muted}>  Next: run </Text>
        <Text color={colors.info}>simpleclaw model configure</Text>
        <Text color={colors.muted}> to set up AI providers, or edit </Text>
        <Text color={colors.info}>telegram.botToken</Text>
        <Text color={colors.muted}> and </Text>
        <Text color={colors.info}>ai.providers</Text>
        <Text color={colors.muted}> manually.</Text>
      </Text>
    </Box>
  );
}
