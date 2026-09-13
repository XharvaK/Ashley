/**
 * A deliberately small Atom-first reader with RSS compatibility. Feeds are
 * hostile input: truncated XML, HTML inside CDATA, missing dates. Nothing here
 * throws on a bad entry, it just returns fewer items.
 */
export type FeedItem = {
  title: string;
  url: string;
  excerpt: string;
  publishedAt: string | null;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#8217": "'",
  "#8216": "'",
  "#8220": '"',
  "#8221": '"',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (whole, name: string) => {
    const direct = ENTITIES[name.toLowerCase()];
    if (direct) return direct;
    if (/^#\d+$/.test(name)) {
      return String.fromCodePoint(Number(name.slice(1)));
    }
    if (/^#x[0-9a-f]+$/i.test(name)) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    return whole;
  });
}

function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function htmlToText(html: string): string {
  // Twice on purpose: feeds routinely ship escaped markup, so one decode leaves
  // real tags behind in the text.
  return stripTags(decodeEntities(stripTags(html)))
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unwrap(raw: string): string {
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return htmlToText(cdata ? cdata[1]! : raw);
}

function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    const match = block.match(
      new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"),
    );
    if (match) {
      const value = unwrap(match[1]!);
      if (value) return value;
    }
  }
  return null;
}

function link(block: string): string | null {
  const plain = tag(block, ["link"]);
  if (plain?.startsWith("http")) return plain;

  // Atom puts the URL in an attribute, and often lists several rel values.
  const alternate = block.match(
    /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i,
  );
  if (alternate) return decodeEntities(alternate[1]!);
  const anyHref = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (anyHref) return decodeEntities(anyHref[1]!);
  const guid = tag(block, ["guid", "id"]);
  return guid?.startsWith("http") ? guid : null;
}

function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function parseFeed(xml: string, limit = 40): FeedItem[] {
  const blocks = [
    ...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi),
  ].map((m) => m[2]!);

  const items: FeedItem[] = [];
  for (const block of blocks) {
    const url = link(block);
    const title = tag(block, ["title"]);
    if (!url || !title) continue;
    items.push({
      title,
      url,
      excerpt: (
        tag(block, ["description", "summary", "content:encoded", "content"]) ??
        ""
      ).slice(0, 1200),
      publishedAt: toIso(
        tag(block, ["pubDate", "published", "updated", "dc:date"]),
      ),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** Discards query noise so the same article from two feeds is one item. */
export function urlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_|^ref$|^source$/i.test(key)) parsed.searchParams.delete(key);
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.host.replace(/^www\./, "")}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}
