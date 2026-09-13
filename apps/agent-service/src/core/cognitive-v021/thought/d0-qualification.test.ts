import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { V2ProjectReadRegistry } from "@composer-assistant/sandbox-v2";
import { openNuclearDb } from "../../db.js";
import { listCapabilityStatuses } from "../../rollout/capabilities.js";
import { getCapabilityReality } from "./capability-reality.js";
import { checkAuthority } from "../authority/check.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { buildOperationalEffectNamespaceFromRefs, mintEffectRef } from "../effect/effect-ref.js";
import { applyConcernDelta } from "../concerns/lineage.js";
import { applyOccupancyDelta } from "../concerns/occupancy.js";
import { bindEffectIntent, bindObservationIntent } from "./operation-binding.js";
import {
  THOUGHT_OUTPUT_SCHEMA,
  THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  constrainThoughtOutputSchema,
  thoughtOutputStructuredRequest,
} from "./output-contract.js";
import { parseThoughtSemanticOutput } from "./parse.js";
import { runCognitiveCycle } from "./run.js";
import { validateThoughtSettlementDraft } from "../settlement/validate.js";
import { admitTestCycle, makeSemanticSettlement, makeThoughtDraft, openTestSidecar } from "../test-support.js";
import type {
  AuthorityPacks,
  CapabilityReality,
  EffectReceipt,
  IdentitySlice,
  KernelDeps,
  Observation,
} from "../types.js";
import { validateQualificationSchema } from "../qualification/thought-capability-qualification.js";

const constitution: IdentitySlice = { constitutional: ["truth first"], stableSelf: [] };
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

function authorityPacks(): AuthorityPacks {
  return {
    epistemic: { allowInferredWorldClaims: false },
    currentness: { requireObservationForLatest: false },
    receipt: { receiptsByEffectId: {} },
    capability: capabilityReality,
    operational: { sandboxAvailable: false },
    relational: { withdrawalActive: false, neverMention: [] },
    stateEpoch: { authorityEpoch: 1 },
  };
}

function fixtureDeps(
  attentionDb: DatabaseSync,
  response: unknown,
  overrides: Partial<KernelDeps> = {},
): KernelDeps {
  return {
    nowMs: () => 1_000,
    attentionDb,
    completeChat: vi.fn(async () => ({
      text: JSON.stringify(response),
      model: "fixture",
      modelAlias: "thought",
      resolvedModelId: null,
    })),
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: authorityPacks,
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
    ...overrides,
  };
}

async function runSettlementFixture(
  response: unknown,
  label: string,
  seed?: (sidecar: DatabaseSync, cycle: ReturnType<typeof admitTestCycle>) => void,
): Promise<{ sidecar: DatabaseSync; attentionDb: DatabaseSync; result: Awaited<ReturnType<typeof runCognitiveCycle>>; cycleId: string }> {
  const sidecar = openTestSidecar();
  const attentionDb = openTestSidecar();
  const cycleId = `cycle-d0-${label}`;
  const conversationId = `thread-d0-${label}`;
  const cycle = admitTestCycle(sidecar, {
    cycleId,
    conversationId,
    triggerKind: "owner_message",
    triggerRef: `owner-d0-${label}`,
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  seed?.(sidecar, cycle);
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId,
    text: `D0 fixture ${label}`,
    discordMessageIds: [`d0-${label}`],
    nowMs: 2,
  });
  const event = appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId,
    kind: "owner_message",
    payload: { cycleId, evidenceRowId: evidence.rowId, ownerMessage: evidence.text },
    createdAtMs: 2,
  });
  const result = await runCognitiveCycle(sidecar, attentionDb, event, fixtureDeps(attentionDb, response));
  return { sidecar, attentionDb, result, cycleId };
}

function closeFixture(fixture: { sidecar: DatabaseSync; attentionDb: DatabaseSync }): void {
  fixture.sidecar.close();
  fixture.attentionDb.close();
}

