import assert from "node:assert/strict";
import { test } from "node:test";
import { runHealthAudit } from "./audit-health.mjs";
import { runMintDocsAudit } from "./audit-mint-docs.mjs";
import { runResourceAudit } from "./audit-resources.mjs";

test("health audit enforces public and owner-only surfaces", () => {
  const result = runHealthAudit();
  assert.deepEqual(result.publicFields, ["ok", "ready", "state", "uptimeSec", "providerState"]);
  assert.equal(result.ownerProtected, true);
});

test("resource audit leaves no retained fake-load payloads", () => {
  const result = runResourceAudit({ iterations: 80, payloadBytes: 256 });
  assert.equal(result.retainedPayloads, 0);
  assert.equal(result.logGrowthBytes, 0);
});

test("Mint documentation audit is repository-only and dual-DB aware", () => {
  const result = runMintDocsAudit();
  assert.ok(result.schemaVersion >= 19);
  assert.deepEqual(result.endpoints, ["GET /health", "GET /nuclear/health"]);
  assert.equal(result.execution, "repository files only");
});
