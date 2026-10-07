import type { Message } from "discord.js";
import type { AttachmentRef } from "./attachments.js";

/**
 * UX_PACK v4 Wave 2, Perception: she reads what is sent to her. A custom emoji
 * becomes its name, a sticker carries its description and tags, and a Tenor or
 * Giphy link carries what the provider says the GIF shows, plus one still frame
 * for her eyes. Every line is the provider's own words, never a guess, and a
 * lookup that fails says so.
 */

const CUSTOM_EMOJI = /<a?:([A-Za-z0-9_~]{1,32}):\d{15,25}>/g;
const MAX_GIFS = 2;
const PAGE_MAX_BYTES = 1_500_000;
const FETCH_TIMEOUT_MS = 3_500;
const READ_TIMEOUT_MS = 4_500;
const DESCRIPTION_MAX = 300;
const MAX_TAGS = 8;
const READ_HOSTS = new Set(["tenor.com", "www.tenor.com", "giphy.com", "www.giphy.com"]);
const STICKER_FRAME_FORMATS = new Map<number, string>([[1, "image/png"], [2, "image/png"], [4, "image/gif"]]);

export type GifLink = {
  provider: "Tenor" | "Giphy";
  url: string;
  /** The page whose metadata describes it. */
  page: string;
  /** Words in the link itself, the fallback when the page cannot be read. */
  slugWords: string;
  /** A Giphy still frame is known from the id alone. */
  frameUrl?: string;
};

export type GifReading = {
  provider: string;
  title?: string;
  description?: string;
  tags: string[];
  frameUrl?: string;
  slugWords: string;
  read: boolean;
};

export type StickerReading = { name: string; description?: string; tags: string[]; frame?: AttachmentRef };

export type MediaReading = {
  gifs: GifReading[];
  /** Keyed by sticker id. */
  stickers: Map<string, StickerReading>;
};

export type FetchText = (url: string) => Promise<{ finalUrl: string; text: string } | null>;

/** `<:name:id>` and `<a:name:id>` read as `:name:`. */
export function readableEmoji(text: string): string {
  return text.replace(CUSTOM_EMOJI, (_whole, name: string) => `:${name}:`);
}

function clean(value: unknown, max = DESCRIPTION_MAX): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function words(slug: string): string {
  return slug
    .replace(/-?gif-?\d*$/i, "")
    .replace(/-\d{6,}$/, "")
    .split(/[-_]+/)
    .filter((word) => word && !/^\d+$/.test(word))
    .join(" ")
    .slice(0, 120);
}

