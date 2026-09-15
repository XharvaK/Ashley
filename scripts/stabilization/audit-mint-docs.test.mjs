import assert from "node:assert/strict";
import { test } from "node:test";
import { readSupportedSchemaVersion } from "./audit-mint-docs.mjs";

test("schema audit resolves the derived nuclear supported version", () => {
  const source = [
    "const OBSERVED_NUCLEAR_BASELINE_VERSION = 46 as const;",
    "export const NUCLEAR_SUPPORTED_VERSION = OBSERVED_NUCLEAR_BASELINE_VERSION + 1;",
  ].join("\n");

  assert.equal(readSupportedSchemaVersion(source), 47);
});
