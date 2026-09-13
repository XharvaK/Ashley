export type AttentionLane =
  | "interactive"
  | "urgent_grounded"
  | "exchange_cognition"
  | "curiosity_maintenance";

export type AttentionPurpose =
  | "expression"
  | "thought"
  | "thought_observation"
  | "exchange_cognition"
  | "curiosity_consolidation"
  | "maintenance";

export type AttentionState = "queued" | "reserved" | "running" | "terminal";

export type AttentionOutcome =
  | "completed"
  | "cancelled"
  | "timeout"
  | "rate_limited"
  | "error"
  | "aborted";

/** Host-owned provenance for one completed, admitted model dispatch. */
export type AcceptedDispatchIdentity = {
  requestId: number;
  dispatchSequence: number;
  routeAlias: string | null;
  modelAlias: string;
  resolvedModelId: string | null;
  modelEpoch: number;
  modelIdentity: string | null;
  contractId: string;
  buildIdentity: string;
  ownerId: string | null;
  cognitiveJobId: number | null;
};

export type AttentionClock = {
  nowMs: () => number;
};

export const realClock: AttentionClock = {
  nowMs: () => Date.now(),
};

export function createFakeClock(startMs = 0): AttentionClock & {
  advance: (ms: number) => void;
  set: (ms: number) => void;
} {
  let current = startMs;
  return {
    nowMs: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}

export const RPS_WINDOW_MS = 1_000;
export const TPM_WINDOW_MS = 60_000;
export const STARVATION_COGNITION_MS = 6 * 60 * 60 * 1000;
export const STARVATION_CURIOSITY_MS = 24 * 60 * 60 * 1000;
export const STARVATION_MAINTENANCE_MS = 72 * 60 * 60 * 1000;

export const MODEL_SENSITIVE_CAPABILITIES = [
  "thought",
  "learning",
  "reading",
  "curiosity_consolidation",
  "source_discovery",
  "own_time_report",
  "affect",
  "relational_initiative",
] as const;

export function mapPurposeToLane(purpose: AttentionPurpose): AttentionLane {
  switch (purpose) {
    case "expression":
    case "thought":
      return "interactive";
    case "thought_observation":
    case "exchange_cognition":
      return "exchange_cognition";
    case "curiosity_consolidation":
      return "curiosity_maintenance";
    case "maintenance":
      return "curiosity_maintenance";
    default: {
      const _exhaustive: never = purpose;
      return _exhaustive;
    }
  }
}
