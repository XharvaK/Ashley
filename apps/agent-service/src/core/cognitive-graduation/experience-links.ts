import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDeliveryReservation, listDeliveryBubbles } from "../delivery/store.js";
import { isTerminalDeliveryState } from "../delivery/types.js";
import { getEpisode } from "../memory/episodes.js";
import { getReflectionEvent } from "../reflection/store.js";
import { getOperationalJob } from "../sandbox/operational-job-store.js";
import { getVerificationReceiptByTaskId } from "../sandbox/verification-receipt-store.js";
import { assertC4ContractCompatible, normalizeC4WriteMode, provenanceForC4Mode } from "./contract-state.js";
import {
  combinedClassification,
  isRow,
  nullableNumber,
  nullableText,
  numberValue,
  normalizeEvidenceRefs,
  parseEvidenceRefs,
  rejectSecret,
  requireBoundedJson,
  requireText,
  text,
} from "./internal.js";
import { getCognitivePrediction } from "./predictions.js";
import type {
  CognitiveEvidenceRef,
  LivedExperienceLink,
  LivedExperienceLinkInput,
} from "./types.js";

function linkRow(value: unknown): LivedExperienceLink | null {
  if (!isRow(value)) return null;
  const validityState = value.validity_state === "invalidated" ? "invalidated" : "active";
  return {
    id: text(value.id),
    ownerId: text(value.owner_id),
    episodeId: nullableNumber(value.episode_id),
    predictionId: nullableNumber(value.prediction_id),
    operationalRef: text(value.operational_ref),
    reflectionEventId: nullableNumber(value.reflection_event_id),
    revisionId: nullableNumber(value.revision_id),
    dataClassification:
      value.data_classification === "ordinary" || value.data_classification === "sensitive" ||
      value.data_classification === "never_public" || value.data_classification === "secret"
        ? value.data_classification
        : "never_public",
    provenance: value.provenance === "live" ? "live" : "shadow",
    evidenceRefs: parseEvidenceRefs(value.evidence_refs_json),
    validityState,
    invalidatedAt: nullableText(value.invalidated_at),
    createdAt: text(value.created_at),
  };
}

function getLink(db: DatabaseSync, id: string): LivedExperienceLink | null {
  return linkRow(db.prepare(
    `SELECT * FROM lived_experience_links WHERE id = ?`,
  ).get(id));
}

function ownerOfEpisode(db: DatabaseSync, episodeId: number): {
  ownerId: string;
  classification: "ordinary" | "sensitive" | "never_public" | "secret";
} | null {
  const row = db.prepare(
    `SELECT owner_id, data_classification FROM episodes WHERE id = ?`,
  ).get(episodeId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ownerId: text(row.owner_id),
    classification:
      row.data_classification === "ordinary" || row.data_classification === "sensitive" ||
      row.data_classification === "never_public" || row.data_classification === "secret"
        ? row.data_classification
        : "never_public",
  };
}

function ownerOfRevision(db: DatabaseSync, revisionId: number): {
  ownerId: string;
  classification: "ordinary" | "sensitive" | "never_public" | "secret";
} | null {
  const row = db.prepare(
    `SELECT owner_id, data_classification FROM learning_revisions WHERE id = ?`,
  ).get(revisionId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ownerId: text(row.owner_id),
    classification:
      row.data_classification === "ordinary" || row.data_classification === "sensitive" ||
      row.data_classification === "never_public" || row.data_classification === "secret"
        ? row.data_classification
        : "never_public",
  };
}

function parseOperationalRef(value: string): { type: string; id: string } {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("cognitive_graduation_operational_ref_invalid");
  }
  return { type: value.slice(0, separator), id: value.slice(separator + 1) };
}

/** True only for durable evidence that the cited activity actually ran. */
export function operationalReferenceResolves(
  db: DatabaseSync,
  ownerId: string,
  operationalRef: string,
): boolean {
  let parsed: { type: string; id: string };
  try { parsed = parseOperationalRef(operationalRef); } catch { return false; }
  switch (parsed.type) {
    case "delivery_reservation": {
      const id = Number(parsed.id);
      if (!Number.isSafeInteger(id) || id <= 0) return false;
      const reservation = getDeliveryReservation(db, id);
      if (!reservation || reservation.ownerId !== ownerId || !isTerminalDeliveryState(reservation.state)) return false;
      return listDeliveryBubbles(db, id).some((bubble) => bubble.discordMessageId != null);
    }
    case "operational_job": {
      const job = getOperationalJob(db, parsed.id);
      if (!job || job.ownerId !== ownerId) return false;
      if (job.status === "succeeded") return true;
      if (job.status === "failed" || job.status === "outcome_unknown") {
        return job.currentStepIndex > 0 || job.jobPhase === "terminal";
      }
      return false;
    }
    case "cognition_job": {
      const row = db.prepare(
        `SELECT status, owner_id FROM cognitive_jobs WHERE id = ?`,
      ).get(Number(parsed.id)) as Record<string, unknown> | undefined;
      if (!row || text(row.owner_id) !== ownerId) return false;
      return text(row.status) === "completed" || text(row.status) === "failed";
    }
    case "verification_receipt": {
      const receipt = getVerificationReceiptByTaskId(db, parsed.id);
      if (!receipt) return false;
      const row = db.prepare(
        `SELECT owner_id FROM verification_receipts WHERE task_id = ?`,
      ).get(parsed.id) as Record<string, unknown> | undefined;
      return text(row?.owner_id) === ownerId;
    }
    default:
      return false;
  }
}

