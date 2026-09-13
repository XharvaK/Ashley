import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { checkAuthority } from "../authority/check.js";
import {
  getEffectReceipt,
  getEffectReceiptByIdempotencyKey,
  getInFlight,
  markInFlightUnknown,
  putInFlight,
  recordEffectReceipt,
} from "./in-flight.js";
import type { AuthorityPacks, EffectProposal, EffectReceipt } from "../types.js";

export function createEffectProposal(input: {
  effectId?: string;
  cycleId: string;
  generation: number;
  authorityEpoch: number;
  idempotencyKey?: string;
  kind: string;
  request: unknown;
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
       * Required because IN_FLIGHT_UNKNOWN is polysemous: it is also a
       * genuine AuthorityCode from claim/receipt evaluation, so callers
       * must not infer the parent category from child strings.
       */
      origin: "authority" | "dispatch";
    }
  | { dispatched: true; receipt: EffectReceipt; replayed: boolean };

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
      canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
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
  const existingInFlight = getInFlight(db, proposal.idempotencyKey);
  if (existingInFlight) return { dispatched: false, codes: ["IN_FLIGHT_UNKNOWN"], origin: "dispatch" };
  const originEventId = proposal.originEventId;
  if (!originEventId || typeof originEventId !== "string" || !originEventId.trim()) {
    throw new Error("origin_event_id_required");
  }
  const inFlight = putInFlight(db, {
    effectId: proposal.effectId,
    cycleId: proposal.cycleId,
    generation: proposal.generation,
    correlationId: proposal.effectId,
    idempotencyKey: proposal.idempotencyKey,
    payload: proposal.request,
    originEventId,
    originAttemptId: (proposal as { originAttemptId?: string | null }).originAttemptId ?? null,
  });
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
  let output: unknown;
  try { output = await execute(proposal); }
  catch (error) { output = { error: error instanceof Error ? error.message : String(error) }; }
  const isReceipt = (value: unknown): value is EffectReceipt =>
    typeof value === "object" && value !== null
    && typeof (value as { outcome?: unknown }).outcome === "string"
    && typeof (value as { receiptId?: unknown }).receiptId === "string";
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
  const durableReceipt = recordEffectReceipt(db, receipt);
  return { dispatched: true, receipt: durableReceipt, replayed: false };
}
