import type { DatabaseSync } from "node:sqlite";
import type { IdentityStore } from "./growth.js";
import { readMood } from "./mood.js";
import { latestNarrative } from "./night.js";
import { listCurrentOpinions, revisableIdentityEntries } from "./revisions.js";

/**
 * A8 longitudinal witness: once a week the Host records who Ashley is (her
 * identity entries, current opinions, latest narrative, mood baseline) so
 * week-over-week change can be read as growth or drift. The Host copies
 * what exists; it never judges it. Read by the Owner through the
 * inspection route; never fed back into Thought.
 */

export const PERSONA_SNAPSHOT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const PERSONA_SNAPSHOTS_LIST_LIMIT = 12;

export type PersonaSnapshot = {
  takenAtMs: number;
  /** Set when a forget reached this snapshot; its words are gone. */
  redacted?: true;
  identity: Array<{ kind: string; text: string; origin: string }>;
  opinions: Array<{ topic: string; stance: string }>;
  narrative: string | null;
  mood: { valence: number; energy: number; openness: number; tension: number };
};

export type PersonaChange = {
  fromMs: number;
  toMs: number;
  identityAdded: string[];
  identityRemoved: string[];
  opinionsChanged: string[];
  narrativeChanged: boolean;
};

type Row = Record<string, unknown>;

function buildSnapshot(db: DatabaseSync, identity: IdentityStore | null, nowMs: number): PersonaSnapshot {
  const mood = readMood(db, nowMs);
  return {
    takenAtMs: nowMs,
    identity: identity
      ? revisableIdentityEntries(identity.nuclear, identity.ownerId).map((entry) => ({ kind: entry.kind, text: entry.text, origin: entry.origin }))
      : [],
    opinions: listCurrentOpinions(db).map((revision) => ({ topic: revision.topic ?? revision.targetKey, stance: revision.proposedText })),
    narrative: latestNarrative(db)?.text ?? null,
    mood: { valence: mood.valence, energy: mood.energy, openness: mood.openness, tension: mood.tension },
  };
}

/** Take this week's snapshot if a week has passed since the last one. */
export function takePersonaSnapshotIfDue(
  db: DatabaseSync,
  identity: IdentityStore | null,
  nowMs: number,
): PersonaSnapshot | null {
  const last = db.prepare("SELECT MAX(taken_at_ms) AS last FROM persona_snapshots").get() as Row | undefined;
  const lastMs = last?.last == null ? null : Number(last.last);
  if (lastMs !== null && nowMs - lastMs < PERSONA_SNAPSHOT_INTERVAL_MS) return null;
  const snapshot = buildSnapshot(db, identity, nowMs);
  db.prepare("INSERT OR IGNORE INTO persona_snapshots (taken_at_ms, snapshot_json) VALUES (?, ?)")
    .run(nowMs, JSON.stringify(snapshot));
  return snapshot;
}

export function listPersonaSnapshots(db: DatabaseSync, limit = PERSONA_SNAPSHOTS_LIST_LIMIT): PersonaSnapshot[] {
  return (db.prepare("SELECT snapshot_json FROM persona_snapshots ORDER BY taken_at_ms DESC LIMIT ?").all(Math.max(1, limit)) as Row[])
    .flatMap((row) => {
      try { return [JSON.parse(String(row.snapshot_json)) as PersonaSnapshot]; } catch { return []; }
    });
}

/** Snapshots whose words mention a forgotten topic. */
export function snapshotIdsForForget(db: DatabaseSync, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare("SELECT taken_at_ms, snapshot_json FROM persona_snapshots").all() as Row[])
    .filter((row) => String(row.snapshot_json).toLowerCase().includes(needle))
    .map((row) => String(row.taken_at_ms));
}

/** A forget empties the snapshot's words; only when it was taken remains. */
export function forgetSnapshot(db: DatabaseSync, id: string): number {
  return Number(db.prepare("UPDATE persona_snapshots SET snapshot_json = ? WHERE taken_at_ms = ?").run(
    JSON.stringify({ takenAtMs: Number(id), redacted: true, identity: [], opinions: [], narrative: null, mood: { valence: 0, energy: 0, openness: 0, tension: 0 } }),
    Number(id),
  ).changes);
}

/** What changed between consecutive snapshots, newest first; redacted ones are skipped. */
export function personaChanges(snapshots: readonly PersonaSnapshot[]): PersonaChange[] {
  const ordered = snapshots.filter((item) => !item.redacted).sort((left, right) => left.takenAtMs - right.takenAtMs);
  const changes: PersonaChange[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const before = ordered[index - 1]!;
    const after = ordered[index]!;
    const entry = (item: { kind: string; text: string }) => `${item.kind}: ${item.text}`;
    const beforeIdentity = new Set(before.identity.map(entry));
    const afterIdentity = new Set(after.identity.map(entry));
    const beforeOpinions = new Map(before.opinions.map((item) => [item.topic, item.stance]));
    changes.push({
      fromMs: before.takenAtMs,
      toMs: after.takenAtMs,
      identityAdded: [...afterIdentity].filter((item) => !beforeIdentity.has(item)),
      identityRemoved: [...beforeIdentity].filter((item) => !afterIdentity.has(item)),
      opinionsChanged: after.opinions.filter((item) => beforeOpinions.get(item.topic) !== item.stance).map((item) => item.topic),
      narrativeChanged: before.narrative !== after.narrative,
    });
  }
  return changes.reverse();
}
