import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { listMemorySupports } from "../memory/supports.js";
import { INTEREST_ROOTS, type InterestRoot } from "../memory/interests.js";
import { quietUntilMs, writeQuietWindow } from "../quiet/window.js";
import type { SkyWord } from "../world/weather.js";

/**
 * UX_PACK v4 Wave 2: her soft acts. Thought decides each one and what it
 * means; the Host checks it against what really happened, records it, and the
 * bot renders it in the Owner's DM. Every refusal is a fact on her next
 * Owner-private pass, never a silent drop.
 */

export const SOFT_KINDS = ["touch", "correct", "callback", "pin", "card", "face", "quiet"] as const;
export type SoftKind = (typeof SOFT_KINDS)[number];

export type TouchClaim = { emoji: string; rowId: string; meaning: "landed" | "this_bit" | "did_it" };
export type CorrectClaim = { rowId: string; bubble?: number; text: string };
export type CallbackClaim = { memoryRef: string } | { gifQuery: string };
export type PinClaim = { rowId: string; memoryRef?: string };
export type CardClaim = { kind: "reading_note" | "question" | "letter"; title: string; body: string; link?: string };
export type FaceClaim = { wardrobeId: string };
export type QuietClaim = { forMs: number; whose: "owner_asked" | "her_own" };

export type SoftClaims = {
  touch?: TouchClaim;
  correct?: CorrectClaim;
  callback?: CallbackClaim;
  pin?: PinClaim;
  card?: CardClaim;
  face?: FaceClaim;
  quiet?: QuietClaim;
};

/** What the bot is asked to do, already bound to Discord ids. */
export type SoftRequest =
  | { kind: "touch"; emoji: string; messageId: string; meaning: TouchClaim["meaning"] }
  | { kind: "correct"; messageId: string; text: string }
  | { kind: "callback"; url: string; replyTo?: string }
  | { kind: "callback"; gifQuery: string }
  | { kind: "pin"; messageId: string }
  | { kind: "card"; cardKind: CardClaim["kind"]; title: string; body: string; link?: string }
  | { kind: "face"; wardrobeId: string };

export type SoftActFact = {
  kind: SoftKind;
  status: "waiting" | "done" | "refused" | "failed";
  reason?: string;
  about?: string;
  atMs: number;
};

/** followsGame (UX W3): a game is live, so her avatar is her Sim's mood until it ends. */
export type WardrobeFact = { current: string; available: string[]; followsGame?: true };

export type SoftLayerFacts = {
  acts?: SoftActFact[];
  face?: WardrobeFact;
};

export const PIN_CAP = 20;
export const FACE_CHANGE_MS = 24 * 60 * 60_000;
export const CLAIM_TTL_MS = 10 * 60_000;
export const DID_IT_WINDOW_MS = 24 * 60 * 60_000;
export const SOFT_FACTS_MAX = 5;
/** An interest family unlocks once any branch under its roots was lived this many times. Unlocks are permanent. */
export const INTEREST_FAMILY_UNLOCK_LIVED = 5;
export const DEFAULT_WARDROBE_ID = "day-awake";

/** A face chosen while she sleeps or her game body wears the face: the Discord side wears it at wake; the report says so. */
export const SOFT_REASON_WORN_AT_WAKE = "worn_at_wake";

/** UX_PACK v4 Assets: each of the 50 roots in exactly one family. */
export const INTEREST_FAMILIES: Readonly<Record<string, readonly InterestRoot[]>> = Object.freeze({
  sound: ["Electronic music", "Music production & sound", "Experimental & ambient music"],
  pages: ["Books & essays", "Language & words", "Philosophy", "Ethics & moral dilemmas", "Existentialism & meaning",
    "History", "Politics & society", "Economics & markets", "Psychology & the mind", "Cognitive biases",
    "How people behave in relationships", "Drug policy & harm reduction"],
  stars: ["Science & space", "Cosmology & big questions", "Technology", "Artificial intelligence", "Math & puzzles",
    "Video games (strategy & systems)", "Esports & competition", "Sci-fi & speculative fiction", "Neuroscience",
    "Health & the body", "Psychopharmacology"],
  strange: ["Mythology & the strange", "Folklore & urban legends", "Occultism & esoteric history",
    "Mysticism & religious experience", "Theology", "Comparative religion", "Dreams & altered states", "Psychedelia",
    "Consciousness studies", "True crime & mysteries"],
  screens: ["Film & TV", "Cult films & weird cinema", "Photography", "Art & visual culture", "Design & architecture",
    "Surrealism & dada", "Fashion & style", "Internet culture", "Comedy & humour", "Absurd humour",
    "Satire & dark comedy"],
  outside: ["Nature & animals", "Cities & travel", "Food & cooking"],
});

