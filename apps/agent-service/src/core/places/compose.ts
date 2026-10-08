// B3: words are written where they go (User 2026-10-06: "she shouldn't tell a channel or someone else
// about an own time about me, or vice versa"). An Owner-private turn sees everything she keeps, so what
// it wants to say elsewhere is only a wish with her draft. The post itself is written by her Thought held
// in that place: the same audience walls as a turn in that room or with that contact (only that place's
// lines, memories and context scoped to it, her room-safe self), plus her draft and her rules for it.
// She may write it, or let it go. The Host never edits her words.
import type { DatabaseSync } from "node:sqlite";
import { buildThoughtInput } from "../cognitive-v021/thought/input.js";
import { runThoughtModel } from "../cognitive-v021/thought/run.js";
import { ARCHITECTURE_EPOCH, type CycleRecord, type KernelDeps, type ThoughtInput } from "../cognitive-v021/types.js";
import type { SocialAudience } from "../cognitive-v021/social/types.js";
import { findPlaceEntry, placeLabel, placePostLimit, postsLast24h, type PlaceEntry } from "./places.js";
import { closedPlaces, contactRestrictions, listPlaceRules } from "./rules.js";
import { PLACE_SAY_MAX_CHARS, PLACE_WISH_POST_ORDINAL } from "./intents.js";

export const PLACE_WISH_ATTEMPTS = 3;
/** A wish not written within this time after it was due is dropped. */
export const PLACE_WISH_TTL_MS = 60 * 60_000;
/** Each written or let-go wish costs one Thought; a mechanical ceiling, not a judgement. */
export const PLACE_WISHES_PER_DAY = 24;
const DAY_MS = 24 * 60 * 60_000;

export type ThoughtPlaceWish = {
  place: string;
  name: string;
  /** Who reads what is said here. */
  audience: string;
  interaction: "initiate" | "continue";
  /** Her draft from her own time, where she could see everything she keeps. */
  draft: string;
  wishedAtMs: number;
  /** Her own standing rules for this place, and those for everywhere. */
  rules?: string[];
};

export type PlaceWish = {
  wishId: string; cycleId: string; ordinal: number; place: string; interaction: "initiate" | "continue";
  draft: string; requestedAtMs: number; attempts: number;
};
export type PlaceComposition = { post: string } | { letGo: string };
export type PlaceComposer = (input: { wish: PlaceWish; entry: PlaceEntry; placeWish: ThoughtPlaceWish; nowMs: number }) => Promise<PlaceComposition>;

type Row = Record<string, unknown>;

function move(sidecar: DatabaseSync, wishId: string, state: string, nowMs: number, extra: { reason?: string; intentId?: string } = {}): void {
  sidecar.prepare(`UPDATE place_wishes SET state = ?, reason = COALESCE(?, reason), intent_id = COALESCE(?, intent_id), updated_at_ms = ?
    WHERE wish_id = ? AND state = 'composing'`).run(state, extra.reason ?? null, extra.intentId ?? null, nowMs, wishId);
}

export function placeAudienceOf(entry: PlaceEntry): SocialAudience {
  return entry.target.kind === "room"
    ? { kind: "room", roomId: entry.ref }
    : { kind: "dm", principalId: entry.target.principalId };
}

export function thoughtPlaceWish(sidecar: DatabaseSync, wish: PlaceWish, entry: PlaceEntry): ThoughtPlaceWish {
  const rules = listPlaceRules(sidecar).filter(rule => rule.place === entry.ref || rule.place === "everywhere").map(rule => rule.rule);
  return {
    place: entry.ref,
    name: placeLabel(sidecar, entry.ref),
    audience: entry.kind === "room" ? "everyone in this channel" : "only this person (and the Owner, who can read all you keep)",
    interaction: wish.interaction,
    draft: wish.draft,
    wishedAtMs: wish.requestedAtMs,
    ...(rules.length ? { rules } : {}),
  };
}

/**
 * Write due wishes, a few at a time. Checks before spending a Thought: the place is still hers, the
 * Owner has not closed it, the person has not asked her to stop, its post limit, and the daily ceiling.
 * syncPlacePosts checks the place again at hand-over.
 */
