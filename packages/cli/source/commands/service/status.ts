import { command } from "@gud/cli";
import { c } from "../../ui/theme.js";
import { detectPlatform, getStatus } from "../../service/adapter.js";

export default command({
  description: "Check if the gateway service is installed/running",
  options: {
    json: { type: "boolean", description: "Output raw JSON" },
  },
  handler: async ({ options, client }) => {
    const json = await options.json();

    try {
      const info = getStatus();

      if (json) {
        client.log(JSON.stringify(info, null, 2));
        return;
      }

      const plat = detectPlatform();
      if (plat === "unsupported") {
        client.log(
          c.error(
            "✗ Unsupported platform. Only macOS and Linux are supported.",
          ),
        );
        process.exitCode = 1;
        return;
      }

      if (!info.installed) {
        client.log(`${c.muted("●")} Service is ${c.bold("not installed")}`);
        client.log(
          c.muted("  Run ") +
            c.info("babyclaw service install") +
            c.muted(" to set it up."),
        );
        return;
      }

      const statusColor = info.running ? c.success : c.error;
      const statusText = info.running ? "running" : "stopped";

      client.log(`${statusColor("●")} Service is ${statusColor(statusText)}`);
      client.log(`  ${c.muted("Platform  ")}${info.platform}`);
      if (info.pid) {
        client.log(`  ${c.muted("PID       ")}${info.pid}`);
      }
    } catch (err) {
      client.log(c.error("✗ Failed to check service status"));
      client.log(
        c.muted(`  ${err instanceof Error ? err.message : String(err)}`),
      );
      process.exitCode = 1;
    }
  },
});
