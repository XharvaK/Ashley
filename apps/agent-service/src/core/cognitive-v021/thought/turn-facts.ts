import type { DatabaseSync } from "node:sqlite";

/**
 * What the Host did to a settlement on the way to publication: a part it dropped (salvage) or cut to its limit.
 * Names only: a field name or a count, never her words or anyone else's.
 */
export type TurnHostNote = {
  kind: "parts_dropped" | "part_capped";
  detail: string;
};

const DETAIL_MAX = 160;

export type TurnFactScope = {
  conversationId: string;
  cycleId: string;
  generation: number;
  pass: number;
  nowMs: number;
};

/** Records one pass's notes in the sidecar, so the next pass can read what happened to the turn. */
export function recordTurnHostNotes(sidecar: DatabaseSync, scope: TurnFactScope, notes: readonly TurnHostNote[]): void {
  if (notes.length === 0) return;
  const insert = sidecar.prepare(
    `INSERT INTO turn_host_notes (conversation_id, cycle_id, generation, pass, kind, detail, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const note of notes) {
    insert.run(scope.conversationId, scope.cycleId, scope.generation, scope.pass, note.kind,
      note.detail.slice(0, DETAIL_MAX), scope.nowMs);
  }
}

/**
 * The Host's fact about the most recent earlier cycle in this conversation, for an owner-private pass.
 * Nothing when that cycle had nothing to report.
 */
export function lastTurnHostFact(sidecar: DatabaseSync, scope: Pick<TurnFactScope, "conversationId" | "cycleId">): string | undefined {
  const last = sidecar.prepare(
    `SELECT cycle_id FROM cycle_records WHERE conversation_id = ? AND cycle_id <> ?
      ORDER BY admitted_at_ms DESC, cycle_id DESC LIMIT 1`,
  ).get(scope.conversationId, scope.cycleId) as { cycle_id?: unknown } | undefined;
  if (!last) return undefined;
  const notes = sidecar.prepare(
    "SELECT kind, detail FROM turn_host_notes WHERE cycle_id = ? ORDER BY note_id ASC",
  ).all(String(last.cycle_id)) as Array<{ kind?: unknown; detail?: unknown }>;
  const dropped = notes.filter((note) => note.kind === "parts_dropped").map((note) => String(note.detail));
  const capped = notes.filter((note) => note.kind === "part_capped").map((note) => String(note.detail));
  const parts = [
    ...(dropped.length > 0 ? [`Parts of my last reply were left out by the Host: ${dropped.join(", ")}.`] : []),
    ...(capped.length > 0 ? [`Parts of my last reply were cut to the limit: ${capped.join(", ")}.`] : []),
  ];
  return parts.length > 0 ? `Host facts on my last turn here: ${parts.join(" ")}` : undefined;
}
