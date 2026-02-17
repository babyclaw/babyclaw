import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";
import { detectPlatform, getStatus, start } from "../../service/adapter.js";

type State = "working" | "done" | "running" | "not-installed" | "error" | "unsupported";

export default function ServiceStart() {
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
      if (info.running) {
        setState("running");
        return;
      }

      start();
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  if (state === "working") {
    return <Text color={colors.muted}>Starting gateway...</Text>;
  }

  if (state === "unsupported") {
    return <Text color={colors.error}>✗ Unsupported platform.</Text>;
  }

  if (state === "not-installed") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Service is not installed.</Text>
        <Text color={colors.muted}>
          {"  "}Run{" "}
          <Text color={colors.info}>simpleclaw service install</Text> first.
        </Text>
      </Box>
    );
  }

  if (state === "running") {
    return (
      <Text color={colors.warning}>
        ⚠ Gateway is already running. Use{" "}
        <Text color={colors.info}>simpleclaw service restart</Text> to bounce
        it.
      </Text>
    );
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Failed to start gateway</Text>
        <Text color={colors.muted}>  {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={colors.success}>✓ Gateway started! Pincers are hot. 🦀</Text>
      <Text color={colors.muted}>
        {"  "}Run <Text color={colors.info}>simpleclaw gateway status</Text> to
        verify.
      </Text>
    </Box>
  );
}
