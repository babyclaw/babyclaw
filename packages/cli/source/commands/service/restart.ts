import { command } from "@gud/cli";
import { c } from "../../ui/theme.js";
import { detectPlatform, getStatus, restart } from "../../service/adapter.js";

export default command({
  description: "Restart the gateway service",
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
        client.log(
          c.muted("  Run ") +
            c.info("babyclaw service install") +
            c.muted(" first."),
        );
        process.exitCode = 1;
        return;
      }

      restart();
      client.log(
        c.success("✓ Gateway restarted! Fresh pincers, same claw. 🦀"),
      );
    } catch (err) {
      client.log(c.error("✗ Failed to restart gateway"));
      client.log(
        c.muted(`  ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exitCode = 1;
    }
  },
});
