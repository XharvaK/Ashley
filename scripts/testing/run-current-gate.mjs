import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const gate = process.argv[2];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const sandboxV2TestArgs = process.platform === "win32"
  ? [
      "test",
      "--prefix",
      "apps/sandbox-v2",
      "--",
      "--exclude",
      "src/authorship/executor.test.ts",
      "--exclude",
      "src/export/executor.test.ts",
    ]
  : ["test", "--prefix", "apps/sandbox-v2"];

if (process.platform === "win32" && (gate === "current-sandbox-v2" || gate === "full-current")) {
  console.log(
    "[current-gate:current-sandbox-v2] Windows host: deferring POSIX-canonical-path fixture tests to Mint physical qualification",
  );
}

const gates = {
  "current-product": [
    ["npm", ["run", "test:current", "--prefix", "apps/agent-service"]],
    ["npm", ["test", "--prefix", "apps/discord-bot"]],
  ],
  "current-sandbox-v2": [
    ["npm", ["test", "--prefix", "apps/sandbox-policy"]],
    ["npm", ["test", "--prefix", "apps/sandbox-m1"]],
    ["npm", ["test", "--prefix", "apps/sandbox-tree"]],
    ["npm", sandboxV2TestArgs],
  ],
  "current-deployment": [
    ["node", ["--test", "scripts/testing/current-gates.test.mjs", "scripts/mint/coherent-activation.test.mjs"]],
  ],
  "full-current": [
    ["npm", ["test", "--prefix", "apps/agent-service"]],
    ["npm", ["test", "--prefix", "apps/discord-bot"]],
    ["npm", ["test", "--prefix", "apps/observer-exporter"]],
    ["npm", ["test", "--prefix", "apps/sandbox-policy"]],
    ["npm", ["test", "--prefix", "apps/sandbox-m1"]],
    ["npm", ["test", "--prefix", "apps/sandbox-tree"]],
    ["npm", sandboxV2TestArgs],
    ["node", ["--test", "scripts/testing/current-gates.test.mjs", "scripts/mint/coherent-activation.test.mjs"]],
  ],
};

if (!Object.hasOwn(gates, gate)) {
  console.error(`unknown current gate: ${gate ?? "<missing>"}`);
  process.exit(2);
}

for (const [command, args] of gates[gate]) {
  const executable = command === "npm" ? npmCommand : command;
  console.log(`[current-gate:${gate}] ${executable} ${args.join(" ")}`);
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ASHLEY_PHASE0_OFFLINE: "true",
      COMPOSER_ENV_FILE: resolve("config/env.example"),
    },
  });
  if (result.error) {
    console.error(`[current-gate:${gate}] ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
