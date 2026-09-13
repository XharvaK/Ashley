import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, KernelDeps, Observation, ThoughtInput } from "../types.js";
import { checkAuthority as deterministicCheckAuthority } from "../authority/check.js";
import { getThoughtAttemptCounters } from "./counters.js";
import { runCognitiveCycle } from "./run.js";
import { AppError } from "../../../errors.js";
import { THOUGHT_UNAVAILABLE_NOTICE } from "../speech/infrastructure-notice.js";

const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: false,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};

function packs() {
  return {
    epistemic: { allowInferredWorldClaims: false },
    currentness: { requireObservationForLatest: true },
    receipt: { receiptsByEffectId: {} },
    capability: capabilityReality,
    operational: { sandboxAvailable: false },
    relational: { withdrawalActive: false, neverMention: [] },
    stateEpoch: { authorityEpoch: 1 },
  };
}

function setup(sidecar = openTestSidecar()) {
  const cycle = admitTestCycle(sidecar, {
    conversationId: "counter-thread",
    triggerKind: "owner_message",
    triggerRef: "owner-1",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: cycle.conversationId,
    text: "hello",
    discordMessageIds: ["discord-1"],
    nowMs: 2,
  });
  const event = appendInboxEvent(sidecar, {
    conversationId: cycle.conversationId,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
    createdAtMs: 2,
  });
  return { sidecar, cycle, event };
}

function inputFrom(messages: unknown[]): ThoughtInput {
  const user = (messages as Array<{ role?: string; content?: unknown }>).find((item) => item.role === "user");
  return JSON.parse(String(user?.content ?? "{}")) as ThoughtInput;
}

function validCompletion(input: ThoughtInput, text = "hello", overrides: Record<string, unknown> = {}) {
  const legacySpeech = overrides.speech as Record<string, unknown> | undefined;
  const speech = legacySpeech
    ? {
        mode: legacySpeech.mode === "none" ? "none" as const : "draft" as const,
        mustSay: Array.isArray(legacySpeech.mustSay) ? legacySpeech.mustSay as string[] : [text],
        mustNotSay: Array.isArray(legacySpeech.mustNotSay)
          ? legacySpeech.mustNotSay as string[]
          : Array.isArray(legacySpeech.mustNot)
            ? legacySpeech.mustNot as string[]
            : [],
        ...(legacySpeech.mode === "none" ? {} : { surfaceDraft: typeof legacySpeech.surfaceDraft === "string" ? legacySpeech.surfaceDraft : text }),
        acceptableRealizations: Array.isArray(legacySpeech.acceptableRealizations)
          ? legacySpeech.acceptableRealizations as string[]
          : [text],
        presentationDirectives: Array.isArray(legacySpeech.presentationDirectives)
          ? legacySpeech.presentationDirectives as string[]
          : [],
      }
    : {
        mode: "draft" as const,
        mustSay: [text],
        mustNotSay: [],
        surfaceDraft: text,
        acceptableRealizations: [text],
        presentationDirectives: [],
      };
  return {
    text: JSON.stringify(makeSemanticSettlement({
      speech,
      ...(overrides.commitments ? { commitments: overrides.commitments } : {}),
    })),
    model: "fake",
    modelAlias: "thought",
    resolvedModelId: null,
  };
}

function deps(
  sidecar: DatabaseSync,
  completeChat: KernelDeps["completeChat"],
  overrides: Partial<KernelDeps> = {},
): KernelDeps {
  return {
    nowMs: () => 10,
    attentionDb: sidecar,
    completeChat,
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: packs,
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution: { constitutional: ["truth first"], stableSelf: ["curious"] },
    capabilityReality,
    ...overrides,
  };
}

