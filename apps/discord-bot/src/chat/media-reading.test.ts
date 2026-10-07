import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Message } from "discord.js";
import { describeIntake } from "./attachments.js";
import {
  gifLinks,
  readableEmoji,
  readGiphyPage,
  readMedia,
  readTenorPage,
  type FetchText,
} from "./media-reading.js";
import { createMessageCreateHandler } from "../handlers/messageCreate.js";

const TENOR = "https://tenor.com/view/otter-wave-hello-gif-1234567890";
const GIPHY = "https://giphy.com/gifs/studio-otter-spin-AbCdEf123456";

function tenorPage(id = "1234567890"): string {
  const store = {
    gifs: {
      byId: {
        [id]: {
          results: [{
            id,
            h1_title: "Otter Wave GIF",
            content_description: "a small otter waves a paw at the camera",
            tags: ["otter", "wave", "hello", "gif"],
            media_formats: { gifpreview: { url: "https://media.tenor.com/abc/otter-wave.png" } },
          }],
        },
      },
    },
  };
  return `<html><head><meta name="keywords" content="ignored,words"></head><body>`
    + `<script id="store-cache" type="text/x-cache">${JSON.stringify(store)}</script></body></html>`;
}

const GIPHY_PAGE = `<html><head>
<meta property="og:title" content="Otter Spin GIF by Studio - Find &amp; Share on GIPHY"/>
<meta name="keywords" content="otter,spin,dizzy,GIF,Animated GIF"/>
</head></html>`;

function fakeMessage(params: {
  id?: string;
  content?: string;
  stickers?: Array<Record<string, unknown>>;
  authorId?: string;
  channelId?: string;
}): Message {
  return {
    id: params.id ?? "m1",
    content: params.content ?? "",
    attachments: new Map(),
    stickers: new Map((params.stickers ?? []).map((sticker) => [String(sticker.id), sticker])),
    embeds: [],
    ...(params.authorId ? { author: { id: params.authorId } } : {}),
    channel: { id: params.channelId ?? "c1" },
  } as unknown as Message;
}

const pages: Record<string, string> = {
  "https://tenor.com/view/otter-wave-hello-gif-1234567890": tenorPage(),
  "https://giphy.com/gifs/studio-otter-spin-AbCdEf123456": GIPHY_PAGE,
};
const fetchText: FetchText = async (url) => (pages[url] ? { finalUrl: url, text: pages[url]! } : null);

