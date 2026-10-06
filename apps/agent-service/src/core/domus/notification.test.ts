import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { domus } from "../cognitive-v021/thalamus/nuclei/domus.js";
import { arbitrate } from "../cognitive-v021/thalamus/core.js";
import { runThalamusPass } from "../cognitive-v021/thalamus/integration.js";
import { admitObservation, observationDigest, upsertHeartbeat } from "./store.js";
import {
  armedAttachments, configureEmbodimentBudget, domusChannelFor, domusForThought, embodimentBudgetAvailable,
  pendingDomus, repairDomusReservations, selectDomusNotification, DOMUS_ARMED_MS, DOMUS_EVENTS_BYTES, EMBODIMENT_POLICY_ID,
  domusNowForThought, DOMUS_NOW_BYTES, DOMUS_NOW_WINDOW_MS,
} from "./notification.js";

const NOW = 10_000_000;
const CONVERSATION = "owner-thread";

function heartbeat(db: DatabaseSync, input: { session?: string; attached?: boolean; receivedAtMs?: number } = {}) {
  const session = input.session ?? "helper-a";
  upsertHeartbeat(db, { helperSession: session, receivedAtMs: input.receivedAtMs ?? NOW - 1000, sentAtMs: NOW - 1000,
    json: JSON.stringify({ v: 1, helper_session: session, sent_at_ms: NOW - 1000, attached: input.attached ?? true }) });
}

function observe(db: DatabaseSync, seq: number, input: {
  attachment?: string; world?: string; receiptTimeMs?: number; expiresAtMs?: number; urgency?: string; salience?: number;
  portrait?: Record<string, unknown>; facts?: Record<string, unknown>;
} = {}) {
  const attachment = input.attachment ?? "helper-a";
  const observationId = `${attachment}.${seq}`;
  const receiptTimeMs = input.receiptTimeMs ?? NOW - 60_000 + seq * 1000;
  const payload = {
    v: 1, observation_id: observationId, world: input.world ?? "slot0", branch: "g1", session: "s1", attachment,
    body: "sim1", snapshot: String(seq), seq, source_time_ms: receiptTimeMs - 500, expires_at_ms: input.expiresAtMs ?? receiptTimeMs + 600_000,
    lineage_class: "CURRENT",
    percepts: [{ kind: "need", salience: input.salience ?? 0.4, facts: { subject: "hunger", object: "low", urgency: input.urgency ?? "wake", ...input.facts } }],
    ...(input.portrait ? { portrait: input.portrait } : {}),
  };
  admitObservation(db, {
    observationId, digest: observationDigest(payload), world: payload.world, branch: "g1", session: "s1", attachment, body: "sim1",
    snapshot: String(seq), seq, sourceTimeMs: payload.source_time_ms, expiresAtMs: payload.expires_at_ms, receiptTimeMs,
    lineageClass: "CURRENT", payloadJson: JSON.stringify(payload),
  });
  return observationId;
}

function counts(db: DatabaseSync) {
  return {
    inbox: (db.prepare("SELECT count(*) AS n FROM inbox_events").get() as { n: number }).n,
    wakes: (db.prepare("SELECT count(*) AS n FROM wakes").get() as { n: number }).n,
    reservations: (db.prepare("SELECT count(*) AS n FROM private_budget_reservations").get() as { n: number }).n,
  };
}

function states(db: DatabaseSync) {
  return Object.fromEntries((db.prepare("SELECT observation_id, admission_state FROM domus_observations ORDER BY observation_id").all() as
    Array<{ observation_id: string; admission_state: string }>).map(row => [row.observation_id, row.admission_state]));
}

function select(db: DatabaseSync, observationId: string, bound: string[] = [], nowMs = NOW) {
  return selectDomusNotification(db, { observationId, conversationId: CONVERSATION, ownerId: "owner", authorityEpoch: 1, nowMs,
    bind: cycleId => { bound.push(cycleId); } });
}

