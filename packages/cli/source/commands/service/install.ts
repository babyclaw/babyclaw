import { command } from "@gud/cli";
import { c } from "../../ui/theme.js";
import { detectPlatform, install, getStatus } from "../../service/adapter.js";

export default command({
  description: "Install the gateway as a system service",
  handler: async ({ client }) => {
    try {
      const plat = detectPlatform();
      if (plat === "unsupported") {
        client.log(
          c.error(
            "✗ Unsupported platform. Only macOS (launchd) and Linux (systemd) are supported.",
          ),
        );
        process.exitCode = 1;
        return;
      }

      const info = getStatus();
      if (info.installed) {
        client.log(c.warning("⚠ Service is already installed."));
        client.log(
          c.muted("  Use ") +
            c.info("babyclaw service uninstall") +
            c.muted(" to remove it first."),
        );
        return;
      }

      const result = install();

      client.log(c.success("✓ Service installed!"));
      client.log(c.muted(`  ${result.path}`));
      for (const warning of result.warnings) {
        client.log(c.warning(`  ⚠ ${warning}`));
      }
      client.log(c.muted("  Run ") + c.info("babyclaw service start") + c.muted(" to fire it up."));
    } catch (err) {
      client.log(c.error("✗ Failed to install service"));
      client.log(c.muted(`  ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
  },
});
