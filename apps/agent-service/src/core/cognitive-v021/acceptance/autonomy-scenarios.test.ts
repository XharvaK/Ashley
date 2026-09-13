import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { publishSemanticTransaction } from "../settlement/publish.js";
import { admitTestCycle, makeThoughtDraft } from "../test-support.js";
import { OutboxDeliveryProjector } from "../delivery/outbox-projector.js";
import { evaluateExternalizationGate } from "../initiative/externalization.js";
import { fireDueTriggers, scheduleFutureTrigger } from "../initiative/future-triggers.js";
import { tickIdleOpportunity } from "../initiative/idle.js";
import type { PrivateBudgetProjection } from "../private-budget/ledger.js";
import { PRIVATE_THOUGHT_POLICY_ID } from "../private-budget/ledger.js";
import { reconcilePolicyClock } from "../private-budget/policy-time-ledger.js";
import { listWorkingContext } from "../evidence/working-context.js";

type ReadRecordToObservationDraft = (read: {
  id: number;
  itemId: number;
  finalUrl: string;
  contentHash: string;
  retrievedAt: string;
  evidenceExcerpts: string[];
  title: string;
  provenance: "live" | "shadow";
}) => {
  observationId: string;
  derived: boolean;
  replaySafe: boolean;
  modality: "page";
  payload: Record<string, unknown>;
  provenance: string;
  dataClassification: string;
  secretOmitted: boolean;
};

const privateBudget: PrivateBudgetProjection = {
  source: "private_budget_ledger",
  policyId: "private-v1",
  limit: 12,
  windowMs: 3_600_000,
  policyTimeMs: 1_000_000,
  lowerBoundMs: -2_600_000,
  clockState: "stable",
  discrepancyMs: 0,
  consumingCount: 11,
  remaining: 1,
  stateCounts: { held: 0, committed: 11, released: 0, reconcile_required: 0, expired: 0 },
};

function seedConcern(db: ReturnType<typeof openCognitiveSidecarDb>, status: "active" | "resolved" = "active"): void {
  db.prepare(
    `INSERT INTO concerns
       (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
        assertion_key, status, snapshot_hash, updated_cycle)
     VALUES ('concern-auto', 'thread-auto', 'revisit the paper', '[]', '{}', NULL, ?, 'snapshot-auto', NULL)`,
  ).run(status);
  db.prepare(
    `INSERT INTO mind_occupancy
       (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
     VALUES ('thread-auto', 'concern-auto', ?, 10, 'seed', 1)`,
  ).run(status);
}

