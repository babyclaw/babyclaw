import { command } from "@gud/cli";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { c } from "../ui/theme.js";
import { getStatus, install, restart } from "../service/adapter.js";

const PKG_NAME = "babyclaw";

function getInstalledVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require("../../package.json") as { version: string };
  return pkg.version;
}

function getLatestVersion(): string {
  return execSync(`npm view ${PKG_NAME} version`, { encoding: "utf8" }).trim();
}

function detectPackageManager(): "pnpm" | "npm" {
  const execPath = process.env["_"] ?? "";
  if (execPath.includes("pnpm")) return "pnpm";

  try {
    const agent = execSync(`npm ls -g --depth=0 ${PKG_NAME} 2>/dev/null`, { encoding: "utf8" });
    if (agent.includes(PKG_NAME)) return "npm";
  } catch {}

  try {
    execSync("pnpm --version", { encoding: "utf8", stdio: "pipe" });
    const agent = execSync(`pnpm ls -g --depth=0 ${PKG_NAME} 2>/dev/null`, {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (agent.includes(PKG_NAME)) return "pnpm";
  } catch {}

  return "npm";
}

function refreshService(): { restarted: boolean; reinstalled: boolean; error?: string } {
  try {
    const info = getStatus();
    if (!info.installed) return { restarted: false, reinstalled: false };

    install();
    if (!info.running) return { restarted: false, reinstalled: true };

    restart();
    return { restarted: true, reinstalled: true };
  } catch (err) {
    return {
      restarted: false,
      reinstalled: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default command({
  description: "Update babyclaw to the latest version",
  handler: async ({ client }) => {
    const current = getInstalledVersion();
    client.log(`  ${c.muted("current")}  ${c.info(current)}`);

    let latest: string;
    try {
      latest = getLatestVersion();
    } catch {
      client.log(c.error("  Failed to check for updates. Are you online?"));
      process.exitCode = 1;
      return;
    }

    client.log(`  ${c.muted("latest")}   ${c.info(latest)}`);

    if (current === latest) {
      client.log(c.success("\n  Already up to date! 🦀"));
      return;
    }

    const pm = detectPackageManager();
    const cmd =
      pm === "pnpm" ? `pnpm add -g ${PKG_NAME}@latest` : `npm install -g ${PKG_NAME}@latest`;

    client.log(`\n  ${c.muted("updating via")} ${c.bold(pm)}...`);

    try {
      execSync(cmd, { stdio: "inherit" });
      client.log(c.success(`\n  ✓ Updated ${current} → ${latest}`));
    } catch {
      client.log(c.error("\n  ✗ Update failed. You may need to run with sudo:"));
      client.log(c.muted(`    sudo ${cmd}`));
      process.exitCode = 1;
      return;
    }

    const result = refreshService();
    if (result.reinstalled) {
      client.log(c.success("  ✓ Service file regenerated"));
    }
    if (result.restarted) {
      client.log(c.success("  ✓ Gateway service restarted"));
    } else if (result.error) {
      client.log(c.warning(`  ⚠ Service refresh failed: ${result.error}`));
      client.log(c.muted("    Run ") + c.info("babyclaw service restart") + c.muted(" manually."));
    }
  },
});
