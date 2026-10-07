// Root invocations filter by path. The bot's other tests use node:test, so
// only the presence driver is included from that package. Plain export so the
// config loads without a root vitest install.
export default {
  test: {
    include: [
      "apps/agent-service/src/**/*.test.ts",
      "apps/discord-bot/src/presence/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
};
