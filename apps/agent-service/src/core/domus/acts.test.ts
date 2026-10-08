import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openTestSidecar } from "../cognitive-v021/test-support.js";
import { admitObservation, observationDigest } from "./store.js";
import {
  domusActBinding, domusNoWayObjects, interruptDomusPlans, isDomusActClaim, optionsOf, recentDomusActs, recordDomusAct, syncDomusActs,
  DOMUS_ACT_TTL_MS, DOMUS_OWNER_OPEN_MS, type DomusActClaim, type DomusOptionObject,
} from "./acts.js";
import { parseActSync, parseObservation } from "./ingress.js";
import { domusForThought, domusLiveForOwner, DOMUS_LIVE_OPTIONS_MS } from "./notification.js";
import { upsertHeartbeat } from "./store.js";
import { withoutUnansweredOwnerRows } from "../cognitive-v021/thought/input.js";
import { appendInboxEvent } from "../cognitive-v021/cycle/inbox.js";
import { thoughtContractProfile, thoughtContractProfileKey, thoughtOutputCompatibilityInstruction, DOMUS_ACT_GUIDANCE, DOMUS_OBSERVE_GUIDANCE } from "../cognitive-v021/thought/output-contract.js";
import { parseThoughtSemanticOutput } from "../cognitive-v021/thought/parse.js";

const NOW = 50_000_000;
const OPTIONS: DomusOptionObject[] = [
  { object: "Bookshelf", object_id: "1001", where: "same room, 2.0 m", acts: [{ ref: "a1", guid64: "13001", text: "Read a Book" }] },
  { object: "Guitar", object_id: "1002", acts: [{ ref: "a2", guid64: "14001", text: "Practice" }, { ref: "a3", guid64: "14002", text: "Play for Tips" }] },
];

function observe(db: DatabaseSync, seq: number, input: { world?: string; attachment?: string; options?: unknown; admitted?: boolean; undone?: boolean } = {}) {
  const attachment = input.attachment ?? "helper-a";
  const observationId = `${attachment}.${seq}`;
  const payload = {
    v: 1, observation_id: observationId, world: input.world ?? "slot8", branch: "g", session: "s", attachment, body: "b",
    snapshot: String(seq), seq, source_time_ms: NOW - 10_000 + seq, expires_at_ms: NOW + 600_000, lineage_class: "CURRENT",
    percepts: [{ kind: "need", salience: 0.4, facts: { subject: "fun" } }],
    ...(input.options === undefined ? {} : { options: input.options }),
  };
  admitObservation(db, { observationId, digest: observationDigest(payload), world: payload.world, branch: "g", session: "s", attachment,
    body: "b", snapshot: String(seq), seq, sourceTimeMs: payload.source_time_ms, expiresAtMs: payload.expires_at_ms,
    receiptTimeMs: NOW - 9_000 + seq, lineageClass: "CURRENT", payloadJson: JSON.stringify(payload) });
  if (input.admitted !== false) db.prepare("UPDATE domus_observations SET admission_state='admitted' WHERE observation_id=?").run(observationId);
  if (input.undone) db.prepare("UPDATE domus_observations SET undone_at_ms=? WHERE observation_id=?").run(NOW, observationId);
  return observationId;
}

function act(db: DatabaseSync, option: string, cycleId = "cycle-1", nowMs = NOW, then?: string[]) {
  observe(db, 1, { options: OPTIONS });
  const binding = domusActBinding(db, { world: "slot8", observationIds: ["helper-a.1"] })!;
  const claim: DomusActClaim = then ? { option, then } : { option };
  return recordDomusAct(db, { binding, claim, cycleId, nowMs });
}

function row(db: DatabaseSync, actId: string) {
  return db.prepare("SELECT * FROM domus_acts WHERE act_id=?").get(actId) as Record<string, unknown>;
}

describe("8f the options she reads", () => {
  it("are read only from a well-formed options array", () => {
    expect(optionsOf(JSON.stringify({ options: OPTIONS }))).toEqual(OPTIONS);
    expect(optionsOf(JSON.stringify({ options: [{ object: "x" }] }))).toEqual([]);
    expect(optionsOf("{")).toEqual([]);
    expect(optionsOf(JSON.stringify({}))).toEqual([]);
  });

  it("bind to the newest admitted row of the pass that offered any, in its world", () => {
    const db = openTestSidecar();
    observe(db, 1, { options: OPTIONS });
    observe(db, 2, {});
    observe(db, 3, { options: OPTIONS, world: "slot0" });
    observe(db, 4, { options: OPTIONS, undone: true });
    observe(db, 5, { options: OPTIONS, admitted: false });
    const ids = ["helper-a.1", "helper-a.2", "helper-a.3", "helper-a.4", "helper-a.5"];
    expect(domusActBinding(db, { world: "slot8", observationIds: ids })).toEqual({ world: "slot8", attachment: "helper-a", observationId: "helper-a.1" });
    expect(domusActBinding(db, { world: "slot8", observationIds: ["helper-a.2"] })).toBeUndefined();
  });
});

describe("8f her choice", () => {
  it("is kept exactly as listed, once per cycle", () => {
    const db = openTestSidecar();
    const first = act(db, "a3");
    expect(first.state).toBe("requested");
    expect(row(db, first.actId)).toMatchObject({ object_id: "1002", guid64: "14002", label: "Play for Tips (Guitar)", state: "requested",
      attachment: "helper-a", world: "slot8", option_ref: "a3", expires_at_ms: NOW + DOMUS_ACT_TTL_MS });
    const again = recordDomusAct(db, { binding: { world: "slot8", attachment: "helper-a", observationId: "helper-a.1" }, claim: { option: "a1" }, cycleId: "cycle-1", nowMs: NOW });
    expect(again).toEqual(first);
    expect((db.prepare("SELECT count(*) AS n FROM domus_acts").get() as { n: number }).n).toBe(1);
  });

  it("that is not on the list is invalid, never guessed", () => {
    const db = openTestSidecar();
    const result = act(db, "a9");
    expect(result.state).toBe("invalid");
    expect(row(db, result.actId)).toMatchObject({ object_id: null, guid64: null, state: "invalid" });
    expect(syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts).toEqual([]);
  });
});

