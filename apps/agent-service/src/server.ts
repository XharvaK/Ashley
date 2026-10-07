import { listTeachers, setTeacher } from "./core/teach/lessons.js";
import {
  endQuietWindow,
  openOwnerQuiet,
  readOpenQuietWindow,
  recordOwnerPresence,
  setOwnerDnd,
} from "./core/cognitive-v021/quiet/window.js";
import { DEFAULT_OWNER_TIME_ZONE } from "./core/cognitive-v021/thought/clock.js";
import { ownerPlacesView, ownerSwitchPlace } from "./core/places/owner.js";
import { lifeReceipt, renderLifeReceipt } from "./core/will/receipt.js";
import { listGrowthDimensions, revertAshleyDimensionEdit, seedGrowthDimension } from "./core/cognitive-v021/growth/dimensions.js";
import { decideDomusIngress } from "./core/domus/ingress.js";
import { listDomusDiary } from "./core/domus/diary.js";
import { readDomusStatus } from "./core/domus/store.js";
import {readSelfChangeLadder,commandSelfChangeLadder,recordSelfChangeLadderFinding} from "./core/cognitive-v021/growth/self-change-ladder.js";
import { listPersonaSnapshots, personaChanges } from "./core/cognitive-v021/growth/snapshots.js";
import express from "express";
import cors from "cors";
import type { Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { AgentManager } from "./agent.js";
import { env, nuclearIdentityOwnerId } from "./env.js";
import { toErrorResponse, AppError } from "./errors.js";
import { listRecentDecisions } from "./core/agency/log.js";
import { retrieveEpisodes } from "./core/memory/episodes.js";
import { isAuthorizedOwnerId } from "./owner-auth.js";
import {isThalamusEnabled,schedulerContract,observeGatewayUserId} from "./core/cognitive-v021/thalamus/scheduler.js";
import {thalamusStatus} from "./core/cognitive-v021/thalamus/status.js";
import { createTransportAuth } from "./transport-auth.js";
import { assertRegisteredRoutes } from "./route-surface.js";
import { parsePlaceSyncReports, syncPlacePosts } from "./core/places/intents.js";
import { openCognitiveSidecarDb } from "./core/cognitive-v021/sidecar/db.js";
import {
  createCognitiveIngressHandler,
  createExternalBatchHandler,
  createExternalCaptureHandler,
  isExternalSocialCaptureEnabled,
} from "./core/cognitive-v021/ingress/http.js";
import {
  createOwnerTransportCaptureHandler,
  createOwnerTransportHistoryPageHandler,
  createOwnerTransportMarkAdmittedHandler,
  createOwnerTransportPendingHandler,
  createOwnerTransportStateHandler,
} from "./core/cognitive-v021/ingress/owner-transport.js";
import { getCognitiveHealthSnapshot } from "./core/cognitive-v021/dispatch/health.js";
import {
  CURIOSITY_TTL_MS,
  MAX_ACTIVE_WORKERS,
  MAX_NONTERMINAL_WORKER_UNDERTAKINGS,
  MAX_PENDING_CURIOSITY,
  WORKER_SERVICE_CALENDAR,
  getWorkerExecutionSlot,
  getWorkerSchedulerCursor,
  listWorkerUndertakings,
  selectNextWorkerUndertaking,
} from "./core/cognitive-v021/operation/worker-queue.js";
import { markProjectedDeliverySending } from "./core/cognitive-v021/delivery/outbox-projector.js";
import { markDeliveryDispatchStarted } from "./core/delivery/store.js";
import {
  recheckExternalPublicationReservation,
  recheckOwnerPublicationReservation,
} from "./core/cognitive-v021/settlement/publish.js";
import { reconcilePolicyClock } from "./core/cognitive-v021/private-budget/policy-time-ledger.js";
import { activePrivateThoughtPolicyId } from "./core/cognitive-v021/private-budget/policies.js";
import { getContinuityFor } from "./core/continuity/registry.js";
import {
  admitV021RememberCommand,
  cancelV021Forget,
  confirmV021Forget,
  getV021MemorySummary,
  previewV021Forget,
} from "./core/cognitive-v021/commands.js";
import {
  evaluateRevisions,
  listFoundationalReviews,
  listCurrentPractices,
  recordOwnerRevisionDecision,
  revertRevision,
} from "./core/cognitive-v021/growth/revisions.js";
import {
  admitOwnerCorrection,
  type AdmissionPath,
  type CorrectionClass,
  type InclusionReason,
  type ResolutionBasis,
} from "./core/memory/corrections.js";
import {
  correctionDiagnostics,
  correctionHighWater,
  fanoutCorrection,
} from "./core/memory/fanout.js";
import { getMemoryContractState } from "./core/memory/contract-state.js";
import { capabilityCanInfluence } from "./core/rollout/capabilities.js";
import {
  C1_EVALUATION_DEFINITION_ID,
  C1_EVALUATION_DEFINITION_VERSION,
  C1_REQUIRED_EVAL_SEEDS,
} from "./core/rollout/memory-evidence-qualification-epoch.js";

import { getCognitiveGraduationDiagnostics, setGraduationMode } from "./core/cognitive-v021/graduation/diagnostics.js";
import { setInfluenceMode } from "./core/cognitive-v021/influences/contract-state.js";
import { rollbackCognitiveGraduation } from "./core/cognitive-v021/graduation/calibration.js";
import { CORRECTION_CLASSES, DISPOSITIONS, latestAdjudication, recordAdjudication, type AdjudicationInput } from "./core/cognitive-v021/graduation/adjudications.js";
import {
  ObservabilityStore,
  RAW_DEBUG_RETENTION_MAX_MS,
  readObservabilityMode,
} from "./core/cognitive-v021/thought/diagnostics.js";
import { listPeriodicDiagnostics } from "./core/cognitive-v021/initiative/periodic-diagnostics.js";
import {
  buildProactiveOperatorStatus,
  unavailableProactiveOperatorStatus,
} from "./core/cognitive-v021/initiative/operator-status.js";
import { readPresencePhase } from "./core/cognitive-v021/initiative/presence-phase.js";
import {
  readPublicPresenceContext,
  readPublicPresenceState,
  recordPublicPresenceProjection,
} from "./core/cognitive-v021/public-presence.js";
import type { DataClassification } from "./core/privacy/classification.js";
import type {
  ConsentEventKind,
  ConsentGrantorRole,
  InteractionContractKind,
  InteractionContractLifecycle,
  RepairDisposition,
  RepairProposalOrigin,
} from "./core/relationship/types.js";
import type { InteractionContractEvidenceRef } from "./core/relationship/interaction-contracts.js";
import {
  classifyEligibility,
  configuredBotDmPrincipal,
  grantSocialOperationDelegation,
  grantPerson,
  listActiveSocialPermits,
  revokePerson,
  inspectSocialOperationDelegation,
  listSocialOperationDelegations,
  readEligibilityBundle,
  revokeSocialOperationDelegation,
  type SocialOperationClass,
} from "./core/relationship/social-authority.js";
import { claimSoftActs, reportSoftAct } from "./core/cognitive-v021/soft/acts.js";
import { SOCIAL_OPERATION_DELEGATION_CLASSES } from "./core/relationship/migration-53.js";
import { isRoomSeedActive } from "./core/relationship/room-seeding.js";
import { getRaEffectiveConfig } from "./core/relationship/ra-effective-config.js";
import {
  executeTemporalControl,
  type TemporalKind,
  type TemporalOperation,
} from "./core/cognitive-v021/initiative/temporal-control.js";

const C5_CLASSIFICATIONS = ["ordinary", "sensitive", "never_public", "secret"] as const;
const C5_OPERATIONS = [
  "self_commitment",
  "tension",
  "consent",
  "interaction_contract",
  "repair_proposal",
  "repair_evidence",
  "repair_adjudication",
  "mutual_proposal",
  "mutual_doc_confirmation",
  "mutual_ashley_decision",
  "mutual_delivery",
  "mutual_activate",
  "mutual_withdraw",
] as const;
const TEMPORAL_OPERATIONS = ["list", "inspect", "cancel", "amend", "withdraw"] as const;
const TEMPORAL_KINDS = ["future_trigger", "subscription", "commitment", "directive"] as const;

function c5RequiredString(body: Record<string, unknown>, key: string, max = 2000): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("message_required", `${key} is required`, 400);
  }
  return value.trim().slice(0, max);
}

function c5NullableString(
  body: Record<string, unknown>,
  key: string,
  max = 2000,
): string | null | undefined {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (body[key] === null) return null;
  if (typeof body[key] !== "string") {
    throw new AppError("message_required", `${key} must be a string or null`, 400);
  }
  return body[key].trim().slice(0, max);
}

function c5OptionalString(
  body: Record<string, unknown>,
  key: string,
  max = 2000,
): string | undefined {
  const value = c5NullableString(body, key, max);
  return value === null ? undefined : value;
}

function c5RequiredInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AppError("message_required", `${key} must be an integer`, 400);
  }
  return value;
}

function c5NullableInteger(
  body: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (body[key] === null) return null;
  if (typeof body[key] !== "number" || !Number.isInteger(body[key])) {
    throw new AppError("message_required", `${key} must be an integer or null`, 400);
  }
  return body[key] as number;
}

function c5OptionalInteger(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = c5NullableInteger(body, key);
  return value === null ? undefined : value;
}

function c5Array(body: Record<string, unknown>, key: string): unknown[] {
  const value = body[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError("message_required", `${key} must be a non-empty array`, 400);
  }
  return value;
}

function c5OptionalArray(body: Record<string, unknown>, key: string): unknown[] | undefined {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (!Array.isArray(body[key])) {
    throw new AppError("message_required", `${key} must be an array`, 400);
  }
  return body[key];
}

function c5Object(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  if (!(key in body) || body[key] === undefined) return undefined;
  const value = body[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("message_required", `${key} must be an object`, 400);
  }
  return value as Record<string, unknown>;
}

function c5Enum<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = body[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new AppError("message_required", `${key} has an invalid value`, 400);
  }
  return value as T;
}

function c5Classification(body: Record<string, unknown>): DataClassification {
  return c5Enum(body, "classification", C5_CLASSIFICATIONS);
}

function c5InteractionEvidenceRefs(
  body: Record<string, unknown>,
): InteractionContractEvidenceRef[] {
  return c5Array(body, "evidenceRefs").map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new AppError("message_required", "evidenceRefs contains an invalid reference", 400);
    }
    const ref = value as Record<string, unknown>;
    if (typeof ref.type !== "string" || !ref.type.trim() ||
        (typeof ref.id !== "string" && typeof ref.id !== "number")) {
      throw new AppError("message_required", "evidenceRefs contains an invalid reference", 400);
    }
    return { type: ref.type.trim().slice(0, 200), id: ref.id };
  });
}

const MAX_DISCORD_MESSAGE = 4000;

function requireOwner(userId: string | undefined): string {
  if (!isAuthorizedOwnerId(userId)) {
    throw new AppError("forbidden", "Forbidden", 403);
  }
  return userId;
}

function c1Body(req: express.Request): Record<string, unknown> {
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("bad_request", "request body must be an object", 400);
  }
  return body as Record<string, unknown>;
}

function c1RequiredString(
  body: Record<string, unknown>,
  key: string,
  max = 300,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("message_required", `${key} is required`, 400);
  }
  const clean = value.trim();
  if (clean.length > max) {
    throw new AppError("message_required", `${key} is too long`, 400);
  }
  return clean;
}

