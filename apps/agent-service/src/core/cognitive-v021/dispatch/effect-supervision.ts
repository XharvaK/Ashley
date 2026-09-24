import type { DatabaseSync } from "node:sqlite";
import {
  COGNITION_CLAIM_LEASE_MS,
  renewConversationCognitionInTransaction,
} from "../cycle/cognition-claim.js";
import {
  EffectOwnershipLostError,
  type EffectExecutionControl,
} from "../effect/execution-control.js";
import {
  DURABLE_WORK_COORDINATION_LEASE_MS,
  renewDurableWorkClaimInTransaction,
} from "../retry/ledger.js";
import { renewWakeLeaseInTransaction } from "../wake/ledger.js";

export const EFFECT_OWNERSHIP_HEARTBEAT_MS = 30_000 as const;
/** The sidecar SQLite busy timeout bounds receipt persistence to five seconds. */
export const EFFECT_PUBLICATION_MARGIN_MS = 5_000 as const;

export type EffectOwnershipBinding = {
  eventId: string;
  conversationId: string;
  wakeId: string;
  cycleId: string;
  generation: number;
  workerId: string;
  claimToken: string;
  attemptId: string;
  cognitionClaimToken: string;
};

export type SuperviseEffectExecutionInput<T> = {
  db: DatabaseSync;
  ownership: EffectOwnershipBinding;
  controller: AbortController;
  deadlineAtMs: number;
  nowMs: () => number;
  isCurrent: () => boolean;
  isAuthorized: () => boolean;
  execute: (control: EffectExecutionControl) => Promise<T>;
};

function renewOwnershipSet(input: SuperviseEffectExecutionInput<unknown>): boolean {
  const nowMs = input.nowMs();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return false;
  const owner = input.ownership;
  input.db.exec("BEGIN IMMEDIATE");
  try {
    if (!input.isCurrent() || !input.isAuthorized()) throw new Error("effect_ownership_lost");
    const wake = renewWakeLeaseInTransaction(input.db, {
      wakeId: owner.wakeId,
      conversationId: owner.conversationId,
      cycleId: owner.cycleId,
      workerId: owner.workerId,
      leaseToken: owner.claimToken,
      nowMs,
      leaseMs: DURABLE_WORK_COORDINATION_LEASE_MS,
    });
    const durable = renewDurableWorkClaimInTransaction(input.db, {
      eventId: owner.eventId,
      conversationId: owner.conversationId,
      wakeId: owner.wakeId,
      attemptId: owner.attemptId,
      workerId: owner.workerId,
      claimToken: owner.claimToken,
      nowMs,
      leaseMs: DURABLE_WORK_COORDINATION_LEASE_MS,
    });
    const cognition = renewConversationCognitionInTransaction(input.db, {
      conversationId: owner.conversationId,
      claimToken: owner.cognitionClaimToken,
      eventId: owner.eventId,
      wakeId: owner.wakeId,
      cycleId: owner.cycleId,
      generation: owner.generation,
      nowMs,
      leaseMs: COGNITION_CLAIM_LEASE_MS,
    });
    if (!wake || !durable || !cognition) throw new Error("effect_ownership_lost");
    input.db.exec("COMMIT");
    return true;
  } catch {
    try { input.db.exec("ROLLBACK"); } catch { /* preserve ownership loss */ }
    return false;
  }
}

export async function superviseEffectExecution<T>(
  input: SuperviseEffectExecutionInput<T>,
): Promise<T> {
  const startedAtMs = input.nowMs();
  if (
    !Number.isSafeInteger(input.deadlineAtMs)
    || input.deadlineAtMs <= startedAtMs
    || input.deadlineAtMs > Number.MAX_SAFE_INTEGER - EFFECT_PUBLICATION_MARGIN_MS
    || input.controller.signal.aborted
    || !renewOwnershipSet(input)
  ) {
    if (!input.controller.signal.aborted) input.controller.abort("effect_ownership_lost");
    throw new EffectOwnershipLostError();
  }

  const horizonAtMs = input.deadlineAtMs + EFFECT_PUBLICATION_MARGIN_MS;
  let rejectLost!: (error: EffectOwnershipLostError) => void;
  const lost = new Promise<never>((_resolve, reject) => { rejectLost = reject; });
  let closed = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let deadlineTimer: NodeJS.Timeout | null = null;
  let horizonTimer: NodeJS.Timeout | null = null;
  let heartbeatRunning = false;
  let losing = false;

  const clearTimers = () => {
    closed = true;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (horizonTimer) clearTimeout(horizonTimer);
    heartbeatTimer = null;
    deadlineTimer = null;
    horizonTimer = null;
    input.controller.signal.removeEventListener("abort", onAbort);
  };
  const lose = (code = "effect_ownership_lost") => {
    if (closed || losing) return;
    losing = true;
    if (!input.controller.signal.aborted) input.controller.abort(code);
    rejectLost(new EffectOwnershipLostError(code));
  };
  const onAbort = () => {
    if (input.controller.signal.reason === "effect_deadline") return;
    lose();
  };
  input.controller.signal.addEventListener("abort", onAbort, { once: true });
  if (input.controller.signal.aborted) onAbort();

  const scheduleHeartbeat = () => {
    if (closed) return;
    const remaining = horizonAtMs - input.nowMs();
    if (remaining <= 0) {
      lose("effect_deadline_exhausted");
      return;
    }
    heartbeatTimer = setTimeout(() => {
      heartbeatTimer = null;
      if (closed || heartbeatRunning) return;
      heartbeatRunning = true;
      if (input.nowMs() >= horizonAtMs || !renewOwnershipSet(input)) {
        heartbeatRunning = false;
        lose(input.nowMs() >= horizonAtMs ? "effect_deadline_exhausted" : "effect_ownership_lost");
        return;
      }
      heartbeatRunning = false;
      scheduleHeartbeat();
    }, Math.min(EFFECT_OWNERSHIP_HEARTBEAT_MS, remaining));
  };

  deadlineTimer = setTimeout(() => {
    if (!closed && !input.controller.signal.aborted) input.controller.abort("effect_deadline");
  }, Math.max(0, input.deadlineAtMs - input.nowMs()));
  horizonTimer = setTimeout(() => lose("effect_deadline_exhausted"), Math.max(0, horizonAtMs - input.nowMs()));
  scheduleHeartbeat();

  const execution = Promise.resolve()
    .then(() => {
      if (input.controller.signal.aborted) {
        throw new EffectOwnershipLostError(
          input.controller.signal.reason === "effect_deadline"
            ? "effect_deadline_exhausted"
            : "effect_ownership_lost",
        );
      }
      if (input.nowMs() >= input.deadlineAtMs) {
        input.controller.abort("effect_deadline");
        throw new EffectOwnershipLostError("effect_deadline_exhausted");
      }
      return input.execute({ signal: input.controller.signal, deadlineAtMs: input.deadlineAtMs });
    })
    .then(
      (value) => ({ kind: "value" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
  try {
    const result = await Promise.race([execution, lost]);
    if (result.kind === "error") throw result.error;
    if (input.nowMs() >= horizonAtMs || !renewOwnershipSet(input)) {
      throw new EffectOwnershipLostError(input.nowMs() >= horizonAtMs ? "effect_deadline_exhausted" : "effect_ownership_lost");
    }
    return result.value;
  } finally {
    clearTimers();
  }
}
