import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["source/**/*.test.ts", "source/**/*.test.tsx"],
  },
});
