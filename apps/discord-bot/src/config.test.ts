import { test } from "node:test";
import assert from "node:assert/strict";
import { getRaEffectiveConfig, readBooleanFlag, resolveAgentServiceToken } from "./config.js";

test("boolean flags read false, 0, no and off as off, whatever the case", () => {
  for (const raw of ["false", "0", "no", "off", "FALSE", " Off "]) {
    assert.equal(readBooleanFlag(raw, true), false, raw);
  }
});

test("boolean flags read true, 1, yes and on as on", () => {
  for (const raw of ["true", "1", "yes", "on", "TRUE"]) {
    assert.equal(readBooleanFlag(raw, false), true, raw);
  }
});

test("a malformed or unset boolean flag keeps its default", () => {
  assert.equal(readBooleanFlag("maybe", true), true);
  assert.equal(readBooleanFlag("maybe", false), false);
  assert.equal(readBooleanFlag(undefined, true), true);
  assert.equal(readBooleanFlag("", false), false);
});

test("the Discord RA switches parse with the same words", () => {
  const off = getRaEffectiveConfig({ RA_DM_PUBLICATION: "no" });
  assert.equal(off.dmPublicationEnabled, false);
  const on = getRaEffectiveConfig({ RA_COMMITMENTS: "yes" });
  assert.equal(on.commitmentsEnabled, true);
  const defaults = getRaEffectiveConfig({});
  assert.equal(defaults.commitmentsEnabled, false);
  assert.equal(defaults.dmPublicationEnabled, true);
});

test("the agent service token is ASHLEY_SERVICE_TOKEN, falling back to the bot token with a note", () => {
  assert.deepEqual(
    resolveAgentServiceToken({ ASHLEY_SERVICE_TOKEN: " service-value ", DISCORD_BOT_TOKEN: "bot-value" }),
    { token: "service-value", fallback: false },
  );
  assert.deepEqual(
    resolveAgentServiceToken({ DISCORD_BOT_TOKEN: "bot-value" }),
    { token: "bot-value", fallback: true },
  );
  assert.deepEqual(resolveAgentServiceToken({}), { token: "", fallback: false });
});
