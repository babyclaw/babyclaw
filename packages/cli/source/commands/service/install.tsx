import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";
import {
  detectPlatform,
  install,
  getStatus,
} from "../../service/adapter.js";

type State = "checking" | "installing" | "done" | "already" | "error" | "unsupported";

export default function ServiceInstall() {
  const [state, setState] = useState<State>("checking");
  const [servicePath, setServicePath] = useState("");
  const [error, setError] = useState("");

  useExit({ done: state !== "checking" && state !== "installing" });

  useEffect(() => {
    try {
      const plat = detectPlatform();
      if (plat === "unsupported") {
        setState("unsupported");
        return;
      }

      const info = getStatus();
      if (info.installed) {
        setState("already");
        return;
      }

      setState("installing");
      const result = install();
      setServicePath(result.path);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  if (state === "checking" || state === "installing") {
    return <Text color={colors.muted}>Installing service...</Text>;
  }

  if (state === "unsupported") {
    return (
      <Text color={colors.error}>
        ✗ Unsupported platform. Only macOS (launchd) and Linux (systemd) are
        supported.
      </Text>
    );
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Failed to install service</Text>
        <Text color={colors.muted}>  {error}</Text>
      </Box>
    );
  }

  if (state === "already") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.warning}>⚠ Service is already installed.</Text>
        <Text color={colors.muted}>
          {"  "}Use{" "}
          <Text color={colors.info}>simpleclaw service uninstall</Text> to
          remove it first.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={colors.success}>✓ Service installed!</Text>
      <Text color={colors.muted}>  {servicePath}</Text>
      <Text color={colors.muted}>
        {"  "}Run <Text color={colors.info}>simpleclaw service start</Text> to
        fire it up.
      </Text>
    </Box>
  );
}
