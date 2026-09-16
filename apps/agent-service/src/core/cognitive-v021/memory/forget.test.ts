import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { applyWorkingContextDelta, listWorkingContext } from "../evidence/working-context.js";
import { insertOutboxPending } from "../speech/outbox.js";
import { sendOutbox } from "../speech/send.js";
import { openTestSidecar } from "../test-support.js";
import { retrieveCandidates } from "../retrieval/discover.js";
import { openDerivedStore, registerDerivedStoreForSidecar } from "../retrieval/derived-store.js";
import { searchConversationFts, searchMemoryFts } from "../retrieval/fts.js";
import { upsertMemoryAssertion } from "./assertions.js";
import { buildOwnerKnowledgeView } from "./views.js";
import { applyV021Forget, applyV021ForgetTargets } from "./forget.js";
import { appendMemorySupport } from "./supports.js";
import { buildLearnedSelfSlice } from "../identity/learned-self.js";
import { publishSemanticTransaction } from "../settlement/publish.js";
import { admitTestCycle, makeThoughtDraft } from "../test-support.js";
import type { PublishedCognitiveSettlement } from "../types.js";

describe("v0.2.1 forget matrix", () => {
  it("removes forgotten sidecar rows from the registered FTS store at commit", () => {
    const sidecar = openTestSidecar();
    const derived = openDerivedStore(":memory:");
    const unregister = registerDerivedStoreForSidecar(sidecar, derived);
    try {
      appendOwnerUtterance(sidecar, {
        conversationId: "thread-forget-fts",
        text: "erasefts conversation marker",
        nowMs: 1,
      });
      upsertMemoryAssertion(sidecar, {
        assertionKey: "memory:erasefts",
        statement: "erasefts memory marker",
        memoryKind: "owner_world_claim",
        dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      expect(derived.reconcileIfNeeded(sidecar)).toBe(true);
      expect(searchConversationFts(derived, sidecar, "thread-forget-fts", "erasefts").rows).toHaveLength(1);
      expect(searchMemoryFts(derived, sidecar, "erasefts").rows).toHaveLength(1);

      applyV021Forget(sidecar, { topic: "erasefts", nowMs: 2 });

      expect(searchConversationFts(derived, sidecar, "thread-forget-fts", "erasefts").rows).toEqual([]);
      expect(searchMemoryFts(derived, sidecar, "erasefts").rows).toEqual([]);
    } finally {
      unregister();
      derived.close();
      sidecar.close();
    }
  });

  it("does not project a support id after forget clears its source ref", () => {
    const db = openTestSidecar();
    try {
      upsertMemoryAssertion(db, {
        assertionKey: "self:forgotten-support",
        statement: "disposition: preserve the support boundary.",
        memoryKind: "learned_self_evidence",
        dimensions: { source: "ashley_interpretation", status: "interpreted", time: "current", reliability: "inferred" },
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
      appendMemorySupport(db, {
        supportId: "support:forgotten",
        assertionKey: "self:forgotten-support",
        source: "owner_utterance",
        provenance: "native",
        sourceArchitectureEpoch: "v0.2.1",
        sourceRef: "evidence:forgotten",
        settlementId: "settlement:forgotten",
        evidenceLineageId: "lineage:forgotten",
        observationId: null,
        receiptId: null,
        dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
        dataClassification: "never_public",
      });
      const adoptedNomination = {
        nominationId: "evidence:forgotten",
        cycleId: "cycle:forgotten-support",
        generation: 1,
        assertionKey: "self:forgotten-support",
        statement: "disposition: preserve the support boundary.",
        memoryKind: "learned_self_evidence" as const,
        dimensions: { source: "ashley_interpretation" as const, status: "interpreted" as const, time: "current" as const, reliability: "inferred" as const },
        dataClassification: "never_public" as const,
        supersedesAssertionKey: null,
        concernId: null,
        sourceRefs: [],
      };
      db.prepare(
        `INSERT INTO durable_nominations
           (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind,
            dimensions_json, data_classification, supersedes_assertion_key, concern_id, admitted, source_refs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      ).run(
        adoptedNomination.nominationId,
        adoptedNomination.cycleId,
        adoptedNomination.generation,
        adoptedNomination.assertionKey,
        adoptedNomination.statement,
        adoptedNomination.memoryKind,
        JSON.stringify(adoptedNomination.dimensions),
        adoptedNomination.dataClassification,
        adoptedNomination.supersedesAssertionKey,
        adoptedNomination.concernId,
        JSON.stringify(adoptedNomination.sourceRefs),
      );
      db.prepare(
        "INSERT INTO settlements (settlement_id, cycle_id, generation, payload_json) VALUES (?, ?, ?, ?)",
      ).run(
        "settlement:forgotten",
        adoptedNomination.cycleId,
        adoptedNomination.generation,
        JSON.stringify({ durableNominations: [adoptedNomination] }),
      );
      expect(buildLearnedSelfSlice(db).supportRefs).toEqual(["evidence:forgotten"]);
      expect(retrieveCandidates(db, {
        conversationId: "thread-forgotten-support",
        request: {
          triggerTerms: [],
          workingContextTopics: [],
          assertionKeys: ["self:forgotten-support"],
          includeLogSearch: true,
        },
      }).hits[0]?.supportRefs).toEqual(["evidence:forgotten"]);

      applyV021ForgetTargets(db, [{ entityType: "v021_memory_support", entityUuid: "support:forgotten", action: "redact" }]);

      expect(db.prepare("SELECT source_ref FROM sidecar_memory_supports WHERE support_id = ?").get("support:forgotten")).toEqual({ source_ref: null });
      const slice = buildLearnedSelfSlice(db);
      expect(slice).not.toHaveProperty("supportRefs");
      expect(slice.broadOrientation).not.toHaveProperty("supportRefs");
      expect(retrieveCandidates(db, {
        conversationId: "thread-forgotten-support",
        request: {
          triggerTerms: [],
          workingContextTopics: [],
          assertionKeys: ["self:forgotten-support"],
          includeLogSearch: true,
        },
      }).hits[0]?.supportRefs).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("prevents a forgotten curiosity observation from supporting later publication", () => {
    const db = openTestSidecar();
    try {
      db.prepare(
        `INSERT INTO observations
           (observation_id, cycle_id, generation, derived, replay_safe, modality,
            payload_json, provenance, data_classification, secret_omitted, created_at_ms)
         VALUES ('forgotten-curiosity', NULL, NULL, 1, 1, 'page', ?, ?, 'ordinary', 0, 1)`
      ).run(
        JSON.stringify({ title: "curiosity target" }),
        "curiosity:read:1:hash",
      );
      applyV021Forget(db, { topic: "curiosity", nowMs: 2 });
      admitTestCycle(db, {
        cycleId: "cycle-forgotten-curiosity",
        conversationId: "thread-forgotten-curiosity",
        triggerKind: "owner_message",
        triggerRef: "forgotten",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 3,
      });
      const draft = makeThoughtDraft({
        cycleId: "cycle-forgotten-curiosity",
        triggerRef: "thread-forgotten-curiosity",
        operations: {
          observationsConsumed: ["forgotten-curiosity"],
          effectsCompleted: [],
          intentsStillInFlight: [],
        },
      });
      const result = publishSemanticTransaction(db, {
        ...draft,
        settlementId: "settlement-forgotten-curiosity",
        speech: { ...draft.speech, finalLicensedText: null },
      } as PublishedCognitiveSettlement);

      expect(result).toMatchObject({ published: false, reason: "source_currentness_stale" });
      expect(db.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 0 });
      expect(db.prepare("SELECT json_extract(payload_json, '$.title') AS title FROM observations WHERE observation_id = 'forgotten-curiosity'").get())
        .toMatchObject({ title: "[redacted]" });
    } finally {
      db.close();
    }
  });

  it("redacts semantic content and suppresses future delivery", () => {
    const db = openTestSidecar();
    try {
      const evidence = appendOwnerUtterance(db, { conversationId: "thread-1", text: "HY3 is the relevant model.", discordMessageIds: ["forget-1"], nowMs: 1 });
      applyWorkingContextDelta(db, { op: "upsert", item: { id: "wc-hy3", conversationId: "thread-1", type: "owner_teaching", text: "HY3 is the relevant model.", concernId: "concern-hy3", sourceTurnIds: [evidence.rowId], status: "active", supersedesId: null } }, { cycleId: "cycle-1", generation: 1 });
      db.prepare("INSERT INTO observation_subscriptions (subscription_id, conversation_id, spec_json, cancelled) VALUES (?, ?, ?, 0)").run("subscription-hy3", "thread-1", JSON.stringify({ topicKeys: ["HY3"], scope: "HY3" }));
      upsertMemoryAssertion(db, { assertionKey: "memory:hy3", statement: "HY3 is the relevant model.", memoryKind: "owner_world_claim", dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" }, dataClassification: "never_public", lineageParentKey: null, admittedGeneration: 1, live: true });
      const outbox = insertOutboxPending(db, { settlementId: "settlement-hy3", cycleId: "cycle-1", generation: 1, conversationId: "thread-1", licensedText: "I remember HY3.", deliveryIntent: { ownerId: "doc", channel: "discord", threadId: "thread-1", conversationId: "thread-1", trigger: "idle", deliveryLane: "proactive", purpose: "licensed_speech" } });

      const result = applyV021Forget(db, { topic: "HY3", nowMs: 2 });
      expect(result.targets.some((target) => target.entityType === "v021_conversation_evidence")).toBe(true);
      expect(db.prepare("SELECT text, source_status FROM conversation_evidence_log WHERE row_id = ?").get(evidence.rowId)).toMatchObject({ text: null, source_status: "redacted" });
      expect(listWorkingContext(db, "thread-1")).toEqual([]);
      expect(buildOwnerKnowledgeView(db)).toEqual([]);
      expect(db.prepare("SELECT cancelled, spec_json FROM observation_subscriptions WHERE subscription_id = 'subscription-hy3'").get()).toMatchObject({ cancelled: 1, spec_json: "{}" });
      expect(db.prepare("SELECT send_status, licensed_text FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId)).toMatchObject({ send_status: "suppressed", licensed_text: "[redacted]" });
      expect(retrieveCandidates(db, { conversationId: "thread-1", request: { triggerTerms: ["HY3"], workingContextTopics: [], assertionKeys: ["memory:hy3"], includeLogSearch: true } }).hits).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("cancels a projected undelivered Nuclear reservation before local redaction", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const outbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-delivery-forget",
        cycleId: "cycle-delivery-forget",
        generation: 1,
        conversationId: "thread-delivery-forget",
        licensedText: "forget this delivery topic",
        origin: "live",
      });
      nuclear.prepare(
        `INSERT INTO delivery_reservations
           (owner_id, channel, thread_id, trigger, delivery_lane, state,
            draft_text, created_at)
         VALUES ('doc', 'discord', 'thread-delivery-forget', 'reactive',
                 'reactive', 'reserved', 'forget this delivery topic',
                 '1970-01-01T00:00:01.000Z')`,
      ).run();
      sidecar.prepare(
        "UPDATE speech_outbox SET nuclear_reservation_id = 1 WHERE outbox_id = ?",
      ).run(outbox.outboxId);

      const target = { entityType: "v021_speech_outbox", entityUuid: String(outbox.outboxId), action: "cancel" as const };
      applyV021ForgetTargets(sidecar, [target], {
        delivery: { nuclearDb: nuclear, ownerId: "doc" },
        nowMs: 2,
      });
      expect(nuclear.prepare("SELECT state FROM delivery_reservations WHERE id = 1").get()).toMatchObject({ state: "cancelled" });
      expect(sidecar.prepare("SELECT send_status, licensed_text FROM speech_outbox WHERE outbox_id = ?").get(outbox.outboxId)).toMatchObject({ send_status: "suppressed", licensed_text: "[redacted]" });
      await expect(sendOutbox(sidecar, outbox.outboxId, async () => ["must-not-send"]))
        .rejects.toThrow("speech_outbox_suppressed");
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
