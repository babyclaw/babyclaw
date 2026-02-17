import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { getConfigPath } from "@simpleclaw/gateway";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";

export default function ConfigEdit() {
  const [configPath] = useState(() => getConfigPath());
  const [state, setState] = useState<"opening" | "done" | "error" | "missing">(
    "opening",
  );
  const [errorMsg, setErrorMsg] = useState("");

  useExit({ done: state !== "opening" });

  useEffect(() => {
    void (async () => {
      try {
        if (!existsSync(configPath)) {
          setState("missing");
          return;
        }

        const editor =
          process.env["EDITOR"] || process.env["VISUAL"] || "vi";

        try {
          execSync(`${editor} ${JSON.stringify(configPath)}`, {
            stdio: "inherit",
          });
        } catch {
          const content = await readFile(configPath, "utf8");
          process.stdout.write(`\nCurrent config at ${configPath}:\n\n`);
          process.stdout.write(content);
          process.stdout.write(
            "\nEdit this file manually, then run 'simpleclaw config validate'.\n",
          );
        }

        setState("done");
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : String(error));
        setState("error");
      }
    })();
  }, [configPath]);

  if (state === "opening") {
    return <Text color={colors.muted}>Opening editor...</Text>;
  }

  if (state === "missing") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ No config file found at:</Text>
        <Text color={colors.muted}>  {configPath}</Text>
        <Text color={colors.muted}>
          {"  "}Run <Text color={colors.info}>simpleclaw config init</Text>{" "}
          first.
        </Text>
      </Box>
    );
  }

  if (state === "error") {
    return (
      <Box flexDirection="column">
        <Text color={colors.error}>✗ {errorMsg}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.success}>✓ Editor closed.</Text>
      <Text color={colors.muted}>
        {"  "}Run <Text color={colors.info}>simpleclaw config validate</Text> to
        check for issues.
      </Text>
    </Box>
  );
}
