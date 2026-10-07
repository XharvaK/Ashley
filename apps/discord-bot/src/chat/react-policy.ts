/**
 * Reactions are the loudest cheap signal she has, and cheap is the problem: an
 * emoji echoing the one Alex just used reads as mirroring, not as a person
 * responding. The model is asked to be sparing; this enforces the no-mirror rule.
 */

/** Variation selectors and skin tones make the same emoji compare unequal. */
function normalize(emoji: string): string {
  return emoji
    .replace(/\uFE0F|\u200D/g, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
    .trim();
}

export type ReactContext = {
  channelId: string;
  emoji: string | null;
  docText: string;
  herText: string;
  rand?: () => number;
};

export class ReactPolicy {
  /**
   * One candidate emoji. Turn counting is retired: rarity is hers, not a budget.
   * Returns null when the emoji mirrors his text or hers.
   */
  decide(ctx: ReactContext): string | null {
    if (!ctx.emoji) return null;
    const emoji = normalize(ctx.emoji);
    if (!emoji) return null;
    if (normalize(ctx.docText).includes(emoji)) return null;
    if (normalize(ctx.herText).includes(emoji)) return null;
    return ctx.emoji;
  }
}

export const reactPolicy = new ReactPolicy();

/** 0.5 to 1.5s after the first bubble, so it reads as a second thought. */
export function reactDelayMs(rand: () => number = Math.random): number {
  return Math.round(500 + rand() * 1000);
}
