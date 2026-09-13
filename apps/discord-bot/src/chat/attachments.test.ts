import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "discord.js";
import { describeIntake } from "./attachments.js";

type FakeAttachment = {
  id?: string;
  url: string;
  contentType: string | null;
  name?: string | null;
  duration?: number | null;
  size?: number;
};

function fakeMessage(params: {
  content?: string;
  attachments?: FakeAttachment[];
  stickers?: string[];
  embeds?: Array<{ url?: string | null }>;
}): Message {
  return {
    content: params.content ?? "",
    attachments: new Map(
      (params.attachments ?? []).map((a, i) => [
        a.id ?? String(i),
        { duration: null, name: null, size: 0, ...a },
      ]),
    ),
    stickers: new Map(
      (params.stickers ?? []).map((name, i) => [String(i), { name }]),
    ),
    embeds: params.embeds ?? [],
  } as unknown as Message;
}

describe("describeIntake", () => {
  it("passes plain text through untouched", () => {
    const intake = describeIntake(fakeMessage({ content: "hey" }));
    assert.equal(intake.text, "hey");
    assert.deepEqual(intake.attachments, []);
    assert.equal(intake.hasMedia, false);
  });

  it("gives an uncaptioned image a turn instead of dropping it", () => {
    const intake = describeIntake(
      fakeMessage({
        attachments: [
          {
            id: "att-1",
            url: "https://cdn.example/a.png",
            contentType: "image/png",
          },
        ],
      }),
    );
    assert.equal(intake.attachments.length, 1);
    assert.equal(intake.attachments[0]!.sourceUrl, "https://cdn.example/a.png");
    assert.match(intake.text, /image attachment/);
    assert.match(intake.text, /vision capability/);
  });

  it("keeps the caption and the note apart", () => {
    const intake = describeIntake(
      fakeMessage({
        content: "look at this",
        attachments: [
          {
            id: "att-1",
            url: "https://cdn.example/a.jpg",
            contentType: "image/jpeg",
          },
        ],
      }),
    );
    assert.match(intake.text, /^look at this/);
    assert.match(intake.text, /Doc sent an image attachment/);
  });

  it("is honest about a voice note", () => {
    const intake = describeIntake(
      fakeMessage({
        attachments: [
          {
            url: "https://cdn.example/v.ogg",
            contentType: "audio/ogg",
            duration: 14.4,
          },
        ],
      }),
    );
    assert.deepEqual(intake.attachments, []);
    assert.match(intake.text, /voice note 14s, which I cannot listen to/);
  });

  it("names a file it cannot open", () => {
    const intake = describeIntake(
      fakeMessage({
        attachments: [
          {
            url: "https://cdn.example/x.pdf",
            contentType: "application/pdf",
            name: "notes.pdf",
          },
        ],
      }),
    );
    assert.match(intake.text, /file called notes\.pdf that I cannot open/);
  });

  it("caps images at four and mentions the rest", () => {
    const attachments = Array.from({ length: 6 }, (_, i) => ({
      id: `att-${i}`,
      url: `https://cdn.example/${i}.png`,
      contentType: "image/png",
    }));
    const intake = describeIntake(fakeMessage({ attachments }));
    assert.equal(intake.attachments.length, 4);
    assert.match(intake.text, /beyond this turn's attachment limit/);
  });

  it("treats a sticker as a message", () => {
    const intake = describeIntake(fakeMessage({ stickers: ["thumbs up"] }));
    assert.equal(intake.text, '(Doc sent the "thumbs up" sticker.)');
    assert.equal(intake.hasMedia, true);
  });

  it("handles a content type with parameters", () => {
    const intake = describeIntake(
      fakeMessage({
        attachments: [
          {
            id: "att-1",
            url: "https://cdn.example/a.webp",
            contentType: "image/webp; charset=binary",
          },
        ],
      }),
    );
    assert.equal(intake.attachments[0]!.declaredMime, "image/webp");
  });

  it("stays empty when there is genuinely nothing", () => {
    assert.equal(describeIntake(fakeMessage({})).text, "");
  });

  it("uses the first secure URL from an embed-only paste", () => {
    const intake = describeIntake(fakeMessage({
      embeds: [{ url: "https://example.com/article" }],
    }));
    assert.equal(intake.text, "https://example.com/article");
    assert.equal(intake.hasMedia, false);
  });
});
