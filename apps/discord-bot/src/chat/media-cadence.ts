/**
 * React and GIF are the two loudest addons she can fire, and they used to draw
 * from separate budgets — which is how a turn gets both a reaction and a GIF,
 * or a GIF arrives one turn after a reaction. A shared cadence treats the two
 * as the same entitlement: per channel, at most one media addon per turn and
 * a minimum gap between any two of them.
 */
export type MediaAddon = "react" | "gif" | null;

const MIN_TURNS_BETWEEN = 2;
const MAX_TURNS_BETWEEN = 3;

/** A react and a gif from the same turn — never both. */
function pickOne(gif: boolean, react: boolean): MediaAddon {
  if (gif && react) return "gif";
  if (gif) return "gif";
  if (react) return "react";
  return null;
}

export type MediaCadenceContext = {
  channelId: string;
  wantReact: string | null;
  wantGif: boolean;
  rand?: () => number;
};

export class MediaCadence {
  private readonly turnsSince = new Map<string, number>();
  private readonly required = new Map<string, number>();
  private readonly sentKind = new Map<string, MediaAddon>();

  /** One per delivered turn, with or without any media, to move the budget. */
  decide(ctx: MediaCadenceContext): {
    react: string | null;
    gif: boolean;
    current: MediaAddon;
  } {
    const turns =
      (this.turnsSince.get(ctx.channelId) ?? MAX_TURNS_BETWEEN) + 1;
    this.turnsSince.set(ctx.channelId, turns);

    const candidate = pickOne(ctx.wantGif, Boolean(ctx.wantReact));
    const blocked = turns < (this.required.get(ctx.channelId) ?? MIN_TURNS_BETWEEN);

    if (!candidate || blocked) {
      return {
        react: null,
        gif: false,
        current: this.sentKind.get(ctx.channelId) ?? null,
      };
    }

    const rand = ctx.rand ?? Math.random;
    this.turnsSince.set(ctx.channelId, 0);
    this.required.set(
      ctx.channelId,
      rand() < 0.5 ? MIN_TURNS_BETWEEN : MAX_TURNS_BETWEEN,
    );
    this.sentKind.set(ctx.channelId, candidate);

    return {
      react:
        candidate === "react" && ctx.wantReact ? ctx.wantReact : null,
      gif: candidate === "gif" && ctx.wantGif,
      current: candidate,
    };
  }
}

export const mediaCadence = new MediaCadence();