describe("8f the helper round trip", () => {
  it("returns her requested acts to her own helper only, until it reports them", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1");
    expect(syncDomusActs(db, { helperSession: "helper-b", events: [], nowMs: NOW }).acts).toEqual([]);
    expect(syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts)
      .toEqual([{ act_id: actId, object_id: "1001", guid64: "13001", expires_at_ms: NOW + DOMUS_ACT_TTL_MS }]);
    // Another helper's report about her act changes nothing.
    expect(syncDomusActs(db, { helperSession: "helper-b", events: [{ actId, phase: "received", atMs: NOW }], nowMs: NOW }).applied).toBe(0);
    const result = syncDomusActs(db, { helperSession: "helper-a", events: [{ actId, phase: "received", atMs: NOW }], nowMs: NOW + 1 });
    expect(result).toEqual({ acts: [], applied: 1, planned: 0 });
    expect(row(db, actId).state).toBe("received");
  });

  it("makes an act still in flight from an ended session unknown once another session syncs", () => {
    // Live 2026-10-06: a meal pushed in one session never finished; the next day she still waited for it.
    const db = openTestSidecar();
    const { actId } = act(db, "a1");
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId, phase: "pushed", atMs: NOW }], nowMs: NOW + 1 });
    expect(row(db, actId).state).toBe("pushed");
    syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW + 2 });
    expect(row(db, actId).state).toBe("pushed");
    syncDomusActs(db, { helperSession: "helper-b", events: [], nowMs: NOW + 3 });
    expect(row(db, actId).state).toBe("unknown");
    const detail = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = 'unknown'").get(actId) as { detail_json: string };
    expect(JSON.parse(detail.detail_json)).toEqual({ code: "SESSION_ENDED" });
  });

  it("keeps every event once, never moves back, and never overwrites a terminal state", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1");
    const sync = (phase: "received" | "accepted" | "pushed" | "finished" | "unknown", detail?: Record<string, unknown>) =>
      syncDomusActs(db, { helperSession: "helper-a", events: [{ actId, phase, atMs: NOW, ...(detail ? { detail } : {}) }], nowMs: NOW + 1 });
    sync("accepted");
    expect(sync("received").applied).toBe(1);
    expect(row(db, actId).state).toBe("accepted");
    expect(sync("accepted").applied).toBe(0);
    sync("unknown", { reason: "no_reply" });
    sync("finished", { finishing_type: "NATURAL" });
    expect(row(db, actId).state).toBe("unknown");
    expect((db.prepare("SELECT phase FROM domus_act_events WHERE act_id=? ORDER BY rowid").all(actId) as Array<{ phase: string }>).map(item => item.phase))
      .toEqual(["accepted", "received", "unknown", "finished"]);
  });

  it("expires an act its helper never picked up; the game never sees it", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1");
    expect(syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW + DOMUS_ACT_TTL_MS }).acts).toEqual([]);
    expect(row(db, actId).state).toBe("expired");
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId, phase: "received", atMs: NOW }], nowMs: NOW + DOMUS_ACT_TTL_MS + 1 });
    expect(row(db, actId).state).toBe("expired");
  });
});

