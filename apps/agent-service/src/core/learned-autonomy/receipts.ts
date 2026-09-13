import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { maxClassification } from "../privacy/classification.js";
import { assertC3ContractCompatible } from "./contract-state.js";
import { getLearnedInfluence } from "./admit.js";
import type {
  LearnedChoiceKind,
  LearnedChoiceReceipt,
  LearnedChoiceReceiptInput,
} from "./types.js";

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringOrNumberIds(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string | number =>
      (typeof item === "string" && item.trim().length > 0) ||
      (typeof item === "number" && Number.isSafeInteger(item)),
  );
}

function booleanValue(value: unknown): boolean {
  return Number(value ?? 0) === 1;
}

function mapReceipt(value: unknown): LearnedChoiceReceipt | null {
  if (!isRow(value)) return null;
  const choiceKind = value.choice_kind === "curiosity_rank" ||
    value.choice_kind === "motivation_admission" ||
    value.choice_kind === "thought_selection"
    ? value.choice_kind
    : null;
  const dataClassification = value.data_classification === "ordinary" ||
    value.data_classification === "sensitive" ||
    value.data_classification === "never_public" ||
    value.data_classification === "secret"
    ? value.data_classification
    : "never_public";
  const candidateIds = stringOrNumberIds(parseJson(value.candidate_ids_json));
  const selectedIds = stringOrNumberIds(parseJson(value.selected_ids_json));
  const rankDeltaValue = parseJson(value.rank_delta_json);
  const rankDelta: Record<string, number> = {};
  if (typeof rankDeltaValue === "object" && rankDeltaValue !== null && !Array.isArray(rankDeltaValue)) {
    for (const [key, item] of Object.entries(rankDeltaValue)) {
      if (typeof item === "number" && Number.isFinite(item)) rankDelta[key] = item;
    }
  }
  if (!choiceKind) return null;
  return {
    receiptId: text(value.receipt_id),
    ownerId: text(value.owner_id),
    learnedInfluenceId: Number(value.learned_id ?? 0),
    choiceKind,
    candidateIds,
    selectedIds,
    rankDelta,
    policyBinding: text(value.policy_binding),
    reasonCode: text(value.reason_code),
    inputContentHash: text(value.input_content_hash),
    outputContentHash: text(value.output_content_hash),
    eligibleInputAffectedRanking: booleanValue(value.eligible_input_affected_ranking),
    agencyMadeFinalChoice: booleanValue(value.agency_made_final_choice),
    dataClassification,
    createdAt: text(value.created_at),
  };
}

function requireHash(value: string, name: string): string {
  const clean = value.trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`learned_choice_receipt_${name}_hash_invalid`);
  }
  return clean;
}

function requireChoiceKind(value: LearnedChoiceKind): void {
  if (value !== "curiosity_rank" && value !== "motivation_admission" && value !== "thought_selection") {
    throw new Error("learned_choice_receipt_choice_kind_invalid");
  }
}

export function recordChoiceReceipt(
  db: DatabaseSync,
  input: LearnedChoiceReceiptInput,
  now = new Date(),
): LearnedChoiceReceipt {
  assertC3ContractCompatible(db);
  requireChoiceKind(input.choiceKind);
  const learned = getLearnedInfluence(db, input.learnedInfluenceId);
  if (!learned) throw new Error("learned_choice_receipt_learned_missing");
  if (learned.adjudicationState !== "accepted" || learned.contradictionState !== "none") {
    throw new Error("learned_choice_receipt_learned_ineligible");
  }
  if (!Array.isArray(input.candidateIds) || input.candidateIds.length > 64) {
    throw new Error("learned_choice_receipt_candidate_ids_invalid");
  }
  if (!Array.isArray(input.selectedIds) || input.selectedIds.length > 64) {
    throw new Error("learned_choice_receipt_selected_ids_invalid");
  }
  const candidateIds = input.candidateIds.filter(
    (item) => (typeof item === "string" && item.trim().length > 0) ||
      (typeof item === "number" && Number.isSafeInteger(item)),
  );
  const selectedIds = input.selectedIds.filter(
    (item) => (typeof item === "string" && item.trim().length > 0) ||
      (typeof item === "number" && Number.isSafeInteger(item)),
  );
  if (candidateIds.length !== input.candidateIds.length || selectedIds.length !== input.selectedIds.length) {
    throw new Error("learned_choice_receipt_ids_invalid");
  }
  const rankDelta = input.rankDelta;
  if (typeof rankDelta !== "object" || rankDelta === null || Array.isArray(rankDelta)) {
    throw new Error("learned_choice_receipt_rank_delta_invalid");
  }
  const deltaEntries = Object.entries(rankDelta);
  if (deltaEntries.length > 64) throw new Error("learned_choice_receipt_rank_delta_invalid");
  for (const [, value] of deltaEntries) {
    if (!Number.isFinite(value) || Math.abs(value) > 100) {
      throw new Error("learned_choice_receipt_rank_delta_unbounded");
    }
  }
  const policyBinding = input.policyBinding.trim().slice(0, 200);
  const reasonCode = input.reasonCode.trim().slice(0, 200);
  if (!policyBinding || !reasonCode) throw new Error("learned_choice_receipt_policy_required");
  const inputHash = requireHash(input.inputContentHash, "input");
  const outputHash = requireHash(input.outputContentHash, "output");
  const classification = maxClassification(
    learned.dataClassification,
    input.dataClassification,
  );
  if (classification === "secret") throw new Error("learned_choice_receipt_secret_refused");
  const receiptId = randomUUID();
  db.prepare(
    `INSERT INTO learned_choice_receipts
       (receipt_id, owner_id, learned_id, choice_kind, candidate_ids_json,
        selected_ids_json, rank_delta_json, policy_binding, reason_code,
        input_content_hash, output_content_hash, eligible_input_affected_ranking,
        agency_made_final_choice, data_classification, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
  ).run(
    receiptId,
    learned.ownerId,
    learned.id,
    input.choiceKind,
    JSON.stringify(candidateIds),
    JSON.stringify(selectedIds),
    JSON.stringify(rankDelta),
    policyBinding,
    reasonCode,
    inputHash,
    outputHash,
    input.eligibleInputAffectedRanking ? 1 : 0,
    input.agencyMadeFinalChoice ? 1 : 0,
    classification,
    now.toISOString(),
  );
  const receipt = db.prepare(
    "SELECT * FROM learned_choice_receipts WHERE receipt_id = ?",
  ).get(receiptId);
  const mapped = mapReceipt(receipt);
  if (!mapped) throw new Error("learned_choice_receipt_readback_failed");
  return mapped;
}

export function listChoiceReceipts(
  db: DatabaseSync,
  ownerId: string,
  options: { learnedInfluenceId?: number; limit?: number } = {},
): LearnedChoiceReceipt[] {
  assertC3ContractCompatible(db);
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const rows = options.learnedInfluenceId == null
    ? db.prepare(
      `SELECT * FROM learned_choice_receipts
       WHERE owner_id = ? ORDER BY created_at DESC, receipt_id DESC LIMIT ?`,
    ).all(ownerId, limit)
    : db.prepare(
      `SELECT * FROM learned_choice_receipts
       WHERE owner_id = ? AND learned_id = ?
       ORDER BY created_at DESC, receipt_id DESC LIMIT ?`,
    ).all(ownerId, options.learnedInfluenceId, limit);
  return rows.map(mapReceipt).filter((item): item is LearnedChoiceReceipt => item !== null);
}
