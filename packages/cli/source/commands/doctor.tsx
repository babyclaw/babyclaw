import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  AdminClient,
  getAdminSocketPath,
  getConfigPath,
  simpleclawConfigSchema,
} from "@simpleclaw/gateway";
import { colors } from "../ui/theme.js";
import { useExit } from "../ui/hooks.js";
import { getStatus as getServiceStatus } from "../service/adapter.js";

type Check = {
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
};

export default function Doctor() {
  const [checks, setChecks] = useState<Check[]>([]);
  const [done, setDone] = useState(false);

  useExit({ done });

  useEffect(() => {
    void (async () => {
      const results: Check[] = [];

      // 1. Config file exists
      const configPath = getConfigPath();
      if (existsSync(configPath)) {
        results.push({
          label: "Config file exists",
          status: "pass",
          detail: configPath,
        });

        // 2. Config is valid JSON + schema
        try {
          const raw = await readFile(configPath, "utf8");
          const json = JSON.parse(raw);
          const parsed = simpleclawConfigSchema.safeParse(json);
          if (parsed.success) {
            results.push({
              label: "Config passes validation",
              status: "pass",
            });
          } else {
            const count = parsed.error.issues.length;
            results.push({
              label: "Config passes validation",
              status: "fail",
              detail: `${count} issue${count === 1 ? "" : "s"} found`,
            });
          }
        } catch {
          results.push({
            label: "Config passes validation",
            status: "fail",
            detail: "Invalid JSON",
          });
        }
      } else {
        results.push({
          label: "Config file exists",
          status: "fail",
          detail: `Not found at ${configPath}`,
        });
        results.push({
          label: "Config passes validation",
          status: "fail",
          detail: "No config to validate",
        });
      }

      // 3. Service installed
      try {
        const info = getServiceStatus();
        results.push({
          label: "Service installed",
          status: info.installed ? "pass" : "warn",
          detail: info.installed
            ? `${info.platform}`
            : "Not installed yet",
        });

        // 4. Service running
        results.push({
          label: "Service running",
          status: info.running ? "pass" : "warn",
          detail: info.running
            ? `PID ${info.pid}`
            : "Not running",
        });
      } catch {
        results.push({
          label: "Service installed",
          status: "warn",
          detail: "Could not check (unsupported platform?)",
        });
      }

      // 5. Gateway reachable via admin socket
      try {
        const client = new AdminClient({
          socketPath: getAdminSocketPath(),
        });
        const status = await client.status();
        results.push({
          label: "Gateway admin socket reachable",
          status: "pass",
          detail: `State: ${status.state}`,
        });
      } catch {
        results.push({
          label: "Gateway admin socket reachable",
          status: "warn",
          detail: "Not reachable (gateway may not be running)",
        });
      }

      setChecks(results);
      setDone(true);
    })();
  }, []);

  if (!done) {
    return <Text color={colors.muted}>Running diagnostics...</Text>;
  }

  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;
  const warnCount = checks.filter((c) => c.status === "warn").length;

  const icon = (status: Check["status"]) => {
    if (status === "pass") return <Text color={colors.success}>✓</Text>;
    if (status === "warn") return <Text color={colors.warning}>⚠</Text>;
    return <Text color={colors.error}>✗</Text>;
  };

  const allGood = failCount === 0 && warnCount === 0;

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold> 🩺 simpleclaw doctor</Text>
      <Box flexDirection="column" paddingLeft={2}>
        {checks.map((check, i) => (
          <Text key={i}>
            {icon(check.status)} {check.label}
            {check.detail && (
              <Text color={colors.muted}> — {check.detail}</Text>
            )}
          </Text>
        ))}
      </Box>
      <Box paddingLeft={2}>
        {allGood ? (
          <Text color={colors.success} bold>
            All clear! Your claw is in perfect shape. 🦀
          </Text>
        ) : (
          <Text>
            <Text color={colors.success}>{passCount} passed</Text>
            {warnCount > 0 && (
              <Text color={colors.warning}> · {warnCount} warning{warnCount > 1 ? "s" : ""}</Text>
            )}
            {failCount > 0 && (
              <Text color={colors.error}> · {failCount} failed</Text>
            )}
          </Text>
        )}
      </Box>
    </Box>
  );
}
