import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/main.ts"],
  format: ["esm"],
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: false,
  outDir: "dist",
});
