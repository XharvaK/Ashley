import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type DomusObservationRow = {
  observationId: string;
  digest: string;
  world: string;
  branch: string;
  session: string;
  attachment: string;
  body: string;
  snapshot: string;
  seq: number;
  sourceTimeMs: number;
  expiresAtMs: number;
  receiptTimeMs: number;
  lineageClass: string;
  payloadJson: string;
};

export type AdmitResult =
  | { status: "admitted" | "duplicate"; receiptTimeMs: number }
  | { status: "conflict" };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function observationDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function admitObservation(db: DatabaseSync, row: DomusObservationRow): AdmitResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare(
      "SELECT digest, receipt_time_ms FROM domus_observations WHERE observation_id = ?",
    ).get(row.observationId) as { digest: string; receipt_time_ms: number } | undefined;
    if (existing) {
      db.exec("COMMIT");
      return existing.digest === row.digest
        ? { status: "duplicate", receiptTimeMs: existing.receipt_time_ms }
        : { status: "conflict" };
    }
    db.prepare(`INSERT INTO domus_observations (
      observation_id, digest, world, branch, session, attachment, body, snapshot, seq,
      source_time_ms, expires_at_ms, receipt_time_ms, lineage_class, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.observationId, row.digest, row.world, row.branch, row.session, row.attachment,
      row.body, row.snapshot, row.seq, row.sourceTimeMs, row.expiresAtMs, row.receiptTimeMs,
      row.lineageClass, row.payloadJson,
    );
    db.exec("COMMIT");
    return { status: "admitted", receiptTimeMs: row.receiptTimeMs };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* keep the original error */ }
    throw error;
  }
}

export function upsertHeartbeat(
  db: DatabaseSync,
  input: { helperSession: string; receivedAtMs: number; sentAtMs: number; json: string },
): void {
  db.prepare(`INSERT INTO domus_heartbeats (
    helper_session, last_received_at_ms, last_sent_at_ms, count, last_json
  ) VALUES (?, ?, ?, 1, ?)
  ON CONFLICT(helper_session) DO UPDATE SET
    last_received_at_ms = excluded.last_received_at_ms,
    last_sent_at_ms = excluded.last_sent_at_ms,
    count = domus_heartbeats.count + 1,
    last_json = excluded.last_json`).run(
    input.helperSession, input.receivedAtMs, input.sentAtMs, input.json,
  );
}

export type DomusStatus = {
  observations: {
    total: number;
    last_receipt_time_ms: number | null;
    by_state: { stored: number; admitted: number; dropped: number };
  };
  heartbeats: Array<{ helper_session: string; last_received_at_ms: number; count: number; attached: boolean }>;
};

export function readDomusStatus(db: DatabaseSync): DomusStatus {
  const totals = db.prepare(
    "SELECT COUNT(*) AS total, MAX(receipt_time_ms) AS last_receipt_time_ms FROM domus_observations",
  ).get() as { total: number; last_receipt_time_ms: number | null };
  const byState = { stored: 0, admitted: 0, dropped: 0 };
  for (const row of db.prepare(
    "SELECT admission_state, COUNT(*) AS n FROM domus_observations GROUP BY admission_state",
  ).all() as Array<{ admission_state: keyof typeof byState; n: number }>) {
    if (row.admission_state in byState) byState[row.admission_state] = row.n;
  }
  const heartbeats = (db.prepare(
    "SELECT helper_session, last_received_at_ms, count, last_json FROM domus_heartbeats ORDER BY helper_session",
  ).all() as Array<{ helper_session: string; last_received_at_ms: number; count: number; last_json: string }>)
    .map((row) => {
      let attached = false;
      try {
        const parsed = JSON.parse(row.last_json) as { attached?: unknown };
        attached = parsed.attached === true;
      } catch { attached = false; }
      return {
        helper_session: row.helper_session,
        last_received_at_ms: row.last_received_at_ms,
        count: row.count,
        attached,
      };
    });
  return {
    observations: { total: totals.total, last_receipt_time_ms: totals.last_receipt_time_ms, by_state: byState },
    heartbeats,
  };
}
