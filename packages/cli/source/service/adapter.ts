import { platform } from "node:os";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";

const SERVICE_LABEL = "com.simpleclaw.gateway";
const SYSTEMD_UNIT = "simpleclaw-gateway";

export type ServiceInfo = {
  installed: boolean;
  running: boolean;
  pid: number | null;
  platform: "launchd" | "systemd" | "unsupported";
};

export function detectPlatform(): "launchd" | "systemd" | "unsupported" {
  const os = platform();
  if (os === "darwin") return "launchd";
  if (os === "linux") return "systemd";
  return "unsupported";
}

function getLaunchdPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function getSystemdUnitPath(): string {
  return join(
    homedir(),
    ".config",
    "systemd",
    "user",
    `${SYSTEMD_UNIT}.service`,
  );
}

function getGatewayEntryPath(): string {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("@simpleclaw/gateway/dist/main.js");
  } catch {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    return join(thisDir, "..", "..", "..", "gateway", "dist", "main.js");
  }
}

function generateLaunchdPlist(): string {
  const nodePath = execSync("which node", { encoding: "utf8" }).trim();
  const entryPath = getGatewayEntryPath();
  const logDir = join(homedir(), ".simpleclaw", "logs");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${entryPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/gateway.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/gateway.stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:${dirname(nodePath)}</string>
  </dict>
</dict>
</plist>`;
}

function generateSystemdUnit(): string {
  const nodePath = execSync("which node", { encoding: "utf8" }).trim();
  const entryPath = getGatewayEntryPath();

  return `[Unit]
Description=Simpleclaw Gateway
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${entryPath}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target`;
}

export function install(): { path: string } {
  const plat = detectPlatform();

  if (plat === "launchd") {
    const plistPath = getLaunchdPlistPath();
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(join(homedir(), ".simpleclaw", "logs"), { recursive: true });
    writeFileSync(plistPath, generateLaunchdPlist(), "utf8");
    return { path: plistPath };
  }

  if (plat === "systemd") {
    const unitPath = getSystemdUnitPath();
    mkdirSync(dirname(unitPath), { recursive: true });
    writeFileSync(unitPath, generateSystemdUnit(), "utf8");
    execSync("systemctl --user daemon-reload");
    execSync(`systemctl --user enable ${SYSTEMD_UNIT}`);
    return { path: unitPath };
  }

  throw new Error("Unsupported platform for service installation");
}

export function uninstall(): void {
  const plat = detectPlatform();

  if (plat === "launchd") {
    const plistPath = getLaunchdPlistPath();
    try {
      execSync(`launchctl bootout gui/$(id -u) ${plistPath} 2>/dev/null`);
    } catch {
      // Already unloaded
    }
    if (existsSync(plistPath)) {
      unlinkSync(plistPath);
    }
    return;
  }

  if (plat === "systemd") {
    const unitPath = getSystemdUnitPath();
    try {
      execSync(`systemctl --user stop ${SYSTEMD_UNIT} 2>/dev/null`);
      execSync(`systemctl --user disable ${SYSTEMD_UNIT} 2>/dev/null`);
    } catch {
      // Already stopped/disabled
    }
    if (existsSync(unitPath)) {
      unlinkSync(unitPath);
    }
    execSync("systemctl --user daemon-reload");
    return;
  }

  throw new Error("Unsupported platform for service uninstallation");
}

export function start(): void {
  const plat = detectPlatform();

  if (plat === "launchd") {
    const plistPath = getLaunchdPlistPath();
    if (!existsSync(plistPath)) {
      throw new Error(
        "Service not installed. Run 'simpleclaw service install' first.",
      );
    }
    execSync(`launchctl bootstrap gui/$(id -u) ${plistPath}`);
    return;
  }

  if (plat === "systemd") {
    execSync(`systemctl --user start ${SYSTEMD_UNIT}`);
    return;
  }

  throw new Error("Unsupported platform");
}

export function stop(): void {
  const plat = detectPlatform();

  if (plat === "launchd") {
    const plistPath = getLaunchdPlistPath();
    execSync(`launchctl bootout gui/$(id -u) ${plistPath}`);
    return;
  }

  if (plat === "systemd") {
    execSync(`systemctl --user stop ${SYSTEMD_UNIT}`);
    return;
  }

  throw new Error("Unsupported platform");
}

export function restart(): void {
  const plat = detectPlatform();

  if (plat === "launchd") {
    const plistPath = getLaunchdPlistPath();
    try {
      execSync(`launchctl bootout gui/$(id -u) ${plistPath} 2>/dev/null`);
    } catch {
      // May not be running
    }
    execSync(`launchctl bootstrap gui/$(id -u) ${plistPath}`);
    return;
  }

  if (plat === "systemd") {
    execSync(`systemctl --user restart ${SYSTEMD_UNIT}`);
    return;
  }

  throw new Error("Unsupported platform");
}

export function getStatus(): ServiceInfo {
  const plat = detectPlatform();

  if (plat === "launchd") {
    const plistPath = getLaunchdPlistPath();
    const installed = existsSync(plistPath);
    let running = false;
    let pid: number | null = null;

    if (installed) {
      try {
        const output = execSync(
          `launchctl list ${SERVICE_LABEL} 2>/dev/null`,
          { encoding: "utf8" },
        );
        running = true;
        const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
        if (pidMatch) {
          pid = parseInt(pidMatch[1]!, 10);
        }
      } catch {
        // Service loaded but not running, or not loaded
        try {
          const output = execSync(`launchctl print gui/$(id -u)/${SERVICE_LABEL} 2>/dev/null`, {
            encoding: "utf8",
          });
          running = output.includes("state = running");
          const pidMatch = output.match(/pid\s*=\s*(\d+)/);
          if (pidMatch) {
            pid = parseInt(pidMatch[1]!, 10);
          }
        } catch {
          running = false;
        }
      }
    }

    return { installed, running, pid, platform: "launchd" };
  }

  if (plat === "systemd") {
    const unitPath = getSystemdUnitPath();
    const installed = existsSync(unitPath);
    let running = false;
    let pid: number | null = null;

    if (installed) {
      try {
        const output = execSync(
          `systemctl --user is-active ${SYSTEMD_UNIT} 2>/dev/null`,
          { encoding: "utf8" },
        );
        running = output.trim() === "active";
      } catch {
        running = false;
      }
      if (running) {
        try {
          const output = execSync(
            `systemctl --user show ${SYSTEMD_UNIT} --property=MainPID 2>/dev/null`,
            { encoding: "utf8" },
          );
          const match = output.match(/MainPID=(\d+)/);
          if (match && match[1] !== "0") {
            pid = parseInt(match[1]!, 10);
          }
        } catch {
          // Ignore
        }
      }
    }

    return { installed, running, pid, platform: "systemd" };
  }

  return { installed: false, running: false, pid: null, platform: "unsupported" };
}