/** Tenor and Giphy links in the text, at most two. */
export function gifLinks(text: string): GifLink[] {
  const links: GifLink[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https:\/\/[^\s<>()"']+/gi)) {
    if (links.length >= MAX_GIFS) break;
    let url: URL;
    try {
      url = new URL(match[0]);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    let link: GifLink | null = null;
    if (host === "tenor.com" || host === "www.tenor.com") {
      const at = parts.indexOf("view");
      const slug = at >= 0 ? parts[at + 1] : undefined;
      if (slug && /-\d{6,}$/.test(slug)) {
        link = { provider: "Tenor", url: url.href, page: `https://tenor.com/view/${slug}`, slugWords: words(slug) };
      }
    } else if (host === "giphy.com" || host === "www.giphy.com") {
      const slug = parts[0] === "gifs" || parts[0] === "stickers" ? parts[1] : undefined;
      const id = slug?.split("-").at(-1);
      if (slug && id && /^[A-Za-z0-9]{6,40}$/.test(id)) {
        link = {
          provider: "Giphy", url: url.href, page: `https://giphy.com/gifs/${slug}`,
          slugWords: slug === id ? "" : words(slug.slice(0, -id.length)),
          frameUrl: `https://media.giphy.com/media/${id}/giphy_s.gif`,
        };
      }
    } else if (/^(?:media\d*|i)\.giphy\.com$/.test(host)) {
      const id = parts[0] === "media" ? (parts[1] === "v1" ? parts.at(-2) : parts[1]) : parts[0]?.replace(/\.gif$/i, "");
      if (id && /^[A-Za-z0-9]{6,40}$/.test(id)) {
        link = {
          provider: "Giphy", url: url.href, page: `https://giphy.com/gifs/${id}`, slugWords: "",
          frameUrl: `https://media.giphy.com/media/${id}/giphy_s.gif`,
        };
      }
    }
    if (link && !seen.has(link.page)) {
      seen.add(link.page);
      links.push(link);
    }
  }
  return links;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function meta(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const named = new RegExp(`(?:name|property)\\s*=\\s*"${key.replace(/[.:]/g, "\\$&")}"`, "i");
    if (!named.test(tag)) continue;
    const content = /content\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
    if (content !== undefined) return decodeEntities(content);
  }
  return undefined;
}

function tagList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const tags: string[] = [];
  for (const value of values) {
    const tag = clean(value, 40);
    if (!tag || /^(?:gif|gifs|animated gif|meme)$/i.test(tag) || tags.includes(tag.toLowerCase())) continue;
    tags.push(tag.toLowerCase());
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** Tenor's view page carries its own store: the GIF's description, title, tags and a still preview. */
export function readTenorPage(html: string, link: GifLink): GifReading {
  const id = /-(\d{6,})$/.exec(link.page)?.[1];
  const store = /<script[^>]*id="store-cache"[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  let gif: Record<string, unknown> | undefined;
  if (store && id) {
    try {
      const parsed = JSON.parse(store) as { gifs?: { byId?: Record<string, { results?: Array<Record<string, unknown>> }> } };
      gif = parsed.gifs?.byId?.[id]?.results?.find((result) => result.id === id);
    } catch {
      gif = undefined;
    }
  }
  const formats = gif?.media_formats as Record<string, { url?: unknown }> | undefined;
  const preview = typeof formats?.gifpreview?.url === "string" ? formats.gifpreview.url : undefined;
  const keywords = meta(html, "keywords")?.split(",");
  const title = clean(gif?.h1_title, 120) ?? clean(meta(html, "og:title")?.replace(/\s+-\s+.*$/, ""), 120);
  const description = clean(gif?.content_description);
  const tags = tagList(Array.isArray(gif?.tags) ? gif.tags : keywords);
  return {
    provider: "Tenor",
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    tags,
    ...(preview?.startsWith("https://") ? { frameUrl: preview } : {}),
    slugWords: link.slugWords,
    read: Boolean(title || description || tags.length),
  };
}

/** Giphy's page names the GIF in its title and keywords; its still frame is known from the id. */
export function readGiphyPage(html: string, link: GifLink): GifReading {
  const title = clean(meta(html, "og:title")?.replace(/\s+-\s+Find\s*&\s*Share on GIPHY\s*$/i, ""), 120);
  const alt = /\\?"alt_text\\?":\\?"([^"\\]{3,300})/.exec(html)?.[1];
  const tags = tagList(meta(html, "keywords")?.split(","));
  return {
    provider: "Giphy",
    ...(title ? { title } : {}),
    ...(clean(alt) ? { description: clean(alt) } : {}),
    tags,
    ...(link.frameUrl ? { frameUrl: link.frameUrl } : {}),
    slugWords: link.slugWords,
    read: Boolean(title || tags.length),
  };
}

export const fetchPageText: FetchText = async (url) => {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; AshleyReader/1.0)", accept: "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  let host: string;
  try {
    host = new URL(response.url || url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!response.ok || !READ_HOSTS.has(host) || !response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < PAGE_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return { finalUrl: response.url || url, text: Buffer.concat(chunks).subarray(0, PAGE_MAX_BYTES).toString("utf8") };
};

async function readGif(link: GifLink, fetchText: FetchText): Promise<GifReading> {
  const unread: GifReading = {
    provider: link.provider, tags: [], slugWords: link.slugWords, read: false,
    ...(link.frameUrl ? { frameUrl: link.frameUrl } : {}),
  };
  try {
    const page = await fetchText(link.page);
    if (!page) return unread;
    return link.provider === "Tenor" ? readTenorPage(page.text, link) : readGiphyPage(page.text, link);
  } catch {
    return unread;
  }
}

type StickerLike = {
  id?: string;
  name?: string | null;
  description?: string | null;
  tags?: string | string[] | null;
  format?: number;
  url?: string;
  fetch?: () => Promise<StickerLike>;
};

async function readSticker(sticker: StickerLike, messageId: string): Promise<StickerReading | null> {
  let full: StickerLike = sticker;
  if ((full.description == null || full.tags == null) && typeof full.fetch === "function") {
    try {
      full = await full.fetch();
    } catch {
      full = sticker;
    }
  }
  const name = clean(full.name ?? sticker.name, 60);
  if (!name) return null;
  const rawTags = Array.isArray(full.tags) ? full.tags : typeof full.tags === "string" ? full.tags.split(",") : [];
  const description = clean(full.description);
  const mime = full.format === undefined ? undefined : STICKER_FRAME_FORMATS.get(full.format);
  const frame: AttachmentRef | undefined = mime && sticker.id && typeof full.url === "string" && full.url.startsWith("https://")
    ? {
      discordAttachmentId: `sticker-${messageId}-${sticker.id}`.slice(0, 120),
      declaredMime: mime,
      fileName: `sticker-${name}.${mime === "image/gif" ? "gif" : "png"}`.slice(0, 200),
      sourceUrl: full.url,
      sourceClass: "supplied_image",
    }
    : undefined;
  return { name, ...(description ? { description } : {}), tags: tagList(rawTags), ...(frame ? { frame } : {}) };
}

type EmbedLike = {
  type?: string | null;
  url?: string | null;
  title?: string | null;
  description?: string | null;
  provider?: { name?: string | null } | null;
  thumbnail?: { url?: string | null; proxyURL?: string | null } | null;
};

/** A GIF from any other provider Discord unfurled (its picker may change provider): what the embed itself says. */
function embedGifs(embeds: EmbedLike[], known: GifLink[]): GifReading[] {
  const readings: GifReading[] = [];
  for (const embed of embeds) {
    if (readings.length + known.length >= MAX_GIFS) break;
    if (embed.type !== "gifv" || !embed.url || gifLinks(embed.url).length > 0) continue;
    let host = "";
    let last = "";
    try {
      const url = new URL(embed.url);
      host = url.hostname.replace(/^www\./, "");
      last = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    } catch {
      continue;
    }
    const title = clean(embed.title, 120);
    const description = clean(embed.description);
    const frame = embed.thumbnail?.proxyURL ?? embed.thumbnail?.url ?? undefined;
    readings.push({
      provider: clean(embed.provider?.name, 40) ?? host,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      tags: [],
      ...(frame?.startsWith("https://") ? { frameUrl: frame } : {}),
      slugWords: words(last.replace(/\.[a-z0-9]{2,5}$/i, "")),
      read: Boolean(title || description),
    });
  }
  return readings;
}

/** Everything in one message worth reading, within a few seconds; whatever is late stays unread. */
export async function readMedia(
  message: Message,
  options: { fetchText?: FetchText; timeoutMs?: number } = {},
): Promise<MediaReading> {
  const fetchText = options.fetchText ?? fetchPageText;
  const content = typeof message.content === "string" ? message.content : "";
  const embedUrls = (message.embeds ?? []).map((embed) => embed.url ?? "").join(" ");
  const links = gifLinks(`${content} ${embedUrls}`);
  const others = embedGifs((message.embeds ?? []) as unknown as EmbedLike[], links);
  const stickers = [...(message.stickers?.values() ?? [])] as unknown as StickerLike[];
  const reading: MediaReading = { gifs: [], stickers: new Map() };
  if (links.length === 0 && others.length === 0 && stickers.length === 0) return reading;
  const work = Promise.all([
    Promise.all(links.map((link) => readGif(link, fetchText))),
    Promise.all(stickers.map(async (sticker) => [sticker.id ?? "", await readSticker(sticker, message.id ?? "")] as const)),
  ]);
  const timeout = new Promise<null>((resolve) => {
    const timer = setTimeout(() => resolve(null), options.timeoutMs ?? READ_TIMEOUT_MS);
    timer.unref?.();
  });
  const done = await Promise.race([work, timeout]).catch(() => null);
  if (!done) {
    reading.gifs = [...links.map((link): GifReading => ({
      provider: link.provider, tags: [], slugWords: link.slugWords, read: false,
      ...(link.frameUrl ? { frameUrl: link.frameUrl } : {}),
    })), ...others];
    return reading;
  }
  reading.gifs = [...done[0], ...others];
  for (const [id, sticker] of done[1]) {
    if (id && sticker) reading.stickers.set(id, sticker);
  }
  return reading;
}

/** One line per GIF, in the provider's words. */
export function gifLine(gif: GifReading, sender: string, frameAttached: boolean): string {
  const parts: string[] = [];
  if (gif.read) {
    const named = gif.title ? ` "${gif.title}"` : "";
    parts.push(`${sender} sent a GIF from ${gif.provider}${named}${gif.description ? `: ${gif.description}` : ""}.`);
    if (gif.tags.length) parts.push(`Its tags: ${gif.tags.join(", ")}.`);
  } else {
    parts.push(`${sender} sent a GIF from ${gif.provider}; what it shows could not be read${gif.slugWords ? `, and its link says "${gif.slugWords}"` : ""}.`);
  }
  if (frameAttached) parts.push("One still frame of it is attached as an image.");
  return `(${parts.join(" ")})`;
}

/** The sticker as a phrase for the intake's note list. */
export function stickerPhrase(sticker: StickerReading): string {
  const about = [
    sticker.description,
    sticker.tags.length ? `tags: ${sticker.tags.join(", ")}` : undefined,
  ].filter(Boolean).join("; ");
  return `the "${sticker.name}" sticker${about ? ` (${about})` : ""}`;
}

export function gifFrameRef(gif: GifReading, messageId: string, index: number): AttachmentRef | null {
  if (!gif.frameUrl) return null;
  const mime = /\.png(?:$|\?)/i.test(gif.frameUrl) ? "image/png" : /\.webp(?:$|\?)/i.test(gif.frameUrl) ? "image/webp" : "image/gif";
  return {
    discordAttachmentId: `gif-${messageId}-${index}`.slice(0, 120),
    declaredMime: mime,
    fileName: `gif-frame-${index}.${mime.split("/")[1]}`,
    sourceUrl: gif.frameUrl,
    sourceClass: "supplied_image",
  };
}
