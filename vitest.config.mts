import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    sequence: {
      concurrent: false,
    },
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
