/**
 * Host OpenCode quota/model router. Thought never selects model, pool, or fallback.
 */

import {
  C1_OPENCODE_FREE_CATALOG,
  type OpenCodeModelCatalog,
  type QuotaClass,
  type WorkerTaskClass,
} from "./catalog.js";
import {
  type ModelHealth,
  type QuotaStateFile,
  DEFAULT_HOST_PROBE_BACKOFF_MS,
  emptyQuotaState,
} from "./quota-state.js";

export type WorkerOfferReason =
  | "capability_exists"
  | "capacity_unproven"
  | "worker_capacity_exhausted"
  | "unavailable";

export type WorkerCapacityStatus =
  | "capacity_unproven"
  | "available"
  | "quota_exhausted"
  | "temporarily_unavailable"
  | "worker_capacity_exhausted";

export type RouteOk = {
  ok: true;
  quotaClass: QuotaClass;
  modelId: string;
  bootstrap: boolean;
};

export type RouteDenied = {
  ok: false;
  reason: WorkerOfferReason;
  capacityStatus?: WorkerCapacityStatus;
  nextProbeAtMs?: number | null;
};

export type RouteDecision = RouteOk | RouteDenied;

export type QuotaRouter = {
  catalog: OpenCodeModelCatalog;
  state: QuotaStateFile;
  modelHealth: Record<string, ModelHealth>;
  inFlightFirstAttempt: Partial<Record<QuotaClass, boolean>>;
  nowMs: number;
};

let processModelHealth: Record<string, ModelHealth> = {};
let processInFlight: Partial<Record<QuotaClass, boolean>> = {};

export function resetOpenCodeProcessQuotaMemory(): void {
  processModelHealth = {};
  processInFlight = {};
}

export function rememberModelHealth(modelId: string, health: ModelHealth): void {
  processModelHealth[modelId] = health;
}

export function rememberClassInFlight(quotaClass: QuotaClass, inFlight: boolean): void {
  if (inFlight) processInFlight[quotaClass] = true;
  else delete processInFlight[quotaClass];
}

export function createQuotaRouter(input: Partial<QuotaRouter> = {}): QuotaRouter {
  return {
    catalog: input.catalog ?? C1_OPENCODE_FREE_CATALOG,
    state: input.state ?? emptyQuotaState(),
    modelHealth: { ...processModelHealth, ...(input.modelHealth ?? {}) },
    inFlightFirstAttempt: { ...processInFlight, ...(input.inFlightFirstAttempt ?? {}) },
    nowMs: input.nowMs ?? Date.now(),
  };
}

function healthOf(router: QuotaRouter, modelId: string): ModelHealth {
  return router.modelHealth[modelId] ?? "unknown";
}

function modelEligible(router: QuotaRouter, modelId: string, quotaClass: QuotaClass): boolean {
  if (router.state[quotaClass].capacity === "quota_exhausted") return false;
  const health = healthOf(router, modelId);
  return health !== "temporarily_unavailable";
}

function firstEligible(
  router: QuotaRouter,
  modelIds: readonly string[],
  quotaClass: QuotaClass,
): string | null {
  for (const modelId of modelIds) {
    if (modelEligible(router, modelId, quotaClass)) return modelId;
  }
  return null;
}

function classCanAttempt(router: QuotaRouter, quotaClass: QuotaClass): {
  allowed: boolean;
  bootstrap: boolean;
  reason: WorkerOfferReason;
  capacityStatus: WorkerCapacityStatus;
  nextProbeAtMs: number | null;
} {
  const record = router.state[quotaClass];
  if (router.inFlightFirstAttempt[quotaClass]) {
    return {
      allowed: false,
      bootstrap: false,
      reason: "unavailable",
      capacityStatus: "temporarily_unavailable",
      nextProbeAtMs: router.nowMs + DEFAULT_HOST_PROBE_BACKOFF_MS,
    };
  }
  if (record.capacity === "available") {
    return {
      allowed: true,
      bootstrap: false,
      reason: "capability_exists",
      capacityStatus: "available",
      nextProbeAtMs: null,
    };
  }
  if (record.capacity === "unknown") {
    return {
      allowed: true,
      bootstrap: true,
      reason: "capacity_unproven",
      capacityStatus: "capacity_unproven",
      nextProbeAtMs: null,
    };
  }
  const nextProbe = record.providerResetAtMs != null && record.providerResetAtMs > router.nowMs
    ? record.providerResetAtMs
    : record.hostNextProbeAtMs;
  if (nextProbe != null && router.nowMs < nextProbe) {
    return {
      allowed: false,
      bootstrap: false,
      reason: "worker_capacity_exhausted",
      capacityStatus: "quota_exhausted",
      nextProbeAtMs: nextProbe,
    };
  }
  return {
    allowed: true,
    bootstrap: true,
    reason: "capacity_unproven",
    capacityStatus: "quota_exhausted",
    nextProbeAtMs: nextProbe,
  };
}

