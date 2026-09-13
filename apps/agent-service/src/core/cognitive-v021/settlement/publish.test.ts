import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { updateCycleState } from "../cycle/inbox.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { publishSemanticTransaction } from "./publish.js";
import { applyConcernDelta } from "../concerns/lineage.js";
import { SETTLEMENT_SCHEMA_VERSION } from "../types.js";
import type { PublishedCognitiveSettlement } from "../types.js";
import { openNuclearDb } from "../../db.js";
import { beginAuthorityTransition, captureAuthorityCurrentness, stabilizeAuthorityBarrier } from "../authority/barrier.js";
import { applyWorkingContextDelta } from "../evidence/working-context.js";
import { listWorkingContext } from "../evidence/working-context.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { captureThoughtSourceCurrentness } from "../thought/source-currentness.js";
import { captureThoughtSourcePackage } from "../thought/input.js";

function settlement(overrides: Partial<PublishedCognitiveSettlement> = {}): PublishedCognitiveSettlement {
  return {
    settlementId: "settlement-1", schemaVersion: SETTLEMENT_SCHEMA_VERSION, cycleId: "cycle-1", generation: 1,
    authorityEpoch: 1, occupantId: "doc", architectureEpoch: "v0.2.1", triggerRef: "owner-1",
    interpretation: { discourseActs: ["inform"], referentBindings: [], corrections: [], unresolvedAmbiguities: [], topics: ["topic"] },
    commitments: { epistemic: [{ dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, statement: "topic" }], operational: [], conversational: ["answer"], stance: { warmth: "medium", humorAllowed: false, disagreement: false, uncertaintyDisplay: true } },
    speech: { mode: "draft", mustSay: ["hello"], mustNot: [], surfaceDraft: "hello", acceptableRealizations: ["hello"], presentationDirectives: [], finalLicensedText: "hello" },
    workingContextDelta: [{ op: "upsert", item: { id: "wc-1", conversationId: "thread-1", type: "topic", text: "topic", concernId: null, sourceTurnIds: [], status: "active", supersedesId: null } }],
    concernDeltas: [], occupancyDelta: [], futureTriggers: [], subscriptions: [], durableNominations: [],
    operations: { observationsConsumed: [], effectsCompleted: [], intentsStillInFlight: [] }, authority: { objectionsApplied: [], revisionCount: 0 },
    ...overrides,
  };
}

