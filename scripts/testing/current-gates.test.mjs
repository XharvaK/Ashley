import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);

test("root package exposes separable current architecture gates", () => {
  const scripts = packageJson.scripts ?? {};
  for (const name of [
    "test:current-product",
    "test:current-sandbox-v2",
    "test:current-deployment",
    "test:current-release",
    "test:full-current",
  ]) {
    assert.equal(typeof scripts[name], "string", `missing root script ${name}`);
  }
});

test("current gates keep physical qualification separate", () => {
  const scripts = packageJson.scripts ?? {};
  assert.match(String(scripts["test:current-release"]), /current-(product|sandbox|deployment)/);
  assert.doesNotMatch(String(scripts["test:current-release"]), /qualification\/run-|bubblewrap-qualification/);
});
