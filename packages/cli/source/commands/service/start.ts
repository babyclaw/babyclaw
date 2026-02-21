import { command } from "@gud/cli";
import { c } from "../../ui/theme.js";
import { detectPlatform, getStatus, start } from "../../service/adapter.js";

export default command({
  description: "Start the gateway service",
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
        client.log(c.error("✗ Service is not installed."));
        client.log(c.muted("  Run ") + c.info("babyclaw service install") + c.muted(" first."));
        process.exitCode = 1;
        return;
      }

      if (info.running) {
        client.log(
          c.warning("⚠ Gateway is already running. Use ") +
            c.info("babyclaw service restart") +
            c.warning(" to bounce it."),
        );
        return;
      }

      start();
      client.log(c.success("✓ Gateway started! Pincers are hot. 🦀"));
      client.log(c.muted("  Run ") + c.info("babyclaw gateway status") + c.muted(" to verify."));
    } catch (err) {
      client.log(c.error("✗ Failed to start gateway"));
      client.log(c.muted(`  ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
  },
});