describe("8d domus nucleus", () => {
  it("proposes one due candidate per attachment over its pending observations", () => {
    expect(domus([])).toEqual([]);
    const [candidate] = domus([{ attachment: "helper-a", observations: [
      { observationId: "a.1", receiptTimeMs: 10, salience: 0.2, alwaysThrough: false },
      { observationId: "a.2", receiptTimeMs: 20, salience: 0.7, alwaysThrough: false },
    ] }]);
    expect(candidate).toEqual({ eventId: "domus:a.2", observedAtMs: 20, deadlineMs: 20, refs: ["a.1", "a.2"], source: "domus",
      coalesceKey: "domus:helper-a", salience: 0.7, passType: "own_time", class: "PRESSURE" });
    expect(domus([{ attachment: "b", observations: [{ observationId: "b.1", receiptTimeMs: 5, salience: 0, alwaysThrough: true }] }])[0]!.class)
      .toBe("ALWAYS_THROUGH");
  });

  it("is never habituated or held by refractory", () => {
    const context = { budgetAvailable: true, conversationClaimHeld: false, spentFraction: 0, energy: 0.5, tension: 0, circadianPhase: 0 };
    let state = { lastNowMs: 0, families: {}, lastSelectedAtMs: {} };
    for (let index = 1; index <= 8; index++) {
      const candidates = domus([{ attachment: "a", observations: [{ observationId: `a.${index}`, receiptTimeMs: index * 1000, salience: 0.05, alwaysThrough: false }] }]);
      const result = arbitrate(state, candidates, index * 1000, context);
      expect(result.decision.kind).toBe("fire");
      state = result.state;
    }
  });

  it("waits while a conversation holds the lane, even when always-through", async () => {
    const db = openTestSidecar();
    try {
      const executor = async () => { throw new Error("must_not_run"); };
      const result = await runThalamusPass(db, { ownerId: "owner", conversationId: CONVERSATION, nowMs: NOW, enabled: true, facts: [],
        candidates: domus([{ attachment: "a", observations: [{ observationId: "a.9", receiptTimeMs: NOW - 10, salience: 1, alwaysThrough: true }] }]),
        context: { budgetAvailable: true, conversationClaimHeld: true, spentFraction: 0, energy: 0.5, tension: 0, circadianPhase: 0 },
        executors: { afterglow: executor, night: executor, awake: executor, idle: executor, domus: executor } });
      expect(result).toMatchObject({ kind: "evaluated", decision: { kind: "none", reason: "conversation" } });
    } finally { db.close(); }
  });

  it("routes a domus fire to its own executor with the newest observation id", async () => {
    const db = openTestSidecar();
    try {
      const seen: string[] = [];
      const executor = async () => { throw new Error("wrong_executor"); };
      const candidates = domus([{ attachment: "a", observations: [{ observationId: "a.3", receiptTimeMs: NOW - 10, salience: 0.5, alwaysThrough: false }] }]);
      await runThalamusPass(db, { ownerId: "owner", conversationId: CONVERSATION, nowMs: NOW, enabled: true, candidates, facts: [],
        context: { budgetAvailable: true, conversationClaimHeld: false, spentFraction: 0, energy: 0.5, tension: 0, circadianPhase: 0 },
        executors: { afterglow: executor, night: executor, awake: executor, idle: executor,
          domus: async observationId => { seen.push(observationId); } } });
      expect(seen).toEqual(["a.3"]);
    } finally { db.close(); }
  });
});

