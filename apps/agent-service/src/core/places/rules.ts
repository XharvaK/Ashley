// G1 limits with logic: three kinds of limit on her places, each from the one who owns it.
// - Her own standing rules, in her words (`placeRules`): kept and shown back to her with her places;
//   she keeps them, the Host never interprets them.
// - A contact's "stop" (`contactStop`, only in that person's own turn): a recipient restriction on that
//   person, hard at hand-over and at publication.
// - The Owner's switch (/places): a closed room or contact takes no post from her until reopened.
import type { DatabaseSync } from "node:sqlite";
import {
  clearRecipientRestriction, setRecipientRestriction, type RecipientRestrictionKind,
} from "../relationship/social-authority.js";

export const PLACE_RULES_PER_TURN = 3;
export const PLACE_RULES_MAX = 16;
export const PLACE_RULE_MAX_CHARS = 300;

export type PlaceRuleClaim = { place: string; rule?: string; clear?: true };
export type PlaceRule = { place: string; rule: string; setAtMs: number };
export type ContactStop = "no_initiation" | "do_not_contact" | "resume";

type Row = Record<string, unknown>;

const PLACE_REF = /^(room:[^:\s]+:[^:\s]+|contact:[^:\s]+|https:\/\/[^\s]+|owner_dm|domus:[^\s]+|everywhere)$/;

export function isPlaceRuleClaims(value: unknown): value is PlaceRuleClaim[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > PLACE_RULES_PER_TURN) return false;
  return value.every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some(key => !["place", "rule", "clear"].includes(key))) return false;
    if (typeof record.place !== "string" || !PLACE_REF.test(record.place.trim())) return false;
    if (record.clear !== undefined) return record.clear === true && record.rule === undefined;
    return typeof record.rule === "string" && record.rule.trim().length >= 1 && record.rule.length <= PLACE_RULE_MAX_CHARS;
  });
}

export function isContactStop(value: unknown): value is ContactStop {
  return value === "no_initiation" || value === "do_not_contact" || value === "resume";
}

/** One rule per place (a new one replaces the old); at most PLACE_RULES_MAX in all. */
export function applyPlaceRules(sidecar: DatabaseSync, input: {
  cycleId: string; claims: readonly PlaceRuleClaim[]; nowMs: number;
}): Array<{ place: string; ok: boolean; reason?: string }> {
  return input.claims.slice(0, PLACE_RULES_PER_TURN).map(claim => {
    const place = claim.place.trim();
    if (claim.clear) {
      sidecar.prepare("DELETE FROM place_rules WHERE place_ref = ?").run(place);
      return { place, ok: true };
    }
    const exists = sidecar.prepare("SELECT 1 FROM place_rules WHERE place_ref = ?").get(place);
    const count = Number((sidecar.prepare("SELECT count(*) AS n FROM place_rules").get() as Row).n ?? 0);
    if (!exists && count >= PLACE_RULES_MAX) return { place, ok: false, reason: "too_many_rules" };
    sidecar.prepare(`INSERT INTO place_rules (place_ref, rule, cycle_id, set_at_ms) VALUES (?, ?, ?, ?)
      ON CONFLICT(place_ref) DO UPDATE SET rule = excluded.rule, cycle_id = excluded.cycle_id, set_at_ms = excluded.set_at_ms`)
      .run(place, claim.rule!.trim(), input.cycleId, input.nowMs);
    return { place, ok: true };
  });
}

export function listPlaceRules(sidecar: DatabaseSync): PlaceRule[] {
  return (sidecar.prepare("SELECT place_ref, rule, set_at_ms FROM place_rules ORDER BY set_at_ms, place_ref").all() as Row[])
    .map(row => ({ place: String(row.place_ref), rule: String(row.rule), setAtMs: Number(row.set_at_ms) }));
}

// ---- the Owner's switch ----------------------------------------------------------------------

export function setPlaceSwitch(sidecar: DatabaseSync, place: string, state: "closed" | "open", nowMs: number): void {
  if (state === "open") sidecar.prepare("DELETE FROM place_switches WHERE place_ref = ?").run(place);
  else sidecar.prepare(`INSERT INTO place_switches (place_ref, state, set_at_ms) VALUES (?, 'closed', ?)
    ON CONFLICT(place_ref) DO UPDATE SET state = 'closed', set_at_ms = excluded.set_at_ms`).run(place, nowMs);
}

export function closedPlaces(sidecar: DatabaseSync): Set<string> {
  return new Set((sidecar.prepare("SELECT place_ref FROM place_switches WHERE state = 'closed'").all() as Row[]).map(row => String(row.place_ref)));
}

// ---- a contact's stop ------------------------------------------------------------------------

const STOP_KINDS: readonly RecipientRestrictionKind[] = ["no_initiation", "do_not_contact", "no_dm"];

/** The live restrictions a person set on her, strongest first. */
export function contactRestrictions(nuclear: DatabaseSync, principalId: string): RecipientRestrictionKind[] {
  const exists = nuclear.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recipient_restrictions'").get();
  if (!exists) return [];
  const kinds = new Set((nuclear.prepare("SELECT kind FROM recipient_restrictions WHERE principal_id = ? AND cleared_at IS NULL")
    .all(principalId) as Row[]).map(row => String(row.kind) as RecipientRestrictionKind));
  return (["do_not_contact", "no_dm", "room_only", "no_initiation"] as const).filter(kind => kinds.has(kind));
}

/**
 * The person's own words, read by her in that person's own turn. The Host binds it to the speaker of
 * the message that started the turn, never to anyone she names. Resume clears only what this person set.
 */
export function applyContactStop(nuclear: DatabaseSync, input: {
  ownerId: string; principalId: string; stop: ContactStop; sourceMessageRef: string; nowMs: number;
}): void {
  if (input.stop === "resume") {
    for (const row of nuclear.prepare(`SELECT entity_uuid, kind FROM recipient_restrictions WHERE principal_id = ? AND cleared_at IS NULL`)
      .all(input.principalId) as Row[]) {
      if (STOP_KINDS.includes(String(row.kind) as RecipientRestrictionKind)) {
        clearRecipientRestriction(nuclear, { authenticatedSender: true, entityUuid: String(row.entity_uuid), nowMs: input.nowMs });
      }
    }
    return;
  }
  setRecipientRestriction(nuclear, { authenticatedSender: true, ownerId: input.ownerId, principalId: input.principalId,
    kind: input.stop, sourceMessageRef: input.sourceMessageRef, nowMs: input.nowMs });
}
