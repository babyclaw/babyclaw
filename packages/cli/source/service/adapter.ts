import { platform } from "node:os";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { buildAugmentedPath } from "@babyclaw/gateway";
const SERVICE_LABEL = "org.babyclaw.gateway";
const SYSTEMD_UNIT = "babyclaw-gateway";

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
  return join(homedir(), ".config", "systemd", "user", `${SYSTEMD_UNIT}.service`);
}

function getGatewayEntryPath(): string {
  try {
    return fileURLToPath(import.meta.resolve("@babyclaw/gateway/main"));
  } catch {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    return join(thisDir, "..", "..", "..", "gateway", "dist", "main.js");
  }
}

function getShellPath(): string {
  const fallback = `/usr/local/bin:/usr/bin:/bin`;
  try {
    const defaultShell = platform() === "darwin" ? "/bin/zsh" : "/bin/bash";
    const shell = process.env.SHELL || defaultShell;
    return execSync(`${shell} -ilc 'echo $PATH'`, {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return process.env.PATH || fallback;
  }
}

export function generateLaunchdPlist(): string {
  const nodePath = execSync("which node", { encoding: "utf8" }).trim();
  const entryPath = getGatewayEntryPath();
  const logDir = join(homedir(), ".babyclaw", "logs");

  const shellPath = getShellPath();
  const nodeDir = dirname(nodePath);
  const augmented = buildAugmentedPath({ basePath: shellPath });
  const path = augmented.includes(nodeDir) ? augmented : `${augmented}:${nodeDir}`;

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
    <string>${path}</string>
  </dict>
</dict>
</plist>`;
}

export function generateSystemdUnit(): string {
  const nodePath = execSync("which node", { encoding: "utf8" }).trim();
  const entryPath = getGatewayEntryPath();
  const home = homedir();
  const logDir = join(home, ".babyclaw", "logs");

  const shellPath = getShellPath();
  const nodeDir = dirname(nodePath);
  const augmented = buildAugmentedPath({ basePath: shellPath });
  const envPath = augmented.includes(nodeDir) ? augmented : `${augmented}:${nodeDir}`;

  return `[Unit]
Description=BabyClaw Gateway
After=network.target

[Service]
Type=simple
WorkingDirectory=${home}
ExecStart=${nodePath} ${entryPath}
Restart=on-failure
RestartSec=5
Environment=PATH=${envPath}
Environment=HOME=${home}
Environment=NODE_ENV=production
StandardOutput=append:${logDir}/gateway.stdout.log
StandardError=append:${logDir}/gateway.stderr.log

[Install]
WantedBy=default.target`;
}

function isLingerEnabled(): boolean {
  try {
    const output = execSync(`loginctl show-user $(whoami) --property=Linger 2>/dev/null`, {
      encoding: "utf8",
    });
    return output.trim() === "Linger=yes";
  } catch {
    return false;
  }
}

function tryEnableLinger(): boolean {
  if (isLingerEnabled()) return true;
  try {
    execSync("loginctl enable-linger");
    return true;
  } catch {
    return false;
  }
}

export function install(): { path: string; warnings: string[] } {
  const plat = detectPlatform();
  const warnings: string[] = [];

  if (plat === "launchd") {
    const plistPath = getLaunchdPlistPath();
    mkdirSync(dirname(plistPath), { recursive: true });
    mkdirSync(join(homedir(), ".babyclaw", "logs"), { recursive: true });
    writeFileSync(plistPath, generateLaunchdPlist(), "utf8");
    return { path: plistPath, warnings };
  }

  if (plat === "systemd") {
    const unitPath = getSystemdUnitPath();
    mkdirSync(dirname(unitPath), { recursive: true });
    mkdirSync(join(homedir(), ".babyclaw", "logs"), { recursive: true });
    writeFileSync(unitPath, generateSystemdUnit(), "utf8");
    execSync("systemctl --user daemon-reload");
    execSync(`systemctl --user enable ${SYSTEMD_UNIT}`);

    if (!tryEnableLinger()) {
      warnings.push(
        "Could not enable loginctl linger. The service will stop when you log out.\n" +
          "    Run: sudo loginctl enable-linger $(whoami)",
      );
    }

    return { path: unitPath, warnings };
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
      throw new Error("Service not installed. Run 'babyclaw service install' first.");
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
        const output = execSync(`launchctl list ${SERVICE_LABEL} 2>/dev/null`, {
          encoding: "utf8",
        });
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
        const output = execSync(`systemctl --user is-active ${SYSTEMD_UNIT} 2>/dev/null`, {
          encoding: "utf8",
        });
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
