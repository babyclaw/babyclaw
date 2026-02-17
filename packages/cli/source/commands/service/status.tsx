import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";
import { detectPlatform, getStatus, type ServiceInfo } from "../../service/adapter.js";
import zod from "zod";

export const options = zod.object({
  json: zod.boolean().default(false).describe("Output raw JSON"),
});

type Props = {
  options: zod.infer<typeof options>;
};

type Result =
  | { kind: "loading" }
  | { kind: "ok"; info: ServiceInfo }
  | { kind: "error"; message: string };

export default function ServiceStatus({ options: opts }: Props) {
  const [result, setResult] = useState<Result>({ kind: "loading" });

  useExit({ done: result.kind !== "loading" });

  useEffect(() => {
    try {
      setResult({ kind: "ok", info: getStatus() });
    } catch (err) {
      setResult({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  if (result.kind === "loading") {
    return <Text color={colors.muted}>Checking service status...</Text>;
  }

  if (result.kind === "error") {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color={colors.error}>✗ Failed to check service status</Text>
        <Text color={colors.muted}>  {result.message}</Text>
      </Box>
    );
  }

  const { info } = result;

  if (opts.json) {
    return <Text>{JSON.stringify(info, null, 2)}</Text>;
  }

  const plat = detectPlatform();
  if (plat === "unsupported") {
    return (
      <Text color={colors.error}>
        ✗ Unsupported platform. Only macOS and Linux are supported.
      </Text>
    );
  }

  if (!info.installed) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text color={colors.muted}>●</Text> Service is{" "}
          <Text bold>not installed</Text>
        </Text>
        <Text color={colors.muted}>
          {"  "}Run{" "}
          <Text color={colors.info}>simpleclaw service install</Text> to set it
          up.
        </Text>
      </Box>
    );
  }

  const statusColor = info.running ? colors.success : colors.error;
  const statusText = info.running ? "running" : "stopped";

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        <Text color={statusColor}>●</Text> Service is{" "}
        <Text bold color={statusColor}>
          {statusText}
        </Text>
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color={colors.muted}>Platform  </Text>
          <Text>{info.platform}</Text>
        </Text>
        {info.pid && (
          <Text>
            <Text color={colors.muted}>PID       </Text>
            <Text>{info.pid}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}
