import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice, KernelDeps, Observation } from "../types.js";
import {
  MAX_EFFECT_ROUNDS,
  MAX_OBSERVATION_ROUNDS,
  MAX_THOUGHT_PASSES,
  ORDINARY_THOUGHT_BUDGET_MS,
} from "../types.js";
import { runCognitiveCycle } from "./run.js";
import { THOUGHT_UNAVAILABLE_NOTICE } from "../speech/infrastructure-notice.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

function observed(): Observation {
  return {
    observationId: "observation-1",
    cycleId: "cycle-leg",
    generation: 1,
    derived: false,
    replaySafe: true,
    modality: "text",
    payload: { text: "raw" },
    provenance: "fake-read",
    dataClassification: "ordinary",
    secretOmitted: false,
  };
}

function deps(
  attentionDb: ReturnType<typeof openTestSidecar>,
  completeChat: KernelDeps["completeChat"],
  executeObservation: KernelDeps["executeObservation"],
  overrides: Partial<KernelDeps> = {},
): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb,
    completeChat,
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation,
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} },
      capability: capabilityReality,
      operational: { sandboxAvailable: false },
      relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

function admit(sidecar: ReturnType<typeof openTestSidecar>, conversationId: string, text: string) {
  const cycle = admitTestCycle(sidecar, {
    cycleId: `cycle-${conversationId}`,
    conversationId,
    triggerKind: "owner_message",
    triggerRef: `owner-${conversationId}`,
    occupantId: "doc",
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId,
    text,
    discordMessageIds: [`${conversationId}-d`],
    nowMs: 2,
  });
  const event = appendInboxEvent(sidecar, {
    conversationId,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: text },
    createdAtMs: 2,
  });
  return { cycle, event };
}

