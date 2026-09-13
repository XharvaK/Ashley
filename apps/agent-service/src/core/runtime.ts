import type { DatabaseSync } from "node:sqlite";
import type { ProjectInspectionObservation } from "./types.js";
import { env } from "../env.js";
import type { DataPlaneContext } from "./data-plane.js";
import { connectNuclearDb } from "./db.js";
import {
  composeTurnContext,
  type TurnContext,
} from "./context-composer.js";
import { routingStatus } from "./model-routing/status.js";
import type { RoutingRouteStatus } from "./model-routing/status.js";
import {
  listActiveFacts,
  upsertFact,
} from "./memory/facts.js";
import {
  archiveActiveThread,
  insertMessage,
  resolveActiveThread,
} from "./memory/threads.js";
import {
  hasOpenOwnTimeSession,
} from "./state/own-time.js";
import {
  classifyInitiativeClass,
  evaluateProactiveEligibility,
} from "./cognitive-v021/initiative/eligibility.js";
import {
  listRecentTakes,
  listSources,
  readingProvenanceFailure,
} from "./curiosity/feed.js";
import { listRecentReads } from "./curiosity/reads.js";
import { getCurrentActivity } from "./curiosity/current-activity.js";
import { getContinuityFor } from "./continuity/registry.js";
import {
  bindForgetPreviewDiscordMessage,
  resolvePreviewByDiscordMessage,
} from "./continuity/forget-preview.js";
import { getAuthoritativeLineageId } from "./continuity/db.js";
import {
  cleanShutdownSession,
  heartbeatSession,
  startRuntimeSession,
} from "./continuity/sessions.js";
import {
  forgetOwnerTopic,
  forgetOwnerTopicImmediate,
  replayPendingTombstones,
  type ForgetResult,
} from "./memory/forget.js";
import { recoverStaleRequests } from "./attention/ledger.js";
import { attentionObservability } from "./attention/governor.js";
import {
  applyInitiativeLearning,
  attachLearningSnapshot,
  getReflectionOverview,
  processPendingOpenCognitiveReviewsAsync,
  processPendingReflectionEvents,
  recordInitiativeReaction,
} from "./reflection/initiative.js";
import type { OpenCognitiveReviewAdjudicator } from "./reflection/initiative.js";
import type { ReflectionMode } from "./types.js";
import { getAffectiveState } from "./state/affect.js";
import {
  listActiveMindStateItems,
} from "./state/mind-items.js";
import {
  applyEligibleRevisions,
  listIdentityReviews,
  listRevisions,
  recordAshleyReviewPosition,
  recordDocReviewDecision,
  revertRevision,
} from "./learning/revisions.js";
import { classifyIdentityChange, requiresOwnerApproval } from "./identity/classification.js";
import {
  createChangeProposal,
  getChangeProposalByEntityUuid,
  listChangeProposalEvents,
  listChangeProposals,
  updateProposalState,
} from "./change-proposal/store.js";
import {
  proposeChange,
  recordAshleyPosition,
  recordDocDecision,
  recordExternalOutcome,
} from "./change-proposal/lifecycle.js";
import {
  cancelAction,
  reconcileAction,
} from "./external-agency/lifecycle.js";
import {
  getEmergencyStop,
  setEmergencyStop,
} from "./external-agency/emergency-stop.js";
import {
  getExternalActionByEntityUuid,
  listExternalActionEvents,
  listExternalActions,
  listVaultCredentials,
  revokeVaultCredential,
} from "./external-agency/store.js";
import {
  capabilityCanInfluence,
  capabilityNames,
  listCapabilityStatuses,
  operatorRollbackCapability as operatorRollbackCapabilityRelease,
  promoteCapability as promoteCapabilityRelease,
  recordCriticalFailure,
  recordIsolatedEvaluation,
  type CapabilityName,
} from "./rollout/capabilities.js";
import { recordRecallLiveCutover } from "./memory/cutover.js";
import {
  executeMemoryEvidenceCutover as executeMemoryEvidenceCutoverRelease,
  getMemoryEvidenceCutoverReadiness as getMemoryEvidenceCutoverReadinessRelease,
  type MemoryEvidenceCutoverReadiness,
  type MemoryEvidenceCutoverResult,
} from "./memory/activation.js";
import {
  getCurrentRecallQualificationEpoch,
  listRecallQualificationEpochs,
  startRecallQualificationEpoch as startRecallQualificationEpochRelease,
} from "./rollout/recall-qualification-epoch.js";
import {
  getCurrentMemoryEvidenceQualificationEpoch,
  getMemoryEvidenceQualificationReadiness,
  listMemoryEvidenceQualificationEpochs,
  recordMemoryEvidenceIsolatedEvaluation,
  startMemoryEvidenceQualificationEpoch as startMemoryEvidenceQualificationEpochRelease,
  type RecordC1EvaluationInput,
  type StartC1EpochInput,
} from "./rollout/memory-evidence-qualification-epoch.js";
import { listRelationshipSummary } from "./relationship/store.js";
import { recomputeSharedCulture } from "./relationship/projections.js";
import {
  recordAshleySelfCommitment,
  type AshleySelfCommitmentInput,
} from "./relationship/self-commitments.js";
import {
  recordRelationalTension,
  type RelationalTensionInput,
} from "./relationship/tensions.js";
import {
  recordConsentEvent,
  type ConsentRecordInput,
} from "./relationship/consent.js";
import {
  proposeMutualCommitment,
  confirmMutualDoc,
  confirmMutualAshleyDecision,
  confirmMutualAshleyDelivery,
  tryActivateMutualCommitment,
  withdrawMutualCommitment,
} from "./relationship/transitions.js";
import {
  recordRepairProposal,
  recordRepairEvidence,
  recordRepairAdjudication,
  type RepairProposalInput,
  type RepairEvidenceInput,
  type RepairAdjudicationInput,
} from "./relationship/repair.js";
import {
  recordInteractionContract,
  type InteractionContractInput,
} from "./relationship/interaction-contracts.js";
import type { C5Mode } from "./relationship/types.js";
import {
  getDeliveryReservation,
  listDeliveryBubbles,
  recordAuxiliaryMessage,
  recordBubbleReceipt,
} from "./delivery/store.js";
import {
  expireStaleDraftedReservations,
  finalizeDelivery,
} from "./delivery/finalize.js";
import { cancelDeliveryReservation } from "./delivery/abort-registry.js";
import {
  claimPendingCognitiveDeliveries,
  listPendingCognitiveDeliveries,
} from "./cognitive-v021/delivery/pending.js";

export type ProactiveDiagnosticStage =
  | "eligibility"
  | "thought"
  | "agency"
  | "expression"
  | "reservation"
  | "delivery";

export type ProactiveDiagnostic = {
  at: string;
  stage: ProactiveDiagnosticStage;
  code: string;
};

export type CoreProviderState = "configured" | "degraded" | "unavailable";

export type HealthSnapshotInput = {
  ready: boolean;
  providerState: CoreProviderState;
};

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : value == null ? null : Number(value);
}

function kvKey(ownerId: string): string {
  return `nuclear.proactive.paused.${ownerId}`;
}

