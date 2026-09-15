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
  id?: string;
  content?: string;
  attachments?: FakeAttachment[];
  stickers?: string[];
  embeds?: Array<{ url?: string | null }>;
  author?: { id: string; bot?: boolean };
  channelId?: string;
  guildId?: string;
  mentionIds?: string[];
  replyToMessageId?: string;
  createdTimestamp?: number;
}): Message {
  const message: Record<string, unknown> = {
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
  };
  if (params.id) message.id = params.id;
  if (params.author) message.author = params.author;
  if (params.channelId) message.channel = { id: params.channelId };
  if (params.guildId) message.guild = { id: params.guildId };
  if (params.mentionIds) {
    message.mentions = { users: new Map(params.mentionIds.map((id) => [id, {}])) };
  }
  if (params.replyToMessageId) {
    message.reference = { messageId: params.replyToMessageId };
  }
  if (params.createdTimestamp !== undefined) {
    message.createdTimestamp = params.createdTimestamp;
  }
  return message as unknown as Message;
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
            id: "voice-1",
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

  it("ingests passive text extensions with compatible text MIME", () => {
    for (const name of ["notes.txt", "notes.md", "notes.markdown"]) {
      const intake = describeIntake(fakeMessage({
        attachments: [{
          id: name,
          url: `https://cdn.example/${name}`,
          contentType: "text/plain",
          name,
        }],
      }));

      assert.equal(intake.attachments.length, 1);
      assert.equal(intake.hasIngestibleTextAttachment, true);
      assert.match(intake.text, /attached text file/);
    }
  });

  it("admits textless passive text attachments and octet-stream MIME", () => {
    const intake = describeIntake(fakeMessage({
      attachments: [{
        id: "notes.txt",
        url: "https://cdn.example/notes.txt",
        contentType: "application/octet-stream",
        name: "notes.txt",
      }],
    }));

    assert.equal(intake.text.length > 0, true);
    assert.equal(intake.attachments.length, 1);
    assert.equal(intake.hasIngestibleTextAttachment, true);
  });

  it("rejects passive extensions with incompatible MIME", () => {
    const intake = describeIntake(fakeMessage({
      attachments: [{
        id: "notes.txt",
        url: "https://cdn.example/notes.txt",
        contentType: "image/png",
        name: "notes.txt",
      }],
    }));

    assert.deepEqual(intake.attachments, []);
    assert.equal(intake.hasIngestibleTextAttachment, false);
    assert.match(intake.text, /cannot open/);
  });

  it("rejects deny-listed extensions regardless of MIME", () => {
    for (const name of ["evil.exe", "run.sh", "archive.zip"]) {
      const intake = describeIntake(fakeMessage({
        attachments: [{
          id: name,
          url: `https://cdn.example/${name}`,
          contentType: "text/plain",
          name,
        }],
      }));

      assert.deepEqual(intake.attachments, []);
      assert.equal(intake.hasIngestibleTextAttachment, false);
      assert.match(intake.text, /unsupported/);
    }
  });

  it("admits an image-only message with a placeholder", () => {
    const intake = describeIntake(fakeMessage({
      attachments: [{
        id: "image-1",
        url: "https://cdn.example/image.png",
        contentType: "image/png",
      }],
    }));

    assert.match(intake.text, /^\(shared 1 image\(s\)\)/);
    assert.equal(intake.attachments.length, 1);
  });

  it("does not ingest malformed attachment references", () => {
    const intake = describeIntake(fakeMessage({
      attachments: [{
        url: "",
        contentType: "text/plain",
        name: "notes.txt",
      }],
    }));

    assert.deepEqual(intake.attachments, []);
    assert.equal(intake.hasIngestibleTextAttachment, false);
    assert.match(intake.text, /cannot open/);
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

  it("builds a human DM envelope with reply and mention identity", () => {
    const intake = describeIntake(fakeMessage({
      id: "discord-dm-1",
      content: "hello",
      author: { id: "person-1", bot: false },
      channelId: "dm-channel-1",
      mentionIds: ["ashley-bot", "person-2"],
      replyToMessageId: "discord-parent-1",
      createdTimestamp: 123_000,
    }));

    assert.deepEqual(intake.envelope, {
      speakerPrincipalId: "person-1",
      speakerKind: "external_human",
      location: {
        kind: "external_dm",
        principalId: "person-1",
        channelId: "dm-channel-1",
      },
      audienceAtCapture: "unknown",
      sentAtMs: 123_000,
      discordMessageId: "discord-dm-1",
      replyToMessageId: "discord-parent-1",
      mentionIds: ["ashley-bot", "person-2"],
      attachmentRefs: [],
      provenance: { source: "discord", receivedAtMs: intake.envelope?.provenance.receivedAtMs },
    });
    assert.equal(typeof intake.envelope?.provenance.receivedAtMs, "number");
  });

  it("builds a room envelope for a bot speaker and tolerates malformed mentions", () => {
    const roomMessage = fakeMessage({
      id: "discord-room-1",
      content: "room contact",
      author: { id: "room-bot-1", bot: true },
      channelId: "room-channel-1",
      guildId: "guild-1",
    });
    (roomMessage as unknown as { mentions: unknown }).mentions = { users: null };
    const intake = describeIntake(roomMessage);

    assert.equal(intake.envelope?.speakerKind, "external_bot");
    assert.deepEqual(intake.envelope?.location, {
      kind: "room",
      guildId: "guild-1",
      channelId: "room-channel-1",
    });
    assert.deepEqual(intake.envelope?.mentionIds, []);
  });
});
