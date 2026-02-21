import { command } from "@gud/cli";
import { AdminClient, getAdminSocketPath } from "@babyclaw/gateway";
import { c } from "../../ui/theme.js";

export default command({
  description: "Check gateway health / signal a reload",
  handler: async ({ client }) => {
    try {
      const adminClient = new AdminClient({
        socketPath: getAdminSocketPath(),
      });
      await adminClient.health();

      client.log(
        c.success(
          "✓ Gateway is alive. Config reload requires a service restart for now.",
        ),
      );
      client.log(
        c.muted("  Run ") +
          c.info("babyclaw service restart") +
          c.muted(" to apply config changes."),
      );
    } catch (err) {
      client.log(c.error("✗ Could not reach the gateway"));
      client.log(
        c.muted(`  ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exitCode = 1;
    }
  },
});