describe("v0.2.1 semantic publication transaction", () => {
  it("rejects a settlement that consumes a missing observation before semantic writes", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      const result = publishSemanticTransaction(db, settlement({
        operations: { observationsConsumed: ["missing-observation"], effectsCompleted: [], intentsStillInFlight: [] },
      }));
      expect(result).toMatchObject({ published: false, reason: "source_currentness_stale" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("rejects a settlement that consumes a redacted observation before semantic writes", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      db.prepare(
        `INSERT INTO observations
           (observation_id, cycle_id, generation, derived, replay_safe, modality,
            payload_json, provenance, data_classification, secret_omitted, created_at_ms)
         VALUES (?, ?, ?, 1, 1, 'page', ?, ?, 'ordinary', 0, ?)`
      ).run(
        "redacted-observation",
        "cycle-1",
        1,
        JSON.stringify({ title: "[redacted]" }),
        "curiosity:read:1:hash",
        1,
      );
      const result = publishSemanticTransaction(db, settlement({
        operations: { observationsConsumed: ["redacted-observation"], effectsCompleted: [], intentsStillInFlight: [] },
      }));
      expect(result).toMatchObject({ published: false, reason: "source_currentness_stale" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("rejects stale generations without writing working context", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      const newer = admitTestCycle(db, { conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "two", occupantId: "doc", authorityEpoch: 1, nowMs: 2 });
      updateCycleState(db, newer.cycleId, "thinking", 3);
      const result = publishSemanticTransaction(db, settlement());
      expect(result).toMatchObject({ published: false, reason: "stale_generation" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("rolls back the complete semantic publication when a later write aborts", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      db.exec(`CREATE TRIGGER fail_occupancy BEFORE INSERT ON mind_occupancy BEGIN SELECT RAISE(ABORT, 'occupancy_failure'); END`);
      expect(() => publishSemanticTransaction(db, settlement({ occupancyDelta: [{ op: "set", occupancy: { conversationId: "thread-1", concernId: "c1", status: "active", priority: 1, updatedGeneration: 1 } }] }))).toThrow(/occupancy_failure/);
      expect(db.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("fails and rolls back when a future trigger snapshot no longer matches its concern", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-trigger-fence", conversationId: "thread-trigger-fence", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern-trigger-fence",
          conversationId: "thread-trigger-fence",
          statement: "The current concern state.",
          sourceTurnIds: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          assertionKey: null,
          status: "active",
        },
      }, { cycleId: "cycle-trigger-fence", generation: 1 });

      const result = publishSemanticTransaction(db, settlement({
        cycleId: "cycle-trigger-fence",
        triggerRef: "thread-trigger-fence",
        futureTriggers: [{
          op: "create",
          trigger: {
            triggerId: "trigger-fence",
            conversationId: "thread-trigger-fence",
            concernId: "concern-trigger-fence",
            snapshotHash: "snapshot-seen-before-publication",
            dueAtMs: 2_000,
            payload: { purpose: "revisit" },
          },
        }],
      }));
      expect(result).toMatchObject({
        published: false,
        replayed: false,
        reason: "future_trigger_snapshot_conflict",
        settlementId: null,
        outboxId: null,
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM future_triggers").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT state FROM cycle_records WHERE cycle_id = 'cycle-trigger-fence'").get()).toMatchObject({ state: "admitted" });
    } finally {
      db.close();
    }
  });

  it("rolls back provisional deltas when the second publication fence becomes stale", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      db.exec(`CREATE TRIGGER stale_after_delta AFTER INSERT ON working_context_items BEGIN UPDATE cycle_records SET generation = 2 WHERE cycle_id = 'cycle-1'; END`);
      const result = publishSemanticTransaction(db, settlement());
      expect(result).toMatchObject({ published: false, reason: "stale_generation" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("publishes one settlement and one pending speech outbox row", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-1", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      const first = publishSemanticTransaction(db, settlement());
      const replay = publishSemanticTransaction(db, settlement());
      expect(first).toMatchObject({ published: true, replayed: false });
      expect(replay).toMatchObject({ published: true, replayed: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 1 });
      expect(db.prepare("SELECT licensed_text FROM speech_outbox").get()).toMatchObject({ licensed_text: "hello" });
    } finally {
      db.close();
    }
  });

  it("replays by cycle and generation before applying a second semantic delta set", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-replay", conversationId: "thread-replay", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      const first = publishSemanticTransaction(db, settlement({ cycleId: "cycle-replay", settlementId: "settlement-original" }));
      const replay = publishSemanticTransaction(db, settlement({
        cycleId: "cycle-replay",
        settlementId: "settlement-random-retry",
        workingContextDelta: [{ op: "upsert", item: { id: "wc-retry", conversationId: "thread-replay", type: "topic", text: "retry must not apply", concernId: null, sourceTurnIds: [], status: "active", supersedesId: null } }],
      }));
      expect(first).toMatchObject({ published: true, replayed: false, settlementId: "settlement-original" });
      expect(replay).toMatchObject({ published: true, replayed: true, settlementId: "settlement-original", outboxId: first.outboxId });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("refuses publication when the Authority barrier is transitioning or the captured vector is stale", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      admitTestCycle(sidecar, { cycleId: "cycle-authority-fence", conversationId: "thread-authority-fence", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      const binding = captureAuthorityCurrentness(nuclear);
      const transition = beginAuthorityTransition(nuclear, "publish-race", 2);
      expect(publishSemanticTransaction(sidecar, settlement({ cycleId: "cycle-authority-fence", triggerRef: "thread-authority-fence" }), {
        authorityDb: nuclear,
        expectedCurrentness: binding,
      })).toMatchObject({ published: false, reason: "authority_transition" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });

      stabilizeAuthorityBarrier(nuclear, transition.vector, 3, transition.transitionId);
      expect(publishSemanticTransaction(sidecar, settlement({ cycleId: "cycle-authority-fence", triggerRef: "thread-authority-fence" }), {
        authorityDb: nuclear,
        expectedCurrentness: binding,
      })).toMatchObject({ published: false, reason: "authority_vector_stale" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("does not resurrect a terminal future trigger through semantic publication", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-trigger-terminal",
        conversationId: "thread-trigger-terminal",
        triggerKind: "owner_message",
        triggerRef: "one",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern-trigger-terminal",
          conversationId: "thread-trigger-terminal",
          statement: "The terminal trigger concern.",
          sourceTurnIds: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          assertionKey: null,
          status: "active",
        },
      }, { cycleId: "cycle-trigger-terminal", generation: 1 });
      db.prepare(
        `INSERT INTO future_triggers
          (trigger_id, conversation_id, concern_id, due_at_ms, snapshot_hash, status, payload_json)
         VALUES (?, ?, ?, ?, ?, 'suppressed_stale', ?)` ,
      ).run(
        "trigger-terminal",
        "thread-trigger-terminal",
        "concern-trigger-terminal",
        2_000,
        (db.prepare("SELECT snapshot_hash FROM concerns WHERE concern_id = ?").get("concern-trigger-terminal") as { snapshot_hash: string }).snapshot_hash,
        JSON.stringify({ result: "suppressed_stale", reason: "snapshot_mismatch", atMs: 2_000 }),
      );
      db.prepare(
        `INSERT INTO causal_ledger (cycle_id, generation, payload_json, thought_unavailable)
         VALUES (?, ?, ?, 0)` ,
      ).run(
        "future-trigger:trigger-terminal",
        1,
        JSON.stringify({ result: "suppressed_stale", reason: "snapshot_mismatch", atMs: 2_000 }),
      );

      expect(() => publishSemanticTransaction(db, settlement({
        cycleId: "cycle-trigger-terminal",
        triggerRef: "thread-trigger-terminal",
        workingContextDelta: [],
        futureTriggers: [{
          op: "create",
          trigger: {
            triggerId: "trigger-terminal",
            conversationId: "thread-trigger-terminal",
            concernId: "concern-trigger-terminal",
            snapshotHash: (db.prepare("SELECT snapshot_hash FROM concerns WHERE concern_id = ?").get("concern-trigger-terminal") as { snapshot_hash: string }).snapshot_hash,
            dueAtMs: 3_000,
            payload: { purpose: "replacement-must-use-new-id" },
          },
        }],
      }))).toThrow("future_trigger_terminal");
      expect(db.prepare("SELECT status, due_at_ms FROM future_triggers WHERE trigger_id = 'trigger-terminal'").get())
        .toMatchObject({ status: "suppressed_stale", due_at_ms: 2_000 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("rejects a stale Working Context snapshot before any semantic write", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-wc-currentness", conversationId: "thread-1", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: { id: "wc-current", conversationId: "thread-1", type: "topic", text: "old", concernId: null, sourceTurnIds: [], status: "active", supersedesId: null },
      }, { cycleId: "seed", generation: 1 });
      const captured = listWorkingContext(db, "thread-1");
      const sourceCurrentness = captureThoughtSourceCurrentness(db, undefined, null, captured);
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: { id: "wc-current", conversationId: "thread-1", type: "topic", text: "changed", concernId: null, sourceTurnIds: [], status: "active", supersedesId: null },
      }, { cycleId: "intervening", generation: 2 });

      expect(publishSemanticTransaction(db, settlement({
        cycleId: "cycle-wc-currentness",
        workingContextDelta: [],
      }), { sourceCurrentness })).toMatchObject({
        published: false,
        reason: "source_currentness_stale",
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("rejects an eligible concern membership change before any semantic write", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-concern-membership",
        conversationId: "thread-concern-membership",
        triggerKind: "owner_message",
        triggerRef: "one",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern-membership-existing",
          conversationId: "thread-concern-membership",
          statement: "The existing eligible concern.",
          sourceTurnIds: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          assertionKey: null,
          status: "active",
        },
      }, { cycleId: "seed-membership", generation: 1 });
      const sourceCurrentness = captureThoughtSourceCurrentness(
        db,
        undefined,
        null,
        [],
        {
          conversationId: "thread-concern-membership",
          concernMembership: ["concern-membership-existing"],
        } as any,
      );
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern-membership-added",
          conversationId: "thread-concern-membership",
          statement: "A newly visible eligible concern.",
          sourceTurnIds: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
          assertionKey: null,
          status: "active",
        },
      }, { cycleId: "intervening-membership", generation: 2 });

      expect(publishSemanticTransaction(db, settlement({
        cycleId: "cycle-concern-membership",
        triggerRef: "thread-concern-membership",
        workingContextDelta: [],
      }), { sourceCurrentness })).toMatchObject({
        published: false,
        reason: "source_currentness_stale",
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("does not over-fence content changes outside the captured concern dependencies", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-concern-unrelated",
        conversationId: "thread-concern-unrelated",
        triggerKind: "owner_message",
        triggerRef: "one",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      for (const [concernId, statement] of [
        ["concern-selected", "The selected concern."],
        ["concern-unrelated", "The unrelated concern."],
      ] as const) {
        applyConcernDelta(db, {
          op: "upsert",
          record: {
            concernId,
            conversationId: cycle.conversationId,
            statement,
            sourceTurnIds: [],
            dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
            assertionKey: null,
            status: "active",
          },
        }, { cycleId: "seed-unrelated", generation: 1 });
      }
      db.prepare(
        `INSERT INTO mind_occupancy
          (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES (?, 'concern-selected', 'active', 10, 'seed-unrelated', 1)`,
      ).run(cycle.conversationId);
      const sourceCurrentness = captureThoughtSourcePackage({
        sidecar: db,
        cycle,
        constitution: { constitutional: ["truth"], stableSelf: ["careful"] },
        capabilityReality: {
          vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
          canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
          canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
          approvedProjectIds: [],
        },
      } as any).sourceCurrentness;
      expect(sourceCurrentness.concernDependencies).toHaveProperty("concern-selected");
      expect(sourceCurrentness.concernDependencies).not.toHaveProperty("concern-unrelated");

      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern-unrelated",
          conversationId: cycle.conversationId,
          statement: "The unrelated concern changed.",
          sourceTurnIds: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
          assertionKey: null,
          status: "active",
        },
      }, { cycleId: "intervening-unrelated", generation: 2 });

      expect(publishSemanticTransaction(db, settlement({
        cycleId: cycle.cycleId,
        triggerRef: cycle.conversationId,
        workingContextDelta: [],
      }), { sourceCurrentness })).toMatchObject({ published: true });
    } finally {
      db.close();
    }
  });

  it("allows a genuinely new Thought-authored concern without self-invalidating", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-new-concern",
        conversationId: "thread-new-concern",
        triggerKind: "owner_message",
        triggerRef: "one",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const sourceCurrentness = captureThoughtSourcePackage({
        sidecar: db,
        cycle,
        constitution: { constitutional: ["truth"], stableSelf: ["careful"] },
        capabilityReality: {
          vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
          canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
          canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
          approvedProjectIds: [],
        },
      } as any).sourceCurrentness;

      expect(publishSemanticTransaction(db, settlement({
        cycleId: cycle.cycleId,
        triggerRef: cycle.conversationId,
        workingContextDelta: [],
        concernDeltas: [{
          op: "upsert",
          record: {
            concernId: "concern-authored-new",
            conversationId: cycle.conversationId,
            statement: "A new concern authored by Thought.",
            sourceTurnIds: [],
            dimensions: { source: "ashley_interpretation", status: "asserted", time: "current", reliability: "inferred" },
            assertionKey: null,
            status: "active",
          },
        }],
      }), { sourceCurrentness })).toMatchObject({ published: true });
      expect(db.prepare("SELECT status FROM concerns WHERE concern_id = 'concern-authored-new'").get())
        .toMatchObject({ status: "active" });
    } finally {
      db.close();
    }
  });

  it("rejects a stale learned-self revision head atomically", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      admitTestCycle(sidecar, { cycleId: "cycle-self-currentness", conversationId: "thread-self-currentness", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      const dimensions = { source: "ashley_interpretation" as const, status: "asserted" as const, time: "historical" as const, reliability: "inferred" as const };
      upsertMemoryAssertion(sidecar, {
        assertionKey: "self:currentness",
        statement: "Disposition: careful",
        memoryKind: "learned_self_evidence",
        dimensions,
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      const sourceCurrentness = captureThoughtSourceCurrentness(sidecar, nuclear, "doc", []);
      upsertMemoryAssertion(sidecar, {
        assertionKey: "self:currentness",
        statement: "Disposition: changed",
        memoryKind: "learned_self_evidence",
        dimensions,
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 2,
        live: true,
      });

      expect(publishSemanticTransaction(sidecar, settlement({
        cycleId: "cycle-self-currentness",
        triggerRef: "thread-self-currentness",
        workingContextDelta: [],
      }), {
        authorityDb: nuclear,
        expectedCurrentness: captureAuthorityCurrentness(nuclear),
        sourceCurrentness,
      })).toMatchObject({ published: false, reason: "source_currentness_stale" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("rejects a stale relationship projection head under the authority fence", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      admitTestCycle(sidecar, { cycleId: "cycle-rel-currentness", conversationId: "thread-rel-currentness", triggerKind: "owner_message", triggerRef: "one", occupantId: "doc", authorityEpoch: 1, nowMs: 1 });
      nuclear.prepare(
        `INSERT INTO relationship_projections
          (entity_uuid, owner_id, kind, projection_policy_id,
           projection_policy_version, source_bindings_json, source_watermark_json,
           data_classification, provenance, party_subject_scope, effective_from,
           effective_to, supersedes_projection_id, content_binding, computed_at)
         VALUES (?, ?, 'current_shared_culture', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)` ,
      ).run("relationship-currentness", "doc", "test", 1, "{}", "{}", "ordinary", "shadow", "owner", "2026-01-01T00:00:00.000Z", "binding-a", "2026-01-01T00:00:00.000Z");
      const sourceCurrentness = captureThoughtSourceCurrentness(sidecar, nuclear, "doc", []);
      nuclear.prepare("UPDATE relationship_projections SET content_binding = 'binding-b' WHERE owner_id = 'doc' AND effective_to IS NULL").run();

      expect(publishSemanticTransaction(sidecar, settlement({
        cycleId: "cycle-rel-currentness",
        triggerRef: "thread-rel-currentness",
        workingContextDelta: [],
      }), {
        authorityDb: nuclear,
        expectedCurrentness: captureAuthorityCurrentness(nuclear),
        sourceCurrentness,
      })).toMatchObject({ published: false, reason: "source_currentness_stale" });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