describe("H0.5 her short plans", () => {
  const sync = (db: DatabaseSync, events: Array<{ actId: string; phase: "pushed" | "finished" | "rejected"; detail?: Record<string, unknown> }>, nowMs: number, helperSession = "helper-a") =>
    syncDomusActs(db, { helperSession, events: events.map(item => ({ ...item, atMs: nowMs })), nowMs });

  it("runs a plan of three end to end: each step starts when the one before completed", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1", "cycle-1", NOW, ["a2", "a3"]);
    const done = { finishing_type: "NATURAL" };
    const first = sync(db, [], NOW + 1);
    expect(first.acts.map(item => item.act_id)).toEqual([actId]);
    expect(first.planned).toBe(2);
    expect(sync(db, [{ actId, phase: "pushed" }], NOW + 2)).toMatchObject({ acts: [], planned: 2 });
    const second = sync(db, [{ actId, phase: "finished", detail: done }], NOW + 3);
    expect(second.acts.map(item => [item.object_id, item.guid64])).toEqual([["1002", "14001"]]);
    expect(second.planned).toBe(1);
    const third = sync(db, [{ actId: second.acts[0]!.act_id, phase: "finished", detail: done }], NOW + 4);
    expect(third.acts.map(item => item.guid64)).toEqual(["14002"]);
    expect(third.planned).toBe(0);
    sync(db, [{ actId: third.acts[0]!.act_id, phase: "finished", detail: done }], NOW + 5);
    expect(recentDomusActs(db, "slot8", NOW + 6).map(item => [item.option, item.state])).toEqual([["a1", "finished"], ["a2", "finished"], ["a3", "finished"]]);
  });

  it("drops the rest of a plan when the game cuts the first act short, and requests nothing", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1", "cycle-1", NOW, ["a2", "a3"]);
    sync(db, [], NOW + 1);
    const result = sync(db, [{ actId, phase: "finished", detail: { finishing_type: "FinishingType.INTERACTION_INCOMPATIBILITY" } }], NOW + 2);
    expect(result).toMatchObject({ acts: [], planned: 0 });
    const recent = recentDomusActs(db, "slot8", NOW + 3);
    expect(recent.map(item => [item.option, item.state, item.detail?.reason])).toEqual([
      ["a1", "finished", undefined], ["a2", "dropped", "after_cut_short"], ["a3", "dropped", "after_cut_short"]]);
    const stored = db.prepare("SELECT detail_json FROM domus_act_events WHERE act_id = ? AND phase = 'finished'").get(actId) as { detail_json: string };
    expect(JSON.parse(stored.detail_json)).toEqual({ finishing_type: "FinishingType.INTERACTION_INCOMPATIBILITY" });
  });

  it("releases the next step when the first act completed, and when it opened or answered the game's question", () => {
    for (const finishing_type of ["NATURAL", "ASKED", "ANSWERED"]) {
      const db = openTestSidecar();
      const { actId } = act(db, "a1", "cycle-1", NOW, ["a2"]);
      sync(db, [], NOW + 1);
      const released = sync(db, [{ actId, phase: "finished", detail: { finishing_type } }], NOW + 2);
      expect(released.acts.map(item => item.guid64)).toEqual(["14001"]);
      expect(released.planned).toBe(0);
    }
  });

  it("treats a finished act with no ending as cut short and ends the plan", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1", "cycle-1", NOW, ["a2", "a3"]);
    sync(db, [], NOW + 1);
    expect(sync(db, [{ actId, phase: "finished" }], NOW + 2)).toMatchObject({ acts: [], planned: 0 });
    expect(recentDomusActs(db, "slot8", NOW + 3).map(item => [item.option, item.state, item.detail?.reason])).toEqual([
      ["a1", "finished", undefined], ["a2", "dropped", "after_cut_short"], ["a3", "dropped", "after_cut_short"]]);
  });

  it("ends a plan where the game refused a step, and shows her why", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1", "cycle-1", NOW, ["a2", "a3"]);
    sync(db, [], NOW + 1);
    expect(sync(db, [{ actId, phase: "rejected" }], NOW + 2)).toMatchObject({ acts: [], planned: 0 });
    expect(recentDomusActs(db, "slot8", NOW + 3).map(item => [item.option, item.state, item.detail?.reason])).toEqual([
      ["a1", "rejected", undefined], ["a2", "dropped", "after_rejected"], ["a3", "dropped", "after_dropped"]]);
  });

  it("drops the rest when something new wakes her mid-plan (a visitor), but not for her own idle or a slow check", () => {
    const db = openTestSidecar();
    const { actId } = act(db, "a1", "cycle-1", NOW, ["a2", "a3"]);
    sync(db, [], NOW + 1);
    const idle = { kind: "interaction", salience: 0.5, facts: { urgency: "wake", bucket: "idle" } };
    const check = { kind: "env", salience: 0.1, facts: { urgency: "normal", object: "check", bucket: "busy" } };
    const mood = { kind: "moodlet", salience: 0.4, facts: { urgency: "wake", subject: "mood", bucket: "Mood_Happy" } };
    expect(interruptDomusPlans(db, { attachment: "helper-a", percepts: [idle, check, mood], nowMs: NOW + 2 })).toBe(0);
    expect(interruptDomusPlans(db, { attachment: "helper-b", percepts: [{ kind: "presence", salience: 1, facts: { urgency: "wake", bucket: "on_lot" } }], nowMs: NOW + 2 })).toBe(0);
    const visitor = { kind: "presence", salience: 1, facts: { urgency: "wake", bucket: "on_lot", name: "Summer" } };
    expect(interruptDomusPlans(db, { attachment: "helper-a", percepts: [idle, visitor], nowMs: NOW + 3 })).toBe(2);
    expect(sync(db, [{ actId, phase: "finished" }], NOW + 4)).toMatchObject({ acts: [], planned: 0 });
    expect(recentDomusActs(db, "slot8", NOW + 5).slice(1).map(item => [item.state, item.detail?.reason])).toEqual([
      ["dropped", "woken_by:presence:on_lot"], ["dropped", "woken_by:presence:on_lot"]]);
  });

  it("lets a new choice replace what still waited, and a session that ended drop it", () => {
    const db = openTestSidecar();
    act(db, "a1", "cycle-1", NOW, ["a2"]);
    act(db, "a3", "cycle-2", NOW + 10);
    expect(recentDomusActs(db, "slot8", NOW + 20).map(item => [item.option, item.state, item.detail?.reason]))
      .toEqual([["a1", "requested", undefined], ["a3", "requested", undefined], ["a2", "dropped", "replaced"]]);
    const db2 = openTestSidecar();
    act(db2, "a1", "cycle-1", NOW, ["a2"]);
    expect(sync(db2, [], NOW + 1, "helper-b").planned).toBe(0);
    expect(recentDomusActs(db2, "slot8", NOW + 2).at(-1)).toMatchObject({ option: "a2", state: "dropped", detail: { reason: "session_ended" } });
  });

  it("keeps a step that is not on the list invalid and lets the rest go; a plan never guesses", () => {
    const db = openTestSidecar();
    act(db, "a1", "cycle-1", NOW, ["a9", "a2"]);
    expect(recentDomusActs(db, "slot8", NOW + 1).map(item => [item.option, item.state])).toEqual([["a1", "requested"], ["a9", "invalid"], ["a2", "dropped"]]);
    const db2 = openTestSidecar();
    act(db2, "a9", "cycle-1", NOW, ["a1"]);
    expect(recentDomusActs(db2, "slot8", NOW + 1).map(item => [item.option, item.state])).toEqual([["a9", "invalid"], ["a1", "dropped"]]);
  });

  it("validates the plan claim", () => {
    expect(isDomusActClaim({ option: "a1", then: ["a2", "a3"] })).toBe(true);
    expect(isDomusActClaim({ option: "a1", then: [] })).toBe(false);
    expect(isDomusActClaim({ option: "a1", then: ["a2", "a3", "a4"] })).toBe(false);
    expect(isDomusActClaim({ option: "a1", then: ["bad ref"] })).toBe(false);
    expect(isDomusActClaim({ option: "a1", next: ["a2"] })).toBe(false);
  });
});

describe("8f what she reads back", () => {
  it("lists her recent acts in this world with the latest detail", () => {
    const db = openTestSidecar();
    const first = act(db, "a1", "cycle-1", NOW - 5000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: first.actId, phase: "rejected", atMs: NOW, detail: { reason: "BODY_UNAVAILABLE" } }], nowMs: NOW });
    act(db, "a9", "cycle-2", NOW - 1000);
    const recent = recentDomusActs(db, "slot8", NOW);
    expect(recent.map(item => [item.option, item.state])).toEqual([["a1", "rejected"], ["a9", "invalid"]]);
    expect(recent[0]!.detail).toEqual({ reason: "BODY_UNAVAILABLE" });
    expect(recentDomusActs(db, "slot0", NOW)).toEqual([]);
  });

  it("shows a finished act as completed or cut short, and not the raw finishing type", () => {
    const db = openTestSidecar();
    const cut = act(db, "a1", "cycle-1", NOW - 2000);
    const done = act(db, "a2", "cycle-2", NOW - 1000);
    syncDomusActs(db, { helperSession: "helper-a", events: [
      { actId: cut.actId, phase: "finished", atMs: NOW, detail: { finishing_type: "INTERACTION_INCOMPATIBILITY", interaction_id: "kept" } },
      { actId: done.actId, phase: "finished", atMs: NOW, detail: { finishing_type: "NATURAL", interaction_id: "kept" } },
    ], nowMs: NOW });
    const recent = recentDomusActs(db, "slot8", NOW);
    expect(recent.find(item => item.option === "a1")!.detail).toEqual({
      interaction_id: "kept", ended: "cut_short", why: "something the game had to do first took its place",
    });
    expect(recent.find(item => item.option === "a2")!.detail).toEqual({ interaction_id: "kept", ended: "completed" });
    expect(JSON.stringify(recent)).not.toContain("finishing_type");
  });

  it("carries options and acts into her Domus pass only when acting is on", () => {
    const db = openTestSidecar();
    observe(db, 1, { options: OPTIONS });
    const event = appendInboxEvent(db, { id: "domus-notification:helper-a.1", conversationId: "c", kind: "domus_notification",
      payload: { domus: { world: "slot8", attachment: "helper-a", observationIds: ["helper-a.1"] }, occupantId: "o", authorityEpoch: 1 }, createdAtMs: NOW });
    const off = domusForThought(db, { id: event.id, conversationId: "c" });
    expect(off.options).toBeUndefined();
    expect(off.acts).toBeUndefined();
    const on = domusForThought(db, { id: event.id, conversationId: "c" }, undefined, { enabled: true, nowMs: NOW });
    expect(on.options).toEqual(OPTIONS);
  });
});