describe("8d pending Domus observations", () => {
  it("are armed only by a recent attached heartbeat", () => {
    const db = openTestSidecar();
    try {
      observe(db, 1);
      expect(pendingDomus(db, NOW)).toEqual([]);
      heartbeat(db, { attached: false });
      expect(pendingDomus(db, NOW)).toEqual([]);
      heartbeat(db, { receivedAtMs: NOW - DOMUS_ARMED_MS - 1 });
      expect(armedAttachments(db, NOW).size).toBe(0);
      heartbeat(db);
      expect(pendingDomus(db, NOW).map(item => item.attachment)).toEqual(["helper-a"]);
      expect(counts(db)).toEqual({ inbox: 0, wakes: 0, reservations: 0 });
    } finally { db.close(); }
  });

  it("leave out expired, undone and already admitted rows, keep the newest 32 in order and carry always-through", () => {
    const db = openTestSidecar();
    try {
      heartbeat(db);
      observe(db, 1, { expiresAtMs: NOW });
      observe(db, 2);
      db.prepare("UPDATE domus_observations SET undone_at_ms=1 WHERE observation_id='helper-a.2'").run();
      observe(db, 3);
      db.prepare("UPDATE domus_observations SET admission_state='admitted' WHERE observation_id='helper-a.3'").run();
      for (let seq = 4; seq <= 40; seq++) observe(db, seq, { urgency: seq === 39 ? "always_through" : "wake", salience: seq / 100 });
      const [pending] = pendingDomus(db, NOW);
      expect(pending!.observations.map(item => item.observationId)).toEqual(
        Array.from({ length: 32 }, (_, index) => `helper-a.${index + 9}`));
      expect(pending!.observations.find(item => item.observationId === "helper-a.39")!.alwaysThrough).toBe(true);
      expect(pending!.observations.at(-1)!.salience).toBe(0.4);
    } finally { db.close(); }
  });
});

describe("8d undone observations", () => {
  it("are never pending, so a reload never wakes her for an abandoned timeline", () => {
    const db = openTestSidecar();
    try {
      heartbeat(db);
      const undone = observe(db, 1);
      const kept = observe(db, 2);
      db.prepare("UPDATE domus_observations SET undone_at_ms=1 WHERE observation_id=?").run(undone);
      expect(pendingDomus(db, NOW)[0]!.observations.map(item => item.observationId)).toEqual([kept]);
    } finally { db.close(); }
  });
});

describe("8d Domus selection", () => {
  it("defers without an embodiment budget and writes nothing", () => {
    const db = openTestSidecar();
    try {
      heartbeat(db);
      const id = observe(db, 1);
      expect(embodimentBudgetAvailable(db, NOW)).toBe(false);
      expect(select(db, id).kind).toBe("deferred");
      expect(counts(db)).toEqual({ inbox: 0, wakes: 0, reservations: 0 });
      expect(states(db)).toEqual({ [id]: "stored" });
    } finally { db.close(); }
  });

  it("stops new work once disarmed", () => {
    const db = openTestSidecar();
    try {
      configureEmbodimentBudget(db, { limit: 5, version: 1 });
      heartbeat(db, { attached: false });
      const id = observe(db, 1);
      expect(select(db, id).kind).toBe("disarmed");
      expect(counts(db)).toEqual({ inbox: 0, wakes: 0, reservations: 0 });
    } finally { db.close(); }
  });

  it("admits the pending rows, drops older leftovers, binds the cycle and pays from the embodiment budget", () => {
    const db = openTestSidecar();
    try {
      configureEmbodimentBudget(db, { limit: 1, version: 1 });
      heartbeat(db);
      const ids = Array.from({ length: 34 }, (_, index) => observe(db, index + 1));
      const later = observe(db, 35, { receiptTimeMs: NOW + 5 });
      const bound: string[] = [];
      const selected = select(db, ids.at(-1)!, bound);
      expect(selected.kind).toBe("selected");
      if (selected.kind !== "selected") return;
      expect(selected.event.kind).toBe("domus_notification");
      expect(bound).toEqual([String((selected.event.payload as Record<string, unknown>).cycleId)]);
      const cycle = db.prepare("SELECT trigger_kind, occupant_id FROM cycle_records WHERE cycle_id=?").get(bound[0]!);
      expect(cycle).toEqual({ trigger_kind: "domus_notification", occupant_id: "owner" });
      const after = states(db);
      expect(ids.slice(0, 2).map(id => after[id])).toEqual(["dropped", "dropped"]);
      expect(ids.slice(2).every(id => after[id] === "admitted")).toBe(true);
      expect(after[later]).toBe("stored");
      expect((selected.event.payload as { domus: { observationIds: string[] } }).domus.observationIds).toEqual(ids.slice(2));
      expect(db.prepare("SELECT policy_id FROM private_budget_reservations").all()).toEqual([{ policy_id: EMBODIMENT_POLICY_ID }]);
      expect(db.prepare("SELECT next_eligible_at_ms FROM inbox_events").get()).toEqual({ next_eligible_at_ms: null });
      expect(embodimentBudgetAvailable(db, NOW)).toBe(false);
      expect(select(db, ids.at(-1)!).kind).toBe("existing");
      expect(counts(db).inbox).toBe(1);
    } finally { db.close(); }
  });

  it("retries a reservation that did not land without admitting the rows again", () => {
    const db = openTestSidecar();
    try {
      configureEmbodimentBudget(db, { limit: 2, version: 1 });
      heartbeat(db);
      const id = observe(db, 1);
      const selected = select(db, id);
      if (selected.kind !== "selected") throw new Error("not selected");
      db.prepare("DELETE FROM private_budget_reservations").run();
      db.prepare("UPDATE inbox_events SET next_eligible_at_ms=?").run(Number.MAX_SAFE_INTEGER);
      expect(repairDomusReservations(db, { conversationId: CONVERSATION, nowMs: NOW })).toBe(1);
      expect(db.prepare("SELECT next_eligible_at_ms FROM inbox_events").get()).toEqual({ next_eligible_at_ms: null });
      expect(counts(db)).toEqual({ inbox: 1, wakes: 1, reservations: 1 });
    } finally { db.close(); }
  });
});

