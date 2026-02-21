import { command } from "@gud/cli";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  AdminClient,
  getAdminSocketPath,
  getConfigPath,
  babyclawConfigSchema,
} from "@babyclaw/gateway";
import { c } from "../ui/theme.js";
import { getStatus as getServiceStatus } from "../service/adapter.js";

type Check = {
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
};

function icon(status: Check["status"]): string {
  if (status === "pass") return c.success("✓");
  if (status === "warn") return c.warning("⚠");
  return c.error("✗");
}

export default command({
  description: "Run diagnostics on your setup",
  handler: async ({ client }) => {
    const checks: Check[] = [];

    const configPath = getConfigPath();
    if (existsSync(configPath)) {
      checks.push({
        label: "Config file exists",
        status: "pass",
        detail: configPath,
      });

      try {
        const raw = await readFile(configPath, "utf8");
        const json = JSON.parse(raw);
        const parsed = babyclawConfigSchema.safeParse(json);
        if (parsed.success) {
          checks.push({ label: "Config passes validation", status: "pass" });
        } else {
          const count = parsed.error.issues.length;
          checks.push({
            label: "Config passes validation",
            status: "fail",
            detail: `${count} issue${count === 1 ? "" : "s"} found`,
          });
        }
      } catch {
        checks.push({
          label: "Config passes validation",
          status: "fail",
          detail: "Invalid JSON",
        });
      }
    } else {
      checks.push({
        label: "Config file exists",
        status: "fail",
        detail: `Not found at ${configPath}`,
      });
      checks.push({
        label: "Config passes validation",
        status: "fail",
        detail: "No config to validate",
      });
    }

    try {
      const info = getServiceStatus();
      checks.push({
        label: "Service installed",
        status: info.installed ? "pass" : "warn",
        detail: info.installed ? `${info.platform}` : "Not installed yet",
      });
      checks.push({
        label: "Service running",
        status: info.running ? "pass" : "warn",
        detail: info.running ? `PID ${info.pid}` : "Not running",
      });
    } catch {
      checks.push({
        label: "Service installed",
        status: "warn",
        detail: "Could not check (unsupported platform?)",
      });
    }

    try {
      const adminClient = new AdminClient({
        socketPath: getAdminSocketPath(),
      });
      const status = await adminClient.status();
      checks.push({
        label: "Gateway admin socket reachable",
        status: "pass",
        detail: `State: ${status.state}`,
      });
    } catch {
      checks.push({
        label: "Gateway admin socket reachable",
        status: "warn",
        detail: "Not reachable (gateway may not be running)",
      });
    }

    const passCount = checks.filter((ck) => ck.status === "pass").length;
    const failCount = checks.filter((ck) => ck.status === "fail").length;
    const warnCount = checks.filter((ck) => ck.status === "warn").length;

    client.log(c.bold(" 🩺 babyclaw doctor"));
    client.log("");
    for (const check of checks) {
      const detail = check.detail ? c.muted(` — ${check.detail}`) : "";
      client.log(`  ${icon(check.status)} ${check.label}${detail}`);
    }
    client.log("");

    if (failCount === 0 && warnCount === 0) {
      client.log(c.success("  All clear! Your claw is in perfect shape. 🦀"));
    } else {
      let summary = c.success(`${passCount} passed`);
      if (warnCount > 0)
        summary += c.warning(
          ` · ${warnCount} warning${warnCount > 1 ? "s" : ""}`,
        );
      if (failCount > 0) summary += c.error(` · ${failCount} failed`);
      client.log(`  ${summary}`);
    }
  },
});
