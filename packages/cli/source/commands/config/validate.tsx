import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  getConfigPath,
  simpleclawConfigSchema,
} from "@simpleclaw/gateway";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";

type State = "loading" | "valid" | "invalid" | "missing" | "error";

export default function ConfigValidate() {
  const [state, setState] = useState<State>("loading");
  const [configPath] = useState(() => getConfigPath());
  const [issues, setIssues] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  useExit({ done: state !== "loading" });

  useEffect(() => {
    void (async () => {
      try {
        if (!existsSync(configPath)) {
          setState("missing");
          return;
        }

        const raw = await readFile(configPath, "utf8");
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          setIssues(["Config file is not valid JSON."]);
          setState("invalid");
          return;
        }

        const result = simpleclawConfigSchema.safeParse(json);
        if (result.success) {
          setState("valid");
        } else {
          setIssues(
            result.error.issues.map((issue) => {
              const path =
                issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
              return `${path}: ${issue.message}`;
            }),
          );
          setState("invalid");
        }
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : String(error));
        setState("error");
      }
    })();
  }, [configPath]);

  if (state === "loading") {
    return <Text color={colors.muted}>Validating config...</Text>;
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Error reading config</Text>
        <Text color={colors.muted}>{errorMsg}</Text>
      </Box>
    );
  }

  if (state === "missing") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ No config file found at:</Text>
        <Text color={colors.muted}>  {configPath}</Text>
        <Text color={colors.muted}>
          {"  "}Run <Text color={colors.info}>simpleclaw config init</Text> to
          create one.
        </Text>
      </Box>
    );
  }

  if (state === "invalid") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Config is invalid</Text>
        <Text color={colors.muted}>  {configPath}</Text>
        {issues.map((issue, i) => (
          <Text key={i} color={colors.warning}>
            {"  "}• {issue}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.success}>✓ Config is valid!</Text>
      <Text color={colors.muted}>  {configPath}</Text>
    </Box>
  );
}
