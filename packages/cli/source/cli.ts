#!/usr/bin/env node
import { run, help } from "@gud/cli";

await run({
  plugins: [help()],
});
