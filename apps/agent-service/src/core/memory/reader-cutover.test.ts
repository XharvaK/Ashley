import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import type { ChatMessage } from "../model-routing/types.js";
import type { Decision } from "../types.js";
import { selectMotivationCandidates } from "../agency/candidate-selection.js";
import { resolveEvidenceRefs } from "../agency/resolve-evidence.js";
import { composeTurnContext, mindStateBlock } from "../context-composer.js";
import { expressSpeak } from "../conversation/expression.js";
import type { ExpressionComplete } from "../conversation/expression-fallback.js";
import { upsertMindStateItem } from "../state/mind-items.js";
import { admitOwnerCorrection } from "./corrections.js";
import { cutoverMemoryAssertions } from "./cutover.js";
import { insertAssertion } from "./assertions.js";
import { createEpisode } from "./episodes.js";
import {
  influenceEligibleUnderAssertionsAt,
  mindStateItemInfluenceEligibleAt,
} from "./eligibility.js";
import {
  factInfluenceEligibleAt,
  factInfluenceEligibleUnderAssertionsAt,
  upsertFact,
} from "./facts.js";
import { assembleMemoryBlock } from "./assemble.js";
import {
  getHotMessages,
  insertMessage,
  resolveActiveThread,
} from "./threads.js";

const OWNER_ID = "doc";

function baseDecision(): Decision {
  return {
    trigger: "reactive",
    kind: "speak",
    motivationIds: [1],
    score: 100,
    reason: "reader test",
    evidenceRefs: [],
    uncertainty: 0.1,
    urgency: 0.1,
    thoughtSource: "deterministic",
    thoughtError: null,
    affectLicense: {
      permitted: false,
      valence: 0,
      activation: 0,
      openness: 0,
      tension: 0,
      reason: "none",
    },
    cognitiveAllocation: {
      shouldSpeak: true,
      effort: "medium",
      completion: "complete",
    },
    authorizedClaims: {
      readingRecordIds: [],
      readingTitles: [],
      readingClaims: [],
    },
  };
}

function sourceMessage(
  db: DatabaseSync,
  threadId: string,
  text: string,
): number {
  return insertMessage(db, {
    threadId,
    ownerId: OWNER_ID,
    role: "user",
    text,
    channel: "discord",
  });
}

function assertionIdForFact(db: DatabaseSync, factId: number): number {
  const row = db.prepare(
    `SELECT id FROM memory_assertions
     WHERE legacy_fact_id = ? LIMIT 1`,
  ).get(factId) as { id?: number } | undefined;
  if (row?.id == null) throw new Error("reader_test_fact_assertion_missing");
  return Number(row.id);
}

function insertEpisodeClaim(
  db: DatabaseSync,
  episodeId: number,
  claimText: string,
): number {
  const now = new Date().toISOString();
  const assertionId = insertAssertion(db, {
    ownerId: OWNER_ID,
    kind: "episode_claim",
    subjectFacet: "owner_model",
    lineageKind: "owner_designated",
    derivationKind: "observed",
    supportState: "supported",
    influenceClass: "I2",
    claimText,
    sourceKind: "reader_test",
    recordedAt: now,
    validFrom: now,
    worldIntervalBasis: "adjudicated",
    authorityFrom: now,
    authorityBasis: "adjudicated",
    dataClassification: "ordinary",
  });
  db.prepare(
    `INSERT INTO memory_episode_claims
       (episode_id, assertion_id, span_start, span_end, excerpt)
     VALUES (?, ?, 0, ?, ?)`,
  ).run(episodeId, assertionId, claimText.length, claimText);
  return assertionId;
}