function proactiveDiagnosticKey(ownerId: string): string {
  return `nuclear.proactive.diagnostic.${ownerId}`;
}

function getKv(db: DatabaseSync, key: string): string | null {
  const row: unknown = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return isRow(row) && typeof row.value === "string" ? row.value : null;
}

function setKv(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function readProactiveDiagnostic(
  db: DatabaseSync,
  ownerId: string,
): ProactiveDiagnostic | null {
  const raw = getKv(db, proactiveDiagnosticKey(ownerId));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRow(parsed)) return null;
    const stage = parsed.stage;
    if (
      stage !== "eligibility" &&
      stage !== "thought" &&
      stage !== "agency" &&
      stage !== "expression" &&
      stage !== "reservation" &&
      stage !== "delivery"
    ) {
      return null;
    }
    if (
      typeof parsed.at !== "string" ||
      !Number.isFinite(Date.parse(parsed.at)) ||
      typeof parsed.code !== "string" ||
      parsed.code.length === 0 ||
      parsed.code.length > 128
    ) {
      return null;
    }
    return { at: parsed.at, stage, code: parsed.code };
  } catch {
    return null;
  }
}

export class AshleyCore {
  private readonly db: DatabaseSync;
  private readonly continuity: DatabaseSync | null;
  private readonly reflectionMode: ReflectionMode;
  private readonly sessionId: string | null;
  private readonly reflectionReviewAdjudicator: OpenCognitiveReviewAdjudicator | undefined;

  private readonly dataPlane: DataPlaneContext | null;

  constructor(
    db?: DatabaseSync,
    options?: {
      reflectionMode?: ReflectionMode;
      reflectionReviewAdjudicator?: OpenCognitiveReviewAdjudicator;
      dataPlane?: DataPlaneContext;
    },
  ) {
    if (!db) {
      throw new Error("data_plane_required");
    }
    const priorContinuity = getContinuityFor(db);
    this.db = connectNuclearDb(
      db,
      priorContinuity
        ? { continuity: priorContinuity, dataPlane: options?.dataPlane }
        : { dataPlane: options?.dataPlane },
    );
    this.dataPlane = options?.dataPlane ?? null;
    this.continuity = getContinuityFor(this.db) ?? priorContinuity ?? null;
    this.reflectionMode = options?.reflectionMode ?? env.reflectionMode;
    this.reflectionReviewAdjudicator = options?.reflectionReviewAdjudicator;
    if (this.continuity) {
      try {
        const lineageId = getAuthoritativeLineageId(this.continuity);
        this.sessionId = startRuntimeSession(this.continuity, {
          lineageId,
          buildIdentity: null,
          nuclearSchemaVersion: 15,
        });
        replayPendingTombstones(this.continuity, this.db);
      } catch {
        this.sessionId = null;
      }
    } else {
      this.sessionId = null;
    }
    recoverStaleRequests(this.db);
    processPendingReflectionEvents(this.db);
  }

  private nuclearFilePath(): string | null {
    const rows = this.db.prepare("PRAGMA database_list").all() as Array<{
      name?: string;
      file?: string;
    }>;
    const main = rows.find((row) => row.name === "main");
    const file = main?.file?.trim() ?? "";
    return file.length > 0 ? file : null;
  }

  getSandboxAvailability() {
    return {
      provider: "sandbox-v2" as const,
      available: env.sandboxEngineeringLifecycleEnabled,
      qualification: "current-v2" as const,
    };
  }

  private auditReadingProvenance(): boolean {
    const failure = readingProvenanceFailure(this.db);
    if (!failure) return true;
    recordCriticalFailure(
      this.db,
      "reading",
      failure,
      "provenance",
      "A reading-derived claim has missing or invalid read-record provenance.",
    );
    return false;
  }

  private capabilityStatuses(): ReturnType<typeof listCapabilityStatuses> {
    this.auditReadingProvenance();
    return listCapabilityStatuses(this.db);
  }

  getDeliveryStatus(ownerId: string, reservationId: number) {
    expireStaleDraftedReservations(this.db);
    const reservation = getDeliveryReservation(this.db, reservationId);
    if (!reservation || reservation.ownerId !== ownerId) return null;
    const bubbles = listDeliveryBubbles(this.db, reservationId);
    return {
      reservation,
      bubbles,
      statusUrl: `/delivery/${reservationId}`,
    };
  }

  getPendingDeliveries(ownerId: string, options: { lane?: string } = {}) {
    const lane = options.lane?.trim();
    return lane === undefined || lane === "cognitive_v021"
      ? listPendingCognitiveDeliveries(this.db, ownerId)
      : [];
  }

  claimPendingDeliveries(
    ownerId: string,
    options: { lane?: string } = {},
  ) {
    const lane = options.lane?.trim();
    return lane === undefined || lane === "cognitive_v021"
      ? claimPendingCognitiveDeliveries(this.db, { ownerId })
      : [];
  }

  receiptDeliveryBubble(
    ownerId: string,
    reservationId: number,
    ordinal: number,
    discordMessageId: string,
  ): void {
    const reservation = getDeliveryReservation(this.db, reservationId);
    if (!reservation || reservation.ownerId !== ownerId) {
      throw new Error("delivery_reservation_missing");
    }
    recordBubbleReceipt(this.db, reservationId, ordinal, discordMessageId);
  }

  receiptDeliveryAuxiliary(
    ownerId: string,
    reservationId: number,
    input: {
      kind: "progress" | "delivery_error";
      text: string;
      discordMessageId: string;
    },
  ): void {
    const reservation = getDeliveryReservation(this.db, reservationId);
    if (!reservation || reservation.ownerId !== ownerId) {
      throw new Error("delivery_reservation_missing");
    }
    recordAuxiliaryMessage(this.db, {
      reservationId,
      kind: input.kind,
      text: input.text,
      discordMessageId: input.discordMessageId,
    });
  }

  finalizeDeliveryReservation(
    ownerId: string,
    reservationId: number,
    cause:
      | "complete"
      | "cancel"
      | "send_failure"
      | "first_bubble_deadline"
      | "delivery_lease" = "complete",
    onArchivalAssistant?: (text: string) => void,
  ) {
    return finalizeDelivery(this.db, {
      reservationId,
      ownerId,
      cause,
      ownTimeOpen: hasOpenOwnTimeSession(this.db, ownerId),
      onArchivalAssistant,
    });
  }

  cancelDelivery(
    ownerId: string,
    reservationId: number,
    onArchivalAssistant?: (text: string) => void,
  ) {
    return cancelDeliveryReservation(this.db, {
      reservationId,
      ownerId,
      onArchivalAssistant,
    });
  }

  pauseProactive(ownerId: string): void {
    setKv(this.db, kvKey(ownerId), "true");
  }

  resumeProactive(ownerId: string): void {
    setKv(this.db, kvKey(ownerId), "false");
  }

  isProactivePaused(ownerId: string): boolean {
    return getKv(this.db, kvKey(ownerId)) === "true";
  }

  /** Trusted host-facing quiescence observation for guarded currentness cutover. */
  isExpressionQuiesced(_ownerId: string): boolean {
    return true;
  }

