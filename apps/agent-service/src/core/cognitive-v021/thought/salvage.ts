import type { ThoughtSemanticParseResult } from "./parse.js";

const MAX_REMOVALS = 6;

/** Optional settlement domains. Required keys (kind, speech, durableNominations) are absent. */
const DROPPABLE_KEYS = new Set([
  "journal",
  "reflection",
  "webPlaces",
  "growth",
  "interests",
  "learned",
  "pursuits",
  "nextOwnTime",
  "attention",
  "senses",
  "home",
  "intents",
  "domusAct",
  "domusSnapshot",
  "domusPromise",
  "domusPromiseSettled",
  "touch",
  "correct",
  "callback",
  "pin",
  "card",
  "face",
  "quiet",
]);

/** UX W2: rendering hints on speech; dropping one changes how it arrives, never what it says. */
const SPEECH_RHYTHM_FIELDS = new Set(["speech.shape", "speech.bubbles", "speech.afterthought", "speech.replyTo"]);

/**
 * Optional keys whose settlement requests an effect. Dropping one while
 * keeping speech would leave words about an act nobody takes.
 * Effect-bearing: domusAct, domusSnapshot, domusPromise, domusPromiseSettled, intents, home, pursuits, nextOwnTime, webPlaces, senses, and the soft acts.
 */
const EFFECT_BEARING_KEYS = new Set([
  "domusAct",
  "domusSnapshot",
  "domusPromise",
  "domusPromiseSettled",
  "intents",
  "home",
  "pursuits",
  "nextOwnTime",
  "webPlaces",
  "senses",
  "touch",
  "correct",
  "callback",
  "pin",
  "card",
  "face",
  "quiet",
]);

const CLOSED_CODES = new Set([
  "invalid_json",
  "root_not_object",
  "wrong_kind",
  "required_field_missing",
  "reference_not_allowlisted",
  "commitment_binding_invalid",
  "alias_invalid",
  "alias_collides_with_existing_ref",
  "operation_not_registered",
]);

const PROTECTED_KEYS = new Set([
  "kind",
  "speech",
  "interactionIntent",
  "initiativePreference",
  "interpretation",
  "commitments",
  "durableNominations",
  "placeRules",
  "contactStop",
  "forget",
  "night",
  "evidenceUse",
]);

type ParseFailure = Extract<ThoughtSemanticParseResult, { ok: false }>;

export type SalvageResult =
  | { ok: true; text: string; dropped: string[] }
  | { ok: false };

function hasDraftSpeech(record: Record<string, unknown>): boolean {
  const speech = record.speech;
  if (typeof speech !== "object" || speech === null || Array.isArray(speech)) return false;
  return (speech as Record<string, unknown>).mode === "draft";
}

function settlementObject(text: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== "settlement") return null;
  return record;
}

function removalFor(failure: ParseFailure): {
  dropped: string;
  apply: (record: Record<string, unknown>) => boolean;
} | null {
  if (failure.epistemicRepairs && failure.epistemicRepairs.length > 0) return null;
  if (CLOSED_CODES.has(failure.code)) return null;
  const field = failure.field;
  if (!field) return null;

  const nomination = /^durableNominations\[(\d+)\](?:\.|$)/.exec(field);
  if (nomination) {
    const index = Number(nomination[1]);
    return {
      dropped: `durableNominations[${index}]`,
      apply(record) {
        const list = record.durableNominations;
        if (!Array.isArray(list) || index < 0 || index >= list.length) return false;
        list.splice(index, 1);
        return true;
      },
    };
  }
  if (field === "durableNominations" || field.startsWith("durableNominations.")) return null;
  if (SPEECH_RHYTHM_FIELDS.has(field)) {
    const key = field.slice("speech.".length);
    return {
      dropped: field,
      apply(record) {
        const speech = record.speech;
        if (typeof speech !== "object" || speech === null || Array.isArray(speech)) return false;
        if (!Object.prototype.hasOwnProperty.call(speech, key)) return false;
        delete (speech as Record<string, unknown>)[key];
        return true;
      },
    };
  }

  if (failure.code === "unknown_field") {
    if (field.includes(".") || field.includes("[") || field.endsWith("Deltas")) return null;
    if (PROTECTED_KEYS.has(field)) return null;
    return {
      dropped: field,
      apply(record) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) return false;
        delete record[field];
        return true;
      },
    };
  }

  const top = field.split(/[.\[]/)[0] ?? "";
  if (!DROPPABLE_KEYS.has(top)) return null;
  if (field !== top && !field.startsWith(`${top}.`) && !field.startsWith(`${top}[`)) return null;
  return {
    dropped: top,
    apply(record) {
      if (!Object.prototype.hasOwnProperty.call(record, top)) return false;
      delete record[top];
      return true;
    },
  };
}

function nominationIndexOf(dropped: string): number {
  const match = /^durableNominations\[(\d+)\]$/.exec(dropped);
  return match ? Number(match[1]) : -1;
}

/**
 * Corrective-retry scope: the paths a retry changed outside its allowed repair path. Accepted only when every
 * one is an optional part (the same classification salvage uses); those parts are dropped and the candidate
 * re-parsed. Any other changed path refuses. Removals only: nothing is filled in or rewritten.
 */
export function dropOptionalPartsAt(
  text: string,
  paths: readonly string[],
  reparse: (text: string) => ThoughtSemanticParseResult,
): SalvageResult {
  const record = settlementObject(text);
  if (!record || paths.length === 0) return { ok: false };
  const seen = new Set<string>();
  const removals: Array<NonNullable<ReturnType<typeof removalFor>>> = [];
  for (const path of paths) {
    const removal = removalFor({ ok: false, code: "wrong_type", field: path });
    if (!removal) return { ok: false };
    if (seen.has(removal.dropped)) continue;
    seen.add(removal.dropped);
    removals.push(removal);
  }
  // Nomination entries from the last index first, so an earlier index is still where the model put it.
  removals.sort((left, right) => nominationIndexOf(right.dropped) - nominationIndexOf(left.dropped));
  const dropped: string[] = [];
  for (const removal of removals) {
    // An absent part was already removed by the model itself: nothing to drop.
    removal.apply(record);
    if (EFFECT_BEARING_KEYS.has(removal.dropped) && hasDraftSpeech(record)) return { ok: false };
    dropped.push(removal.dropped);
  }
  const currentText = JSON.stringify(record);
  return reparse(currentText).ok ? { ok: true, text: currentText, dropped } : { ok: false };
}

/**
 * Remove the faulty optional part of a settlement and re-parse.
 * Removals only: no invented, rewritten, or filled values.
 */
export function salvageSettlement(
  text: string,
  firstFailure: ParseFailure,
  reparse: (text: string) => ThoughtSemanticParseResult,
): SalvageResult {
  if (!settlementObject(text)) return { ok: false };
  let currentText = text;
  let currentFailure: ThoughtSemanticParseResult = firstFailure;
  const dropped: string[] = [];
  for (let removed = 0; removed < MAX_REMOVALS; removed += 1) {
    if (currentFailure.ok) return { ok: true, text: currentText, dropped };
    const removal = removalFor(currentFailure);
    if (!removal) return { ok: false };
    const record = settlementObject(currentText);
    if (!record || !removal.apply(record)) return { ok: false };
    if (EFFECT_BEARING_KEYS.has(removal.dropped) && hasDraftSpeech(record)) return { ok: false };
    dropped.push(removal.dropped);
    currentText = JSON.stringify(record);
    currentFailure = reparse(currentText);
  }
  return currentFailure.ok ? { ok: true, text: currentText, dropped } : { ok: false };
}
