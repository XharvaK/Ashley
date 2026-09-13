import { DISCORD_CONTENT_LIMIT, type DeliveryBubblePlan } from "./types.js";

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
 * Plan Discord content bubbles from marker-free draft text.
 * Respects Discord per-message limit. Never drops overflow.
 */
export function planContentBubbles(draftText: string): DeliveryBubblePlan[] {
  const trimmed = draftText.trim();
  if (!trimmed) return [];

  const paragraphs = trimmed
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const raw: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= DISCORD_CONTENT_LIMIT) {
      raw.push(para);
      continue;
    }
    raw.push(...hardSlice(para, DISCORD_CONTENT_LIMIT));
  }

  return raw.map((text, index) => ({ ordinal: index, text }));
}
