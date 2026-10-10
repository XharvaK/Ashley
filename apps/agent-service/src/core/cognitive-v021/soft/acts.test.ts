import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../test-support.js";
import { readOpenQuietWindow } from "../quiet/window.js";
import {
  ALL_INTEREST_ROOTS_COVERED,
  CLAIM_TTL_MS,
  FACE_CHANGE_MS,
  PIN_CAP,
  claimSoftActs,
  currentWardrobe,
  isUnicodeEmoji,
  markSoftActsShown,
  recordSoftActs,
  reportSoftAct,
  softLayerForPass,
  SOFT_REASON_WORN_AT_WAKE,
  wardrobeAvailable,
  type SoftClaims,
} from "./acts.js";
import { softLayerView } from "./view.js";

const DM = "owner-dm-conversation";
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

function row(db: DatabaseSync, input: {
  rowId: string;
  role: "owner" | "ashley";
  text: string;
  ids: string[];
  conversationId?: string;
  location?: string;
}): void {
  db.prepare(
    `INSERT INTO conversation_evidence_log
       (row_id, lineage_id, version, conversation_id, role, text, created_at_ms, discord_message_ids_json,
        architecture_epoch, content_hash, source_status, data_classification, location_json)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'v0.2.1', 'hash', 'active', 'ordinary', ?)`,
  ).run(input.rowId, `lineage-${input.rowId}`, input.conversationId ?? DM, input.role, input.text, NOW - 60_000,
    JSON.stringify(input.ids), input.location ?? null);
}

let settlementSeq = 0;
function record(db: DatabaseSync, claims: SoftClaims, extra: { ownerTurn?: boolean; wardrobe?: string[]; nowMs?: number } = {}): void {
  settlementSeq += 1;
  recordSoftActs(db, {
    settlementId: `settlement-${settlementSeq}`,
    claims,
    context: { conversationId: DM, ownerTurn: extra.ownerTurn ?? true, ...(extra.wardrobe ? { wardrobe: extra.wardrobe } : {}), timeZone: "Etc/GMT-3" },
    nowMs: extra.nowMs ?? NOW,
  });
}

function acts(db: DatabaseSync): Array<{ kind: string; status: string; reason: string | null; request: Record<string, unknown> }> {
  return (db.prepare("SELECT kind, status, reason, request_json FROM soft_acts ORDER BY act_id").all() as Array<Record<string, unknown>>)
    .map((item) => ({
      kind: String(item.kind),
      status: String(item.status),
      reason: item.reason == null ? null : String(item.reason),
      request: JSON.parse(String(item.request_json)) as Record<string, unknown>,
    }));
}