describe("v0.2.1 durable Thought accounting", () => {
  it("retries malformed output within one semantic pass and persists separate raw and structural counts", async () => {
    const { sidecar, cycle, event } = setup();
    let calls = 0;
    const completeChat = vi.fn(async (messages: unknown[]) => {
      calls += 1;
      const input = inputFrom(messages);
      return calls === 1 ? { text: "not json", model: "fake", modelAlias: "thought", resolvedModelId: null } : validCompletion(input);
    });
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat));
    expect(result).toMatchObject({ published: true, thoughtModelAttempts: 2, acceptedThoughtPasses: 1 });
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation)).toMatchObject({
      thoughtModelAttempts: 2,
      acceptedThoughtPasses: 1,
      structuralRetries: 1,
    });
    sidecar.close();
  });

  it("stops after the bounded malformed retry budget without publishing speech", async () => {
    const { sidecar, cycle, event } = setup();
    const completeChat = vi.fn(async () => ({ text: "not json", model: "fake", modelAlias: "thought", resolvedModelId: null }));
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat));
    expect(result).toMatchObject({ published: false, infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: STRUCTURAL_RETRY_EXHAUSTED` });
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation)).toMatchObject({
      thoughtModelAttempts: 3,
      acceptedThoughtPasses: 0,
      structuralRetries: 2,
    });
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    sidecar.close();
  });

  it("carries a provider-unavailable classification into the system notice without provider prose", async () => {
    const { sidecar, cycle, event } = setup();
    const completeChat = vi.fn(async () => {
      throw new AppError("provider_unavailable", "provider body contains a secret", 503);
    });
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat));
    expect(result).toMatchObject({
      published: false,
      infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: PROVIDER_UNAVAILABLE`,
    });
    expect(result.infrastructureNotice).not.toContain("provider body contains a secret");
    expect(result.infrastructureNotice).not.toContain("503");
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation)).toMatchObject({
      thoughtModelAttempts: 1,
      structuralRetries: 0,
    });
    sidecar.close();
  });

  it("carries a known rate-limit classification without exposing a synthetic HTTP status", async () => {
    const { sidecar, cycle, event } = setup();
    const completeChat = vi.fn(async () => {
      throw new AppError("rate_limited", "provider body contains a secret", 429);
    });
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat));
    expect(result).toMatchObject({
      published: false,
      infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: RATE_LIMITED`,
    });
    expect(result.infrastructureNotice).not.toContain("provider body contains a secret");
    expect(result.infrastructureNotice).not.toContain("429");
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation)).toMatchObject({
      thoughtModelAttempts: 1,
      structuralRetries: 0,
    });
    sidecar.close();
  });

  it("records provider unavailability separately from malformed structural retries", async () => {
    const { sidecar, cycle, event } = setup();
    const completeChat = vi.fn(async () => { throw new Error("provider_down"); });
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat));
    expect(result).toMatchObject({ published: false, infrastructureNotice: `${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN` });
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation)).toMatchObject({
      thoughtModelAttempts: 1,
      acceptedThoughtPasses: 0,
      structuralRetries: 0,
    });
    expect(sidecar.prepare("SELECT json_extract(payload_json, '$.reason') AS reason FROM thought_steps WHERE kind = 'failure'").get()).toMatchObject({ reason: "unavailable" });
    sidecar.close();
  });

  it("sends an exact authority objection back into the next Thought input and records one revision", async () => {
    const { sidecar, cycle, event } = setup();
    const observedObjections: unknown[] = [];
    let calls = 0;
    const completeChat = vi.fn(async (messages: unknown[]) => {
      const input = inputFrom(messages);
      observedObjections.push(input.authorityObjections);
      calls += 1;
      return validCompletion(input, calls === 1 ? "latest" : "revised", calls === 1 ? {
        commitments: {
          ...makeSemanticSettlement().commitments,
          epistemic: [{
            statement: "latest",
            dimensions: {
              source: "owner_utterance",
              status: "asserted",
              time: "current",
              reliability: "owner_supplied",
            },
          }],
        },
        speech: {
          mode: "draft",
          mustSay: ["latest"],
          mustNot: [],
          surfaceDraft: "latest",
          acceptableRealizations: ["latest"],
          presentationDirectives: [],
        },
      } : {
        authority: {
          objectionsApplied: input.authorityObjections,
          revisionCount: input.authorityObjections.length,
        },
      });
    });
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat, {
      checkAuthority: deterministicCheckAuthority,
    }));
    expect(observedObjections).toEqual([[], ["CURRENTNESS_UNVERIFIED"]]);
    expect(result).toMatchObject({ published: true, thoughtModelAttempts: 2, acceptedThoughtPasses: 2 });
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation).authorityRevisions).toBe(1);
    sidecar.close();
  });

  it("sends a revisable proposal objection back to Thought without dispatching the proposal", async () => {
    const { sidecar, cycle, event } = setup();
    let proposalChecks = 0;
    const objections: unknown[] = [];
    const completeChat = vi.fn(async (messages: unknown[]) => {
      const input = inputFrom(messages);
      objections.push(input.authorityObjections);
      if (objections.length === 1) {
        return {
          text: JSON.stringify({
            kind: "observation_intent",
            operationKind: "project.read_file",
            request: { projectId: "project-ashley", path: "README.md" },
            purpose: "inspect the project file",
            evidenceNeed: "current file contents",
            existingRefs: [],
          }),
          model: "fake",
          modelAlias: "thought",
          resolvedModelId: null,
        };
      }
      return validCompletion(input, "proposal revised", {
        authority: { objectionsApplied: input.authorityObjections, revisionCount: input.authorityObjections.length },
      });
    });
    const executeObservation = vi.fn();
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat, {
      executeObservation,
      checkAuthority: (stage) => {
        if (stage === "proposal" && proposalChecks++ === 0) return { ok: false, codes: ["STALE_STATE"] };
        return { ok: true };
      },
    }));
    expect(objections).toEqual([[], ["STALE_STATE"]]);
    expect(executeObservation).not.toHaveBeenCalled();
    expect(result).toMatchObject({ published: true, thoughtModelAttempts: 2, acceptedThoughtPasses: 2 });
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation).authorityRevisions).toBe(1);
    sidecar.close();
  });

  it("treats a fidelity conflict as actionable revision input and fails closed after the revision budget", async () => {
    const { sidecar, cycle, event } = setup();
    let calls = 0;
    const objections: unknown[] = [];
    const completeChat = vi.fn(async (messages: unknown[]) => {
      const input = inputFrom(messages);
      objections.push(input.authorityObjections);
      calls += 1;
      if (calls === 1) {
        return validCompletion(input, "wrong", {
          speech: {
            mode: "draft",
            mustSay: ["required"],
            mustNot: [],
            surfaceDraft: "wrong",
            acceptableRealizations: ["wrong"],
            presentationDirectives: [],
          },
        });
      }
      return validCompletion(input, "right", {
        authority: { objectionsApplied: input.authorityObjections, revisionCount: input.authorityObjections.length },
      });
    });
    const result = await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat));
    expect(objections).toEqual([[], ["DRAFT_COMMITMENT_CONFLICT"]]);
    expect(result.published).toBe(true);
    expect(getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation).authorityRevisions).toBe(1);
    sidecar.close();

    const exhausted = setup();
    const alwaysObjected = vi.fn(async (messages: unknown[]) => validCompletion(inputFrom(messages), "still claimed"));
    const exhaustedResult = await runCognitiveCycle(exhausted.sidecar, exhausted.sidecar, exhausted.event, deps(exhausted.sidecar, alwaysObjected, {
      checkAuthority: (stage) => stage === "settlement" ? { ok: false, codes: ["CURRENTNESS_UNVERIFIED"] } : { ok: true },
    }));
    expect(exhaustedResult.published).toBe(false);
    expect(exhausted.sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    expect(getThoughtAttemptCounters(exhausted.sidecar, exhausted.cycle.cycleId, exhausted.cycle.generation).authorityRevisions).toBe(2);
    exhausted.sidecar.close();
  });

  it("preserves the counters across a sidecar close and reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ashley-q2-counters-"));
    const path = join(directory, "sidecar.db");
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(path), { dataPlane: { kind: "isolated" } });
    const { cycle, event } = setup(sidecar);
    const completeChat = vi.fn(async (messages: unknown[]) => validCompletion(inputFrom(messages), "persisted"));
    await runCognitiveCycle(sidecar, sidecar, event, deps(sidecar, completeChat));
    const before = getThoughtAttemptCounters(sidecar, cycle.cycleId, cycle.generation);
    sidecar.close();
    const reopened = openCognitiveSidecarDb(new DatabaseSync(path), { dataPlane: { kind: "isolated" } });
    expect(getThoughtAttemptCounters(reopened, cycle.cycleId, cycle.generation)).toEqual(before);
    reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
