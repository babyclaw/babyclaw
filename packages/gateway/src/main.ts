import { getLogger } from "./logging/index.js";
import { GatewayRuntime } from "./runtime.js";

const runtime = new GatewayRuntime();

runtime.registerSignalHandlers();
runtime.start().catch((error) => {
  getLogger().fatal({ err: error }, "Failed to start gateway");
  process.exit(1);
});