function c1OptionalInteger(
  body: Record<string, unknown>,
  key: string,
): number | undefined {
  if (!(key in body) || body[key] === undefined) return undefined;
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AppError("message_required", `${key} must be an integer`, 400);
  }
  return value;
}

function c1RequiredNullableString(
  body: Record<string, unknown>,
  key: string,
): string | null {
  if (!(key in body)) {
    throw new AppError("message_required", `${key} is required`, 400);
  }
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError("message_required", `${key} must be a string or null`, 400);
  }
  const clean = value.trim();
  if (clean.length > 300) {
    throw new AppError("message_required", `${key} is too long`, 400);
  }
  return clean;
}

function c1ActivationPath(value: unknown): "maturation" | "owner_bootstrap" {
  if (value === undefined) return "maturation";
  if (value !== "maturation" && value !== "owner_bootstrap") {
    throw new AppError(
      "message_required",
      "activationPath must be maturation or owner_bootstrap",
      400,
    );
  }
  return value;
}

function c1EvaluationSeeds(
  body: Record<string, unknown>,
): Array<{ id: string; passed: boolean }> {
  const value = body.seeds;
  if (!Array.isArray(value) || value.length !== C1_REQUIRED_EVAL_SEEDS.length) {
    throw new AppError("message_required", "seeds must contain all required C1 seeds", 400);
  }
  const allowed = new Set<string>(C1_REQUIRED_EVAL_SEEDS);
  const seen = new Set<string>();
  const seeds = value.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new AppError("message_required", "seeds contains an invalid entry", 400);
    }
    const seed = candidate as Record<string, unknown>;
    if (
      typeof seed.id !== "string" ||
      !allowed.has(seed.id) ||
      seen.has(seed.id) ||
      typeof seed.passed !== "boolean"
    ) {
      throw new AppError("message_required", "seeds contains an invalid value", 400);
    }
    seen.add(seed.id);
    return { id: seed.id, passed: seed.passed };
  });
  if (seen.size !== C1_REQUIRED_EVAL_SEEDS.length) {
    throw new AppError("message_required", "seeds must contain all required C1 seeds", 400);
  }
  return seeds;
}

function trustedC1Quiescence(manager: AgentManager, ownerId: string): {
  expressionPlanePaused: boolean;
  ownerExpressionActive: boolean;
} {
  return {
    expressionPlanePaused: manager.isPaused(),
    // The current V0.2.1 dispatcher owns turn concurrency in the sidecar.
    // The retired runtime no longer exposes an in-process expression owner set.
    ownerExpressionActive: false,
  };
}

function gone(_req: express.Request, res: express.Response): void {
  res.status(410).json({
    error: "retired",
    code: "endpoint_retired",
    message: "Voice, Telegram, habits, and network skills were retired.",
  });
}

