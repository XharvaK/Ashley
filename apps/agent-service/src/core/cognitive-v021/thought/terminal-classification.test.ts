import { describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import { THOUGHT_UNAVAILABLE_NOTICE } from "../speech/infrastructure-notice.js";
import { incrementThoughtAttemptCounter } from "./counters.js";
import { runCognitiveCycle } from "./run.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function deps(overrides: Partial<KernelDeps> = {}): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false }, currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} }, capability: capabilityReality,
      operational: { sandboxAvailable: false }, relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

function setupThread(threadId = "thread-terminal") {
  const sidecar = openTestSidecar();
  const attentionDb = openTestSidecar();
  const cycle = admitTestCycle(sidecar, {
    conversationId: threadId, triggerKind: "owner_message", triggerRef: "owner-1", nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: threadId, text: "hello", discordMessageIds: ["d1"], nowMs: 2,
  });
  const event = appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId: threadId,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "hello" },
    createdAtMs: 2,
  });
  return { sidecar, attentionDb, cycle, evidence, event };
}

describe("FAILURE-TRUTH-COMPLETENESS-01 producer-to-notice", () => {
  it("maps UNWITNESSED_HIGH_RISK_CLAIM to SPEECH_FIDELITY_REJECTED", async () => {
    const { sidecar, attentionDb, event } = setupThread("thread-fidelity-reading");
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement({
        speech: { mode: "draft", mustSay: ["hello"], surfaceDraft: "I read the Cloudflare documentation." },
      })),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: SPEECH_FIDELITY_REJECTED`,
      );
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps revisable DRAFT_COMMITMENT_CONFLICT through exhaustion to THOUGHT_BUDGET_EXHAUSTED with the cause retained", async () => {
    // DRAFT_COMMITMENT_CONFLICT is revisable, so a persistent conflict revises
    // twice and then exhausts. Terminal cause is exhaustion; the last fidelity
    // objection is retained as its cause rather than replacing exhaustion.
    const { sidecar, attentionDb, cycle, event } = setupThread("thread-fidelity-conflict");
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement({
        speech: { mode: "draft", mustSay: ["required phrase never written"], surfaceDraft: "hello" },
      })),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_BUDGET_EXHAUSTED`,
      );
      const key = (sidecar.prepare("SELECT notice_key FROM system_notice_outbox").get() as { notice_key: string }).notice_key;
      // Notice identity is exactly the pre-packet formula: conversation,
      // cycle, generation, legacy reason. Typed child codes (retained for
      // presentation/diagnostics) never participate in identity.
      expect(key).toBe(
        `thought_failure:thread-fidelity-conflict:${cycle.cycleId}:${cycle.generation}:revision_exhausted`,
      );
      // Durable terminal diagnostic: parent family, both parent and exact
      // child cause codes, and stage survive in the causal ledger even
      // though the notice key carries only the legacy reason.
      const ledger = JSON.parse(
        (sidecar.prepare("SELECT payload_json FROM causal_ledger WHERE cycle_id = ? AND generation = ?").get(cycle.cycleId, cycle.generation) as { payload_json: string }).payload_json,
      ) as { thoughtUnavailable?: unknown; thoughtTerminal?: { family?: unknown; codes?: unknown; stage?: unknown } };
      expect(ledger.thoughtUnavailable).toBe(true);
      expect(ledger.thoughtTerminal?.family).toBe("budget_exhausted");
      expect(ledger.thoughtTerminal?.stage).toBe("fidelity");
      expect(ledger.thoughtTerminal?.codes).toEqual(
        expect.arrayContaining(["revision_exhausted", "DRAFT_COMMITMENT_CONFLICT"]),
      );
      // No second notice is minted, and C3 admits exactly the legacy
      // reason under the pre-packet key (revision_exhausted is allowlisted;
      // typed child codes never reach C3 input) — no admission change.
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM system_notice_outbox").get()).toMatchObject({ count: 1 });
      const c3 = sidecar.prepare("SELECT experience_id, failure_class FROM c3_terminal_experiences WHERE cycle_id = ?").get(cycle.cycleId) as { experience_id: string; failure_class: string };
      expect(c3.failure_class).toBe("revision_exhausted");
      expect(c3.experience_id).toBe(
        `c3:thought:thought_failure:thread-fidelity-conflict:${cycle.cycleId}:${cycle.generation}:revision_exhausted`,
      );
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps multi-code authority rejection to AUTHORITY_REJECTED", async () => {
    const { sidecar, attentionDb, cycle, event } = setupThread("thread-authority-join");
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const result = await runCognitiveCycle(
        sidecar,
        attentionDb,
        event,
        deps({
          attentionDb,
          completeChat,
          checkAuthority: () => ({ ok: false, codes: ["CAPABILITY_UNAVAILABLE", "EFFECT_NOT_AUTHORIZED"] }),
        }),
      );
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: AUTHORITY_REJECTED`,
      );
      const key = (sidecar.prepare("SELECT notice_key FROM system_notice_outbox").get() as { notice_key: string }).notice_key;
      expect(key).toBe(
        `thought_failure:thread-authority-join:${cycle.cycleId}:${cycle.generation}:CAPABILITY_UNAVAILABLE,EFFECT_NOT_AUTHORIZED`,
      );
      // The diagnostic mirror is generic, not exhaustion-specific: the
      // authority parent family with its exact child codes and stage is
      // durably retained while the key stays the pre-packet formula.
      const ledger = JSON.parse(
        (sidecar.prepare("SELECT payload_json FROM causal_ledger WHERE cycle_id = ? AND generation = ?").get(cycle.cycleId, cycle.generation) as { payload_json: string }).payload_json,
      ) as { thoughtTerminal?: { family?: unknown; codes?: unknown; stage?: unknown } };
      expect(ledger.thoughtTerminal?.family).toBe("authority");
      // Producer is the settlement-stage authority check (run.ts emits the
      // mocked non-revisable verdict there with stage authority_settlement).
      expect(ledger.thoughtTerminal?.stage).toBe("authority_settlement");
      expect(ledger.thoughtTerminal?.codes).toEqual(
        expect.arrayContaining(["CAPABILITY_UNAVAILABLE", "EFFECT_NOT_AUTHORIZED"]),
      );
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps observation dispatch failure to OPERATION_DISPATCH_FAILED", async () => {
    const { sidecar, attentionDb, event } = setupThread("thread-observation");
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify({
        kind: "observation_intent",
        operationKind: "project.read_file",
        request: { path: "README.md" },
        purpose: "inspect the file",
        evidenceNeed: "the file contents",
        existingRefs: ["owner-1"],
      }),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    const executeObservation = vi.fn(async () => { throw new Error("observation boom"); });
    try {
      const result = await runCognitiveCycle(
        sidecar, attentionDb, event, deps({ attentionDb, completeChat, executeObservation }),
      );
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: OPERATION_DISPATCH_FAILED`,
      );
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps pass exhaustion to THOUGHT_BUDGET_EXHAUSTED", async () => {
    const { sidecar, attentionDb, cycle, event } = setupThread("thread-pass-exhausted");
    for (let i = 0; i < 12; i += 1) {
      incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "thoughtModelAttempts");
    }
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_BUDGET_EXHAUSTED`,
      );
      expect(completeChat).not.toHaveBeenCalled();
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps revision exhaustion to THOUGHT_BUDGET_EXHAUSTED", async () => {
    const { sidecar, attentionDb, cycle, event } = setupThread("thread-revision-exhausted");
    incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
    incrementThoughtAttemptCounter(sidecar, cycle.cycleId, cycle.generation, "authorityRevisions");
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const result = await runCognitiveCycle(
        sidecar,
        attentionDb,
        event,
        deps({
          attentionDb,
          completeChat,
          checkAuthority: () => ({ ok: false, codes: ["CURRENTNESS_UNVERIFIED"] }),
        }),
      );
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_BUDGET_EXHAUSTED`,
      );
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps single validation malformed to STRUCTURED_OUTPUT_INVALID, not retry-exhausted", async () => {
    // Host settlement validation malformed (single check, no retry budget
    // consumed) must not claim retry exhaustion. Model-authored malformed
    // output is intercepted earlier by the parser with its own bounded retry
    // (E6, proven exhaustion); this validator producer covers the
    // defense-in-depth E19 path with a synthetically invalid draft.
    const { validateThoughtSettlementDraft } = await import("../settlement/validate.js");
    const { emitInfrastructureNotice } = await import("../speech/infrastructure-notice.js");
    const { makeThoughtTerminal } = await import("../speech/infrastructure-notice.js");
    const { admitTestCycle, openTestSidecar } = await import("../test-support.js");
    const validation = validateThoughtSettlementDraft({ not: "a draft" });
    expect(validation.ok).toBe(false);
    if (validation.ok) throw new Error("expected validation failure");
    expect(validation.kind).toBe("malformed");
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-validation", conversationId: "thread-validation", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const notice = emitInfrastructureNotice(db, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-validation",
        conversationId: "thread-validation",
        cycleId: "cycle-validation",
        generation: 1,
        reason: "malformed",
        terminal: makeThoughtTerminal("structural_invalid", { codes: validation.codes, stage: "settlement_validation" }),
      });
      expect(notice.noticeText).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: STRUCTURED_OUTPUT_INVALID`,
      );
      expect(notice.noticeKey).toBe("thought_failure:thread-validation:cycle-validation:1:malformed");
    } finally {
      db.close();
    }
  });

  it("maps occupied-idempotency effect dispatch to OPERATION_DISPATCH_FAILED, never AUTHORITY_REJECTED", async () => {
    // Real producer path: the model emits effect_intent, the bound proposal's
    // idempotency key is already occupied by an in-flight record, so the real
    // dispatchEffect returns IN_FLIGHT_UNKNOWN with dispatch (non-authority)
    // origin. That must not surface as AUTHORITY_REJECTED even though
    // IN_FLIGHT_UNKNOWN is also a genuine AuthorityCode elsewhere.
    const { sidecar, attentionDb, cycle, event } = setupThread("thread-effect-inflight");
    const { sha256 } = await import("../../model-fabric/hash.js");
    const { putInFlight } = await import("../effect/in-flight.js");
    const intent = {
      kind: "effect_intent",
      operationKind: "workspace.write_file",
      request: { projectId: "project-ashley", path: "src/inflight.ts" },
      purpose: "try the operation",
      expectedOutcome: "the file is written",
      existingRefs: ["owner-1"],
    };
    // The binding hash is stable (sorted keys), so the pre-computed key is
    // exactly the key the producer will bind for this intent.
    const identity = sha256({ cycleId: cycle.cycleId, generation: cycle.generation, intent });
    putInFlight(sidecar, {
      effectId: "effect-occupant",
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      correlationId: "corr-occupant",
      idempotencyKey: `thought-effect:${cycle.cycleId}:${cycle.generation}:${identity}`,
      payload: {},
      originEventId: event.id,
      originAttemptId: null,
    });
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(intent),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    const executeEffect = vi.fn();
    try {
      const result = await runCognitiveCycle(
        sidecar, attentionDb, event, deps({ attentionDb, completeChat, executeEffect }),
      );
      expect(result.published).toBe(false);
      expect(executeEffect).not.toHaveBeenCalled();
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: OPERATION_DISPATCH_FAILED`,
      );
      const key = (sidecar.prepare("SELECT notice_key FROM system_notice_outbox").get() as { notice_key: string }).notice_key;
      expect(key).toBe(
        `thought_failure:thread-effect-inflight:${cycle.cycleId}:${cycle.generation}:IN_FLIGHT_UNKNOWN`,
      );
      // The dispatch-mechanics diagnostic is durably retained with its
      // truthful operation_dispatch parent (not authority).
      const ledger = JSON.parse(
        (sidecar.prepare("SELECT payload_json FROM causal_ledger WHERE cycle_id = ? AND generation = ?").get(cycle.cycleId, cycle.generation) as { payload_json: string }).payload_json,
      ) as { thoughtTerminal?: { family?: unknown; codes?: unknown; stage?: unknown } };
      expect(ledger.thoughtTerminal?.family).toBe("operation_dispatch");
      expect(ledger.thoughtTerminal?.stage).toBe("effect_dispatch");
      expect(ledger.thoughtTerminal?.codes).toEqual(["IN_FLIGHT_UNKNOWN"]);
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("keeps genuine dispatch-stage authority rejection as AUTHORITY_REJECTED", async () => {
    // Same real producer path, but the dispatch-time Authority verdict
    // itself rejects (relational withdrawal against a write-kind proposal),
    // so the authority family must still surface as AUTHORITY_REJECTED.
    const { sidecar, attentionDb, event } = setupThread("thread-effect-withdrawal");
    const intent = {
      kind: "effect_intent",
      operationKind: "workspace.write_file",
      request: { projectId: "project-ashley", path: "src/withdrawn.ts" },
      purpose: "try the operation",
      expectedOutcome: "the file is written",
      existingRefs: ["owner-1"],
    };
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(intent),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    const executeEffect = vi.fn();
    try {
      const result = await runCognitiveCycle(
        sidecar,
        attentionDb,
        event,
        deps({
          attentionDb,
          completeChat,
          executeEffect,
          loadAuthorityPacks: () => ({
            epistemic: { allowInferredWorldClaims: false }, currentness: { requireObservationForLatest: true },
            receipt: { receiptsByEffectId: {} }, capability: capabilityReality,
            operational: { sandboxAvailable: false }, relational: { withdrawalActive: true, neverMention: [] },
            stateEpoch: { authorityEpoch: 1 },
          }),
        }),
      );
      expect(result.published).toBe(false);
      expect(executeEffect).not.toHaveBeenCalled();
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: AUTHORITY_REJECTED`,
      );
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps the local Thought deadline to THOUGHT_DEADLINE_EXCEEDED", async () => {
    const { sidecar, attentionDb, event } = setupThread("thread-deadline");
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    // Monotonic clock jumping past the 180s budget: the loop-top deadline
    // fires before any provider dispatch.
    let t = 0;
    const nowMs = vi.fn(() => (t += 200_000));
    try {
      const result = await runCognitiveCycle(
        sidecar, attentionDb, event, deps({ attentionDb, completeChat, nowMs }),
      );
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_DEADLINE_EXCEEDED`,
      );
      expect(completeChat).not.toHaveBeenCalled();
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("keeps Thought-authored abstention silent with no infrastructure notice", async () => {
    const { sidecar, attentionDb, event, evidence } = setupThread("thread-abstain");
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify({
        kind: "abstain",
        reason: "insufficient_evidence",
        explanation: "The supplied evidence is not enough.",
        evidenceRefs: [evidence.rowId],
      }),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const result = await runCognitiveCycle(sidecar, attentionDb, event, deps({ attentionDb, completeChat }));
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBeNull();
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });

  it("maps publication diagnostic persistence failure without claiming a remote outcome", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const cycle = admitTestCycle(sidecar, {
      conversationId: "thread-publication", triggerKind: "owner_message", triggerRef: "owner-1", nowMs: 1,
    });
    const evidence = appendOwnerUtterance(sidecar, {
      conversationId: "thread-publication", text: "hello", discordMessageIds: ["d1"], nowMs: 2,
    });
    const event = appendInboxEvent(sidecar, {
      wakeId: cycle.wakeId,
      conversationId: "thread-publication",
      kind: "owner_message",
      payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "hello" },
      createdAtMs: 2,
    });
    // Terminalize the wake so publication rejects with wake_terminal while the
    // cycle still reaches the publication stage.
    sidecar.prepare("UPDATE wakes SET state = 'terminal', terminal_reason = 'completed' WHERE wake_id = ?")
      .run(cycle.wakeId);
    const brokenObservability = new DatabaseSync(":memory:");
    brokenObservability.close();
    const completeChat = vi.fn(async () => ({
      text: JSON.stringify(makeSemanticSettlement()),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const result = await runCognitiveCycle(
        sidecar,
        attentionDb,
        event,
        deps({ attentionDb, completeChat, observabilityDb: brokenObservability as never }),
      );
      expect(result.published).toBe(false);
      expect(result.infrastructureNotice).toBe(
        `${THOUGHT_UNAVAILABLE_NOTICE} Error code: PUBLICATION_PERSISTENCE_FAILED`,
      );
      expect(result.publicationReason).toBe("wake_terminal");
      // PUBLICATION_PERSISTENCE_FAILED is a local persistence cause. It must
      // not assert a remote effect outcome (succeeded/delivered) or a
      // provider response.
      expect(result.infrastructureNotice).not.toMatch(/succeeded|delivered|provider_unavailable/i);
    } finally {
      sidecar.close();
      attentionDb.close();
    }
  });
});
