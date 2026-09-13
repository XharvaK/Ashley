export type ExtractedMedia = {
  text: string;
  react: string | null;
  gifQuery: string | null;
};

const REACT_RE = /\[\[react:([^\]]+)\]\]/gi;
const GIF_RE = /\[\[gif:([^\]]+)\]\]/gi;
const REACT_ONLY_RE = /\[\[react-only:([^\]]+)\]\]/gi;

/** Extract media markers before planning content bubbles. */
export function extractMediaMarkers(raw: string): ExtractedMedia {
  let react: string | null = null;
  let gifQuery: string | null = null;

  const reactOnly = [...raw.matchAll(REACT_ONLY_RE)];
  if (reactOnly.length > 0) {
    react = (reactOnly[reactOnly.length - 1]?.[1] ?? "").trim() || null;
  }

  const reactMatches = [...raw.matchAll(REACT_RE)];
  if (reactMatches.length > 0) {
    react = (reactMatches[reactMatches.length - 1]?.[1] ?? "").trim() || null;
  }

  const gifMatches = [...raw.matchAll(GIF_RE)];
  if (gifMatches.length > 0) {
    gifQuery = (gifMatches[gifMatches.length - 1]?.[1] ?? "").trim() || null;
  }

  const text = raw
    .replace(REACT_ONLY_RE, "")
    .replace(REACT_RE, "")
    .replace(GIF_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, react, gifQuery };
}
