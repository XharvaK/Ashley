import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const gate = process.argv[2];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const pythonCommand = process.platform === "win32" ? "python" : "python3";
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
    "[current-gate:current-sandbox-v2] Windows host: 2 sandbox-v2 suites excluded (src/authorship/executor.test.ts, src/export/executor.test.ts); POSIX-canonical-path fixtures run on Linux CI and Mint physical qualification",
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
    ["node", ["--test", "scripts/testing/current-gates.test.mjs", "scripts/testing/reachability.test.mjs", "scripts/mint/coherent-activation.test.mjs", "scripts/mint/backup-bootstrap.test.mjs", "scripts/mint/remote-update-exit-code.test.mjs"]],
    [pythonCommand, ["deploy/linux-mint/self_courier_test.py"]],
  ],
  "full-current": [
    ["npm", ["test", "--prefix", "apps/agent-service"]],
    ["npm", ["test", "--prefix", "apps/discord-bot"]],
    ["npm", ["test", "--prefix", "apps/observer-exporter"]],
    ["npm", ["test", "--prefix", "apps/sandbox-policy"]],
    ["npm", ["test", "--prefix", "apps/sandbox-m1"]],
    ["npm", ["test", "--prefix", "apps/sandbox-tree"]],
    ["npm", sandboxV2TestArgs],
    ["node", ["--test", "scripts/testing/current-gates.test.mjs", "scripts/testing/reachability.test.mjs", "scripts/mint/coherent-activation.test.mjs", "scripts/mint/backup-bootstrap.test.mjs", "scripts/mint/remote-update-exit-code.test.mjs"]],
    [pythonCommand, ["deploy/linux-mint/self_courier_test.py"]],
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
