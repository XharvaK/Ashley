// Automatic comparators use admitted Owner messages and complete delivery receipts, never their text.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar, admitTestCycle } from "../test-support.js";
import { recordExpectations } from "../growth/expectations.js";
import { admitCognitiveIngress } from "../ingress/http.js";
import { updateCycleState } from "../cycle/inbox.js";
import { insertOutboxPending } from "../speech/outbox.js";
import { OutboxDeliveryProjector, reconcileProjectedDeliverySweep } from "../delivery/outbox-projector.js";
const T = 1_000_000;
const HOUR = 3_600_000;
function count(db: ReturnType<typeof openTestSidecar>, table: string) { return Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n); }
function assertNoText(db: ReturnType<typeof openTestSidecar>) {
  for (const table of ["graduation_observations", "graduation_adjudications", "graduation_calibration"]) expect(JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())).not.toContain("MESSAGE_TEXT_MUST_NOT_COPY");
}

describe("graduation automatic terminal recorders", () => {
  it.each([HOUR, HOUR + 1])("records an Owner reply or horizon absence at offset %s", offset => {
    const db = openTestSidecar(); const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = admitCognitiveIngress(db, nuclear, { userId: "doc", message: "first", inboundDiscordMessageIds: ["first"] }, { nowMs: T });
      updateCycleState(db, first.cycleId, "silent", T);
      const [id] = recordExpectations(db, { cycleId: first.cycleId, statements: [{ statement: "A reply", check: "owner_reply", horizonHours: 1 }], dataClassification: "ordinary", nowMs: T });
      const reply = admitCognitiveIngress(db, nuclear, { userId: "doc", message: "MESSAGE_TEXT_MUST_NOT_COPY", inboundDiscordMessageIds: ["second"] }, { nowMs: T + offset });
      expect(reply.accepted).toBe(true);
      const observations = db.prepare("SELECT * FROM graduation_observations WHERE expectation_id=?").all(id!);
      expect(observations).toHaveLength(1);
      expect(db.prepare("SELECT disposition FROM graduation_adjudications WHERE expectation_id=?").get(id!)).toEqual({ disposition: offset === HOUR ? "confirmed" : "contradicted" });
      if (offset === HOUR) expect(observations[0]).toMatchObject({ operational_receipt_type: "owner_message", operational_receipt_id: reply.evidenceRowId, observed_value_typed: '{"replied":true}' });
      admitCognitiveIngress(db, nuclear, { userId: "doc", message: "replay", inboundDiscordMessageIds: ["second"] }, { nowMs: T + offset + 1 });
      expect(count(db, "graduation_adjudications")).toBe(1);
      assertNoText(db);
    } finally { db.close(); nuclear.close(); }
  });
  it("rolls back both layers on recorder failure and preserves Owner admission", () => {
    const db = openTestSidecar(); const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = admitCognitiveIngress(db, nuclear, { userId: "doc", message: "first" }, { nowMs: T });
      updateCycleState(db, first.cycleId, "silent", T);
      recordExpectations(db, { cycleId: first.cycleId, statements: [{ statement: "Reply", check: "owner_reply", horizonHours: 1 }], dataClassification: "ordinary", nowMs: T });
      db.exec("CREATE TRIGGER fixture_grade_throw BEFORE INSERT ON graduation_adjudications BEGIN SELECT RAISE(ABORT,'fixture_recorder_throw'); END");
      expect(admitCognitiveIngress(db, nuclear, { userId: "doc", message: "MESSAGE_TEXT_MUST_NOT_COPY" }, { nowMs: T + 1 }).accepted).toBe(true);
      expect(db.prepare("SELECT * FROM graduation_contract_state WHERE id=1").get()!.record_failures).toBe(1);
      expect(count(db, "graduation_observations")).toBe(0);
      expect(count(db, "graduation_adjudications")).toBe(0);
      expect(count(db, "graduation_recorder_keys")).toBe(0);
    } finally { db.close(); nuclear.close(); }
  });
  it.each(["delivered", "failed", "none", "throw"])("records speech delivery outcome %s without changing delivery", async outcome => {
    const db = openTestSidecar(); const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const cycle = admitTestCycle(db, { conversationId: "delivery", triggerKind: "owner_message", triggerRef: "delivery", occupantId: "doc", nowMs: T });
      const [id] = recordExpectations(db, { cycleId: cycle.cycleId, statements: [{ statement: "Delivery", check: "delivered", horizonHours: 1 }], dataClassification: "ordinary", nowMs: T });
      const speech = insertOutboxPending(db, { cycleId: cycle.cycleId, generation: cycle.generation, conversationId: cycle.conversationId, settlementId: "delivery", licensedText: "MESSAGE_TEXT_MUST_NOT_COPY" });
      const projector = new OutboxDeliveryProjector(db, nuclear, { nowMs: () => T + 1 });
      await projector.project(speech.outboxId);
      const reservationId = Number(db.prepare("SELECT nuclear_reservation_id FROM speech_outbox WHERE outbox_id=?").get(speech.outboxId)!.nuclear_reservation_id);
      if (outcome !== "none") {
        nuclear.prepare("UPDATE delivery_reservations SET state=?,finalized_at=? WHERE id=?").run(outcome === "failed" ? "aborted" : "committed", new Date(T + 2).toISOString(), reservationId);
        if (outcome !== "failed") nuclear.prepare("UPDATE delivery_bubbles SET discord_message_id='receipt',sent_at=? WHERE reservation_id=?").run(new Date(T + 2).toISOString(), reservationId);
      }
      if (outcome === "throw") db.exec("CREATE TRIGGER fixture_delivery_grade_throw BEFORE INSERT ON graduation_adjudications BEGIN SELECT RAISE(ABORT,'fixture_recorder_throw'); END");
      reconcileProjectedDeliverySweep(db, nuclear, { nowMs: outcome === "none" ? T + HOUR : T + 3 });
      if (outcome === "throw") {
        expect(db.prepare("SELECT * FROM graduation_contract_state WHERE id=1").get()!.record_failures).toBe(1);
        expect(count(db, "graduation_observations")).toBe(0);
        expect(db.prepare("SELECT send_status FROM speech_outbox WHERE outbox_id=?").get(speech.outboxId)).toMatchObject({ send_status: "delivered" });
      } else {
        expect(db.prepare("SELECT disposition FROM graduation_adjudications WHERE expectation_id=?").get(id!)).toEqual({ disposition: outcome === "delivered" ? "confirmed" : "contradicted" });
        expect(count(db, "graduation_observations")).toBe(1);
        reconcileProjectedDeliverySweep(db, nuclear, { nowMs: T + HOUR + 1 });
        expect(count(db, "graduation_adjudications")).toBe(1);
      }
      assertNoText(db);
    } finally { db.close(); nuclear.close(); }
  });
});
