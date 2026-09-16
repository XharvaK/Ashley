import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectLanguage,
  fumbleLine,
  lookingLine,
  sendFailedLine,
} from "./fumble-lines.js";

describe("fumble-lines language", () => {
  it("detects Turkish vs English", () => {
    assert.equal(detectLanguage("what is the latest version"), "en");
    assert.equal(detectLanguage("son sürüme bir bak"), "tr");
  });

  it("looking line matches language", () => {
    const en = lookingLine("what is the latest discord.js");
    const tr = lookingLine("son sürüme bir bak");
    assert.match(en, /^\[system\] /);
    assert.match(tr, /^\[system\] /);
    assert.match(en, /checking|retrieving|in progress/i);
    assert.match(tr, /kontrol|alınıyor/i);
  });

  it("fumble line matches language", () => {
    const en = fumbleLine("say that again");
    const tr = fumbleLine("bir daha söyler misin");
    assert.match(en, /^\[system\] /);
    assert.match(tr, /^\[system\] /);
    assert.match(en, /output|response|retry|repeat|try again/i);
    assert.match(tr, /çıktı|yanıt|tekrar|deneyin/i);
  });

  it("attributes delivery failure mechanically", () => {
    const en = sendFailedLine("send this");
    const tr = sendFailedLine("bunu gönder");
    assert.match(en, /^\[system\] /);
    assert.match(tr, /^\[system\] /);
  });
});
