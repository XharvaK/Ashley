import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar, makeThoughtDraft } from "../test-support.js";
import { publishSemanticTransaction } from "../settlement/publish.js";
import { tickAdmission } from "./admission.js";
import { admitOwnerSuppliedClaim } from "./admission.js";
import { appendRememberRequest } from "./nomination.js";
import { appendOwnerUtterance, appendAshleyEvidence } from "../evidence/conversation-log.js";
import type { DurableNomination, ThoughtSettlementDraft } from "../types.js";

function nomination(overrides: Partial<DurableNomination> = {}): DurableNomination {
  return {
    nominationId: "nomination-1",
    cycleId: "cycle-1",
    generation: 1,
    assertionKey: "owner:subject",
    statement: "The owner prefers the first subject.",
    memoryKind: "owner_world_claim",
    dimensions: {
      source: "owner_utterance",
      status: "asserted",
      time: "current",
      reliability: "owner_supplied",
    },
    dataClassification: "never_public",
    supersedesAssertionKey: null,
    concernId: null,
    sourceRefs: ["owner-1"],
    ...overrides,
  };
}

function insertConsumedObservations(
  db: Parameters<typeof tickAdmission>[0],
  cycleId: string,
  generation: number,
  observationIds: readonly string[],
): void {
  for (const observationId of new Set(observationIds)) {
    db.prepare(
      `INSERT OR IGNORE INTO observations
         (observation_id, cycle_id, generation, derived, replay_safe, modality,
          payload_json, provenance, data_classification, secret_omitted, created_at_ms)
       VALUES (?, ?, ?, 0, 1, 'text', ?, 'test:memory-admission', 'ordinary', 0, 0)`,
    ).run(
      observationId,
      cycleId,
      generation,
      JSON.stringify({ fixture: "memory-admission" }),
    );
  }
}

function publishNomination(
  db: Parameters<typeof tickAdmission>[0],
  input: DurableNomination,
  settlementId: string,
  options: {
    operations?: Partial<ThoughtSettlementDraft["operations"]>;
    currentness?: import("../types.js").AuthorityPacks["currentness"];
  } = {},
): void {
  const draft = makeThoughtDraft({
    cycleId: input.cycleId,
    generation: input.generation,
    operations: {
      ...makeThoughtDraft().operations,
      observationsConsumed: options.operations?.observationsConsumed ?? ["obs-default"],
      ...options.operations,
    },
    speech: {
      mode: "none",
      mustSay: [],
      mustNot: [],
      surfaceDraft: null,
      acceptableRealizations: [],
      presentationDirectives: [],
    },
    durableNominations: [input],
  });
  insertConsumedObservations(
    db,
    input.cycleId,
    input.generation,
    draft.operations.observationsConsumed,
  );
  publishSemanticTransaction(db, {
    ...draft,
    settlementId,
    speech: { ...draft.speech, finalLicensedText: null },
  }, {
    currentness: options.currentness !== undefined ? options.currentness : {
      requireObservationForLatest: false,
      binding: {
        barrierId: "global",
        barrierEpoch: 1,
        barrierRevision: 1,
        ownerVersions: { nuclear: 1, continuity: 1, cognitive_sidecar: 1 },
      },
      complete: true,
      observedObservationIds: ["obs-default"],
    },
  });
}

