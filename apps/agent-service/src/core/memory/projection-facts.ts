import type { DatabaseSync } from "node:sqlite";
import {
  listAssertions,
  type MemoryAssertion,
} from "./assertions.js";
import { isMemoryAssertionsCurrentnessAuthority } from "./contract-state.js";
import { assertionCurrentAt } from "./eligibility.js";

type ExistingFact = {
  id: number;
  owner_id: string;
  category: string;
  key: string;
  value: string;
  superseded_by: number | null;
};

function factForAssertion(
  db: DatabaseSync,
  assertion: MemoryAssertion,
  existing: ExistingFact[],
): ExistingFact | null {
  if (assertion.legacyFactId != null) {
    const legacy = existing.find((fact) => fact.id === assertion.legacyFactId);
    if (legacy) return legacy;
  }
  return existing.find((fact) =>
    fact.owner_id === assertion.ownerId &&
    fact.category === assertion.category &&
    fact.key === assertion.key &&
    fact.value === assertion.value
  ) ?? null;
}

function writeFact(
  db: DatabaseSync,
  assertion: MemoryAssertion,
  factId: number | null,
): number {
  let projectedId: number;
  if (factId != null) {
    db.prepare(
      `UPDATE mem_facts
       SET owner_id = ?, category = ?, key = ?, value = ?, confidence = ?,
           importance = ?, source_message_id = ?, origin = 'manual',
           source_quote = ?, superseded_by = NULL
       WHERE id = ?`,
    ).run(
      assertion.ownerId,
      assertion.category,
      assertion.key,
      assertion.value,
      assertion.confidence,
      assertion.importance,
      assertion.sourceMessageId,
      assertion.sourceQuote,
      factId,
    );
    projectedId = factId;
  } else {
    const result = db.prepare(
      `INSERT INTO mem_facts
         (owner_id, category, key, value, confidence, importance,
          source_message_id, origin, source_quote, superseded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, NULL, ?)`,
    ).run(
      assertion.ownerId,
      assertion.category,
      assertion.key,
      assertion.value,
      assertion.confidence,
      assertion.importance,
      assertion.sourceMessageId,
      assertion.sourceQuote,
      assertion.createdAt,
    );
    projectedId = Number(result.lastInsertRowid);
  }
  db.prepare(
    `UPDATE memory_assertions SET legacy_fact_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(projectedId, new Date().toISOString(), assertion.id);
  return projectedId;
}

/** Project one eligible keyed assertion into the compatibility fact view. */
export function projectAssertionToMemFact(
  db: DatabaseSync,
  assertion: MemoryAssertion,
  at = new Date().toISOString(),
): number | null {
  if (assertion.kind !== "keyed_fact") return null;
  if (!isMemoryAssertionsCurrentnessAuthority(db)) {
    throw new Error("memory_assertions_not_currentness_authority");
  }
  if (!assertion.category || !assertion.key || !assertion.value) return null;
  if (!assertionCurrentAt(assertion, at)) {
    return null;
  }
  const existing = db.prepare(
    `SELECT id, owner_id, category, key, value, superseded_by
     FROM mem_facts WHERE owner_id = ?`,
  ).all(assertion.ownerId) as ExistingFact[];
  return writeFact(db, assertion, factForAssertion(db, assertion, existing)?.id ?? null);
}

/** Rebuild only the compatibility projection; assertion/barrier history is untouched. */
export function rebuildMemFactsProjection(
  db: DatabaseSync,
  options: { ownerId?: string; at?: string } = {},
): number {
  if (!isMemoryAssertionsCurrentnessAuthority(db)) {
    throw new Error("memory_assertions_not_currentness_authority");
  }
  const at = options.at ?? new Date().toISOString();
  const owners = options.ownerId
    ? [options.ownerId]
    : (db.prepare("SELECT DISTINCT owner_id FROM memory_assertions ORDER BY owner_id")
      .all() as Array<{ owner_id: string }>).map((item) => item.owner_id);
  let projected = 0;
  for (const ownerId of owners) {
    const existing = db.prepare(
      `SELECT id, owner_id, category, key, value, superseded_by
       FROM mem_facts WHERE owner_id = ?`,
    ).all(ownerId) as ExistingFact[];
    const used = new Set<number>();
    for (const assertion of listAssertions(db, ownerId)
      .filter((item) => assertionCurrentAt(item, at))) {
      if (assertion.kind !== "keyed_fact" || !assertion.category || !assertion.key || !assertion.value) continue;
      const id = writeFact(
        db,
        assertion,
        factForAssertion(db, assertion, existing)?.id ?? null,
      );
      used.add(id);
      projected += 1;
    }
    const retire = db.prepare(
      `UPDATE mem_facts SET superseded_by = id
       WHERE owner_id = ? AND id = ? AND superseded_by IS NULL` ,
    );
    for (const fact of existing) {
      if (!used.has(fact.id)) retire.run(ownerId, fact.id);
    }
  }
  return projected;
}
