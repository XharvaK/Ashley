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
} from "../types.js";
import {
  getDurableNomination,
  listDurableNominations,
  type DurableNominationRecord,
} from "./nomination.js";
import { appendMemorySupport } from "./supports.js";
import { REDACTED_MEMORY_STATEMENT, upsertMemoryAssertion } from "./assertions.js";
import { notifySidecarPostCommit } from "../retrieval/derived-store.js";
import { hasStructuredCurrentnessEntitlement } from "../authority/check.js";
import { FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST } from "./admission-allowlist.js";

type DbRow = Record<string, unknown>;

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

function admitOne(
  db: DatabaseSync,
  nomination: DurableNominationRecord,
  nowMs: number,
  options: { requireCurrentGeneration?: number; currentnessEntitled?: boolean } = {},
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

  // 1. Structured provenance validation:
  // When candidate assertion has: source === "owner_utterance" || reliability === "owner_supplied"
  const isOwnerOrigin = nomination.dimensions.source === "owner_utterance" || nomination.dimensions.reliability === "owner_supplied";
  const sourceRefs = resolveNominationSourceRefs(db, nomination, settlement);

  if (isOwnerOrigin) {
    const verified = findVerifiedOwnerEvidence(db, sourceRefs);
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

  const existing = db.prepare("SELECT data_classification FROM sidecar_memory_assertions WHERE assertion_key = ?").get(nomination.assertionKey) as DbRow | undefined;
  const effectiveClassification = maxClassification(
    existing?.data_classification === "ordinary" || existing?.data_classification === "sensitive" || existing?.data_classification === "never_public" || existing?.data_classification === "secret" ? existing.data_classification : null,
    nomination.dataClassification,
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
      const admitted = admitOne(db, nomination, nowMs);
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
 * Bounded lifecycle/startup catch-up. The allowlist is fixed in source and is
 * always supplied to the admission selector, so unrelated durable kinds stay
 * pending instead of being repeatedly scanned or minted as assertions.
 */
export function runGovernedAdmissionCatchup(
  db: DatabaseSync,
  options: GovernedAdmissionCatchupOptions = {},
): AdmissionTickResult {
  return tickAdmission(db, {
    ...options,
    allowedKinds: FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST,
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
