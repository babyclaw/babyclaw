import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { AdminClient, getAdminSocketPath } from "@simpleclaw/gateway";
import { colors, formatUptime } from "../../ui/theme.js";
import { useExit } from "../../ui/hooks.js";
import zod from "zod";

export const options = zod.object({
  json: zod.boolean().default(false).describe("Output raw JSON"),
});

type Props = {
  options: zod.infer<typeof options>;
};

type StatusData = {
  state: string;
  uptimeMs: number | null;
  version: string;
  pid: number;
};

type Result =
  | { kind: "loading" }
  | { kind: "ok"; data: StatusData }
  | { kind: "error"; message: string };

export default function GatewayStatus({ options: opts }: Props) {
  const [result, setResult] = useState<Result>({ kind: "loading" });

  useExit({ done: result.kind !== "loading" });

  useEffect(() => {
    void (async () => {
      try {
        const client = new AdminClient({
          socketPath: getAdminSocketPath(),
        });
        const data = await client.status();
        setResult({ kind: "ok", data });
      } catch (err) {
        setResult({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, []);

  if (result.kind === "loading") {
    return <Text color={colors.muted}>Connecting to gateway...</Text>;
  }

  if (result.kind === "error") {
    if (opts.json) {
      return (
        <Text>
          {JSON.stringify({ state: "stopped", error: result.message }, null, 2)}
        </Text>
      );
    }
    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text color={colors.error}>●</Text> Gateway is{" "}
          <Text bold color={colors.error}>
            not running
          </Text>
        </Text>
        <Text color={colors.muted}>  {result.message}</Text>
      </Box>
    );
  }

  const { data } = result;

  if (opts.json) {
    return <Text>{JSON.stringify(data, null, 2)}</Text>;
  }

  const uptime = data.uptimeMs != null ? formatUptime(data.uptimeMs) : "—";

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        <Text color={colors.success}>●</Text> Gateway is{" "}
        <Text bold color={colors.success}>
          {data.state}
        </Text>
      </Text>
      <Box flexDirection="column" paddingLeft={2}>
        <Text>
          <Text color={colors.muted}>PID     </Text>
          <Text>{data.pid}</Text>
        </Text>
        <Text>
          <Text color={colors.muted}>Uptime  </Text>
          <Text>{uptime}</Text>
        </Text>
        <Text>
          <Text color={colors.muted}>Version </Text>
          <Text>{data.version}</Text>
        </Text>
      </Box>
    </Box>
  );
}
