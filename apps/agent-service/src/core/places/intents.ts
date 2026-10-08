// B1: her acts in her other places. In an Owner-private turn she may decide to say something in a
// room or to a contact (`intents`). The Host keeps it as a requested post; the bot pulls posts that
// are due, the Host checks the place is still hers to speak in and that the place's fuse holds, the
// bot sends it and reports what happened, and her next turns read the receipt. Nothing is written
// for her and nothing is guessed: a place she names that is not hers is refused with its reason.
//
// B3 (User 2026-10-06: "she shouldn't tell a channel or someone else about an own time about me, or
// vice versa"): an Owner-private turn sees everything she keeps. Only a post the Owner asked for in
// the turn the Owner started (ownerAsked) is sent as written there. Any other intent is a wish: her
// words become a draft, and the post is written again in a Thought held in that place, which sees
// only what that place may see (places/compose.ts).
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { appendAshleyEvidence } from "../cognitive-v021/evidence/conversation-log.js";
import { findPlaceEntry, placePostLimit, postsLast24h, type PlaceEntry } from "./places.js";
import { closedPlaces, contactRestrictions } from "./rules.js";
import { readOpenQuietWindow } from "../cognitive-v021/quiet/window.js";

export const PLACE_INTENTS_MAX = 3;
export const PLACE_SAY_MAX_CHARS = 2000;
/** A post not picked up and sent within this time after it is due expires; the place never sees it. */
export const PLACE_INTENT_TTL_MS = 10 * 60_000;
/** Her later time for a post (B2): at most this far ahead. */
export const PLACE_INTENT_MAX_DELAY_MS = 14 * 24 * 60 * 60_000;
/** A send the bot took but never reported on becomes failed after this. */
export const PLACE_SENDING_LEASE_MS = 2 * 60_000;
export const PLACE_RECENT_ACTS = 6;
export const PLACE_RECENT_ACTS_MS = 48 * 60 * 60_000;

export type PlaceIntentClaim = { place: string; interaction: "initiate" | "continue"; say: string; atMs?: number; ownerAsked?: true };
export type PlaceIntentState = "requested" | "sending" | "posted" | "refused" | "failed" | "expired" | "composing" | "let_go";
export type PlaceAct = { place: string; say: string; state: PlaceIntentState; requestedAtMs: number; updatedAtMs: number; dueAtMs?: number; reason?: string };
export type PlacePost = { intent_id: string; target: PlaceEntry["target"]; text: string };
export type PlaceSyncReport = { intentId: string; outcome: "posted" | "failed"; discordMessageId?: string; reason?: string };

type Row = Record<string, unknown>;

export function isPlaceIntentClaims(value: unknown): value is PlaceIntentClaim[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PLACE_INTENTS_MAX) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some(key => !["place", "interaction", "say", "atMs", "ownerAsked"].includes(key))) return false;
    if (record.ownerAsked !== undefined && record.ownerAsked !== true) return false;
    return typeof record.place === "string" && record.place.length >= 1 && record.place.length <= 200
      && (record.interaction === "initiate" || record.interaction === "continue")
      && typeof record.say === "string" && record.say.trim().length >= 1 && record.say.length <= PLACE_SAY_MAX_CHARS
      && (record.atMs === undefined || (typeof record.atMs === "number" && Number.isSafeInteger(record.atMs) && record.atMs >= 0));
  });
}

function intentId(cycleId: string, ordinal: number): string {
  return `intent:${createHash("sha256").update(`${cycleId}:${ordinal}`).digest("hex").slice(0, 32)}`;
}

/**
 * Keep her intents from one settled cycle, once. A turn that saw secret material posts nowhere
 * (the Host cannot tell which words carry it). A time past the allowed horizon is refused. Only a
 * post the Owner asked for in the Owner's own turn goes out as written; the rest are written in the
 * place itself.
 */
