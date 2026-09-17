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
  type ClassCapacity,
  type ModelHealth,
  type QuotaStateFile,
  emptyQuotaState,
} from "./quota-state.js";

export type WorkerOfferReason =
  | "capability_exists"
  | "capacity_unproven"
  | "worker_capacity_exhausted"
  | "unavailable";

export type RouteOk = {
  ok: true;
  quotaClass: QuotaClass;
  modelId: string;
  bootstrap: boolean;
};

export type RouteDenied = {
  ok: false;
  reason: WorkerOfferReason;
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
} {
  const record = router.state[quotaClass];
  if (router.inFlightFirstAttempt[quotaClass]) {
    return { allowed: false, bootstrap: false, reason: "unavailable" };
  }
  if (record.capacity === "available") {
    return { allowed: true, bootstrap: false, reason: "capability_exists" };
  }
  if (record.capacity === "unknown") {
    return { allowed: true, bootstrap: true, reason: "capacity_unproven" };
  }
  const nextProbe = record.hostNextProbeAtMs;
  if (nextProbe != null && router.nowMs < nextProbe) {
    return { allowed: false, bootstrap: false, reason: "unavailable" };
  }
  return { allowed: true, bootstrap: true, reason: "capacity_unproven" };
}

function nvidiaReadDecision(router: QuotaRouter): RouteDecision {
  const nvidiaAttempt = classCanAttempt(router, "NVIDIA_FREE");
  if (nvidiaAttempt.allowed) {
    const modelId = firstEligible(
      router,
      router.catalog.preferred.delegated_read,
      "NVIDIA_FREE",
    ) ?? firstEligible(router, router.catalog.classes.NVIDIA_FREE, "NVIDIA_FREE");
    if (modelId) {
      return {
        ok: true,
        quotaClass: "NVIDIA_FREE",
        modelId,
        bootstrap: nvidiaAttempt.bootstrap,
      };
    }
    if (router.state.NVIDIA_FREE.capacity !== "quota_exhausted") {
      return { ok: false, reason: "unavailable" };
    }
  } else if (router.state.NVIDIA_FREE.capacity !== "quota_exhausted") {
    return { ok: false, reason: nvidiaAttempt.reason };
  }

  if (router.state.NVIDIA_FREE.capacity !== "quota_exhausted") {
    return { ok: false, reason: "unavailable" };
  }

  const otherAttempt = classCanAttempt(router, "OTHER_FREE");
  if (!otherAttempt.allowed) {
    return {
      ok: false,
      reason: router.state.OTHER_FREE.capacity === "quota_exhausted"
        ? "worker_capacity_exhausted"
        : otherAttempt.reason,
    };
  }
  const otherModel = firstEligible(
    router,
    router.catalog.preferred.iterative_engineering,
    "OTHER_FREE",
  ) ?? firstEligible(router, router.catalog.classes.OTHER_FREE, "OTHER_FREE");
  if (!otherModel) {
    return {
      ok: false,
      reason: router.state.OTHER_FREE.capacity === "quota_exhausted"
        ? "worker_capacity_exhausted"
        : "unavailable",
    };
  }
  return {
    ok: true,
    quotaClass: "OTHER_FREE",
    modelId: otherModel,
    bootstrap: otherAttempt.bootstrap,
  };
}

function engineeringDecision(router: QuotaRouter): RouteDecision {
  const otherAttempt = classCanAttempt(router, "OTHER_FREE");
  if (otherAttempt.allowed) {
    const modelId = firstEligible(
      router,
      router.catalog.preferred.iterative_engineering,
      "OTHER_FREE",
    ) ?? firstEligible(router, router.catalog.classes.OTHER_FREE, "OTHER_FREE");
    if (modelId) {
      return {
        ok: true,
        quotaClass: "OTHER_FREE",
        modelId,
        bootstrap: otherAttempt.bootstrap,
      };
    }
  }

  if (router.state.OTHER_FREE.capacity === "quota_exhausted") {
    return { ok: false, reason: "worker_capacity_exhausted" };
  }

  if (router.catalog.candidateDevelopAllowsNvidia) {
    const nvidiaAttempt = classCanAttempt(router, "NVIDIA_FREE");
    if (nvidiaAttempt.allowed) {
      const modelId = firstEligible(router, router.catalog.classes.NVIDIA_FREE, "NVIDIA_FREE");
      if (modelId) {
        return {
          ok: true,
          quotaClass: "NVIDIA_FREE",
          modelId,
          bootstrap: nvidiaAttempt.bootstrap,
        };
      }
    }
  }

  return { ok: false, reason: otherAttempt.allowed ? "unavailable" : otherAttempt.reason };
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
): { offerable: boolean; reason: WorkerOfferReason } {
  const decision = routeWorkerTask(router, task);
  if (decision.ok) {
    const capacity = router.state[decision.quotaClass].capacity;
    if (capacity === "unknown" || decision.bootstrap) {
      return { offerable: true, reason: "capacity_unproven" };
    }
    return { offerable: true, reason: "capability_exists" };
  }
  return { offerable: false, reason: decision.reason };
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
