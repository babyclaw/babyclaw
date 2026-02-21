import { command } from "@gud/cli";
import { c } from "../../ui/theme.js";
import { detectPlatform, getStatus, uninstall } from "../../service/adapter.js";

export default command({
  description: "Uninstall the gateway system service",
  handler: async ({ client }) => {
    try {
      const plat = detectPlatform();
      if (plat === "unsupported") {
        client.log(c.error("✗ Unsupported platform."));
        process.exitCode = 1;
        return;
      }

      const info = getStatus();
      if (!info.installed) {
        client.log(c.warning("⚠ Service is not installed. Nothing to uninstall."));
        return;
      }

      uninstall();
      client.log(c.success("✓ Service uninstalled. Goodbye, old friend."));
    } catch (err) {
      client.log(c.error("✗ Failed to uninstall service"));
      client.log(c.muted(`  ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
  },
});
