import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendOwnerUtterance } from "../cognitive-v021/evidence/conversation-log.js";
import type { OperationalEffectNamespace } from "../cognitive-v021/effect/effect-ref.js";
import { admitTestCycle, openTestSidecar } from "../cognitive-v021/test-support.js";
import { recordAftermathPending, recordSettlementAftermath } from "../cognitive-v021/thought/aftermath.js";
import { buildThoughtInput } from "../cognitive-v021/thought/input.js";
import { parseThoughtSemanticOutput } from "../cognitive-v021/thought/parse.js";
import {
  constrainThoughtOutputSchema, DOMUS_PROMISE_GUIDANCE, DOMUS_PROMISE_SETTLE_GUIDANCE, thoughtContractProfile,
  thoughtOutputCompatibilityInstruction,
} from "../cognitive-v021/thought/output-contract.js";
import { admitObservation, observationDigest, upsertHeartbeat } from "./store.js";
import { configureEmbodimentBudget, domusForThought, domusNowForThought, selectDomusNotification } from "./notification.js";
import {
  DOMUS_PROMISE_OPEN_MAX, DOMUS_PROMISE_TTL_MS, domusPromisesOpen, isDomusPromiseClaim, isDomusPromiseSettlements,
  recordDomusPromise, settleDomusPromises,
} from "./promises.js";

const NOW = 10_000_000;
const HOME = "owner-thread";
const LANE = "domus-lane:owner";
const PROMISE = { id: "p-shown", text: "I will go find someone to talk to.", since: new Date(NOW).toISOString() };
const constitution = { constitutional: ["truth before performance"], stableSelf: ["curious"] };
const noEngineering = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false, canOfferProjectInspection: false,
  canOfferWorkspace: false, canOfferVerification: false, canOfferAuthorship: false, canOfferBoundedOperation: false,
  canOfferInquiry: false, canOfferPatchExport: false, approvedProjectIds: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** One settled pass: a settlement row and its aftermath, recorded the way publication leaves them. */
function settlePass(db: DatabaseSync, input: {
  cycleId: string; triggerKind: string; settlement: Record<string, unknown>; context: Record<string, unknown>; nowMs?: number;
}): "recorded" | "not_pending" {
  const nowMs = input.nowMs ?? NOW;
  admitTestCycle(db, { cycleId: input.cycleId, conversationId: "c", occupantId: "owner", generation: 1,
    triggerKind: input.triggerKind as "owner_message", triggerRef: `${input.triggerKind}:${input.cycleId}`, nowMs });
  db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,?)")
    .run(`${input.cycleId}-settlement`, input.cycleId, JSON.stringify({ sawSecret: false, ...input.settlement }));
  recordAftermathPending(db, { settlementId: `${input.cycleId}-settlement`, cycleId: input.cycleId, nowMs,
    context: { conversationId: "c", ownerPrivate: true, passKind: null, nightPass: null, ...input.context } });
  return recordSettlementAftermath(db, `${input.cycleId}-settlement`, { identityStore: null, timeZone: "UTC", nowMs });
}

function promiseRows(db: DatabaseSync) {
  return db.prepare("SELECT cycle_id, text, status, created_at_ms, settled_at_ms FROM domus_promises ORDER BY created_at_ms, promise_id").all();
}

/** One armed game observation, admitted the way the helper's ingress admits it. */
function observe(db: DatabaseSync, seq: number, portrait?: Record<string, unknown>): string {
  const observationId = `helper-a.${seq}`;
  const receiptTimeMs = NOW - 60_000 + seq * 1000;
  const payload = {
    v: 1, observation_id: observationId, world: "slot0", branch: "g1", session: "s1", attachment: "helper-a", body: "sim1",
    snapshot: String(seq), seq, source_time_ms: receiptTimeMs - 500, expires_at_ms: receiptTimeMs + 600_000, lineage_class: "CURRENT",
    percepts: [{ kind: "need", salience: 0.4, facts: { subject: "hunger", object: "low", urgency: "wake" } }],
    ...(portrait ? { portrait } : {}),
  };
  admitObservation(db, { observationId, digest: observationDigest(payload), world: "slot0", branch: "g1", session: "s1",
    attachment: "helper-a", body: "sim1", snapshot: String(seq), seq, sourceTimeMs: payload.source_time_ms,
    expiresAtMs: payload.expires_at_ms, receiptTimeMs, lineageClass: "CURRENT", payloadJson: JSON.stringify(payload) });
  return observationId;
}