function validateLinkInput(
  db: DatabaseSync,
  input: LivedExperienceLinkInput,
): {
  ownerId: string;
  episodeId: number | null;
  predictionId: number | null;
  operationalRef: string;
  reflectionEventId: number | null;
  revisionId: number | null;
  evidenceRefs: CognitiveEvidenceRef[];
  classification: ReturnType<typeof combinedClassification>;
  mode: ReturnType<typeof normalizeC4WriteMode>;
} {
  assertC4ContractCompatible(db);
  const ownerId = requireText(input.ownerId, "owner_id", 256);
  const operationalRef = requireText(input.operationalRef, "operational_ref", 200);
  if (!operationalReferenceResolves(db, ownerId, operationalRef)) {
    throw new Error("cognitive_graduation_operational_ref_unresolved");
  }
  const episodeId = input.episodeId == null ? null : Number(input.episodeId);
  const predictionId = input.predictionId == null ? null : Number(input.predictionId);
  if (episodeId == null && predictionId == null) {
    throw new Error("cognitive_graduation_experience_source_required");
  }
  const classifications: Array<"ordinary" | "sensitive" | "never_public" | "secret"> = [];
  if (episodeId != null) {
    if (!Number.isSafeInteger(episodeId) || episodeId <= 0) throw new Error("cognitive_graduation_episode_invalid");
    const episode = getEpisode(db, episodeId);
    const owner = ownerOfEpisode(db, episodeId);
    if (!episode || !owner || owner.ownerId !== ownerId) throw new Error("cognitive_graduation_episode_missing");
    classifications.push(owner.classification);
  }
  let prediction = null;
  if (predictionId != null) {
    if (!Number.isSafeInteger(predictionId) || predictionId <= 0) throw new Error("cognitive_graduation_prediction_invalid");
    prediction = getCognitivePrediction(db, predictionId);
    if (!prediction || prediction.ownerId !== ownerId) throw new Error("cognitive_graduation_prediction_missing");
    classifications.push(prediction.dataClassification);
  }
  const reflectionEventId = input.reflectionEventId == null ? null : Number(input.reflectionEventId);
  if (reflectionEventId != null) {
    const event = getReflectionEvent(db, reflectionEventId);
    if (!event || event.ownerId !== ownerId) throw new Error("cognitive_graduation_reflection_event_missing");
  }
  const revisionId = input.revisionId == null ? null : Number(input.revisionId);
  if (revisionId != null) {
    const revision = ownerOfRevision(db, revisionId);
    if (!revision || revision.ownerId !== ownerId) throw new Error("cognitive_graduation_revision_missing");
    classifications.push(revision.classification);
  }
  const evidenceRefs = input.evidenceRefs ?? [];
  if (!Array.isArray(evidenceRefs)) throw new Error("cognitive_graduation_evidence_refs_invalid");
  const normalizedEvidence = evidenceRefs.length === 0
    ? []
    : normalizeEvidenceRefs(evidenceRefs);
  const mode = normalizeC4WriteMode(db, input.capabilityMode ?? (prediction?.capabilityModeAtWrite ?? "observe"));
  const classification = combinedClassification(input.dataClassification, ...classifications);
  rejectSecret(classification, "cognitive_graduation_secret_experience_refused");
  return {
    ownerId,
    episodeId,
    predictionId,
    operationalRef,
    reflectionEventId,
    revisionId,
    evidenceRefs: normalizedEvidence,
    classification,
    mode,
  };
}

export function createLivedExperienceLink(
  db: DatabaseSync,
  input: LivedExperienceLinkInput,
): LivedExperienceLink {
  const checked = validateLinkInput(db, input);
  const createdAt = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO lived_experience_links
       (id, owner_id, episode_id, prediction_id, operational_ref,
        reflection_event_id, revision_id, data_classification, provenance,
        evidence_refs_json, validity_state, invalidated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?)` ,
  ).run(
    id,
    checked.ownerId,
    checked.episodeId,
    checked.predictionId,
    checked.operationalRef,
    checked.reflectionEventId,
    checked.revisionId,
    checked.classification,
    provenanceForC4Mode(checked.mode),
    requireBoundedJson(checked.evidenceRefs, "evidence_refs", 8000),
    createdAt,
  );
  const link = getLink(db, id);
  if (!link) throw new Error("cognitive_graduation_experience_link_readback_failed");
  return link;
}

export const recordLivedExperienceLink = createLivedExperienceLink;

export function getLivedExperienceLink(
  db: DatabaseSync,
  id: string,
): LivedExperienceLink | null {
  assertC4ContractCompatible(db);
  return getLink(db, id);
}

export function refreshLivedExperienceLinkValidity(
  db: DatabaseSync,
  id?: string,
  now = new Date().toISOString(),
): number {
  assertC4ContractCompatible(db);
  const rows = id == null
    ? db.prepare(`SELECT * FROM lived_experience_links WHERE validity_state = 'active'`).all()
    : db.prepare(`SELECT * FROM lived_experience_links WHERE id = ? AND validity_state = 'active'`).all(id);
  let invalidated = 0;
  for (const value of rows) {
    const link = linkRow(value);
    if (!link) continue;
    if (!operationalReferenceResolves(db, link.ownerId, link.operationalRef)) {
      db.prepare(
        `UPDATE lived_experience_links SET validity_state = 'invalidated', invalidated_at = ?
         WHERE id = ? AND validity_state = 'active'`,
      ).run(now, link.id);
      invalidated += 1;
    }
  }
  return invalidated;
}

export function listLivedExperienceLinks(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): LivedExperienceLink[] {
  assertC4ContractCompatible(db);
  refreshLivedExperienceLinkValidity(db);
  return db.prepare(
    `SELECT * FROM lived_experience_links WHERE owner_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  ).all(ownerId, Math.max(1, Math.min(200, limit))).map(linkRow)
    .filter((item): item is LivedExperienceLink => item !== null);
}
