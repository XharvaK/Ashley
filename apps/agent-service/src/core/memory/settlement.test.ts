import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { recordIdentityEntry } from "../identity/store.js";
import { admitOwnerCorrection, getCorrectionReceipt, listCorrectionTargets } from "./corrections.js";
import { fanoutCorrection } from "./fanout.js";
import { cutoverMemoryAssertions } from "./cutover.js";
import { insertAssertion } from "./assertions.js";
import { insertMessage, resolveActiveThread } from "./threads.js";
import { createEpisode } from "./episodes.js";
import { upsertFact } from "./facts.js";
import { upsertMindStateItem } from "../state/mind-items.js";
import { listActiveFacts } from "./facts.js";
import { applyForgetTargets } from "./forget.js";

const OWNER_ID = "doc";

function message(db: DatabaseSync, threadId: string, text: string): number {
  return insertMessage(db, {
    threadId,
    ownerId: OWNER_ID,
    role: "user",
    text,
    channel: "discord",
  });
}

function factAssertionId(db: DatabaseSync, factId: number): number {
  const row = db.prepare(
    "SELECT id FROM memory_assertions WHERE legacy_fact_id = ?",
  ).get(factId) as { id?: number } | undefined;
  if (row?.id == null) throw new Error("settlement_fact_assertion_missing");
  return Number(row.id);
}

function correctionInput(
  db: DatabaseSync,
  threadId: string,
  assertionIds: number[],
  correctionClass: "TEMPORAL_SUPERSESSION" | "INTERPRETATION_INVALIDATION" = "INTERPRETATION_INVALIDATION",
) {
  const sourceMessageId = message(db, threadId, "The stored memory is wrong and must be corrected.");
  return {
    ownerId: OWNER_ID,
    sourceMessageId,
    correctionOrdinal: 1,
    admissionPath: "typed_control" as const,
    class: correctionClass,
    scopeText: "stored memory",
    targets: assertionIds.map((assertionId) => ({
      assertionId,
      inclusionReason: "owner_confirmed" as const,
      resolutionBasis: "owner_confirmed" as const,
    })),
    capabilityMode: "apply" as const,
    now: new Date(Date.now() - 1000).toISOString(),
  };
}

