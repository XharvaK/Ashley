import { DatabaseSync } from "node:sqlite";
import { openCognitiveSidecarDb } from "./sidecar/db.js";
import { admitCycle, type AdmitCycleInput } from "./cycle/inbox.js";
import { admitWake } from "./wake/ledger.js";
import { occurrenceIdFor } from "./wake/identity.js";
import { SETTLEMENT_SCHEMA_VERSION } from "./types.js";
import type { ThoughtSemanticOutput, ThoughtSettlementDraft, CycleRecord } from "./types.js";

export function openTestSidecar(): DatabaseSync {
  return openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
    dataPlane: { kind: "isolated" },
  });
}

export function makeThoughtDraft(
  overrides: Partial<ThoughtSettlementDraft> = {},
): ThoughtSettlementDraft {
  return {
    schemaVersion: SETTLEMENT_SCHEMA_VERSION,
    cycleId: "cycle-1",
    generation: 1,
    authorityEpoch: 1,
    occupantId: "doc",
    architectureEpoch: "v0.2.1",
    triggerRef: "owner-1",
    interpretation: {
      discourseActs: ["inform"],
      referentBindings: [],
      corrections: [],
      unresolvedAmbiguities: [],
      topics: ["topic"],
    },
    commitments: {
      epistemic: [{
        dimensions: {
          source: "owner_utterance",
          status: "asserted",
          time: "historical",
          reliability: "owner_supplied",
        },
        statement: "topic",
      }],
      operational: [],
      conversational: ["answer"],
      stance: {
        warmth: "medium",
        humorAllowed: false,
        disagreement: false,
        uncertaintyDisplay: true,
      },
    },
    speech: {
      mode: "draft",
      mustSay: ["hello"],
      mustNot: [],
      surfaceDraft: "hello",
      acceptableRealizations: ["hello"],
      presentationDirectives: [],
    },
    workingContextDelta: [],
    concernDeltas: [],
    occupancyDelta: [],
    futureTriggers: [],
    subscriptions: [],
    durableNominations: [],
    operations: {
      observationsConsumed: [],
      effectsCompleted: [],
      intentsStillInFlight: [],
    },
    authority: { objectionsApplied: [], revisionCount: 0 },
    ...overrides,
  };
}

/** Test fixture producer: every fixture cycle is admitted through the W5 wake owner. */
export function admitTestCycle(
  db: DatabaseSync,
  input: Omit<AdmitCycleInput, "wakeId">,
): CycleRecord {
  const triggerRef = input.triggerRef ?? input.cycleId ?? `${input.triggerKind}:test`;
  const admission = admitWake(db, {
    occurrenceId: occurrenceIdFor({ sourceKind: "inbox", triggerRef: `test:${triggerRef}`, conversationId: input.conversationId }),
    triggerRef,
    sourceKind: "inbox",
    conversationId: input.conversationId,
    cycleId: input.cycleId,
    generation: input.generation,
    triggerKind: input.triggerKind,
    occupantId: input.occupantId,
    authorityEpoch: input.authorityEpoch,
    architectureEpoch: input.architectureEpoch,
    preemptedGeneration: input.preemptedGeneration,
    capturedAuthorityRevision: 0,
    nowMs: input.nowMs ?? Date.now(),
  });
  if (admission.kind === "cancelled" || admission.kind === "stale") throw new Error("test_wake_terminal");
  db.prepare(`
    INSERT OR IGNORE INTO inbox_events
      (id, conversation_id, kind, payload_json, created_at_ms, status, wake_id)
    VALUES (?, ?, ?, '{}', ?, 'claimed', ?)
  `).run(
    triggerRef,
    input.conversationId,
    input.triggerKind,
    input.nowMs ?? Date.now(),
    admission.wake.wakeId,
  );
  return admitCycle(db, { ...input, wakeId: admission.wake.wakeId });
}

export function makeSemanticSettlement(
  overrides: Record<string, unknown> = {},
): Extract<ThoughtSemanticOutput, { kind: "settlement" }> & { commitments: NonNullable<Extract<ThoughtSemanticOutput, { kind: "settlement" }>["commitments"]> } {
  const base = {
    kind: "settlement",
    interpretation: { discourseActs: ["inform"], topics: ["topic"] },
    commitments: {
      epistemic: [{ dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" }, statement: "topic" }],
      conversational: ["answer"], stance: { warmth: "medium", humorAllowed: false, disagreement: false, uncertaintyDisplay: true },
    },
    speech: { mode: "draft", mustSay: ["hello"], surfaceDraft: "hello" },
  };
  const merged = { ...base, ...overrides } as Record<string, unknown>;
  const optionalArrays = [
    "workingContextDeltas", "concernDeltas", "occupancyDeltas", "futureTriggerDeltas",
    "subscriptionDeltas", "durableNominations",
  ];
  for (const key of optionalArrays) if (Array.isArray(merged[key]) && merged[key].length === 0) delete merged[key];
  for (const key of ["interpretation", "commitments", "evidenceUse"]) {
    const child = merged[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const normalized = { ...(child as Record<string, unknown>) };
    for (const childKey of Object.keys(normalized)) {
      if (Array.isArray(normalized[childKey]) && normalized[childKey].length === 0) delete normalized[childKey];
    }
    if (Object.keys(normalized).length === 0) delete merged[key];
    else merged[key] = normalized;
  }
  const speech = merged.speech;
  if (speech && typeof speech === "object" && !Array.isArray(speech)) {
    const normalized = { ...(speech as Record<string, unknown>) };
    delete normalized.acceptableRealizations;
    for (const key of ["mustSay", "mustNotSay", "presentationDirectives"]) {
      if (Array.isArray(normalized[key]) && normalized[key].length === 0) delete normalized[key];
    }
    merged.speech = normalized;
  }
  return merged as Extract<ThoughtSemanticOutput, { kind: "settlement" }> & { commitments: NonNullable<Extract<ThoughtSemanticOutput, { kind: "settlement" }>["commitments"]> };
}
