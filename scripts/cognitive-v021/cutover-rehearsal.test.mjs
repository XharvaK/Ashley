import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const rehearsal = "scripts/cognitive-v021/cutover-rehearsal.mjs";
const dispose = "scripts/cognitive-v021/dispose-shadow-semantic-state.mjs";

test("cutover rehearsal documents isolated-only usage", () => {
  const result = spawnSync(process.execPath, [rehearsal, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /isolated-dir/);
  assert.doesNotMatch(result.stdout, /update\.sh/);
});

test("cutover rehearsal refuses the reserved production path", () => {
  const reserved = join(homedir(), ".composer-assistant");
  const result = spawnSync(process.execPath, [rehearsal, "--nuclear", join(reserved, "conversations", "nuclear.db"), "--continuity", join(reserved, "continuity.db"), "--sidecar", join(reserved, "cognitive-v021.db")], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESERVED_PRODUCTION_PATH_REFUSED|INPUT_UNREADABLE/);
});

test("shadow disposal refuses the reserved production path before opening it", () => {
  const result = spawnSync(process.execPath, [dispose, "--sidecar", join(homedir(), ".composer-assistant", "cognitive-v021.db")], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /RESERVED_PRODUCTION_PATH_REFUSED|INPUT_UNREADABLE/);
});
