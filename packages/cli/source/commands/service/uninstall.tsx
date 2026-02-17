import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";
import { detectPlatform, getStatus, uninstall } from "../../service/adapter.js";

type State = "working" | "done" | "not-installed" | "error" | "unsupported";

export default function ServiceUninstall() {
  const [state, setState] = useState<State>("working");
  const [error, setError] = useState("");

  useExit({ done: state !== "working" });

  useEffect(() => {
    try {
      const plat = detectPlatform();
      if (plat === "unsupported") {
        setState("unsupported");
        return;
      }

      const info = getStatus();
      if (!info.installed) {
        setState("not-installed");
        return;
      }

      uninstall();
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  if (state === "working") {
    return <Text color={colors.muted}>Uninstalling service...</Text>;
  }

  if (state === "unsupported") {
    return <Text color={colors.error}>✗ Unsupported platform.</Text>;
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Failed to uninstall service</Text>
        <Text color={colors.muted}>  {error}</Text>
      </Box>
    );
  }

  if (state === "not-installed") {
    return (
      <Text color={colors.warning}>
        ⚠ Service is not installed. Nothing to uninstall.
      </Text>
    );
  }

  return (
    <Text color={colors.success}>✓ Service uninstalled. Goodbye, old friend.</Text>
  );
}
