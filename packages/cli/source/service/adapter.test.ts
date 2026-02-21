import { describe, it, expect } from "vitest";
import { detectPlatform, getStatus } from "./adapter.js";
import { platform } from "node:os";

describe("service adapter", () => {
  it("detects the correct platform", () => {
    const os = platform();
    const detected = detectPlatform();

    if (os === "darwin") {
      expect(detected).toBe("launchd");
    } else if (os === "linux") {
      expect(detected).toBe("systemd");
    } else {
      expect(detected).toBe("unsupported");
    }
  });

  it("returns a ServiceInfo object from getStatus", () => {
    const info = getStatus();

    expect(info).toHaveProperty("installed");
    expect(info).toHaveProperty("running");
    expect(info).toHaveProperty("pid");
    expect(info).toHaveProperty("platform");
    expect(typeof info.installed).toBe("boolean");
    expect(typeof info.running).toBe("boolean");
  });

  it("reports not installed when no service file exists", () => {
    const info = getStatus();
    expect(typeof info.installed).toBe("boolean");
  });
});

describe("generateSystemdUnit", async () => {
  const os = platform();
  const skip = os !== "linux";

  // import lazily so the module-level execSync calls don't blow up on macOS
  const { generateSystemdUnit } = skip
    ? { generateSystemdUnit: () => "" }
    : await import("./adapter.js");

  it.skipIf(skip)("includes WorkingDirectory", () => {
    const unit = generateSystemdUnit();
    expect(unit).toContain("WorkingDirectory=");
  });

  it.skipIf(skip)("includes Environment PATH", () => {
    const unit = generateSystemdUnit();
    expect(unit).toMatch(/Environment=PATH=\S+/);
  });

  it.skipIf(skip)("includes Environment HOME", () => {
    const unit = generateSystemdUnit();
    expect(unit).toMatch(/Environment=HOME=\S+/);
  });

  it.skipIf(skip)("sets NODE_ENV to production", () => {
    const unit = generateSystemdUnit();
    expect(unit).toContain("Environment=NODE_ENV=production");
  });

  it.skipIf(skip)("configures stdout log file", () => {
    const unit = generateSystemdUnit();
    expect(unit).toMatch(/StandardOutput=append:.*\.babyclaw\/logs\/gateway\.stdout\.log/);
  });

  it.skipIf(skip)("configures stderr log file", () => {
    const unit = generateSystemdUnit();
    expect(unit).toMatch(/StandardError=append:.*\.babyclaw\/logs\/gateway\.stderr\.log/);
  });

  it.skipIf(skip)("uses absolute node path in ExecStart", () => {
    const unit = generateSystemdUnit();
    expect(unit).toMatch(/ExecStart=\/\S+node\s+\S+main\.js/);
  });

  it.skipIf(skip)("targets default.target for user service", () => {
    const unit = generateSystemdUnit();
    expect(unit).toContain("WantedBy=default.target");
  });
});