describe("8d ThoughtInput.domus", () => {
  function selectedEvent(db: DatabaseSync, ids: string[]) {
    configureEmbodimentBudget(db, { limit: 5, version: 1 });
    heartbeat(db);
    const selected = select(db, ids.at(-1)!);
    if (selected.kind !== "selected") throw new Error("not selected");
    return selected.event;
  }

  it("rebuilds the portrait and the events from the durable rows, newest portrait, oldest event first", () => {
    const db = openTestSidecar();
    try {
      const ids = [observe(db, 1, { portrait: { mood: "Fine" } }), observe(db, 2, { portrait: { mood: "Happy" } }), observe(db, 3)];
      const event = selectedEvent(db, ids);
      const view = domusForThought(db, event);
      expect(view).toMatchObject({ world: "slot0", observationIds: ids, portrait: { mood: "Happy" } });
      expect(view.asOfMs).toBe(NOW - 60_000 + 3000 - 500);
      expect(view.events.map(item => item.observationId)).toEqual(ids);
      expect(view.events[0]).toEqual({ observationId: ids[0], atMs: NOW - 60_000 + 500, kind: "need",
        facts: { subject: "hunger", object: "low", urgency: "wake" } });
      expect(view.omittedEvents).toBeUndefined();
      expect(domusChannelFor(db, event)).toEqual({ channel: "domus:slot0" });
    } finally { db.close(); }
  });

  it("leaves out rows undone after admission and older events past the byte budget", () => {
    const db = openTestSidecar();
    try {
      const ids = Array.from({ length: 6 }, (_, index) => observe(db, index + 1, { facts: { text: "x".repeat(900) } }));
      const event = selectedEvent(db, ids);
      db.prepare("UPDATE domus_observations SET undone_at_ms=1 WHERE observation_id=?").run(ids[5]!);
      const view = domusForThought(db, event);
      expect(view.observationIds).toEqual(ids.slice(0, 5));
      expect(Buffer.byteLength(JSON.stringify(view.events))).toBeLessThanOrEqual(DOMUS_EVENTS_BYTES);
      expect(view.events.at(-1)!.observationId).toBe(ids[4]);
      expect(view.events.length + (view.omittedEvents ?? 0)).toBe(5);
      expect(view.omittedEvents).toBeGreaterThan(0);
    } finally { db.close(); }
  });

  it("refuses an event that is not a Domus notification", () => {
    const db = openTestSidecar();
    try {
      expect(() => domusForThought(db, { id: "missing", conversationId: CONVERSATION })).toThrow("domus_notification_missing");
      expect(domusChannelFor(db, { id: "missing", conversationId: CONVERSATION })).toEqual({});
    } finally { db.close(); }
  });
});