export function recordPlaceIntents(sidecar: DatabaseSync, input: {
  cycleId: string; claims: readonly PlaceIntentClaim[]; sawSecret: boolean; nowMs: number; ownerTurn?: boolean;
}): Array<{ intentId: string; state: PlaceIntentState; reason?: string }> {
  const insert = sidecar.prepare(`INSERT OR IGNORE INTO place_intents (intent_id, cycle_id, ordinal, place_ref, interaction, say, state, reason,
    due_at_ms, requested_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const wish = sidecar.prepare(`INSERT OR IGNORE INTO place_wishes (wish_id, cycle_id, ordinal, place_ref, interaction, draft, state,
    due_at_ms, requested_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 'composing', ?, ?, ?)`);
  return input.claims.slice(0, PLACE_INTENTS_MAX).map((claim, ordinal) => {
    const id = intentId(input.cycleId, ordinal);
    const due = claim.atMs !== undefined && claim.atMs > input.nowMs ? claim.atMs : input.nowMs;
    const reason = input.sawSecret ? "secret_in_view"
      : due - input.nowMs > PLACE_INTENT_MAX_DELAY_MS ? "too_far_ahead"
      : undefined;
    if (!reason && !(claim.ownerAsked && input.ownerTurn)) {
      const wishId = id.replace(/^intent:/, "wish:");
      wish.run(wishId, input.cycleId, ordinal, claim.place.trim(), claim.interaction, claim.say.trim(), due, input.nowMs, input.nowMs);
      return { intentId: wishId, state: "composing" as const };
    }
    const state: PlaceIntentState = reason ? "refused" : "requested";
    insert.run(id, input.cycleId, ordinal, claim.place.trim(), claim.interaction, claim.say.trim(), state, reason ?? null, due, input.nowMs, input.nowMs);
    return { intentId: id, state, ...(reason ? { reason } : {}) };
  });
}

function move(sidecar: DatabaseSync, id: string, from: readonly PlaceIntentState[], to: PlaceIntentState, nowMs: number, extra: { reason?: string; discordMessageId?: string } = {}): boolean {
  return Number(sidecar.prepare(`UPDATE place_intents SET state = ?, reason = COALESCE(?, reason), discord_message_id = COALESCE(?, discord_message_id),
    updated_at_ms = ? WHERE intent_id = ? AND state IN (${from.map(() => "?").join(",")})`)
    .run(to, extra.reason ?? null, extra.discordMessageId ?? null, nowMs, id, ...from).changes ?? 0) > 0;
}

/**
 * One bot round trip. Its reports are applied first (posted lands in her evidence log for that place,
 * so the place's conversation shows it and replies to it reach her); then due posts are checked and
 * handed over. Checks at hand-over: the place is still hers (trusted room or contact), the Owner has not
 * closed it, the contact has not asked her to stop, and the fuse.
 */
/** Ordinals of posts written from her wishes (compose.ts); a post the Owner asked for keeps its claim ordinal. */
export const PLACE_WISH_POST_ORDINAL = 100;

/**
 * CV05 (User, 2026-10-08): pause, quiet and do-not-disturb hold what she starts on her own in rooms and
 * contact DMs too, not only in the Owner's DM. Held posts wait (they neither go out nor expire); a post the
 * Owner asked for, and her answers to people who speak to her, are not held.
 */
export function placesHeld(sidecar: DatabaseSync, input: { proactivePaused: boolean; nowMs: number }): boolean {
  return input.proactivePaused || readOpenQuietWindow(sidecar, input.nowMs) !== null;
}

export function syncPlacePosts(sidecar: DatabaseSync, nuclear: DatabaseSync, input: {
  reports: readonly PlaceSyncReport[]; nowMs: number; held?: boolean;
}): { posts: PlacePost[]; applied: number } {
  let applied = 0;
  if (input.held) {
    sidecar.prepare("UPDATE place_intents SET due_at_ms = ? WHERE state = 'requested' AND ordinal >= ? AND due_at_ms <= ?")
      .run(input.nowMs, PLACE_WISH_POST_ORDINAL, input.nowMs);
  }
  for (const report of input.reports) {
    const row = sidecar.prepare("SELECT cycle_id, place_ref, say, state FROM place_intents WHERE intent_id = ?").get(report.intentId) as Row | undefined;
    if (!row || row.state !== "sending") continue;
    if (report.outcome === "posted" && report.discordMessageId) {
      sidecar.exec("BEGIN IMMEDIATE");
      try {
        move(sidecar, report.intentId, ["sending"], "posted", input.nowMs, { discordMessageId: report.discordMessageId });
        sidecar.exec("COMMIT");
      } catch (error) { sidecar.exec("ROLLBACK"); throw error; }
      const entry = findPlaceEntry(nuclear, sidecar, String(row.place_ref), input.nowMs);
      const conversationId = entry?.kind === "room" ? entry.conversationIds[0] : entry?.conversationIds[0];
      if (conversationId) {
        try {
          appendAshleyEvidence(sidecar, { conversationId, text: String(row.say), discordMessageIds: [report.discordMessageId],
            nowMs: input.nowMs, producingCycleId: String(row.cycle_id), delivered: true, speakerKind: "ashley",
            audienceAtCapture: entry?.kind === "room" ? "room" : "dm", dataClassification: "ordinary" });
        } catch { /* the receipt stands; the place's log only misses her line */ }
      }
      applied++;
    } else if (report.outcome === "failed") {
      if (move(sidecar, report.intentId, ["sending"], "failed", input.nowMs, { reason: (report.reason ?? "send_failed").slice(0, 120) })) applied++;
    }
  }
  // A send the bot took and never reported on is failed; the place may or may not have it.
  for (const row of sidecar.prepare("SELECT intent_id FROM place_intents WHERE state = 'sending' AND updated_at_ms <= ?")
    .all(input.nowMs - PLACE_SENDING_LEASE_MS) as Row[]) {
    move(sidecar, String(row.intent_id), ["sending"], "failed", input.nowMs, { reason: "no_report_from_bot" });
  }
  for (const row of sidecar.prepare("SELECT intent_id FROM place_intents WHERE state = 'requested' AND due_at_ms <= ?")
    .all(input.nowMs - PLACE_INTENT_TTL_MS) as Row[]) {
    move(sidecar, String(row.intent_id), ["requested"], "expired", input.nowMs, { reason: "not_sent_in_time" });
  }
  const posts: PlacePost[] = [];
  const closed = closedPlaces(sidecar);
  const due = sidecar.prepare(`SELECT intent_id, place_ref, interaction, say FROM place_intents WHERE state = 'requested' AND due_at_ms <= ?
    AND (? = 0 OR ordinal < ?) ORDER BY due_at_ms, requested_at_ms, ordinal LIMIT 8`)
    .all(input.nowMs, input.held ? 1 : 0, PLACE_WISH_POST_ORDINAL) as Row[];
  for (const row of due) {
    const id = String(row.intent_id);
    const entry = findPlaceEntry(nuclear, sidecar, String(row.place_ref), input.nowMs);
    if (!entry) { move(sidecar, id, ["requested"], "refused", input.nowMs, { reason: "not_one_of_your_places" }); continue; }
    if (closed.has(entry.ref)) { move(sidecar, id, ["requested"], "refused", input.nowMs, { reason: "closed_by_owner" }); continue; }
    if (entry.target.kind === "contact") {
      const asked = contactRestrictions(nuclear, entry.target.principalId);
      const stop = asked.find(kind => kind === "do_not_contact" || kind === "no_dm" || kind === "room_only")
        ?? (row.interaction === "initiate" && asked.includes("no_initiation") ? "no_initiation" : undefined);
      if (stop) { move(sidecar, id, ["requested"], "refused", input.nowMs, { reason: `they_asked:${stop}` }); continue; }
    }
    if (postsLast24h(sidecar, entry.ref, input.nowMs) >= placePostLimit(entry.kind)) {
      move(sidecar, id, ["requested"], "refused", input.nowMs, { reason: "place_fuse" });
      continue;
    }
    if (move(sidecar, id, ["requested"], "sending", input.nowMs)) posts.push({ intent_id: id, target: entry.target, text: String(row.say) });
  }
  return { posts, applied };
}

/**
 * Her recent acts in other places, newest last, for her next turns. A wish still being written there
 * shows as composing (with her draft); one she let go shows why; a written one shows as its post.
 */
export function recentPlaceActs(sidecar: DatabaseSync, nowMs: number): PlaceAct[] {
  const since = nowMs - PLACE_RECENT_ACTS_MS;
  return (sidecar.prepare(`SELECT * FROM (
      SELECT place_ref, say, state, reason, requested_at_ms, updated_at_ms, due_at_ms FROM place_intents
        WHERE requested_at_ms >= ? OR state = 'requested'
      UNION ALL
      SELECT place_ref, draft AS say, state, reason, requested_at_ms, updated_at_ms, due_at_ms FROM place_wishes
        WHERE state != 'written' AND (requested_at_ms >= ? OR state = 'composing'))
    ORDER BY requested_at_ms DESC LIMIT ?`).all(since, since, PLACE_RECENT_ACTS) as Row[])
    .reverse().map(row => ({
      place: String(row.place_ref), say: String(row.say).slice(0, 280), state: String(row.state) as PlaceIntentState,
      requestedAtMs: Number(row.requested_at_ms), updatedAtMs: Number(row.updated_at_ms),
      ...(Number(row.due_at_ms) > Number(row.requested_at_ms) ? { dueAtMs: Number(row.due_at_ms) } : {}),
      ...(typeof row.reason === "string" && row.reason ? { reason: row.reason } : {}),
    }));
}

/** The bot's sync body: up to 16 reports of {intent_id, outcome posted|failed, discord_message_id?, reason?}. */
export function parsePlaceSyncReports(body: unknown): PlaceSyncReport[] {
  const reports = body && typeof body === "object" && !Array.isArray(body) ? (body as Row).reports : undefined;
  if (reports === undefined) return [];
  if (!Array.isArray(reports) || reports.length > 16) throw new Error("place_sync_invalid");
  return reports.map(item => {
    const row = item && typeof item === "object" && !Array.isArray(item) ? item as Row : null;
    const intentId = typeof row?.intent_id === "string" ? row.intent_id.trim() : "";
    const outcome = row?.outcome;
    if (!intentId || intentId.length > 80 || (outcome !== "posted" && outcome !== "failed")) throw new Error("place_sync_invalid");
    const discordMessageId = typeof row?.discord_message_id === "string" && /^[0-9]{1,30}$/.test(row.discord_message_id) ? row.discord_message_id : undefined;
    const reason = typeof row?.reason === "string" ? row.reason.slice(0, 120) : undefined;
    return { intentId, outcome, ...(discordMessageId ? { discordMessageId } : {}), ...(reason ? { reason } : {}) };
  });
}
