import type { DatabaseSync } from "node:sqlite";
import { seedIdentity } from "./seed.js";
import type {
  IdentityEntry,
  IdentityLayer,
  IdentitySource,
  Opinion,
} from "../types.js";

export { seedIdentity } from "./seed.js";

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : number(value);
}

function mapIdentity(row: unknown): IdentityEntry | null {
  if (!isRow(row)) return null;
  const layer = text(row.layer);
  const source = text(row.source);
  if (
    (layer !== "stable" && layer !== "dynamic") ||
    (source !== "seeded" && source !== "organic" && source !== "manual")
  ) {
    return null;
  }
  return {
    id: number(row.id),
    ownerId: text(row.owner_id),
    layer,
    kind: text(row.kind),
    text: text(row.text),
    source,
    revisedFrom: nullableNumber(row.revised_from),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function mapOpinion(row: unknown): Opinion | null {
  if (!isRow(row)) return null;
  return {
    id: number(row.id),
    ownerId: text(row.owner_id),
    topic: text(row.topic),
    stance: text(row.stance),
    confidence: number(row.confidence),
    revisedFrom: nullableNumber(row.revised_from),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export function listIdentity(
  db: DatabaseSync,
  ownerId: string,
  options: { layer?: IdentityLayer; limit?: number; seed?: boolean } = {},
): IdentityEntry[] {
  if (options.seed !== false) seedIdentity(db, ownerId);
  const limit = Math.max(1, Math.min(100, options.limit ?? 40));
  const rows =
    options.layer === undefined
      ? db
          .prepare(
            `SELECT e.id, e.owner_id, e.layer, e.kind, e.text, e.source,
                    e.revised_from, e.created_at, e.updated_at
             FROM identity_entries e
             WHERE e.owner_id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM identity_entries newer
                 WHERE newer.revised_from = e.id
               )
             ORDER BY CASE e.layer WHEN 'stable' THEN 0 ELSE 1 END,
                      e.updated_at ASC, e.id ASC
             LIMIT ?`,
          )
          .all(ownerId, limit)
      : db
          .prepare(
            `SELECT e.id, e.owner_id, e.layer, e.kind, e.text, e.source,
                    e.revised_from, e.created_at, e.updated_at
             FROM identity_entries e
             WHERE e.owner_id = ? AND e.layer = ?
               AND NOT EXISTS (
                 SELECT 1 FROM identity_entries newer
                 WHERE newer.revised_from = e.id
               )
             ORDER BY e.updated_at ASC, e.id ASC
             LIMIT ?`,
          )
          .all(ownerId, options.layer, limit);
  return rows.map(mapIdentity).filter((entry): entry is IdentityEntry => entry !== null);
}

type RecordIdentityInput = {
  ownerId: string;
  layer: IdentityLayer;
  kind: string;
  text: string;
  source?: IdentitySource;
  revisedFrom?: number | null;
};

export function recordIdentityEntry(
  db: DatabaseSync,
  input: RecordIdentityInput,
): number;
export function recordIdentityEntry(
  db: DatabaseSync,
  ownerId: string,
  layer: IdentityLayer,
  kind: string,
  value: string,
  source?: IdentitySource,
): number;
export function recordIdentityEntry(
  db: DatabaseSync,
  inputOrOwner: RecordIdentityInput | string,
  layer?: IdentityLayer,
  kind?: string,
  value?: string,
  source: IdentitySource = "organic",
): number {
  const input: RecordIdentityInput =
    typeof inputOrOwner === "string"
      ? {
          ownerId: inputOrOwner,
          layer: layer ?? "dynamic",
          kind: kind ?? "trait",
          text: value ?? "",
          source,
        }
      : inputOrOwner;
  const cleanText = input.text.trim();
  if (!cleanText) return 0;

  const existing: unknown = db
    .prepare(
      `SELECT id
       FROM identity_entries
       WHERE owner_id = ? AND layer = ? AND kind = ? AND lower(text) = lower(?)
       LIMIT 1`,
    )
    .get(input.ownerId, input.layer, input.kind, cleanText);
  if (isRow(existing) && typeof existing.id === "number") {
    db.prepare("UPDATE identity_entries SET updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      existing.id,
    );
    return existing.id;
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO identity_entries
         (owner_id, layer, kind, text, source, revised_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.ownerId,
      input.layer,
      input.kind.trim() || "trait",
      cleanText,
      input.source ?? "organic",
      input.revisedFrom ?? null,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function buildIdentityBlock(db: DatabaseSync, ownerId: string): string {
  const entries = listIdentity(db, ownerId);
  if (entries.length === 0) return "";
  const lines = entries.map((entry) => {
    const source =
      entry.source === "seeded"
        ? ""
        : entry.source === "manual"
          ? " [manual]"
          : " [organic]";
    return `- ${entry.kind}: ${entry.text}${source}`;
  });
  return [
    "## Ashley's identity",
    ...lines,
    "These are Ashley's own values and tastes. They can change, but never silently.",
  ].join("\n");
}

type OpinionInput = {
  ownerId: string;
  topic: string;
  stance: string;
  confidence?: number;
};

export function upsertOpinion(db: DatabaseSync, input: OpinionInput): number;
export function upsertOpinion(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
  stance: string,
  confidence?: number,
): number;
export function upsertOpinion(
  db: DatabaseSync,
  inputOrOwner: OpinionInput | string,
  topic?: string,
  stance?: string,
  confidence = 0.5,
): number {
  const input: OpinionInput =
    typeof inputOrOwner === "string"
      ? {
          ownerId: inputOrOwner,
          topic: topic ?? "",
          stance: stance ?? "",
          confidence,
        }
      : inputOrOwner;
  const cleanTopic = input.topic.trim();
  const cleanStance = input.stance.trim();
  if (!cleanTopic || !cleanStance) return 0;
  const current: unknown = db
    .prepare(
      `SELECT id
       FROM opinions
       WHERE owner_id = ? AND topic = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(input.ownerId, cleanTopic);
  const now = new Date().toISOString();
  if (isRow(current) && typeof current.id === "number") {
    db.prepare(
      `UPDATE opinions
       SET stance = ?, confidence = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      cleanStance,
      Math.max(0, Math.min(1, input.confidence ?? 0.5)),
      now,
      current.id,
    );
    return current.id;
  }
  const result = db
    .prepare(
      `INSERT INTO opinions
         (owner_id, topic, stance, confidence, revised_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      input.ownerId,
      cleanTopic,
      cleanStance,
      Math.max(0, Math.min(1, input.confidence ?? 0.5)),
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function reviseOpinion(
  db: DatabaseSync,
  input: OpinionInput,
): number;
export function reviseOpinion(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
  stance: string,
  confidence?: number,
): number;
export function reviseOpinion(
  db: DatabaseSync,
  inputOrOwner: OpinionInput | string,
  topic?: string,
  stance?: string,
  confidence = 0.5,
): number {
  const input: OpinionInput =
    typeof inputOrOwner === "string"
      ? {
          ownerId: inputOrOwner,
          topic: topic ?? "",
          stance: stance ?? "",
          confidence,
        }
      : inputOrOwner;
  const previous: unknown = db
    .prepare(
      `SELECT id
       FROM opinions
       WHERE owner_id = ? AND topic = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(input.ownerId, input.topic.trim());
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO opinions
         (owner_id, topic, stance, confidence, revised_from, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.ownerId,
      input.topic.trim(),
      input.stance.trim(),
      Math.max(0, Math.min(1, input.confidence ?? 0.5)),
      isRow(previous) && typeof previous.id === "number" ? previous.id : null,
      now,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function listOpinions(
  db: DatabaseSync,
  ownerId: string,
  limit = 30,
): Opinion[] {
  const rows = db
    .prepare(
      `SELECT o.id, o.owner_id, o.topic, o.stance, o.confidence,
              o.revised_from, o.created_at, o.updated_at
       FROM opinions o
       WHERE o.owner_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM opinions newer
           WHERE newer.owner_id = o.owner_id
             AND newer.topic = o.topic
             AND newer.id > o.id
         )
       ORDER BY o.updated_at DESC, o.id DESC
       LIMIT ?`,
    )
    .all(ownerId, Math.max(1, Math.min(100, limit)));
  return rows.map(mapOpinion).filter((opinion): opinion is Opinion => opinion !== null);
}

export function buildOpinionsBlock(db: DatabaseSync, ownerId: string): string {
  const opinions = listOpinions(db, ownerId);
  if (opinions.length === 0) return "";
  return [
    "## Ashley's current opinions",
    ...opinions.map(
      (opinion) =>
        `- ${opinion.topic}: ${opinion.stance} (${Math.round(opinion.confidence * 100)}% confidence)`,
    ),
    "Opinions are hers, not facts about Doc. Disagreement is allowed.",
  ].join("\n");
}
