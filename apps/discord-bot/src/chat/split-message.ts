const DISCORD_LIMIT = 1990;

function hardSlice(text: string, limit: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    out.push(text.slice(start, start + limit));
    start += limit;
  }
  return out;
}

/**
 * Split Discord replies on blank lines. Never drops overflow — long tails are
 * hard-sliced to Discord's content limit instead of truncated to a bubble cap.
 */
export function splitMessage(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const raw: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= DISCORD_LIMIT) {
      raw.push(para);
      continue;
    }
    raw.push(...hardSlice(para, DISCORD_LIMIT));
  }
  return raw;
}