describe("8f wire and contract", () => {
  it("validates the sync body strictly", () => {
    expect(parseActSync({ v: 1, helper_session: "h", events: [{ act_id: "abc", phase: "finished", at_ms: 5, detail: { finishing_type: "NATURAL" } }] }))
      .toEqual({ helperSession: "h", events: [{ actId: "abc", phase: "finished", atMs: 5, detail: { finishing_type: "NATURAL" } }] });
    for (const body of [
      { v: 1, helper_session: "h", events: [], extra: 1 },
      { v: 1, helper_session: "h", events: [{ act_id: "abc", phase: "done", at_ms: 5 }] },
      { v: 1, helper_session: "h", events: [{ act_id: "a-b", phase: "received", at_ms: 5 }] },
      { v: 2, helper_session: "h", events: [] },
    ]) expect(() => parseActSync(body)).toThrow();
  });

  it("accepts options on an observation within 8 KiB", () => {
    const base = { v: 1, observation_id: "x.1", world: "w", branch: "b", session: "s", attachment: "a", body: "b", snapshot: "1", seq: 1,
      source_time_ms: NOW, expires_at_ms: NOW + 1000, lineage_class: "CURRENT", percepts: [{ kind: "need", salience: 0.1, facts: {} }] };
    expect(parseObservation({ ...base, options: OPTIONS }, NOW).normalized.options).toEqual(OPTIONS);
    expect(() => parseObservation({ ...base, options: [{ object: "x".repeat(9000) }] }, NOW)).toThrow();
    expect(() => parseObservation({ ...base, options: "a1" }, NOW)).toThrow();
  });

  it("offers domusAct only in a Domus pass that listed options", () => {
    const withOptions = thoughtContractProfile({ trigger: { kind: "domus_notification" }, audience: { kind: "owner_private" }, domus: { options: OPTIONS } });
    const without = thoughtContractProfile({ trigger: { kind: "domus_notification" }, audience: { kind: "owner_private" }, domus: {} });
    const chat = thoughtContractProfile({ trigger: { kind: "owner_utterance" }, audience: { kind: "owner_private" }, domus: { options: OPTIONS } });
    expect([withOptions.domusAct, without.domusAct, chat.domusAct]).toEqual([true, false, false]);
    expect(thoughtContractProfileKey(withOptions)).toBe("domus+owner+act");
    const acting = thoughtOutputCompatibilityInstruction(withOptions);
    const watching = thoughtOutputCompatibilityInstruction(without);
    expect(acting).toContain(DOMUS_ACT_GUIDANCE);
    expect(acting).not.toContain(DOMUS_OBSERVE_GUIDANCE);
    expect(watching).toContain(DOMUS_OBSERVE_GUIDANCE);
    expect(watching).not.toContain(DOMUS_ACT_GUIDANCE);
  });

  it("parses a settlement domusAct and refuses anything else", () => {
    const settle = (domusAct: unknown) => parseThoughtSemanticOutput(JSON.stringify({ kind: "settlement", speech: { mode: "none" },
      journal: { activity: "think", entry: "I picked up the guitar." }, domusAct }), new Set<string>());
    expect(settle({ option: "a2" })).toMatchObject({ ok: true });
    for (const bad of [{ option: "" }, { option: "a2", why: "x" }, "a2", { option: "a b" }]) {
      expect(settle(bad)).toMatchObject({ ok: false });
    }
  });
});

describe("8f her settled choice", () => {
  it("becomes a requested act through the settlement aftermath, only when the pass was bound to options", async () => {
    const { recordAftermathPending, recordSettlementAftermath } = await import("../cognitive-v021/thought/aftermath.js");
    const { admitTestCycle } = await import("../cognitive-v021/test-support.js");
    const db = openTestSidecar();
    try {
      observe(db, 1, { options: OPTIONS });
      for (const [cycleId, bound] of [["acting-cycle", true], ["watching-cycle", false]] as const) {
        admitTestCycle(db, { cycleId, conversationId: "c", occupantId: "owner", generation: 1,
          triggerKind: "domus_notification", triggerRef: `domus-notification:${cycleId}`, nowMs: NOW });
        db.prepare("INSERT INTO settlements(settlement_id,cycle_id,generation,payload_json) VALUES(?,?,1,?)")
          .run(`${cycleId}-settlement`, cycleId, JSON.stringify({ sawSecret: false, journal: { activity: "think", entry: "Guitar." }, domusAct: { option: "a2" } }));
        recordAftermathPending(db, { settlementId: `${cycleId}-settlement`, cycleId, nowMs: NOW,
          context: { conversationId: "c", ownerPrivate: true, passKind: "private", channel: "domus:slot8", nightPass: null,
            ...(bound ? { domusAct: { world: "slot8", attachment: "helper-a", observationId: "helper-a.1" } } : {}) } });
        expect(recordSettlementAftermath(db, `${cycleId}-settlement`, { identityStore: null, timeZone: "UTC", nowMs: NOW })).toBe("recorded");
      }
      expect(db.prepare("SELECT cycle_id, guid64, state FROM domus_acts").all()).toEqual([{ cycle_id: "acting-cycle", guid64: "14001", state: "requested" }]);
    } finally { db.close(); }
  });
});