describe("Thought-leg budget ownership", () => {
  it("keeps ordinary Thought at 300s and existing round caps", () => {
    expect(ORDINARY_THOUGHT_BUDGET_MS).toBe(300_000);
    expect(MAX_THOUGHT_PASSES).toBe(6);
    expect(MAX_OBSERVATION_ROUNDS).toBe(4);
    expect(MAX_EFFECT_ROUNDS).toBe(4);
  });

  it("reuses one deadline across structural retries inside a Thought leg", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const { event } = admit(sidecar, "thread-retry-leg", "hello");
    let now = 1_000;
    const deadlines: number[] = [];
    let calls = 0;
    const completeChat: KernelDeps["completeChat"] = async (_messages, options) => {
      calls += 1;
      deadlines.push(options.deadlineAtMs ?? -1);
      if (calls === 1) {
        now += 50_000;
        return { text: "not json", model: "fake", modelAlias: "thought", resolvedModelId: null };
      }
      return {
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    };
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps(
      attentionDb,
      completeChat,
      vi.fn(async () => observed()),
      { nowMs: () => now },
    ));
    expect(result.published).toBe(true);
    expect(deadlines).toEqual([301_000, 301_000]);
    sidecar.close();
    attentionDb.close();
  });

  it("gives Thought B a fresh 300s after observation wall-clock", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const { event } = admit(sidecar, "thread-obs-leg", "inspect this");
    let now = 1_000;
    const deadlines: number[] = [];
    let calls = 0;
    const completeChat: KernelDeps["completeChat"] = async (_messages, options) => {
      calls += 1;
      deadlines.push(options.deadlineAtMs ?? -1);
      if (calls === 1) {
        now += 40_000;
        return {
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.read_file",
            request: { path: "README.md" },
            purpose: "inspect the file",
            evidenceNeed: "the file contents",
            existingRefs: ["owner-thread-obs-leg"],
          }),
          model: "fake",
          modelAlias: "fake",
          resolvedModelId: null,
        };
      }
      return {
        text: JSON.stringify(makeSemanticSettlement({
          speech: {
            mode: "draft",
            mustSay: ["observed"],
            mustNotSay: [],
            surfaceDraft: "observed",
            acceptableRealizations: [],
            presentationDirectives: [],
          },
        })),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    };
    const executeObservation = vi.fn(async () => {
      now += 200_000;
      return { ...observed(), observationId: "observation-1" };
    });
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps(
      attentionDb,
      completeChat,
      executeObservation,
      { nowMs: () => now },
    ));
    expect(result.published).toBe(true);
    expect(executeObservation).toHaveBeenCalledTimes(1);
    expect(deadlines[0]).toBe(301_000);
    expect(deadlines[1]).toBe(241_000 + ORDINARY_THOUGHT_BUDGET_MS);
    expect(deadlines[1] - deadlines[0]).toBe(240_000);
    sidecar.close();
    attentionDb.close();
  });

  it("gives Thought B a fresh 300s after an effect", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const { event } = admit(sidecar, "thread-effect-leg", "try the operation");
    let now = 1_000;
    const deadlines: number[] = [];
    let calls = 0;
    const completeChat: KernelDeps["completeChat"] = async (messages, options) => {
      calls += 1;
      deadlines.push(options.deadlineAtMs ?? -1);
      if (calls === 1) {
        now += 20_000;
        return {
          text: JSON.stringify({
            kind: "effect_intent",
            operationKind: "workspace.write_file",
            request: { projectId: "project-ashley", path: "src/ok.ts" },
            purpose: "try the operation",
            expectedOutcome: "the file is written",
            existingRefs: ["owner-thread-effect-leg"],
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      }
      const input = JSON.parse(String((messages as Array<{ role?: string; content?: unknown }>).find((item) => item.role === "user")?.content ?? "{}")) as {
        inFlight?: Array<{ effectRef?: string }>;
      };
      const effectRef = input.inFlight?.[0]?.effectRef;
      return {
        text: JSON.stringify(makeSemanticSettlement({
          commitments: {
            ...makeSemanticSettlement().commitments,
            operational: effectRef ? [{ effectRef, claimedState: "succeeded" }] : [],
          },
          speech: {
            mode: "draft",
            mustSay: ["done"],
            mustNotSay: [],
            surfaceDraft: "done",
            acceptableRealizations: [],
            presentationDirectives: [],
          },
        })),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    };
    const executeEffect = vi.fn(async (proposal: { effectId: string; idempotencyKey: string }) => {
      now += 90_000;
      return {
        receiptId: "receipt-ok",
        effectId: proposal.effectId,
        idempotencyKey: proposal.idempotencyKey,
        outcome: "succeeded" as const,
        claims: { state: "succeeded" },
        atMs: now,
        dataClassification: "never_public" as const,
        secretOmitted: true,
      };
    });
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps(
      attentionDb,
      completeChat,
      vi.fn(async () => observed()),
      { nowMs: () => now, executeEffect },
    ));
    expect(result.published).toBe(true);
    expect(executeEffect).toHaveBeenCalledTimes(1);
    expect(deadlines[0]).toBe(301_000);
    expect(deadlines[1]).toBe(111_000 + ORDINARY_THOUGHT_BUDGET_MS);
    sidecar.close();
    attentionDb.close();
  });

  it("does not turn a long valid operation into thought_deadline", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const { event } = admit(sidecar, "thread-long-op", "inspect this");
    let now = 1_000;
    const completeChat: KernelDeps["completeChat"] = async (_messages, options) => {
      if ((options.deadlineAtMs ?? 0) === 301_000) {
        now += 10_000;
        return {
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.read_file",
            request: { path: "README.md" },
            purpose: "inspect the file",
            evidenceNeed: "the file contents",
            existingRefs: ["owner-thread-long-op"],
          }),
          model: "fake",
          modelAlias: "fake",
          resolvedModelId: null,
        };
      }
      return {
        text: JSON.stringify(makeSemanticSettlement()),
        model: "fake",
        modelAlias: "thought",
        resolvedModelId: null,
      };
    };
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps(
      attentionDb,
      completeChat,
      vi.fn(async () => {
        now += 250_000;
        return observed();
      }),
      { nowMs: () => now },
    ));
    expect(result.published).toBe(true);
    expect(result.infrastructureNotice).toBeNull();
    sidecar.close();
    attentionDb.close();
  });

  it("still reports thought_deadline when Thought itself exceeds 300s", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const { event } = admit(sidecar, "thread-thought-timeout", "hello");
    let now = 1_000;
    const completeChat: KernelDeps["completeChat"] = async () => {
      now = 301_000;
      return { text: "not json", model: "fake", modelAlias: "thought", resolvedModelId: null };
    };
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps(
      attentionDb,
      completeChat,
      vi.fn(async () => observed()),
      { nowMs: () => now },
    ));
    expect(result.published).toBe(false);
    expect(result.infrastructureNotice).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_DEADLINE_EXCEEDED`);
    sidecar.close();
    attentionDb.close();
  });

  it("still enforces MAX_OBSERVATION_ROUNDS", async () => {
    const sidecar = openTestSidecar();
    const attentionDb = openTestSidecar();
    const { event } = admit(sidecar, "thread-obs-cap", "inspect this");
    let calls = 0;
    const completeChat: KernelDeps["completeChat"] = async () => {
      calls += 1;
      return {
        text: JSON.stringify({
          kind: "observation_intent",
          operationKind: "project.read_file",
          request: { path: `file-${calls}.md` },
          purpose: "inspect the file",
          evidenceNeed: "the file contents",
          existingRefs: ["owner-thread-obs-cap"],
        }),
        model: "fake",
        modelAlias: "fake",
        resolvedModelId: null,
      };
    };
    const result = await runCognitiveCycle(sidecar, attentionDb, event, deps(
      attentionDb,
      completeChat,
      vi.fn(async () => ({ ...observed(), observationId: `observation-${calls}` })),
    ));
    expect(result.published).toBe(false);
    expect(result.infrastructureNotice).toContain("THOUGHT_BUDGET_EXHAUSTED");
    expect(calls).toBe(MAX_OBSERVATION_ROUNDS + 1);
    sidecar.close();
    attentionDb.close();
  });
});
