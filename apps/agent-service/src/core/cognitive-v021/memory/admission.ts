import type { DatabaseSync } from "node:sqlite";
import {
  canEnterModelContext,
  maxClassification,
} from "../../privacy/classification.js";
import { getConversationEvidence } from "../evidence/conversation-log.js";
import type {
  ConversationEvidenceRecord,
  MemoryAssertion,
  DurableNomination,
  SourceSupportRef,
} from "../types.js";
import {
  getDurableNomination,
  listDurableNominations,
  type DurableNominationRecord,
} from "./nomination.js";
import { appendMemorySupport, listMemorySupports, supportConversationId } from "./supports.js";
import { recordMemoryFormation } from "./strength.js";
import { parseSourceSupportRef, validateSourceSupportRefs, type ResolvedSource } from "../evidence/interpretation-envelope.js";
import { getMemoryAssertion, REDACTED_MEMORY_STATEMENT, upsertMemoryAssertion } from "./assertions.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";
import { hasStructuredCurrentnessEntitlement } from "../authority/check.js";
import {
  AUTOMATIC_ADMISSION_KINDS,
  alignConversationSpans,
  canReplaceMemoryKind,
  isGroundedForKind,
  ownerQuotedRowIds,
} from "./grounding.js";
import {
  prepareExternalSocialNomination,
  type PreparedExternalSocialRevision,
} from "../social/continuity-memory.js";

type DbRow = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function publishedDurableNominations(
  settlement: { payload_json?: unknown } | null,
): Record<string, unknown>[] {
  if (!settlement || typeof settlement.payload_json !== "string") return [];
  try {
    const payload = record(JSON.parse(settlement.payload_json));
    return Array.isArray(payload?.durableNominations)
      ? payload.durableNominations.map(record).filter((value): value is Record<string, unknown> => value !== null)
      : [];
  } catch {
    return [];
  }
}

function publishedNominationMatches(
  published: Record<string, unknown>,
  nomination: DurableNomination,
): boolean {
  return published.nominationId === nomination.nominationId
    && published.assertionKey === nomination.assertionKey
    && published.statement === nomination.statement
    && published.memoryKind === nomination.memoryKind;
}

function publishedSupportRefs(
  settlement: { payload_json?: unknown } | null,
  nomination: DurableNomination,
): unknown[] {
  const published = publishedDurableNominations(settlement)
    .find((item) => publishedNominationMatches(item, nomination));
  if (!published || published.supportRefs === undefined) return [];
  if (!Array.isArray(published.supportRefs)) throw new Error("support_ref_invalid");
  return published.supportRefs;
}

function isAshleyInterpretationForStatement(
  published: Record<string, unknown>,
  statement: string,
): boolean {
  const dimensions = record(published.dimensions);
  return published.memoryKind === "learned_self_evidence"
    && published.statement === statement
    && dimensions?.source === "ashley_interpretation";
}

/** Published Thought durable nominations are the only learned-self adoption witness. */
export function isLearnedSelfThoughtAdopted(
  nomination: DurableNomination,
  settlement: { payload_json?: unknown } | null,
): boolean {
  const published = publishedDurableNominations(settlement);
  const candidate = published.find((item) => publishedNominationMatches(item, nomination));
  if (!candidate) return false;

  const ownerOrigin = nomination.dimensions.source === "owner_utterance"
    && nomination.dimensions.reliability === "owner_supplied";
  if (!ownerOrigin) return true;

  return published.some((item) => item !== candidate && isAshleyInterpretationForStatement(item, nomination.statement));
}