describe("v0.2.1 autonomy acceptance", () => {
  it("binds a live ReadRecord observation to its content hash without semantic meaning", async () => {
    const module = await import("../../../agent.js") as unknown as {
      readRecordToObservationDraft?: ReadRecordToObservationDraft;
    };
    expect(module.readRecordToObservationDraft).toBeTypeOf("function");
    const draft = module.readRecordToObservationDraft!({
      id: 17,
      itemId: 23,
      finalUrl: "https://example.com/article",
      contentHash: "a".repeat(64),
      retrievedAt: "2026-09-09T00:00:00.000Z",
      evidenceExcerpts: ["Bounded untrusted evidence."],
      title: "A page",
      provenance: "live",
    });

    expect(draft).toEqual({
      observationId: `curiosity:read:17:${"a".repeat(64)}`,
      derived: true,
      replaySafe: true,
      modality: "page",
      payload: {
        readId: 17,
        itemId: 23,
        finalUrl: "https://example.com/article",
        contentHash: "a".repeat(64),
        retrievedAt: "2026-09-09T00:00:00.000Z",
        title: "A page",
        excerpts: ["Bounded untrusted evidence."],
        inputTrust: "untrusted_evidence",
      },
      provenance: `curiosity:read:17:${"a".repeat(64)}`,
      dataClassification: "ordinary",
      secretOmitted: false,
    });
    const corrected = module.readRecordToObservationDraft!({
      id: 17,
      itemId: 23,
      finalUrl: "https://example.com/article",
      contentHash: "b".repeat(64),
      retrievedAt: "2026-09-10T00:00:00.000Z",
      evidenceExcerpts: ["Corrected bounded evidence."],
      title: "A corrected page",
      provenance: "live",
    });
    expect(corrected?.observationId).toBe(`curiosity:read:17:${"b".repeat(64)}`);
    expect(corrected?.observationId).not.toBe(draft.observationId);
    expect(corrected?.payload.contentHash).toBe("b".repeat(64));
  });

  it("does not adapt shadow ReadRecord evidence into a Thought observation", async () => {
    const module = await import("../../../agent.js") as unknown as {
      readRecordToObservationDraft?: ReadRecordToObservationDraft;
    };
    expect(module.readRecordToObservationDraft).toBeTypeOf("function");
    expect(module.readRecordToObservationDraft!({
      id: 18,
      itemId: 24,
      finalUrl: "https://example.com/shadow",
      contentHash: "b".repeat(64),
      retrievedAt: "2026-09-09T00:00:00.000Z",
      evidenceExcerpts: ["Shadow evidence must not time-shift into live influence."],
      title: "A shadow page",
      provenance: "shadow",
    })).toBeNull();
  });

  it("omits credential-shaped source material from a live observation payload", async () => {
    const module = await import("../../../agent.js") as unknown as {
      readRecordToObservationDraft?: ReadRecordToObservationDraft;
    };
    const token = `ghp_${"c".repeat(36)}`;
    const draft = module.readRecordToObservationDraft!({
      id: 19,
      itemId: 25,
      finalUrl: "https://example.com/secret",
      contentHash: "c".repeat(64),
      retrievedAt: "2026-09-09T00:00:00.000Z",
      evidenceExcerpts: [`The page accidentally included ${token}.`],
      title: "Credential-shaped page",
      provenance: "live",
    });

    expect(draft).toMatchObject({ dataClassification: "secret", secretOmitted: true });
    expect(JSON.stringify(draft)).not.toContain(token);
    expect(draft?.payload.excerpts).toEqual([]);
  });

  it("uses the existing Thought-authored concern and question path for later input", () => {
    const db = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    try {
      admitTestCycle(db, {
        cycleId: "cycle-curiosity-consequence",
        conversationId: "thread-curiosity-consequence",
        triggerKind: "idle_opportunity",
        triggerRef: "curiosity",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 1,
      });
      const draft = makeThoughtDraft({
        cycleId: "cycle-curiosity-consequence",
        triggerRef: "thread-curiosity-consequence",
        speech: { mode: "none", mustSay: [], mustNot: [], surfaceDraft: "", acceptableRealizations: [], presentationDirectives: [] },
        concernDeltas: [{
          op: "upsert",
          record: {
            concernId: "concern-curiosity",
            conversationId: "thread-curiosity-consequence",
            statement: "Understand the bounded source evidence later.",
            sourceTurnIds: [],
            dimensions: { source: "ashley_interpretation", status: "asserted", time: "historical", reliability: "inferred" },
            assertionKey: null,
            status: "active",
          },
        }],
        occupancyDelta: [{
          op: "set",
          occupancy: {
            conversationId: "thread-curiosity-consequence",
            concernId: "concern-curiosity",
            status: "active",
            priority: 20,
            updatedGeneration: 1,
          },
        }],
        workingContextDelta: [{
          op: "upsert",
          item: {
            id: "wc-curiosity-question",
            conversationId: "thread-curiosity-consequence",
            type: "question",
            text: "Understand the bounded source evidence later.",
            concernId: "concern-curiosity",
            sourceTurnIds: [],
            status: "active",
            supersedesId: null,
          },
        }],
      });
      const published = publishSemanticTransaction(db, {
        ...draft,
        settlementId: "settlement-curiosity-consequence",
        speech: { ...draft.speech, finalLicensedText: null },
      } as any);

      expect(published.published).toBe(true);
      expect(db.prepare("SELECT status FROM concerns WHERE concern_id = 'concern-curiosity'").get())
        .toMatchObject({ status: "active" });
      expect(db.prepare("SELECT status FROM mind_occupancy WHERE concern_id = 'concern-curiosity'").get())
        .toMatchObject({ status: "active" });
      expect(listWorkingContext(db, "thread-curiosity-consequence")).toEqual([
        expect.objectContaining({
          id: "wc-curiosity-question",
          type: "question",
          text: "Understand the bounded source evidence later.",
          concernId: "concern-curiosity",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  it("revalidates due triggers and keeps a private idle settlement silent", async () => {
    const db = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    try {
      seedConcern(db);
      reconcilePolicyClock(db, { policyId: PRIVATE_THOUGHT_POLICY_ID, wallClockNowMs: 6, authorizationRef: "owner:test-epoch" });
      scheduleFutureTrigger(db, { triggerId: "auto-trigger", conversationId: "thread-auto", concernId: "concern-auto", snapshotHash: "snapshot-auto", dueAtMs: 5 });
      const due = await fireDueTriggers(db, { nowMs: 5 });
      expect(due.fired).toHaveLength(1);
      const idle = await tickIdleOpportunity(db, {
        conversationId: "thread-auto",
        nowMs: 6,
        runThought: async () => ({ published: true, outboxId: null, thoughtModelAttempts: 1, speechMode: "none" as const }),
      });
      expect(idle.acceptedSettlements).toBe(1);
      expect(idle.thoughtModelAttempts).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS count FROM speech_outbox").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("records an idle draft before pause and leaves delivery suppressed by the executive gate", async () => {
    const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    const nuclear = new DatabaseSync(":memory:");
    try {
      admitTestCycle(sidecar, {
        cycleId: "cycle-auto-draft",
        conversationId: "thread-auto",
        generation: 1,
        triggerKind: "idle_opportunity",
        triggerRef: "idle",
        occupantId: "doc",
        authorityEpoch: 1,
        architectureEpoch: "v0.2.1",
        nowMs: 1,
      });
      const settlement = makeThoughtDraft({
        cycleId: "cycle-auto-draft",
        speech: { mode: "draft", mustSay: ["idle update"], mustNot: [], surfaceDraft: "idle update", acceptableRealizations: ["idle update"], presentationDirectives: [] },
      });
      const published = publishSemanticTransaction(sidecar, { ...settlement, settlementId: "settlement-auto-draft", speech: { ...settlement.speech, finalLicensedText: "idle update" } });
      expect(published.published).toBe(true);
      const gate = evaluateExternalizationGate({
        deliveryIntent: { ownerId: "doc", channel: "discord", threadId: "thread-auto", conversationId: "thread-auto", trigger: "idle", deliveryLane: "proactive", purpose: "licensed_speech" },
        paused: true, enabled: true, sentToday: 0, maxPerDay: 1, chatInProgress: false, availabilityOk: true, idleFloorRemainingSec: 0, privateBudget,
      });
      expect(gate).toEqual({ ok: false, reason: "proactive_paused" });
      const projector = new OutboxDeliveryProjector(sidecar, nuclear, { gate: () => ({ ok: false, reason: "proactive_paused" }) });
      await projector.project(published.outboxId!);
      expect(sidecar.prepare("SELECT send_status FROM speech_outbox WHERE settlement_id = 'settlement-auto-draft'").get()).toMatchObject({ send_status: "suppressed" });
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("does not start a stale trigger cycle after resolution", async () => {
    const db = openCognitiveSidecarDb(new DatabaseSync(":memory:"), { dataPlane: { kind: "isolated" } });
    try {
      seedConcern(db, "resolved");
      scheduleFutureTrigger(db, { triggerId: "auto-stale", conversationId: "thread-auto", concernId: "concern-auto", snapshotHash: "snapshot-auto", dueAtMs: 1 });
      await expect(fireDueTriggers(db, { nowMs: 1 })).resolves.toMatchObject({ thoughtModelAttempts: 0, fired: [] });
      expect(db.prepare("SELECT COUNT(*) AS count FROM cycle_records").get()).toMatchObject({ count: 1 });
      expect(db.prepare("SELECT state, terminal_reason FROM wakes").get()).toMatchObject({ state: "terminal", terminal_reason: "no_action" });
    } finally {
      db.close();
    }
  });
});
