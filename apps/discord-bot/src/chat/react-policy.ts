/**
 * Reactions are the loudest cheap signal she has, and cheap is the problem: an
 * emoji echoing the one Doc just used reads as mirroring, not as a person
 * responding. The model is asked to be sparing; this enforces it.
 */
import { reportEmojiWeight } from "../agent-client.js";

const MIN_TURNS_BETWEEN = 2;
const MAX_TURNS_BETWEEN = 3;

/** Variation selectors and skin tones make the same emoji compare unequal. */
function normalize(emoji: string): string {
  return emoji
    .replace(/\uFE0F|\u200D/g, "")
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, "")
    .trim();
}

function guessContext(docText: string, herText: string): string {
  const hay = `${docText}\n${herText}`.toLowerCase();
  if (/\b(lol|lmao|haha|joke|funny)\b/.test(hay)) return "joke";
  if (/\b(shipped|deploy|fixed|done|win)\b/.test(hay)) return "win";
  if (/\b(tired|exhausted|ugh|vent|burnt)\b/.test(hay)) return "vent";
  return "general";
}

export type ReactContext = {
  channelId: string;
  emoji: string | null;
  docText: string;
  herText: string;
  rand?: () => number;
};

export class ReactPolicy {
  private readonly turnsSince = new Map<string, number>();
  private readonly required = new Map<string, number>();
  private readonly lastEmoji = new Map<string, string>();

  /**
   * Call once per delivered turn, with or without a candidate emoji, because
   * every turn moves the budget forward.
   */
  decide(ctx: ReactContext): string | null {
    const turns = (this.turnsSince.get(ctx.channelId) ?? MAX_TURNS_BETWEEN) + 1;
    this.turnsSince.set(ctx.channelId, turns);

    if (!ctx.emoji) return null;
    const emoji = normalize(ctx.emoji);
    if (!emoji) return null;

    if (normalize(ctx.docText).includes(emoji)) return null;
    if (normalize(ctx.herText).includes(emoji)) return null;
    if (this.lastEmoji.get(ctx.channelId) === emoji) return null;

    const required = this.required.get(ctx.channelId) ?? MIN_TURNS_BETWEEN;
    if (turns < required) return null;

    const rand = ctx.rand ?? Math.random;
    this.turnsSince.set(ctx.channelId, 0);
    this.required.set(
      ctx.channelId,
      rand() < 0.5 ? MIN_TURNS_BETWEEN : MAX_TURNS_BETWEEN,
    );
    this.lastEmoji.set(ctx.channelId, emoji);

    const context = guessContext(ctx.docText, ctx.herText);
    void reportEmojiWeight({ emoji: ctx.emoji, context }).catch(() => undefined);
    return ctx.emoji;
  }
}

export const reactPolicy = new ReactPolicy();

/** 0.5 to 1.5s after the first bubble, so it reads as a second thought. */
export function reactDelayMs(rand: () => number = Math.random): number {
  return Math.round(500 + rand() * 1000);
}
