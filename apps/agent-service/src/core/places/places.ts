// A1 (live 2026-10-06: asked in DM to "try messaging in the server", she answered in the DM and
// believed it went to the server; she had never been told the server existed): the places she is
// present in, as Host facts. Rooms the Owner trusts, contacts the Owner added, the game. Each room
// and contact carries its newest lines, who has been there, and what is new since she last looked.
// Owner-private turns read it; a room or a contact never sees her other places.
import type { DatabaseSync } from "node:sqlite";
import { closedPlaces, contactRestrictions } from "./rules.js";

export const PLACE_TAIL_LINES = 8;
export const PLACE_LINE_CHARS = 280;
export const PLACE_PEOPLE_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Her own posts per place in a rolling day: a fuse she can see, not a target. */
export const PLACE_POST_LIMITS = { room: 12, contact: 6 } as const;
export const PLACE_POST_WINDOW_MS = 24 * 60 * 60_000;

export type PlaceKind = "owner_dm" | "room" | "contact" | "game";
export type PlaceLine = { atMs: number; who: string; text: string };
export type ThoughtPlace = {
  ref: string;
  kind: PlaceKind;
  name: string;
  /** Who can read what is said here. */
  audience: string;
  /** This turn is happening here. */
  here?: true;
  lastActivityAtMs?: number;
  /** Lines by others since you last looked here. */
  unread?: number;
  /** The newest lines, oldest first. */
  recent?: PlaceLine[];
  /** People seen here in the last week. */
  people?: string[];
  /** Your own posts here in the last 24 h against the limit. */
  posts?: { last24h: number; limit: number };
  /** The game: whether it is running now. */
  live?: boolean;
  /** The Owner closed this place (/places): nothing you post here goes out until it is reopened. */
  closedByOwner?: true;
  /** What this person asked of you: no_initiation (only answer them), do_not_contact, no_dm or room_only. */
  theyAsked?: string[];
};

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

// ---- names -----------------------------------------------------------------------------------

export type DiscordNameKind = "user" | "guild" | "channel";

/** Names the platform reported with a message. Names change; the newest wins. */
export function recordDiscordNames(sidecar: DatabaseSync, names: Array<{ kind: DiscordNameKind; id: string; name?: string | null }>, nowMs: number): void {
  const upsert = sidecar.prepare(`INSERT INTO discord_names (kind, id, name, updated_at_ms) VALUES (?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET name = excluded.name, updated_at_ms = excluded.updated_at_ms`);
  for (const item of names) {
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 100) : "";
    if (item.id.trim() && name) upsert.run(item.kind, item.id.trim(), name, nowMs);
  }
}

export function discordName(sidecar: DatabaseSync, kind: DiscordNameKind, id: string): string | null {
  const row = sidecar.prepare("SELECT name FROM discord_names WHERE kind = ? AND id = ?").get(kind, id) as Row | undefined;
  return row ? text(row.name) || null : null;
}

// ---- the registry ----------------------------------------------------------------------------

export type PlaceEntry = {
  ref: string;
  kind: Exclude<PlaceKind, "owner_dm" | "game">;
  /** The conversation her evidence log keeps for this place. */
  conversationIds: string[];
  /** Discord ids the bot needs to post there. */
  target: { kind: "room"; guildId: string; channelId: string } | { kind: "contact"; principalId: string };
};

export function roomRef(guildId: string, channelId: string): string {
  return `room:${guildId}:${channelId}`;
}

export function contactRef(principalId: string): string {
  return `contact:${principalId}`;
}