const GIF_LINK = /https:\/\/(?:www\.)?(?:tenor\.com\/(?:[a-z-]+\/)?view\/|giphy\.com\/(?:gifs|stickers)\/|media\d*\.giphy\.com\/media\/|i\.giphy\.com\/)[^\s<>()"'`]+/i;
const ANY_LINK = /https?:\/\/[^\s<>()"'`]+/gi;
const EMOJI_ONLY = /^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Component}‍️⃣])+$/u;
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]|⃣/u;

type Row = Record<string, unknown>;

/** One Unicode emoji (sequences included); never a custom `<:name:id>` or text. */
export function isUnicodeEmoji(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 16 && EMOJI_ONLY.test(trimmed) && EMOJI_CORE.test(trimmed);
}

function ids(json: unknown): string[] {
  if (typeof json !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "") : [];
  } catch {
    return [];
  }
}

type BoundRow = { role: string; text: string; discordIds: string[] };

/** A conversation row of this Owner DM conversation: never a room, never redacted. */
function dmRow(db: DatabaseSync, rowId: string, conversationId: string): BoundRow | string {
  const row = db.prepare(
    `SELECT role, text, conversation_id, discord_message_ids_json, location_json, source_status
       FROM conversation_evidence_log WHERE row_id = ?`,
  ).get(rowId) as Row | undefined;
  if (!row) return "row_unknown";
  if (row.conversation_id !== conversationId || String(row.conversation_id).startsWith("room:")) return "not_owner_dm";
  if (typeof row.location_json === "string" && row.location_json.includes("\"room\"")) return "not_owner_dm";
  if (row.source_status === "redacted") return "row_forgotten";
  const discordIds = ids(row.discord_message_ids_json);
  if (discordIds.length === 0) return "row_not_on_discord";
  return { role: String(row.role), text: typeof row.text === "string" ? row.text : "", discordIds };
}