describe("8d Domus journal channel", () => {
  it("records a Domus pass's journal entry on its world's channel", async () => {
    const { recordAftermathPending, recordSettlementAftermath } = await import("../cognitive-v021/thought/aftermath.js");
    const { listRecentJournal } = await import("../cognitive-v021/initiative/journal.js");
    const { admitTestCycle } = await import("../cognitive-v021/test-support.js");
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "domus-cycle", conversationId: CONVERSATION, occupantId: "owner", generation: 1,
        triggerKind: "domus_notification", triggerRef: "domus-notification:x", nowMs: NOW });
      db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,?)")
        .run("domus-settlement", "domus-cycle", JSON.stringify({ sawSecret: false, journal: { activity: "think", entry: "Travis came over." } }));
      recordAftermathPending(db, { settlementId: "domus-settlement", cycleId: "domus-cycle", nowMs: NOW,
        context: { conversationId: CONVERSATION, ownerPrivate: true, passKind: "private", channel: "domus:slot0", nightPass: null } });
      expect(recordSettlementAftermath(db, "domus-settlement", { identityStore: null, timeZone: "UTC", nowMs: NOW })).toBe("recorded");
      expect(listRecentJournal(db, { limit: 1 })[0]).toMatchObject({ cycleId: "domus-cycle", channel: "domus:slot0", entry: "Travis came over." });
    } finally { db.close(); }
  });
});

describe("M5 domusNow: her body in the game, outside a Domus pass", () => {
  const portrait = {
    time: { weekday: "Monday", hour: 16, minute: 5 }, place: { her_home: true, venue: "venue_residential" },
    mood: "Mood_Uncomfortable", paused: false, posture: "standExclusive",
    needs: { hunger: { band: "distress", value: 15 }, energy: { band: "ok", value: 83 } },
    moodlets: [{ text: "Hungry", name: "Buff_Motives_Hunger_Hungry" }, { text: "Lonely" }],
    running: ["si_Career_Culinary", "standingExclusive"], company: [{ name: "Don Lothario", relationship: {} }],
    self: { traits: ["Foodie"], skills: [], funds: 25000, jobs: [{ job: "Culinary", title: "Dishwasher", level: 1, at_work: true }] },
    asked: [{ dialog_id: "3", title: "Dish Undercooked!", text: "long text", choices: [] }],
  };

  it("carries the newest portrait, compact, and whether the game is running now", () => {
    const db = openTestSidecar();
    observe(db, 1, { portrait: { ...portrait, mood: "Mood_Happy" } });
    observe(db, 2, { portrait });
    heartbeat(db);
    const now = domusNowForThought(db, NOW)!;
    expect(now).toMatchObject({ world: "slot0", live: true });
    expect(now.body).toEqual({
      time: portrait.time, place: portrait.place, mood: "Mood_Uncomfortable", paused: false,
      needs: { hunger: "distress", energy: "ok" }, feelings: ["Hungry", "Lonely"],
      doing: ["si_Career_Culinary", "standingExclusive"], with: ["Don Lothario"],
      jobs: [{ job: "Culinary", title: "Dishwasher", level: 1, at_work: true }], asked: ["Dish Undercooked!"],
    });
    expect(Buffer.byteLength(JSON.stringify(now.body))).toBeLessThanOrEqual(DOMUS_NOW_BYTES);
  });

  it("is not live without an attached helper, and absent after the window or when undone", () => {
    const db = openTestSidecar();
    observe(db, 1, { portrait });
    expect(domusNowForThought(db, NOW)!.live).toBe(false);
    expect(domusNowForThought(db, NOW + DOMUS_NOW_WINDOW_MS)).toBeUndefined();
    db.prepare("UPDATE domus_observations SET undone_at_ms = ?").run(NOW);
    expect(domusNowForThought(db, NOW)).toBeUndefined();
  });
});