/** Rooms the Owner trusts (trusted_social) and contacts with a live DM permit. */
export function listPlaceEntries(nuclear: DatabaseSync, sidecar: DatabaseSync, nowMs: number): PlaceEntry[] {
  const entries: PlaceEntry[] = [];
  if (tableExists(nuclear, "trusted_rooms")) {
    for (const row of nuclear.prepare(`SELECT guild_id, channel_id FROM trusted_rooms WHERE mode = 'trusted_social'
      ORDER BY added_at, guild_id, channel_id`).all() as Row[]) {
      const guildId = text(row.guild_id);
      const channelId = text(row.channel_id);
      if (!guildId || !channelId) continue;
      entries.push({ ref: roomRef(guildId, channelId), kind: "room", conversationIds: [roomRef(guildId, channelId)],
        target: { kind: "room", guildId, channelId } });
    }
  }
  if (tableExists(nuclear, "social_permits")) {
    const nowIso = new Date(nowMs).toISOString();
    const seen = new Set<string>();
    for (const row of nuclear.prepare(`SELECT principal_id FROM social_permits WHERE scope IN ('person_wide','dm_only')
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY granted_at, principal_id`).all(nowIso) as Row[]) {
      const principalId = text(row.principal_id);
      if (!principalId || seen.has(principalId)) continue;
      seen.add(principalId);
      const conversations = (sidecar.prepare(`SELECT DISTINCT conversation_id FROM conversation_evidence_log
        WHERE conversation_id LIKE 'dm:%' AND conversation_id LIKE ?`).all(`%:${principalId}`) as Row[]).map(item => text(item.conversation_id));
      entries.push({ ref: contactRef(principalId), kind: "contact", conversationIds: conversations,
        target: { kind: "contact", principalId } });
    }
  }
  return entries;
}

export function findPlaceEntry(nuclear: DatabaseSync, sidecar: DatabaseSync, ref: string, nowMs: number): PlaceEntry | undefined {
  return listPlaceEntries(nuclear, sidecar, nowMs).find(entry => entry.ref === ref);
}

// ---- what she sees ---------------------------------------------------------------------------

function placeName(sidecar: DatabaseSync, entry: PlaceEntry): string {
  if (entry.target.kind === "room") {
    const channel = discordName(sidecar, "channel", entry.target.channelId);
    const guild = discordName(sidecar, "guild", entry.target.guildId);
    return `${channel ? `#${channel}` : "a channel"}${guild ? ` in ${guild}` : ""}`;
  }
  return discordName(sidecar, "user", entry.target.principalId) ?? "a contact";
}

function speakerName(sidecar: DatabaseSync, row: Row, ownerLabel: string): string {
  const role = text(row.role);
  if (role === "ashley") return "you";
  if (role === "owner") return ownerLabel;
  const id = text(row.speaker_principal_id);
  return (id && discordName(sidecar, "user", id)) || "someone";
}

/** Posts handed to the bot or posted here in the last day (waiting ones do not count). */
export function postsLast24h(sidecar: DatabaseSync, ref: string, nowMs: number): number {
  return Number((sidecar.prepare(`SELECT count(*) AS n FROM place_intents WHERE place_ref = ? AND updated_at_ms > ?
    AND state IN ('sending','posted')`).get(ref, nowMs - PLACE_POST_WINDOW_MS) as Row).n ?? 0);
}

export function placePostLimit(kind: PlaceEntry["kind"]): number {
  return PLACE_POST_LIMITS[kind];
}

function seenThrough(sidecar: DatabaseSync, ref: string): number {
  const row = sidecar.prepare("SELECT seen_through_ms FROM place_seen WHERE place_ref = ?").get(ref) as Row | undefined;
  return Number(row?.seen_through_ms ?? 0);
}