function classDecision(
  router: QuotaRouter,
  quotaClass: QuotaClass,
  preferred: readonly string[],
): RouteDecision {
  const attempt = classCanAttempt(router, quotaClass);
  if (!attempt.allowed) {
    return {
      ok: false,
      reason: attempt.reason,
      capacityStatus: attempt.capacityStatus,
      nextProbeAtMs: attempt.nextProbeAtMs,
    };
  }
  const modelId = firstEligible(router, preferred, quotaClass)
    ?? firstEligible(router, router.catalog.classes[quotaClass], quotaClass);
  if (modelId) {
    return {
      ok: true,
      quotaClass,
      modelId,
      bootstrap: attempt.bootstrap,
    };
  }
  return {
    ok: false,
    reason: "worker_capacity_exhausted",
    capacityStatus: "temporarily_unavailable",
    nextProbeAtMs: router.nowMs + DEFAULT_HOST_PROBE_BACKOFF_MS,
  };
}

function combinedCapacityWait(router: QuotaRouter, decisions: readonly RouteDenied[]): RouteDenied {
  const nextProbeAtMs = decisions
    .map((decision) => decision.nextProbeAtMs)
    .filter((value): value is number => typeof value === "number" && value > router.nowMs)
    .sort((left, right) => left - right)[0]
    ?? router.nowMs + DEFAULT_HOST_PROBE_BACKOFF_MS;
  const hasQuota = decisions.some((decision) => decision.capacityStatus === "quota_exhausted");
  const hasTemporary = decisions.some((decision) => decision.capacityStatus === "temporarily_unavailable");
  return {
    ok: false,
    reason: "worker_capacity_exhausted",
    capacityStatus: hasQuota && !hasTemporary ? "quota_exhausted" : "temporarily_unavailable",
    nextProbeAtMs,
  };
}

function nvidiaReadDecision(router: QuotaRouter): RouteDecision {
  const decisions = [
    classDecision(router, "NVIDIA_FREE", router.catalog.preferred.delegated_read),
    classDecision(router, "OTHER_FREE", router.catalog.classes.OTHER_FREE),
  ];
  const selected = decisions.find((decision): decision is RouteOk => decision.ok);
  return selected ?? combinedCapacityWait(router, decisions as RouteDenied[]);
}

function engineeringDecision(router: QuotaRouter): RouteDecision {
  const decisions: RouteDenied[] = [];
  const other = classDecision(
    router,
    "OTHER_FREE",
    router.catalog.preferred.iterative_engineering,
  );
  if (other.ok) return other;
  decisions.push(other);
  if (router.catalog.candidateDevelopAllowsNvidia) {
    const nvidia = classDecision(router, "NVIDIA_FREE", router.catalog.classes.NVIDIA_FREE);
    if (nvidia.ok) return nvidia;
    decisions.push(nvidia);
  }
  return combinedCapacityWait(router, decisions);
}

export function routeWorkerTask(
  router: QuotaRouter,
  task: WorkerTaskClass,
): RouteDecision {
  if (task === "delegated_read") return nvidiaReadDecision(router);
  return engineeringDecision(router);
}

export function offerWorkerTask(
  router: QuotaRouter,
  task: WorkerTaskClass,
): { offerable: boolean; reason: WorkerOfferReason; capacityStatus?: WorkerCapacityStatus; nextProbeAtMs?: number | null } {
  const decision = routeWorkerTask(router, task);
  if (decision.ok) {
    const capacity = router.state[decision.quotaClass].capacity;
    if (capacity === "unknown" || decision.bootstrap) {
      return { offerable: true, reason: "capacity_unproven" };
    }
    return { offerable: true, reason: "capability_exists" };
  }
  return {
    offerable: false,
    reason: decision.reason,
    capacityStatus: decision.capacityStatus,
    nextProbeAtMs: decision.nextProbeAtMs,
  };
}

export function markFirstAttempt(router: QuotaRouter, quotaClass: QuotaClass): QuotaRouter {
  return {
    ...router,
    inFlightFirstAttempt: { ...router.inFlightFirstAttempt, [quotaClass]: true },
  };
}

export function clearFirstAttempt(router: QuotaRouter, quotaClass: QuotaClass): QuotaRouter {
  const next = { ...router.inFlightFirstAttempt };
  delete next[quotaClass];
  return { ...router, inFlightFirstAttempt: next };
}

export function setModelHealth(
  router: QuotaRouter,
  modelId: string,
  health: ModelHealth,
): QuotaRouter {
  rememberModelHealth(modelId, health);
  return {
    ...router,
    modelHealth: { ...router.modelHealth, [modelId]: health },
  };
}