function didItBound(db: DatabaseSync, text: string, nowMs: number): boolean {
  const links = [...text.matchAll(ANY_LINK)].map((match) => match[0]);
  if (links.length === 0) return false;
  const rows = db.prepare(
    `SELECT payload_json FROM observations
      WHERE modality = 'page' AND created_at_ms >= ?
      ORDER BY created_at_ms DESC LIMIT 200`,
  ).all(nowMs - DID_IT_WINDOW_MS) as Row[];
  for (const row of rows) {
    try {
      const payload = JSON.parse(String(row.payload_json)) as { requestedUrl?: unknown; finalUrl?: unknown };
      if (links.some((link) => link === payload.requestedUrl || link === payload.finalUrl)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** A GIF link from the conversation rows a memory came from, and the Discord message to reply to. */
function memoryGif(db: DatabaseSync, memoryRef: string, conversationId: string): { url: string; replyTo?: string } | null {
  const refs = listMemorySupports(db, memoryRef).flatMap((support) => [support.sourceRef, support.evidenceLineageId]);
  for (const ref of refs) {
    if (!ref) continue;
    const rows = db.prepare(
      `SELECT text, conversation_id, discord_message_ids_json, source_status FROM conversation_evidence_log
        WHERE row_id = ? OR lineage_id = ? ORDER BY version DESC LIMIT 3`,
    ).all(ref, ref) as Row[];
    for (const row of rows) {
      if (row.source_status === "redacted" || typeof row.text !== "string") continue;
      const url = GIF_LINK.exec(row.text)?.[0];
      if (!url) continue;
      const replyTo = row.conversation_id === conversationId ? ids(row.discord_message_ids_json)[0] : undefined;
      return { url, ...(replyTo ? { replyTo } : {}) };
    }
  }
  return null;
}

function countSince(db: DatabaseSync, kind: SoftKind, statuses: string[], sinceMs: number): number {
  const placeholders = statuses.map(() => "?").join(",");
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM soft_acts WHERE kind = ? AND status IN (${placeholders}) AND created_at_ms >= ?`,
  ).get(kind, ...statuses, sinceMs) as Row;
  return Number(row.n ?? 0);
}

/** The Discord side reads faces from ASHLEY_ART_DIR as avatar/<id>.png; with no folder set here, no face can be shown to be there. */
export function wardrobeArtOnDisk(wardrobeId: string): boolean {
  const root = process.env.ASHLEY_ART_DIR?.trim();
  if (!root) return false;
  return existsSync(join(root, "avatar", `${wardrobeId}.png`));
}

/** The wardrobe ids that match her life now (UX_PACK v4 Assets): the day face, the sky, her unlocked interests. Only faces with art are offered. */
export function wardrobeAvailable(
  db: DatabaseSync,
  input: { sky?: SkyWord | null; hasArt?: (wardrobeId: string) => boolean },
): string[] {
  const hasArt = input.hasArt ?? wardrobeArtOnDisk;
  const available = [DEFAULT_WARDROBE_ID];
  if (input.sky === "rain" || input.sky === "drizzle" || input.sky === "thunder") available.push("weather-rain");
  if (input.sky === "snow") available.push("weather-snow");
  let lived: Row[] = [];
  try {
    lived = db.prepare(
      "SELECT root, MAX(lived_count) AS lived FROM interest_branches WHERE forgotten_at_ms IS NULL GROUP BY root",
    ).all() as Row[];
  } catch {
    lived = [];
  }
  const unlocked = new Set(lived.filter((row) => Number(row.lived ?? 0) >= INTEREST_FAMILY_UNLOCK_LIVED).map((row) => String(row.root)));
  for (const [family, roots] of Object.entries(INTEREST_FAMILIES)) {
    if (roots.some((root) => unlocked.has(root))) available.push(`interest-${family}`);
  }
  return available.filter((id) => id === DEFAULT_WARDROBE_ID || hasArt(id));
}

export function currentWardrobe(db: DatabaseSync): string {
  const row = db.prepare(
    "SELECT request_json FROM soft_acts WHERE kind = 'face' AND status = 'done' ORDER BY settled_at_ms DESC, act_id DESC LIMIT 1",
  ).get() as Row | undefined;
  if (!row) return DEFAULT_WARDROBE_ID;
  try {
    const request = JSON.parse(String(row.request_json)) as { wardrobeId?: unknown };
    return typeof request.wardrobeId === "string" ? request.wardrobeId : DEFAULT_WARDROBE_ID;
  } catch {
    return DEFAULT_WARDROBE_ID;
  }
}

type Bound = { request: SoftRequest | { kind: "quiet"; whose: QuietClaim["whose"]; untilMs: number }; about?: string } | { refused: string; about?: string };

export type SoftContext = {
  conversationId: string;
  /** The Owner wrote this turn. */
  ownerTurn: boolean;
  /** Wardrobe ids offered this pass. */
  wardrobe?: readonly string[];
  timeZone?: string;
};

function bind(db: DatabaseSync, kind: SoftKind, claims: SoftClaims, context: SoftContext, nowMs: number): Bound {
  switch (kind) {
    case "touch": {
      const claim = claims.touch!;
      if (!isUnicodeEmoji(claim.emoji)) return { refused: "not_a_unicode_emoji", about: claim.emoji.slice(0, 32) };
      const row = dmRow(db, claim.rowId, context.conversationId);
      if (typeof row === "string") return { refused: row, about: claim.emoji };
      if (row.role !== "owner") return { refused: "not_an_owner_message", about: claim.emoji };
      if (claim.meaning === "did_it" && !didItBound(db, row.text, nowMs)) return { refused: "did_it_without_receipt", about: claim.emoji };
      return { request: { kind, emoji: claim.emoji.trim(), messageId: row.discordIds.at(-1)!, meaning: claim.meaning }, about: claim.emoji };
    }
    case "correct": {
      const claim = claims.correct!;
      const row = dmRow(db, claim.rowId, context.conversationId);
      if (typeof row === "string") return { refused: row };
      if (row.role !== "ashley") return { refused: "not_her_message" };
      if (row.discordIds.length > 1 && claim.bubble === undefined) return { refused: "bubble_required" };
      const messageId = row.discordIds[claim.bubble ?? 0];
      if (!messageId) return { refused: "bubble_unknown" };
      return { request: { kind, messageId, text: claim.text.trim() } };
    }
    case "callback": {
      const claim = claims.callback!;
      if ("gifQuery" in claim) return { request: { kind, gifQuery: claim.gifQuery.trim() }, about: claim.gifQuery.slice(0, 80) };
      const gif = memoryGif(db, claim.memoryRef, context.conversationId);
      if (!gif) return { refused: "no_gif_in_memory", about: claim.memoryRef };
      return { request: { kind, url: gif.url, ...(gif.replyTo ? { replyTo: gif.replyTo } : {}) }, about: claim.memoryRef };
    }
    case "pin": {
      const claim = claims.pin!;
      const row = dmRow(db, claim.rowId, context.conversationId);
      if (typeof row === "string") return { refused: row };
      if (countSince(db, "pin", ["queued", "claimed", "done"], 0) >= PIN_CAP) return { refused: "pin_cap" };
      return { request: { kind, messageId: row.discordIds[0]! } };
    }
    case "card": {
      const claim = claims.card!;
      if (claim.link !== undefined && !/^https:\/\/[^\s]+$/.test(claim.link)) return { refused: "link_not_https", about: claim.title };
      return {
        request: { kind, cardKind: claim.kind, title: claim.title.trim(), body: claim.body.trim(), ...(claim.link ? { link: claim.link } : {}) },
        about: claim.title.slice(0, 120),
      };
    }
    case "face": {
      const claim = claims.face!;
      if (!(context.wardrobe ?? [DEFAULT_WARDROBE_ID]).includes(claim.wardrobeId)) return { refused: "not_available_now", about: claim.wardrobeId };
      if (countSince(db, "face", ["queued", "claimed", "done"], nowMs - FACE_CHANGE_MS) > 0) return { refused: "once_a_day", about: claim.wardrobeId };
      return { request: { kind, wardrobeId: claim.wardrobeId }, about: claim.wardrobeId };
    }
    case "quiet": {
      const claim = claims.quiet!;
      if (claim.whose === "owner_asked" && !context.ownerTurn) return { refused: "owner_did_not_ask_this_turn" };
      let untilMs: number;
      try {
        untilMs = quietUntilMs(nowMs, claim.forMs, context.timeZone);
      } catch {
        return { refused: "quiet_length_invalid" };
      }
      return { request: { kind, whose: claim.whose, untilMs }, about: new Date(untilMs).toISOString() };
    }
  }
}

/**
 * Records a settlement's soft acts, once each (inside the aftermath transaction).
 * A quiet window opens here; the others wait for the bot.
 */
export function recordSoftActs(
  db: DatabaseSync,
  input: { settlementId: string; claims: SoftClaims; context: SoftContext; nowMs: number },
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO soft_acts (settlement_id, kind, request_json, status, reason, created_at_ms, settled_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const kind of SOFT_KINDS) {
    if (input.claims[kind] === undefined) continue;
    const bound = bind(db, kind, input.claims, input.context, input.nowMs);
    if ("refused" in bound) {
      insert.run(input.settlementId, kind, JSON.stringify({ kind, ...(bound.about ? { about: bound.about } : {}) }),
        "refused", bound.refused, input.nowMs, input.nowMs);
      continue;
    }
    const stored = JSON.stringify({ ...bound.request, ...(bound.about ? { about: bound.about } : {}) });
    if (bound.request.kind === "quiet") {
      writeQuietWindow(db, bound.request.whose === "owner_asked" ? "owner_command" : "her_own", bound.request.untilMs, input.nowMs);
      insert.run(input.settlementId, kind, stored, "done", null, input.nowMs, input.nowMs);
      continue;
    }
    insert.run(input.settlementId, kind, stored, "queued", null, input.nowMs, null);
  }
}

/** Claims what is queued for the bot; an act claimed and never reported in time fails (never replayed). */
export function claimSoftActs(db: DatabaseSync, nowMs: number, limit = 5): Array<{ actId: number; request: SoftRequest }> {
  db.prepare(
    "UPDATE soft_acts SET status = 'failed', reason = 'no_report', settled_at_ms = ? WHERE status = 'claimed' AND claimed_at_ms < ?",
  ).run(nowMs, nowMs - CLAIM_TTL_MS);
  const rows = db.prepare(
    "SELECT act_id, request_json FROM soft_acts WHERE status = 'queued' ORDER BY created_at_ms ASC, act_id ASC LIMIT ?",
  ).all(Math.max(1, limit)) as Row[];
  const claimed: Array<{ actId: number; request: SoftRequest }> = [];
  const mark = db.prepare("UPDATE soft_acts SET status = 'claimed', claimed_at_ms = ? WHERE act_id = ? AND status = 'queued'");
  for (const row of rows) {
    const actId = Number(row.act_id);
    if (Number(mark.run(nowMs, actId).changes) !== 1) continue;
    const { about: _about, ...request } = JSON.parse(String(row.request_json)) as SoftRequest & { about?: string };
    claimed.push({ actId, request: request as SoftRequest });
  }
  return claimed;
}

export function reportSoftAct(
  db: DatabaseSync,
  input: { actId: number; status: "done" | "refused" | "failed"; reason?: string; nowMs: number },
): boolean {
  const reason = input.reason?.trim().slice(0, 80) || null;
  // A done act carries no reason, except a face that waits for her wake: that one says so.
  const kept = input.status === "done" && reason !== SOFT_REASON_WORN_AT_WAKE ? null : reason;
  return Number(db.prepare(
    "UPDATE soft_acts SET status = ?, reason = ?, settled_at_ms = ? WHERE act_id = ? AND status = 'claimed'",
  ).run(input.status, kept, input.nowMs, input.actId).changes) === 1;
}

/** Her recent soft acts not yet shown, newest first, plus her wardrobe. */
export function softLayerForPass(
  db: DatabaseSync,
  input: { wardrobe?: readonly string[]; gameLive?: boolean },
): { facts: SoftLayerFacts; actIds: number[] } {
  let rows: Row[];
  try {
    rows = db.prepare(
      `SELECT act_id, kind, status, reason, request_json, created_at_ms, settled_at_ms FROM soft_acts
        WHERE shown_cycle_id IS NULL ORDER BY created_at_ms DESC, act_id DESC LIMIT ?`,
    ).all(SOFT_FACTS_MAX) as Row[];
  } catch {
    return { facts: {}, actIds: [] };
  }
  const acts: SoftActFact[] = rows.map((row) => {
    let about: string | undefined;
    try {
      const request = JSON.parse(String(row.request_json)) as { about?: unknown };
      about = typeof request.about === "string" ? request.about : undefined;
    } catch {
      about = undefined;
    }
    const status = row.status === "queued" || row.status === "claimed" ? "waiting" : row.status as SoftActFact["status"];
    return {
      kind: row.kind as SoftKind,
      status,
      ...(typeof row.reason === "string" && row.reason ? { reason: row.reason } : {}),
      ...(about ? { about } : {}),
      atMs: Number(row.settled_at_ms ?? row.created_at_ms),
    };
  });
  const facts: SoftLayerFacts = {
    ...(acts.length ? { acts } : {}),
    ...(input.wardrobe ? { face: {
      current: currentWardrobe(db), available: [...input.wardrobe], ...(input.gameLive ? { followsGame: true as const } : {}),
    } } : {}),
  };
  // A waiting act stays to be shown again once it settles.
  const actIds = rows.filter((row) => row.status !== "queued" && row.status !== "claimed").map((row) => Number(row.act_id));
  return { facts, actIds };
}

export function markSoftActsShown(db: DatabaseSync, actIds: readonly number[], cycleId: string): void {
  const mark = db.prepare("UPDATE soft_acts SET shown_cycle_id = ? WHERE act_id = ? AND shown_cycle_id IS NULL");
  for (const actId of actIds) mark.run(cycleId, actId);
}

export function softClaimsOf(value: Partial<Record<SoftKind, unknown>>): SoftClaims {
  const claims: SoftClaims = {};
  for (const kind of SOFT_KINDS) {
    if (value[kind] !== undefined) (claims as Record<string, unknown>)[kind] = value[kind];
  }
  return claims;
}

export function isInterestFamily(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(INTEREST_FAMILIES, value);
}

export const ALL_INTEREST_ROOTS_COVERED = INTEREST_ROOTS.every((root) =>
  Object.values(INTEREST_FAMILIES).some((roots) => roots.includes(root)));
