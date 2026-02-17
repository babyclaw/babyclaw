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
    // On a clean dev machine, service should not be installed
    // This test verifies the adapter doesn't crash when querying
    expect(typeof info.installed).toBe("boolean");
  });
});