describe("OWNERFIRST an act the User asked for", () => {
  function ownerAct(db: DatabaseSync, option: string, cycleId: string, nowMs: number, then?: string[]) {
    observe(db, 1, { options: OPTIONS });
    const binding = domusActBinding(db, { world: "slot8", observationIds: ["helper-a.1"] })!;
    return recordDomusAct(db, { binding, claim: { option, forOwner: true, ...(then ? { then } : {}) }, cycleId, nowMs });
  }

  it("is marked only when her Thought said so, and goes to the helper as owner", () => {
    const db = openTestSidecar();
    const asked = ownerAct(db, "a1", "cycle-1", NOW);
    const hers = act(db, "a2", "cycle-2", NOW);
    expect(row(db, asked.actId).for_owner).toBe(1);
    expect(row(db, hers.actId).for_owner).toBe(0);
    const sent = syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts;
    expect(sent.find(item => item.act_id === asked.actId)!.owner).toBe(true);
    expect(sent.find(item => item.act_id === hers.actId)).not.toHaveProperty("owner");
  });

  it("validates forOwner as a boolean in the claim", () => {
    expect(isDomusActClaim({ option: "a1", forOwner: true })).toBe(true);
    expect(isDomusActClaim({ option: "a1", forOwner: false })).toBe(true);
    expect(isDomusActClaim({ option: "a1", forOwner: "yes" })).toBe(false);
  });

  it("passes the mark to each step of its plan", () => {
    const db = openTestSidecar();
    const first = ownerAct(db, "a1", "cycle-1", NOW, ["a2"]);
    syncDomusActs(db, { helperSession: "helper-a", events: [
      { actId: first.actId, phase: "finished", atMs: NOW, detail: { finishing_type: "NATURAL", started: true } }], nowMs: NOW });
    const step = db.prepare("SELECT for_owner FROM domus_acts WHERE cycle_id = 'cycle-1:step1'").get() as { for_owner: number };
    expect(step.for_owner).toBe(1);
  });

  it("stays open in her view until a later act on the same thing completes", () => {
    const db = openTestSidecar();
    const asked = ownerAct(db, "a1", "cycle-0", NOW - 60_000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: asked.actId, phase: "finished", atMs: NOW - 59_000,
      detail: { finishing_type: "INTERACTION_INCOMPATIBILITY", started: false } }], nowMs: NOW - 59_000 });
    for (let index = 1; index <= 7; index++) act(db, "a3", `cycle-${index}`, NOW - 50_000 + index);
    const view = recentDomusActs(db, "slot8", NOW);
    expect(view[0]).toMatchObject({ option: "a1", forOwner: true, stillOpen: true, state: "finished" });
    expect(view[0]!.detail).toEqual({ ended: "cut_short", why: "it never began: the game found no way for her to do it from where she was" });
    const again = ownerAct(db, "a1", "cycle-9", NOW - 1000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: again.actId, phase: "finished", atMs: NOW,
      detail: { finishing_type: "NATURAL", started: true } }], nowMs: NOW });
    const after = recentDomusActs(db, "slot8", NOW);
    expect(after.some(item => item.stillOpen)).toBe(false);
    expect(after.at(-1)).toMatchObject({ option: "a1", forOwner: true });
  });

  it("lets go of an open ask after its time", () => {
    const db = openTestSidecar();
    const asked = ownerAct(db, "a1", "cycle-0", NOW - DOMUS_OWNER_OPEN_MS - 1000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: asked.actId, phase: "rejected", atMs: NOW - DOMUS_OWNER_OPEN_MS,
      detail: { code: "GAME_REFUSED" } }], nowMs: NOW - DOMUS_OWNER_OPEN_MS });
    expect(recentDomusActs(db, "slot8", NOW)).toEqual([]);
  });

  it("never marks her own cut-short act as still open", () => {
    const db = openTestSidecar();
    const hers = act(db, "a1", "cycle-1", NOW - 1000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: hers.actId, phase: "finished", atMs: NOW,
      detail: { finishing_type: "DISPLACED", started: true } }], nowMs: NOW });
    const [item] = recentDomusActs(db, "slot8", NOW);
    expect(item).not.toHaveProperty("stillOpen");
    expect(item).not.toHaveProperty("forOwner");
    expect(item!.detail).toEqual({ ended: "cut_short", why: "another action replaced it" });
  });
});

describe("OWNERFIRST an object the game found no way to", () => {
  it("is noted on her options until something there runs", () => {
    const db = openTestSidecar();
    const tried = act(db, "a1", "cycle-1", NOW - 2000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: tried.actId, phase: "finished", atMs: NOW - 1500,
      detail: { finishing_type: "FinishingType.INTERACTION_INCOMPATIBILITY", started: false } }], nowMs: NOW - 1500 });
    expect([...domusNoWayObjects(db, "slot8", NOW)]).toEqual([["1001", "it never began: the game found no way for her to do it from where she was"]]);
    const event = appendInboxEvent(db, { id: "domus-notification:helper-a.1", conversationId: "c", kind: "domus_notification",
      payload: { domus: { world: "slot8", attachment: "helper-a", observationIds: ["helper-a.1"] }, occupantId: "o", authorityEpoch: 1 }, createdAtMs: NOW });
    const on = domusForThought(db, { id: event.id, conversationId: "c" }, undefined, { enabled: true, nowMs: NOW });
    expect(on.options![0]).toMatchObject({ object_id: "1001", noWay: "last time it never began: the game found no way for her to do it from where she was" });
    expect(on.options![1]).not.toHaveProperty("noWay");
    const ran = act(db, "a1", "cycle-2", NOW - 1000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: ran.actId, phase: "finished", atMs: NOW - 500,
      detail: { finishing_type: "NATURAL", started: true } }], nowMs: NOW - 500 });
    expect(domusNoWayObjects(db, "slot8", NOW).size).toBe(0);
  });

  it("is not noted for an act that ran and was then cut short", () => {
    const db = openTestSidecar();
    const ran = act(db, "a1", "cycle-1", NOW - 2000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: ran.actId, phase: "finished", atMs: NOW - 1500,
      detail: { finishing_type: "INTERACTION_INCOMPATIBILITY", started: true } }], nowMs: NOW - 1500 });
    expect(domusNoWayObjects(db, "slot8", NOW).size).toBe(0);
  });
});