  getProactiveOperationalStatus(ownerId: string): {
    enabled: boolean;
    paused: boolean;
    sentToday: number;
    maxPerDay: number;
    lastSentAt: string | null;
    lastUserMessageAt: string | null;
    minIdleHours: number;
    lastDiagnostic: ProactiveDiagnostic | null;
  } {
    const today = new Date().toISOString().slice(0, 10);
    const sentRows = this.db
      .prepare(
        `SELECT committed_at
         FROM initiative_reservations
         WHERE owner_id = ? AND committed_at IS NOT NULL`,
      )
      .all(ownerId);
    const sentToday = sentRows.filter(
      (row) =>
        isRow(row) &&
        typeof row.committed_at === "string" &&
        row.committed_at.startsWith(today),
    ).length;
    const lastSent: unknown = this.db
      .prepare(
        `SELECT committed_at
         FROM initiative_reservations
         WHERE owner_id = ? AND committed_at IS NOT NULL
         ORDER BY committed_at DESC
         LIMIT 1`,
      )
      .get(ownerId);
    const lastUser: unknown = this.db
      .prepare(
        `SELECT created_at
         FROM mem_messages
         WHERE owner_id = ? AND role = 'user' AND redacted_at IS NULL
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(ownerId);
    return {
      enabled: env.proactiveEnabled,
      paused: this.isProactivePaused(ownerId),
      sentToday,
      maxPerDay: env.proactiveMaxPerDay,
      lastSentAt:
        isRow(lastSent) && typeof lastSent.committed_at === "string"
          ? lastSent.committed_at
          : null,
      lastUserMessageAt:
        isRow(lastUser) && typeof lastUser.created_at === "string"
          ? lastUser.created_at
          : null,
      minIdleHours: env.proactiveMinIdleHours,
      lastDiagnostic: readProactiveDiagnostic(this.db, ownerId),
    };
  }

  getProactiveStatus(ownerId: string): {
    enabled: boolean;
    paused: boolean;
    sentToday: number;
    maxPerDay: number;
    lastSentAt: string | null;
    lastUserMessageAt: string | null;
    minIdleHours: number;
    lastDiagnostic: ProactiveDiagnostic | null;
  } {
    return this.getProactiveOperationalStatus(ownerId);
  }

  pause(ownerId: string): void {
    this.pauseProactive(ownerId);
  }

  resume(ownerId: string): void {
    this.resumeProactive(ownerId);
  }

  status(ownerId: string): ReturnType<AshleyCore["getProactiveStatus"]> {
    return this.getProactiveStatus(ownerId);
  }

  pinMemory(
    ownerId: string,
    text: string,
    _sensitivity: "none" | "private" = "none",
  ): { id: number; key: string; value: string; category: string } {
    const value = text.trim();
    const key = value.slice(0, 80).toLowerCase().replace(/\s+/g, "_");
    const id = upsertFact(this.db, {
      ownerId,
      category: "pinned",
      key,
      value,
      confidence: 1,
      importance: 95,
      origin: "manual",
    });
    return { id, key, value, category: "pinned" };
  }

  getMemorySummary(ownerId: string, _includePrivate = false): {
    facts: Array<{ category: string; key: string; value: string }>;
    threadId: string;
  } {
    const threadId = resolveActiveThread(this.db, ownerId, "discord");
    const facts = listActiveFacts(this.db, ownerId, 40).map((fact) => ({
      category: fact.category,
      key: fact.key,
      value: fact.value,
    }));
    return { facts, threadId };
  }

  newThread(ownerId: string): string {
    archiveActiveThread(this.db, ownerId);
    return resolveActiveThread(this.db, ownerId, "discord");
  }

  forget(
    ownerId: string,
    topic: string,
    confirmed: boolean,
    options: {
      previewId?: string | null;
      confirmationDiscordMessageId?: string | null;
      cancel?: boolean;
    } = {},
  ): ForgetResult {
    if (confirmed && !options.previewId?.trim() && !options.cancel) {
      throw new Error("forget_preview_id_required");
    }
    if (!confirmed && !options.cancel) {
      return forgetOwnerTopic(this.db, ownerId, topic, false, {
        continuity: this.continuity,
        confirmationDiscordMessageId: options.confirmationDiscordMessageId,
        previewId: options.previewId,
      });
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = forgetOwnerTopic(this.db, ownerId, topic, confirmed, {
        continuity: this.continuity,
        previewId: options.previewId,
        cancel: options.cancel,
        inTransaction: true,
      });
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (error instanceof Error && error.message.startsWith("forget_integrity_failed:")) {
        recordCriticalFailure(
          this.db,
          "recall",
          `forget:${ownerId}:${Date.now()}`,
          "deletion_integrity",
          error.message,
        );
      }
      throw error;
    }
  }

  bindForgetConfirmation(
    ownerId: string,
    previewId: string,
    confirmationDiscordMessageId: string,
  ): void {
    if (!this.continuity) throw new Error("continuity_unavailable");
    bindForgetPreviewDiscordMessage(this.continuity, {
      previewId,
      ownerId,
      confirmationDiscordMessageId,
    });
  }

  resolveForgetPreviewByDiscordMessage(
    ownerId: string,
    confirmationDiscordMessageId: string,
  ): string | null {
    if (!this.continuity) return null;
    return resolvePreviewByDiscordMessage(
      this.continuity,
      ownerId,
      confirmationDiscordMessageId,
    );
  }

  continuitySnapshot(): {
    available: boolean;
    lineageId: string | null;
    recentEvents: Array<{ kind: string; occurredAt: string; detail: unknown }>;
  } {
    if (!this.continuity) {
      return { available: false, lineageId: null, recentEvents: [] };
    }
    const lineageId = getAuthoritativeLineageId(this.continuity);
    const rows = this.continuity
      .prepare(
        `SELECT kind, occurred_at, detail_json FROM continuity_events
         WHERE lineage_id = ?
         ORDER BY id DESC LIMIT 40`,
      )
      .all(lineageId) as Array<{
      kind: string;
      occurred_at: string;
      detail_json: string;
    }>;
    return {
      available: true,
      lineageId,
      recentEvents: rows.map((row) => ({
        kind: row.kind,
        occurredAt: row.occurred_at,
        detail: JSON.parse(row.detail_json) as unknown,
      })),
    };
  }

  relationshipSummary(
    ownerId: string,
    limit = 25,
    offset = 0,
  ): ReturnType<typeof listRelationshipSummary> {
    return listRelationshipSummary(this.db, ownerId, limit, offset);
  }

  /**
   * Explicit owner-authenticated C5 admission seam. Runtime callers are
   * restricted to observe or the master apply mode; C5 apply remains refused
   * by the C5 contract state. Model output never calls these methods directly.
   */
  private c5RuntimeMode(): C5Mode {
    return env.cognitionMode === "apply" ? "apply" : "observe";
  }

  private requireC5MutualOwner(ownerId: string, entityUuid: string): void {
    const row = this.db.prepare(
      `SELECT owner_id FROM mutual_commitments WHERE entity_uuid = ?`,
    ).get(entityUuid) as { owner_id?: string } | undefined;
    if (!row) throw new Error("mutual_commitment_unavailable");
    if (row.owner_id !== ownerId) throw new Error("mutual_commitment_owner_mismatch");
  }

  recordC5AshleySelfCommitment(input: AshleySelfCommitmentInput) {
    return recordAshleySelfCommitment(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5RelationalTension(input: RelationalTensionInput) {
    return recordRelationalTension(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5Consent(input: ConsentRecordInput) {
    return recordConsentEvent(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5InteractionContract(input: InteractionContractInput) {
    return recordInteractionContract(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5RepairProposal(input: RepairProposalInput) {
    return recordRepairProposal(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5RepairEvidence(input: RepairEvidenceInput) {
    return recordRepairEvidence(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5RepairAdjudication(input: RepairAdjudicationInput) {
    return recordRepairAdjudication(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5MutualProposal(input: {
    ownerId: string;
    text: string;
    sourceEntityType: string;
    sourceEntityUuid: string;
    classification: import("./privacy/classification.js").DataClassification;
  }) {
    return proposeMutualCommitment(this.db, {
      ...input,
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5MutualDocConfirmation(
    ownerId: string,
    entityUuid: string,
    evidenceRef: string,
  ): void {
    this.requireC5MutualOwner(ownerId, entityUuid);
    confirmMutualDoc(this.db, entityUuid, evidenceRef, {
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5MutualAshleyDecision(
    ownerId: string,
    entityUuid: string,
    decisionId: number,
    evidenceRef?: string,
  ): void {
    this.requireC5MutualOwner(ownerId, entityUuid);
    confirmMutualAshleyDecision(this.db, entityUuid, decisionId, evidenceRef, {
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  recordC5MutualDelivery(
    ownerId: string,
    entityUuid: string,
    deliveryEntityUuid: string,
    decisionId?: number,
  ): void {
    this.requireC5MutualOwner(ownerId, entityUuid);
    confirmMutualAshleyDelivery(
      this.db,
      entityUuid,
      deliveryEntityUuid,
      decisionId,
      { capabilityMode: this.c5RuntimeMode() },
    );
  }

  activateC5MutualCommitment(ownerId: string, entityUuid: string): boolean {
    this.requireC5MutualOwner(ownerId, entityUuid);
    return tryActivateMutualCommitment(this.db, entityUuid, {
      capabilityMode: this.c5RuntimeMode(),
    });
  }

  withdrawC5MutualCommitment(
    ownerId: string,
    entityUuid: string,
    initiator: "doc" | "ashley",
    evidenceRef: string,
  ): void {
    this.requireC5MutualOwner(ownerId, entityUuid);
    withdrawMutualCommitment(this.db, entityUuid, { initiator, evidenceRef });
  }

  nuclearStatusSnapshot(ownerId: string): {
    health: ReturnType<AshleyCore["getHealth"]>;
    initiative: ReturnType<AshleyCore["getProactiveStatus"]>;
    continuity: ReturnType<AshleyCore["continuitySnapshot"]>;
    relationshipState: ReturnType<typeof listCapabilityStatuses>[number] | undefined;
    sandbox: ReturnType<AshleyCore["getSandboxAvailability"]>;
  } {
    return {
      health: this.getHealth(),
      initiative: this.getProactiveStatus(ownerId),
      continuity: this.continuitySnapshot(),
      relationshipState: listCapabilityStatuses(this.db, env.cognitionMode).find(
        (row) => row.capability === "relationship_state",
      ),
      sandbox: this.getSandboxAvailability(),
    };
  }

  heartbeatContinuity(): void {
    if (this.continuity && this.sessionId) {
      heartbeatSession(this.continuity, this.sessionId);
    }
  }

  shutdownContinuityClean(): void {
    if (this.continuity && this.sessionId) {
      cleanShutdownSession(this.continuity, {
        sessionId: this.sessionId,
        lineageId: getAuthoritativeLineageId(this.continuity),
      });
    }
  }

  recordReaction(
    ownerId: string,
    input: { messageId: string; emoji: string },
  ): {
    feedback: "positive" | "negative" | "neutral";
    matchedInitiative: boolean;
    reflectionEventId: number | null;
    reflectionStatus: "applied" | "ignored" | null;
  } {
    const bare = input.emoji.replace(/\uFE0F/g, "");
    const positive = new Set(["😂", "🤣", "😭", "❤️", "🔥", "💯", "👍", "😍", "🙌", "😅"]);
    const negative = new Set(["👎", "🙄", "😐", "💀", "🤨", "😬"]);
    const feedback: "positive" | "negative" | "neutral" =
      positive.has(input.emoji) || positive.has(bare)
        ? "positive"
        : negative.has(input.emoji) || negative.has(bare)
          ? "negative"
          : "neutral";
    setKv(
      this.db,
      `signal:reaction:${ownerId}`,
      JSON.stringify({
        emoji: input.emoji,
        feedback,
        messageId: input.messageId,
        at: new Date().toISOString(),
      }),
    );
    const reflection = recordInitiativeReaction(this.db, ownerId, input);
    return {
      feedback,
      matchedInitiative: reflection.matchedInitiative,
      reflectionEventId: reflection.event?.id ?? null,
      reflectionStatus:
        reflection.event?.status === "applied" ||
        reflection.event?.status === "ignored"
          ? reflection.event.status
          : null,
    };
  }

  getReflections(ownerId: string, limit = 20) {
    return getReflectionOverview(
      this.db,
      ownerId,
      this.reflectionMode,
      limit,
    );
  }

  hasUrgentCognition(ownerId: string): boolean {
    const initiativeClass = classifyInitiativeClass(this.db, ownerId);
    if (initiativeClass !== "urgent_grounded") return false;
    const status = this.getProactiveStatus(ownerId);
    const eligibility = evaluateProactiveEligibility(this.db, {
      ownerId,
      chatInProgress: false,
      paused: this.isProactivePaused(ownerId),
      enabled: env.proactiveEnabled,
      sentToday: status.sentToday,
      maxPerDay: status.maxPerDay,
      lastUserMessageAt: status.lastUserMessageAt,
      minIdleHours: status.minIdleHours,
      hasUrgent: true,
    });
    return eligibility.ok;
  }

  getCognitionOverview(ownerId: string) {
    return {
      mode: env.cognitionMode,
      capabilities: this.capabilityStatuses(),
      affect: getAffectiveState(this.db, ownerId),
      mindState: listActiveMindStateItems(this.db, ownerId),
      urgent: this.hasUrgentCognition(ownerId),
      jobs: this.db.prepare(
        `SELECT id, kind, source_key, status, attempts, available_at,
                last_error, created_at, updated_at
         FROM cognitive_jobs WHERE owner_id = ? ORDER BY id DESC LIMIT 30`,
      ).all(ownerId),
      runs: this.db.prepare(
          `SELECT id, job_id, kind, model, status, error, episode_id, created_at
         FROM cognitive_runs WHERE owner_id = ? ORDER BY id DESC LIMIT 30`,
      ).all(ownerId),
    };
  }

  getRevisions(ownerId: string, limit = 50) {
    return {
      mode: env.cognitionMode,
      capabilities: this.capabilityStatuses(),
      revisions: listRevisions(this.db, ownerId, limit),
    };
  }

  getIdentityReviews(ownerId: string, limit = 50) {
    return {
      mode: env.cognitionMode,
      reviews: listIdentityReviews(this.db, ownerId, limit),
    };
  }

  /**
   * Exact-item shadow authorization: the owner just acted on one review, so
   * only that review's revision may cross the shadow -> behavioral boundary,
   * and only if the joint review state (Ashley affirm + Doc approve) is
   * complete. No other shadow revision is ever eligible.
   */
  private applyReviewedRevisionIfComplete(ownerId: string, reviewId: number): void {
    const row = this.db.prepare(
      `SELECT revision_id FROM identity_reviews WHERE id = ? AND owner_id = ?`,
    ).get(reviewId, ownerId) as { revision_id?: number } | undefined;
    if (!row?.revision_id) return;
    const applied = applyEligibleRevisions(this.db, ownerId, env.cognitionMode, {
      allowShadow: true,
      revisionIds: [Number(row.revision_id)],
    });
    if (applied.length > 0) recomputeSharedCulture(this.db, ownerId);
  }

  recordAshleyIdentityPosition(input: {
    ownerId: string;
    reviewId: number;
    position: "affirm" | "object" | "defer";
    rationale: string;
    evidenceType: string;
    evidenceId: string | number;
  }) {
    const recorded = recordAshleyReviewPosition(this.db, input);
    if (recorded) this.applyReviewedRevisionIfComplete(input.ownerId, input.reviewId);
    return { recorded, reviews: listIdentityReviews(this.db, input.ownerId) };
  }

  recordDocIdentityDecision(input: {
    ownerId: string;
    reviewId: number;
    decision: "approve" | "reject" | "defer";
    rationale?: string;
  }) {
    const recorded = recordDocReviewDecision(this.db, input);
    if (recorded) this.applyReviewedRevisionIfComplete(input.ownerId, input.reviewId);
    return { recorded, reviews: listIdentityReviews(this.db, input.ownerId) };
  }

  // Identity proposals (foundational change approval flow)
  getIdentityProposals(ownerId: string, limit = 50) {
    return {
      proposals: listChangeProposals(this.db, ownerId, limit)
        .filter((p) => p.targetCategory === "foundational_identity" || p.targetCategory === "ordinary_identity"),
    };
  }

  getIdentityProposal(ownerId: string, entityUuid: string) {
    const proposal = getChangeProposalByEntityUuid(this.db, ownerId, entityUuid);
    if (!proposal) return null;
    if (proposal.targetCategory !== "foundational_identity" && proposal.targetCategory !== "ordinary_identity") {
      return null;
    }
    return {
      proposal,
      events: listChangeProposalEvents(this.db, ownerId, entityUuid),
    };
  }

  createIdentityProposal(input: {
    ownerId: string;
    layer: "stable" | "dynamic";
    kind: string;
    currentText: string | null;
    proposedText: string;
    rationale: string;
    evidenceRefs: string[];
  }) {
    const classification = classifyIdentityChange({
      layer: input.layer,
      kind: input.kind,
      currentText: input.currentText,
      proposedText: input.proposedText,
      isNewEntry: input.currentText === null,
    });

    const targetCategory = classification.class === "foundational" ? "foundational_identity" : "ordinary_identity";
    const riskClass = classification.class === "foundational" ? "consultation" : "low";
    const consultationRequired = classification.class === "foundational";

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    const proposal = createChangeProposal(this.db, {
      ownerId: input.ownerId,
      proposer: "ashley",
      targetCategory,
      objective: `Update ${input.layer} identity ${input.kind}: ${input.kind}`,
      rationale: input.rationale,
      riskClass,
      expiresAt,
      consultationRequired,
    });

    // Record classification in event
    const { appendChangeProposalEvent } = require("./change-proposal/store.js");
    appendChangeProposalEvent(this.db, {
      ownerId: input.ownerId,
      proposalEntityUuid: proposal.entityUuid,
      eventType: "identity_classification",
      actor: "ashley",
      payload: {
        classification: classification.class,
        reason: classification.reason,
        targetKind: classification.targetKind,
        layer: input.layer,
        kind: input.kind,
      },
    });

    return { proposal, classification };
  }

  approveIdentityProposal(ownerId: string, entityUuid: string) {
    const proposal = getChangeProposalByEntityUuid(this.db, ownerId, entityUuid);
    if (!proposal) throw new Error("proposal not found");
    if (proposal.targetCategory !== "foundational_identity" && proposal.targetCategory !== "ordinary_identity") {
      throw new Error("not an identity proposal");
    }
    if (proposal.state !== "awaiting_doc_decision" && proposal.state !== "proposed") {
      throw new Error(`cannot approve proposal in state ${proposal.state}`);
    }

    // For foundational_identity, the change-proposal lifecycle requires:
    // proposed -> awaiting_ashley_position -> awaiting_doc_decision -> approved
    // For ordinary_identity: proposed -> approved (via routeToRevisions)
    // We simulate the owner approval as the Doc decision
    const { transitionProposal } = require("./change-proposal/lifecycle.js");
    
    let result;
    if (proposal.targetCategory === "foundational_identity") {
      // Move through the required states
      if (proposal.state === "proposed") {
        result = transitionProposal(this.db, ownerId, entityUuid, "awaiting_ashley_position", "doc");
        if (!result.ok) throw new Error(result.errorCode);
      }
      // Re-fetch proposal after state change
      const afterAshley = getChangeProposalByEntityUuid(this.db, ownerId, entityUuid);
      if (afterAshley?.state === "awaiting_ashley_position") {
        result = transitionProposal(this.db, ownerId, entityUuid, "awaiting_doc_decision", "doc");
        if (!result.ok) throw new Error(result.errorCode);
      }
      result = transitionProposal(this.db, ownerId, entityUuid, "approved", "doc");
      if (!result.ok) throw new Error(result.errorCode);
    } else {
      // ordinary_identity goes straight to approved
      result = transitionProposal(this.db, ownerId, entityUuid, "approved", "doc");
      if (!result.ok) throw new Error(result.errorCode);
    }

    // Apply the revision if this was linked to one
    if (proposal.linkedRevisionEntityUuid) {
      // The revision will be applied via applyEligibleRevisions when mode=apply
      // For now, we return success
    }

    return { approved: true, proposal: getChangeProposalByEntityUuid(this.db, ownerId, entityUuid) };
  }

  rejectIdentityProposal(ownerId: string, entityUuid: string, rationale: string) {
    const proposal = getChangeProposalByEntityUuid(this.db, ownerId, entityUuid);
    if (!proposal) throw new Error("proposal not found");
    if (proposal.targetCategory !== "foundational_identity" && proposal.targetCategory !== "ordinary_identity") {
      throw new Error("not an identity proposal");
    }
    if (proposal.state === "approved" || proposal.state === "rejected") {
      throw new Error(`cannot reject proposal in state ${proposal.state}`);
    }

    const { transitionProposal } = require("./change-proposal/lifecycle.js");
    const result = transitionProposal(this.db, ownerId, entityUuid, "rejected", "doc", { rationale });
    if (!result.ok) throw new Error(result.errorCode);

    return { rejected: true, proposal: getChangeProposalByEntityUuid(this.db, ownerId, entityUuid) };
  }

  withdrawIdentityProposal(ownerId: string, entityUuid: string) {
    const proposal = getChangeProposalByEntityUuid(this.db, ownerId, entityUuid);
    if (!proposal) throw new Error("proposal not found");
    if (proposal.targetCategory !== "foundational_identity" && proposal.targetCategory !== "ordinary_identity") {
      throw new Error("not an identity proposal");
    }
    if (proposal.state === "approved" || proposal.state === "rejected" || proposal.state === "superseded") {
      throw new Error(`cannot withdraw proposal in state ${proposal.state}`);
    }

    const { transitionProposal } = require("./change-proposal/lifecycle.js");
    const result = transitionProposal(this.db, ownerId, entityUuid, "superseded", "ashley");
    if (!result.ok) throw new Error(result.errorCode);

    return { withdrawn: true, proposal: getChangeProposalByEntityUuid(this.db, ownerId, entityUuid) };
  }

  getChangeProposals(ownerId: string, limit = 50) {
    return {
      proposals: listChangeProposals(this.db, ownerId, limit),
    };
  }

  getChangeProposal(ownerId: string, entityUuid: string) {
    const proposal = getChangeProposalByEntityUuid(this.db, ownerId, entityUuid);
    if (!proposal) return null;
    return {
      proposal,
      events: listChangeProposalEvents(this.db, ownerId, entityUuid),
    };
  }

  createChangeProposalRecord(input: {
    ownerId: string;
    proposer: "ashley" | "operator";
    targetCategory: Parameters<typeof createChangeProposal>[1]["targetCategory"];
    objective: string;
    rationale: string;
    riskClass: "low" | "medium" | "high" | "consultation";
    expiresAt: string;
    baseCommit?: string;
    baseTreeHash?: string;
    linkedRevisionEntityUuid?: string;
    linkedIdentityReviewEntityUuid?: string;
    consultationRequired?: boolean;
  }) {
    return createChangeProposal(this.db, input);
  }

  submitChangeProposal(ownerId: string, entityUuid: string) {
    return proposeChange(this.db, ownerId, entityUuid, "ashley");
  }

  recordChangeProposalAshleyPosition(input: {
    ownerId: string;
    entityUuid: string;
    position: "affirm" | "object" | "defer";
  }) {
    return recordAshleyPosition(
      this.db,
      input.ownerId,
      input.entityUuid,
      input.position,
      "ashley",
    );
  }

  recordChangeProposalDocDecision(input: {
    ownerId: string;
    entityUuid: string;
    decision: "approve" | "reject" | "defer";
  }) {
    return recordDocDecision(
      this.db,
      input.ownerId,
      input.entityUuid,
      input.decision,
      "doc",
    );
  }

  recordChangeProposalExternalOutcome(input: {
    ownerId: string;
    entityUuid: string;
    outcome: "committed" | "deployed" | "abandoned";
    note?: string;
  }) {
    return recordExternalOutcome(
      this.db,
      input.ownerId,
      input.entityUuid,
      input.outcome,
      "doc",
      input.note,
    );
  }

  getExternalActions(ownerId: string, limit = 50) {
    return {
      actions: listExternalActions(this.db, ownerId, limit),
      emergencyStop: getEmergencyStop(this.db, ownerId),
    };
  }

  getExternalAction(ownerId: string, entityUuid: string) {
    const action = getExternalActionByEntityUuid(this.db, ownerId, entityUuid);
    if (!action) return null;
    return {
      action,
      events: listExternalActionEvents(this.db, ownerId, entityUuid),
    };
  }

  getExternalAccounts(ownerId: string) {
    return {
      accounts: listVaultCredentials(this.db, ownerId).map((row) => ({
        credentialRef: row.credentialRef,
        entityUuid: row.entityUuid,
        destinationId: row.destinationId,
        state: row.state,
        credentialLineageRef: row.credentialLineageRef,
      })),
    };
  }

  cancelExternalAction(ownerId: string, entityUuid: string) {
    return cancelAction(this.db, ownerId, entityUuid, "doc");
  }

  reconcileExternalAction(
    ownerId: string,
    entityUuid: string,
    outcome: "committed" | "partially_delivered" | "aborted" | "outcome_unknown",
  ) {
    return reconcileAction(this.db, ownerId, entityUuid, "doc", outcome);
  }

  revokeExternalCredential(ownerId: string, credentialRef: string) {
    return revokeVaultCredential(this.db, ownerId, credentialRef);
  }

  setExternalEmergencyStop(ownerId: string, active: boolean) {
    return setEmergencyStop(this.db, ownerId, active);
  }

  getCapabilities() {
    return {
      masterMode: env.cognitionMode,
      capabilities: this.capabilityStatuses(),
      infrastructure: {
        sandbox: this.getSandboxAvailability(),
      },
    };
  }

  getRoutingStatus(): RoutingRouteStatus[] {
    return routingStatus(this.db);
  }

  getAttentionObservability() {
    return attentionObservability(this.db);
  }

  recordCapabilityEvaluation(input: {
    capability: string;
    seeds: number;
    passed: boolean;
    sourceKey: string;
  }) {
    if (!capabilityNames.includes(input.capability as CapabilityName)) {
      throw new Error("invalid_capability");
    }
    recordIsolatedEvaluation(
      this.db,
      input.capability as CapabilityName,
      {
        seeds: input.seeds,
        passed: input.passed,
        sourceKey: input.sourceKey,
      },
    );
    return this.getCapabilities();
  }

  promoteCapability(input: { capability: string; authorizedBy: string }) {
    if (!capabilityNames.includes(input.capability as CapabilityName)) {
      throw new Error("invalid_capability");
    }
    const result = promoteCapabilityRelease(
      this.db,
      input.capability as CapabilityName,
      { authorizedBy: input.authorizedBy },
    );
    return { ...result, capabilities: this.getCapabilities() };
  }

  operatorRollbackCapability(input: { capability: string; authorizedBy: string }) {
    if (!capabilityNames.includes(input.capability as CapabilityName)) {
      throw new Error("invalid_capability");
    }
    const result = operatorRollbackCapabilityRelease(
      this.db,
      input.capability as CapabilityName,
      { authorizedBy: input.authorizedBy },
    );
    return { ...result, capabilities: this.getCapabilities() };
  }

  recordRecallCutover(ownerId: string, input: { authorizedBy: string }) {
    const result = recordRecallLiveCutover(this.db, ownerId, { authorizedBy: input.authorizedBy });
    return result;
  }

  startRecallQualificationEpoch(input: {
    authorizedBy: string;
    startRequestKey: string;
    expectedCurrentEpochId: string | null;
  }) {
    const result = startRecallQualificationEpochRelease(this.db, input);
    return {
      ...result,
      qualificationEpochs: listRecallQualificationEpochs(this.db),
      currentQualificationEpoch: getCurrentRecallQualificationEpoch(this.db),
    };
  }

  listRecallQualificationEpochs() {
    return {
      current: getCurrentRecallQualificationEpoch(this.db),
      epochs: listRecallQualificationEpochs(this.db),
    };
  }

  startMemoryEvidenceQualificationEpoch(input: StartC1EpochInput) {
    const result = startMemoryEvidenceQualificationEpochRelease(this.db, input);
    return {
      ...result,
      qualificationEpochs: listMemoryEvidenceQualificationEpochs(this.db, input.ownerId),
      currentQualificationEpoch: getCurrentMemoryEvidenceQualificationEpoch(
        this.db,
        input.ownerId,
      ),
    };
  }

  listMemoryEvidenceQualificationEpochs(ownerId: string) {
    return {
      current: getCurrentMemoryEvidenceQualificationEpoch(this.db, ownerId),
      epochs: listMemoryEvidenceQualificationEpochs(this.db, ownerId),
    };
  }

  recordMemoryEvidenceEvaluation(input: RecordC1EvaluationInput) {
    const result = recordMemoryEvidenceIsolatedEvaluation(this.db, input);
    return {
      ...result,
      qualificationEpochs: listMemoryEvidenceQualificationEpochs(this.db, input.ownerId),
      currentQualificationEpoch: getCurrentMemoryEvidenceQualificationEpoch(
        this.db,
        input.ownerId,
      ),
      readiness: getMemoryEvidenceQualificationReadiness(this.db, input.ownerId),
    };
  }

  getMemoryEvidenceCutoverReadiness(
    input: Parameters<typeof getMemoryEvidenceCutoverReadinessRelease>[1],
  ): MemoryEvidenceCutoverReadiness {
    return getMemoryEvidenceCutoverReadinessRelease(this.db, input);
  }

  executeMemoryEvidenceCutover(
    input: Parameters<typeof executeMemoryEvidenceCutoverRelease>[1],
  ): MemoryEvidenceCutoverResult {
    return executeMemoryEvidenceCutoverRelease(this.db, input);
  }

  revertRevision(ownerId: string, revisionId: number): boolean {
    return revertRevision(this.db, ownerId, revisionId);
  }

  recordGifFeedback(
    ownerId: string,
    input: { query: string; success: boolean },
  ): void {
    setKv(
      this.db,
      `signal:gif:${ownerId}:${Date.now()}`,
      JSON.stringify({ ...input, at: new Date().toISOString() }),
    );
  }

  listSuccessfulGifQueries(ownerId: string): string[] {
    const rows = this.db
      .prepare(`SELECT key, value FROM kv WHERE key LIKE ? ORDER BY key DESC LIMIT 40`)
      .all(`signal:gif:${ownerId}:%`);
    const out: string[] = [];
    for (const row of rows) {
      if (!isRow(row) || typeof row.value !== "string") continue;
      try {
        const parsed = JSON.parse(row.value) as { query?: string; success?: boolean };
        if (parsed.success && parsed.query) out.push(parsed.query);
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  recordEmojiWeight(
    _ownerId: string,
    emoji: string,
    context: string,
    positive: boolean,
  ): number {
    const key = `signal:emoji:${emoji}:${context}`;
    const prevRaw = getKv(this.db, key);
    let weight = positive ? 1 : -1;
    if (prevRaw) {
      const n = Number(prevRaw);
      if (Number.isFinite(n)) weight = n + (positive ? 1 : -1);
    }
    setKv(this.db, key, String(weight));
    return weight;
  }

  lookupPreflight(_message: string): boolean {
    return false;
  }

  getCuriosityStatus(ownerId: string): {
    enabled: boolean;
    sources: number;
    sourcesEnabled: number;
    itemsToday: number;
    readToday: number;
    takesToday: number;
    takesRecent: number;
    lastTakeAt: string | null;
    presence: {
      ownTime: boolean;
      proactivePaused: boolean;
      curiosityEnabled: boolean;
      owing: null;
      currentActivity: ReturnType<typeof getCurrentActivity>;
      lastTake: {
        title: string;
        depth: "full" | "excerpt";
        createdAt: string;
        ageMin: number;
      } | null;
    };
  } {
    const sources = listSources(this.db, 100).filter((s) => s.enabled);
    const takes = listRecentTakes(this.db, 12);
    const reads = listRecentReads(this.db, 100);
    const today = new Date().toISOString().slice(0, 10);
    const takesToday = takes.filter((t) => t.createdAt.startsWith(today)).length;
    const readsToday = reads.filter((read) => read.retrievedAt.startsWith(today)).length;
    const itemsTodayRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM cur_items WHERE seen_at >= ?",
    ).get(`${today}T00:00:00.000Z`) as { count?: number } | undefined;
    const last = takes[0] ?? null;
    const ageMin = last
      ? Math.max(0, (Date.now() - Date.parse(last.createdAt)) / 60_000)
      : 0;
    return {
      enabled: env.curiosityEnabled,
      sources: sources.length,
      sourcesEnabled: sources.length,
      itemsToday: Number(itemsTodayRow?.count ?? 0),
      readToday: readsToday,
      takesToday,
      takesRecent: takes.length,
      lastTakeAt: last?.createdAt ?? null,
      presence: {
        ownTime: hasOpenOwnTimeSession(this.db, ownerId),
        proactivePaused: this.isProactivePaused(ownerId),
        curiosityEnabled: env.curiosityEnabled,
        owing: null,
        currentActivity: getCurrentActivity(),
        lastTake: last
          ? {
              title: last.title,
              depth: last.evidenceKind === "read_record" ? "full" : "excerpt",
              createdAt: last.createdAt,
              ageMin,
            }
          : null,
      },
    };
  }

  debugMemoryContext(ownerId: string, message: string): {
    memoryBlockPreview: string;
    hotMessageCount: number;
    threadId: string;
  } {
    const turn = composeTurnContext(this.db, ownerId, {
      channel: "discord",
      userMessage: message,
    });
    return {
      memoryBlockPreview: turn.systemPrompt.slice(0, 2000),
      hotMessageCount: turn.hotMessages.length,
      threadId: turn.threadId,
    };
  }

  getDatabase(): DatabaseSync {
    return this.db;
  }

  getHealth(): {
    ok: boolean;
    nuclearEnabled: boolean;
    dbPath: string;
    schemaVersion: number;
    reflectionMode: ReflectionMode;
    cognitionMode: "observe" | "apply";
    capabilities: ReturnType<typeof listCapabilityStatuses>;
    identityEntries: number;
    decisions: number;
  } {
    try {
      this.db.prepare("SELECT 1").get();
      const versionRow: unknown = this.db
        .prepare("PRAGMA user_version")
        .get();
      const version =
        isRow(versionRow) && typeof versionRow.user_version === "number"
          ? versionRow.user_version
          : 0;
      const identityRow: unknown = this.db
        .prepare("SELECT COUNT(*) AS count FROM identity_entries")
        .get();
      const decisionsRow: unknown = this.db
        .prepare("SELECT COUNT(*) AS count FROM decision_log")
        .get();
      return {
        ok: version >= 10,
        nuclearEnabled: true,
        dbPath:
          this.dataPlane?.nuclearDbPath ??
          this.nuclearFilePath() ??
          ":memory:",
        schemaVersion: version,
        reflectionMode: this.reflectionMode,
        cognitionMode: env.cognitionMode,
        capabilities: this.capabilityStatuses(),
        identityEntries:
          isRow(identityRow) && typeof identityRow.count === "number"
            ? identityRow.count
            : 0,
        decisions:
          isRow(decisionsRow) && typeof decisionsRow.count === "number"
            ? decisionsRow.count
            : 0,
      };
    } catch {
      return {
        ok: false,
        nuclearEnabled: true,
        dbPath:
          this.dataPlane?.nuclearDbPath ??
          this.nuclearFilePath() ??
          ":memory:",
        schemaVersion: 0,
        reflectionMode: this.reflectionMode,
        cognitionMode: env.cognitionMode,
        capabilities: [],
        identityEntries: 0,
        decisions: 0,
      };
    }
  }

  getHealthSnapshot(input: HealthSnapshotInput): {
    liveness: boolean;
    ready: boolean;
    provider: CoreProviderState;
    db: {
      schemaVersion: number;
      integrity: "ok" | "failed";
      foreignKeys: "enabled" | "disabled" | "unknown";
      continuity: {
        available: boolean;
        schemaVersion: number | null;
        lineagePresent: boolean;
      };
    };
    deliveryPressure: {
      byState: Array<{ state: string; count: number }>;
      activeReservations: number;
      inboundMessages: number;
    };
    backgroundStarvation: {
      attentionQueued: number;
      attentionOldestAgeSec: number | null;
      cognitivePending: number;
      cognitiveOldestAgeSec: number | null;
    };
    backup: {
      available: boolean;
      lastVerifiedAt: string | null;
      lastCreatedAt: string | null;
      ageSec: number | null;
      lineageId: string | null;
    };
    capabilities: {
      masterMode: "observe" | "apply";
      effectiveCount: number;
      byState: Record<string, number>;
      contractMismatch: boolean;
    };
    identity: {
      buildIdentity: string;
      contractId: string;
      modelEpoch: number;
      resolvedModels: Array<{ alias: string; resolvedModelId: string | null; epoch: number }>;
    };
  } {
    const now = Date.now();
    const coreHealth = this.getHealth();
    const attention = this.getAttentionObservability();
    const rowNumber = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0);
    const ageSec = (value: unknown): number | null => {
      if (typeof value !== "string") return null;
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp)
        ? Math.max(0, Math.floor((now - timestamp) / 1000))
        : null;
    };

    let integrity: "ok" | "failed" = "failed";
    let foreignKeys: "enabled" | "disabled" | "unknown" = "unknown";
    try {
      const quick = this.db.prepare("PRAGMA quick_check(1)").get() as Record<string, unknown> | undefined;
      integrity = quick?.quick_check === "ok" ? "ok" : "failed";
      const fk = this.db.prepare("PRAGMA foreign_keys").get() as Record<string, unknown> | undefined;
      foreignKeys = rowNumber(fk?.foreign_keys) === 1 ? "enabled" : "disabled";
    } catch {
      integrity = "failed";
    }

    const deliveryRows = this.db.prepare(
      `SELECT state, COUNT(*) AS count
       FROM delivery_reservations
       GROUP BY state ORDER BY state`,
    ).all() as Array<Record<string, unknown>>;
    const inboundRow = this.db.prepare(
      "SELECT COUNT(*) AS count FROM delivery_inbound_messages",
    ).get() as Record<string, unknown> | undefined;
    const activeRow = this.db.prepare(
      `SELECT COUNT(*) AS count FROM delivery_reservations
       WHERE state IN ('drafted', 'reserved', 'sending')`,
    ).get() as Record<string, unknown> | undefined;

    const queuedAttention = (attention.queuedByLane as Array<Record<string, unknown>>)
      .reduce((sum, row) => sum + rowNumber(row.c), 0);
    const oldestAttention = (attention.queuedByLane as Array<Record<string, unknown>>)
      .map((row) => ageSec(row.oldest))
      .filter((value): value is number => value != null)
      .sort((a, b) => b - a)[0] ?? null;
    const cognitiveRows = this.db.prepare(
      `SELECT COUNT(*) AS count, MIN(available_at) AS oldest
       FROM cognitive_jobs WHERE status IN ('pending', 'running')`,
    ).get() as Record<string, unknown> | undefined;

    let continuityAvailable = false;
    let continuitySchemaVersion: number | null = null;
    let lineagePresent = false;
    let backup: {
      available: boolean;
      lastVerifiedAt: string | null;
      lastCreatedAt: string | null;
      ageSec: number | null;
      lineageId: string | null;
    } = {
      available: false,
      lastVerifiedAt: null,
      lastCreatedAt: null,
      ageSec: null,
      lineageId: null,
    };
    if (this.continuity) {
      continuityAvailable = true;
      try {
        const version = this.continuity.prepare("PRAGMA user_version").get() as Record<string, unknown> | undefined;
        continuitySchemaVersion = rowNumber(version?.user_version);
        const lineage = getAuthoritativeLineageId(this.continuity);
        lineagePresent = Boolean(lineage);
        const last = this.continuity.prepare(
          `SELECT occurred_at, lineage_id FROM backup_watermarks
           WHERE kind = 'backup' ORDER BY id DESC LIMIT 1`,
        ).get() as Record<string, unknown> | undefined;
        if (typeof last?.occurred_at === "string" && typeof last.lineage_id === "string") {
          backup = {
            available: true,
            // A watermark proves package creation, not a later restore verify.
            lastVerifiedAt: null,
            lastCreatedAt: last.occurred_at,
            ageSec: ageSec(last.occurred_at),
            lineageId: last.lineage_id,
          };
        }
      } catch {
        continuityAvailable = false;
      }
    }

    const capabilityStatuses = coreHealth.capabilities;
    const byState: Record<string, number> = {};
    for (const status of capabilityStatuses) {
      byState[status.state] = (byState[status.state] ?? 0) + 1;
    }
    const resolvedModels = (attention.continuity as Array<Record<string, unknown>>).map((row) => ({
      alias: String(row.alias ?? ""),
      resolvedModelId: typeof row.resolved_model_id === "string" ? row.resolved_model_id : null,
      epoch: rowNumber(row.model_epoch),
    }));

    return {
      liveness: true,
      ready: input.ready,
      provider: input.providerState,
      db: {
        schemaVersion: coreHealth.schemaVersion,
        integrity,
        foreignKeys,
        continuity: {
          available: continuityAvailable,
          schemaVersion: continuitySchemaVersion,
          lineagePresent,
        },
      },
      deliveryPressure: {
        byState: deliveryRows.map((row) => ({
          state: String(row.state ?? ""),
          count: rowNumber(row.count),
        })),
        activeReservations: rowNumber(activeRow?.count),
        inboundMessages: rowNumber(inboundRow?.count),
      },
      backgroundStarvation: {
        attentionQueued: queuedAttention,
        attentionOldestAgeSec: oldestAttention,
        cognitivePending: rowNumber(cognitiveRows?.count),
        cognitiveOldestAgeSec: ageSec(cognitiveRows?.oldest),
      },
      backup,
      capabilities: {
        masterMode: env.cognitionMode,
        effectiveCount: capabilityStatuses.filter((status) => status.effective).length,
        byState,
        contractMismatch: capabilityStatuses.some((status) => status.contractMismatch),
      },
      identity: {
        buildIdentity: attention.buildIdentity,
        contractId: attention.contractId,
        modelEpoch: attention.modelEpoch,
        resolvedModels,
      },
    };
  }
}