export async function composeDuePlaceWishes(sidecar: DatabaseSync, nuclear: DatabaseSync, input: {
  nowMs: number; compose: PlaceComposer; limit?: number; held?: boolean;
}): Promise<{ written: number; letGo: number; refused: number; failed: number }> {
  const out = { written: 0, letGo: 0, refused: 0, failed: 0 };
  // Paused or quiet (placesHeld): her wishes wait unwritten, and their clock waits with them.
  if (input.held) {
    sidecar.prepare("UPDATE place_wishes SET due_at_ms = ? WHERE state = 'composing' AND due_at_ms <= ?").run(input.nowMs, input.nowMs);
    return out;
  }
  for (const row of sidecar.prepare("SELECT wish_id FROM place_wishes WHERE state = 'composing' AND due_at_ms <= ?")
    .all(input.nowMs - PLACE_WISH_TTL_MS) as Row[]) {
    move(sidecar, String(row.wish_id), "failed", input.nowMs, { reason: "not_written_in_time" });
    out.failed++;
  }
  const due = (sidecar.prepare(`SELECT wish_id, cycle_id, ordinal, place_ref, interaction, draft, requested_at_ms, attempts FROM place_wishes
    WHERE state = 'composing' AND due_at_ms <= ? ORDER BY due_at_ms, requested_at_ms, ordinal LIMIT ?`).all(input.nowMs, input.limit ?? 2) as Row[])
    .map(row => ({ wishId: String(row.wish_id), cycleId: String(row.cycle_id), ordinal: Number(row.ordinal), place: String(row.place_ref),
      interaction: row.interaction === "initiate" ? "initiate" as const : "continue" as const, draft: String(row.draft),
      requestedAtMs: Number(row.requested_at_ms), attempts: Number(row.attempts) }));
  const closed = closedPlaces(sidecar);
  for (const wish of due) {
    const entry = findPlaceEntry(nuclear, sidecar, wish.place, input.nowMs);
    const asked = entry?.target.kind === "contact" ? contactRestrictions(nuclear, entry.target.principalId) : [];
    const stop = asked.find(kind => kind === "do_not_contact" || kind === "no_dm" || kind === "room_only")
      ?? (wish.interaction === "initiate" && asked.includes("no_initiation") ? "no_initiation" : undefined);
    const spent = Number((sidecar.prepare(`SELECT count(*) AS n FROM place_wishes WHERE state IN ('written','let_go') AND updated_at_ms > ?`)
      .get(input.nowMs - DAY_MS) as Row).n ?? 0);
    const refusal = !entry ? "not_one_of_your_places"
      : closed.has(entry.ref) ? "closed_by_owner"
      : stop ? `they_asked:${stop}`
      : postsLast24h(sidecar, entry.ref, input.nowMs) >= placePostLimit(entry.kind) ? "place_fuse"
      : spent >= PLACE_WISHES_PER_DAY ? "too_many_today"
      : undefined;
    if (refusal || !entry) { move(sidecar, wish.wishId, "refused", input.nowMs, { reason: refusal ?? "not_one_of_your_places" }); out.refused++; continue; }
    sidecar.prepare("UPDATE place_wishes SET attempts = attempts + 1, updated_at_ms = ? WHERE wish_id = ?").run(input.nowMs, wish.wishId);
    let composed: PlaceComposition;
    try {
      composed = await input.compose({ wish, entry, placeWish: thoughtPlaceWish(sidecar, wish, entry), nowMs: input.nowMs });
    } catch (error) {
      if (wish.attempts + 1 >= PLACE_WISH_ATTEMPTS) {
        move(sidecar, wish.wishId, "failed", input.nowMs, { reason: (error instanceof Error ? error.message : "compose_failed").slice(0, 80) });
        out.failed++;
      }
      continue;
    }
    if ("letGo" in composed) {
      move(sidecar, wish.wishId, "let_go", input.nowMs, { reason: composed.letGo.trim().slice(0, 200) || "let it go" });
      out.letGo++;
      continue;
    }
    const post = composed.post.trim().slice(0, PLACE_SAY_MAX_CHARS);
    const intentId = `intent:${wish.wishId.replace(/^wish:/, "")}`;
    sidecar.prepare(`INSERT OR IGNORE INTO place_intents (intent_id, cycle_id, ordinal, place_ref, interaction, say, state, reason,
      due_at_ms, requested_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 'requested', NULL, ?, ?, ?)`)
      .run(intentId, wish.cycleId, PLACE_WISH_POST_ORDINAL + wish.ordinal, entry.ref, wish.interaction, post, input.nowMs, input.nowMs, input.nowMs);
    move(sidecar, wish.wishId, "written", input.nowMs, { intentId });
    out.written++;
  }
  return out;
}