describe("UX W2 soft acts", () => {
  it("knows a plain Unicode emoji from a custom one or text", () => {
    for (const emoji of ["😂", "❤️", "👍🏽", "🇹🇷", "1️⃣", "👩‍💻"]) expect(isUnicodeEmoji(emoji), emoji).toBe(true);
    for (const value of ["<:otter:123456789012345678>", "lol", ":otter:", "", "😂 ok"]) expect(isUnicodeEmoji(value), value).toBe(false);
  });

  it("a touch reacts on one Owner message of this DM and nothing else", () => {
    const db = openTestSidecar();
    row(db, { rowId: "o1", role: "owner", text: "look at this", ids: ["900"] });
    row(db, { rowId: "h1", role: "ashley", text: "mine", ids: ["901"] });
    row(db, { rowId: "r1", role: "owner", text: "in a room", ids: ["902"], conversationId: "room:1:2", location: "{\"kind\":\"room\"}" });
    record(db, { touch: { emoji: "😂", rowId: "o1", meaning: "landed" } });
    record(db, { touch: { emoji: "<:otter:123456789012345678>", rowId: "o1", meaning: "landed" } });
    record(db, { touch: { emoji: "😂", rowId: "h1", meaning: "this_bit" } });
    record(db, { touch: { emoji: "😂", rowId: "r1", meaning: "landed" } });
    record(db, { touch: { emoji: "😂", rowId: "missing", meaning: "landed" } });
    expect(acts(db).map((act) => [act.status, act.reason])).toEqual([
      ["queued", null],
      ["refused", "not_a_unicode_emoji"],
      ["refused", "not_an_owner_message"],
      ["refused", "not_owner_dm"],
      ["refused", "row_unknown"],
    ]);
    expect(acts(db)[0]!.request).toMatchObject({ kind: "touch", emoji: "😂", messageId: "900", meaning: "landed" });
  });

  it("did_it needs a page she actually opened from that message's link", () => {
    const db = openTestSidecar();
    row(db, { rowId: "o1", role: "owner", text: "read https://example.com/post please", ids: ["900"] });
    record(db, { touch: { emoji: "✅", rowId: "o1", meaning: "did_it" } });
    db.prepare(
      `INSERT INTO observations (observation_id, cycle_id, generation, modality, payload_json, provenance, data_classification, created_at_ms)
       VALUES ('obs-1', 'c1', 1, 'page', ?, 'page_fetch', 'ordinary', ?)`,
    ).run(JSON.stringify({ requestedUrl: "https://example.com/post" }), NOW - 1_000);
    record(db, { touch: { emoji: "✅", rowId: "o1", meaning: "did_it" } });
    expect(acts(db).map((act) => [act.status, act.reason])).toEqual([["refused", "did_it_without_receipt"], ["queued", null]]);
  });

  it("a correction edits one of her own bubbles, and names which when there are several", () => {
    const db = openTestSidecar();
    row(db, { rowId: "h1", role: "ashley", text: "one\n\ntwo", ids: ["901", "902"] });
    row(db, { rowId: "o1", role: "owner", text: "hi", ids: ["900"] });
    record(db, { correct: { rowId: "h1", text: "fixed" } });
    record(db, { correct: { rowId: "h1", bubble: 1, text: "fixed" } });
    record(db, { correct: { rowId: "o1", text: "fixed" } });
    expect(acts(db).map((act) => [act.status, act.reason, act.request.messageId ?? null])).toEqual([
      ["refused", "bubble_required", null],
      ["queued", null, "902"],
      ["refused", "not_her_message", null],
    ]);
  });

  it("a callback brings back the GIF from where a memory came from, as a reply to it", () => {
    const db = openTestSidecar();
    row(db, { rowId: "o1", role: "owner", text: "https://tenor.com/view/otter-spin-gif-1234567", ids: ["900"] });
    db.prepare(
      `INSERT INTO sidecar_memory_supports (support_id, assertion_key, source, provenance, source_architecture_epoch,
         source_ref, dimensions_json, data_classification, created_at_ms)
       VALUES ('s1', 'mem-joke', 'conversation', 'native', 'v0.2.1', 'o1', '{}', 'ordinary', ?)`,
    ).run(NOW);
    record(db, { callback: { memoryRef: "mem-joke" } });
    record(db, { callback: { memoryRef: "mem-none" } });
    record(db, { callback: { gifQuery: "otter spin" } });
    expect(acts(db).map((act) => [act.status, act.reason])).toEqual([["queued", null], ["refused", "no_gif_in_memory"], ["queued", null]]);
    expect(acts(db)[0]!.request).toMatchObject({ url: "https://tenor.com/view/otter-spin-gif-1234567", replyTo: "900" });
    expect(acts(db)[2]!.request).toMatchObject({ gifQuery: "otter spin" });
  });

  it("pins stay far below Discord's fifty", () => {
    const db = openTestSidecar();
    row(db, { rowId: "o1", role: "owner", text: "a moment", ids: ["900"] });
    for (let index = 0; index < PIN_CAP + 1; index += 1) record(db, { pin: { rowId: "o1" } });
    const statuses = acts(db).map((act) => act.status);
    expect(statuses.filter((status) => status === "queued")).toHaveLength(PIN_CAP);
    expect(acts(db).at(-1)).toMatchObject({ status: "refused", reason: "pin_cap" });
  });

  it("a face is one of the ids offered now, at most once a day", () => {
    const db = openTestSidecar();
    record(db, { face: { wardrobeId: "weather-snow" } }, { wardrobe: ["day-awake", "weather-rain"] });
    record(db, { face: { wardrobeId: "weather-rain" } }, { wardrobe: ["day-awake", "weather-rain"] });
    record(db, { face: { wardrobeId: "day-awake" } }, { wardrobe: ["day-awake", "weather-rain"], nowMs: NOW + 1_000 });
    record(db, { face: { wardrobeId: "day-awake" } }, { wardrobe: ["day-awake"], nowMs: NOW + FACE_CHANGE_MS + 1 });
    expect(acts(db).map((act) => [act.status, act.reason])).toEqual([
      ["refused", "not_available_now"], ["queued", null], ["refused", "once_a_day"], ["queued", null],
    ]);
  });

  it("a quiet window opens from the Owner's word only in the Owner's turn, or from her own, bounded the same way", () => {
    const db = openTestSidecar();
    record(db, { quiet: { forMs: 60 * 60_000, whose: "owner_asked" } }, { ownerTurn: false });
    expect(readOpenQuietWindow(db, NOW)).toBeNull();
    record(db, { quiet: { forMs: 60 * 60_000, whose: "her_own" } }, { ownerTurn: false });
    expect(readOpenQuietWindow(db, NOW)).toMatchObject({ source: "her_own", untilMs: NOW + 60 * 60_000 });
    // 01:00 local: never past the next 08:00.
    const lateNight = Date.UTC(2026, 9, 7, 22, 0, 0);
    record(db, { quiet: { forMs: 12 * 60 * 60_000, whose: "owner_asked" } }, { nowMs: lateNight });
    const window = readOpenQuietWindow(db, lateNight)!;
    expect(window.source).toBe("owner_command");
    expect(window.untilMs).toBe(lateNight + 7 * 60 * 60_000);
    expect(acts(db).map((act) => [act.status, act.reason])).toEqual([["refused", "owner_did_not_ask_this_turn"], ["done", null], ["done", null]]);
  });

  it("the bot claims, reports, and a claim never reported fails instead of being replayed", () => {
    const db = openTestSidecar();
    row(db, { rowId: "o1", role: "owner", text: "hi", ids: ["900"] });
    record(db, { touch: { emoji: "👍", rowId: "o1", meaning: "landed" } });
    record(db, { pin: { rowId: "o1" } });
    const claimed = claimSoftActs(db, NOW);
    expect(claimed.map((act) => act.request.kind)).toEqual(["touch", "pin"]);
    expect(claimed[0]!.request).not.toHaveProperty("about");
    expect(claimSoftActs(db, NOW)).toEqual([]);
    expect(reportSoftAct(db, { actId: claimed[0]!.actId, status: "refused", reason: "mirrors_their_emoji", nowMs: NOW })).toBe(true);
    expect(reportSoftAct(db, { actId: claimed[0]!.actId, status: "done", nowMs: NOW })).toBe(false);
    claimSoftActs(db, NOW + CLAIM_TTL_MS + 1);
    expect(acts(db).map((act) => [act.status, act.reason])).toEqual([["refused", "mirrors_their_emoji"], ["failed", "no_report"]]);
  });

  it("a face chosen asleep reports worn_at_wake, and a plain done carries no reason", () => {
    const db = openTestSidecar();
    row(db, { rowId: "o1", role: "owner", text: "hi", ids: ["900"] });
    record(db, { face: { wardrobeId: "day-awake" } }, { wardrobe: ["day-awake"] });
    const claimed = claimSoftActs(db, NOW);
    expect(reportSoftAct(db, { actId: claimed[0]!.actId, status: "done", reason: SOFT_REASON_WORN_AT_WAKE, nowMs: NOW })).toBe(true);
    expect(acts(db).map((act) => [act.status, act.reason])).toEqual([["done", SOFT_REASON_WORN_AT_WAKE]]);
  });

  it("her next pass sees what became of her acts once, and a waiting act until it settles", () => {
    const db = openTestSidecar();
    row(db, { rowId: "o1", role: "owner", text: "hi", ids: ["900"] });
    record(db, { touch: { emoji: "🙂", rowId: "o1", meaning: "landed" } });
    record(db, { face: { wardrobeId: "nope" } }, { wardrobe: ["day-awake"] });
    const first = softLayerForPass(db, { wardrobe: ["day-awake"] });
    expect(first.facts.acts?.map((fact) => [fact.kind, fact.status, fact.reason ?? null, fact.about ?? null])).toEqual([
      ["face", "refused", "not_available_now", "nope"],
      ["touch", "waiting", null, "🙂"],
    ]);
    expect(first.facts.face).toEqual({ current: "day-awake", available: ["day-awake"] });
    markSoftActsShown(db, first.actIds, "cycle-1");
    const second = softLayerForPass(db, {});
    expect(second.facts.acts?.map((fact) => fact.kind)).toEqual(["touch"]);
  });

  it("offers only faces whose art is there, and the day face always", () => {
    const db = openTestSidecar();
    const withArt = new Set(["avatar/weather-rain.png"]);
    expect(wardrobeAvailable(db, { sky: "rain", hasArt: (id) => withArt.has(`avatar/${id}.png`) })).toEqual(["day-awake", "weather-rain"]);
    expect(wardrobeAvailable(db, { sky: "snow", hasArt: () => false })).toEqual(["day-awake"]);
  });

  it("the wardrobe follows the sky and the interests she lived", () => {
    const db = openTestSidecar();
    expect(wardrobeAvailable(db, { sky: "clear", hasArt: () => true })).toEqual(["day-awake"]);
    expect(wardrobeAvailable(db, { sky: "thunder", hasArt: () => true })).toEqual(["day-awake", "weather-rain"]);
    const insert = db.prepare(
      "INSERT INTO interest_branches (branch_id, root, label, origin, lived_count, created_at_ms) VALUES (?, ?, ?, 'ashley', ?, 0)",
    );
    insert.run("w2-food", "Food & cooking", "slow soups", 4);
    insert.run("w2-photo", "Photography", "film", 5);
    expect(wardrobeAvailable(db, { sky: "snow", hasArt: () => true })).toEqual(["day-awake", "weather-snow", "interest-screens"]);
    insert.run("w2-food-2", "Food & cooking", "bread", 7);
    expect(wardrobeAvailable(db, { sky: null, hasArt: () => true })).toEqual(["day-awake", "interest-screens", "interest-outside"]);
    expect(currentWardrobe(db)).toBe("day-awake");
    expect(ALL_INTEREST_ROOTS_COVERED).toBe(true);
  });

  it("the quiet window's facts reach her beside her soft acts", () => {
    expect(softLayerView({})).toBeUndefined();
    expect(softLayerView({
      quietRefusal: { code: "quiet_held", atMs: 5 },
      heldWhileQuiet: { count: 1, items: ["a"], droppedCount: 0 },
      softLayer: { acts: [{ kind: "pin", status: "done", atMs: 6 }] },
    })).toEqual({
      acts: [{ kind: "pin", status: "done", atMs: 6 }],
      quiet: { refused: { code: "quiet_held", atMs: 5 }, held: { count: 1, items: ["a"], droppedCount: 0 } },
    });
  });
});