/** Adoption is proven by the published settlement/nomination, not by a support pointer. */
export function hasLearnedSelfThoughtAdoption(db: DatabaseSync, assertionKey: string): boolean {
  const rows = db.prepare(
    "SELECT nomination_id FROM durable_nominations WHERE assertion_key = ? ORDER BY generation ASC, nomination_id ASC",
  ).all(assertionKey) as Array<{ nomination_id?: unknown }>;
  for (const row of rows) {
    const nomination = getDurableNomination(db, String(row.nomination_id ?? ""));
    if (!nomination || nomination.statement === REDACTED_MEMORY_STATEMENT) continue;
    const settlement = settlementForNomination(db, nomination);
    if (!settlement) continue;
    if (isLearnedSelfThoughtAdopted(nomination, settlement)) return true;
  }
  return false;
}

export type AdmissionResult = {
  nominationId: string;
  assertionKey: string;
  result:
    | "admitted"
    | "admission_skipped_superseded"
    | "admission_skipped_secret"
    | "admission_skipped_unpublished"
    | "admission_skipped_generation"
    | "admission_skipped_retracted"
    | "admission_skipped_provenance";
  assertion: MemoryAssertion | null;
};

export type AdmissionTickResult = {
  considered: number;
  admitted: number;
  skippedSuperseded: number;
  skippedSecret: number;
  skippedUnpublished: number;
  skippedGeneration: number;
  skippedRetracted: number;
  skippedProvenance: number;
  results: AdmissionResult[];
};

