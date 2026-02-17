import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";
import { detectPlatform, getStatus, stop } from "../../service/adapter.js";

type State = "working" | "done" | "not-running" | "not-installed" | "error" | "unsupported";

export default function ServiceStop() {
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
      if (!info.running) {
        setState("not-running");
        return;
      }

      stop();
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    }
  }, []);

  if (state === "working") {
    return <Text color={colors.muted}>Stopping gateway...</Text>;
  }

  if (state === "unsupported") {
    return <Text color={colors.error}>✗ Unsupported platform.</Text>;
  }

  if (state === "not-installed") {
    return <Text color={colors.warning}>⚠ Service is not installed.</Text>;
  }

  if (state === "not-running") {
    return (
      <Text color={colors.warning}>
        ⚠ Gateway is not running. Nothing to stop.
      </Text>
    );
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Failed to stop gateway</Text>
        <Text color={colors.muted}>  {error}</Text>
      </Box>
    );
  }

  return (
    <Text color={colors.success}>✓ Gateway stopped. The claw rests. 🦞</Text>
  );
}