describe("media reading", () => {
  it("reads a custom emoji as its name", () => {
    assert.equal(readableEmoji("ok <:otter_nod:123456789012345678> and <a:spin:123456789012345679>"), "ok :otter_nod: and :spin:");
    assert.equal(readableEmoji("plain 🙂 stays"), "plain 🙂 stays");
  });

  it("finds Tenor and Giphy links, at most two, once each", () => {
    const links = gifLinks(`${TENOR} ${TENOR} https://example.com/x.gif ${GIPHY} https://media.giphy.com/media/ZzYy998877/giphy.gif`);
    assert.deepEqual(links.map((link) => link.provider), ["Tenor", "Giphy"]);
    assert.equal(links[0]!.slugWords, "otter wave hello");
    assert.equal(links[1]!.frameUrl, "https://media.giphy.com/media/AbCdEf123456/giphy_s.gif");
    assert.equal(gifLinks("https://media.giphy.com/media/ZzYy998877/giphy.gif")[0]!.page, "https://giphy.com/gifs/ZzYy998877");
    assert.deepEqual(gifLinks("https://tenor.com/search/otters"), []);
  });

  it("takes the GIF's own description, title, tags and still frame from the Tenor page", () => {
    const gif = readTenorPage(tenorPage(), gifLinks(TENOR)[0]!);
    assert.equal(gif.title, "Otter Wave GIF");
    assert.equal(gif.description, "a small otter waves a paw at the camera");
    assert.deepEqual(gif.tags, ["otter", "wave", "hello"]);
    assert.equal(gif.frameUrl, "https://media.tenor.com/abc/otter-wave.png");
    assert.equal(gif.read, true);
  });

  it("takes the Giphy title and keywords", () => {
    const gif = readGiphyPage(GIPHY_PAGE, gifLinks(GIPHY)[0]!);
    assert.equal(gif.title, "Otter Spin GIF by Studio");
    assert.deepEqual(gif.tags, ["otter", "spin", "dizzy"]);
    assert.equal(gif.read, true);
  });

  it("puts the reading in her intake and the frame among her images, not in the sender's envelope", async () => {
    const message = fakeMessage({ id: "900000000000000001", content: `look ${TENOR}`, authorId: "u1" });
    const intake = describeIntake(message, await readMedia(message, { fetchText }));
    assert.match(intake.text, /^look https:\/\/tenor\.com/);
    assert.match(intake.text, /sent a GIF from Tenor "Otter Wave GIF": a small otter waves a paw at the camera\. Its tags: otter, wave, hello\. One still frame of it is attached as an image\./);
    assert.deepEqual(intake.attachments.map((ref) => [ref.discordAttachmentId, ref.declaredMime, ref.sourceUrl]), [
      ["gif-900000000000000001-1", "image/png", "https://media.tenor.com/abc/otter-wave.png"],
    ]);
    assert.equal(intake.hasMedia, true);
    assert.deepEqual(intake.envelope?.attachmentRefs, []);
  });

  it("says plainly when a page cannot be read", async () => {
    const message = fakeMessage({ content: "https://tenor.com/view/cat-spin-gif-555555555" });
    const intake = describeIntake(message, await readMedia(message, { fetchText }));
    assert.match(intake.text, /sent a GIF from Tenor; what it shows could not be read, and its link says "cat spin"\.\)$/);
    assert.equal(intake.attachments.length, 0);
  });

  it("a GIF Discord unfurled from another provider reads from its embed", async () => {
    const message = {
      ...fakeMessage({ id: "m5", content: "https://gifs.example.net/v/otter-nap-77" }),
      embeds: [{
        type: "gifv",
        url: "https://gifs.example.net/v/otter-nap-77",
        title: "Otter Nap",
        provider: { name: "ExampleGifs" },
        thumbnail: { url: "https://gifs.example.net/t/77.png", proxyURL: "https://media.discordapp.net/external/77.png" },
      }],
    } as unknown as Message;
    const intake = describeIntake(message, await readMedia(message, { fetchText }));
    assert.match(intake.text, /sent a GIF from ExampleGifs "Otter Nap"\. One still frame of it is attached as an image\.\)$/);
    assert.deepEqual(intake.attachments.map((ref) => ref.sourceUrl), ["https://media.discordapp.net/external/77.png"]);
  });

  it("a slow lookup leaves the GIF unread instead of holding the message", async () => {
    const message = fakeMessage({ content: TENOR });
    const reading = await readMedia(message, { fetchText: () => new Promise(() => undefined), timeoutMs: 20 });
    assert.equal(reading.gifs[0]!.read, false);
  });

  it("a sticker carries its description and tags, and a still sticker its frame", async () => {
    const sticker = {
      id: "42",
      name: "Otter Hug",
      description: null,
      tags: null,
      fetch: async () => ({ id: "42", name: "Otter Hug", description: "an otter hugs a pillow", tags: "hug, otter", format: 1, url: "https://media.discordapp.net/stickers/42.png" }),
    };
    const lottie = { id: "43", name: "Wave", description: "a wave", tags: "wave", format: 3, url: "https://media.discordapp.net/stickers/43.json" };
    const message = fakeMessage({ id: "m9", stickers: [sticker, lottie] });
    const intake = describeIntake(message, await readMedia(message, { fetchText }));
    assert.equal(intake.text, '(Alex sent the "Otter Hug" sticker (an otter hugs a pillow; tags: hug, otter), the "Wave" sticker (a wave; tags: wave).)');
    assert.deepEqual(intake.attachments.map((ref) => ref.sourceUrl), ["https://media.discordapp.net/stickers/42.png"]);
    assert.equal(describeIntake(fakeMessage({ stickers: [{ id: "1", name: "Plain" }] })).text, '(Alex sent the "Plain" sticker.)');
  });

  it("messages in one channel reach the buffer in the order sent, however long a lookup takes", async () => {
    const admitted: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const handler = createMessageCreateHandler({
      quietMs: 1,
      hardCapMs: 10,
      ingressChat: async (text) => { admitted.push(text); },
      readMedia: async (message) => {
        if (message.id === "a") await slow;
        return { gifs: [], stickers: new Map() };
      },
    });
    const first = handler.handleMessage(fakeMessage({ id: "a", content: "first" }));
    const second = handler.handleMessage(fakeMessage({ id: "b", content: "second" }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(admitted, []);
    release();
    await Promise.all([first, second]);
    await handler.flushForTest("c1");
    assert.deepEqual(admitted, ["first\nsecond"]);
  });
});
