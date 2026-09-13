export type MediaMarkers = {
  text: string;
  react: string | null;
  gifQuery: string | null;
};

const REACT_RE = /\[\[react:([^\]]+)\]\]/gi;
const GIF_RE = /\[\[gif:([^\]]+)\]\]/gi;

/** Parse and strip trailing media markers from agent output. */
export function parseMediaMarkers(raw: string): MediaMarkers {
  let react: string | null = null;
  let gifQuery: string | null = null;

  const reactMatches = [...raw.matchAll(REACT_RE)];
  if (reactMatches.length > 0) {
    react = (reactMatches[reactMatches.length - 1]?.[1] ?? "").trim() || null;
  }

  const gifMatches = [...raw.matchAll(GIF_RE)];
  if (gifMatches.length > 0) {
    gifQuery = (gifMatches[gifMatches.length - 1]?.[1] ?? "").trim() || null;
  }

  const text = raw
    .replace(REACT_RE, "")
    .replace(GIF_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, react, gifQuery };
}