export type AdmissionOptions = {
  nowMs?: number;
  nominationIds?: string[];
  limit?: number;
  /** Restrict a worker scan to explicitly governed MemoryKinds. */
  allowedKinds?: readonly import("../types.js").MemoryKind[];
  /** Alias for callers that use the retrieval vocabulary. */
  memoryKinds?: readonly import("../types.js").MemoryKind[];
  /** Apply the per-kind evidence rule of grounded automatic admission. */
  requireGrounding?: boolean;
  /** Skip nominations that already have a recorded admission decision. */
  undecidedOnly?: boolean;
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function currentConversationGeneration(db: DatabaseSync, cycleId: string): { conversationId: string; generation: number } | null {
  const row = db.prepare(
    `SELECT conversation_id, MAX(generation) AS generation
       FROM cycle_records
      WHERE conversation_id = (SELECT conversation_id FROM cycle_records WHERE cycle_id = ? LIMIT 1)`,
  ).get(cycleId) as DbRow | undefined;
  if (!row) return null;
  return { conversationId: text(row.conversation_id), generation: number(row.generation) };
}

function settlementForNomination(db: DatabaseSync, nomination: DurableNomination): DbRow | null {
  return db.prepare(
    `SELECT s.settlement_id, s.cycle_id, s.generation, s.payload_json
       FROM settlements s
      WHERE s.cycle_id = ? AND s.generation = ?
      LIMIT 1`,
  ).get(nomination.cycleId, nomination.generation) as DbRow | null;
}

function laterPublishedSuperseder(
  db: DatabaseSync,
  nomination: DurableNomination,
  conversationId: string,
): DbRow | null {
  return db.prepare(
    `SELECT n.nomination_id, n.assertion_key, n.generation, s.settlement_id
       FROM durable_nominations n
       JOIN settlements s ON s.cycle_id = n.cycle_id AND s.generation = n.generation
       JOIN cycle_records c ON c.cycle_id = n.cycle_id
      WHERE n.supersedes_assertion_key = ?
        AND n.generation > ?
        AND c.conversation_id = ?
      ORDER BY n.generation ASC, n.nomination_id ASC
      LIMIT 1`,
  ).get(nomination.assertionKey, nomination.generation, conversationId) as DbRow | null;
}

function hasLog(db: DatabaseSync, nominationId: string, result: AdmissionResult["result"]): boolean {
  const row = db.prepare(
    "SELECT 1 AS present FROM admission_log WHERE nomination_id = ? AND result = ? LIMIT 1",
  ).get(nominationId, result);
  return row !== undefined && row !== null;
}

function logAdmission(db: DatabaseSync, result: AdmissionResult, nowMs: number): void {
  if (hasLog(db, result.nominationId, result.result)) return;
  db.prepare(
    `INSERT INTO admission_log (nomination_id, assertion_key, result, generation, created_at_ms)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(result.nominationId, result.assertionKey, result.result, result.assertion == null ? 0 : result.assertion.admittedGeneration ?? 0, nowMs);
}

function resolveNominationSourceRefs(
  db: DatabaseSync,
  nomination: DurableNominationRecord | DurableNomination,
  settlementRow?: DbRow | null,
): string[] {
  if (nomination.sourceRefs && Array.isArray(nomination.sourceRefs) && nomination.sourceRefs.length > 0) {
    return nomination.sourceRefs;
  }
  if (settlementRow && typeof settlementRow.payload_json === "string") {
    try {
      const payload = JSON.parse(settlementRow.payload_json);
      const matched = payload?.durableNominations?.find(
        (n: any) => n.nominationId === nomination.nominationId || n.assertionKey === nomination.assertionKey,
      );
      if (matched && Array.isArray(matched.sourceRefs) && matched.sourceRefs.length > 0) {
        return matched.sourceRefs;
      }
    } catch {}
  }
  try {
    const row = db.prepare("SELECT source_refs_json FROM durable_nominations WHERE nomination_id = ?").get(nomination.nominationId) as DbRow | undefined;
    if (row && typeof row.source_refs_json === "string") {
      const parsed = JSON.parse(row.source_refs_json);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

function findVerifiedOwnerEvidence(
  db: DatabaseSync,
  sourceRefs: readonly string[],
): { rowId: string; conversationId: string } | null {
  for (const ref of sourceRefs) {
    if (!ref || typeof ref !== "string") continue;
    const row = db.prepare(
      `SELECT row_id, conversation_id, role, text, data_classification, secret_omitted
         FROM conversation_evidence_log
        WHERE (row_id = ? OR lineage_id = ?)
        ORDER BY created_at_ms DESC
        LIMIT 1`,
    ).get(ref, ref) as {
      row_id: string;
      conversation_id: string;
      role: string;
      text: string | null;
      data_classification: string;
      secret_omitted: number;
    } | undefined;

    if (
      row &&
      row.role === "owner" &&
      row.text !== null &&
      row.data_classification !== "secret" &&
      Number(row.secret_omitted) === 0
    ) {
      return { rowId: row.row_id, conversationId: row.conversation_id };
    }
  }
  return null;
}

function isSocialConversationId(conversationId: string): boolean {
  return conversationId.startsWith("dm:") || conversationId.startsWith("room:");
}

type ResolvedSupport = {
  refs: SourceSupportRef[];
  resolved: ResolvedSource[];
  /** The conversation each ref belongs to; supports are validated against it. */
  conversationIds: string[];
};

/**
 * Typed support resolves in the nominating conversation, except that an
 * Owner-private cycle may quote the Owner from any conversation recall showed
 * it (R7). The cited row must still resolve to the Owner principal.
 */
function resolveTypedSupport(
  db: DatabaseSync,
  values: readonly unknown[],
  conversationId: string,
): ResolvedSupport {
  const result: ResolvedSupport = { refs: [], resolved: [], conversationIds: [] };
  for (const value of values) {
    const ref = parseSourceSupportRef(value);
    if (!ref) throw new Error("support_ref_invalid");
    let refConversationId = conversationId;
    if (ref.kind === "conversation_text_span" && !isSocialConversationId(conversationId)) {
      const rowConversationId = getConversationEvidence(db, ref.evidenceRowId)?.conversationId;
      if (rowConversationId && rowConversationId !== conversationId) refConversationId = rowConversationId;
    }
    const [resolved] = validateSourceSupportRefs(db, [ref], refConversationId);
    if (refConversationId !== conversationId && resolved?.principalKind !== "owner") {
      throw new Error("support_ref_unresolvable");
    }
    result.refs.push(ref);
    result.resolved.push(resolved!);
    result.conversationIds.push(refConversationId);
  }
  return result;
}

/**
 * R6 merge: a memory that restates or replaces live ones carries their still
 * resolvable support forward, so a merged Owner fact stays grounded by the
 * Owner's own words. Owner-origin memories inherit only Owner support.
 */
function inheritedSupport(
  db: DatabaseSync,
  assertionKeys: readonly string[],
  ownerOrigin: boolean,
): ResolvedSupport {
  const result: ResolvedSupport = { refs: [], resolved: [], conversationIds: [] };
  const seen = new Set<string>();
  for (const key of new Set(assertionKeys)) {
    const previous = getMemoryAssertion(db, key);
    if (!previous?.live) continue;
    for (const support of listMemorySupports(db, key)) {
      if (!support.supportRef) continue;
      const identity = JSON.stringify(support.supportRef);
      if (seen.has(identity)) continue;
      const refConversationId = supportConversationId(db, support);
      if (!refConversationId) continue;
      try {
        const [resolved] = validateSourceSupportRefs(db, [support.supportRef], refConversationId);
        if (!resolved || (ownerOrigin && resolved.principalKind !== "owner")) continue;
        seen.add(identity);
        result.refs.push(support.supportRef);
        result.resolved.push(resolved);
        result.conversationIds.push(refConversationId);
      } catch {
        // A forgotten, redacted or edited source no longer supports anything.
      }
    }
  }
  return result;
}

function admitOne(
  db: DatabaseSync,
  nomination: DurableNominationRecord,
  nowMs: number,
  options: { requireCurrentGeneration?: number; currentnessEntitled?: boolean; requireGrounding?: boolean } = {},
): AdmissionResult {
  const noAssertion = (result: AdmissionResult["result"]): AdmissionResult => ({ nominationId: nomination.nominationId, assertionKey: nomination.assertionKey, result, assertion: null });
  if (nomination.dataClassification === "secret") {
    const result = noAssertion("admission_skipped_secret");
    logAdmission(db, result, nowMs);
    return result;
  }
  if (nomination.statement === REDACTED_MEMORY_STATEMENT) {
    const result = noAssertion("admission_skipped_retracted");
    logAdmission(db, result, nowMs);
    return result;
  }
  const settlement = settlementForNomination(db, nomination);
  if (!settlement) {
    const result = noAssertion("admission_skipped_unpublished");
    logAdmission(db, result, nowMs);
    return result;
  }
  if (nomination.memoryKind === "learned_self_evidence") {
    const published = publishedDurableNominations(settlement);
    if (!published.some((item) => publishedNominationMatches(item, nomination))) {
      const result = noAssertion("admission_skipped_unpublished");
      logAdmission(db, result, nowMs);
      return result;
    }
    if (!isLearnedSelfThoughtAdopted(nomination, settlement)) {
      const result = noAssertion("admission_skipped_provenance");
      logAdmission(db, result, nowMs);
      return result;
    }
  }
  const current = currentConversationGeneration(db, nomination.cycleId);
  if (!current) {
    const result = noAssertion("admission_skipped_generation");
    logAdmission(db, result, nowMs);
    return result;
  }
  if (options.requireCurrentGeneration != null && current.generation !== options.requireCurrentGeneration) {
    const result = noAssertion("admission_skipped_generation");
    logAdmission(db, result, nowMs);
    return result;
  }
  const superseder = laterPublishedSuperseder(db, nomination, current.conversationId);
  if (superseder) {
    const result = noAssertion("admission_skipped_superseded");
    logAdmission(db, result, nowMs);
    return result;
  }

  // R6: never let a weaker-grounded kind replace a memory, by key or by supersession.
  const replacedKeys = [nomination.assertionKey, nomination.supersedesAssertionKey]
    .filter((key): key is string => typeof key === "string" && key.length > 0);
  for (const key of replacedKeys) {
    const previous = getMemoryAssertion(db, key);
    if (previous?.live && !canReplaceMemoryKind(nomination.memoryKind, previous.memoryKind)) {
      const result = noAssertion("admission_skipped_provenance");
      logAdmission(db, result, nowMs);
      return result;
    }
  }

  // 1. Typed support refs use the same current-source resolver as Working Context.
  let typed: ResolvedSupport;
  try {
    typed = resolveTypedSupport(db, alignConversationSpans(db, publishedSupportRefs(settlement, nomination)), current.conversationId);
  } catch {
    const result = noAssertion("admission_skipped_provenance");
    logAdmission(db, result, nowMs);
    return result;
  }
  const isOwnerOrigin = nomination.dimensions.source === "owner_utterance" || nomination.dimensions.reliability === "owner_supplied";
  if (isOwnerOrigin && typed.resolved.some((source) => source.principalKind !== "owner")) {
    const result = noAssertion("admission_skipped_provenance");
    logAdmission(db, result, nowMs);
    return result;
  }
  const inherited = inheritedSupport(db, replacedKeys, isOwnerOrigin);
  const typedSupportRefs = [...typed.refs, ...inherited.refs];
  const resolvedTypedSupport = [...typed.resolved, ...inherited.resolved];
  const supportConversationIds = [...typed.conversationIds, ...inherited.conversationIds];

  if (options.requireGrounding
    && !isGroundedForKind(nomination.memoryKind, typedSupportRefs, resolvedTypedSupport, {
      socialConversation: isSocialConversationId(current.conversationId),
    })) {
    const result = noAssertion("admission_skipped_provenance");
    logAdmission(db, result, nowMs);
    return result;
  }

  // Legacy sourceRefs remain an independent admission input for existing readers.
  const sourceRefs = resolveNominationSourceRefs(db, nomination, settlement);

  if (isOwnerOrigin) {
    // A verbatim quote of an Owner message is at least as strong as a bare row ref.
    const verified = findVerifiedOwnerEvidence(db, [
      ...sourceRefs,
      ...ownerQuotedRowIds(typedSupportRefs, resolvedTypedSupport),
    ]);
    if (!verified) {
      const hasSecretRef = sourceRefs.some((ref) => {
        const row = db.prepare("SELECT data_classification, secret_omitted FROM conversation_evidence_log WHERE row_id = ? OR lineage_id = ?").get(ref, ref) as DbRow | undefined;
        return row && (row.data_classification === "secret" || Number(row.secret_omitted) === 1);
      });
      const result = noAssertion(hasSecretRef ? "admission_skipped_secret" : "admission_skipped_provenance");
      logAdmission(db, result, nowMs);
      return result;
    }
  }

  // 2. Currentness entitlement validation:
  // When candidate assertion has: time === "current"
  if (nomination.dimensions.time === "current") {
    let isEntitled = options.currentnessEntitled;
    if (isEntitled === undefined) {
      try {
        const payload = typeof settlement.payload_json === "string" ? JSON.parse(settlement.payload_json) : settlement.payload_json;
        isEntitled = hasStructuredCurrentnessEntitlement(
          payload,
          payload?.currentnessWitness ?? payload?.currentness,
        );
      } catch {
        isEntitled = false;
      }
    }
    if (!isEntitled) {
      const result = noAssertion("admission_skipped_provenance");
      logAdmission(db, result, nowMs);
      return result;
    }
  }

  // Social nominations must carry attributed external evidence through the
  // same audience/protection fence as the direct revision writer. Owner-path
  // nominations retain their existing admission behavior.
  let socialAdmission: PreparedExternalSocialRevision | null = null;
  // A contact quoted through typed support counts as external evidence too.
  const externalQuotedRowIds = typedSupportRefs.flatMap((ref, index) =>
    ref.kind === "conversation_text_span" && resolvedTypedSupport[index]?.principalKind === "external_human"
      ? [ref.evidenceRowId]
      : []);
  const socialSourceRefs = [...new Set([...sourceRefs, ...externalQuotedRowIds])];
  const externalSourceCount = socialSourceRefs.reduce((count, ref) => {
    const row = db.prepare(
      `SELECT 1 FROM conversation_evidence_log
        WHERE role = 'external_dialog' AND (row_id = ? OR lineage_id = ?)
        LIMIT 1`,
    ).get(ref, ref);
    return row ? count + 1 : count;
  }, 0);
  const socialConversation = current.conversationId.startsWith("dm:") || current.conversationId.startsWith("room:");
  if (externalSourceCount > 0 || (socialConversation && nomination.memoryKind === "learned_self_evidence")) {
    if (nomination.memoryKind !== "learned_self_evidence" && nomination.memoryKind !== "shared_episode") {
      const result = noAssertion("admission_skipped_provenance");
      logAdmission(db, result, nowMs);
      return result;
    }
    const prepared = prepareExternalSocialNomination(db, {
      statement: nomination.statement,
      memoryKind: nomination.memoryKind,
      dimensions: nomination.dimensions,
      dataClassification: nomination.dataClassification,
      sourceRefs: socialSourceRefs,
      lineageParentKey: nomination.supersedesAssertionKey,
    });
    if (!prepared.ok) {
      const result = noAssertion("admission_skipped_provenance");
      logAdmission(db, result, nowMs);
      return result;
    }
    socialAdmission = prepared.value;
  }

  const existing = db.prepare("SELECT data_classification FROM sidecar_memory_assertions WHERE assertion_key = ?").get(nomination.assertionKey) as DbRow | undefined;
  const effectiveClassification = maxClassification(
    existing?.data_classification === "ordinary" || existing?.data_classification === "sensitive" || existing?.data_classification === "never_public" || existing?.data_classification === "secret" ? existing.data_classification : null,
    nomination.dataClassification,
    socialAdmission?.effectiveClassification,
  );
  if (!canEnterModelContext(effectiveClassification, "private")) {
    const result = noAssertion("admission_skipped_secret");
    logAdmission(db, result, nowMs);
    return result;
  }
  const assertion = upsertMemoryAssertion(db, {
    assertionKey: nomination.assertionKey,
    statement: nomination.statement,
    memoryKind: nomination.memoryKind,
    dimensions: nomination.dimensions,
    dataClassification: effectiveClassification,
    lineageParentKey: nomination.supersedesAssertionKey,
    admittedGeneration: nomination.generation,
    live: true,
    ...(socialAdmission ? socialAdmission.facets : {}),
  });
  if (nomination.supersedesAssertionKey && nomination.supersedesAssertionKey !== nomination.assertionKey) {
    db.prepare(
      "UPDATE sidecar_memory_assertions SET live = 0, admitted_generation = NULL WHERE assertion_key = ?",
    ).run(nomination.supersedesAssertionKey);
  }
  appendMemorySupport(db, {
    supportId: `native:${nomination.nominationId}`,
    assertionKey: nomination.assertionKey,
    source: nomination.dimensions.source,
    provenance: "native",
    sourceArchitectureEpoch: "v0.2.1",
    sourceRef: nomination.nominationId,
    settlementId: text(settlement.settlement_id),
    evidenceLineageId: null,
    observationId: null,
    receiptId: null,
    dimensions: nomination.dimensions,
    dataClassification: effectiveClassification,
    createdAtMs: nowMs,
  });
  for (const [index, supportRef] of typedSupportRefs.entries()) {
    appendMemorySupport(db, {
      supportId: `native:${nomination.nominationId}:typed:${index}`,
      assertionKey: nomination.assertionKey,
      source: nomination.dimensions.source,
      provenance: "native",
      sourceArchitectureEpoch: "v0.2.1",
      sourceRef: nomination.nominationId,
      settlementId: text(settlement.settlement_id),
      evidenceLineageId: null,
      observationId: null,
      receiptId: null,
      dimensions: nomination.dimensions,
      dataClassification: effectiveClassification,
      supportRef,
      conversationId: supportConversationIds[index] ?? current.conversationId,
      createdAtMs: nowMs,
    });
  }
  if (socialAdmission) {
    for (const evidence of socialAdmission.evidence) {
      appendMemorySupport(db, {
        supportId: `social:evidence:${nomination.nominationId}:${evidence.rowId}`,
        assertionKey: nomination.assertionKey,
        source: "perception",
        provenance: "native",
        sourceArchitectureEpoch: "v0.2.1",
        sourceRef: evidence.rowId,
        settlementId: text(settlement.settlement_id),
        evidenceLineageId: evidence.lineageId,
        observationId: null,
        receiptId: null,
        dimensions: {
          source: "perception",
          status: "asserted",
          time: "historical",
          reliability: "fallible_observation",
        },
        dataClassification: evidence.dataClassification,
        createdAtMs: evidence.createdAtMs,
      });
    }
  }
  recordMemoryFormation(db, {
    assertionKey: nomination.assertionKey,
    salience: publishedDurableNominations(settlement)
      .find((item) => publishedNominationMatches(item, nomination))?.salience,
    nowMs,
  });
  db.prepare("UPDATE durable_nominations SET admitted = 1 WHERE nomination_id = ?").run(nomination.nominationId);
  const result: AdmissionResult = { nominationId: nomination.nominationId, assertionKey: nomination.assertionKey, result: "admitted", assertion };
  logAdmission(db, result, nowMs);
  return result;
}

export function tickAdmission(
  db: DatabaseSync,
  options: AdmissionOptions = {},
): AdmissionTickResult {
  const nowMs = options.nowMs ?? Date.now();
  const selected = listDurableNominations(db, {
    admitted: false,
    limit: options.limit,
    allowedKinds: options.allowedKinds,
    memoryKinds: options.memoryKinds,
    undecidedOnly: options.undecidedOnly,
  })
    .filter((nomination) => options.nominationIds == null || options.nominationIds.includes(nomination.nominationId));
  const result: AdmissionTickResult = {
    considered: selected.length,
    admitted: 0,
    skippedSuperseded: 0,
    skippedSecret: 0,
    skippedUnpublished: 0,
    skippedGeneration: 0,
    skippedRetracted: 0,
    skippedProvenance: 0,
    results: [],
  };
  const changedAssertionKeys = new Set<string>();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const nomination of selected) {
      const admitted = admitOne(db, nomination, nowMs, { requireGrounding: options.requireGrounding });
      result.results.push(admitted);
      switch (admitted.result) {
        case "admitted":
          result.admitted += 1;
          if (admitted.assertion) {
            changedAssertionKeys.add(admitted.assertion.assertionKey);
            if (nomination.supersedesAssertionKey && nomination.supersedesAssertionKey !== nomination.assertionKey) {
              changedAssertionKeys.add(nomination.supersedesAssertionKey);
            }
          }
          break;
        case "admission_skipped_superseded": result.skippedSuperseded += 1; break;
        case "admission_skipped_secret": result.skippedSecret += 1; break;
        case "admission_skipped_unpublished": result.skippedUnpublished += 1; break;
        case "admission_skipped_generation": result.skippedGeneration += 1; break;
        case "admission_skipped_retracted": result.skippedRetracted += 1; break;
        case "admission_skipped_provenance": result.skippedProvenance += 1; break;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
  try {
    if (changedAssertionKeys.size > 0) {
      notifySidecarPostCommit(db, { changedAssertionKeys: Array.from(changedAssertionKeys) });
    }
  } catch {
    // Derived sync failures must never disturb authoritative sidecar commit
  }
  return result;
}

export type GovernedAdmissionCatchupOptions = {
  nowMs?: number;
  nominationIds?: string[];
  limit?: number;
};

/**
 * Bounded lifecycle/startup catch-up: grounded automatic admission (Growth V1
 * §4.3). Every kind is eligible on the evidence its kind requires. A
 * nomination is decided once; a recorded skip is final, so rejected
 * nominations never sit pending or starve newer ones out of the bound.
 */
export function runGovernedAdmissionCatchup(
  db: DatabaseSync,
  options: GovernedAdmissionCatchupOptions = {},
): AdmissionTickResult {
  return tickAdmission(db, {
    ...options,
    allowedKinds: AUTOMATIC_ADMISSION_KINDS,
    requireGrounding: true,
    undecidedOnly: true,
  });
}

export type AdmitOwnerSuppliedClaimInput = {
  settlementId: string;
  nominationId: string;
  evidence?: ConversationEvidenceRecord | null;
  evidenceRowId?: string | null;
  currentnessEntitled?: boolean;
  nowMs?: number;
};

/** Immediate admission helper. It consumes Thought's kind; it never classifies the claim. */
export function admitOwnerSuppliedClaim(
  db: DatabaseSync,
  input: AdmitOwnerSuppliedClaimInput,
): AdmissionResult | null {
  const nomination = getDurableNomination(db, input.nominationId);
  if (!nomination) return null;
  const settlement = db.prepare("SELECT settlement_id, cycle_id, generation, payload_json FROM settlements WHERE settlement_id = ?").get(input.settlementId) as DbRow | undefined;
  if (!settlement || text(settlement.cycle_id) !== nomination.cycleId || number(settlement.generation) !== nomination.generation) return null;
  let evidence = input.evidence ?? null;
  if (!evidence && input.evidenceRowId) {
    evidence = getConversationEvidence(db, input.evidenceRowId);
  }
  if (evidence?.dataClassification === "secret" || evidence?.secretOmitted) {
    const result: AdmissionResult = { nominationId: nomination.nominationId, assertionKey: nomination.assertionKey, result: "admission_skipped_secret", assertion: null };
    logAdmission(db, result, input.nowMs ?? Date.now());
    return result;
  }
  if (nomination.dimensions.source === "owner_utterance" || nomination.dimensions.reliability === "owner_supplied") {
    if (!evidence || evidence.role !== "owner" || evidence.text === null) {
      const result: AdmissionResult = { nominationId: nomination.nominationId, assertionKey: nomination.assertionKey, result: "admission_skipped_provenance", assertion: null };
      logAdmission(db, result, input.nowMs ?? Date.now());
      return result;
    }
  }
  let entitled = input.currentnessEntitled;
  if (nomination.dimensions.time === "current") {
    if (entitled === undefined) {
      try {
        const payload = typeof settlement.payload_json === "string" ? JSON.parse(settlement.payload_json) : settlement.payload_json;
        entitled = hasStructuredCurrentnessEntitlement(
          payload,
          payload?.currentnessWitness ?? payload?.currentness,
        );
      } catch {
        entitled = false;
      }
    }
    if (!entitled) {
      const result: AdmissionResult = { nominationId: nomination.nominationId, assertionKey: nomination.assertionKey, result: "admission_skipped_provenance", assertion: null };
      logAdmission(db, result, input.nowMs ?? Date.now());
      return result;
    }
  }
  if (evidence && (!nomination.sourceRefs || nomination.sourceRefs.length === 0)) {
    nomination.sourceRefs = [evidence.rowId];
  }
  let result: AdmissionResult | null = null;
  db.exec("BEGIN IMMEDIATE");
  try {
    result = admitOne(db, nomination, input.nowMs ?? Date.now(), {
      requireCurrentGeneration: nomination.generation,
      currentnessEntitled: entitled,
    });
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve original */ }
    throw error;
  }
  try {
    if (result && result.result === "admitted" && result.assertion) {
      const changed = [nomination.assertionKey];
      if (nomination.supersedesAssertionKey && nomination.supersedesAssertionKey !== nomination.assertionKey) {
        changed.push(nomination.supersedesAssertionKey);
      }
      notifySidecarPostCommit(db, { changedAssertionKeys: changed });
    }
  } catch {
    // Derived sync failures must never disturb authoritative sidecar commit
  }
  return result;
}
