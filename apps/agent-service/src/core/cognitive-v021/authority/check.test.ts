import { describe, expect, it } from "vitest";
import { makeThoughtDraft } from "../test-support.js";
import type { AuthorityPacks, EffectProposal, ThoughtSettlementDraft } from "../types.js";
import { checkAuthority } from "./check.js";
import { mintEffectRef } from "../effect/effect-ref.js";

function packs(overrides: Partial<AuthorityPacks> = {}): AuthorityPacks {
  return {
    epistemic: { allowInferredWorldClaims: false },
    currentness: { requireObservationForLatest: false },
    receipt: { receiptsByEffectId: {} },
    capability: {
      vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
      canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
      canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
      approvedProjectIds: [],
    },
    operational: { sandboxAvailable: false },
    relational: { withdrawalActive: false, neverMention: [] },
    stateEpoch: { authorityEpoch: 1 },
    ...overrides,
  };
}

describe("v0.2.1 deterministic Authority", () => {
  it("rejects a latest claim without current observation and does not rewrite it", () => {
    const draft = makeThoughtDraft({ commitments: {
      ...makeThoughtDraft().commitments!,
      epistemic: [{ ...makeThoughtDraft().commitments!.epistemic![0]!, statement: "the latest HY4 shipped today", dimensions: { ...makeThoughtDraft().commitments!.epistemic![0]!.dimensions, time: "current" } }],
    }});
    const result = checkAuthority("settlement", { settlement: draft, packs: packs({ currentness: { requireObservationForLatest: true } }), authorityEpoch: 1 });
    expect(result).toMatchObject({ ok: false, codes: ["CURRENTNESS_UNVERIFIED"] });
    expect(draft.commitments!.epistemic![0]?.statement).toBe("the latest HY4 shipped today");
  });

  it("accepts the same claim when a consumed page observation is present", () => {
    const draft = makeThoughtDraft({ commitments: {
      ...makeThoughtDraft().commitments!,
      epistemic: [{ ...makeThoughtDraft().commitments!.epistemic![0]!, statement: "the latest HY4 shipped today" }],
    }, operations: { ...makeThoughtDraft().operations, observationsConsumed: ["obs-1"] }});
    expect(checkAuthority("settlement", {
      settlement: draft,
      packs: packs({ currentness: { requireObservationForLatest: true, observedObservationIds: ["obs-1"] } }),
      authorityEpoch: 1,
    })).toEqual({ ok: true });
  });

  it("bounds effect claims to durable receipts via structured operational commitments", () => {
    const effectRef = mintEffectRef("cycle-1", 1, "effect-1");
    const draft = makeThoughtDraft({
      cycleId: "cycle-1",
      generation: 1,
      operations: { ...makeThoughtDraft().operations, effectsCompleted: ["effect-1"] },
      commitments: {
        ...makeThoughtDraft().commitments,
        operational: [{ effectRef, claimedState: "succeeded" }],
      },
    });
    expect(checkAuthority("settlement", { settlement: draft, packs: packs(), authorityEpoch: 1 })).toMatchObject({ ok: false, codes: ["RECEIPT_REQUIRED"] });
    expect(checkAuthority("settlement", { settlement: draft, packs: packs({ receipt: { receiptsByEffectId: { "effect-1": { receiptId: "r1", effectId: "effect-1", idempotencyKey: "i1", outcome: "failed", claims: {}, atMs: 1, dataClassification: "ordinary", secretOmitted: false } } } }), authorityEpoch: 1 })).toMatchObject({ ok: false, codes: ["RECEIPT_CONTRADICTS_CLAIM"] });
  });

  it("checks active host-owned receipt outcomes even when effectsCompleted is empty", () => {
    const effectRef = mintEffectRef("cycle-1", 1, "effect-1");
    const draft = makeThoughtDraft({
      cycleId: "cycle-1",
      generation: 1,
      commitments: {
        ...makeThoughtDraft().commitments,
        operational: [{ effectRef, claimedState: "succeeded" }],
      },
    });
    const activeEffect = {
      effectId: "effect-1",
      cycleId: "cycle-1",
      generation: 1,
      wakeId: "wake-1",
      correlationId: "effect-1",
      idempotencyKey: "idem-1",
      status: "receipted" as const,
      dispatchedAtMs: 1,
      originJobId: null,
      originEventId: "event-1",
      originAttemptId: null,
    };
    const failedReceipt = {
      receiptId: "r1",
      effectId: "effect-1",
      idempotencyKey: "i1",
      outcome: "failed" as const,
      claims: {},
      atMs: 1,
      dataClassification: "ordinary" as const,
      secretOmitted: false,
    };
    const unknownReceipt = { ...failedReceipt, receiptId: "r2", outcome: "outcome_unknown" as const };
    expect(checkAuthority("settlement", {
      settlement: draft,
      packs: packs({ receipt: { receiptsByEffectId: { "effect-1": failedReceipt } } }),
      authorityEpoch: 1,
      activeEffects: [activeEffect],
    })).toEqual({ ok: false, codes: ["RECEIPT_CONTRADICTS_CLAIM"] });
    expect(checkAuthority("settlement", {
      settlement: draft,
      packs: packs({ receipt: { receiptsByEffectId: { "effect-1": unknownReceipt } } }),
      authorityEpoch: 1,
      activeEffects: [activeEffect],
    })).toEqual({ ok: false, codes: ["IN_FLIGHT_UNKNOWN"] });
  });

  it("rejects unknown effectRef with OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN", () => {
    const draft = makeThoughtDraft({
      cycleId: "cycle-1",
      generation: 1,
      commitments: {
        ...makeThoughtDraft().commitments,
        operational: [{ effectRef: "effect:unknown-hash", claimedState: "succeeded" }],
      },
    });
    expect(checkAuthority("settlement", {
      settlement: draft,
      packs: packs(),
      authorityEpoch: 1,
    })).toEqual({ ok: false, codes: ["OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN"] });
  });

  it("rechecks dispatch epoch and blocks relational withdrawal", () => {
    const proposal: EffectProposal = { effectId: "effect-1", cycleId: "cycle-1", generation: 1, idempotencyKey: "idem-1", kind: "workspace.write_file", request: {}, authorityEpoch: 1 };
    expect(checkAuthority("dispatch", { proposal, packs: packs({ stateEpoch: { authorityEpoch: 2 } }), authorityEpoch: 2 })).toMatchObject({ ok: false, codes: ["DISPATCH_EPOCH_CHANGED"] });
    const draft = makeThoughtDraft();
    expect(checkAuthority("settlement", { settlement: draft, packs: packs({ relational: { withdrawalActive: true, neverMention: [] } }), authorityEpoch: 1 })).toMatchObject({ ok: false, codes: ["RELATIONAL_WITHDRAWAL"] });
  });

  it("caps revision loops instead of allowing a livelock", () => {
    const draft: ThoughtSettlementDraft = makeThoughtDraft({ authority: { objectionsApplied: ["STALE_STATE"], revisionCount: 2 } });
    expect(checkAuthority("settlement", { settlement: draft, packs: packs(), authorityEpoch: 1 })).toMatchObject({ ok: false, codes: ["REVISION_BUDGET_EXHAUSTED"] });
  });

  describe("complete 25-cell Claim x Truth matrix + 5 missing receipt cases (30 total)", () => {
    const states = ["not_attempted", "in_progress", "outcome_unknown", "failed", "succeeded"] as const;

    // Expected code mapping per canonical plan §9.1 and repair instructions:
    // When claimedState == hostState: PASS
    // When host is missing: always RECEIPT_REQUIRED (even for not_attempted)
    const expectedCodes: Record<string, Record<string, string | "PASS">> = {
      not_attempted: {
        not_attempted: "PASS",
        in_progress: "OPERATIONAL_CLAIM_STATE_MISMATCH",
        outcome_unknown: "OPERATIONAL_CLAIM_STATE_MISMATCH",
        failed: "RECEIPT_CONTRADICTS_CLAIM",
        succeeded: "RECEIPT_CONTRADICTS_CLAIM",
        missing: "RECEIPT_REQUIRED",
      },
      in_progress: {
        not_attempted: "RECEIPT_REQUIRED",
        in_progress: "PASS",
        outcome_unknown: "IN_FLIGHT_UNKNOWN",
        failed: "RECEIPT_CONTRADICTS_CLAIM",
        succeeded: "RECEIPT_CONTRADICTS_CLAIM",
        missing: "RECEIPT_REQUIRED",
      },
      outcome_unknown: {
        not_attempted: "RECEIPT_REQUIRED",
        in_progress: "IN_FLIGHT_UNKNOWN",
        outcome_unknown: "PASS",
        failed: "RECEIPT_CONTRADICTS_CLAIM",
        succeeded: "RECEIPT_CONTRADICTS_CLAIM",
        missing: "RECEIPT_REQUIRED",
      },
      failed: {
        not_attempted: "RECEIPT_REQUIRED",
        in_progress: "IN_FLIGHT_UNKNOWN",
        outcome_unknown: "IN_FLIGHT_UNKNOWN",
        failed: "PASS",
        succeeded: "RECEIPT_CONTRADICTS_CLAIM",
        missing: "RECEIPT_REQUIRED",
      },
      succeeded: {
        not_attempted: "RECEIPT_REQUIRED",
        in_progress: "IN_FLIGHT_UNKNOWN",
        outcome_unknown: "IN_FLIGHT_UNKNOWN",
        failed: "RECEIPT_CONTRADICTS_CLAIM",
        succeeded: "PASS",
        missing: "RECEIPT_REQUIRED",
      },
    };

    const hostOptions = ["not_attempted", "in_progress", "outcome_unknown", "failed", "succeeded", "missing"] as const;

    for (const claimed of states) {
      for (const host of hostOptions) {
        const expected = expectedCodes[claimed]![host]!;
        it(`evaluates claimed=${claimed} x host=${host} -> ${expected}`, () => {
          const effectId = "test-effect";
          const effectRef = mintEffectRef("cycle-1", 1, effectId);
          const isTerminal = host === "succeeded" || host === "failed";
          const draft = makeThoughtDraft({
            cycleId: "cycle-1",
            generation: 1,
            // Include in effectsCompleted if terminal and claimed matches, to isolate matrix evaluation from binding check
            operations: {
              ...makeThoughtDraft().operations,
              effectsCompleted: isTerminal && expected === "PASS" ? [effectId] : [],
            },
            commitments: {
              ...makeThoughtDraft().commitments,
              operational: [{ effectRef, claimedState: claimed }],
            },
          });

          const receiptMap: Record<string, any> = {};
          if (host !== "missing") {
            receiptMap[effectId] = {
              receiptId: `r-${host}`,
              effectId,
              idempotencyKey: `idem-${host}`,
              outcome: host,
              claims: {},
              atMs: 100,
              dataClassification: "ordinary",
              secretOmitted: false,
            };
          }

          const activeEffects = [{
            effectId,
            cycleId: "cycle-1",
            generation: 1,
            wakeId: "wake-1",
            correlationId: effectId,
            idempotencyKey: `idem-${host}`,
            status: host === "missing" ? ("receipted" as const) : ("in_flight" as const),
            originJobId: null,
            originEventId: "event-1",
            originAttemptId: null,
            dispatchedAtMs: 1,
          }];

          const result = checkAuthority("settlement", {
            settlement: draft,
            packs: packs({ receipt: { receiptsByEffectId: receiptMap } }),
            authorityEpoch: 1,
            activeEffects,
          });

          if (expected === "PASS") {
            expect(result).toEqual({ ok: true });
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.codes).toContain(expected);
            }
          }
        });
      }
    }
  });

  describe("NS-I1 bidirectional terminal binding with effectsCompleted", () => {
    it("claim succeeded + receipt succeeded + effectsCompleted includes effect -> PASS", () => {
      const effectId = "eff-1";
      const effectRef = mintEffectRef("cycle-1", 1, effectId);
      const draft = makeThoughtDraft({
        cycleId: "cycle-1",
        generation: 1,
        operations: { ...makeThoughtDraft().operations, effectsCompleted: [effectId] },
        commitments: {
          ...makeThoughtDraft().commitments,
          operational: [{ effectRef, claimedState: "succeeded" }],
        },
      });
      const result = checkAuthority("settlement", {
        settlement: draft,
        packs: packs({ receipt: { receiptsByEffectId: { [effectId]: { receiptId: "r1", effectId, idempotencyKey: "i1", outcome: "succeeded", claims: {}, atMs: 1, dataClassification: "ordinary", secretOmitted: false } } } }),
        authorityEpoch: 1,
      });
      expect(result).toEqual({ ok: true });
    });

    it("claim succeeded + receipt succeeded + effectsCompleted empty -> RECEIPT_REQUIRED", () => {
      const effectId = "eff-1";
      const effectRef = mintEffectRef("cycle-1", 1, effectId);
      const draft = makeThoughtDraft({
        cycleId: "cycle-1",
        generation: 1,
        operations: { ...makeThoughtDraft().operations, effectsCompleted: [] },
        commitments: {
          ...makeThoughtDraft().commitments,
          operational: [{ effectRef, claimedState: "succeeded" }],
        },
      });
      const result = checkAuthority("settlement", {
        settlement: draft,
        packs: packs({ receipt: { receiptsByEffectId: { [effectId]: { receiptId: "r1", effectId, idempotencyKey: "i1", outcome: "succeeded", claims: {}, atMs: 1, dataClassification: "ordinary", secretOmitted: false } } } }),
        authorityEpoch: 1,
      });
      expect(result).toMatchObject({ ok: false, codes: ["RECEIPT_REQUIRED"] });
    });

    it("claim failed + receipt failed + effectsCompleted includes effect -> PASS", () => {
      const effectId = "eff-2";
      const effectRef = mintEffectRef("cycle-1", 1, effectId);
      const draft = makeThoughtDraft({
        cycleId: "cycle-1",
        generation: 1,
        operations: { ...makeThoughtDraft().operations, effectsCompleted: [effectId] },
        commitments: {
          ...makeThoughtDraft().commitments,
          operational: [{ effectRef, claimedState: "failed" }],
        },
      });
      const result = checkAuthority("settlement", {
        settlement: draft,
        packs: packs({ receipt: { receiptsByEffectId: { [effectId]: { receiptId: "r2", effectId, idempotencyKey: "i2", outcome: "failed", claims: {}, atMs: 1, dataClassification: "ordinary", secretOmitted: false } } } }),
        authorityEpoch: 1,
      });
      expect(result).toEqual({ ok: true });
    });

    it("claim failed + receipt failed + binding missing -> RECEIPT_REQUIRED", () => {
      const effectId = "eff-2";
      const effectRef = mintEffectRef("cycle-1", 1, effectId);
      const draft = makeThoughtDraft({
        cycleId: "cycle-1",
        generation: 1,
        operations: { ...makeThoughtDraft().operations, effectsCompleted: [] },
        commitments: {
          ...makeThoughtDraft().commitments,
          operational: [{ effectRef, claimedState: "failed" }],
        },
      });
      const result = checkAuthority("settlement", {
        settlement: draft,
        packs: packs({ receipt: { receiptsByEffectId: { [effectId]: { receiptId: "r2", effectId, idempotencyKey: "i2", outcome: "failed", claims: {}, atMs: 1, dataClassification: "ordinary", secretOmitted: false } } } }),
        authorityEpoch: 1,
      });
      expect(result).toMatchObject({ ok: false, codes: ["RECEIPT_REQUIRED"] });
    });

    it("effectsCompleted includes id with no terminal receipt -> fail closed", () => {
      const effectId = "eff-3";
      const draft = makeThoughtDraft({
        cycleId: "cycle-1",
        generation: 1,
        operations: { ...makeThoughtDraft().operations, effectsCompleted: [effectId] },
      });
      const result = checkAuthority("settlement", {
        settlement: draft,
        packs: packs({ receipt: { receiptsByEffectId: {} } }),
        authorityEpoch: 1,
      });
      expect(result).toMatchObject({ ok: false, codes: ["RECEIPT_REQUIRED"] });
    });
  });
});
