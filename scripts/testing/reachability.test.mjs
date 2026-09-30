import assert from "node:assert/strict";
import test from "node:test";
import { scanReachability } from "./reachability.mjs";

test("agent-service has no unreachable non-test source outside the allowlist", () => {
  const { unlisted, staleAllowlist } = scanReachability();
  assert.deepEqual(unlisted, [], "new production-unreachable files: delete them or allowlist them with a reason");
  assert.deepEqual(staleAllowlist, [], "allowlisted files that are now reachable or gone: drop them from the allowlist");
});