export function createServer(
  manager: AgentManager,
  options: {
    cognitiveSidecar?: DatabaseSync | null;
    observabilityDb?: DatabaseSync | null;
    botServiceToken?: string;
    /** Defaults to DISCORD_OWNER_ID; admin routes fail closed without it. */
    ownerId?: string;
    projectSystemNotice?: (noticeId: number) => Promise<void> | void;
  } = {},
): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

  const botServiceToken = (
    options.botServiceToken ?? process.env.DISCORD_BOT_TOKEN ?? ""
  ).trim();
  app.use(createTransportAuth({
    serviceToken: botServiceToken,
    ownerId: options.ownerId ?? env.discordOwnerId,
  }));
  function requireBotService(req: express.Request): void {
    const presented = req.get("X-Ashley-Bot-Service")?.trim() ?? "";
    if (!botServiceToken || !presented || presented !== botServiceToken) {
      throw new AppError("forbidden", "Forbidden", 403);
    }
  }

  function requireReady(): void {
    if (manager.getState() !== "ready") {
      throw new AppError("agent_not_ready", "Agent not ready", 503);
    }
  }

  let cognitiveSidecar = options.cognitiveSidecar ?? null;
  function getCognitiveSidecar(): DatabaseSync {
    if (cognitiveSidecar) return cognitiveSidecar;
    const dataPlane = manager.dataPlane;
    if (!dataPlane) throw new AppError("agent_not_ready", "Cognitive sidecar unavailable", 503);
    cognitiveSidecar = openCognitiveSidecarDb(
      new DatabaseSync(dataPlane.cognitiveSidecarDbPath),
      { dataPlane },
    );
    return cognitiveSidecar;
  }

  let observabilityDb = options.observabilityDb ?? null;
  function getObservabilityDb(): DatabaseSync {
    if (observabilityDb) return observabilityDb;
    throw new AppError("agent_not_ready", "Observability store unavailable", 503);
  }

  function cognitiveHealth() {
    const managerWithCognitive = manager as AgentManager & {
      getCognitiveKernel?: () => "v021";
      getCognitiveSidecar?: () => DatabaseSync | null;
    };
    return getCognitiveHealthSnapshot({
      mode: managerWithCognitive.getCognitiveKernel?.() ?? "v021",
      sidecar: managerWithCognitive.getCognitiveSidecar?.() ?? cognitiveSidecar,
      sidecarPath: manager.dataPlane?.cognitiveSidecarDbPath ?? null,
    });
  }

  function cognitiveKernel(): "v021" {
    return manager.getCognitiveKernel();
  }

  function cognitiveContinuity(): DatabaseSync {
    const continuity = getContinuityFor(manager.core.getDatabase());
    if (!continuity) throw new AppError("agent_not_ready", "Cognitive continuity unavailable", 503);
    return continuity;
  }

  app.get("/health", (_req, res) => {
    const cognitive = cognitiveHealth();
    res.json({
      ok: true,
      ready: manager.getState() === "ready" || manager.getState() === "busy",
      state: manager.getState(),
      uptimeSec: manager.getUptimeSec(),
      providerState: manager.getProviderState(),
      ...manager.getReadinessSnapshot(),
      ...cognitive,
    });
  });

  app.get("/nuclear/health", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json({
        ...manager.core.getHealthSnapshot({
        ready: manager.getState() === "ready" || manager.getState() === "busy",
        providerState: manager.getProviderState(),
        }),
        ...manager.getReadinessSnapshot(),
        ...cognitiveHealth(),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/decisions", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const limit = Math.min(100, Number(req.query.limit ?? 20) || 20);
      res.json({
        nuclear: true,
        decisions: listRecentDecisions(manager.core.getDatabase(), ownerId, limit),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/reflections", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const limit = Math.min(100, Number(req.query.limit ?? 20) || 20);
      res.json(manager.core.getReflections(ownerId, limit));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/episodes", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const limit = Math.min(20, Number(req.query.limit ?? 10) || 10);
      res.json({
        mode: env.cognitionMode,
        episodes: retrieveEpisodes(
          manager.core.getDatabase(),
          ownerId,
          String(req.query.query ?? ""),
          limit,
        ),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/cognition", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(manager.core.getCognitionOverview(ownerId));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/capabilities", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(manager.core.getCapabilities());
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/attention", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(manager.core.getAttentionObservability());
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/continuity", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(manager.core.continuitySnapshot());
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/relationship", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const limit = Math.min(25, Number(req.query.limit ?? 25) || 25);
      const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      res.json(manager.core.relationshipSummary(ownerId, limit, offset));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/social-operation-delegations", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const principalId = c1RequiredString(body, "principalId", 300);
      const conversationId = c1RequiredString(body, "conversationId", 300);
      const operationClasses = (() => {
        const value = body.operationClasses;
        if (!Array.isArray(value) || value.length === 0) {
          throw new AppError("message_required", "operationClasses must be a non-empty array", 400);
        }
        const unique = [...new Set(value.map((item) => {
          if (typeof item !== "string" || !SOCIAL_OPERATION_DELEGATION_CLASSES.includes(item as SocialOperationClass)) {
            throw new AppError("message_required", "operationClasses has an invalid value", 400);
          }
          return item as SocialOperationClass;
        }))];
        return unique;
      })();
      let expiresAt: string | null = null;
      if (body.expiresAt !== undefined && body.expiresAt !== null) {
        expiresAt = c1RequiredString(body, "expiresAt", 100);
        if (!Number.isFinite(Date.parse(expiresAt))) {
          throw new AppError("message_required", "expiresAt must be an ISO timestamp", 400);
        }
      }
      const delegations = operationClasses.map((operationClass) => grantSocialOperationDelegation(
        manager.core.getDatabase(),
        {
          ownerId,
          principalId,
          conversationId,
          operationClass,
          expiresAt,
          sourceSpan: {
            kind: "owner_control",
            route: "/nuclear/social-operation-delegations",
            ownerId,
          },
          nowMs: Date.now(),
        },
      ));
      res.json({ ok: true, delegations });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/social-operation-delegations", (req, res) => {
    try {
      const ownerId = requireOwner(String(req.query.owner_id ?? "") || undefined);
      const principalId = typeof req.query.principal_id === "string" ? req.query.principal_id : undefined;
      const conversationId = typeof req.query.conversation_id === "string" ? req.query.conversation_id : undefined;
      const operationClass = req.query.operation_class === undefined
        ? undefined
        : c5Enum<SocialOperationClass>(
            { operationClass: req.query.operation_class },
            "operationClass",
            SOCIAL_OPERATION_DELEGATION_CLASSES,
          );
      res.json({
        delegations: listSocialOperationDelegations(manager.core.getDatabase(), {
          ownerId,
          principalId,
          conversationId,
          operationClass,
        }),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/social-operation-delegations/:entityUuid", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      const delegation = inspectSocialOperationDelegation(
        manager.core.getDatabase(),
        c1RequiredString({ entityUuid: req.params.entityUuid }, "entityUuid", 300),
      );
      if (!delegation) throw new AppError("not_found", "Social operation delegation not found", 404);
      res.json({ delegation });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/social-operation-delegations/revoke", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const expectedVersion = c1OptionalInteger(body, "expectedVersion");
      if (expectedVersion !== undefined && expectedVersion < 1) {
        throw new AppError("message_required", "expectedVersion must be positive", 400);
      }
      const delegation = revokeSocialOperationDelegation(
        manager.core.getDatabase(),
        {
          entityUuid: c1RequiredString(body, "entityUuid", 300),
          expectedVersion,
          nowMs: Date.now(),
        },
      );
      res.json({ ok: true, ownerId, delegation });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  /**
   * A3 trusted contacts: the Owner grants or revokes who may talk with Ashley
   * in DMs (dm_only) or DMs and rooms (person_wide). Contacts get no admin.
   */
  app.get("/social/contacts", (_req, res) => {
    try {
      const teachers = new Set(listTeachers(getCognitiveSidecar()));
      const contacts = listActiveSocialPermits(manager.core.getDatabase(), Date.now())
        .map((item) => ({ principalId: item.principalId, scope: item.scope, grantedAt: item.grantedAt, expiresAt: item.expiresAt,
          ...(teachers.has(item.principalId) ? { teacher: true } : {}) }));
      res.json({ ok: true, contacts });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/social/contacts", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const principalId = c1RequiredString(body, "principalId", 300);
      if (principalId === ownerId) throw new AppError("message_required", "the Owner is not a contact", 400);
      const scope = body.scope === "person_wide" ? "person_wide" : "dm_only";
      const permit = grantPerson(manager.core.getDatabase(), {
        ownerId,
        principalId,
        scope,
        sourceSpan: { kind: "owner_control", route: "/social/contacts", ownerId },
        nowMs: Date.now(),
      });
      res.json({ ok: true, contact: { principalId: permit.principalId, scope: permit.scope, grantedAt: permit.grantedAt } });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/social/contacts/revoke", (req, res) => {
    try {
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const principalId = c1RequiredString(body, "principalId", 300);
      const db = manager.core.getDatabase();
      const revoked = listActiveSocialPermits(db, Date.now())
        .filter((item) => item.principalId === principalId)
        .map((item) => revokePerson(db, { entityUuid: item.entityUuid, nowMs: Date.now() }));
      setTeacher(getCognitiveSidecar(), principalId, false, Date.now());
      res.json({ ok: true, revoked: revoked.length });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  /** T: the Owner switches a trusted contact to one of her teachers, or back. */
  app.post("/social/contacts/teacher", (req, res) => {
    try {
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const principalId = c1RequiredString(body, "principalId", 300);
      const on = body.on === true;
      if (on && !listActiveSocialPermits(manager.core.getDatabase(), Date.now()).some((item) => item.principalId === principalId)) {
        throw new AppError("message_required", "only a trusted contact can be her teacher", 400);
      }
      setTeacher(getCognitiveSidecar(), principalId, on, Date.now());
      res.json({ ok: true, teacher: on });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  /** Owner-only mechanical control of stored temporal work and directives. */
  app.post("/nuclear/temporal", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const operation = c5Enum<TemporalOperation>(body, "operation", TEMPORAL_OPERATIONS);
      const kind = body.kind === undefined || body.kind === null
        ? undefined
        : c5Enum<TemporalKind>(body, "kind", TEMPORAL_KINDS);
      const id = operation === "list" ? undefined : c1RequiredString(body, "id", 300);
      if (operation !== "list" && !kind) {
        throw new AppError("message_required", "kind is required", 400);
      }
      if (operation === "cancel" && kind === "directive") {
        throw new AppError("bad_request", "directive cancellation uses withdraw", 400);
      }
      if (operation === "withdraw" && kind !== "directive") {
        throw new AppError("bad_request", "withdraw requires kind=directive", 400);
      }
      const hasDueAtMs = Object.prototype.hasOwnProperty.call(body, "dueAtMs");
      let dueAtMs: number | undefined;
      if (hasDueAtMs) {
        if (typeof body.dueAtMs !== "number" || !Number.isSafeInteger(body.dueAtMs) || body.dueAtMs < 0) {
          throw new AppError("message_required", "dueAtMs must be a non-negative safe integer", 400);
        }
        dueAtMs = body.dueAtMs;
      }
      const hasWindowStartMs = Object.prototype.hasOwnProperty.call(body, "windowStartMs");
      const hasWindowEndMs = Object.prototype.hasOwnProperty.call(body, "windowEndMs");
      let windowStartMs: number | undefined;
      let windowEndMs: number | undefined;
      if (hasWindowStartMs || hasWindowEndMs) {
        if (!hasWindowStartMs || !hasWindowEndMs
          || typeof body.windowStartMs !== "number"
          || typeof body.windowEndMs !== "number"
          || !Number.isSafeInteger(body.windowStartMs)
          || !Number.isSafeInteger(body.windowEndMs)
          || body.windowStartMs < 0
          || body.windowEndMs < body.windowStartMs) {
          throw new AppError("message_required", "windowStartMs and windowEndMs must be ordered non-negative safe integers", 400);
        }
        windowStartMs = body.windowStartMs;
        windowEndMs = body.windowEndMs;
      }
      const hasLateBehavior = Object.prototype.hasOwnProperty.call(body, "lateBehavior");
      const lateBehavior = hasLateBehavior ? body.lateBehavior : undefined;
      if (hasLateBehavior && !["deliver_late", "reconsider", "expire"].includes(String(lateBehavior))) {
        throw new AppError("message_required", "lateBehavior is invalid", 400);
      }
      const hasLatestUsefulAtMs = Object.prototype.hasOwnProperty.call(body, "latestUsefulAtMs");
      let latestUsefulAtMs: number | null | undefined;
      if (hasLatestUsefulAtMs) {
        if (body.latestUsefulAtMs !== null
          && (typeof body.latestUsefulAtMs !== "number" || !Number.isSafeInteger(body.latestUsefulAtMs) || body.latestUsefulAtMs < 0)) {
          throw new AppError("message_required", "latestUsefulAtMs must be null or a non-negative safe integer", 400);
        }
        latestUsefulAtMs = body.latestUsefulAtMs as number | null;
      }
      const hasPurpose = Object.prototype.hasOwnProperty.call(body, "purpose") && body.purpose !== undefined;
      let purpose: string | null | undefined;
      if (hasPurpose) {
        if (body.purpose !== null && typeof body.purpose !== "string") {
          throw new AppError("message_required", "purpose must be a string or null", 400);
        }
        purpose = body.purpose === null ? null : body.purpose.trim().slice(0, 1000);
      }
      const hasCommitmentTiming = hasDueAtMs || hasWindowStartMs || hasWindowEndMs || hasLateBehavior || hasLatestUsefulAtMs;
      if (operation === "amend" && kind === "commitment" && !hasCommitmentTiming) {
        throw new AppError("message_required", "commitment amend requires timing fields", 400);
      }
      if (operation === "amend" && kind !== "commitment" && !hasDueAtMs && !hasPurpose) {
        throw new AppError("message_required", "amend requires dueAtMs or purpose", 400);
      }
      const limit = c1OptionalInteger(body, "limit");
      const result = executeTemporalControl(
        getCognitiveSidecar(),
        manager.core.getDatabase(),
        ownerId,
        {
          operation,
          kind,
          id,
          limit,
          dueAtMs,
          windowStartMs,
          windowEndMs,
          lateBehavior: lateBehavior as "deliver_late" | "reconsider" | "expire" | undefined,
          latestUsefulAtMs,
          hasLatestUsefulAtMs,
          purpose,
          hasDueAtMs,
          hasPurpose,
        },
      );
      if (!result) throw new AppError("not_found", "Temporal record not found", 404);
      res.json(result);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  /**
   * Explicit owner-authenticated C5 admission. The request is an event
   * envelope, not a model callback. The runtime selects the current master
   * mode; callers cannot request dark_apply or bypass the apply ceiling.
   */
  app.post("/nuclear/relationship/c5", (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ownerId = requireOwner(
        typeof body.userId === "string" ? body.userId : undefined,
      );
      const operation = c5Enum(body, "operation", C5_OPERATIONS);
      let result: unknown;
      switch (operation) {
        case "self_commitment":
          result = manager.core.recordC5AshleySelfCommitment({
            ownerId,
            text: c5RequiredString(body, "text", 600),
            sourceEntityType: c5RequiredString(body, "sourceEntityType", 200),
            sourceEntityUuid: c5RequiredString(body, "sourceEntityUuid", 200),
            decisionId: c5NullableInteger(body, "decisionId"),
            evidenceRefs: c5Array(body, "evidenceRefs"),
            hostValidationOk: true,
            classification: c5Classification(body),
            partySubjectScope: c5OptionalString(body, "partySubjectScope", 200),
            dueAt: c5NullableString(body, "dueAt", 80),
          });
          break;
        case "tension":
          result = manager.core.recordC5RelationalTension({
            ownerId,
            text: c5RequiredString(body, "text", 600),
            sourceEntityType: c5RequiredString(body, "sourceEntityType", 200),
            sourceEntityUuid: c5RequiredString(body, "sourceEntityUuid", 200),
            decisionId: c5NullableInteger(body, "decisionId"),
            evidenceRefs: c5Array(body, "evidenceRefs"),
            hostValidationOk: true,
            classification: c5Classification(body),
            partySubjectScope: c5OptionalString(body, "partySubjectScope", 200),
          });
          break;
        case "consent":
          result = manager.core.recordC5Consent({
            ownerId,
            grantorIdentityRole: c5Enum<ConsentGrantorRole>(body, "grantorIdentityRole", ["doc", "ashley"]),
            granteeOrConsumer: c5RequiredString(body, "granteeOrConsumer", 200),
            scope: c5RequiredString(body, "scope", 200),
            purpose: c5RequiredString(body, "purpose", 500),
            evidenceOrDecisionRef: c5RequiredString(body, "evidenceOrDecisionRef", 300),
            classification: c5Classification(body),
            eventKind: c5Enum<ConsentEventKind>(body, "eventKind", ["grant", "revoke", "expire", "supersede"]),
            supersedesConsentId: c5NullableInteger(body, "supersedesConsentId"),
            grantedAt: c5OptionalString(body, "grantedAt", 80),
            effectiveFrom: c5OptionalString(body, "effectiveFrom", 80),
            effectiveTo: c5NullableString(body, "effectiveTo", 80),
            expiresAt: c5NullableString(body, "expiresAt", 80),
          });
          break;
        case "interaction_contract":
          result = manager.core.recordC5InteractionContract({
            ownerId,
            kind: c5Enum<InteractionContractKind>(body, "kind", [
              "owner_standing_instruction",
              "ashley_standing_boundary",
              "mutual_contract",
              "implicit_hypothesis",
            ]),
            lifecycleState: body.lifecycleState == null
              ? undefined
              : c5Enum<InteractionContractLifecycle>(body, "lifecycleState", [
                "recorded",
                "in_force",
                "withdrawn",
                "superseded",
                "proposed",
                "bilaterally_evidenced",
                "hypothesis",
              ]),
            classification: c5Classification(body),
            partySubjectScope: c5OptionalString(body, "partySubjectScope", 200),
            evidenceRefs: c5InteractionEvidenceRefs(body),
            effectiveFrom: c5OptionalString(body, "effectiveFrom", 80),
            effectiveTo: c5NullableString(body, "effectiveTo", 80),
            scope: c5NullableString(body, "scope", 500),
            audience: c5NullableString(body, "audience", 500),
            withdrawalRefs: c5OptionalArray(body, "withdrawalRefs"),
            correctionRefs: c5OptionalArray(body, "correctionRefs"),
            supersessionRefs: c5OptionalArray(body, "supersessionRefs"),
            identityEntryId: c5NullableInteger(body, "identityEntryId"),
            identityIntervalVersion: c5NullableString(body, "identityIntervalVersion", 200),
            proposalId: c5NullableString(body, "proposalId", 200),
            ownerConfirmationEvidenceRef: c5NullableString(body, "ownerConfirmationEvidenceRef", 300),
            ashleyConfirmationEvidenceRef: c5NullableString(body, "ashleyConfirmationEvidenceRef", 300),
            ashleyDecisionId: c5NullableInteger(body, "ashleyDecisionId"),
            deliveryReference: c5NullableString(body, "deliveryReference", 300),
            typedEvidence: c5Object(body, "typedEvidence"),
            uncertainty: body.uncertainty == null
              ? undefined
              : typeof body.uncertainty === "number" ? body.uncertainty : (() => {
                throw new AppError("message_required", "uncertainty must be a number", 400);
              })(),
            adaptationPolicy: c5NullableString(body, "adaptationPolicy", 500),
            text: c5NullableString(body, "text", 1000),
          });
          break;
        case "repair_proposal":
          result = manager.core.recordC5RepairProposal({
            ownerId,
            tensionId: c5NullableInteger(body, "tensionId"),
            proposalOrigin: c5Enum<RepairProposalOrigin>(body, "proposalOrigin", [
              "model",
              "worker",
              "deterministic_extractor",
              "owner",
            ]),
            proposalDecisionId: c5NullableInteger(body, "proposalDecisionId"),
            text: c5RequiredString(body, "text", 1000),
            evidenceRefs: c5Array(body, "evidenceRefs"),
            classification: c5Classification(body),
            partySubjectScope: c5OptionalString(body, "partySubjectScope", 200),
          });
          break;
        case "repair_evidence":
          result = manager.core.recordC5RepairEvidence({
            ownerId,
            proposalId: c5RequiredInteger(body, "proposalId"),
            evidenceRefs: c5Array(body, "evidenceRefs"),
            classification: c5Classification(body),
            partySubjectScope: c5OptionalString(body, "partySubjectScope", 200),
          });
          break;
        case "repair_adjudication":
          result = manager.core.recordC5RepairAdjudication({
            ownerId,
            proposalId: c5RequiredInteger(body, "proposalId"),
            disposition: c5Enum<RepairDisposition>(body, "disposition", [
              "repaired",
              "not_repaired",
              "unresolved",
              "withdrawn",
            ]),
            adjudicatingDecisionId: c5NullableInteger(body, "adjudicatingDecisionId"),
            hostValidationOk: true,
            classification: c5Classification(body),
            evidenceRefs: c5OptionalArray(body, "evidenceRefs"),
            partySubjectScope: c5OptionalString(body, "partySubjectScope", 200),
            deliveryReceiptId: c5NullableString(body, "deliveryReceiptId", 300),
            supersedesAdjudicationId: c5NullableInteger(body, "supersedesAdjudicationId"),
          });
          break;
        case "mutual_proposal":
          result = manager.core.recordC5MutualProposal({
            ownerId,
            text: c5RequiredString(body, "text", 600),
            sourceEntityType: c5RequiredString(body, "sourceEntityType", 200),
            sourceEntityUuid: c5RequiredString(body, "sourceEntityUuid", 200),
            classification: c5Classification(body),
          });
          break;
        case "mutual_doc_confirmation":
          manager.core.recordC5MutualDocConfirmation(
            ownerId,
            c5RequiredString(body, "entityUuid", 200),
            c5RequiredString(body, "evidenceRef", 300),
          );
          result = null;
          break;
        case "mutual_ashley_decision":
          manager.core.recordC5MutualAshleyDecision(
            ownerId,
            c5RequiredString(body, "entityUuid", 200),
            c5RequiredInteger(body, "decisionId"),
            c5OptionalString(body, "evidenceRef", 300),
          );
          result = null;
          break;
        case "mutual_delivery":
          manager.core.recordC5MutualDelivery(
            ownerId,
            c5RequiredString(body, "entityUuid", 200),
            c5RequiredString(body, "deliveryEntityUuid", 200),
            c5OptionalInteger(body, "decisionId"),
          );
          result = null;
          break;
        case "mutual_activate":
          result = manager.core.activateC5MutualCommitment(
            ownerId,
            c5RequiredString(body, "entityUuid", 200),
          );
          break;
        case "mutual_withdraw":
          manager.core.withdrawC5MutualCommitment(
            ownerId,
            c5RequiredString(body, "entityUuid", 200),
            c5Enum(body, "initiator", ["doc", "ashley"]),
            c5RequiredString(body, "evidenceRef", 300),
          );
          result = null;
          break;
      }
      res.json({ ok: true, operation, result });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/routing", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json({ nuclear: true, routes: manager.core.getRoutingStatus() });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/status", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      let life: string[] | undefined;
      try { life = renderLifeReceipt(lifeReceipt(getCognitiveSidecar(), Date.now())); } catch { life = undefined; }
      res.json({...manager.core.nuclearStatusSnapshot(ownerId),
        thalamus:thalamusStatus(cognitiveSidecar,ownerId,Date.now()), ...(life ? { life } : {})});
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/worker-queue", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const sidecar = getCognitiveSidecar();
      const nowMs = Date.now();
      const requestedLimit = Number(req.query.limit ?? 50);
      const limit = Number.isSafeInteger(requestedLimit)
        ? Math.max(1, Math.min(100, requestedLimit))
        : 50;
      const undertakings = listWorkerUndertakings(sidecar, { limit });
      const next = selectNextWorkerUndertaking(sidecar, nowMs);
      const cursor = getWorkerSchedulerCursor(sidecar);
      res.json({
        queue: {
          table: "worker_undertakings",
          maxActiveWorkers: MAX_ACTIVE_WORKERS,
          maxNonterminalUndertakings: MAX_NONTERMINAL_WORKER_UNDERTAKINGS,
          maxPendingCuriosity: MAX_PENDING_CURIOSITY,
          curiosityTtlMs: CURIOSITY_TTL_MS,
          states: ["queued", "dispatching", "running", "succeeded", "failed", "outcome_unknown", "cancelled", "superseded", "expired"],
          undertakings: undertakings.map((undertaking) => ({
            undertakingId: undertaking.undertakingId,
            semanticKind: undertaking.semanticKind,
            originKind: undertaking.originKind,
            originRef: undertaking.originRef,
            ownerId: undertaking.ownerId,
            conversationId: undertaking.conversationId,
            queuedAgeMs: Math.max(0, nowMs - undertaking.queuedAtMs),
            state: undertaking.state,
            blockedReason: undertaking.blockedReason,
            selectedOperationId: undertaking.selectedOperationId,
            acknowledgement: undertaking.acknowledgementRef
              ? { authorized: true, ref: undertaking.acknowledgementRef }
              : { authorized: false, ref: null },
            cancelRequestedAtMs: undertaking.cancelRequestedAtMs,
            supersededBy: undertaking.supersededBy,
            terminalReason: undertaking.terminalReason,
            terminalAtMs: undertaking.terminalAtMs,
            capacity: undertaking.blockedReason === "capacity"
              ? {
                taskClass: undertaking.semanticKind,
                availabilityReason: undertaking.terminalReason ?? "capacity_unavailable",
                nextProbeAtMs: undertaking.capacityNextProbeAtMs,
              }
              : null,
          })),
        },
        fairness: {
          calendar: WORKER_SERVICE_CALENDAR,
          cursor,
          nextSelection: next
            ? {
              undertakingId: next.undertaking.undertakingId,
              selectedClass: next.selectedClass,
              calendarIndex: next.calendarIndex,
              skippedEmptyClasses: next.skippedEmptyClasses,
            }
            : null,
        },
        executionSlot: getWorkerExecutionSlot(sidecar),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/jobs", gone);
  app.post("/nuclear/jobs/cancel", gone);
  app.get("/nuclear/engineering", gone);
  app.get("/nuclear/context-budget", gone);

  app.get("/nuclear/learned-autonomy", (req, res) => {
    try { requireOwner(String(req.query.owner_id ?? "") || undefined); gone(req, res); }
    catch (err) { const { status, body } = toErrorResponse(err); res.status(status).json(body); }
  });

  app.get("/nuclear/cognitive-graduation", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(getCognitiveGraduationDiagnostics(getCognitiveSidecar()));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/memory/corrections", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const db = manager.core.getDatabase();
      res.json({
        currentnessAuthority: getMemoryContractState(db)?.currentnessAuthority ?? "UNKNOWN",
        correctionSeq: correctionHighWater(db),
        corrections: correctionDiagnostics(db, ownerId),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/memory/corrections", (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ownerId = requireOwner(
        typeof body.userId === "string" ? body.userId : undefined,
      );
      const sourceMessageId = Number(body.sourceMessageId);
      const correctionOrdinal = Number(body.correctionOrdinal);
      const scopeText = typeof body.scopeText === "string" ? body.scopeText : "";
      if (!Number.isInteger(sourceMessageId) || !Number.isInteger(correctionOrdinal) || !scopeText.trim()) {
        throw new AppError("message_required", "sourceMessageId, correctionOrdinal, and scopeText are required", 400);
      }
      const admissionPath = String(body.admissionPath ?? "typed_control") as AdmissionPath;
      const correctionClass = body.class == null ? undefined : String(body.class) as CorrectionClass;
      const rawTargets = body.targets == null ? [] : body.targets;
      if (!Array.isArray(rawTargets)) {
        throw new AppError("message_required", "targets must be an array", 400);
      }
      const targets = rawTargets.map((raw) => {
        if (typeof raw !== "object" || raw === null) {
          throw new AppError("message_required", "invalid correction target", 400);
        }
        const target = raw as Record<string, unknown>;
        return {
          assertionId: Number(target.assertionId),
          inclusionReason: String(target.inclusionReason) as InclusionReason,
          resolutionBasis: String(target.resolutionBasis) as ResolutionBasis,
        };
      });
      const requestedMode = body.capabilityMode == null
        ? "observe"
        : String(body.capabilityMode);
      if (requestedMode !== "observe" && requestedMode !== "apply") {
        throw new AppError("message_required", "capabilityMode must be observe or apply", 400);
      }
      const db = manager.core.getDatabase();
      const capabilityMode = requestedMode === "apply" &&
        capabilityCanInfluence(db, "memory_evidence", "apply")
        ? "apply"
        : "observe";
      const admitted = admitOwnerCorrection(db, {
        ownerId,
        sourceMessageId,
        correctionOrdinal,
        admissionPath,
        class: correctionClass,
        scopeText,
        proposal: body.proposal,
        targets,
        capabilityMode,
      });
      const fanout = capabilityMode === "apply" &&
        admitted.correction.lifecycleStatus === "applying"
        ? fanoutCorrection(db, admitted.correction.id)
        : null;
      res.json({
        requestedMode,
        capabilityMode,
        admitted,
        fanout,
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/evaluation", (req, res) => {
    try {
      const { userId, capability, seeds, passed, sourceKey } = req.body as {
        userId?: string;
        capability?: string;
        seeds?: number;
        passed?: boolean;
        sourceKey?: string;
      };
      requireOwner(userId);
      if (capability === "memory_evidence") {
        res.status(400).json({
          ok: false,
          reason: "memory_evidence_requires_bound_evaluation",
        });
        return;
      }
      if (
        typeof capability !== "string" ||
        typeof seeds !== "number" ||
        typeof passed !== "boolean" ||
        typeof sourceKey !== "string" ||
        !sourceKey.trim()
      ) {
        throw new AppError("message_required", "evaluation fields required", 400);
      }
      res.json(manager.core.recordCapabilityEvaluation({
        capability,
        seeds,
        passed,
        sourceKey,
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/promote", (req, res) => {
    try {
      const { userId, capability, activationPath } = req.body as {
        userId?: string;
        capability?: string;
        activationPath?: string;
      };
      const ownerId = requireOwner(userId);
      if (typeof capability !== "string" || !capability.trim()) {
        throw new AppError("message_required", "capability required", 400);
      }
      if (
        activationPath !== undefined &&
        activationPath !== "maturation" &&
        activationPath !== "owner_bootstrap"
      ) {
        throw new AppError(
          "message_required",
          "activationPath must be maturation or owner_bootstrap",
          400,
        );
      }
      res.json(manager.core.promoteCapability({
        capability,
        authorizedBy: ownerId,
        activationPath: activationPath as "maturation" | "owner_bootstrap" | undefined,
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/rollback", (req, res) => {
    try {
      const { userId, capability } = req.body as {
        userId?: string;
        capability?: string;
      };
      const ownerId = requireOwner(userId);
      if (typeof capability !== "string" || !capability.trim()) {
        throw new AppError("message_required", "capability required", 400);
      }
      res.json(manager.core.operatorRollbackCapability({
        capability,
        authorizedBy: ownerId,
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/recall/cutover", (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      const ownerId = requireOwner(userId);
      res.json(manager.core.recordRecallCutover(ownerId, { authorizedBy: ownerId }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/recall/qualification-epoch/start", (req, res) => {
    try {
      const { userId, startRequestKey, expectedCurrentEpochId } = req.body as {
        userId?: string;
        startRequestKey?: string;
        expectedCurrentEpochId?: string | null;
      };
      const ownerId = requireOwner(userId);
      res.json(manager.core.startRecallQualificationEpoch({
        authorizedBy: ownerId,
        startRequestKey: startRequestKey ?? "",
        expectedCurrentEpochId: expectedCurrentEpochId ?? null,
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/capabilities/recall/qualification-epochs", (req, res) => {
    try {
      const { userId } = req.query as { userId?: string };
      requireOwner(userId);
      res.json(manager.core.listRecallQualificationEpochs());
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/memory-evidence/qualification-epoch/start", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(
        typeof body.userId === "string" ? body.userId : undefined,
      );
      res.json(manager.core.startMemoryEvidenceQualificationEpoch({
        ownerId,
        startRequestKey: c1RequiredString(body, "startRequestKey"),
        predecessorEpochId: c1RequiredNullableString(body, "predecessorEpochId"),
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/capabilities/memory-evidence/qualification-epochs", (req, res) => {
    try {
      const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      const ownerId = requireOwner(userId);
      res.json(manager.core.listMemoryEvidenceQualificationEpochs(ownerId));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/memory-evidence/evaluation", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(
        typeof body.userId === "string" ? body.userId : undefined,
      );
      const definitionId = c1RequiredString(body, "definitionId", 100);
      const definitionVersion = body.definitionVersion;
      if (definitionId !== C1_EVALUATION_DEFINITION_ID ||
          definitionVersion !== C1_EVALUATION_DEFINITION_VERSION) {
        throw new AppError("message_required", "invalid C1 evaluation definition", 400);
      }
      res.json(manager.core.recordMemoryEvidenceEvaluation({
        ownerId,
        sourceKey: c1RequiredString(body, "sourceKey"),
        definitionId,
        definitionVersion,
        definitionHash: c1RequiredString(body, "definitionHash", 128),
        seeds: c1EvaluationSeeds(body),
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/capabilities/memory-evidence/readiness", (req, res) => {
    try {
      const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      const ownerId = requireOwner(userId);
      const current = manager.core.listMemoryEvidenceQualificationEpochs(ownerId).current;
      const quiescence = trustedC1Quiescence(manager, ownerId);
      res.json(manager.core.getMemoryEvidenceCutoverReadiness({
        ownerId,
        epochId: current?.epochId ?? "",
        masterMode: env.cognitionMode,
        activationPath: c1ActivationPath(req.query.activationPath),
        ...quiescence,
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/capabilities/memory-evidence/cutover", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(
        typeof body.userId === "string" ? body.userId : undefined,
      );
      const quiescence = trustedC1Quiescence(manager, ownerId);
      res.json(manager.core.executeMemoryEvidenceCutover({
        ownerId,
        epochId: c1RequiredString(body, "epochId"),
        masterMode: env.cognitionMode,
        activationPath: c1ActivationPath(body.activationPath),
        ...quiescence,
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/external/actions", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const limit = Math.min(100, Number(req.query.limit ?? 50) || 50);
      res.json(manager.core.getExternalActions(ownerId, limit));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/external/actions/:entityUuid", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const entityUuid = String(req.params.entityUuid ?? "");
      const detail = manager.core.getExternalAction(ownerId, entityUuid);
      if (!detail) {
        throw new AppError("not_found", "external action not found", 404);
      }
      res.json(detail);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/nuclear/external/accounts", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(manager.core.getExternalAccounts(ownerId));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/external/actions/:entityUuid/cancel", (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      const ownerId = requireOwner(userId);
      const entityUuid = String(req.params.entityUuid ?? "");
      res.json(manager.core.cancelExternalAction(ownerId, entityUuid));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/external/actions/:entityUuid/reconcile", (req, res) => {
    try {
      const { userId, outcome } = req.body as {
        userId?: string;
        outcome?: "committed" | "partially_delivered" | "aborted" | "outcome_unknown";
      };
      const ownerId = requireOwner(userId);
      const entityUuid = String(req.params.entityUuid ?? "");
      if (
        !outcome ||
        !["committed", "partially_delivered", "aborted", "outcome_unknown"].includes(outcome)
      ) {
        throw new AppError("message_required", "reconcile outcome required", 400);
      }
      res.json(manager.core.reconcileExternalAction(ownerId, entityUuid, outcome));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/external/credentials/:credentialRef/revoke", (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      const ownerId = requireOwner(userId);
      const credentialRef = String(req.params.credentialRef ?? "");
      res.json(manager.core.revokeExternalCredential(ownerId, credentialRef));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/nuclear/external/emergency-stop", (req, res) => {
    try {
      const { userId, active } = req.body as { userId?: string; active?: boolean };
      const ownerId = requireOwner(userId);
      if (typeof active !== "boolean") {
        throw new AppError("message_required", "active boolean required", 400);
      }
      res.json(manager.core.setExternalEmergencyStop(ownerId, active));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/sandbox/approve", gone);
  app.post("/sandbox/tombstone/sign", gone);
  app.get("/sandbox/approvals", gone);
  app.get("/sandbox/approvals/:proposalId", gone);
  app.post("/sandbox/approvals", gone);
  app.post("/sandbox/approvals/:proposalId/approve", gone);
  app.post("/sandbox/approvals/:proposalId/reject", gone);
  app.post("/sandbox/approvals/:proposalId/withdraw", gone);
  app.post("/sandbox/approvals/:proposalId/resume", gone);

  app.get("/sessions", (_req, res) => {
    res.json({ activeSessionId: null });
  });

  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const client = {
      write: (data: object) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      },
    };
    manager.addSseClient(client);
    req.on("close", () => manager.removeSseClient(client));
  });

  app.post("/session/start", (_req, res) => {
    res.json({ sessionId: manager.startSession() });
  });

  app.post("/chat", gone);

  app.post(
    "/chat/ingress",
    (req, res, next) => {
      try {
        requireReady();
        createCognitiveIngressHandler({
          sidecar: getCognitiveSidecar(),
          nuclearDb: manager.core.getDatabase(),
          authorizeOwner: (userId) => { requireOwner(userId); },
          maxMessageLength: MAX_DISCORD_MESSAGE,
        })(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  app.post(
    "/chat/ingress-external/capture",
    (req, res, next) => {
      try {
        requireReady();
        requireBotService(req);
        createExternalCaptureHandler({
          sidecar: getCognitiveSidecar(),
          nuclearDb: manager.core.getDatabase(),
          authorizeBotService: () => undefined,
          enabled: isExternalSocialCaptureEnabled,
          projectSystemNotice: options.projectSystemNotice,
        })(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  // B1: the bot pulls her due posts in her other places and reports what became of them.
  app.post("/places/posts/sync", (req, res) => {
    try {
      requireReady();
      requireBotService(req);
      const reports = parsePlaceSyncReports(req.body);
      const result = syncPlacePosts(getCognitiveSidecar(), manager.core.getDatabase(), { reports, nowMs: Date.now() });
      res.status(200).json({ status: "ok", applied: result.applied, posts: result.posts });
    } catch (err) {
      const { status, body } = toErrorResponse(err instanceof Error && err.message === "place_sync_invalid"
        ? new AppError("bad_request", "invalid place sync", 400) : err);
      res.status(status).json(body);
    }
  });

  /** G1: the Owner's view of her places and the switch for each (/places). */
  app.get("/places", (_req, res) => {
    try {
      requireReady();
      res.json({ ok: true, ...ownerPlacesView(getCognitiveSidecar(), manager.core.getDatabase(), Date.now()) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/places/switch", (req, res) => {
    try {
      requireReady();
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const place = c1RequiredString(body, "place", 300);
      if (body.state !== "closed" && body.state !== "open") throw new AppError("message_required", "state must be closed or open", 400);
      const result = ownerSwitchPlace(getCognitiveSidecar(), manager.core.getDatabase(), { place, state: body.state, nowMs: Date.now() });
      if (!result.ok) throw new AppError("not_found", "not one of her places", 404);
      res.json({ ok: true, place: result.place, state: body.state });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  const ownerTransportHttpOptions = () => ({
    sidecar: getCognitiveSidecar(),
    nuclearDb: manager.core.getDatabase(),
    authorizeOwner: (userId: string) => { requireOwner(userId); },
    authorizeBotService: (req: express.Request) => { requireBotService(req); },
  });

  app.post(
    "/chat/owner-transport/capture",
    (req, res, next) => {
      try {
        requireReady();
        createOwnerTransportCaptureHandler(ownerTransportHttpOptions())(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  app.get(
    "/chat/owner-transport/state",
    (req, res, next) => {
      try {
        requireReady();
        createOwnerTransportStateHandler(ownerTransportHttpOptions())(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  app.post(
    "/chat/owner-transport/history-page",
    (req, res, next) => {
      try {
        requireReady();
        createOwnerTransportHistoryPageHandler(ownerTransportHttpOptions())(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  app.get(
    "/chat/owner-transport/pending",
    (req, res, next) => {
      try {
        requireReady();
        createOwnerTransportPendingHandler(ownerTransportHttpOptions())(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  app.post(
    "/chat/owner-transport/admitted",
    (req, res, next) => {
      try {
        requireReady();
        createOwnerTransportMarkAdmittedHandler(ownerTransportHttpOptions())(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  app.post(
    "/chat/ingress-external",
    (req, res, next) => {
      try {
        requireReady();
        requireBotService(req);
        createExternalBatchHandler({
          sidecar: getCognitiveSidecar(),
          nuclearDb: manager.core.getDatabase(),
          authorizeBotService: () => undefined,
          enabled: isExternalSocialCaptureEnabled,
          ownerId: env.memoryOwnerId || env.discordOwnerId || "default",
          projectSystemNotice: options.projectSystemNotice,
        })(req, res, next);
      } catch (err) {
        const { status, body } = toErrorResponse(err);
        res.status(status).json(body);
      }
    },
  );

  app.get("/social/eligibility", (req, res) => {
    try {
      requireBotService(req);
      const authorId = typeof req.query.author === "string"
        ? req.query.author.trim()
        : "";
      const channelId = typeof req.query.channel === "string"
        ? req.query.channel.trim()
        : "";
      const guildId = typeof req.query.guild === "string"
        ? req.query.guild.trim()
        : "";
      const externalBot = req.query.bot === "true" || req.query.bot === "1";
      if (!authorId || !channelId) {
        throw new AppError(
          "message_required",
          "author and channel are required",
          400,
        );
      }
      const location = guildId ? "room" : "dm";
      const eligibility = classifyEligibility(
        readEligibilityBundle(manager.core.getDatabase(), {
          principalId: authorId,
          guildId: guildId || undefined,
          channelId,
        }),
        location,
        {
          roomSeedActive: !guildId || isRoomSeedActive(),
          externalBot,
          botDmPrincipal: configuredBotDmPrincipal(),
        },
      );
      res.json(eligibility);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/chat/text", gone);

  app.get("/delivery/pending", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      const lane = typeof req.query.lane === "string" ? req.query.lane : undefined;
      const owner = requireOwner(ownerId || undefined);
      res.json({
        deliveries: manager.core.getPendingDeliveries(owner, { lane }),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/delivery/claim", (req, res) => {
    try {
      requireReady();
      const owner = requireOwner((req.body as { userId?: string }).userId);
      const { lane } = (req.body ?? {}) as {
        lane?: string;
      };
      const claimed = manager.core.claimPendingDeliveries(owner, {
        lane,
      });
      if (lane === "cognitive_v021" || lane === "system_notice" || lane === "social_notify") {
        const sidecar = getCognitiveSidecar();
        for (const delivery of claimed) {
          markProjectedDeliverySending(
            sidecar,
            manager.core.getDatabase(),
            delivery.reservationId,
          );
        }
      }
      res.json({ deliveries: claimed });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/delivery/:id", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      const owner = requireOwner(ownerId || undefined);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      const status = manager.core.getDeliveryStatus(owner, id);
      if (!status) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      res.json(status);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/delivery/:id/dispatch-started", (req, res) => {
    try {
      const owner = requireOwner(
        (req.body as { userId?: string }).userId,
      );
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      const status = manager.core.getDeliveryStatus(owner, id);
      if (!status) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      // Durable dispatch-boundary truth: succeeds at most once, only while
      // sending. A failure here must abort dispatch (fail closed, still
      // provably pre-dispatch); a success followed by a receiptless throw is
      // ambiguous post-dispatch and must never replay.
      const marked = markDeliveryDispatchStarted(manager.core.getDatabase(), id, Date.now());
      res.json({ ok: true, marked });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/delivery/:id/receipt", (req, res) => {
    try {
      const owner = requireOwner(
        (req.body as { userId?: string }).userId,
      );
      const id = Number(req.params.id);
      const { ordinal, discordMessageId } = req.body as {
        ordinal?: number;
        discordMessageId?: string;
      };
      if (
        !Number.isFinite(id) ||
        typeof ordinal !== "number" ||
        !discordMessageId?.trim()
      ) {
        throw new AppError("message_required", "ordinal and discordMessageId required", 400);
      }
      manager.core.receiptDeliveryBubble(
        owner,
        id,
        ordinal,
        discordMessageId.trim(),
      );
      res.json({ ok: true });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/delivery/:id/recheck-external", (req, res) => {
    try {
      const owner = requireOwner(
        (req.body as { userId?: string }).userId,
      );
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      const status = manager.core.getDeliveryStatus(owner, id);
      if (!status) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      res.json(recheckExternalPublicationReservation(manager.core.getDatabase(), id, Date.now(), {
        cognitiveSidecar: getCognitiveSidecar(),
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/delivery/:id/recheck-owner-room", (req, res) => {
    try {
      const owner = requireOwner(
        (req.body as { userId?: string }).userId,
      );
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      const status = manager.core.getDeliveryStatus(owner, id);
      if (!status) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      // Routed by typed projection identity inside publish.ts: system:<id>
      // selects the system-notice recheck, speech keys keep the existing
      // Owner-DM-speech vs Owner-room routing. Both surfaces can target the
      // Owner, so the destination shape alone must not select the recheck.
      res.json(recheckOwnerPublicationReservation(manager.core.getDatabase(), id, Date.now(), {
        cognitiveSidecar: getCognitiveSidecar(),
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/delivery/:id/auxiliary", (req, res) => {
    try {
      const owner = requireOwner(
        (req.body as { userId?: string }).userId,
      );
      const id = Number(req.params.id);
      const { kind, text, discordMessageId } = req.body as {
        kind?: "progress" | "delivery_error";
        text?: string;
        discordMessageId?: string;
      };
      if (
        !Number.isFinite(id) ||
        (kind !== "progress" && kind !== "delivery_error") ||
        !text?.trim() ||
        !discordMessageId?.trim()
      ) {
        throw new AppError("message_required", "kind, text, discordMessageId required", 400);
      }
      manager.core.receiptDeliveryAuxiliary(owner, id, {
        kind,
        text: text.trim(),
        discordMessageId: discordMessageId.trim(),
      });
      res.json({ ok: true });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/delivery/:id/finalize", (req, res) => {
    try {
      const owner = requireOwner(
        (req.body as { userId?: string }).userId,
      );
      const id = Number(req.params.id);
      const { cause, auditSessionId } = req.body as {
        cause?:
          | "complete"
          | "cancel"
          | "send_failure"
          | "first_bubble_deadline"
          | "delivery_lease";
        auditSessionId?: string;
      };
      if (!Number.isFinite(id)) {
        throw new AppError("not_found", "reservation not found", 404);
      }
      const result = manager.finalizeDeliveryReservation(
        owner,
        id,
        cause ?? "complete",
        (text) => {
          if (!auditSessionId) return;
          manager.logger.append({
            ts: new Date().toISOString(),
            role: "assistant",
            text,
            source: "nuclear",
            session_id: auditSessionId,
            model: "delivery",
          });
        },
      );
      res.json(result);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/chat/preflight", (req, res) => {
    try {
      const { message } = req.body as { message?: string };
      const text = message?.trim() ?? "";
      if (!text) throw new AppError("message_required", "message required", 400);
      res.json({ lookup: manager.core.lookupPreflight(text) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  // UX W2: the bot renders her soft acts in the Owner's DM and reports each outcome.
  app.post("/soft/claim", (req, res) => {
    try {
      requireReady();
      requireOwner((req.body as { userId?: string }).userId);
      res.json({ acts: claimSoftActs(getCognitiveSidecar(), Date.now()) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/soft/:id/result", (req, res) => {
    try {
      const { userId, status, reason } = req.body as { userId?: string; status?: string; reason?: string };
      requireOwner(userId);
      const actId = Number(req.params.id);
      if (!Number.isSafeInteger(actId) || actId <= 0) throw new AppError("not_found", "soft act not found", 404);
      if (status !== "done" && status !== "refused" && status !== "failed") {
        throw new AppError("bad_request", "status must be done, refused or failed", 400);
      }
      const recorded = reportSoftAct(getCognitiveSidecar(), {
        actId,
        status,
        ...(typeof reason === "string" ? { reason } : {}),
        nowMs: Date.now(),
      });
      res.json({ recorded });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/signals/reaction", (req, res) => {
    try {
      const { userId, messageId, emoji } = req.body as {
        userId?: string;
        messageId?: string;
        emoji?: string;
      };
      const owner = requireOwner(userId);
      if (!messageId?.trim() || !emoji?.trim()) {
        throw new AppError("message_required", "messageId and emoji required", 400);
      }
      res.json(
        manager.core.recordReaction(owner, {
          messageId: messageId.trim(),
          emoji: emoji.trim(),
        }),
      );
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/signals/gif-feedback", (req, res) => {
    try {
      const { userId, query, success } = req.body as {
        userId?: string;
        query?: string;
        success?: boolean;
      };
      const owner = requireOwner(userId);
      manager.core.recordGifFeedback(owner, {
        query: (query ?? "").trim().slice(0, 200),
        success: success === true,
      });
      res.json({ ok: true });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/signals/gif-queries", (req, res) => {
    try {
      const ownerId =
        typeof req.query.owner_id === "string"
          ? req.query.owner_id
          : env.discordOwnerId;
      requireOwner(ownerId || undefined);
      res.json({
        queries: manager.core.listSuccessfulGifQueries(ownerId!),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/signals/emoji-weight", (req, res) => {
    try {
      const { userId, emoji, context, positive } = req.body as {
        userId?: string;
        emoji?: string;
        context?: string;
        positive?: boolean;
      };
      const owner = requireOwner(userId);
      if (!emoji?.trim() || !context?.trim()) {
        throw new AppError("message_required", "emoji and context required", 400);
      }
      const weight = manager.core.recordEmojiWeight(
        owner,
        emoji.trim().slice(0, 32),
        context.trim().slice(0, 64),
        positive === true,
      );
      res.json({ ok: true, weight });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/memory/pin", (req, res) => {
    try {
      const { userId, text, sensitivity, discordMessageId } = req.body as {
        userId?: string;
        text?: string;
        sensitivity?: "none" | "private";
        discordMessageId?: string;
      };
      const owner = requireOwner(userId);
      if (!text?.trim()) {
        throw new AppError("message_required", "text required", 400);
      }
      res.status(202).json(
        admitV021RememberCommand(
          getCognitiveSidecar(),
          manager.core.getDatabase(),
          {
            ownerId: owner,
            text: text.trim(),
            sensitivity: sensitivity ?? "none",
            discordMessageId: discordMessageId?.trim() || null,
          },
        ),
      );
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/memory/summary", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(
        getV021MemorySummary(
          getCognitiveSidecar(),
          manager.core.getDatabase(),
          ownerId,
          req.query.include_private === "true",
        ),
      );
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  // Growth V1 G4: foundational revisions (values, boundaries) wait on the
  // Owner here; /identity reads and decides them. Diagnostics never authorize:
  // a decision applies only when Ashley has affirmed the same wording.
  app.get("/growth/identity/reviews", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      const limit = Math.min(100, Number(req.query.limit ?? 50) || 50);
      res.json({ reviews: listFoundationalReviews(getCognitiveSidecar(), limit) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/domus/status", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      const decision = decideDomusIngress({
        helperToken: env.domusHelperToken,
        botToken: process.env.DISCORD_BOT_TOKEN ?? "",
      });
      const listener = decision.enabled
        ? { enabled: true, port: env.domusIngressPort }
        : { enabled: false, port: env.domusIngressPort, reason: decision.reason };
      res.json({ listener, ...readDomusStatus(getCognitiveSidecar()) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/domus/diary", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      const parsed = Number(req.query.limit ?? 7);
      const limit = Number.isInteger(parsed) && parsed >= 1 && parsed <= 14 ? parsed : 7;
      res.json({ entries: listDomusDiary(getCognitiveSidecar(), limit) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/growth/dimensions", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      res.json(listGrowthDimensions(getCognitiveSidecar()));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });
  app.post("/growth/dimensions/seed", (req, res) => {
    try {
      requireOwner(req.body?.userId);
      const name = req.body?.name;
      const question = req.body?.question;
      if (typeof name !== "string" || name.trim() === "" || typeof question !== "string" || question.trim() === "") {
        throw new AppError("message_required", "name and question are required", 400);
      }
      res.json({ dimension: seedGrowthDimension(getCognitiveSidecar(), { name, question, nowMs: Date.now() }) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });
  app.post("/growth/dimensions/revert", (req, res) => {
    try {
      requireOwner(req.body?.userId);
      const dimensionId = req.body?.dimensionId;
      if (typeof dimensionId !== "string" || dimensionId.trim() === "") throw new AppError("message_required", "dimensionId is required", 400);
      res.json(revertAshleyDimensionEdit(getCognitiveSidecar(), { dimensionId, nowMs: Date.now() }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/growth/practices", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      res.json({ practices: listCurrentPractices(getCognitiveSidecar()).map(revision => ({ revisionId: revision.revisionId, text: revision.proposedText, heldSinceMs: revision.appliedAtMs ?? revision.updatedAtMs })) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/growth/self-change/ladder", (req,res)=>{
    try { requireOwner(String(req.query.owner_id ?? "") || undefined);res.json(readSelfChangeLadder(getCognitiveSidecar())); }
    catch(err){const {status,body}=toErrorResponse(err);res.status(status).json(body);}
  });
  app.post("/growth/self-change/ladder", (req,res)=>{
    try {
      const actor=requireOwner(req.body.userId);
      const {level,expectedRevision,commandId}=req.body;
      if(typeof level!=="number" || typeof expectedRevision!=="number" || typeof commandId!=="string")throw new AppError("message_required","Valid ladder command required",400);
      res.json(commandSelfChangeLadder(getCognitiveSidecar(),{level,expectedRevision,commandId,actor,nowMs:Date.now()}));
    }catch(err){
      if(err instanceof Error && err.message.startsWith("self_change_ladder_"))err=new AppError("message_required",err.message,err.message.includes("conflict")?409:400);
      const {status,body}=toErrorResponse(err);res.status(status).json(body);
    }
  });
  app.post("/growth/self-change/ladder/finding", (req,res)=>{
    try {
      const actor=requireOwner(req.body.userId);
      const {eventId,kind,reference}=req.body;
      if(typeof eventId!=="string" || typeof reference!=="string" || !["BLOCKING","revert"].includes(kind))throw new AppError("message_required","Attributable finding required",400);
      res.json(recordSelfChangeLadderFinding(getCognitiveSidecar(),{eventId,kind,reference,actor,nowMs:Date.now()}));
    }catch(err){
      if(err instanceof Error && err.message.startsWith("self_change_ladder_"))err=new AppError("message_required",err.message,err.message.includes("conflict")?409:400);
      const {status,body}=toErrorResponse(err);res.status(status).json(body);
    }
  });

  app.get("/growth/graduation", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      res.json(getCognitiveGraduationDiagnostics(getCognitiveSidecar()));
    } catch (err) {
      const { status, body } = toErrorResponse(err); res.status(status).json(body);
    }
  });
  app.post("/growth/graduation/mode", (req, res) => {
    try {
      const actor = requireOwner(req.body.userId);
      const selectedMode = req.body.mode;
      if (!["observe", "dark_apply", "apply"].includes(selectedMode)) throw new AppError("message_required", "Valid graduation mode required", 400);
      const sidecar = getCognitiveSidecar();
      setGraduationMode(sidecar, selectedMode, actor, Date.now());
      res.json(getCognitiveGraduationDiagnostics(sidecar));
    } catch (err) {
      const { status, body } = toErrorResponse(err); res.status(status).json(body);
    }
  });
  app.post("/growth/influences/mode", (req, res) => {
    try {
      const actor = requireOwner(req.body.userId);
      const selectedMode = req.body.mode;
      if (!["observe", "dark_apply", "apply"].includes(selectedMode)) throw new AppError("message_required", "Valid influence mode required", 400);
      const atMs = Date.now();
      setInfluenceMode(getCognitiveSidecar(), selectedMode, actor, atMs);
      res.json({ mode: selectedMode, actor, atMs });
    } catch (err) {
      const { status, body } = toErrorResponse(err); res.status(status).json(body);
    }
  });
  app.post("/growth/calibration/rollback", (req, res) => {
    try {
      requireOwner(req.body.userId);
      res.json({ rolledBack: rollbackCognitiveGraduation(getCognitiveSidecar()) });
    } catch (err) {
      const { status, body } = toErrorResponse(err); res.status(status).json(body);
    }
  });
  app.post("/growth/graduation/adjudicate", (req, res) => {
    try {
      requireOwner(req.body.userId);
      const { expectationId, observationId, disposition, adjudicatingCycleId, supersedesAdjudicationId, correctionClass } = req.body;
      if (typeof expectationId !== "string" || typeof observationId !== "string" || typeof adjudicatingCycleId !== "string" || !DISPOSITIONS.includes(disposition)
        || (supersedesAdjudicationId !== undefined && typeof supersedesAdjudicationId !== "string") || (correctionClass !== undefined && !CORRECTION_CLASSES.includes(correctionClass))) {
        throw new AppError("message_required", "Valid explicit adjudication fields required", 400);
      }
      const sidecar = getCognitiveSidecar();
      const prior = latestAdjudication(sidecar, expectationId);
      const supersedes = supersedesAdjudicationId ?? prior?.adjudicationId;
      const input: AdjudicationInput = { expectationId, observationId, disposition, adjudicatingCycleId, proposalOrigin: "owner", hostValidationOk: true,
        adjudicationAuthority: "owner_confirmed", ...(supersedes ? { supersedesAdjudicationId: supersedes, correctionClass: correctionClass ?? "TEMPORAL_SUPERSESSION" } : {}), nowMs: Date.now() };
      res.json(recordAdjudication(sidecar, input));
    } catch (err) {
      const { status, body } = toErrorResponse(err); res.status(status).json(body);
    }
  });

  /** A8: weekly snapshots of who Ashley is, and what changed between them. */
  app.get("/growth/snapshots", (req, res) => {
    try {
      requireOwner(String(req.query.owner_id ?? "") || undefined);
      const snapshots = listPersonaSnapshots(getCognitiveSidecar());
      res.json({ snapshots, changes: personaChanges(snapshots) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/growth/identity/reviews/doc", (req, res) => {
    try {
      const { userId, reviewId, decision, rationale } = req.body as {
        userId?: string;
        reviewId?: number;
        decision?: "approve" | "reject" | "defer";
        rationale?: string;
      };
      requireOwner(userId);
      if (!Number.isSafeInteger(reviewId) || !decision || !["approve", "reject", "defer"].includes(decision)) {
        throw new AppError("message_required", "Owner review fields required", 400);
      }
      const sidecar = getCognitiveSidecar();
      const nowMs = Date.now();
      const recorded = recordOwnerRevisionDecision(sidecar, {
        revisionId: reviewId as number,
        decision,
        ...(typeof rationale === "string" ? { rationale } : {}),
        nowMs,
      });
      const identityStore = { nuclear: manager.core.getDatabase(), ownerId: nuclearIdentityOwnerId() };
      const applied = recorded ? evaluateRevisions(sidecar, identityStore, nowMs).applied.includes(reviewId as number) : false;
      res.json({ recorded, applied, reviews: listFoundationalReviews(sidecar) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/growth/revisions/revert", (req, res) => {
    try {
      const { userId, revisionId } = req.body as { userId?: string; revisionId?: number };
      requireOwner(userId);
      if (!Number.isSafeInteger(revisionId)) {
        throw new AppError("message_required", "revisionId required", 400);
      }
      const identityStore = { nuclear: manager.core.getDatabase(), ownerId: nuclearIdentityOwnerId() };
      res.json({ reverted: revertRevision(getCognitiveSidecar(), identityStore, revisionId as number, Date.now()) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/memory/newthread", (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      const owner = requireOwner(userId);
      res.json({ threadId: manager.core.newThread(owner) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/memory/forget", (req, res) => {
    try {
      const {
        userId,
        topic,
        confirmed,
        previewId,
        confirmationDiscordMessageId,
        cancel,
      } = req.body as {
        userId?: string;
        topic?: string;
        confirmed?: boolean;
        previewId?: string;
        confirmationDiscordMessageId?: string;
        cancel?: boolean;
      };
      const owner = requireOwner(userId);
      if (cancel === true) {
        if (!previewId?.trim()) {
          throw new AppError("message_required", "previewId required", 400);
        }
        res.json(cancelV021Forget(cognitiveContinuity(), {
          ownerId: owner,
          previewId: previewId.trim(),
        }));
        return;
      }
      if (confirmed === true && previewId?.trim()) {
        res.json(confirmV021Forget(
          getCognitiveSidecar(),
          manager.core.getDatabase(),
          cognitiveContinuity(),
          {
            ownerId: owner,
            previewId: previewId.trim(),
            identityOwnerId: nuclearIdentityOwnerId(),
          },
        ));
        return;
      }
      if (confirmed === true) {
        throw new AppError(
          "message_required",
          "previewId required for confirmation",
          400,
        );
      }
      if (!topic?.trim() && !previewId?.trim()) {
        throw new AppError("message_required", "topic required", 400);
      }
      res.json(previewV021Forget(
        getCognitiveSidecar(),
        manager.core.getDatabase(),
        cognitiveContinuity(),
        { ownerId: owner, topic: topic!.trim() },
      ));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/memory/forget/bind", (req, res) => {
    try {
      const { userId, previewId, confirmationDiscordMessageId } = req.body as {
        userId?: string;
        previewId?: string;
        confirmationDiscordMessageId?: string;
      };
      const owner = requireOwner(userId);
      if (!previewId?.trim() || !confirmationDiscordMessageId?.trim()) {
        throw new AppError(
          "message_required",
          "previewId and confirmationDiscordMessageId required",
          400,
        );
      }
      manager.core.bindForgetConfirmation(
        owner,
        previewId.trim(),
        confirmationDiscordMessageId.trim(),
      );
      res.json({ ok: true });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/memory/forget/resolve", (req, res) => {
    try {
      const { userId, confirmationDiscordMessageId } = req.body as {
        userId?: string;
        confirmationDiscordMessageId?: string;
      };
      const owner = requireOwner(userId);
      if (!confirmationDiscordMessageId?.trim()) {
        throw new AppError(
          "message_required",
          "confirmationDiscordMessageId required",
          400,
        );
      }
      const previewId = manager.core.resolveForgetPreviewByDiscordMessage(
        owner,
        confirmationDiscordMessageId.trim(),
      );
      res.json({ previewId });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/debug/memory-context", (req, res) => {
    if (env.nodeEnv === "production") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    try {
      const ownerId = String(req.query.owner_id ?? "");
      const message = String(req.query.message ?? "");
      requireOwner(ownerId || undefined);
      res.json(manager.core.debugMemoryContext(ownerId, message));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/cancel", (req, res) => {
    try {
      const { userId, reservationId } = req.body as {
        userId?: string;
        reservationId?: number;
      };
      const owner = requireOwner(userId);
      if (typeof reservationId !== "number") {
        throw new AppError(
          "message_required",
          "reservationId required",
          400,
        );
      }
      const result = manager.cancel(reservationId, owner);
      res.json(result);
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/curiosity/tick", gone);

  app.get("/curiosity/status", (req, res) => {
    try {
      const ownerId =
        typeof req.query.owner_id === "string"
          ? req.query.owner_id
          : env.memoryOwnerId || env.discordOwnerId || "default";
      res.json(manager.core.getCuriosityStatus(ownerId));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/initiative/tick", gone);

  app.get("/presence/phase", (req, res) => {
    try {
      const ownerId = requireOwner(
        typeof req.query.owner_id === "string" ? req.query.owner_id : undefined,
      );
      const health = manager.core.getHealth();
      res.json(readPresencePhase({
        sidecar: getCognitiveSidecar(),
        nuclear: manager.core.getDatabase(),
        ownerId,
        nowMs: Date.now(),
        healthy: health.ok,
      }));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/discord/public-presence", (req, res) => {
    try {
      const owner = requireOwner(
        typeof req.query.owner_id === "string" ? req.query.owner_id : undefined,
      );
      const sidecar = getCognitiveSidecar();
      const state = readPublicPresenceState(sidecar);
      const context = readPublicPresenceContext(sidecar);
      const expired = state?.action === "set"
        && state.expiresAtMs !== null
        && state.expiresAtMs <= Date.now();
      res.json({
        ok: true,
        ownerId: owner,
        audience: context.audience,
        action: state?.action ?? null,
        text: context.text,
        authoredAtMs: state?.authoredAtMs ?? null,
        expiresAtMs: state?.expiresAtMs ?? null,
        expired: Boolean(expired),
        stateRevision: state?.stateRevision ?? null,
        sourceEffectId: state?.sourceEffectId ?? null,
        projectionState: state?.projectionState ?? null,
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/discord/public-presence/projection-receipt", (req, res) => {
    try {
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const stateRevision = body.stateRevision;
      if (typeof stateRevision !== "number" || !Number.isSafeInteger(stateRevision)) {
        throw new AppError("message_required", "stateRevision must be an integer", 400);
      }
      if (typeof body.sourceEffectId !== "string" || !body.sourceEffectId.trim()) {
        throw new AppError("message_required", "sourceEffectId is required", 400);
      }
      if (body.outcome !== "succeeded" && body.outcome !== "failed" && body.outcome !== "unknown") {
        throw new AppError("message_required", "outcome has an invalid value", 400);
      }
      if (typeof body.cause !== "string" || !body.cause.trim()) {
        throw new AppError("message_required", "cause is required", 400);
      }
      if (body.error !== undefined && body.error !== null && typeof body.error !== "string") {
        throw new AppError("message_required", "error must be a string", 400);
      }
      const atMs = body.atMs === undefined ? Date.now() : body.atMs;
      if (typeof atMs !== "number" || !Number.isSafeInteger(atMs)) {
        throw new AppError("message_required", "atMs must be an integer", 400);
      }
      const result = recordPublicPresenceProjection(getCognitiveSidecar(), {
        stateRevision,
        sourceEffectId: body.sourceEffectId,
        outcome: body.outcome,
        cause: body.cause,
        error: body.error == null ? null : typeof body.error === "string" ? body.error : undefined,
        atMs,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/initiative/scheduler", (req,res)=>{
    const ownerId=(options.ownerId ?? env.discordOwnerId).trim();
    if(!ownerId || req.query.owner_id !== ownerId) {res.status(403).json({code:"forbidden"});return;}
    res.json(schedulerContract());
  });
  app.post("/initiative/scheduler/ack", (req,res)=>{
    const contract=schedulerContract();
    const ownerId=(options.ownerId ?? env.discordOwnerId).trim();
    if(!ownerId || req.body?.userId !== ownerId) {res.status(403).json({code:"forbidden"});return;}
    if(req.body?.owner!==contract.owner || req.body?.contractVersion!==contract.contractVersion
      || req.body?.active!==(contract.owner==="bot")) {res.status(409).json({code:"scheduler_ack_mismatch"});return;}
    // Acknowledgement observes the bot's local timer. It cannot select host ownership.
    if(req.body.botUserId!==undefined && !observeGatewayUserId(req.body.botUserId)){res.status(400).json({code:"scheduler_gateway_identity_invalid"});return;}
    res.json({ok:true,...contract});
  });

  app.post("/initiative/idle", async (req, res) => {
    try {
      requireReady();
      const { userId } = req.body as { userId?: string };
      const owner = requireOwner(userId);
      if(isThalamusEnabled()) {res.json({reason:"scheduler_owned_by_thalamus"});return;}
      if (manager.isPaused()) {
        throw new AppError("agent_not_ready", "Agent not ready", 503);
      }
      res.json(await manager.tickCognitiveIdle(owner));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/initiative/commit", gone);

  app.post("/initiative/abort", gone);

  app.post("/initiative/pause", (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      const owner = requireOwner(userId);
      manager.core.pauseProactive(owner);
      res.json({ ok: true, paused: true });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/initiative/resume", (req, res) => {
    try {
      const { userId } = req.body as { userId?: string };
      const owner = requireOwner(userId);
      manager.core.resumeProactive(owner);
      res.json({ ok: true, paused: false });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  const quietZone = () => env.ownerTimeZone || DEFAULT_OWNER_TIME_ZONE;

  app.post("/quiet", (req, res) => {
    try {
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const durationMs = body.durationMs === undefined ? undefined : c1OptionalInteger(body, "durationMs");
      const window = openOwnerQuiet(getCognitiveSidecar(), {
        nowMs: Date.now(),
        ...(durationMs === undefined ? {} : { durationMs }),
        timeZone: quietZone(),
      });
      res.json({ ok: true, window });
    } catch (err) {
      if (err instanceof Error && err.message === "quiet_duration_invalid") {
        res.status(400).json({ error: "duration must be from 1 ms through 12 hours", code: "quiet_duration_invalid" });
        return;
      }
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/quiet/dnd", (req, res) => {
    try {
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      if (typeof body.on !== "boolean") {
        throw new AppError("bad_request", "on must be a boolean", 400);
      }
      const window = setOwnerDnd(getCognitiveSidecar(), body.on, Date.now(), quietZone());
      res.json({ ok: true, open: window !== null, window });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/quiet/presence", (req, res) => {
    try {
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      const status = typeof body.status === "string" ? body.status : "";
      const sinceMs = c1OptionalInteger(body, "sinceMs");
      if (sinceMs === undefined) throw new AppError("bad_request", "sinceMs is required", 400);
      const stored = recordOwnerPresence(getCognitiveSidecar(), { status, sinceMs }, env.ownerPresenceFacts);
      res.json({ ok: true, stored });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.delete("/quiet", (req, res) => {
    try {
      const body = c1Body(req);
      requireOwner(typeof body.userId === "string" ? body.userId : undefined);
      endQuietWindow(getCognitiveSidecar());
      res.json({ ok: true, open: false });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/quiet", (req, res) => {
    try {
      const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      requireOwner(userId);
      const window = readOpenQuietWindow(getCognitiveSidecar(), Date.now());
      res.json({ ok: true, open: window !== null, window });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/initiative/evaluate", gone);

  app.post("/initiative/generate", gone);

  app.post("/initiative/periodic/debug/enable", (req, res) => {
    try {
      const body = c1Body(req);
      const ownerId = requireOwner(
        typeof body.userId === "string" ? body.userId : undefined,
      );
      const occurrenceId = c1RequiredString(body, "occurrence_id", 300);
      const ttlMs = body.ttl_ms === undefined
        ? undefined
        : c1OptionalInteger(body, "ttl_ms");
      if (ttlMs !== undefined && ttlMs < 0) {
        throw new AppError("message_required", "ttl_ms must be non-negative", 400);
      }
      const nowMs = Date.now();
      const captureMode = readObservabilityMode();
      const store = new ObservabilityStore(getObservabilityDb());
      store.enableThoughtDebugCapture({
        occurrenceId,
        ttlMs,
        enabledBy: ownerId,
        captureMode,
        nowMs,
      });
      const capture = store.getThoughtDebugCapture(occurrenceId, nowMs);
      res.json({
        ok: true,
        occurrenceId,
        captureMode,
        expiresAtMs: capture?.expiresAtMs ?? nowMs + Math.max(0, Math.min(ttlMs ?? RAW_DEBUG_RETENTION_MAX_MS, RAW_DEBUG_RETENTION_MAX_MS)),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/initiative/periodic/diagnostics", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      const rawLimit = req.query.limit;
      const parsedLimit = rawLimit === undefined ? 100 : Number(rawLimit);
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
        throw new AppError("message_required", "limit must be a positive integer", 400);
      }
      res.json({
        ok: true,
        diagnostics: listPeriodicDiagnostics(
          getCognitiveSidecar(),
          getObservabilityDb(),
          { limit: Math.min(100, parsedLimit), nowMs: Date.now() },
        ),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/initiative/status", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      if (!ownerId || (env.memoryOwnerId && ownerId !== env.memoryOwnerId)) {
        if (!ownerId || (env.discordOwnerId && ownerId !== env.discordOwnerId)) {
          throw new AppError("forbidden", "Forbidden", 403);
        }
      }
      const legacy = manager.core.getProactiveStatus(ownerId);
      const nuclear = typeof manager.core.getDatabase === "function"
        ? manager.core.getDatabase()
        : null;
      let status;
      if (cognitiveSidecar && observabilityDb && nuclear) {
        try {
          status = buildProactiveOperatorStatus({
            sidecar: cognitiveSidecar,
            nuclear,
            observabilityDb,
            ownerId,
            legacy,
            nowMs: Date.now(),
          });
        } catch {
          status = unavailableProactiveOperatorStatus({ legacy });
        }
      } else {
        status = unavailableProactiveOperatorStatus({ legacy });
      }
      res.json({
        ...status,
        raEffectiveConfig: getRaEffectiveConfig(),
        thalamus: thalamusStatus(cognitiveSidecar,ownerId,Date.now()),
      });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/initiative/operational-status", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json(manager.core.getProactiveOperationalStatus(ownerId));
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.get("/initiative/urgent", (req, res) => {
    try {
      const ownerId = String(req.query.owner_id ?? "");
      requireOwner(ownerId || undefined);
      res.json({ urgent: manager.core.hasUrgentCognition(ownerId) });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/initiative/clock/reconcile", (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ownerId = requireOwner(
        typeof body.userId === "string" ? body.userId : undefined,
      );
      const authorizationRef = typeof body.authorizationRef === "string" && body.authorizationRef.trim()
        ? body.authorizationRef.trim()
        : "";
      if (!authorizationRef) {
        throw new AppError("message_required", "authorizationRef is required", 400);
      }
      const wallClockNowMs = typeof body.wallClockNowMs === "number" && Number.isFinite(body.wallClockNowMs) && body.wallClockNowMs >= 0
        ? Math.floor(body.wallClockNowMs)
        : Date.now();
      const policyId = typeof body.policyId === "string" && body.policyId.trim()
        ? body.policyId.trim()
        : activePrivateThoughtPolicyId(getCognitiveSidecar());
      const outcome = reconcilePolicyClock(getCognitiveSidecar(), {
        policyId,
        wallClockNowMs,
        authorizationRef,
      });
      res.json({ ok: true, policyId, policyTimeMs: outcome.policyTimeMs });
    } catch (err) {
      const { status, body } = toErrorResponse(err);
      res.status(status).json(body);
    }
  });

  app.post("/habits/upsert", gone);
  app.get("/habits/list", gone);
  app.post("/habits/pause", gone);
  app.post("/reminders/create", gone);
  app.post("/scheduler/tick", gone);
  app.post("/scheduler/commit", gone);
  app.post("/actions/propose", gone);
  app.post("/actions/resolve", gone);

  app.post("/pause", async (_req, res) => {
    await manager.pause();
    res.json({ ok: true });
  });

  app.post("/resume", async (_req, res) => {
    await manager.resume();
    res.json({ ok: true });
  });

  app.post("/shutdown", async (_req, res) => {
    await manager.shutdown();
    res.json({ ok: true });
  });

  assertRegisteredRoutes(app);
  return app;
}

export function listen(app: express.Express): Server {
  return app.listen(env.agentPort, env.agentBindHost, () => {
    console.log(
      `[agent-service] listening on http://${env.agentBindHost}:${env.agentPort}`,
    );
  });
}
