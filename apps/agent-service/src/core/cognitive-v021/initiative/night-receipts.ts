// The Host retains one mechanical gate result for each due NIGHT evaluation.
import type { DatabaseSync } from "node:sqlite";
import type { NightTickResult } from "./night.js";

export type NightGateCode = Exclude<NightTickResult["outcome"], "scheduled" | "not_due"> | "error";

export function recordNightGateReceipt(db: DatabaseSync, input: {
  evaluationId: string; conversationId: string; dueAtMs: number; evaluatedAtMs: number; gateCode: NightGateCode;
}): void {
  db.prepare(`INSERT INTO night_gate_receipts
    (evaluation_id, conversation_id, due_at_ms, evaluated_at_ms, gate_code) VALUES (?, ?, ?, ?, ?)`)
    .run(input.evaluationId, input.conversationId, input.dueAtMs, input.evaluatedAtMs, input.gateCode);
}