function activeRegistry(): V2ProjectReadRegistry {
  return new V2ProjectReadRegistry([{
    projectId: "project-ashley",
    canonicalRoot: "/srv/projects/project-ashley",
    displayName: "Project Ashley",
    enabled: true,
    readAllowed: true,
    candidateWorkspaceAllowed: true,
    engineeringAllowed: false,
    verificationAllowed: true,
    allowedRecipeIds: ["recipe-1"],
    authorshipAllowed: true,
    operationAllowed: true,
    patchExportAllowed: true,
    exportDestinationCanonicalRoot: "/srv/review/project-ashley",
  }]);
}

function activeNuclearDb(): DatabaseSync {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  listCapabilityStatuses(db, "apply");
  db.prepare("UPDATE capability_releases SET state = 'active'").run();
  return db;
}

describe("Core D0 local Sparse VNext qualification", () => {
  it("D0-1 ordinary draft speech: kind plus speech is sufficient end to end", async () => {
    const fixture = await runSettlementFixture({
      kind: "settlement",
      speech: { mode: "draft", surfaceDraft: "A small truthful answer." },
    }, "01");
    try {
      expect(fixture.result).toMatchObject({ published: true, outboxId: expect.any(Number) });
      expect(fixture.sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
      expect(fixture.sidecar.prepare("SELECT licensed_text FROM speech_outbox").get()).toMatchObject({ licensed_text: "A small truthful answer." });
    } finally { closeFixture(fixture); }
  });

  it("D0-2 silent settlement: explicit none is valid without commitments", async () => {
    const fixture = await runSettlementFixture({ kind: "settlement", speech: { mode: "none" } }, "02");
    try {
      expect(fixture.result).toMatchObject({ published: true, outboxId: null });
      expect(fixture.sidecar.prepare("SELECT COUNT(*) AS count FROM settlements").get()).toMatchObject({ count: 1 });
      expect(fixture.sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
      expect(fixture.sidecar.prepare("SELECT state FROM cycle_records WHERE cycle_id = ?").get(fixture.cycleId)).toMatchObject({ state: "silent" });
    } finally { closeFixture(fixture); }
  });

  it("D0-3 silence plus Working Context delta publishes internal change", async () => {
    const fixture = await runSettlementFixture({
      kind: "settlement",
      speech: { mode: "none" },
      workingContextDeltas: [{
        op: "upsert",
        item: {
          identity: { kind: "local", alias: "quiet-topic" },
          type: "topic",
          text: "A private internal topic.",
          concernRef: null,
          sourceTurnRefs: [],
          status: "active",
          supersedesRef: null,
        },
      }],
    }, "03");
    try {
      expect(fixture.result).toMatchObject({ published: true, outboxId: null });
      expect(fixture.sidecar.prepare("SELECT COUNT(*) AS count FROM working_context_items").get()).toMatchObject({ count: 1 });
      expect(fixture.sidecar.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    } finally { closeFixture(fixture); }
  });

  it("D0-4 epistemic commitment validates as a semantic claim", () => {
    const value = makeSemanticSettlement({
      commitments: {
        epistemic: [{
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          statement: "The owner supplied this historical fact.",
        }],
      },
    });
    expect(parseThoughtSemanticOutput(value, new Set())).toEqual({ ok: true, value });
  });

  it("D0-5 operational claim is licensed only by the receipt matrix", () => {
    const effectId = "host-effect-d0-5";
    const effectRef = mintEffectRef("cycle-d0-5", 1, effectId);
    const receipt = {
      receiptId: "receipt-d0-5",
      effectId,
      idempotencyKey: "idem-d0-5",
      outcome: "succeeded",
      claims: {},
      atMs: 10,
      dataClassification: "ordinary",
      secretOmitted: false,
    } as EffectReceipt;
    const draft = makeThoughtDraft({
      cycleId: "cycle-d0-5",
      triggerRef: "owner-d0-5",
      commitments: { operational: [{ effectRef, claimedState: "succeeded" }] },
      operations: { observationsConsumed: [], effectsCompleted: [effectId], intentsStillInFlight: [] },
    });
    const packs: AuthorityPacks = {
      ...authorityPacks(),
      receipt: { receiptsByEffectId: { [effectId]: receipt } },
    };
    expect(checkAuthority("settlement", { settlement: draft, packs, authorityEpoch: 1 })).toEqual({ ok: true });
    const dishonest = { ...draft, commitments: { operational: [{ effectRef, claimedState: "in_progress" as const }] } };
    expect(checkAuthority("settlement", { settlement: dishonest, packs, authorityEpoch: 1 })).toMatchObject({ ok: false, codes: ["RECEIPT_CONTRADICTS_CLAIM"] });
  });

  it("D0-6 Working Context upsert resolves a local alias to a Host-minted ID", async () => {
    const fixture = await runSettlementFixture({
      kind: "settlement",
      speech: { mode: "none" },
      workingContextDeltas: [{
        op: "upsert",
        item: {
          identity: { kind: "local", alias: "wc-alias" },
          type: "topic",
          text: "Alias-backed topic.",
          concernRef: null,
          sourceTurnRefs: [],
          status: "active",
          supersedesRef: null,
        },
      }],
    }, "06");
    try {
      const row = fixture.sidecar.prepare("SELECT id FROM working_context_items").get() as { id: string };
      expect(fixture.result.published).toBe(true);
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(row.id).not.toBe("wc-alias");
    } finally { closeFixture(fixture); }
  });

  it("D0-7 concern creation publishes a truthful deterministic snapshot hash", async () => {
    const dimensions = { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" } as const;
    const fixture = await runSettlementFixture({
      kind: "settlement",
      speech: { mode: "none" },
      concernDeltas: [{
        op: "upsert",
        record: {
          identity: { kind: "local", alias: "new-concern" },
          statement: "A concern that needs attention.",
          sourceTurnRefs: [],
          dimensions,
          status: "active",
        },
      }],
    }, "07");
    try {
      const row = fixture.sidecar.prepare("SELECT concern_id, conversation_id, statement, source_refs_json, dimensions_json, assertion_key, status, snapshot_hash FROM concerns").get() as Record<string, string | null>;
      expect(fixture.result.published).toBe(true);
      expect(row.concern_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(row.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
      const record = {
        concernId: row.concern_id,
        conversationId: row.conversation_id,
        statement: row.statement,
        sourceTurnIds: JSON.parse(row.source_refs_json ?? "[]"),
        dimensions: JSON.parse(row.dimensions_json ?? "{}"),
        assertionKey: row.assertion_key,
        status: row.status,
      };
      const expected = createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex");
      expect(row.snapshot_hash).toBe(expected);
    } finally { closeFixture(fixture); }
  });

  it("D0-8 cross-domain co-reference resolves a concern alias into a future trigger", async () => {
    const fixture = await runSettlementFixture({
      kind: "settlement",
      speech: { mode: "none" },
      concernDeltas: [{
        op: "upsert",
        record: {
          identity: { kind: "local", alias: "focus" },
          statement: "Revisit this bounded concern.",
          sourceTurnRefs: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          status: "active",
        },
      }],
      futureTriggerDeltas: [{
        op: "create",
        concernRef: { kind: "local", alias: "focus" },
        dueAtMs: 2_000,
        purpose: "revisit",
        payload: { bounded: true },
      }],
    }, "08");
    try {
      const concern = fixture.sidecar.prepare("SELECT concern_id, snapshot_hash FROM concerns").get() as { concern_id: string; snapshot_hash: string };
      const trigger = fixture.sidecar.prepare("SELECT concern_id, snapshot_hash, status FROM future_triggers").get() as { concern_id: string; snapshot_hash: string; status: string };
      expect(fixture.result.published).toBe(true);
      expect(trigger.concern_id).toBe(concern.concern_id);
      expect(trigger.concern_id).not.toBe("focus");
      expect(trigger.snapshot_hash).toBe(concern.snapshot_hash);
      expect(trigger.snapshot_hash).not.toBe("semantic-proposal");
      expect(trigger.status).toBe("scheduled");
    } finally { closeFixture(fixture); }
  });

  it("SW-3 binds an existing concern future trigger to the Host-captured snapshot", async () => {
    const fixture = await runSettlementFixture({
      kind: "settlement",
      speech: { mode: "none" },
      futureTriggerDeltas: [{
        op: "create",
        concernRef: { kind: "existing", ref: "existing-concern" },
        dueAtMs: 2_000,
        purpose: "revisit",
        payload: { bounded: true },
      }],
    }, "08-existing", (sidecar, cycle) => {
      applyConcernDelta(sidecar, {
        op: "upsert",
        record: {
          concernId: "existing-concern",
          conversationId: cycle.conversationId,
          statement: "An existing concern to revisit.",
          sourceTurnIds: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          assertionKey: null,
          status: "active",
        },
      }, { cycleId: cycle.cycleId, generation: cycle.generation });
      applyOccupancyDelta(sidecar, {
        op: "set",
        occupancy: {
          conversationId: cycle.conversationId,
          concernId: "existing-concern",
          status: "active",
          priority: 10,
          updatedGeneration: cycle.generation,
        },
      }, { cycleId: cycle.cycleId, generation: cycle.generation });
    });
    try {
      const concern = fixture.sidecar.prepare("SELECT concern_id, snapshot_hash FROM concerns WHERE concern_id = 'existing-concern'").get() as { concern_id: string; snapshot_hash: string };
      const trigger = fixture.sidecar.prepare("SELECT concern_id, snapshot_hash, status FROM future_triggers").get() as { concern_id: string; snapshot_hash: string; status: string };
      expect(fixture.result).toMatchObject({ published: true, outboxId: null });
      expect(trigger.concern_id).toBe(concern.concern_id);
      expect(trigger.snapshot_hash).toBe(concern.snapshot_hash);
      expect(trigger.status).toBe("scheduled");
    } finally { closeFixture(fixture); }
  });

  it("D0-9 evidence reliance validates only allowlisted references", () => {
    const value = makeSemanticSettlement({ evidenceUse: { sourceRefsUsed: ["turn-d0-9"] } });
    expect(parseThoughtSemanticOutput(value, new Set(["turn-d0-9"]))).toEqual({ ok: true, value });
    expect(parseThoughtSemanticOutput(value, new Set())).toMatchObject({ ok: false, field: "evidenceUse.sourceRefsUsed" });
  });

  it("D0-10 durable nomination receives Host-minted nomination and assertion IDs", async () => {
    const fixture = await runSettlementFixture({
      kind: "settlement",
      speech: { mode: "none" },
      durableNominations: [{
        statement: "The owner prefers bounded tools.",
        memoryKind: "owner_preference",
        dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        dataClassification: "ordinary",
        sourceRefs: [],
        supersedesRef: null,
        concernRef: null,
      }],
    }, "10");
    try {
      const row = fixture.sidecar.prepare("SELECT nomination_id, assertion_key, admitted FROM durable_nominations").get() as { nomination_id: string; assertion_key: string; admitted: number };
      expect(fixture.result.published).toBe(true);
      expect(row.nomination_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(row.assertion_key).toMatch(/^[0-9a-f-]{36}$/i);
      expect(row.nomination_id).not.toBe(row.assertion_key);
      expect(row.admitted).toBe(0);
    } finally { closeFixture(fixture); }
  });

  it("D0-11 correction uses a plain opaque ExistingRef", () => {
    const plain = makeSemanticSettlement({ interpretation: { corrections: [{ correctedTurnRefs: ["turn-1"], fromSpan: "old", toSpan: "new", concernRef: "concern-1" }] } });
    expect(parseThoughtSemanticOutput(plain, new Set(["turn-1", "concern-1"]))).toEqual({ ok: true, value: plain });
    const objectRef = makeSemanticSettlement({ interpretation: { corrections: [{ correctedTurnRefs: ["turn-1"], fromSpan: "old", toSpan: "new", concernRef: { kind: "existing", ref: "concern-1" } as never }] } });
    expect(parseThoughtSemanticOutput(objectRef, new Set(["turn-1", "concern-1"]))).toMatchObject({ ok: false, code: "wrong_type" });
  });

  it("D0-12 observation intent is registered, available, and Host-bound", () => {
    const db = activeNuclearDb();
    try {
      const reality = getCapabilityReality(db, { registry: activeRegistry(), masterMode: "apply", lifecycleEnabled: true, substrateAvailable: true });
      const operation = reality.operationCapabilities?.find((item) => item.operationKind === "project.read_file");
      expect(operation).toMatchObject({ semanticClass: "observation", available: true });
      const semantic = { kind: "observation_intent", operationKind: "project.read_file", request: { projectId: "project-ashley", path: "README.md" }, purpose: "read evidence", evidenceNeed: "current contents", existingRefs: [] } as const;
      expect(parseThoughtSemanticOutput(semantic, new Set())).toEqual({ ok: true, value: semantic });
      const bound = bindObservationIntent({ intent: semantic, cycleId: "cycle-d0-12", generation: 1, parentDeadlineAtMs: 60_000, nowMs: 1_000 });
      expect(bound).toMatchObject({ kind: "project.read_file", replaySafe: true, operationKind: "project.read_file" });
      expect(bound.requestId).toMatch(/^observation:/);
    } finally { db.close(); }
  });

  it("D0-13 effect intent is registered, available, and Host-bound", () => {
    const db = activeNuclearDb();
    try {
      const reality = getCapabilityReality(db, { registry: activeRegistry(), masterMode: "apply", lifecycleEnabled: true, substrateAvailable: true });
      const operation = reality.operationCapabilities?.find((item) => item.operationKind === "workspace.verify");
      expect(operation).toMatchObject({ semanticClass: "effect", available: true });
      const semantic = { kind: "effect_intent", operationKind: "workspace.verify", request: { projectId: "project-ashley", recipeId: "recipe-1" }, purpose: "run verification", expectedOutcome: "the result is available", existingRefs: [] } as const;
      expect(parseThoughtSemanticOutput(semantic, new Set())).toEqual({ ok: true, value: semantic });
      const bound = bindEffectIntent({ intent: semantic, cycleId: "cycle-d0-13", generation: 1, authorityEpoch: 1, parentDeadlineAtMs: 60_000, nowMs: 1_000 });
      expect(bound).toMatchObject({ kind: "workspace.verify", replaySafe: false, authorityEpoch: 1 });
      expect(bound.effectId).toMatch(/^effect:/);
      expect(bound.idempotencyKey).toMatch(/^thought-effect:/);
    } finally { db.close(); }
  });

  it("D0-14 accepts the three fresh abstain reasons and rejects the retired reason", () => {
    for (const reason of ["insufficient_evidence", "unresolved_ambiguity", "no_responsible_proposal"] as const) {
      expect(parseThoughtSemanticOutput({ kind: "abstain", reason, explanation: "No responsible basis.", evidenceRefs: [] }, new Set())).toMatchObject({ ok: true });
    }
    expect(parseThoughtSemanticOutput({ kind: "abstain", reason: "no_semantic_change_warranted", explanation: "No change.", evidenceRefs: [] }, new Set())).toMatchObject({ ok: false, code: "invalid_enum" });
    expect(validateThoughtSettlementDraft(makeThoughtDraft(), { cycleId: "cycle-1", generation: 1, occupantId: "doc", authorityEpoch: 1 })).toMatchObject({ ok: true });
  });

  it("D0-15 rejects every present empty optional array and composite", () => {
    const minimal = { kind: "settlement", speech: { mode: "draft", surfaceDraft: "Answer." } };
    for (const field of ["workingContextDeltas", "concernDeltas", "occupancyDeltas", "futureTriggerDeltas", "subscriptionDeltas", "durableNominations"] as const) {
      expect(parseThoughtSemanticOutput({ ...minimal, [field]: [] }, new Set())).toMatchObject({ ok: false, code: "empty_when_present", field });
    }
    for (const field of ["interpretation", "commitments", "evidenceUse"] as const) {
      expect(parseThoughtSemanticOutput({ ...minimal, [field]: {} }, new Set())).toMatchObject({ ok: false, code: "empty_when_present", field });
    }
  });

  it("D0-16 rejects unknown root and nested fields fail closed", () => {
    const minimal = { kind: "settlement", speech: { mode: "draft", surfaceDraft: "Answer." } };
    expect(parseThoughtSemanticOutput({ ...minimal, hostDefault: true }, new Set())).toMatchObject({ ok: false, code: "unknown_field" });
    expect(parseThoughtSemanticOutput({ ...minimal, speech: { mode: "draft", surfaceDraft: "Answer.", hostDefault: true } }, new Set())).toMatchObject({ ok: false, code: "unknown_field", field: "speech.hostDefault" });
  });

  it("D0-17 rejects settlement output that omits speech", () => {
    expect(parseThoughtSemanticOutput({ kind: "settlement" }, new Set())).toMatchObject({ ok: false, code: "required_field_missing", field: "speech" });
  });

  it("D0-18 keeps explicit empty arrays readable only in the historical V1 draft reader", () => {
    const historical = makeThoughtDraft();
    expect(validateThoughtSettlementDraft(historical, { cycleId: "cycle-1", generation: 1, occupantId: "doc", authorityEpoch: 1 })).toMatchObject({ ok: true });
    const fresh = { kind: "settlement", speech: { mode: "draft", surfaceDraft: "Answer." }, workingContextDeltas: [] };
    expect(parseThoughtSemanticOutput(fresh, new Set())).toMatchObject({ ok: false, code: "empty_when_present" });
  });

  it("D0-19 keeps canonical and fixed-namespace wire fingerprints deterministic and distinct", () => {
    const empty = buildOperationalEffectNamespaceFromRefs([]);
    const allowed = buildOperationalEffectNamespaceFromRefs(["effect:A"]);
    const canonicalAgain = `sha256:${THOUGHT_OUTPUT_SCHEMA_FINGERPRINT.slice("sha256:".length)}`;
    expect(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT).toBe(canonicalAgain);
    expect(thoughtOutputStructuredRequest().schemaFingerprint).toBe(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT);
    expect(constrainThoughtOutputSchema(empty).wireSchemaFingerprint).toBe(constrainThoughtOutputSchema(empty).wireSchemaFingerprint);
    expect(constrainThoughtOutputSchema(empty).wireSchemaFingerprint).not.toBe(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT);
    expect(constrainThoughtOutputSchema(empty).wireSchemaFingerprint).not.toBe(constrainThoughtOutputSchema(allowed).wireSchemaFingerprint);
    expect(JSON.stringify(THOUGHT_OUTPUT_SCHEMA)).toBe(JSON.stringify(thoughtOutputStructuredRequest().schema));
  });

  it("D0-20 makes operational claims impossible in an empty wire namespace", () => {
    const constrained = constrainThoughtOutputSchema(buildOperationalEffectNamespaceFromRefs([]));
    const settlementBranch = (constrained.schema.oneOf as Array<Record<string, any>>).find((branch) => branch.properties?.kind?.const === "settlement")!;
    const operational = settlementBranch.properties.commitments.properties.operational;
    expect(operational).toBeUndefined();
    expect(validateQualificationSchema({ kind: "settlement", speech: { mode: "none" }, commitments: { conversational: ["acknowledge"] } }, constrained.schema)).toMatchObject({ ok: true });
    expect(validateQualificationSchema({ kind: "settlement", speech: { mode: "none" }, commitments: { operational: [{ effectRef: "effect:invented", claimedState: "succeeded" }] } }, constrained.schema)).toMatchObject({ ok: false });
    const materialized = makeThoughtDraft({ commitments: { conversational: ["acknowledge"] }, operations: { observationsConsumed: [], effectsCompleted: [], intentsStillInFlight: [] } });
    expect(materialized.operations.effectsCompleted).toEqual([]);
  });
});
