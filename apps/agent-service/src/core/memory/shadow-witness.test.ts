import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import type { Decision, EvidenceRef, Motivation } from "../types.js";
import { insertAssertion } from "./assertions.js";
import { createEpisode } from "./episodes.js";
import { upsertFact } from "./facts.js";
import {
  insertMessage,
  resolveActiveThread,
} from "./threads.js";
import { upsertMindStateItem } from "../state/mind-items.js";
import {
  buildC1ShadowWitness,
  type C1ShadowWitnessInput,
} from "./shadow-witness.js";

const OWNER_ID = "doc";
const AT = "2026-08-20T12:00:00.000Z";
const AUTHORITY_FROM = "2026-01-01T00:00:00.000Z";

function openDb(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function sourceRefs(
  refs: EvidenceRef[],
  trigger: "reactive" | "proactive" = "reactive",
  facts: Array<{ id: number }> = [],
  hotMessages: Array<{ id: number }> = [],
  motivations: Motivation[] = [],
  decisionId = 77,
): C1ShadowWitnessInput {
  return {
    ownerId: OWNER_ID,
    decisionId,
    trigger,
    decision: {
      evidenceRefs: refs,
      motivationIds: motivations.map((motivation) => motivation.id ?? -1),
    } as Pick<Decision, "evidenceRefs" | "motivationIds">,
    motivations,
    turn: { facts, hotMessages },
    observedAt: AT,
  };
}

function motivation(
  id: number,
  refType: string,
  refId: number,
): Motivation {
  return {
    id,
    ownerId: OWNER_ID,
    kind: refType === "fact" ? "fact" : "unfinished",
    score: 80,
    refType,
    refId,
    summary: "source summary must never enter a receipt",
  };
}

function fact(
  db: DatabaseSync,
  key: string,
  overrides: {
    subjectFacet?: "owner_model" | "external_verifiable" | "ashley_side" | "unknown";
    derivationKind?: "observed" | "derived";
    supportState?: "supported" | "unsupported" | "uncertain";
    influenceClass?: "I0" | "I1" | "I2" | "I3";
    authorityFrom?: string | null;
    authorityTo?: string | null;
    terminationReason?: "superseded" | "invalidated" | "forgotten" | "scope_refined" | "source_disputed" | null;
  } = {},
): { factId: number; assertionId: number } {
  const factId = upsertFact(db, {
    ownerId: OWNER_ID,
    category: "preference",
    key,
    value: `${key} value`,
    origin: "explicit_user",
  });
  const row = db.prepare(
    "SELECT id FROM memory_assertions WHERE legacy_fact_id = ?",
  ).get(factId) as { id?: number } | undefined;
  if (row?.id == null) throw new Error("shadow_witness_fact_assertion_missing");
  db.prepare(
    `UPDATE memory_assertions
     SET subject_facet = ?, derivation_kind = ?, support_state = ?,
         influence_class = ?, recorded_at = ?, authority_from = ?,
         authority_to = ?, authority_basis = 'adjudicated',
         termination_reason = ?
     WHERE id = ?`,
  ).run(
    overrides.subjectFacet ?? "owner_model",
    overrides.derivationKind ?? "observed",
    overrides.supportState ?? "supported",
    overrides.influenceClass ?? "I2",
    AUTHORITY_FROM,
    overrides.authorityFrom === undefined ? AUTHORITY_FROM : overrides.authorityFrom,
    overrides.authorityTo ?? null,
    overrides.terminationReason ?? null,
    row.id,
  );
  return { factId, assertionId: Number(row.id) };
}

function messageWithAssertion(
  db: DatabaseSync,
  text: string,
  overrides: {
    subjectFacet?: "owner_model" | "external_verifiable" | "ashley_side" | "unknown";
    derivationKind?: "observed" | "derived";
    supportState?: "supported" | "unsupported" | "uncertain";
    influenceClass?: "I0" | "I1" | "I2" | "I3";
  } = {},
): { messageId: number; assertionId: number } {
  const threadId = resolveActiveThread(db, OWNER_ID, "discord");
  const messageId = insertMessage(db, {
    threadId,
    ownerId: OWNER_ID,
    role: "user",
    text,
    channel: "discord",
  });
  const assertionId = insertAssertion(db, {
    ownerId: OWNER_ID,
    kind: "owner_interpretation",
    subjectFacet: overrides.subjectFacet ?? "owner_model",
    lineageKind: "owner_designated",
    derivationKind: overrides.derivationKind ?? "observed",
    supportState: overrides.supportState ?? "supported",
    influenceClass: overrides.influenceClass ?? "I2",
    claimText: "message claim",
    sourceKind: "shadow-witness-test",
    sourceMessageId: messageId,
    recordedAt: AUTHORITY_FROM,
    authorityFrom: AUTHORITY_FROM,
    authorityBasis: "adjudicated",
    worldIntervalBasis: "adjudicated",
  });
  return { messageId, assertionId };
}

function episodeWithClaim(
  db: DatabaseSync,
  key: string,
  options: { secondClaim?: boolean } = {},
): { episodeId: number; assertionIds: number[]; sourceMessageId: number } {
  const source = messageWithAssertion(db, `${key} source message`);
  const threadId = resolveActiveThread(db, OWNER_ID, "discord");
  const episode = createEpisode(db, {
    ownerId: OWNER_ID,
    threadId,
    summary: `${key} episode summary must not enter the receipt`,
    messageIds: [source.messageId],
    provenance: "live",
  });
  if (!episode) throw new Error("shadow_witness_episode_missing");
  const first = db.prepare(
    "SELECT assertion_id FROM memory_episode_claims WHERE episode_id = ?",
  ).get(episode.id) as { assertion_id?: number } | undefined;
  if (first?.assertion_id == null) throw new Error("shadow_witness_episode_claim_missing");
  db.prepare(
    `UPDATE memory_assertions
     SET subject_facet = 'owner_model', lineage_kind = 'owner_designated',
         derivation_kind = 'observed', support_state = 'supported',
         influence_class = 'I2', recorded_at = ?, authority_from = ?,
         authority_basis = 'adjudicated', termination_reason = NULL
     WHERE id = ?`,
  ).run(AUTHORITY_FROM, AUTHORITY_FROM, first.assertion_id);
  const assertionIds = [Number(first.assertion_id)];
  if (options.secondClaim) {
    const second = insertAssertion(db, {
      ownerId: OWNER_ID,
      kind: "episode_claim",
      subjectFacet: "owner_model",
      lineageKind: "owner_designated",
      derivationKind: "observed",
      supportState: "supported",
      influenceClass: "I2",
      claimText: "second claim",
      sourceKind: "shadow-witness-test",
      recordedAt: AUTHORITY_FROM,
      validFrom: AUTHORITY_FROM,
      worldIntervalBasis: "adjudicated",
      authorityFrom: AUTHORITY_FROM,
      authorityBasis: "adjudicated",
    });
    db.prepare(
      `INSERT INTO memory_episode_claims
         (episode_id, assertion_id, span_start, span_end, excerpt)
       VALUES (?, ?, 0, 12, 'second claim')`,
    ).run(episode.id, second);
    assertionIds.push(second);
  }
  return { episodeId: episode.id, assertionIds, sourceMessageId: source.messageId };
}

function mindStateForFact(db: DatabaseSync, factId: number): number {
  return upsertMindStateItem(db, {
    ownerId: OWNER_ID,
    kind: "interest",
    text: "Mind-state source summary must not enter the receipt",
    sourceType: "fact",
    sourceId: factId,
  });
}

function receiptFor(
  db: DatabaseSync,
  refs: EvidenceRef[],
  options: {
    trigger?: "reactive" | "proactive";
    facts?: Array<{ id: number }>;
    hotMessages?: Array<{ id: number }>;
    motivations?: Motivation[];
    decisionId?: number;
  } = {},
) {
  const result = buildC1ShadowWitness(db, sourceRefs(
    refs,
    options.trigger,
    options.facts,
    options.hotMessages,
    options.motivations,
    options.decisionId,
  ));
  if (!result.witness) throw new Error("shadow_witness_receipt_missing");
  return result.witness;
}

describe("C1 semantic shadow witness", () => {
  it("maps facts, episodes, Mind State, and hot messages without storing their text", () => {
    const db = openDb();
    try {
      const currentFact = fact(db, "current-fact");
      const episode = episodeWithClaim(db, "current-episode");
      const mindStateId = mindStateForFact(db, currentFact.factId);
      const hot = messageWithAssertion(db, "hot message raw text must not persist");
      const motivations = [
        motivation(1, "episode", episode.episodeId),
        motivation(2, "mind_state", mindStateId),
      ];
      const witness = receiptFor(
        db,
        [
          { type: "fact", id: currentFact.factId },
          { type: "episode", id: episode.episodeId },
          { type: "mind_state", id: mindStateId },
          { type: "message", id: hot.messageId },
        ],
        {
          facts: [{ id: currentFact.factId }],
          hotMessages: [{ id: hot.messageId }],
          motivations,
        },
      );
      expect(witness).toMatchObject({
        decisionClass: "same_current",
        qualifies: true,
        sourceCount: 4,
        countsBySourceType: { fact: 1, episode: 1, mind_state: 1, hot_message: 1 },
      });
      expect(witness.sampledSources).toHaveLength(4);
      expect(JSON.stringify(witness)).not.toContain("hot message raw text");
      expect(JSON.stringify(witness)).not.toContain("episode summary");
      expect(JSON.stringify(witness)).not.toContain("source summary");
      expect(JSON.stringify(witness)).not.toContain("provider");
    } finally {
      db.close();
    }
  });

  it("gives owner self-description precedence over a conflicting Ashley-derived interpretation", () => {
    const db = openDb();
    try {
      const derived = fact(db, "derived-owner", {
        derivationKind: "derived",
        influenceClass: "I1",
      });
      const owner = insertAssertion(db, {
        ownerId: OWNER_ID,
        kind: "owner_interpretation",
        subjectFacet: "owner_model",
        lineageKind: "explicit_seed",
        derivationKind: "observed",
        supportState: "supported",
        influenceClass: "I2",
        claimText: "owner said the conflicting thing",
        sourceKind: "owner",
        recordedAt: AUTHORITY_FROM,
        authorityFrom: AUTHORITY_FROM,
        authorityBasis: "adjudicated",
        worldIntervalBasis: "adjudicated",
      });
      db.prepare(
        `INSERT INTO memory_contradictions
           (owner_id, left_assertion_id, right_assertion_id, kind, status, created_at)
         VALUES (?, ?, ?, 'owner_self_vs_derived', 'open', ?)` ,
      ).run(OWNER_ID, owner, derived.assertionId, AT);
      const witness = receiptFor(db, [{ type: "fact", id: derived.factId }], {
        facts: [{ id: derived.factId }],
      });
      expect(witness.decisionClass).toBe("would_filter");
      expect(witness.sampledSources[0]).toMatchObject({
        action: "deny",
        reason: "open_contradiction",
      });
    } finally {
      db.close();
    }
  });

  it("keeps recorded event evidence scoped to that event and does not promote Ashley history to owner truth", () => {
    const db = openDb();
    try {
      const historical = fact(db, "historical-ashley", {
        subjectFacet: "ashley_side",
      });
      const event = messageWithAssertion(db, "recorded event", {
        subjectFacet: "external_verifiable",
      });
      const witness = receiptFor(db, [
        { type: "fact", id: historical.factId },
        { type: "message", id: event.messageId },
      ], { facts: [{ id: historical.factId }], hotMessages: [{ id: event.messageId }] });
      expect(witness.decisionClass).toBe("mixed_change");
      expect(witness.sampledSources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sourceType: "fact",
          action: "label_historical",
          reason: "historical_only",
        }),
        expect.objectContaining({
          sourceType: "hot_message",
          action: "include_current",
          reason: "eligible_current",
        }),
      ]));
    } finally {
      db.close();
    }
  });

  it("does not let confidence change eligibility or action", () => {
    const db = openDb();
    try {
      const low = fact(db, "low-confidence", { influenceClass: "I2" });
      const high = fact(db, "high-confidence", { influenceClass: "I2" });
      db.prepare("UPDATE memory_assertions SET confidence = 0.01 WHERE id = ?").run(low.assertionId);
      db.prepare("UPDATE memory_assertions SET confidence = 0.99 WHERE id = ?").run(high.assertionId);
      const witness = receiptFor(db, [
        { type: "fact", id: low.factId },
        { type: "fact", id: high.factId },
      ], { facts: [{ id: low.factId }, { id: high.factId }] });
      expect(witness.decisionClass).toBe("same_current");
      expect(witness.sampledSources.map((source) => source.action)).toEqual([
        "include_current",
        "include_current",
      ]);
    } finally {
      db.close();
    }
  });

  it("fails closed for unsupported disagreement and preserves the identity store", () => {
    const db = openDb();
    try {
      const uncertain = fact(db, "uncertain", { supportState: "uncertain" });
      const before = Number((db.prepare("SELECT COUNT(*) AS count FROM identity_entries").get() as { count: number }).count);
      const witness = receiptFor(db, [{ type: "fact", id: uncertain.factId }], {
        facts: [{ id: uncertain.factId }],
      });
      const after = Number((db.prepare("SELECT COUNT(*) AS count FROM identity_entries").get() as { count: number }).count);
      expect(witness.decisionClass).toBe("would_filter");
      expect(witness.sampledSources[0]).toMatchObject({ action: "deny" });
      expect(after).toBe(before);
    } finally {
      db.close();
    }
  });

  it("terminates corrected influence, preserves correction provenance, and never revives it", () => {
    const db = openDb();
    try {
      const corrected = fact(db, "corrected", { terminationReason: "invalidated" });
      const threadId = resolveActiveThread(db, OWNER_ID, "discord");
      const correctionMessageId = insertMessage(db, {
        threadId,
        ownerId: OWNER_ID,
        role: "user",
        text: "correction raw text",
        channel: "discord",
      });
      const correctionId = Number(db.prepare(
        `INSERT INTO memory_corrections
           (entity_uuid, owner_id, source_message_id, correction_ordinal,
            admission_path, class, scope_text, proposal_json, lifecycle_status,
            stop_required, idempotency_key, capability_mode_at_write)
         VALUES (lower(hex(randomblob(16))), ?, ?, 1, 'typed_control',
                 'INTERPRETATION_INVALIDATION', 'scope', '{}', 'applied', 1,
                 ?, 'apply')`,
      ).run(OWNER_ID, correctionMessageId, `shadow-correction:${correctionMessageId}`).lastInsertRowid);
      db.prepare(
        `INSERT INTO memory_correction_targets
           (correction_id, assertion_id, inclusion_reason, resolution_basis, application_state)
         VALUES (?, ?, 'exact_key', 'owner_confirmed', 'applied')`,
      ).run(correctionId, corrected.assertionId);
      const witness = receiptFor(db, [{ type: "fact", id: corrected.factId }], {
        facts: [{ id: corrected.factId }],
      });
      expect(witness.decisionClass).toBe("would_relabel");
      expect(witness.sampledSources[0]).toMatchObject({
        action: "label_corrected",
        reason: "corrected_history",
        correctionIds: [String(correctionId)],
      });
      expect(witness.sampledSources[0]?.action).not.toBe("include_current");
    } finally {
      db.close();
    }
  });

  it("classifies mixed action families deterministically", () => {
    const db = openDb();
    try {
      const current = fact(db, "mixed-current");
      const corrected = fact(db, "mixed-corrected", { terminationReason: "invalidated" });
      const witness = receiptFor(db, [
        { type: "fact", id: current.factId },
        { type: "fact", id: corrected.factId },
      ], { facts: [{ id: current.factId }, { id: corrected.factId }] });
      expect(witness).toMatchObject({
        decisionClass: "mixed_change",
        qualifies: true,
        sourceCount: 2,
      });
    } finally {
      db.close();
    }
  });

  it("uses explicit no-material and unmapped-fail-closed classes", () => {
    const db = openDb();
    try {
      const empty = receiptFor(db, [{ type: "identity", id: 1 }]);
      expect(empty).toMatchObject({
        decisionClass: "no_c1_material",
        qualifies: false,
        sourceCount: 0,
        omittedSourceCount: 0,
      });
      const missing = receiptFor(db, [{ type: "fact", id: 999999 }]);
      expect(missing).toMatchObject({
        decisionClass: "unmapped_fail_closed",
        qualifies: false,
        sourceCount: 1,
      });
      expect(missing.sampledSources[0]).toMatchObject({
        action: "deny",
        reason: "source_missing",
      });
    } finally {
      db.close();
    }
  });

  it("keeps source order out of the digest and receipt class", () => {
    const db = openDb();
    try {
      const first = fact(db, "order-first");
      const second = fact(db, "order-second");
      const refs = [
        { type: "fact", id: first.factId } as const,
        { type: "fact", id: second.factId } as const,
      ];
      const facts = [{ id: first.factId }, { id: second.factId }];
      const left = receiptFor(db, refs, { facts });
      const right = receiptFor(db, [...refs].reverse(), { facts: [...facts].reverse() });
      expect(right.candidateDigestSha256).toBe(left.candidateDigestSha256);
      expect(right.decisionClass).toBe(left.decisionClass);
      expect(right.sampledSources).toEqual(left.sampledSources);
    } finally {
      db.close();
    }
  });

  it("enforces candidate, sample, and per-source identifier bounds", () => {
    const db = openDb();
    try {
      const facts = Array.from({ length: 33 }, (_, index) => fact(db, `bound-${index}`));
      const overflow = receiptFor(
        db,
        facts.map(({ factId }) => ({ type: "fact", id: factId })),
        { facts: facts.map(({ factId }) => ({ id: factId })) },
      );
      expect(overflow).toMatchObject({
        decisionClass: "evaluation_error",
        qualifies: false,
        errorCode: "candidate_overflow",
      });

      const bounded = facts.slice(0, 13);
      const sample = receiptFor(
        db,
        bounded.map(({ factId }) => ({ type: "fact", id: factId })),
        { facts: bounded.map(({ factId }) => ({ id: factId })) },
      );
      expect(sample.sourceCount).toBe(13);
      expect(sample.sampledSources).toHaveLength(12);
      expect(sample.omittedSourceCount).toBe(1);
      expect(sample.sampledSources.every((source) =>
        source.assertionIds.length <= 8 && source.correctionIds.length <= 8,
      )).toBe(true);
    } finally {
      db.close();
    }
  });
});