function placeView(sidecar: DatabaseSync, nuclear: DatabaseSync, entry: PlaceEntry, nowMs: number, closed: Set<string>): ThoughtPlace {
  const limit = placePostLimit(entry.kind);
  const asked = entry.target.kind === "contact" ? contactRestrictions(nuclear, entry.target.principalId) : [];
  const view: ThoughtPlace = {
    ref: entry.ref,
    kind: entry.kind,
    name: placeName(sidecar, entry),
    audience: entry.kind === "room" ? "everyone in this channel" : "only this person (and the Owner, who can read all you keep)",
    posts: { last24h: postsLast24h(sidecar, entry.ref, nowMs), limit },
    ...(closed.has(entry.ref) ? { closedByOwner: true as const } : {}),
    ...(asked.length ? { theyAsked: asked } : {}),
  };
  if (!entry.conversationIds.length) return view;
  const marks = entry.conversationIds.map(() => "?").join(",");
  const live = `conversation_id IN (${marks}) AND text IS NOT NULL AND data_classification != 'secret'
    AND row_id = (SELECT row_id FROM conversation_evidence_log newest WHERE newest.lineage_id = conversation_evidence_log.lineage_id ORDER BY version DESC LIMIT 1)`;
  const rows = (sidecar.prepare(`SELECT role, text, created_at_ms, speaker_principal_id FROM conversation_evidence_log
    WHERE ${live} ORDER BY created_at_ms DESC, row_id DESC LIMIT ?`).all(...entry.conversationIds, PLACE_TAIL_LINES) as Row[]).reverse();
  if (!rows.length) return view;
  view.lastActivityAtMs = Number(rows.at(-1)!.created_at_ms);
  view.recent = rows.map(row => ({ atMs: Number(row.created_at_ms), who: speakerName(sidecar, row, "the Owner"),
    text: text(row.text).slice(0, PLACE_LINE_CHARS) }));
  const seen = seenThrough(sidecar, entry.ref);
  const unread = Number((sidecar.prepare(`SELECT count(*) AS n FROM conversation_evidence_log WHERE ${live} AND role != 'ashley' AND created_at_ms > ?`)
    .get(...entry.conversationIds, seen) as Row).n ?? 0);
  if (unread > 0) view.unread = unread;
  const people = (sidecar.prepare(`SELECT DISTINCT speaker_principal_id, role FROM conversation_evidence_log WHERE ${live}
    AND role IN ('external_dialog','owner') AND created_at_ms > ?`).all(...entry.conversationIds, nowMs - PLACE_PEOPLE_WINDOW_MS) as Row[])
    .map(row => speakerName(sidecar, row, "the Owner"));
  if (people.length) view.people = [...new Set(people)].slice(0, 12);
  return view;
}

/** Her places for an Owner-private turn: the Owner's DM, trusted rooms, contacts, and the game when it was seen. */
export function placesForThought(sidecar: DatabaseSync, nuclear: DatabaseSync, input: {
  nowMs: number; here?: "owner_dm"; game?: { world: string; live: boolean };
}): ThoughtPlace[] {
  const places: ThoughtPlace[] = [{ ref: "owner_dm", kind: "owner_dm", name: "your DM with the Owner", audience: "the Owner",
    ...(input.here === "owner_dm" ? { here: true as const } : {}) }];
  const closed = closedPlaces(sidecar);
  for (const entry of listPlaceEntries(nuclear, sidecar, input.nowMs)) places.push(placeView(sidecar, nuclear, entry, input.nowMs, closed));
  if (input.game) places.push({ ref: `domus:${input.game.world}`, kind: "game", name: "your home in The Sims 4 (Domus)",
    audience: "the game only", live: input.game.live });
  return places;
}

/** The newest line she was shown in each place, to mark as seen once the turn settles. */
export function placesSeenMarks(places: readonly ThoughtPlace[] | undefined): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const place of places ?? []) if (place.recent?.length) marks[place.ref] = Math.max(...place.recent.map(line => line.atMs));
  return marks;
}

export function recordPlacesSeen(sidecar: DatabaseSync, marks: Record<string, number> | undefined, nowMs: number): void {
  const upsert = sidecar.prepare(`INSERT INTO place_seen (place_ref, seen_through_ms, updated_at_ms) VALUES (?, ?, ?)
    ON CONFLICT(place_ref) DO UPDATE SET seen_through_ms = max(place_seen.seen_through_ms, excluded.seen_through_ms), updated_at_ms = excluded.updated_at_ms`);
  for (const [ref, atMs] of Object.entries(marks ?? {})) if (Number.isFinite(atMs)) upsert.run(ref, atMs, nowMs);
}
