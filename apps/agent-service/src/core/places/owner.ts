// G1: the Owner's view of her places and the switch for each (/places). Seeing them is never a
// required step; closing one stops what she posts there, reopening (or opening a site she asked
// for) lets her back in.
import type { DatabaseSync } from "node:sqlite";
import { listPlaceEntries, placesForThought } from "./places.js";
import { closedPlaces, listPlaceRules, setPlaceSwitch, type PlaceRule } from "./rules.js";
import { normalizeOrigin, setWebPlaceState } from "../reach/web.js";

export type OwnerPlace = { ref: string; kind: string; name: string; closed: boolean; theyAsked?: string[]; postsLast24h?: number };
export type OwnerWebPlace = { origin: string; state: string; reason: string | null };

type Row = Record<string, unknown>;

export function ownerPlacesView(sidecar: DatabaseSync, nuclear: DatabaseSync, nowMs: number): {
  places: OwnerPlace[]; web: OwnerWebPlace[]; rules: PlaceRule[];
} {
  const closed = closedPlaces(sidecar);
  const places = placesForThought(sidecar, nuclear, { nowMs }).filter(place => place.kind === "room" || place.kind === "contact")
    .map(place => ({ ref: place.ref, kind: place.kind, name: place.name, closed: closed.has(place.ref),
      ...(place.theyAsked ? { theyAsked: place.theyAsked } : {}), ...(place.posts ? { postsLast24h: place.posts.last24h } : {}) }));
  const web = (sidecar.prepare("SELECT origin, state, reason FROM web_places ORDER BY updated_at_ms DESC LIMIT 50").all() as Row[])
    .map(row => ({ origin: String(row.origin), state: String(row.state), reason: typeof row.reason === "string" ? row.reason : null }));
  return { places, web, rules: listPlaceRules(sidecar) };
}

/** Close or open a room, a contact or a website. A website opened here becomes hers (the Owner approved it). */
export function ownerSwitchPlace(sidecar: DatabaseSync, nuclear: DatabaseSync, input: {
  place: string; state: "closed" | "open"; nowMs: number;
}): { ok: true; place: string } | { ok: false; reason: "not_a_place" } {
  const raw = input.place.trim();
  if (raw.startsWith("room:") || raw.startsWith("contact:")) {
    if (!listPlaceEntries(nuclear, sidecar, input.nowMs).some(entry => entry.ref === raw)) return { ok: false, reason: "not_a_place" };
    setPlaceSwitch(sidecar, raw, input.state, input.nowMs);
    return { ok: true, place: raw };
  }
  const origin = normalizeOrigin(raw);
  if (!origin || !setWebPlaceState(sidecar, origin, input.state === "open" ? "approved" : "closed", input.nowMs)) {
    return { ok: false, reason: "not_a_place" };
  }
  return { ok: true, place: origin };
}
