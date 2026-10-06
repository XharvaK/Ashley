import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { admitObservation, observationDigest, upsertHeartbeat } from "./store.js";
import {
  configureEmbodimentBudget, DOMUS_LESSONS_BYTES, DOMUS_LESSONS_MAX, domusForThought, domusLessonsFor, domusSceneTerms,
  selectDomusNotification,
} from "./notification.js";

const NOW = 10_000_000;
const CONVERSATION = "owner-thread";

function insertAssertion(db: DatabaseSync, input: {
  key: string; statement: string; channel: string; live?: number; classification?: string; kind?: string;
}) {
  db.prepare(`INSERT INTO sidecar_memory_assertions(
      assertion_key, statement, memory_kind, dimensions_json, data_classification, live, content_hash, channel, lineage_class)
    VALUES(?, ?, ?, '{}', ?, ?, ?, ?, 'current')`)
    .run(input.key, input.statement, input.kind ?? "lesson", input.classification ?? "personal", input.live ?? 1, `hash-${input.key}`, input.channel);
}

function insertSupport(db: DatabaseSync, input: { id: string; key: string; channel: string }) {
  db.prepare(`INSERT INTO sidecar_memory_supports(
      support_id, assertion_key, source, provenance, source_architecture_epoch, dimensions_json, data_classification, created_at_ms, channel, lineage_class)
    VALUES(?, ?, 'game', 'observed', 'v0', '{}', 'personal', ?, ?, 'current')`)
    .run(input.id, input.key, NOW, input.channel);
}

