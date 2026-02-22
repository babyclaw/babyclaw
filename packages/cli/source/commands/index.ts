import { command } from "@gud/cli";
import { c, getRandomBanner, getRandomTip } from "../ui/theme.js";

export default command({
  description: "Your friendly neighborhood agent gateway",
  handler: async ({ client }) => {
    client.log(c.brand(getRandomBanner()));

    const pad = (cmd: string, width: number) => cmd + " ".repeat(Math.max(1, width - cmd.length));

    const cmds = [
      ["config init", "Create a fresh configuration file"],
      ["config validate", "Validate your current config"],
      ["config edit", "Open config in your editor"],
      ["service install", "Install the gateway as a system service"],
      ["service uninstall", "Uninstall the gateway system service"],
      ["service status", "Check if the gateway service is installed/running"],
      ["service start", "Start the gateway service"],
      ["service stop", "Stop the gateway service"],
      ["service restart", "Restart the gateway service"],
      ["model", "Show current model configuration"],
      ["model configure", "Interactive model provider setup wizard"],
      ["model alias", "List model aliases"],
      ["model alias set", "Create or update a model alias"],
      ["model alias remove", "Remove a model alias"],
      ["gateway status", "Query the running gateway for live status"],
      ["gateway reload", "Check gateway health / signal a reload"],
      ["skill install", "Install a skill from ClawHub"],
      ["skill search", "Search for skills on ClawHub"],
      ["skill bundled", "List available bundled skills"],
      ["skill enable", "Enable a bundled skill"],
      ["skill disable", "Disable a bundled skill"],
      ["doctor", "Run diagnostics on your setup"],
      ["update", "Update babyclaw to the latest version"],
    ] as const;

    client.log("");
    client.log("   " + c.bold("Commands:"));
    for (const [name, desc] of cmds) {
      client.log(`   ${c.info(pad(name, 20))}${c.muted("· ")}${desc}`);
    }
    client.log("");
    client.log(`   ${c.muted(`💡 tip: ${getRandomTip()}`)}`);
  },
});