function armedEvent(db: DatabaseSync, observationId: string) {
  configureEmbodimentBudget(db, { limit: 5, version: 1 });
  upsertHeartbeat(db, { helperSession: "helper-a", receivedAtMs: NOW - 1000, sentAtMs: NOW - 1000,
    json: JSON.stringify({ v: 1, helper_session: "helper-a", sent_at_ms: NOW - 1000, attached: true }) });
  const selected = selectDomusNotification(db, { observationId, conversationId: LANE, homeConversationId: HOME, ownerId: "owner",
    authorityEpoch: 1, nowMs: NOW, bind: () => undefined });
  if (selected.kind !== "selected") throw new Error(`not selected: ${selected.kind}`);
  return selected.event;
}

describe("DASK her contract", () => {
  const namespace = { allowedOperationalEffectRefs: [], fingerprint: "sha256:test" } as unknown as OperationalEffectNamespace;
  const fieldsOf = (profile: ReturnType<typeof thoughtContractProfile>) => Object.keys(
    (constrainThoughtOutputSchema(namespace, profile).schema as { oneOf: Array<{ properties: Record<string, unknown> }> }).oneOf[0]!.properties,
  );

  it("offers domusPromise only in an Owner's chat turn, and the settlement wherever her promises are shown", () => {
    const ownerChat = thoughtContractProfile({ trigger: { kind: "owner_message" }, audience: { kind: "owner_private" } });
    const ownerChatShowing = thoughtContractProfile({ trigger: { kind: "owner_message" }, audience: { kind: "owner_private" },
      domusNow: { promises: [PROMISE] } });
    const game = thoughtContractProfile({ trigger: { kind: "domus_notification" }, audience: { kind: "owner_private" }, domus: { promises: [PROMISE] } });
    const gameEmpty = thoughtContractProfile({ trigger: { kind: "domus_notification" }, audience: { kind: "owner_private" }, domus: {} });
    const social = thoughtContractProfile({ trigger: { kind: "owner_message" }, audience: { kind: "room" }, domusNow: { promises: [PROMISE] } });

    expect(ownerChat).toMatchObject({ pass: "chat", ownerPrivate: true, domusPromises: false });
    expect(ownerChatShowing.domusPromises).toBe(true);
    expect(game).toMatchObject({ pass: "domus", domusPromises: true });
    expect(gameEmpty.domusPromises).toBe(false);

    expect(fieldsOf(ownerChat)).toContain("domusPromise");
    expect(fieldsOf(ownerChat)).not.toContain("domusPromiseSettled");
    expect(fieldsOf(ownerChatShowing)).toEqual(expect.arrayContaining(["domusPromise", "domusPromiseSettled"]));
    expect(fieldsOf(game)).toContain("domusPromiseSettled");
    expect(fieldsOf(game)).not.toContain("domusPromise");
    expect(fieldsOf(gameEmpty)).not.toContain("domusPromiseSettled");
    expect(fieldsOf(social)).not.toContain("domusPromise");

    expect(thoughtOutputCompatibilityInstruction(ownerChat)).toContain(DOMUS_PROMISE_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(ownerChat)).not.toContain(DOMUS_PROMISE_SETTLE_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(game)).toContain(DOMUS_PROMISE_SETTLE_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(game)).not.toContain(DOMUS_PROMISE_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(gameEmpty)).not.toContain(DOMUS_PROMISE_SETTLE_GUIDANCE);
  });

  it("parses a promise of 1 to 120 characters once trimmed, and settlements of kept or let_go, and refuses anything else", () => {
    const settle = (fields: Record<string, unknown>) => parseThoughtSemanticOutput(JSON.stringify({
      kind: "settlement", speech: { mode: "none" }, journal: { activity: "think", entry: "I thought about the house." }, ...fields,
    }), new Set<string>());
    expect(settle({ domusPromise: { text: "I will wash up." } })).toMatchObject({ ok: true });
    expect(settle({ domusPromise: { text: "x".repeat(120) } })).toMatchObject({ ok: true });
    expect(settle({ domusPromiseSettled: [{ id: "p1", outcome: "kept" }, { id: "p2", outcome: "let_go" }] })).toMatchObject({ ok: true });
    expect(isDomusPromiseClaim({ text: "  Here.  " })).toBe(true);
    for (const bad of [{ text: "   " }, { text: "x".repeat(121) }, {}, { text: "a", why: "x" }, { text: 5 }, "a promise"]) {
      expect(settle({ domusPromise: bad })).toMatchObject({ ok: false });
    }
    for (const bad of [[], [{ id: "p1", outcome: "done" }], [{ id: "p1" }], [{ id: "p1", outcome: "kept", extra: 1 }],
      [1, 2, 3, 4].map(n => ({ id: `p${n}`, outcome: "kept" })), "kept"]) {
      expect(isDomusPromiseSettlements(bad)).toBe(false);
      expect(settle({ domusPromiseSettled: bad })).toMatchObject({ ok: false });
    }
  });
});

