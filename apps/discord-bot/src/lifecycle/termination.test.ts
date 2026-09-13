import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

test("discord-bot startup termination: terminates with exit code 78 and does not hang when config is missing", async () => {
  const dir = import.meta.dirname ?? process.cwd();
  const proc = spawn(
    process.execPath,
    ["--import", "tsx", "src/index.ts"],
    {
      cwd: join(dir, "..", ".."),
      env: {
        ...process.env,
        COMPOSER_ENV_FILE: join(dir, "nonexistent.env"),
        DISCORD_BOT_TOKEN: "",
        DISCORD_OWNER_ID: "",
      },
    },
  );

  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Process timed out (hung with active handles)"));
    }, 15000);

    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.equal(exitCode, 78);
  assert.match(stderr, /FATAL \[config_missing\] \(exit 78\)/);
});
