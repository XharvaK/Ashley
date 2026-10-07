import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../test-support.js";
import {
  KEPT_THINKING_GUIDANCE,
  constrainThoughtOutputSchema,
  thoughtContractProfile,
  thoughtOutputCompatibilityInstruction,
  type ThoughtContractProfileSource,
} from "./output-contract.js";
import { parseThoughtSemanticOutput } from "./parse.js";
import { returningForThought, returningFromRows, type ExchangeRow } from "./owner-surface.js";
import { replyToMessageIdFor } from "../delivery/pending.js";
import { domusGameNow } from "../../domus/notification.js";
import { admitObservation, observationDigest, upsertHeartbeat } from "../../domus/store.js";
import { readPresencePhase } from "../initiative/presence-phase.js";
import { softLayerForPass } from "../soft/acts.js";
import type { OperationalEffectNamespace } from "../effect/effect-ref.js";

const chat: ThoughtContractProfileSource = { trigger: { kind: "owner_message" } };
const pass = (kind: string): ThoughtContractProfileSource => ({ trigger: { kind: "idle_opportunity" }, innerPass: { kind } });
const DM = "owner-dm-conversation";
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const HOUR = 60 * 60_000;

function draftFields(source: ThoughtContractProfileSource): string[] {
  const namespace = { allowedOperationalEffectRefs: [], fingerprint: "sha256:test" } as unknown as OperationalEffectNamespace;
  const schema = constrainThoughtOutputSchema(namespace, thoughtContractProfile(source)).schema as {
    oneOf: Array<{ properties: Record<string, { oneOf?: Array<{ properties: Record<string, unknown> }> }> }>;
  };
  const draft = schema.oneOf[0]!.properties.speech!.oneOf!.find((form) => (form.properties.mode as { const?: string }).const === "draft")!;
  return Object.keys(draft.properties);
}

function evidence(db: DatabaseSync, input: { rowId: string; role: "owner" | "ashley"; text: string; atMs: number; ids?: string[]; conversationId?: string; status?: string }): void {
  db.prepare(
    `INSERT INTO conversation_evidence_log
       (row_id, lineage_id, version, conversation_id, role, text, created_at_ms, discord_message_ids_json,
        architecture_epoch, content_hash, source_status, data_classification)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'v0.2.1', 'hash', ?, 'ordinary')`,
  ).run(input.rowId, `lineage-${input.rowId}`, input.conversationId ?? DM, input.role, input.text, input.atMs,
    JSON.stringify(input.ids ?? []), input.status ?? "active");
}

function gameEpisode(db: DatabaseSync, id: string, endedAtMs: number, channel = "domus:slot0"): void {
  db.prepare(`INSERT INTO episodes_v2
    (episode_id, conversation_id, cycle_id, started_at_ms, ended_at_ms, evidence_row_ids_json, summary, salience,
     unresolved_threads_json, data_classification, created_at_ms, channel)
    VALUES (?, ?, 'cycle', ?, ?, '[]', 'an invented stretch of play', 0.5, '[]', 'ordinary', ?, ?)`)
    .run(id, DM, endedAtMs - HOUR, endedAtMs, endedAtMs, channel);
}

function liveGame(db: DatabaseSync, mood: string | null, input: { attached?: boolean; receivedAtMs?: number } = {}): void {
  const session = "helper-a";
  upsertHeartbeat(db, { helperSession: session, receivedAtMs: input.receivedAtMs ?? NOW - 1000, sentAtMs: NOW - 1000,
    json: JSON.stringify({ v: 1, helper_session: session, sent_at_ms: NOW - 1000, attached: input.attached ?? true }) });
  const payload = {
    v: 1, observation_id: "helper-a.1", world: "slot0", branch: "g1", session: "s1", attachment: session, body: "sim1", snapshot: "1",
    seq: 1, source_time_ms: NOW - 30_000, expires_at_ms: NOW + 500_000, lineage_class: "CURRENT",
    percepts: [{ kind: "need", salience: 0.4, facts: {} }],
    portrait: mood === null ? { place: "home" } : { mood },
  };
  admitObservation(db, {
    observationId: payload.observation_id, digest: observationDigest(payload), world: "slot0", branch: "g1", session: "s1",
    attachment: session, body: "sim1", snapshot: "1", seq: 1, sourceTimeMs: payload.source_time_ms, expiresAtMs: payload.expires_at_ms,
    receiptTimeMs: NOW - 29_000, lineageClass: "CURRENT", payloadJson: JSON.stringify(payload),
  });
}

