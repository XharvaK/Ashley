import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectLanguage,
  fumbleLine,
  lookingLine,
} from "./fumble-lines.js";

describe("fumble-lines language", () => {
  it("detects Turkish vs English", () => {
    assert.equal(detectLanguage("what is the latest version"), "en");
    assert.equal(detectLanguage("son sürüme bir bak"), "tr");
  });

  it("looking line matches language", () => {
    const en = lookingLine("what is the latest discord.js");
    const tr = lookingLine("son sürüme bir bak");
    assert.match(en, /sec|hang|gimme|looking|checking|pulling/i);
    assert.match(tr, /saniye|bak|çek/i);
    assert.doesNotMatch(en, /bakıyorum/);
  });

  it("fumble line matches language", () => {
    const en = fumbleLine("say that again");
    const tr = fumbleLine("bir daha söyler misin");
    assert.match(en, /again|thread|brain|blanked|dropped|nothing|one more time/i);
    assert.match(tr, /tekrar|kaçır|beyin|boşald|dene|çıkmad|kez daha/i);
  });
});