describe("DASK her promise is recorded once, by her Owner's turn, at settle time", () => {
  it("keeps the trimmed promise from an Owner turn, and nothing from a game pass or an unsolicited pass", () => {
    const db = openTestSidecar();
    try {
      expect(settlePass(db, { cycleId: "owner-turn", triggerKind: "owner_message", nowMs: NOW,
        settlement: { domusPromise: { text: "  I will go find someone to talk to.  " } }, context: { ownerChat: true, ownerTurn: true } })).toBe("recorded");
      expect(promiseRows(db)).toEqual([{ cycle_id: "owner-turn", text: "I will go find someone to talk to.", status: "open",
        created_at_ms: NOW, settled_at_ms: null }]);

      settlePass(db, { cycleId: "game-pass", triggerKind: "domus_notification", settlement: { domusPromise: { text: "Not from the game." } },
        context: { passKind: "private", channel: "domus:slot0", promisesShown: true } });
      settlePass(db, { cycleId: "idle-pass", triggerKind: "idle_opportunity", settlement: { domusPromise: { text: "Not unsolicited." } },
        context: { passKind: "private" } });
      expect(db.prepare("SELECT COUNT(*) AS n FROM domus_promises").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it("refuses a second promise in the same pass", () => {
    const db = openTestSidecar();
    try {
      expect(recordDomusPromise(db, { claim: { text: "First." }, cycleId: "same-pass", nowMs: NOW })).not.toBeNull();
      expect(recordDomusPromise(db, { claim: { text: "Second." }, cycleId: "same-pass", nowMs: NOW + 1 })).toBeNull();
      expect(db.prepare("SELECT COUNT(*) AS n FROM domus_promises").get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it("settles the promises she was shown in a game pass, and keeps her words of a quiet pass that settles one", () => {
    const db = openTestSidecar();
    try {
      const id = recordDomusPromise(db, { claim: { text: "I will go find someone." }, cycleId: "made", nowMs: NOW })!;
      settlePass(db, { cycleId: "quiet-kept", triggerKind: "domus_notification", nowMs: NOW + 10,
        settlement: { journal: { activity: "think", entry: "I found someone and kept it." }, domusPromiseSettled: [{ id, outcome: "kept" }] },
        context: { passKind: "private", channel: "domus:slot0", domusQuiet: true, promisesShown: true } });
      expect(db.prepare("SELECT status, settled_at_ms FROM domus_promises WHERE promise_id = ?").get(id))
        .toEqual({ status: "kept", settled_at_ms: NOW + 10 });
      expect(db.prepare("SELECT entry FROM activity_journal WHERE cycle_id = ?").get("quiet-kept"))
        .toEqual({ entry: "I found someone and kept it." });
    } finally {
      db.close();
    }
  });

  it("ignores a settlement in a pass that was not shown her promises", () => {
    const db = openTestSidecar();
    try {
      const id = recordDomusPromise(db, { claim: { text: "I will wash up." }, cycleId: "made-2", nowMs: NOW })!;
      settlePass(db, { cycleId: "not-shown", triggerKind: "domus_notification", settlement: { domusPromiseSettled: [{ id, outcome: "let_go" }] },
        context: { passKind: "private", channel: "domus:slot0" } });
      expect(db.prepare("SELECT status FROM domus_promises WHERE promise_id = ?").get(id)).toEqual({ status: "open" });
    } finally {
      db.close();
    }
  });
});

describe("DASK five open at most, and a day", () => {
  it("refuses a sixth open promise, logs why, and records nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = openTestSidecar();
    try {
      for (let index = 0; index < DOMUS_PROMISE_OPEN_MAX; index += 1) {
        expect(recordDomusPromise(db, { claim: { text: `Promise ${index}.` }, cycleId: `cap-${index}`, nowMs: NOW + index })).toEqual(expect.any(String));
      }
      expect(recordDomusPromise(db, { claim: { text: "One too many." }, cycleId: "cap-6", nowMs: NOW + 9 })).toBeNull();
      expect(log).toHaveBeenCalledWith("[domus] promise refused reason=too_many_open");
      expect(db.prepare("SELECT COUNT(*) AS n FROM domus_promises").get()).toEqual({ n: DOMUS_PROMISE_OPEN_MAX });
      expect(domusPromisesOpen(db, NOW + 10).map(item => item.text)).toEqual(
        Array.from({ length: DOMUS_PROMISE_OPEN_MAX }, (_, index) => `Promise ${index}.`),
      );
    } finally {
      db.close();
    }
  });

  it("expires an open promise older than a day when it is next read, and that frees its place", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const db = openTestSidecar();
    try {
      const id = recordDomusPromise(db, { claim: { text: "Go find someone." }, cycleId: "day-1", nowMs: NOW })!;
      expect(domusPromisesOpen(db, NOW + DOMUS_PROMISE_TTL_MS - 1).map(item => item.id)).toEqual([id]);
      expect(domusPromisesOpen(db, NOW + DOMUS_PROMISE_TTL_MS + 1)).toEqual([]);
      expect(db.prepare("SELECT status, settled_at_ms FROM domus_promises WHERE promise_id = ?").get(id))
        .toEqual({ status: "expired", settled_at_ms: NOW + DOMUS_PROMISE_TTL_MS + 1 });
      expect(settleDomusPromises(db, { settlements: [{ id, outcome: "kept" }], nowMs: NOW + DOMUS_PROMISE_TTL_MS + 2 })).toBe(0);

      for (let index = 0; index < DOMUS_PROMISE_OPEN_MAX; index += 1) {
        recordDomusPromise(db, { claim: { text: `Later ${index}.` }, cycleId: `later-${index}`, nowMs: NOW + DOMUS_PROMISE_TTL_MS + 3 });
      }
      expect(recordDomusPromise(db, { claim: { text: "Full again." }, cycleId: "later-full", nowMs: NOW + DOMUS_PROMISE_TTL_MS + 3 })).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("DASK settling", () => {
  it("settles an open promise kept or let go; an unknown or no longer open id changes nothing", () => {
    const db = openTestSidecar();
    try {
      const a = recordDomusPromise(db, { claim: { text: "A." }, cycleId: "s-a", nowMs: NOW })!;
      const b = recordDomusPromise(db, { claim: { text: "B." }, cycleId: "s-b", nowMs: NOW + 1 })!;
      expect(settleDomusPromises(db, { settlements: [{ id: a, outcome: "kept" }, { id: "no-such", outcome: "let_go" }, { id: b, outcome: "let_go" }],
        nowMs: NOW + 5 })).toBe(2);
      expect(promiseRows(db)).toEqual([
        { cycle_id: "s-a", text: "A.", status: "kept", created_at_ms: NOW, settled_at_ms: NOW + 5 },
        { cycle_id: "s-b", text: "B.", status: "let_go", created_at_ms: NOW + 1, settled_at_ms: NOW + 5 },
      ]);
      expect(settleDomusPromises(db, { settlements: [{ id: a, outcome: "let_go" }], nowMs: NOW + 6 })).toBe(0);
      expect(domusPromisesOpen(db, NOW + 6)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe("DASK her view", () => {
  it("a game pass reads her open promises, oldest first, with the time she made each, and none when there are none", () => {
    const db = openTestSidecar();
    try {
      const event = armedEvent(db, observe(db, 1));
      const first = recordDomusPromise(db, { claim: { text: "First: go find someone." }, cycleId: "v-a", nowMs: NOW - 5000 })!;
      const second = recordDomusPromise(db, { claim: { text: "Second: wash up." }, cycleId: "v-b", nowMs: NOW - 4000 })!;
      settleDomusPromises(db, { settlements: [{ id: first, outcome: "kept" }], nowMs: NOW - 3000 });
      expect(domusForThought(db, event, undefined, { enabled: false, nowMs: NOW }).promises).toEqual([
        { id: second, text: "Second: wash up.", since: new Date(NOW - 4000).toISOString() },
      ]);
      settleDomusPromises(db, { settlements: [{ id: second, outcome: "let_go" }], nowMs: NOW - 2000 });
      expect(domusForThought(db, event, undefined, { enabled: false, nowMs: NOW })).not.toHaveProperty("promises");
    } finally {
      db.close();
    }
  });

  it("her Owner turn reads them in domusNow, only when there are some, and the game-only input keeps them but no Owner words", () => {
    const db = openTestSidecar();
    try {
      observe(db, 1, { mood: "Happy" });
      expect(domusNowForThought(db, NOW)).not.toHaveProperty("promises");
      const id = recordDomusPromise(db, { claim: { text: "I will go find someone to talk to." }, cycleId: "shown", nowMs: NOW - 100 })!;
      expect(domusNowForThought(db, NOW)).toMatchObject({ promises: [{ id, text: "I will go find someone to talk to." }] });

      appendOwnerUtterance(db, { conversationId: HOME, text: "a private line from the Owner", discordMessageIds: ["m-1"], nowMs: NOW - 200 });
      const chat = admitTestCycle(db, { cycleId: "chat-turn", conversationId: HOME, triggerKind: "owner_message", triggerRef: "chat-turn",
        occupantId: "owner", nowMs: NOW });
      const chatInput = buildThoughtInput({ sidecar: db, cycle: chat, constitution, capabilityReality: noEngineering,
        learnedSelfSlice: { dispositions: [], interests: [] }, clock: { nowMs: NOW, timeZone: "UTC" } });
      expect(chatInput.domusNow?.promises).toEqual([{ id, text: "I will go find someone to talk to.", since: new Date(NOW - 100).toISOString() }]);
      expect(thoughtContractProfile(chatInput)).toMatchObject({ pass: "chat", domusPromises: true });

      const event = armedEvent(db, observe(db, 2));
      const game = admitTestCycle(db, { cycleId: "game-pass", conversationId: LANE, triggerKind: "domus_notification", triggerRef: "game",
        occupantId: "owner", nowMs: NOW });
      const gameInput = buildThoughtInput({ sidecar: db, cycle: game, constitution, capabilityReality: noEngineering,
        learnedSelfSlice: { dispositions: [], interests: [] }, triggerKindOverride: "domus_notification",
        domus: domusForThought(db, event, undefined, { enabled: false, nowMs: NOW }), homeConversationId: HOME, domusGameOnly: true,
        clock: { nowMs: NOW, timeZone: "UTC" } });
      expect(gameInput.rawConversation).toEqual([]);
      expect(gameInput.domus?.promises).toEqual([{ id, text: "I will go find someone to talk to.", since: new Date(NOW - 100).toISOString() }]);
      expect(thoughtContractProfile(gameInput)).toMatchObject({ pass: "domus", domusPromises: true });
      expect(JSON.stringify(gameInput)).not.toContain("a private line from the Owner");
    } finally {
      db.close();
    }
  });
});
