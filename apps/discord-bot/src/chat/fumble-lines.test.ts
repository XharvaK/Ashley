import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectLanguage,
  sendFailedLine,
} from "./fumble-lines.js";

describe("fumble-lines language", () => {
  it("detects Turkish vs English", () => {
    assert.equal(detectLanguage("what is the latest version"), "en");
    assert.equal(detectLanguage("son sürüme bir bak"), "tr");
  });

  it("attributes delivery failure mechanically", () => {
    const en = sendFailedLine("send this");
    const tr = sendFailedLine("bunu gönder");
    assert.match(en, /^\[system\] /);
    assert.match(tr, /^\[system\] /);
  });
});
