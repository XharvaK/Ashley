import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { checkAuthority } from "../authority/check.js";
import { EffectOwnershipLostError } from "./execution-control.js";
import {
  getEffectReceipt,
  getEffectReceiptByIdempotencyKey,
  getInFlightByIdempotencyKey,
  getUnresolvedInFlightForCycle,
  markInFlightUnknown,
  putInFlight,
  recordEffectReceipt,
} from "./in-flight.js";
import type { AuthorityPacks, EffectProposal, EffectReceipt } from "../types.js";
import { produceOperationCompletion } from "../operation/completion.js";

export function createEffectProposal(input: {
  effectId?: string;
  cycleId: string;
  generation: number;
  authorityEpoch: number;
  idempotencyKey?: string;
  kind: string;
  request: unknown;
  audienceScope?: EffectProposal["audienceScope"];
  originEventId?: string;
  originAttemptId?: string | null;
}): EffectProposal {
  return {
    effectId: input.effectId ?? randomUUID(),
    cycleId: input.cycleId,
    generation: input.generation,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    kind: input.kind,
    request: input.request,
    audienceScope: input.audienceScope,
    authorityEpoch: input.authorityEpoch,
    originEventId: input.originEventId,
    originAttemptId: input.originAttemptId,
  };
}

export type DispatchEffectResult =
  | {
      dispatched: false;
      codes: string[];
      /**
       * Provenance of the false result, preserved at the producer.
       * "authority" = checkAuthority rejected (initial or pre-execute
       * re-verdict). "dispatch" = dispatch mechanics refused without an
       * Authority rejection (stale generation, idempotency occupied).
       * "fenced" = execution ownership/currentness was lost after admission.
       * Required because IN_FLIGHT_UNKNOWN is polysemous: it is also a
       * genuine AuthorityCode from claim/receipt evaluation, so callers
       * must not infer the parent category from child strings.
       */
      origin: "authority" | "dispatch" | "fenced";
    }
  | { dispatched: true; receipt: EffectReceipt; replayed: boolean }
  | { dispatched: true; pending: true; effectId: string };

export type EffectContinuationDispatchOptions = Readonly<{
  detachAfterAdmission?: boolean;
  onAccepted?: () => void;
  onTerminal?: (receipt: EffectReceipt) => void;
}>;

type DispatchSnapshot = {
  authorityEpoch: number;
  generation?: number;
  packs?: AuthorityPacks;
  authorityDb?: DatabaseSync;
};