describe("M3b her lessons", () => {
  it("returns a live domus memory whose words match the scene", () => {
    const db = openTestSidecar();
    try {
      insertAssertion(db, { key: "stew", statement: "Eating the old stew made me sick", channel: "domus:slot1" });
      insertSupport(db, { id: "s1", key: "stew", channel: "domus:slot1" });
      expect(domusLessonsFor(db, "slot1", new Set(["stew"]))).toEqual([
        { key: "stew", lesson: "Eating the old stew made me sick", kind: "lesson", seen: 1 },
      ]);
    } finally { db.close(); }
  });

  it("drops a memory that any discord support touches", () => {
    const db = openTestSidecar();
    try {
      insertAssertion(db, { key: "stew", statement: "Eating the old stew made me sick", channel: "domus:slot1" });
      insertSupport(db, { id: "s1", key: "stew", channel: "domus:slot1" });
      insertSupport(db, { id: "s2", key: "stew", channel: "discord" });
      expect(domusLessonsFor(db, "slot1", new Set(["stew"]))).toEqual([]);
    } finally { db.close(); }
  });

  it("ignores a discord-channel memory and a memory from another world", () => {
    const db = openTestSidecar();
    try {
      insertAssertion(db, { key: "chat", statement: "Eating the old stew made me sick", channel: "discord" });
      insertSupport(db, { id: "s1", key: "chat", channel: "discord" });
      insertAssertion(db, { key: "other", statement: "Eating the old stew made me sick", channel: "domus:slot2" });
      insertSupport(db, { id: "s2", key: "other", channel: "domus:slot2" });
      expect(domusLessonsFor(db, "slot1", new Set(["stew"]))).toEqual([]);
    } finally { db.close(); }
  });

  it("ignores a dead memory and a secret", () => {
    const db = openTestSidecar();
    try {
      insertAssertion(db, { key: "dead", statement: "Eating the old stew made me sick", channel: "domus:slot1", live: 0 });
      insertSupport(db, { id: "s1", key: "dead", channel: "domus:slot1" });
      insertAssertion(db, { key: "hid", statement: "Eating the old stew made me sick", channel: "domus:slot1", classification: "secret" });
      insertSupport(db, { id: "s2", key: "hid", channel: "domus:slot1" });
      expect(domusLessonsFor(db, "slot1", new Set(["stew"]))).toEqual([]);
    } finally { db.close(); }
  });

  it("orders by matching words, caps the count, cuts long statements, and stays within the byte budget", () => {
    const db = openTestSidecar();
    try {
      insertAssertion(db, { key: "b-none", statement: "Nothing about the kitchen here", channel: "domus:slot1" });
      insertSupport(db, { id: "sn", key: "b-none", channel: "domus:slot1" });
      insertAssertion(db, { key: "a-match", statement: "The stew pot burned the soup", channel: "domus:slot1" });
      insertSupport(db, { id: "sm", key: "a-match", channel: "domus:slot1" });
      const ordered = domusLessonsFor(db, "slot1", new Set(["stew", "soup"]));
      expect(ordered.map(item => item.key)).toEqual(["a-match", "b-none"]);

      for (let index = 0; index < 7; index++) {
        const key = `n${index}`;
        insertAssertion(db, { key, statement: `Plain note number ${index} about walking`, channel: "domus:slot1" });
        insertSupport(db, { id: `sn${index}`, key, channel: "domus:slot1" });
      }
      const capped = domusLessonsFor(db, "slot1", new Set(["stew", "soup"]));
      expect(capped).toHaveLength(DOMUS_LESSONS_MAX);
      expect(capped[0]!.key).toBe("a-match");

      const long = "L".repeat(400);
      insertAssertion(db, { key: "long", statement: long, channel: "domus:slot1" });
      insertSupport(db, { id: "sl", key: "long", channel: "domus:slot1" });
      const cut = domusLessonsFor(db, "slot1", new Set(["llll"]));
      const found = cut.find(item => item.key === "long") ?? cut[0];
      expect(found!.lesson.length).toBeLessThanOrEqual(300);
      expect(Buffer.byteLength(JSON.stringify(cut))).toBeLessThanOrEqual(DOMUS_LESSONS_BYTES);

      db.prepare("DELETE FROM sidecar_memory_supports").run();
      db.prepare("DELETE FROM sidecar_memory_assertions").run();
      for (let index = 0; index < 5; index++) {
        const key = `fat${index}`;
        insertAssertion(db, { key, statement: "Z".repeat(300), channel: "domus:slot1" });
        insertSupport(db, { id: `sf${index}`, key, channel: "domus:slot1" });
      }
      const trimmed = domusLessonsFor(db, "slot1", new Set());
      expect(trimmed.every(item => item.lesson.length === 300)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(trimmed))).toBeLessThanOrEqual(DOMUS_LESSONS_BYTES);
      expect(trimmed.length).toBeLessThan(5);
    } finally { db.close(); }
  });

  it("reads scene words from what she is doing, feeling, and being asked", () => {
    const terms = domusSceneTerms({
      portrait: {
        running: ["fridge_Grab_Snack"],
        moodlets: [{ text: "Queasy", reason: "From Eating Spoiled Food" }],
      },
    });
    for (const word of ["fridge", "grab", "snack", "queasy", "spoiled", "food"]) expect(terms.has(word)).toBe(true);
    expect(terms.has("from")).toBe(false);
    expect(terms.has("the")).toBe(false);
  });

  it("attaches lessons to a bound pass and omits the key when she has none", () => {
    const db = openTestSidecar();
    try {
      configureEmbodimentBudget(db, { limit: 5, version: 1 });
      upsertHeartbeat(db, { helperSession: "helper-a", receivedAtMs: NOW - 1000, sentAtMs: NOW - 1000,
        json: JSON.stringify({ v: 1, helper_session: "helper-a", sent_at_ms: NOW - 1000, attached: true }) });
      const observationId = "helper-a.1";
      const receiptTimeMs = NOW - 59_000;
      const payload = {
        v: 1, observation_id: observationId, world: "slot1", branch: "g1", session: "s1", attachment: "helper-a",
        body: "sim1", snapshot: "1", seq: 1, source_time_ms: receiptTimeMs - 500, expires_at_ms: receiptTimeMs + 600_000,
        lineage_class: "CURRENT",
        percepts: [{ kind: "need", salience: 0.4, facts: { subject: "hunger", object: "low", urgency: "wake" } }],
        portrait: { mood: "Fine" },
      };
      admitObservation(db, {
        observationId, digest: observationDigest(payload), world: "slot1", branch: "g1", session: "s1", attachment: "helper-a",
        body: "sim1", snapshot: "1", seq: 1, sourceTimeMs: payload.source_time_ms, expiresAtMs: payload.expires_at_ms,
        receiptTimeMs, lineageClass: "CURRENT", payloadJson: JSON.stringify(payload),
      });
      const selected = selectDomusNotification(db, {
        observationId, conversationId: CONVERSATION, ownerId: "owner", authorityEpoch: 1, nowMs: NOW, bind: () => {},
      });
      if (selected.kind !== "selected") throw new Error("not selected");
      const empty = domusForThought(db, selected.event);
      expect(empty.lessons).toBeUndefined();
      insertAssertion(db, { key: "stew", statement: "Eating the old stew made me sick", channel: "domus:slot1" });
      insertSupport(db, { id: "s1", key: "stew", channel: "domus:slot1" });
      const view = domusForThought(db, selected.event);
      expect(view.lessons).toEqual([{ key: "stew", lesson: "Eating the old stew made me sick", kind: "lesson", seen: 1 }]);
    } finally { db.close(); }
  });
});
