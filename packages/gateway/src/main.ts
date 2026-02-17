import { GatewayRuntime } from "./runtime.js";

const runtime = new GatewayRuntime();

runtime.registerSignalHandlers();
runtime.start().catch((error) => {
  console.error("Failed to start Telegram gateway bot:", error);
  process.exit(1);
});
