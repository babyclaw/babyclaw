import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { AdminClient, getAdminSocketPath } from "@simpleclaw/gateway";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";

type State = "sending" | "done" | "error";

export default function GatewayReload() {
  const [state, setState] = useState<State>("sending");
  const [error, setError] = useState("");

  useExit({ done: state !== "sending" });

  useEffect(() => {
    void (async () => {
      try {
        const client = new AdminClient({
          socketPath: getAdminSocketPath(),
        });
        await client.health();
        setState("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setState("error");
      }
    })();
  }, []);

  if (state === "sending") {
    return <Text color={colors.muted}>Sending reload signal...</Text>;
  }

  if (state === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Could not reach the gateway</Text>
        <Text color={colors.muted}>  {error}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={colors.success}>
        ✓ Gateway is alive. Config reload requires a service restart for now.
      </Text>
      <Text color={colors.muted}>
        {"  "}Run <Text color={colors.info}>simpleclaw service restart</Text> to
        apply config changes.
      </Text>
    </Box>
  );
}
