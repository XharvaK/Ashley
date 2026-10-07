import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQuietDuration, QUIET_DEFAULT_MS, QUIET_MAX_MS } from "./quiet.js";

describe("quiet duration", () => {
  it("parses 30m and 2h, defaults to 2h, and refuses more than 12h", () => {
    assert.deepEqual(parseQuietDuration(null), { ok: true, durationMs: QUIET_DEFAULT_MS });
    assert.deepEqual(parseQuietDuration(""), { ok: true, durationMs: QUIET_DEFAULT_MS });
    assert.deepEqual(parseQuietDuration("30m"), { ok: true, durationMs: 30 * 60 * 1000 });
    assert.deepEqual(parseQuietDuration("2h"), { ok: true, durationMs: 2 * 60 * 60 * 1000 });
    assert.equal(parseQuietDuration("12h").ok, true);
    assert.equal(parseQuietDuration("13h").ok, false);
    assert.equal(parseQuietDuration("0m").ok, false);
    assert.equal(parseQuietDuration("soon").ok, false);
    assert.ok(QUIET_MAX_MS === 12 * 60 * 60 * 1000);
  });
});
