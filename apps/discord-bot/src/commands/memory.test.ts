import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { execute } from "./memory.js";

describe("memory command", () => {
  it("exports an execute handler", () => {
    assert.equal(typeof execute, "function");
  });

  it("labels the Host listing as a stored mechanical summary", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "memory.ts"), "utf8");
    assert.match(source, /Stored memory summary:/);
    assert.doesNotMatch(source, /Here's what I've got:/);
  });
});