describe("C1 local settlement", () => {
  it("resumes partial fan-out and writes receipt, reconciliation, and outcome in order", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const firstFact = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
        sourceMessageId: message(db, threadId, "I like coffee."),
      });
      const secondFact = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "tea",
        value: "likes tea",
        origin: "explicit_user",
        sourceMessageId: message(db, threadId, "I like tea."),
      });
      const firstAssertion = factAssertionId(db, firstFact);
      const secondAssertion = factAssertionId(db, secondFact);
      cutoverMemoryAssertions(db);
      const mindStateId = upsertMindStateItem(db, {
        ownerId: OWNER_ID,
        kind: "interest",
        text: "Coffee is worth remembering.",
        sourceType: "fact",
        sourceId: firstFact,
        urgency: 0.2,
      });
      db.prepare(
        `INSERT INTO memory_derivation_links
           (assertion_id, consumer_kind, consumer_id, created_at)
         VALUES (?, 'mind_state_item', ?, ?)`,
      ).run(firstAssertion, mindStateId, new Date().toISOString());
      recordIdentityEntry(db, {
        ownerId: OWNER_ID,
        layer: "dynamic",
        kind: "settlement.identity.baseline",
        text: "Identity must remain untouched.",
        source: "manual",
      });
      const identityBefore = db.prepare(
        "SELECT kind, text, layer FROM identity_entries WHERE owner_id = ? ORDER BY id",
      ).all(OWNER_ID);

      const admitted = admitOwnerCorrection(db, correctionInput(
        db,
        threadId,
        [firstAssertion, secondAssertion],
      ));
      expect(admitted.receipt).toMatchObject({
        barrierCommitted: true,
        fanoutState: "pending",
        readbackOk: false,
        completedAt: null,
      });

      expect(() => fanoutCorrection(db, admitted.correction.id, {
        testFailAfterTargets: 1,
      })).toThrow("memory_fanout_interrupted");
      expect(getCorrectionReceipt(db, admitted.correction.id)).toMatchObject({
        fanoutState: "failed",
        readbackOk: false,
        completedAt: null,
      });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM memory_correction_outcomes WHERE correction_id = ?",
      ).get(admitted.correction.id)).toEqual({ count: 0 });
      expect(listCorrectionTargets(db, admitted.correction.id).map((target) => target.applicationState))
        .toEqual(["applied", "held"]);
      expect(db.prepare(
        "SELECT lifecycle_status FROM memory_corrections WHERE id = ?",
      ).get(admitted.correction.id)).toEqual({ lifecycle_status: "applying" });

      const completed = fanoutCorrection(db, admitted.correction.id);
      expect(completed.receipt).toMatchObject({
        fanoutState: "complete",
        readbackOk: true,
      });
      expect(completed.receipt.completedAt).not.toBeNull();
      expect(completed.outcome).toMatchObject({
        correctionId: admitted.correction.id,
        class: "INTERPRETATION_INVALIDATION",
        ashleyErrorKind: "original_inference_error",
      });
      expect(db.prepare(
        "SELECT lifecycle_status FROM memory_corrections WHERE id = ?",
      ).get(admitted.correction.id)).toEqual({ lifecycle_status: "applied" });
      expect(listCorrectionTargets(db, admitted.correction.id).map((target) => target.applicationState))
        .toEqual(["applied", "applied"]);
      expect(db.prepare(
        `SELECT consumer_kind, consumer_id, requested_action, status
         FROM memory_reconciliation_requests WHERE correction_id = ?`,
      ).all(admitted.correction.id)).toEqual([{
        consumer_kind: "mind_state_item",
        consumer_id: mindStateId,
        requested_action: "consider_review",
        status: "pending",
      }]);
      expect(db.prepare(
        "SELECT status FROM mind_state_items WHERE id = ?",
      ).get(mindStateId)).toEqual({ status: "active" });
      expect(listActiveFacts(db, OWNER_ID)).toEqual([]);
      expect(db.prepare(
        "SELECT termination_reason FROM memory_assertions WHERE id IN (?, ?) ORDER BY id",
      ).all(firstAssertion, secondAssertion)).toEqual([
        { termination_reason: "invalidated" },
        { termination_reason: "invalidated" },
      ]);
      expect(db.prepare(
        "SELECT kind, text, layer FROM identity_entries WHERE owner_id = ? ORDER BY id",
      ).all(OWNER_ID)).toEqual(identityBefore);

      const retry = fanoutCorrection(db, admitted.correction.id);
      expect(retry.processedTargetCount).toBe(0);
      expect(retry.outcome).toMatchObject({ correctionId: admitted.correction.id });
    } finally {
      db.close();
    }
  });

  it("keeps an applied barrier after observe rollback and records new observe intents without a barrier", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
        sourceMessageId: message(db, threadId, "I like coffee."),
      });
      const assertionId = factAssertionId(db, factId);
      cutoverMemoryAssertions(db);
      const input = correctionInput(db, threadId, [assertionId], "TEMPORAL_SUPERSESSION");
      const admitted = admitOwnerCorrection(db, input);
      fanoutCorrection(db, admitted.correction.id);

      const rollbackReplay = admitOwnerCorrection(db, {
        ...input,
        capabilityMode: "observe",
      });
      expect(rollbackReplay.correction.id).toBe(admitted.correction.id);
      expect(rollbackReplay.correction.lifecycleStatus).toBe("applied");
      expect(rollbackReplay.barrier).not.toBeNull();
      expect(getCorrectionReceipt(db, admitted.correction.id)?.readbackOk).toBe(true);

      const newFactMessage = message(db, threadId, "I like cocoa.");
      const newFact = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "cocoa",
        value: "likes cocoa",
        origin: "explicit_user",
        sourceMessageId: newFactMessage,
      });
      const newAssertion = factAssertionId(db, newFact);
      const observeMessage = message(db, threadId, "Maybe the cocoa memory is wrong.");
      const observed = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: observeMessage,
        correctionOrdinal: 1,
        admissionPath: "typed_slash",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "cocoa memory",
        targets: [{
          assertionId: newAssertion,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "observe",
      });
      expect(observed.correction.lifecycleStatus).toBe("observe_recorded");
      expect(observed.barrier).toBeNull();
      expect(observed.receipt).toMatchObject({
        barrierCommitted: false,
        fanoutState: "not_started",
        readbackOk: false,
      });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM memory_deny_barrier_members WHERE assertion_id = ?",
      ).get(newAssertion)).toEqual({ count: 0 });
      expect(listActiveFacts(db, OWNER_ID).map((fact) => fact.key)).toEqual(["cocoa"]);
    } finally {
      db.close();
    }
  });

  it("preserves external assertions and keeps unknown legacy facts inspect-only", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const legacyFact = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "ongoing",
        key: "legacy_note",
        value: "unclassified legacy value",
        origin: "legacy",
      });
      const external = insertAssertion(db, {
        ownerId: OWNER_ID,
        kind: "owner_interpretation",
        subjectFacet: "external_verifiable",
        lineageKind: "observed_overlap",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        claimText: "The external status is published.",
        sourceKind: "settlement_test",
        recordedAt: new Date().toISOString(),
        authorityFrom: new Date().toISOString(),
        authorityBasis: "adjudicated",
        dataClassification: "ordinary",
      });
      cutoverMemoryAssertions(db);
      expect(listActiveFacts(db, OWNER_ID).map((fact) => fact.id)).not.toContain(legacyFact);
      const source = message(db, threadId, "The source quotation needs correction.");
      const correction = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: source,
        correctionOrdinal: 1,
        admissionPath: "typed_control",
        class: "PROVENANCE_CORRECTION",
        scopeText: "source quotation",
        targets: [{
          assertionId: external,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "apply",
      });
      const result = fanoutCorrection(db, correction.correction.id);
      expect(result.receipt.readbackOk).toBe(true);
      expect(listCorrectionTargets(db, correction.correction.id)).toEqual([
        expect.objectContaining({ applicationState: "skipped" }),
      ]);
      expect(db.prepare(
        "SELECT termination_reason, claim_text FROM memory_assertions WHERE id = ?",
      ).get(external)).toEqual({
        termination_reason: null,
        claim_text: "The external status is published.",
      });
    } finally {
      db.close();
    }
  });

  it("redacts governed correction content while preserving correction history", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const factMessage = message(db, threadId, "I like coffee.");
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
        sourceMessageId: factMessage,
        sourceQuote: "I like coffee.",
      });
      const assertion = factAssertionId(db, factId);
      cutoverMemoryAssertions(db);
      const correctionSource = message(
        db,
        threadId,
        "My private psychological explanation for the coffee memory is wrong.",
      );
      const admitted = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: correctionSource,
        correctionOrdinal: 1,
        admissionPath: "typed_control",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "private psychological explanation for coffee",
        proposal: {
          quotedPsychologicalMaterial: "sensitive owner wording",
          replacement: "do not retain this interpretation",
        },
        targets: [{
          assertionId: assertion,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "apply",
      });
      fanoutCorrection(db, admitted.correction.id);
      const correctionBefore = db.prepare(
        `SELECT class, source_message_id, scope_text, proposal_json
         FROM memory_corrections WHERE id = ?`,
      ).get(admitted.correction.id) as Record<string, unknown>;
      const targetBefore = listCorrectionTargets(db, admitted.correction.id);
      const outcomeBefore = db.prepare(
        `SELECT class, ashley_error_kind FROM memory_correction_outcomes
         WHERE correction_id = ?`,
      ).get(admitted.correction.id);
      const fact = db.prepare(
        "SELECT entity_uuid FROM mem_facts WHERE id = ?",
      ).get(factId) as { entity_uuid?: string } | undefined;
      if (!fact?.entity_uuid) throw new Error("settlement_fact_uuid_missing");

      applyForgetTargets(db, OWNER_ID, [{
        entityType: "mem_facts",
        entityUuid: fact.entity_uuid,
        action: "redact",
      }]);

      expect(db.prepare(
        `SELECT class, source_message_id, scope_text, proposal_json
         FROM memory_corrections WHERE id = ?`,
      ).get(admitted.correction.id)).toEqual({
        class: correctionBefore.class,
        source_message_id: correctionSource,
        scope_text: "[redacted]",
        proposal_json: "{}",
      });
      expect(listCorrectionTargets(db, admitted.correction.id)).toEqual(targetBefore);
      expect(db.prepare(
        `SELECT class, ashley_error_kind FROM memory_correction_outcomes
         WHERE correction_id = ?`,
      ).get(admitted.correction.id)).toEqual(outcomeBefore);
      expect(db.prepare(
        "SELECT text FROM mem_messages WHERE id = ?",
      ).get(correctionSource)).toEqual({
        text: "My private psychological explanation for the coffee memory is wrong.",
      });
      expect(db.prepare(
        `SELECT key, value, source_quote, termination_reason
         FROM memory_assertions WHERE id = ?`,
      ).get(assertion)).toEqual({
        key: "",
        value: "",
        source_quote: null,
        termination_reason: "invalidated",
      });
    } finally {
      db.close();
    }
  });

  it("redacts corrected episode claim prose and excerpts without deleting the correction", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const first = message(db, threadId, "A sensitive episode source.");
      const second = message(db, threadId, "The sensitive episode continues.");
      cutoverMemoryAssertions(db);
      const episode = createEpisode(db, {
        ownerId: OWNER_ID,
        threadId,
        summary: "Sensitive episode summary that must be forgotten.",
        messageIds: [first, second],
        provenance: "live",
      });
      if (!episode) throw new Error("settlement_episode_missing");
      const claim = db.prepare(
        `SELECT assertion_id FROM memory_episode_claims WHERE episode_id = ?`,
      ).get(episode.id) as { assertion_id?: number } | undefined;
      if (claim?.assertion_id == null) throw new Error("settlement_claim_missing");
      const correctionSource = message(db, threadId, "Forget the sensitive episode correction wording.");
      const admitted = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: correctionSource,
        correctionOrdinal: 1,
        admissionPath: "typed_control",
        class: "PROVENANCE_CORRECTION",
        scopeText: "sensitive episode correction scope",
        proposal: { quotedPsychologicalMaterial: "sensitive episode quote" },
        targets: [{
          assertionId: claim.assertion_id,
          inclusionReason: "owner_confirmed",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "apply",
      });
      fanoutCorrection(db, admitted.correction.id);
      const episodeRow = db.prepare(
        "SELECT entity_uuid FROM episodes WHERE id = ?",
      ).get(episode.id) as { entity_uuid?: string } | undefined;
      if (!episodeRow?.entity_uuid) throw new Error("settlement_episode_uuid_missing");

      applyForgetTargets(db, OWNER_ID, [{
        entityType: "episodes",
        entityUuid: episodeRow.entity_uuid,
        action: "redact",
      }]);

      expect(db.prepare(
        `SELECT status, summary, entities FROM episodes WHERE id = ?`,
      ).get(episode.id)).toEqual({ status: "forgotten", summary: "", entities: "" });
      expect(db.prepare(
        `SELECT claim_text, source_quote, termination_reason
         FROM memory_assertions WHERE id = ?`,
      ).get(claim.assertion_id)).toEqual({
        claim_text: "",
        source_quote: null,
        termination_reason: "source_disputed",
      });
      expect(db.prepare(
        `SELECT excerpt FROM memory_episode_claims
         WHERE episode_id = ? AND assertion_id = ?`,
      ).get(episode.id, claim.assertion_id)).toEqual({ excerpt: "" });
      expect(db.prepare(
        `SELECT class, scope_text, proposal_json FROM memory_corrections WHERE id = ?`,
      ).get(admitted.correction.id)).toEqual({
        class: "PROVENANCE_CORRECTION",
        scope_text: "[redacted]",
        proposal_json: "{}",
      });
      expect(db.prepare(
        `SELECT class, ashley_error_kind FROM memory_correction_outcomes WHERE correction_id = ?`,
      ).get(admitted.correction.id)).toEqual({
        class: "PROVENANCE_CORRECTION",
        ashley_error_kind: "provenance_error",
      });
    } finally {
      db.close();
    }
  });
});
