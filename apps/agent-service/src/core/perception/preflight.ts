import type { DatabaseSync } from "node:sqlite";
import {
  currentContractId,
  currentReleaseId,
} from "../rollout/capabilities.js";
import { contractMismatch } from "../attention/ledger.js";
import { env } from "../../env.js";
import type { CognitionMode } from "../types.js";
import {
  MAX_AGGREGATE_ATTACHMENT_BYTES,
  MAX_SINGLE_ATTACHMENT_BYTES,
} from "./types.js";
import { canStartFetch, usableFetchMs } from "./turn-budget.js";
import { perceptionCapabilityCanInfluence } from "./capability-self-model.js";

export type AttachmentPreflightResult = {
  allowed: boolean;
  reasonCode?: string;
  visionAllowed: boolean;
  attachmentTextAllowed: boolean;
  fetchBudgetMs: number;
};

export function checkAttachmentPreflight(
  db: DatabaseSync,
  ownerId: string,
  thoughtDeadlineAtMs: number,
  aggregateBytes: number,
): AttachmentPreflightResult {
  void ownerId;
  const fetchBudgetMs = usableFetchMs(thoughtDeadlineAtMs);
  const visionAllowed = perceptionCapabilityCanInfluence(db, "vision");
  const attachmentTextAllowed = perceptionCapabilityCanInfluence(
    db,
    "attachment_text",
  );

  if (aggregateBytes > MAX_AGGREGATE_ATTACHMENT_BYTES) {
    return {
      allowed: false,
      reasonCode: "aggregate_bytes_exceeded",
      visionAllowed,
      attachmentTextAllowed,
      fetchBudgetMs,
    };
  }
  if (!canStartFetch(thoughtDeadlineAtMs)) {
    return {
      allowed: false,
      reasonCode: "fetch_deadline_insufficient",
      visionAllowed,
      attachmentTextAllowed,
      fetchBudgetMs,
    };
  }
  if (!visionAllowed && !attachmentTextAllowed) {
    return {
      allowed: false,
      reasonCode: "perception_capabilities_observe",
      visionAllowed,
      attachmentTextAllowed,
      fetchBudgetMs,
    };
  }
  if (aggregateBytes > MAX_SINGLE_ATTACHMENT_BYTES * 4) {
    return {
      allowed: false,
      reasonCode: "turn_attachment_budget_exceeded",
      visionAllowed,
      attachmentTextAllowed,
      fetchBudgetMs,
    };
  }
  if (contractMismatch(db)) {
    return {
      allowed: false,
      reasonCode: "contract_mismatch",
      visionAllowed,
      attachmentTextAllowed,
      fetchBudgetMs,
    };
  }
  if (env.cognitionMode !== "apply") {
    return {
      allowed: false,
      reasonCode: "master_observe",
      visionAllowed,
      attachmentTextAllowed,
      fetchBudgetMs,
    };
  }
  return {
    allowed: true,
    visionAllowed,
    attachmentTextAllowed,
    fetchBudgetMs,
  };
}

export function conversationalReadPreflight(
  db: DatabaseSync,
  thoughtDeadlineAtMs: number,
  masterMode: CognitionMode = env.cognitionMode,
): { allowed: boolean; reasonCode?: string; fetchBudgetMs: number } {
  const fetchBudgetMs = usableFetchMs(thoughtDeadlineAtMs);
  const allowed =
    masterMode === "apply" &&
    !contractMismatch(db) &&
    perceptionCapabilityCanInfluence(db, "conversational_read", masterMode) &&
    canStartFetch(thoughtDeadlineAtMs);
  return {
    allowed,
    reasonCode: allowed ? undefined : "conversational_read_blocked",
    fetchBudgetMs,
  };
}

export function currentPerceptionReleaseId(): string {
  return currentReleaseId() || currentContractId();
}