export async function dispatchEffect(
  db: DatabaseSync,
  proposal: EffectProposal,
  current: {
    authorityEpoch: number;
    generation?: number;
    authorityDb?: DatabaseSync;
    reload?: () => {
      authorityEpoch: number;
      generation?: number;
      packs?: AuthorityPacks;
      authorityDb?: DatabaseSync;
    };
  },
  execute: (proposal: EffectProposal) => Promise<unknown>,
  packs?: AuthorityPacks | (() => AuthorityPacks),
  continuation?: EffectContinuationDispatchOptions,
): Promise<DispatchEffectResult> {
  const initial: DispatchSnapshot = current.reload?.() ?? {
    authorityEpoch: current.authorityEpoch,
    generation: current.generation,
    authorityDb: current.authorityDb,
  };
  const authorityPacks = typeof packs === "function" ? packs() : packs ?? initial.packs ?? {
    epistemic: { allowInferredWorldClaims: false },
    currentness: { requireObservationForLatest: true },
    receipt: { receiptsByEffectId: {} },
    capability: {
      vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
      canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
      canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
      approvedProjectIds: [],
    },
    operational: { sandboxAvailable: true },
    relational: { withdrawalActive: false, neverMention: [] },
    stateEpoch: { authorityEpoch: initial.authorityEpoch },
  } satisfies AuthorityPacks;
  const verdict = checkAuthority("dispatch", {
    proposal,
    packs: authorityPacks,
    authorityEpoch: initial.authorityEpoch,
    authorityDb: initial.authorityDb,
  });
  if (!verdict.ok) return { dispatched: false, codes: verdict.codes, origin: "authority" };
  if (initial.generation !== undefined && proposal.generation !== initial.generation) {
    return { dispatched: false, codes: ["STALE_GENERATION"], origin: "dispatch" };
  }
  const existing = getEffectReceipt(db, proposal.effectId)
    ?? getEffectReceiptByIdempotencyKey(db, proposal.idempotencyKey);
  if (existing) return { dispatched: true, receipt: existing, replayed: true };
  const existingInFlight = getInFlightByIdempotencyKey(db, proposal.idempotencyKey);
  if (existingInFlight) return { dispatched: false, codes: ["IN_FLIGHT_UNKNOWN"], origin: "dispatch" };
  const originEventId = proposal.originEventId;
  if (!originEventId || typeof originEventId !== "string" || !originEventId.trim()) {
    throw new Error("origin_event_id_required");
  }
  let inFlight;
  try {
    inFlight = putInFlight(db, {
      effectId: proposal.effectId,
      cycleId: proposal.cycleId,
      generation: proposal.generation,
      correlationId: proposal.effectId,
      idempotencyKey: proposal.idempotencyKey,
      payload: proposal.request,
      operationKind: proposal.kind,
      originEventId,
      originAttemptId: (proposal as { originAttemptId?: string | null }).originAttemptId ?? null,
      audienceScope: proposal.audienceScope,
    });
  } catch (error) {
    // The partial unique index is the concurrency authority. Re-read its
    // occupancy after an insert race and report a normal dispatch refusal.
    if (getUnresolvedInFlightForCycle(db, proposal.cycleId)) {
      return { dispatched: false, codes: ["IN_FLIGHT_UNKNOWN"], origin: "dispatch" };
    }
    throw error;
  }
  const beforeExecute: DispatchSnapshot = current.reload?.() ?? {
    authorityEpoch: current.authorityEpoch,
    generation: current.generation,
    authorityDb: current.authorityDb,
  };
  const dispatchPacks = typeof packs === "function" ? packs() : packs ?? beforeExecute.packs ?? authorityPacks;
  const dispatchVerdict = checkAuthority("dispatch", {
    proposal,
    packs: dispatchPacks,
    authorityEpoch: beforeExecute.authorityEpoch,
    authorityDb: beforeExecute.authorityDb,
  });
  if (!dispatchVerdict.ok) {
    markInFlightUnknown(db, inFlight.effectId);
    return { dispatched: false, codes: dispatchVerdict.codes, origin: "authority" };
  }
  if (beforeExecute.generation !== undefined && proposal.generation !== beforeExecute.generation) {
    markInFlightUnknown(db, inFlight.effectId);
    return { dispatched: false, codes: ["STALE_GENERATION"], origin: "dispatch" };
  }
  const isReceipt = (value: unknown): value is EffectReceipt =>
    typeof value === "object" && value !== null
    && typeof (value as { outcome?: unknown }).outcome === "string"
    && typeof (value as { receiptId?: unknown }).receiptId === "string";
  const cancellationCode = (code: string): boolean =>
    code === "command_code_cancelled"
    || code === "effect_ownership_lost"
    || code === "preempt"
    || code === "compose";
  const receiptFor = (output: unknown): EffectReceipt => {
    const failed = typeof output === "object" && output !== null && "error" in output;
    const receipt: EffectReceipt = isReceipt(output)
      ? {
          ...output,
          effectId: proposal.effectId,
          idempotencyKey: proposal.idempotencyKey,
          claims: output.claims ?? {},
          atMs: output.atMs ?? Date.now(),
          dataClassification: output.dataClassification ?? "never_public",
          secretOmitted: output.secretOmitted === true,
        }
      : {
          receiptId: randomUUID(),
          effectId: proposal.effectId,
          idempotencyKey: proposal.idempotencyKey,
          outcome: failed ? "failed" : "succeeded",
          claims: typeof output === "object" && output !== null ? output as Record<string, unknown> : { result: output },
          atMs: Date.now(),
          dataClassification: "never_public",
          secretOmitted: false,
        };
    if (continuation?.detachAfterAdmission
      && receipt.claims.terminationClass === "CANCELLED"
      && receipt.outcome === "succeeded") {
      return {
        ...receipt,
        outcome: "outcome_unknown",
        claims: {
          ...receipt.claims,
          errorCode: typeof receipt.claims.errorCode === "string"
            ? receipt.claims.errorCode
            : "cancelled_effect_cannot_be_success",
        },
      };
    }
    if (continuation?.detachAfterAdmission && receipt.outcome === "in_progress") {
      return {
        ...receipt,
        outcome: "outcome_unknown",
        claims: {
          ...receipt.claims,
          executionTruth: "effect_unknown",
          terminationClass: typeof receipt.claims.terminationClass === "string"
            ? receipt.claims.terminationClass
            : "FAILED",
          errorCode: "continuation_worker_returned_in_progress",
        },
      };
    }
    return receipt;
  };
  const runAndRecord = async (): Promise<EffectReceipt> => {
    let output: unknown;
    try {
      output = await execute(proposal);
    } catch (error) {
      if (error instanceof EffectOwnershipLostError && !continuation?.detachAfterAdmission) throw error;
      if (error instanceof EffectOwnershipLostError) {
        output = {
          outcome: "outcome_unknown",
          receiptId: `v021:effect:${proposal.effectId}:fenced`,
          effectId: proposal.effectId,
          idempotencyKey: proposal.idempotencyKey,
          claims: {
            executionTruth: "effect_unknown",
            terminationClass: cancellationCode(error.code) ? "CANCELLED" : "RESOURCE_EXHAUSTED",
            errorCode: error.code,
          },
          atMs: Date.now(),
          dataClassification: "never_public",
          secretOmitted: true,
        } satisfies EffectReceipt;
      } else {
        output = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    const durableReceipt = recordEffectReceipt(db, receiptFor(output));
    continuation?.onTerminal?.(durableReceipt);
    return durableReceipt;
  };

  if (continuation?.detachAfterAdmission) {
    try {
      if (proposal.kind !== "candidate.develop") throw new Error("effect_continuation_kind_invalid");
      continuation.onAccepted?.();
    } catch {
      const refused: EffectReceipt = {
        receiptId: `v021:effect:${proposal.effectId}:not-attempted`,
        effectId: proposal.effectId,
        idempotencyKey: proposal.idempotencyKey,
        outcome: "not_attempted",
        claims: { executionTruth: "no_effect_proven", terminationClass: "FAILED", errorCode: "effect_continuation_transfer_failed" },
        atMs: Date.now(),
        dataClassification: "never_public",
        secretOmitted: true,
      };
      return { dispatched: true, receipt: recordEffectReceipt(db, refused), replayed: false };
    }
    void runAndRecord().catch(() => {
      // Startup recovery converts any accepted continuation left running by
      // a persistence/process failure to effect_unknown and backfills its wake.
      try { produceOperationCompletion(db, proposal.effectId); } catch { /* bounded startup reconciliation owns retry */ }
    });
    return { dispatched: true, pending: true, effectId: proposal.effectId };
  }

  let durableReceipt: EffectReceipt;
  try { durableReceipt = await runAndRecord(); }
  catch (error) {
    if (error instanceof EffectOwnershipLostError) {
      markInFlightUnknown(db, inFlight.effectId);
      return { dispatched: false, codes: [error.code], origin: "fenced" };
    }
    throw error;
  }
  return { dispatched: true, receipt: durableReceipt, replayed: false };
}
