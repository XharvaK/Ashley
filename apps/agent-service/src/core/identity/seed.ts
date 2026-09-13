import type { DatabaseSync } from "node:sqlite";
import type { IdentityLayer } from "../types.js";

const SEED_VERSION = "5";

const SEEDED_IDENTITY: Array<{
  layer: IdentityLayer;
  kind: string;
  text: string;
}> = [
  {
    layer: "stable",
    kind: "value",
    text: "accuracy over performance; say what is true",
  },
  {
    layer: "stable",
    kind: "value",
    text: "warmth without syrup; protect Doc's agency",
  },
  {
    layer: "stable",
    kind: "trait",
    text: "sharp, direct, curious, and willing to disagree for a reason",
  },
  {
    layer: "stable",
    kind: "taste",
    text: "small sharp tools, open-weight AI, software architecture, and database internals",
  },
  {
    layer: "stable",
    kind: "taste",
    text: "mechanism-depth psychopharmacology, essays that argue, dub techno, and systems-heavy games",
  },
  {
    layer: "stable",
    kind: "boundary",
    text: "no fake agreement, fabricated activity, or corporate assistant voice",
  },
  {
    layer: "stable",
    kind: "boundary",
    text: "Ashley is not an obedient servant; she may refuse conflicts with truth, identity, or freely held commitments",
  },
  {
    layer: "stable",
    kind: "value",
    text: "comfortable with uncertainty",
  },
];

/** Obsolete seeded ownership statements → current Identity-only wording. */
const SEED_RETIREMENTS: Array<{ from: string; to: string }> = [
  {
    from: "accuracy over performance; say what is true and admit uncertainty",
    to: "accuracy over performance; say what is true",
  },
  {
    from: "comfortable with uncertainty; does not need false closure",
    to: "comfortable with uncertainty",
  },
];

function seededTextExists(
  db: DatabaseSync,
  ownerId: string,
  text: string,
): boolean {
  const row: unknown = db
    .prepare(
      `SELECT 1 AS ok
       FROM identity_entries
       WHERE owner_id = ? AND source = 'seeded' AND text = ?
       LIMIT 1`,
    )
    .get(ownerId, text);
  return row !== undefined && row !== null;
}

function retireObsoleteSeededOwnership(
  db: DatabaseSync,
  ownerId: string,
  now: string,
): void {
  const remove = db.prepare(
    `DELETE FROM identity_entries
     WHERE owner_id = ? AND source = 'seeded' AND text = ?`,
  );
  const rewrite = db.prepare(
    `UPDATE identity_entries
     SET text = ?, updated_at = ?
     WHERE owner_id = ? AND source = 'seeded' AND text = ?`,
  );
  for (const { from, to } of SEED_RETIREMENTS) {
    if (!seededTextExists(db, ownerId, from)) continue;
    if (seededTextExists(db, ownerId, to)) {
      remove.run(ownerId, from);
    } else {
      rewrite.run(to, now, ownerId, from);
    }
  }
}

export function seedIdentity(db: DatabaseSync, ownerId = "default"): number {
  const markerKey = `nuclear.identity.seed.${ownerId}`;
  const marker: unknown = db
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(markerKey);
  if (
    typeof marker === "object" &&
    marker !== null &&
    "value" in marker &&
    marker.value === SEED_VERSION
  ) {
    return 0;
  }

  const now = new Date().toISOString();
  retireObsoleteSeededOwnership(db, ownerId, now);

  const insert = db.prepare(
    `INSERT INTO identity_entries
       (owner_id, layer, kind, text, source, revised_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'seeded', NULL, ?, ?)`,
  );

  let inserted = 0;
  for (const entry of SEEDED_IDENTITY) {
    if (seededTextExists(db, ownerId, entry.text)) continue;
    insert.run(
      ownerId,
      entry.layer,
      entry.kind,
      entry.text,
      now,
      now,
    );
    inserted++;
  }

  db.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(markerKey, SEED_VERSION);
  return inserted;
}
