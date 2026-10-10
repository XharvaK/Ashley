const DISCORD_LIMIT = 1990;

function hardSlice(text: string, limit: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    // Never end a bubble on a high surrogate: its low half would open the next bubble as a lone unit.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && end - 1 > start && last >= 0xd800 && last <= 0xdbff) end -= 1;
    out.push(text.slice(start, end));
    start = end;
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

/** A reply in a room with other people: at most this many bubbles go out in one turn. */
export const ROOM_BUBBLE_CAP = 3;

/** Room replies are capped so one turn cannot flood a shared channel. The full text stays in her record. */
export function capRoomBubbles<T>(bubbles: readonly T[], cap: number = ROOM_BUBBLE_CAP): T[] {
  return bubbles.slice(0, cap);
}