describe("2.25.0 the game sees no way to an object now", () => {
  it("keeps the helper's live noWay rather than the last-time note", () => {
    const db = openTestSidecar();
    const live = "the game sees no way for her to get there from where she is now";
    observe(db, 1, { options: [{ ...OPTIONS[0]!, noWay: live }, OPTIONS[1]!] });
    const binding = domusActBinding(db, { world: "slot8", observationIds: ["helper-a.1"] })!;
    const tried = recordDomusAct(db, { binding, claim: { option: "a1" }, cycleId: "cycle-1", nowMs: NOW - 2000 });
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: tried.actId, phase: "finished", atMs: NOW - 1500,
      detail: { finishing_type: "INTERACTION_INCOMPATIBILITY", started: false } }], nowMs: NOW - 1500 });
    const event = appendInboxEvent(db, { id: "domus-notification:helper-a.1", conversationId: "c", kind: "domus_notification",
      payload: { domus: { world: "slot8", attachment: "helper-a", observationIds: ["helper-a.1"] }, occupantId: "o", authorityEpoch: 1 }, createdAtMs: NOW });
    const on = domusForThought(db, { id: event.id, conversationId: "c" }, undefined, { enabled: true, nowMs: NOW });
    expect(on.options![0]!.noWay).toBe(live);
  });
});

describe("DPLAY her Discord turn while she plays", () => {
  function attach(db: DatabaseSync, session = "helper-a", attached = true) {
    upsertHeartbeat(db, { helperSession: session, receivedAtMs: NOW - 1000, sentAtMs: NOW - 1000,
      json: JSON.stringify({ v: 1, helper_session: session, sent_at_ms: NOW - 1000, attached }) });
  }

  it("reads the newest menu of the live game, stored or admitted, and acts from it as a game pass would", () => {
    const db = openTestSidecar();
    observe(db, 1, { options: OPTIONS });
    observe(db, 2, { options: [OPTIONS[1]!], admitted: false });
    observe(db, 3, {});
    attach(db);
    const live = domusLiveForOwner(db, NOW)!;
    expect(live.binding).toEqual({ world: "slot8", attachment: "helper-a", observationId: "helper-a.2" });
    expect(live.options).toEqual([OPTIONS[1]]);
    const made = recordDomusAct(db, { binding: live.binding, claim: { option: "a3", forOwner: true }, cycleId: "owner-cycle", nowMs: NOW });
    expect(row(db, made.actId)).toMatchObject({ state: "requested", guid64: "14002", for_owner: 1 });
    expect(syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts[0]).toMatchObject({ act_id: made.actId, owner: true });
  });

  it("offers nothing when no game is attached, a menu is too old, or it came from another session", () => {
    const db = openTestSidecar();
    observe(db, 1, { options: OPTIONS });
    expect(domusLiveForOwner(db, NOW)).toBeUndefined();
    attach(db, "helper-a", false);
    expect(domusLiveForOwner(db, NOW)).toBeUndefined();
    attach(db, "helper-b");
    expect(domusLiveForOwner(db, NOW)).toBeUndefined();
    attach(db);
    expect(domusLiveForOwner(db, NOW)).toBeDefined();
    expect(domusLiveForOwner(db, NOW - 9_000 + 1 + DOMUS_LIVE_OPTIONS_MS + 1)).toBeUndefined();
  });

  it("carries her recent acts and the no-way notes", () => {
    const db = openTestSidecar();
    const tried = act(db, "a1", "cycle-1", NOW - 2000);
    syncDomusActs(db, { helperSession: "helper-a", events: [{ actId: tried.actId, phase: "finished", atMs: NOW - 1500,
      detail: { finishing_type: "INTERACTION_INCOMPATIBILITY", started: false } }], nowMs: NOW - 1500 });
    attach(db);
    const live = domusLiveForOwner(db, NOW)!;
    expect(live.acts[0]).toMatchObject({ option: "a1", state: "finished" });
    expect(live.options[0]!.noWay).toBe("last time it never began: the game found no way for her to do it from where she was");
  });

  it("offers domusAct to an Owner turn only with live options", () => {
    const chat = { audience: { kind: "owner_private" }, trigger: { kind: "owner_message" } };
    expect(thoughtContractProfile({ ...chat, domusNow: { options: OPTIONS } }).domusAct).toBe(true);
    expect(thoughtContractProfileKey(thoughtContractProfile({ ...chat, domusNow: { options: OPTIONS } }))).toBe("chat+owner+act");
    expect(thoughtContractProfile({ ...chat, domusNow: {} }).domusAct).toBe(false);
    expect(thoughtContractProfile({ audience: { kind: "owner_private" }, innerPass: { kind: "awake" }, domusNow: { options: OPTIONS } }).domusAct).toBe(false);
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile({ ...chat, domusNow: { options: OPTIONS } }))).toContain(DOMUS_ACT_GUIDANCE);
  });

  it("leaves the Owner's unanswered messages out of a game pass", () => {
    const rows = [
      { id: "1", role: "owner" }, { id: "2", role: "ashley" }, { id: "3", role: "owner" }, { id: "4", role: "system" }, { id: "5", role: "owner" },
    ];
    expect(withoutUnansweredOwnerRows(rows).map(item => item.id)).toEqual(["1", "2", "4"]);
    expect(withoutUnansweredOwnerRows([{ id: "1", role: "owner" }])).toEqual([]);
    expect(withoutUnansweredOwnerRows([])).toEqual([]);
  });
});

