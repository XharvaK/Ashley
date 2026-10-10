import { DISCORD_CONTENT_LIMIT, type DeliveryBubblePlan } from "./types.js";

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

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * UX W2 Rhythm. Her own bubbles when they are exactly the text being sent;
 * single and letter arrive as one message; otherwise blank lines split it.
 */
export function planRhythmBubbles(
  draftText: string,
  rhythm: { shape?: string; bubbles?: readonly string[] } | undefined,
): DeliveryBubblePlan[] {
  const trimmed = draftText.trim();
  if (!trimmed || !rhythm) return planContentBubbles(draftText);
  const own = rhythm.bubbles?.map((bubble) => bubble.trim()).filter(Boolean) ?? [];
  if (own.length > 1 && squash(own.join(" ")) === squash(trimmed) && own.every((bubble) => bubble.length <= DISCORD_CONTENT_LIMIT)) {
    return own.map((text, ordinal) => ({ ordinal, text }));
  }
  if ((rhythm.shape === "single" || rhythm.shape === "letter") && trimmed.length <= DISCORD_CONTENT_LIMIT) {
    return [{ ordinal: 0, text: trimmed }];
  }
  return planContentBubbles(draftText);
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
