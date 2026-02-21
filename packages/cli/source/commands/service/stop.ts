import { command } from "@gud/cli";
import { c } from "../../ui/theme.js";
import { detectPlatform, getStatus, stop } from "../../service/adapter.js";

export default command({
  description: "Stop the gateway service",
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
        client.log(c.warning("⚠ Service is not installed."));
        return;
      }

      if (!info.running) {
        client.log(c.warning("⚠ Gateway is not running. Nothing to stop."));
        return;
      }

      stop();
      client.log(c.success("✓ Gateway stopped. The claw rests. 🦞"));
    } catch (err) {
      client.log(c.error("✗ Failed to stop gateway"));
      client.log(c.muted(`  ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
  },
});