describe("H0.4 Domus changes and quiet check-ins", () => {
  const body = (hunger: string) => ({ mood: "Calm", needs: { hunger: { value: 40, band: hunger } }, time: { hour: 1 } });

  function pass(db: DatabaseSync, ids: string[], settle: boolean) {
    configureEmbodimentBudget(db, { limit: 10, version: 1 });
    heartbeat(db);
    const selected = select(db, ids.at(-1)!);
    if (selected.kind !== "selected") throw new Error("not selected");
    if (settle) {
      const cycleId = String((selected.event.payload as { cycleId: string }).cycleId);
      db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,'{}')").run(`s-${cycleId}`, cycleId);
    }
    return selected.event;
  }

  it("a first pass is new; a later one is compared with the pass she last settled", () => {
    const db = openTestSidecar();
    try {
      const first = domusForThought(db, pass(db, [observe(db, 1, { portrait: body("ok") })], true));
      expect(first.changes).toEqual({ first: true });
      const quiet = domusForThought(db, pass(db, [observe(db, 2, { portrait: { ...body("ok"), time: { hour: 2 } } })], true));
      expect(quiet.changes).toMatchObject({ quiet: true, sinceMs: first.asOfMs });
      const moved = domusForThought(db, pass(db, [observe(db, 3, { portrait: body("low") })], false));
      expect(moved.changes).toMatchObject({ sinceMs: quiet.asOfMs, needs: { hunger: "ok → low" } });
      // Pass 3 never settled, so she never read it: pass 4 is still compared with pass 2.
      const next = domusForThought(db, pass(db, [observe(db, 4, { portrait: body("low") })], true));
      expect(next.changes).toMatchObject({ sinceMs: quiet.asOfMs, needs: { hunger: "ok → low" } });
    } finally { db.close(); }
  });

  it("a new game session starts over", () => {
    const db = openTestSidecar();
    try {
      domusForThought(db, pass(db, [observe(db, 1, { portrait: body("ok") })], true));
      heartbeat(db, { session: "helper-b" });
      configureEmbodimentBudget(db, { limit: 10, version: 1 });
      const id = observe(db, 2, { attachment: "helper-b", portrait: body("ok") });
      const selected = select(db, id);
      if (selected.kind !== "selected") throw new Error("not selected");
      expect(domusForThought(db, selected.event).changes).toEqual({ first: true });
    } finally { db.close(); }
  });

  it("a quiet pass in which she neither acts nor speaks keeps no journal words", async () => {
    const { recordAftermathPending, recordSettlementAftermath } = await import("../cognitive-v021/thought/aftermath.js");
    const { listRecentJournal } = await import("../cognitive-v021/initiative/journal.js");
    const { admitTestCycle } = await import("../cognitive-v021/test-support.js");
    const db = openTestSidecar();
    try {
      const settle = (cycleId: string, payload: Record<string, unknown>, quiet: boolean) => {
        admitTestCycle(db, { cycleId, conversationId: CONVERSATION, occupantId: "owner", generation: 1,
          triggerKind: "domus_notification", triggerRef: `domus-notification:${cycleId}`, nowMs: NOW });
        db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,?)")
          .run(`s-${cycleId}`, cycleId, JSON.stringify({ sawSecret: false, journal: { activity: "think", entry: "Still standing here." }, ...payload }));
        recordAftermathPending(db, { settlementId: `s-${cycleId}`, cycleId, nowMs: NOW, context: { conversationId: CONVERSATION, ownerPrivate: true,
          passKind: "private", channel: "domus:slot0", nightPass: null, ...(quiet ? { domusQuiet: true as const } : {}) } });
        recordSettlementAftermath(db, `s-${cycleId}`, { identityStore: null, timeZone: "UTC", nowMs: NOW });
        return listRecentJournal(db, { limit: 10 }).find(entry => entry.cycleId === cycleId);
      };
      expect(settle("quiet", {}, true)).toMatchObject({ entry: null, activity: null, channel: "domus:slot0" });
      expect(settle("acted", { domusAct: { option: "a1" } }, true)).toMatchObject({ entry: "Still standing here." });
      expect(settle("changed", {}, false)).toMatchObject({ entry: "Still standing here." });
    } finally { db.close(); }
  });
});