describe("UX W3 kept thinking", () => {
  it("a reply to an earlier message is offered in the Owner's DM passes only, with its guidance", () => {
    for (const source of [chat, pass("awake"), pass("afterglow")]) expect(draftFields(source)).toContain("replyTo");
    for (const source of [{ ...chat, audience: { kind: "room" } }, { trigger: { kind: "domus_notification" } }, pass("night")]) {
      expect(draftFields(source)).not.toContain("replyTo");
    }
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile(pass("awake")))).toContain(KEPT_THINKING_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile({ ...chat, audience: { kind: "room" } }))).not.toContain(KEPT_THINKING_GUIDANCE);
  });

  it("parses speech.replyTo and names it when it is wrong", () => {
    const settle = (speech: Record<string, unknown>) =>
      parseThoughtSemanticOutput({ kind: "settlement", speech, durableNominations: [] }, new Set());
    expect(settle({ mode: "draft", surfaceDraft: "found it", replyTo: "row-1" }).ok).toBe(true);
    expect(settle({ mode: "draft", surfaceDraft: "found it", replyTo: "" })).toMatchObject({ ok: false, field: "speech.replyTo" });
    expect(settle({ mode: "draft", surfaceDraft: "found it", replyTo: 7 })).toMatchObject({ ok: false, field: "speech.replyTo" });
  });

  it("returning counts her messages since the Owner's last one", () => {
    const rows: ExchangeRow[] = [
      { rowId: "o1", role: "owner", text: "off to the gym", atMs: NOW - 5 * HOUR },
      { rowId: "a1", role: "ashley", text: "have fun", atMs: NOW - 5 * HOUR + 1000 },
      { rowId: "a2", role: "ashley", text: "which gym was it?", atMs: NOW - 4 * HOUR },
      { rowId: "o2", role: "owner", text: "back, it went well", atMs: NOW },
    ];
    expect(returningFromRows({ mode: "owner_message", rows, currentRowId: "o2", nowMs: NOW }))
      .toEqual({ sinceOwnerLastMs: 5 * HOUR, lastExchangeEnd: "her_open_question", herSince: 2 });
    expect(returningFromRows({ mode: "afterglow", rows: rows.slice(0, 3), nowMs: NOW }))
      .toEqual({ sinceOwnerLastMs: 5 * HOUR, lastExchangeEnd: "her_open_question", herSince: 2 });
    expect(returningFromRows({ mode: "afterglow", rows: rows.slice(0, 1), nowMs: NOW })).not.toHaveProperty("herSince");
  });

  it("returning names the game stretches that ended in the gap", () => {
    const db = openTestSidecar();
    evidence(db, { rowId: "o1", role: "owner", text: "brb", atMs: NOW - 6 * HOUR });
    evidence(db, { rowId: "o2", role: "owner", text: "back again now", atMs: NOW });
    gameEpisode(db, "before", NOW - 7 * HOUR);
    gameEpisode(db, "during-1", NOW - 3 * HOUR);
    gameEpisode(db, "during-2", NOW - HOUR);
    gameEpisode(db, "talk", NOW - 2 * HOUR, "discord");
    expect(returningForThought(db, { mode: "owner_message", conversationId: DM, currentRowId: "o2", nowMs: NOW }))
      .toEqual({ sinceOwnerLastMs: 6 * HOUR, lastExchangeEnd: "owner_brb", playedMeanwhile: 2 });
  });

  it("her first message replies only to a row of the same conversation that is still on Discord", () => {
    const db = openTestSidecar();
    evidence(db, { rowId: "r1", role: "owner", text: "what do otters eat?", atMs: NOW - HOUR, ids: ["123456789012"] });
    evidence(db, { rowId: "r2", role: "owner", text: "elsewhere", atMs: NOW - HOUR, ids: ["223456789012"], conversationId: "room:other" });
    evidence(db, { rowId: "r3", role: "owner", text: "forgotten", atMs: NOW - HOUR, ids: ["323456789012"], status: "redacted" });
    const outbox = (replyTo?: string) => ({ conversationId: DM, deliveryIntent: { ...(replyTo ? { rhythm: { replyTo } } : {}) } }) as never;
    expect(replyToMessageIdFor(db, outbox("r1"))).toBe("123456789012");
    expect(replyToMessageIdFor(db, outbox("r2"))).toBeUndefined();
    expect(replyToMessageIdFor(db, outbox("r3"))).toBeUndefined();
    expect(replyToMessageIdFor(db, outbox("nope"))).toBeUndefined();
    expect(replyToMessageIdFor(db, outbox())).toBeUndefined();
  });
});

describe("UX W3 the live game on her face and status", () => {
  it("reads the game as live only while attached, with her Sim's mood in the game's own name", () => {
    const db = openTestSidecar();
    expect(domusGameNow(db, NOW)).toBeUndefined();
    liveGame(db, "Mood_Stressed");
    expect(domusGameNow(db, NOW)).toEqual({ live: true, mood: "Mood_Stressed" });
    expect(domusGameNow(db, NOW + 10 * 60_000)).toBeUndefined();
    const detached = openTestSidecar();
    liveGame(detached, "Mood_Happy", { attached: false });
    expect(domusGameNow(detached, NOW)).toBeUndefined();
    const moodless = openTestSidecar();
    liveGame(moodless, null);
    expect(domusGameNow(moodless, NOW)).toEqual({ live: true, mood: null });
  });

  it("the presence report carries the game, and her wardrobe says her face follows it", () => {
    const db = openTestSidecar();
    const nuclear = openTestSidecar();
    nuclear.exec("CREATE TABLE IF NOT EXISTS mem_threads (id TEXT, owner_id TEXT, status TEXT, updated_at INTEGER)");
    expect(readPresencePhase({ sidecar: db, nuclear, ownerId: "owner", nowMs: NOW, healthy: true })).not.toHaveProperty("game");
    liveGame(db, "Mood_Happy");
    expect(readPresencePhase({ sidecar: db, nuclear, ownerId: "owner", nowMs: NOW, healthy: true }).game)
      .toEqual({ live: true, mood: "Mood_Happy" });
    expect(softLayerForPass(db, { wardrobe: ["day-awake"], gameLive: true }).facts.face).toMatchObject({ followsGame: true });
    expect(softLayerForPass(db, { wardrobe: ["day-awake"] }).facts.face).not.toHaveProperty("followsGame");
  });
});