describe("v0.2.1 fenced Memory admission", () => {
  it("admits queued nominations only when the admission worker runs", () => {
    const db = openTestSidecar();
    try {
      const ev = appendOwnerUtterance(db, { conversationId: "thread-1", text: "I prefer the first subject", discordMessageIds: ["m1"], nowMs: 1 });
      admitTestCycle(db, {
        cycleId: "cycle-1",
        conversationId: "thread-1",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: ev.rowId,
        occupantId: "doc",
        nowMs: 1,
      });
      publishNomination(db, nomination({ sourceRefs: [ev.rowId] }), "settlement-1");
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });

      const result = tickAdmission(db, { nowMs: 2 });
      expect(result.admitted).toBe(1);
      expect(db.prepare("SELECT statement, live, admitted_generation FROM sidecar_memory_assertions").get()).toMatchObject({
        statement: "The owner prefers the first subject.",
        live: 1,
        admitted_generation: 1,
      });
      expect(db.prepare("SELECT provenance, source FROM sidecar_memory_supports").get()).toMatchObject({ provenance: "native", source: "owner_utterance" });
      expect(tickAdmission(db, { nowMs: 3 }).admitted).toBe(0);
    } finally {
      db.close();
    }
  });

  it("skips an older nomination when a later published generation supersedes it", () => {
    const db = openTestSidecar();
    try {
      const ev1 = appendOwnerUtterance(db, { conversationId: "thread-1", text: "Old claim", discordMessageIds: ["m1"], nowMs: 1 });
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: ev1.rowId, occupantId: "doc", nowMs: 1 });
      publishNomination(db, nomination({ nominationId: "nomination-old", cycleId: "cycle-1", generation: 1, statement: "The old claim.", sourceRefs: [ev1.rowId] }), "settlement-old");
      const ev2 = appendOwnerUtterance(db, { conversationId: "thread-1", text: "New claim", discordMessageIds: ["m2"], nowMs: 2 });
      admitTestCycle(db, { cycleId: "cycle-2", conversationId: "thread-1", generation: 2, triggerKind: "owner_message", triggerRef: ev2.rowId, occupantId: "doc", nowMs: 2 });
      publishNomination(db, nomination({ nominationId: "nomination-new", cycleId: "cycle-2", generation: 2, statement: "The corrected claim.", supersedesAssertionKey: "owner:subject", sourceRefs: [ev2.rowId] }), "settlement-new");

      const result = tickAdmission(db, { nowMs: 3 });
      expect(result.skippedSuperseded).toBe(1);
      expect(db.prepare("SELECT result FROM admission_log WHERE nomination_id = 'nomination-old' ORDER BY id DESC LIMIT 1").get()).toMatchObject({ result: "admission_skipped_superseded" });
      expect(db.prepare("SELECT assertion_key, statement, live, lineage_parent_key FROM sidecar_memory_assertions").all()).toEqual([
        expect.objectContaining({ assertion_key: "owner:subject", statement: "The corrected claim.", live: 1, lineage_parent_key: "owner:subject" }),
      ]);
    } finally {
      db.close();
    }
  });

  it("does not promote repeated inferred support to owner supplied", () => {
    const db = openTestSidecar();
    try {
      const ev1 = appendOwnerUtterance(db, { conversationId: "thread-1", text: "Claim 1", discordMessageIds: ["m1"], nowMs: 1 });
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", generation: 1, triggerKind: "owner_message", triggerRef: ev1.rowId, occupantId: "doc", nowMs: 1 });
      const inferred = nomination({
        memoryKind: "ashley_interpretation",
        dimensions: { source: "ashley_interpretation", status: "interpreted", time: "current", reliability: "inferred" },
        sourceRefs: [ev1.rowId],
      });
      publishNomination(db, inferred, "settlement-1");
      const ev2 = appendOwnerUtterance(db, { conversationId: "thread-1", text: "Claim 2", discordMessageIds: ["m2"], nowMs: 2 });
      admitTestCycle(db, { cycleId: "cycle-2", conversationId: "thread-1", generation: 2, triggerKind: "owner_message", triggerRef: ev2.rowId, occupantId: "doc", nowMs: 2 });
      publishNomination(db, { ...inferred, nominationId: "nomination-2", cycleId: "cycle-2", generation: 2, sourceRefs: [ev2.rowId] }, "settlement-2");
      tickAdmission(db, { nowMs: 3 });
      expect(db.prepare("SELECT json_extract(dimensions_json, '$.reliability') AS reliability FROM sidecar_memory_assertions").get()).toMatchObject({ reliability: "inferred" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_supports").get()).toMatchObject({ count: 2 });
    } finally {
      db.close();
    }
  });

  it("admits an explicit owner claim only after its published Thought nomination", () => {
    const db = openTestSidecar();
    try {
      const request = appendRememberRequest(db, { conversationId: "thread-1", text: "Remember that I prefer careful systems.", discordMessageIds: ["remember-1"], nowMs: 2 });
      const cycle = db.prepare(
        "SELECT cycle_id, generation FROM cycle_records WHERE wake_id = ?",
      ).get(request.inbox.wakeId) as { cycle_id: string; generation: number };
      const remembered = nomination({
        nominationId: "nomination-remember",
        cycleId: cycle.cycle_id,
        generation: cycle.generation,
        assertionKey: "owner:careful-systems",
        statement: "The owner prefers careful systems.",
        memoryKind: "owner_preference",
        sourceRefs: [request.evidence.rowId],
      });
      publishNomination(db, remembered, "settlement-remember");
      expect(admitOwnerSuppliedClaim(db, { settlementId: "settlement-remember", nominationId: remembered.nominationId, evidence: request.evidence, nowMs: 3 })).toMatchObject({ result: "admitted" });
      expect(db.prepare("SELECT memory_kind FROM sidecar_memory_assertions WHERE assertion_key = 'owner:careful-systems'").get()).toMatchObject({ memory_kind: "owner_preference" });
      const inbox = db.prepare("SELECT payload_json FROM inbox_events WHERE id = ?").get(request.inbox.id) as { payload_json: string };
      expect(inbox.payload_json).not.toContain("Remember that I prefer careful systems.");
    } finally {
      db.close();
    }
  });

  it("keeps credential-shaped remember content as an omitted, non-admitted reference", () => {
    const db = openTestSidecar();
    try {
      const request = appendRememberRequest(db, { conversationId: "thread-1", text: "Remember api-key: abcdefghijklmnopqrstuvwxyz123456", discordMessageIds: ["remember-secret"], nowMs: 1 });
      expect(request.evidence).toMatchObject({ text: "[credential omitted]", dataClassification: "secret", secretOmitted: true });
      expect(request.inbox.payload).toEqual(expect.objectContaining({ rememberRequested: true, evidenceRowId: request.evidence.rowId }));
      expect(JSON.stringify(request.inbox.payload)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
      expect(db.prepare("SELECT COUNT(*) AS count FROM durable_nominations").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  describe("v0.2.1 B0 write-side provenance and currentness verification", () => {
    it("admits candidate when valid owner evidence and structured currentness entitlement exist", () => {
      const db = openTestSidecar();
      try {
        const ev = appendOwnerUtterance(db, { conversationId: "thread-v", text: "I like TypeScript", discordMessageIds: ["m-v"], nowMs: 1 });
        admitTestCycle(db, { cycleId: "cycle-v", conversationId: "thread-v", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 1 });
        const nom = nomination({ cycleId: "cycle-v", generation: 1, sourceRefs: [ev.rowId] });
        publishNomination(db, nom, "settlement-v", {
          operations: { observationsConsumed: ["obs-exact"] },
          currentness: {
            requireObservationForLatest: false,
            binding: { barrierId: "global", barrierEpoch: 1, barrierRevision: 1, ownerVersions: { nuclear: 1, continuity: 1, cognitive_sidecar: 1 } },
            complete: true,
            observedObservationIds: ["obs-exact"],
          },
        });
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(1);
        expect(result.results[0]?.result).toBe("admitted");
      } finally { db.close(); }
    });

    it("refuses admission with admission_skipped_provenance when binding.complete is false", () => {
      const db = openTestSidecar();
      try {
        const ev = appendOwnerUtterance(db, { conversationId: "thread-bcf", text: "I like TypeScript", discordMessageIds: ["m-bcf"], nowMs: 1 });
        admitTestCycle(db, { cycleId: "cycle-bcf", conversationId: "thread-bcf", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 1 });
        const nom = nomination({ cycleId: "cycle-bcf", generation: 1, dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, sourceRefs: [ev.rowId] });
        publishNomination(db, nom, "settlement-bcf", {
          operations: { observationsConsumed: ["obs-1"] },
          currentness: {
            requireObservationForLatest: false,
            binding: { barrierId: "global", barrierEpoch: 1, barrierRevision: 1, ownerVersions: { nuclear: 1, continuity: 1, cognitive_sidecar: 1 } },
            complete: false,
            observedObservationIds: ["obs-1"],
          },
        });
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(0);
        expect(result.skippedProvenance).toBe(1);
        expect(result.results[0]?.result).toBe("admission_skipped_provenance");
        expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
      } finally { db.close(); }
    });

    it("refuses admission with admission_skipped_provenance when observationsConsumed does not intersect observedObservationIds", () => {
      const db = openTestSidecar();
      try {
        const ev = appendOwnerUtterance(db, { conversationId: "thread-noi", text: "I like TypeScript", discordMessageIds: ["m-noi"], nowMs: 1 });
        admitTestCycle(db, { cycleId: "cycle-noi", conversationId: "thread-noi", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 1 });
        const nom = nomination({ cycleId: "cycle-noi", generation: 1, dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, sourceRefs: [ev.rowId] });
        publishNomination(db, nom, "settlement-noi", {
          operations: { observationsConsumed: ["obs-consumed"] },
          currentness: {
            requireObservationForLatest: false,
            binding: { barrierId: "global", barrierEpoch: 1, barrierRevision: 1, ownerVersions: { nuclear: 1, continuity: 1, cognitive_sidecar: 1 } },
            complete: true,
            observedObservationIds: ["obs-different"],
          },
        });
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(0);
        expect(result.skippedProvenance).toBe(1);
        expect(result.results[0]?.result).toBe("admission_skipped_provenance");
        expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
      } finally { db.close(); }
    });

    it("refuses admission with admission_skipped_provenance when same cycle / valid owner evidence exists BUT no observation intersection", () => {
      const db = openTestSidecar();
      try {
        const ev = appendOwnerUtterance(db, { conversationId: "thread-sc", text: "active turn", discordMessageIds: ["m-sc"], nowMs: 10 });
        admitTestCycle(db, { cycleId: "cycle-sc", conversationId: "thread-sc", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 10 });
        const nom = nomination({
          cycleId: "cycle-sc",
          generation: 1,
          dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
          sourceRefs: [ev.rowId],
        });
        // Same cycle, valid owner evidence, but no observation consumed
        publishNomination(db, nom, "settlement-sc", {
          operations: { observationsConsumed: [] },
          currentness: {
            requireObservationForLatest: false,
            binding: { barrierId: "global", barrierEpoch: 1, barrierRevision: 1, ownerVersions: { nuclear: 1, continuity: 1, cognitive_sidecar: 1 } },
            complete: true,
            observedObservationIds: ["obs-unconsumed"],
          },
        });
        const result = tickAdmission(db, { nowMs: 11 });
        expect(result.admitted).toBe(0);
        expect(result.skippedProvenance).toBe(1);
        expect(result.results[0]?.result).toBe("admission_skipped_provenance");
        expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
      } finally { db.close(); }
    });

    it("refuses admission with admission_skipped_provenance when evidence is missing", () => {
      const db = openTestSidecar();
      try {
        admitTestCycle(db, { cycleId: "cycle-m", conversationId: "thread-m", generation: 1, triggerKind: "owner_message", triggerRef: "ev-trigger", occupantId: "doc", nowMs: 1 });
        const nom = nomination({ cycleId: "cycle-m", generation: 1, sourceRefs: ["ev-nonexistent"] });
        publishNomination(db, nom, "settlement-m");
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(0);
        expect(result.skippedProvenance).toBe(1);
        expect(result.results[0]?.result).toBe("admission_skipped_provenance");
        expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
      } finally { db.close(); }
    });

    it("refuses admission when evidence role is not owner", () => {
      const db = openTestSidecar();
      try {
        const ev = appendAshleyEvidence(db, { conversationId: "thread-r", text: "I am Ashley", discordMessageIds: ["m-a"], nowMs: 1 });
        admitTestCycle(db, { cycleId: "cycle-r", conversationId: "thread-r", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 1 });
        const nom = nomination({ cycleId: "cycle-r", generation: 1, sourceRefs: [ev.rowId] });
        publishNomination(db, nom, "settlement-r");
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(0);
        expect(result.skippedProvenance).toBe(1);
        expect(result.results[0]?.result).toBe("admission_skipped_provenance");
        expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
      } finally { db.close(); }
    });

    it("refuses admission when evidence is classified secret", () => {
      const db = openTestSidecar();
      try {
        const ev = appendOwnerUtterance(db, { conversationId: "thread-s", text: "secret password", discordMessageIds: ["m-s"], dataClassification: "secret", nowMs: 1 });
        admitTestCycle(db, { cycleId: "cycle-s", conversationId: "thread-s", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 1 });
        const nom = nomination({ cycleId: "cycle-s", generation: 1, sourceRefs: [ev.rowId] });
        publishNomination(db, nom, "settlement-s");
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(0);
        expect(result.results[0]?.result).toBe("admission_skipped_secret");
        expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
      } finally { db.close(); }
    });

    it("preserves admission without currentness entitlement when time is historical", () => {
      const db = openTestSidecar();
      try {
        const ev = appendOwnerUtterance(db, { conversationId: "thread-h", text: "I used to like C++", discordMessageIds: ["m-h"], nowMs: 1 });
        admitTestCycle(db, { cycleId: "cycle-h", conversationId: "thread-h", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 1 });
        const nom = nomination({
          cycleId: "cycle-h",
          generation: 1,
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          sourceRefs: [ev.rowId],
        });
        // Publish without any currentness pack or observations consumed
        publishNomination(db, nom, "settlement-h", {
          operations: { observationsConsumed: [] },
          currentness: null as any,
        });
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(1);
        expect(result.results[0]?.result).toBe("admitted");
      } finally { db.close(); }
    });

    it("preserves admission without currentness entitlement when time is unknown_freshness", () => {
      const db = openTestSidecar();
      try {
        const ev = appendOwnerUtterance(db, { conversationId: "thread-u", text: "I may like tea", discordMessageIds: ["m-u"], nowMs: 1 });
        admitTestCycle(db, { cycleId: "cycle-u", conversationId: "thread-u", generation: 1, triggerKind: "owner_message", triggerRef: ev.rowId, occupantId: "doc", nowMs: 1 });
        const nom = nomination({
          cycleId: "cycle-u",
          generation: 1,
          dimensions: { source: "owner_utterance", status: "asserted", time: "unknown_freshness", reliability: "owner_supplied" },
          sourceRefs: [ev.rowId],
        });
        // Publish without any currentness pack or observations consumed
        publishNomination(db, nom, "settlement-u", {
          operations: { observationsConsumed: [] },
          currentness: null as any,
        });
        const result = tickAdmission(db, { nowMs: 2 });
        expect(result.admitted).toBe(1);
        expect(result.results[0]?.result).toBe("admitted");
      } finally { db.close(); }
    });
  });
});
