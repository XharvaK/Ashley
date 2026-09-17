import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { C1_OPENCODE_FREE_CATALOG } from "./catalog.js";
import {
  createQuotaRouter,
  offerWorkerTask,
  resetOpenCodeProcessQuotaMemory,
  routeWorkerTask,
  setModelHealth,
} from "./quota-router.js";
import {
  emptyQuotaState,
  loadQuotaState,
  recordClassExhausted,
  saveQuotaState,
} from "./quota-state.js";

const paths: string[] = [];

afterEach(() => {
  resetOpenCodeProcessQuotaMemory();
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("OpenCode quota router", () => {
  it("routes delegated read to NVIDIA and does not treat a model timeout as class exhaustion", () => {
    let router = createQuotaRouter({
      state: {
        NVIDIA_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
        OTHER_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
      },
    });
    router = setModelHealth(router, "opencode/nemotron-3.5-lightning-free", "temporarily_unavailable");
    const decision = routeWorkerTask(router, "delegated_read");
    expect(decision).toMatchObject({
      ok: true,
      quotaClass: "NVIDIA_FREE",
      modelId: "opencode/nemotron-3-ultra-free",
    });
  });

  it("does not spend OTHER_FREE on a NVIDIA outage while the class is not exhausted", () => {
    let router = createQuotaRouter({
      state: {
        NVIDIA_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
        OTHER_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
      },
    });
    for (const modelId of C1_OPENCODE_FREE_CATALOG.classes.NVIDIA_FREE) {
      router = setModelHealth(router, modelId, "temporarily_unavailable");
    }
    const decision = routeWorkerTask(router, "delegated_read");
    expect(decision).toEqual({ ok: false, reason: "unavailable" });
  });

  it("may use OTHER_FREE for delegated read only after NVIDIA_FREE quota_exhausted", () => {
    const router = createQuotaRouter({
      state: {
        NVIDIA_FREE: { capacity: "quota_exhausted", providerResetAtMs: null, hostNextProbeAtMs: 9_999_999_999_999 },
        OTHER_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
      },
    });
    const decision = routeWorkerTask(router, "delegated_read");
    expect(decision).toMatchObject({
      ok: true,
      quotaClass: "OTHER_FREE",
      modelId: "opencode/muse-spark-1.3-contributor-free",
    });
  });

  it("never spawns NVIDIA for iterative engineering when OTHER_FREE is exhausted", () => {
    const router = createQuotaRouter({
      state: {
        NVIDIA_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
        OTHER_FREE: { capacity: "quota_exhausted", providerResetAtMs: null, hostNextProbeAtMs: 9_999_999_999_999 },
      },
    });
    expect(routeWorkerTask(router, "iterative_engineering")).toEqual({
      ok: false,
      reason: "worker_capacity_exhausted",
    });
    expect(offerWorkerTask(router, "delegated_read").offerable).toBe(true);
  });

  it("keeps current candidate.develop policy on OTHER_FREE only", () => {
    const router = createQuotaRouter({
      state: {
        NVIDIA_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
        OTHER_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
      },
    });
    expect(routeWorkerTask(router, "iterative_engineering")).toMatchObject({
      ok: true,
      quotaClass: "OTHER_FREE",
    });
  });

  it("bootstraps unknown with one first attempt and does not fabricate provider reset", () => {
    const router = createQuotaRouter({ state: emptyQuotaState(), nowMs: 1_000 });
    const offer = offerWorkerTask(router, "delegated_read");
    expect(offer).toEqual({ offerable: true, reason: "capacity_unproven" });
    const decision = routeWorkerTask(router, "delegated_read");
    expect(decision).toMatchObject({ ok: true, bootstrap: true, quotaClass: "NVIDIA_FREE" });

    const exhausted = recordClassExhausted(emptyQuotaState(), "NVIDIA_FREE", { nowMs: 1_000 });
    expect(exhausted.NVIDIA_FREE.providerResetAtMs).toBeNull();
    expect(exhausted.NVIDIA_FREE.hostNextProbeAtMs).toBeGreaterThan(1_000);
  });

  it("persists class exhaustion across a reload", () => {
    const dir = join(tmpdir(), `ashley-quota-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    paths.push(dir);
    const path = join(dir, "opencode-quota-state.json");
    const state = recordClassExhausted(emptyQuotaState(), "OTHER_FREE", { nowMs: 50 });
    saveQuotaState(path, state);
    const reloaded = loadQuotaState(path);
    expect(reloaded.OTHER_FREE.capacity).toBe("quota_exhausted");
    expect(JSON.parse(readFileSync(path, "utf8")).OTHER_FREE.capacity).toBe("quota_exhausted");
    const router = createQuotaRouter({ state: reloaded, nowMs: 51 });
    expect(routeWorkerTask(router, "iterative_engineering").ok).toBe(false);
  });

  it("keeps model health process-local across router instances", () => {
    let router = createQuotaRouter({
      state: {
        NVIDIA_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
        OTHER_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
      },
    });
    for (const modelId of C1_OPENCODE_FREE_CATALOG.classes.NVIDIA_FREE) {
      router = setModelHealth(router, modelId, "temporarily_unavailable");
    }
    const next = createQuotaRouter({
      state: {
        NVIDIA_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
        OTHER_FREE: { capacity: "available", providerResetAtMs: null, hostNextProbeAtMs: null },
      },
    });
    expect(routeWorkerTask(next, "delegated_read")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("keeps providerResetAtMs unknown unless supplied", () => {
    const state = recordClassExhausted(emptyQuotaState(), "NVIDIA_FREE", { nowMs: 10 });
    expect(state.NVIDIA_FREE.providerResetAtMs).toBeNull();
    expect(state.NVIDIA_FREE.hostNextProbeAtMs).not.toBeNull();
  });
});
