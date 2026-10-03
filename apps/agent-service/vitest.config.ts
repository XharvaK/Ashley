import os from "node:os";
import { configDefaults, defineConfig } from "vitest/config";

// `npm test` uses this file. Vitest's default worker count is
// availableParallelism() (8 on the corpus host). That saturates every
// core, so the main process misses worker RPC and the run ends with
// `[vitest-worker]: Timeout calling "onTaskUpdate"` even when every
// test passed. Keep two cores free for the main process and the OS.
const cpuCount = os.availableParallelism?.() ?? os.cpus().length;

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
    environment: "node",
    testTimeout: 20_000,
    maxWorkers: Math.max(1, cpuCount - 2),
    minWorkers: 1,
  },
});
