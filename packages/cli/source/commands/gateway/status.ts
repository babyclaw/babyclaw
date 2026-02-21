import { command } from "@gud/cli";
import { AdminClient, getAdminSocketPath } from "@babyclaw/gateway";
import { c, formatUptime } from "../../ui/theme.js";

export default command({
  description: "Query the running gateway for live status",
  options: {
    json: { type: "boolean", description: "Output raw JSON" },
  },
  handler: async ({ options, client }) => {
    const json = await options.json();

    try {
      const adminClient = new AdminClient({
        socketPath: getAdminSocketPath(),
      });
      const data = await adminClient.status();

      if (json) {
        client.log(JSON.stringify(data, null, 2));
        return;
      }

      const uptime = data.uptimeMs != null ? formatUptime(data.uptimeMs) : "—";

      client.log(`${c.success("●")} Gateway is ${c.success(data.state)}`);
      client.log(`  ${c.muted("PID     ")}${data.pid}`);
      client.log(`  ${c.muted("Uptime  ")}${uptime}`);
      client.log(`  ${c.muted("Version ")}${data.version}`);
    } catch (err) {
      if (json) {
        client.log(
          JSON.stringify(
            {
              state: "stopped",
              error: err instanceof Error ? err.message : String(err),
            },
            null,
            2,
          ),
        );
        return;
      }

      client.log(`${c.error("●")} Gateway is ${c.error(c.bold("not running"))}`);
      client.log(c.muted(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  },
});
