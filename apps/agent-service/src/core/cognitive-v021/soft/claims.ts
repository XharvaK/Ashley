import type { SoftKind } from "./acts.js";

/** Structural checks for the soft-act settlement fields; the same bounds as the wire schema. */

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Rec : null;
}

function text(value: unknown, min: number, max: number): boolean {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

function only(value: Rec, keys: readonly string[], required: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && required.every((key) => key in value);
}

export function isSoftClaim(kind: SoftKind, value: unknown): boolean {
  const claim = rec(value);
  if (!claim) return false;
  switch (kind) {
    case "touch":
      return only(claim, ["emoji", "rowId", "meaning"], ["emoji", "rowId", "meaning"])
        && text(claim.emoji, 1, 16) && text(claim.rowId, 1, 200)
        && (claim.meaning === "landed" || claim.meaning === "this_bit" || claim.meaning === "did_it");
    case "correct":
      return only(claim, ["rowId", "bubble", "text"], ["rowId", "text"])
        && text(claim.rowId, 1, 200) && text(claim.text, 1, 1500)
        && (claim.bubble === undefined || (Number.isInteger(claim.bubble) && Number(claim.bubble) >= 0 && Number(claim.bubble) <= 9));
    case "callback":
      return (only(claim, ["memoryRef"], ["memoryRef"]) && text(claim.memoryRef, 1, 200))
        || (only(claim, ["gifQuery"], ["gifQuery"]) && text(claim.gifQuery, 1, 80));
    case "pin":
      return only(claim, ["rowId", "memoryRef"], ["rowId"]) && text(claim.rowId, 1, 200)
        && (claim.memoryRef === undefined || text(claim.memoryRef, 1, 200));
    case "card":
      return only(claim, ["kind", "title", "body", "link"], ["kind", "title", "body"])
        && (claim.kind === "reading_note" || claim.kind === "question" || claim.kind === "letter")
        && text(claim.title, 1, 120) && text(claim.body, 1, 1800)
        && (claim.link === undefined || text(claim.link, 9, 500));
    case "face":
      return only(claim, ["wardrobeId"], ["wardrobeId"]) && text(claim.wardrobeId, 1, 64);
    case "quiet":
      return only(claim, ["forMs", "whose"], ["forMs", "whose"])
        && Number.isInteger(claim.forMs) && Number(claim.forMs) >= 60_000 && Number(claim.forMs) <= 43_200_000
        && (claim.whose === "owner_asked" || claim.whose === "her_own");
  }
}

/** speech.shape / bubbles / afterthought / replyTo on a draft. */
export function speechRhythmFault(speech: Rec): string | null {
  if ("shape" in speech && !["single", "burst", "aside", "letter"].includes(String(speech.shape))) return "speech.shape";
  if ("bubbles" in speech) {
    const bubbles = speech.bubbles;
    if (!Array.isArray(bubbles) || bubbles.length < 2 || bubbles.length > 5
      || !bubbles.every((bubble) => typeof bubble === "string" && bubble.trim().length > 0)) return "speech.bubbles";
  }
  if ("afterthought" in speech && speech.afterthought !== true) return "speech.afterthought";
  if ("replyTo" in speech && (typeof speech.replyTo !== "string" || speech.replyTo.length === 0 || speech.replyTo.length > 128)) return "speech.replyTo";
  return null;
}