describe("Domus answers her game question with rows, counts or typed words", () => {
  const ROWS_OBJECT: DomusOptionObject = { object: "Recipe Picker", object_id: "dialog:2001", where: "same room", acts: [
    { ref: "r1", guid64: "21001", text: "Pancakes" }, { ref: "r2", guid64: "21002", text: "Toast" }, { ref: "r3", guid64: "21003", text: "Soup" },
    { ref: "ok", guid64: "ok", text: "OK" }, { ref: "cx", guid64: "cancel", text: "Cancel" },
  ], answer_rules: { select: { min: 1, max: 2 } } };
  const COUNTS_OBJECT: DomusOptionObject = { object: "Shop", object_id: "dialog:2002", acts: [
    { ref: "p1", guid64: "22001", text: "Chair" }, { ref: "p2", guid64: "22002", text: "Lamp" }, { ref: "pok", guid64: "ok", text: "OK" },
  ], answer_rules: { counts: { max_in_row: 3, max_rows: 2 } } };
  const NAMING_RULES = [
    { name: "first", label: "First name", min_length: 1, max_length: 12, numeric: false, min_value: null, max_value: null, profanity_checked: true },
    { name: "amount", label: "Amount", min_length: 1, max_length: 4, numeric: true, min_value: 0, max_value: 500, profanity_checked: false },
    { name: "note", label: "Note", min_length: 0, max_length: 20, numeric: false, min_value: null, max_value: null, profanity_checked: false },
  ];
  const NAMING_OBJECT: DomusOptionObject = { object: "Naming", object_id: "dialog:2003", acts: [
    { ref: "nok", guid64: "ok", text: "OK" }, { ref: "ncx", guid64: "cancel", text: "Cancel" },
  ], answer_rules: { text: NAMING_RULES } };
  const BOTH_OBJECT: DomusOptionObject = { ...ROWS_OBJECT, object_id: "dialog:2004", answer_rules: { select: { min: 1, max: 2 }, text: [NAMING_RULES[0]!] } };
  const ALL: DomusOptionObject[] = [ROWS_OBJECT, COUNTS_OBJECT, NAMING_OBJECT, BOTH_OBJECT, ...OPTIONS];

  /** Offer the options in a new pass of this db, bind it, and record her claim. */
  function answering(db: DatabaseSync, claim: DomusActClaim, options: DomusOptionObject[] = ALL, cycleId = "cycle-1") {
    const seq = Number((db.prepare("SELECT COUNT(*) AS n FROM domus_observations").get() as { n: number }).n) + 1;
    const observationId = observe(db, seq, { options });
    const binding = domusActBinding(db, { world: "slot8", observationIds: [observationId] })!;
    return recordDomusAct(db, { binding, claim, cycleId, nowMs: NOW });
  }
  /** The short reason an answer was refused for (the part of her label after "invalid: "). */
  function reasonOf(claim: DomusActClaim, options?: DomusOptionObject[]): string {
    const db = openTestSidecar();
    const result = answering(db, claim, options);
    expect(result.state).toBe("invalid");
    return String(row(db, result.actId).label).split("invalid: ")[1] ?? "";
  }

  it("accepts the answer shape: rows with optional counts, typed words, or both", () => {
    expect(isDomusActClaim({ option: "ok", answer: { rows: [{ option: "r1" }, { option: "r2", count: 2 }] } })).toBe(true);
    expect(isDomusActClaim({ option: "nok", answer: { text: { first: "Ilse", "amount.2": "42", x_1: "a" } } })).toBe(true);
    expect(isDomusActClaim({ option: "ok", answer: { rows: [{ option: "r1" }], text: { first: "Ilse" } }, then: ["cx"], forOwner: true })).toBe(true);
    expect(isDomusActClaim({ option: "ok", answer: { text: { first: "x".repeat(256) } } })).toBe(true);
    expect(isDomusActClaim({ option: "ok", answer: { rows: [{ option: "r1", count: 99 }] } })).toBe(true);
    expect(isDomusActClaim({ option: "ok", answer: { rows: Array.from({ length: 16 }, (_, index) => ({ option: `r${index}` })) } })).toBe(true);
  });

  it("refuses a malformed answer shape", () => {
    const rows = (value: unknown) => ({ option: "ok", answer: { rows: value } });
    const text = (value: unknown) => ({ option: "ok", answer: { text: value } });
    for (const bad of [
      { option: "ok", answer: {} }, { option: "ok", answer: "r1" }, { option: "ok", answer: null }, { option: "ok", answer: { rows: [] } },
      { option: "ok", answer: { rows: [{ option: "r1" }], extra: 1 } },
      rows(Array.from({ length: 17 }, (_, index) => ({ option: `r${index}` }))),
      rows([{ option: "bad ref" }]), rows([{ count: 2 }]), rows([{ option: "r1", count: 0 }]), rows([{ option: "r1", count: 100 }]),
      rows([{ option: "r1", count: 1.5 }]), rows([{ option: "r1", count: "2" }]), rows([{ option: "r1", label: "x" }]), rows("r1"),
      text({}), text(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`f${index}`, "x"]))), text({ "a b": "x" }),
      text({ ["f".repeat(33)]: "x" }), text({ first: "" }), text({ first: "x".repeat(257) }), text({ first: 5 }), text(["Ilse"]),
      { option: "ok", answer: { rows: [{ option: "r1" }] }, then: [{ option: "r2", answer: { rows: [{ option: "r1" }] } }] },
    ]) expect(isDomusActClaim(bad)).toBe(false);
  });

  it("stores a valid multi-row answer resolved to the game's own row ids, and returns it on sync", () => {
    const db = openTestSidecar();
    const result = answering(db, { option: "ok", answer: { rows: [{ option: "r1" }, { option: "r2" }] } });
    expect(result.state).toBe("requested");
    expect(row(db, result.actId)).toMatchObject({ state: "requested", object_id: "dialog:2001", guid64: "ok",
      label: "answered Recipe Picker: Pancakes, Toast",
      answer_json: JSON.stringify({ rows: [{ option_id: "21001", count: 1 }, { option_id: "21002", count: 1 }] }) });
    expect(syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts).toEqual([{ act_id: result.actId,
      object_id: "dialog:2001", guid64: "ok", expires_at_ms: NOW + DOMUS_ACT_TTL_MS,
      answer: { rows: [{ option_id: "21001", count: 1 }, { option_id: "21002", count: 1 }] } }]);
  });

  it("stores counts per row and says them in her record", () => {
    const db = openTestSidecar();
    const result = answering(db, { option: "pok", answer: { rows: [{ option: "p1", count: 2 }, { option: "p2" }] } });
    expect(result.state).toBe("requested");
    expect(row(db, result.actId)).toMatchObject({ label: "answered Shop: Chair x2, Lamp",
      answer_json: JSON.stringify({ rows: [{ option_id: "22001", count: 2 }, { option_id: "22002", count: 1 }] }) });
  });

  it("stores typed words, and her record names only the fields and their lengths", () => {
    const db = openTestSidecar();
    const result = answering(db, { option: "nok", answer: { text: { first: "Ilse", amount: "42" } } });
    expect(result.state).toBe("requested");
    const stored = row(db, result.actId);
    expect(stored).toMatchObject({ label: "answered Naming: first 4 chars, amount 2 chars", answer_json: JSON.stringify({ text: { first: "Ilse", amount: "42" } }) });
    expect(String(stored.label)).not.toContain("Ilse");
    expect(syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts[0])
      .toMatchObject({ answer: { text: { first: "Ilse", amount: "42" } } });
  });

  it("stores rows and text together when the question takes both, and refuses text the question does not take", () => {
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "r3" }], text: { first: "Ilse" } } })).toBe("answer:unknown_field:first");
    const db = openTestSidecar();
    const ok = answering(db, { option: "ok", answer: { rows: [{ option: "r2" }], text: { first: "Ilse" } } }, [BOTH_OBJECT]);
    expect(ok.state).toBe("requested");
    expect(row(db, ok.actId)).toMatchObject({ answer_json: JSON.stringify({ rows: [{ option_id: "21002", count: 1 }], text: { first: "Ilse" } }) });
  });

  it("refuses an answer to an object that is not a dialog, has no rules, or is answered with a button other than ok", () => {
    expect(reasonOf({ option: "a1", answer: { rows: [{ option: "a1" }] } })).toBe("answer:not_a_dialog");
    expect(reasonOf({ option: "ncx", answer: { text: { first: "Ilse" } } })).toBe("answer:not_ok");
    const plain: DomusOptionObject = { object: "Shelf", object_id: "dialog:2009", acts: [{ ref: "pk", guid64: "ok", text: "OK" }] };
    expect(reasonOf({ option: "pk", answer: { text: { first: "x" } } }, [plain])).toBe("answer:no_rules");
    const broken = { ...NAMING_OBJECT, answer_rules: { text: [{ name: "first" }] } } as unknown as DomusOptionObject;
    expect(reasonOf({ option: "nok", answer: { text: { first: "x" } } }, [broken])).toBe("answer:no_rules");
  });

  it("refuses rows that are not on the question, not rows, repeated, or too many or too few", () => {
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "r1" }, { option: "a1" }] } })).toBe("answer:row_not_in_dialog");
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "cx" }] } })).toBe("answer:not_a_row");
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "r1" }, { option: "r1" }] } })).toBe("answer:row_repeated");
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "r1" }, { option: "r2" }, { option: "r3" }] } })).toBe("answer:too_many_rows");
    const two: DomusOptionObject = { ...ROWS_OBJECT, object_id: "dialog:2005", answer_rules: { select: { min: 2, max: 3 } } };
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "r1" }] } }, [two])).toBe("answer:too_few_rows");
    const picker: DomusOptionObject = { ...ROWS_OBJECT, object_id: "dialog:2006", answer_rules: { select: { min: 1, max: 2 }, counts: { max_in_row: 3, max_rows: 1 } } };
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "r1" }, { option: "r2" }] } }, [picker])).toBe("answer:too_many_rows");
  });

  it("refuses counts that the question does not allow, or that are too high for one row", () => {
    expect(reasonOf({ option: "ok", answer: { rows: [{ option: "r1", count: 2 }] } })).toBe("answer:count_not_allowed");
    expect(reasonOf({ option: "pok", answer: { rows: [{ option: "p1", count: 4 }] } })).toBe("answer:count_too_high");
    expect(reasonOf({ option: "pok", answer: { rows: [{ option: "p1" }, { option: "p1" }] } })).toBe("answer:row_repeated");
    const threeRows: DomusOptionObject = { ...COUNTS_OBJECT, object_id: "dialog:2007", acts: [...COUNTS_OBJECT.acts,
      { ref: "p3", guid64: "22003", text: "Desk" }] };
    expect(reasonOf({ option: "pok", answer: { rows: [{ option: "p1" }, { option: "p2" }, { option: "p3" }] } }, [threeRows]))
      .toBe("answer:too_many_rows");
  });

  it("refuses typed words that break a field's rules, names the field, and trims nothing", () => {
    expect(reasonOf({ option: "nok", answer: { text: { first: "Bartholomew Ann" } } })).toBe("answer:text_too_long:first");
    expect(reasonOf({ option: "nok", answer: { text: { first: "A\u0007b" } } })).toBe("answer:text_control:first");
    expect(reasonOf({ option: "nok", answer: { text: { first: "Ilse", amount: "12a" } } })).toBe("answer:text_not_integer:amount");
    expect(reasonOf({ option: "nok", answer: { text: { first: "Ilse", amount: "900" } } })).toBe("answer:text_out_of_range:amount");
    expect(reasonOf({ option: "nok", answer: { text: { first: "Ilse", amount: "-1" } } })).toBe("answer:text_out_of_range:amount");
    expect(reasonOf({ option: "nok", answer: { text: { amount: "5" } } })).toBe("answer:text_missing:first");
    expect(reasonOf({ option: "nok", answer: { text: { first: "Ilse", nickname: "x" } } })).toBe("answer:unknown_field:nickname");
    const noMax = { ...NAMING_OBJECT, object_id: "dialog:2010", answer_rules: { text: [{ ...NAMING_RULES[0]!, max_length: null }] } };
    expect(reasonOf({ option: "nok", answer: { text: { first: "Ilse" } } }, [noMax])).toBe("answer:text_no_limit:first");
    const noRange = { ...NAMING_OBJECT, object_id: "dialog:2011", answer_rules: { text: [{ ...NAMING_RULES[1]!, min_value: null }] } };
    expect(reasonOf({ option: "nok", answer: { text: { amount: "5" } } }, [noRange])).toBe("answer:text_no_range:amount");
    const short = { ...NAMING_OBJECT, object_id: "dialog:2012", answer_rules: { text: [{ ...NAMING_RULES[0]!, min_length: 3 }] } };
    expect(reasonOf({ option: "nok", answer: { text: { first: "Al" } } }, [short])).toBe("answer:text_too_short:first");
  });

  it("keeps an invalid answer as invalid: nothing is sent, and the plan after it is let go", () => {
    const db = openTestSidecar();
    const result = answering(db, { option: "ok", answer: { rows: [{ option: "zz" }] }, then: ["cx"] });
    expect(result.state).toBe("invalid");
    expect(row(db, result.actId)).toMatchObject({ state: "invalid", answer_json: null, label: "OK (Recipe Picker) invalid: answer:row_not_in_dialog" });
    expect(syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts).toEqual([]);
    expect(db.prepare("SELECT state, reason FROM domus_plan_steps WHERE plan_id = ?").all(result.actId)).toEqual([{ state: "dropped", reason: "after_invalid" }]);
  });

  it("leaves a single-row or button claim exactly as it was", () => {
    const db = openTestSidecar();
    const single = answering(db, { option: "a3" });
    expect(row(db, single.actId)).toMatchObject({ state: "requested", label: "Play for Tips (Guitar)", answer_json: null });
    const button = answering(db, { option: "nok" }, ALL, "cycle-2");
    expect(button.state).toBe("requested");
    expect(row(db, button.actId)).toMatchObject({ state: "requested", label: "OK (Naming)", guid64: "ok", answer_json: null });
    const synced = syncDomusActs(db, { helperSession: "helper-a", events: [], nowMs: NOW }).acts;
    expect(synced.map(item => item.act_id).sort()).toEqual([single.actId, button.actId].sort());
    expect(synced.every(item => !("answer" in item))).toBe(true);
  });
});
