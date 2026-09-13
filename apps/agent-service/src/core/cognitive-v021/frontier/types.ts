import type {
  DeferredFrontierState,
  DeferredReactiveFrontierRecord,
} from "../types.js";
import {
  CAPACITY_WAIT_MAX_DURATION_MS,
  MECHANICAL_SPIN_GUARD_LIMIT,
} from "../types.js";

export type {
  DeferredFrontierState,
  DeferredReactiveFrontierRecord,
};

export {
  CAPACITY_WAIT_MAX_DURATION_MS,
  MECHANICAL_SPIN_GUARD_LIMIT,
};

export type CreateDeferredFrontierInput = {
  frontierId?: string;
  conversationId: string;
  cycleId: string;
  generation: number;
  nextEligibleAtMs: number;
  latestEvidenceRowId: string;
  nowMs?: number;
};

export type ClaimFrontierResult = {
  claimed: boolean;
  frontier?: DeferredReactiveFrontierRecord;
};

export type RescheduleFrontierResult = {
  outcome: "rescheduled" | "exhausted";
  frontier?: DeferredReactiveFrontierRecord;
  reason?: string;
};