describe("C1 reader cutover", () => {
  it("denies corrected facts and dependent Mind State in current influence paths", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const sourceId = sourceMessage(db, threadId, "I like coffee.");
      const factId = upsertFact(db, {
        ownerId: OWNER_ID,
        category: "preference",
        key: "coffee",
        value: "likes coffee",
        origin: "explicit_user",
        sourceMessageId: sourceId,
        sourceQuote: "I like coffee.",
      });
      const assertionId = assertionIdForFact(db, factId);
      expect(factInfluenceEligibleUnderAssertionsAt(db, OWNER_ID, factId)).toBe(true);
      cutoverMemoryAssertions(db);
      const mindStateId = upsertMindStateItem(db, {
        ownerId: OWNER_ID,
        kind: "interest",
        text: "Coffee preference is active.",
        sourceType: "fact",
        sourceId: factId,
        urgency: 0.2,
      });
      const correctionText = "I no longer like coffee.";
      const correctionMessageId = sourceMessage(db, threadId, correctionText);
      const correction = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: correctionMessageId,
        correctionOrdinal: 1,
        admissionPath: "conversational_deterministic",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "coffee preference",
        targets: [{
          assertionId,
          inclusionReason: "exact_key",
          resolutionBasis: "deterministic",
        }],
        capabilityMode: "apply",
        now: new Date(Date.now() - 1000).toISOString(),
      });

      expect(factInfluenceEligibleAt(db, OWNER_ID, factId)).toBe(false);
      expect(factInfluenceEligibleUnderAssertionsAt(db, OWNER_ID, factId)).toBe(false);
      expect(mindStateItemInfluenceEligibleAt(db, OWNER_ID, mindStateId)).toBe(false);
      expect(db.prepare(
        "SELECT id FROM mind_state_items WHERE id = ? AND status = 'active'",
      ).get(mindStateId)).toBeDefined();
      expect(mindStateBlock(db, OWNER_ID)).not.toContain("Coffee preference is active.");
      expect(selectMotivationCandidates(db, OWNER_ID, "reactive", [
        {
          id: 1,
          ownerId: OWNER_ID,
          kind: "fact",
          score: 80,
          refType: "fact",
          refId: factId,
          summary: "coffee: likes coffee",
        },
        {
          id: 2,
          ownerId: OWNER_ID,
          kind: "unfinished",
          score: 60,
          refType: "mind_state",
          refId: mindStateId,
          summary: "Coffee preference is active.",
        },
      ])).toEqual([]);

      expect(resolveEvidenceRefs(db, OWNER_ID, [{ type: "fact", id: factId }])).toEqual([]);
      const inspected = resolveEvidenceRefs(
        db,
        OWNER_ID,
        [{ type: "fact", id: factId }],
        { purpose: "inspect" },
      );
      expect(inspected).toEqual([
        expect.objectContaining({
          memory_context_role: "corrected_source_evidence",
          memory_assertion_ids: [assertionId],
          memory_correction_ids: [correction.correction.id],
        }),
      ]);
      expect(resolveEvidenceRefs(db, OWNER_ID, [{ type: "mind_state", id: mindStateId }])).toEqual([]);

      const hot = getHotMessages(db, threadId);
      expect(hot.find((message) => message.id === sourceId)).toEqual(
        expect.objectContaining({
          memory_context_role: "corrected_source_evidence",
          memory_assertion_ids: [assertionId],
          memory_correction_ids: [correction.correction.id],
        }),
      );
      const assembled = assembleMemoryBlock(db, OWNER_ID, {
        userMessage: correctionText,
        excludeMessageId: correctionMessageId,
      });
      expect(assembled.memoryBlock).toContain(
        "memory_context_role=corrected_source_evidence",
      );
      expect(assembled.memoryBlock).toContain("I like coffee.");

      const turn = composeTurnContext(db, OWNER_ID, {
        channel: "discord",
        userMessage: correctionText,
        decision: baseDecision(),
        excludeMessageId: correctionMessageId,
      });
      const providerPayloads: ChatMessage[][] = [];
      const complete: ExpressionComplete = async (messages, options) => {
        providerPayloads.push(messages);
        return { text: "Acknowledged.", model: options.model ?? "reader-test" };
      };
      await expressSpeak(
        turn,
        baseDecision(),
        correctionText,
        "discord",
        { attentionDb: db },
        complete,
      );
      const providerText = providerPayloads[0]
        ?.map((message) => message.content)
        .join("\n") ?? "";
      expect(providerText).toContain(
        "memory_context_role=corrected_source_evidence",
      );
      expect(providerText).toContain(`assertion_ids=${assertionId}`);
      expect(providerText).toContain(`correction_ids=${correction.correction.id}`);
    } finally {
      db.close();
    }
  });

  it("keeps episode evidence claim-granular and labels stale or corrected prose", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const first = sourceMessage(db, threadId, "The coffee claim is current.");
      const second = sourceMessage(db, threadId, "The tea claim is current.");
      const episode = createEpisode(db, {
        ownerId: OWNER_ID,
        threadId,
        summary: "Full episode prose combines the coffee and tea claims.",
        messageIds: [first, second],
        provenance: "live",
      });
      if (!episode) throw new Error("reader_test_episode_missing");
      const coffeeClaim = insertEpisodeClaim(db, episode.id, "Coffee claim remains current.");
      const teaClaim = insertEpisodeClaim(db, episode.id, "Tea claim remains current.");
      cutoverMemoryAssertions(db);

      expect(influenceEligibleUnderAssertionsAt(db, coffeeClaim)).toBe(true);

      const currentLines = resolveEvidenceRefs(db, OWNER_ID, [{ type: "episode", id: episode.id }]);
      expect(currentLines.map((line) => line.text)).toEqual([
        "Coffee claim remains current.",
        "Tea claim remains current.",
      ]);
      expect(currentLines.map((line) => line.label)).toEqual([
        `episode_claim:${coffeeClaim}`,
        `episode_claim:${teaClaim}`,
      ]);
      expect(currentLines.map((line) => line.text).join(" ")).not.toContain(
        "Full episode prose",
      );

      const correctionMessageId = sourceMessage(db, threadId, "The coffee claim was wrong.");
      const correction = admitOwnerCorrection(db, {
        ownerId: OWNER_ID,
        sourceMessageId: correctionMessageId,
        correctionOrdinal: 1,
        admissionPath: "typed_control",
        class: "INTERPRETATION_INVALIDATION",
        scopeText: "coffee claim",
        targets: [{
          assertionId: coffeeClaim,
          inclusionReason: "exact_key",
          resolutionBasis: "owner_confirmed",
        }],
        capabilityMode: "apply",
        now: new Date(Date.now() - 1000).toISOString(),
      });

      const afterCorrection = resolveEvidenceRefs(db, OWNER_ID, [{ type: "episode", id: episode.id }]);
      expect(afterCorrection.map((line) => line.label)).toEqual([`episode_claim:${teaClaim}`]);
      const inspected = resolveEvidenceRefs(
        db,
        OWNER_ID,
        [{ type: "episode", id: episode.id }],
        { purpose: "inspect" },
      );
      expect(inspected).toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: `corrected_source_evidence:episode_claim:${coffeeClaim}`,
          memory_context_role: "corrected_source_evidence",
          memory_assertion_ids: [coffeeClaim],
          memory_correction_ids: [correction.correction.id],
        }),
        expect.objectContaining({
          label: `episode_claim:${teaClaim}`,
          memory_context_role: "current_source_evidence",
        }),
      ]));
      expect(selectMotivationCandidates(db, OWNER_ID, "proactive", [{
        id: 8,
        ownerId: OWNER_ID,
        kind: "unfinished",
        score: 60,
        refType: "episode",
        refId: episode.id,
        summary: "Revisit the combined episode.",
      }])).toEqual([]);

      const staleMessage = sourceMessage(db, threadId, "A stale episode message.");
      const stale = createEpisode(db, {
        ownerId: OWNER_ID,
        threadId,
        summary: "Stale episode prose must remain inspectable only.",
        messageIds: [staleMessage],
        provenance: "live",
      });
      if (!stale) throw new Error("reader_test_stale_episode_missing");
      expect(resolveEvidenceRefs(db, OWNER_ID, [{ type: "episode", id: stale.id }])).toEqual([]);
      expect(resolveEvidenceRefs(
        db,
        OWNER_ID,
        [{ type: "episode", id: stale.id }],
        { purpose: "inspect" },
      )).toEqual([
        expect.objectContaining({
          memory_context_role: "historical_source_evidence",
          text: "Stale episode prose must remain inspectable only.",
        }),
      ]);
    } finally {
      db.close();
    }
  });

});