/** The Thought input for writing a wish in its place: that place's audience, nothing wider. */
export function placeWishThoughtInput(sidecar: DatabaseSync, nuclear: DatabaseSync, input: {
  wish: PlaceWish; entry: PlaceEntry; placeWish: ThoughtPlaceWish; nowMs: number;
  constitution: Parameters<typeof buildThoughtInput>[0]["constitution"];
  capabilityReality: Parameters<typeof buildThoughtInput>[0]["capabilityReality"];
  ownerId: string; timeZone?: string;
}): { input: ThoughtInput; audience: SocialAudience } {
  const audience = placeAudienceOf(input.entry);
  const cycle: CycleRecord = {
    cycleId: `place:${input.wish.wishId}` as CycleRecord["cycleId"],
    conversationId: (input.entry.conversationIds[0] ?? input.entry.ref) as CycleRecord["conversationId"],
    generation: 1 as CycleRecord["generation"],
    wakeId: `place:${input.wish.wishId}`,
    triggerKind: "external_message",
    triggerRef: input.wish.wishId,
    state: "thinking" as CycleRecord["state"],
    occupantId: input.ownerId as CycleRecord["occupantId"],
    authorityEpoch: 1 as CycleRecord["authorityEpoch"],
    architectureEpoch: ARCHITECTURE_EPOCH,
    admittedAtMs: input.nowMs,
    composeLogIds: [],
    preemptedGeneration: null,
  };
  const built = buildThoughtInput({
    sidecar, cycle, audience, authorityDb: nuclear,
    constitution: input.constitution,
    capabilityReality: input.capabilityReality,
    placeWish: input.placeWish,
    triggerKindOverride: "external_message",
    observations: [], inFlight: [],
    clock: { nowMs: input.nowMs, ...(input.timeZone ? { timeZone: input.timeZone } : {}) },
  });
  return { input: built, audience };
}

/** The composer that runs her Thought (the ordinary Thought contract, in the place's audience). */
export function thoughtPlaceComposer(sidecar: DatabaseSync, nuclear: DatabaseSync, deps: KernelDeps, options: { timeZone?: string } = {}): PlaceComposer {
  return async ({ wish, entry, placeWish, nowMs }) => {
    const ownerId = deps.identityOwnerId ?? "owner";
    const draftAudience = placeAudienceOf(entry);
    const capabilityReality = deps.refreshCapabilityReality?.({ audience: draftAudience, licenses: [], nowMs }) ?? deps.capabilityReality;
    const { input, audience } = placeWishThoughtInput(sidecar, nuclear, {
      wish, entry, placeWish, nowMs, ownerId, ...(options.timeZone ? { timeZone: options.timeZone } : {}),
      constitution: deps.readConstitution?.() ?? deps.constitution,
      capabilityReality,
    });
    const result = await runThoughtModel(input, deps, { deadlineAtMs: nowMs + 180_000, audience });
    const semantic = result.semantic;
    if (!semantic) throw new Error(result.unavailable ? "thought_unavailable" : result.malformed ? "thought_malformed" : "thought_no_output");
    if (semantic.kind !== "settlement") throw new Error(`thought_${semantic.kind}`);
    if (semantic.speech.mode !== "draft" || !semantic.speech.surfaceDraft.trim()) return { letGo: "chose not to say it here" };
    return { post: semantic.speech.surfaceDraft };
  };
}
