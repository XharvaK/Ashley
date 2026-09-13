import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    environment: "node",
    testTimeout: 20_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    setupFiles: ["src/core/qualification/offline-network-guard.ts"],
  },
});
