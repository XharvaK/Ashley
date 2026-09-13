import type { DatabaseSync } from "node:sqlite";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import { defaultUnclassifiedConversational } from "../privacy/classification.js";
import { insertAssertion } from "./assertions.js";
import { getMemoryContractState } from "./contract-state.js";
import { influenceEligibleAt, listEligibleAssertions } from "./eligibility.js";

export type FactCategory =
  | "project"
  | "preference"
  | "person"
  | "ongoing"
  | "pinned";

export type MemoryFact = {
  id: number;
  ownerId: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence: number;
  importance: number;
  sourceMessageId: number | null;
  origin: "legacy" | "manual" | "explicit_user";
  sourceQuote: string | null;
  supersededBy: number | null;
  createdAt: string;
};

type FactInput = {
  ownerId: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence?: number;
  importance?: number;
  sourceMessageId?: number | null;
  origin?: "legacy" | "manual" | "explicit_user";
  sourceQuote?: string | null;
  /** Caller already owns the surrounding transaction. */
  inTransaction?: boolean;
};

type DbRow = Record<string, unknown>;

function isRow(value: unknown): value is DbRow {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : numberValue(value);
}

export function literalLikePattern(value: string): string {
  return `%${value.trim().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function mapFact(row: unknown): MemoryFact | null {
  if (!isRow(row)) return null;
  const category = stringValue(row.category);
  if (
    category !== "project" &&
    category !== "preference" &&
    category !== "person" &&
    category !== "ongoing" &&
    category !== "pinned"
  ) {
    return null;
  }
  return {
    id: numberValue(row.id),
    ownerId: stringValue(row.owner_id),
    category,
    key: stringValue(row.key),
    value: stringValue(row.value),
    confidence: numberValue(row.confidence),
    importance: numberValue(row.importance),
    sourceMessageId: nullableNumber(row.source_message_id),
    origin:
      row.origin === "manual" || row.origin === "explicit_user"
        ? row.origin
        : "legacy",
    sourceQuote: typeof row.source_quote === "string" ? row.source_quote : null,
    supersededBy: nullableNumber(row.superseded_by),
    createdAt: stringValue(row.created_at),
  };
}

export function listActiveFacts(
  db: DatabaseSync,
  ownerId: string,
  limit = 40,
): MemoryFact[] {
  if (limit <= 0) return [];
  if (getMemoryContractState(db)?.currentnessAuthority === "memory_assertions") {
    const facts: MemoryFact[] = [];
    for (const assertion of listEligibleAssertions(db, ownerId)) {
      if (assertion.kind !== "keyed_fact" || assertion.legacyFactId == null) continue;
      const projected = db.prepare(
        `SELECT id, owner_id, category, key, value, confidence, importance,
                source_message_id, origin, source_quote, superseded_by, created_at
         FROM mem_facts
         WHERE id = ? AND owner_id = ? AND superseded_by IS NULL
           AND category = ? AND key = ? AND value = ?
         LIMIT 1`,
      ).get(
        assertion.legacyFactId,
        ownerId,
        assertion.category,
        assertion.key,
        assertion.value,
      );
      const fact = mapFact(projected);
      if (fact) facts.push(fact);
    }
    return facts
      .sort((left, right) => right.importance - left.importance || right.id - left.id)
      .slice(0, Math.min(100, limit));
  }
  const rows = db
    .prepare(
      `SELECT id, owner_id, category, key, value, confidence, importance,
              source_message_id, origin, source_quote, superseded_by, created_at
       FROM mem_facts
       WHERE owner_id = ? AND superseded_by IS NULL
       ORDER BY importance DESC, id DESC
       LIMIT ?`,
    )
    .all(ownerId, Math.min(100, limit))
    .map(mapFact)
    .filter((fact): fact is MemoryFact => fact !== null);
  return rows;
}

export function listFactsMatchingTopic(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
): MemoryFact[] {
  const cleanTopic = topic.trim();
  if (!cleanTopic) return [];
  if (getMemoryContractState(db)?.currentnessAuthority === "memory_assertions") {
    const pattern = cleanTopic.toLocaleLowerCase();
    return listActiveFacts(db, ownerId, 100).filter((fact) =>
      `${fact.category} ${fact.key} ${fact.value}`.toLocaleLowerCase().includes(pattern),
    );
  }
  const pattern = literalLikePattern(cleanTopic);
  return db.prepare(
    `SELECT id, owner_id, category, key, value, confidence, importance,
            source_message_id, origin, source_quote, superseded_by, created_at
     FROM mem_facts
     WHERE owner_id = ? AND superseded_by IS NULL
       AND (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\'
            OR category LIKE ? ESCAPE '\\')
     ORDER BY id DESC`,
  ).all(ownerId, pattern, pattern, pattern)
    .map(mapFact)
    .filter((fact): fact is MemoryFact => fact !== null);
}

export function upsertFact(db: DatabaseSync, input: FactInput): number;
export function upsertFact(
  db: DatabaseSync,
  ownerId: string,
  category: FactCategory,
  key: string,
  value: string,
  confidence?: number,
  importance?: number,
  sourceMessageId?: number | null,
): number;
export function upsertFact(
  db: DatabaseSync,
  inputOrOwner: FactInput | string,
  category?: FactCategory,
  key?: string,
  value?: string,
  confidence = 0.8,
  importance = 50,
  sourceMessageId: number | null = null,
): number {
  const input: FactInput =
    typeof inputOrOwner === "string"
      ? {
          ownerId: inputOrOwner,
          category: category ?? "ongoing",
          key: key ?? "",
          value: value ?? "",
          confidence,
          importance,
          sourceMessageId,
        }
      : inputOrOwner;
  if (!hasC1MemorySchema(db)) return upsertLegacyFact(db, input);
  return withTransaction(db, input.inTransaction === true, () =>
    upsertAssertionFirstFact(db, input)
  );
}

/** Final fact-source check used by every influence reader after C1 cutover. */
export function factInfluenceEligibleAt(
  db: DatabaseSync,
  ownerId: string,
  factId: number,
  at = new Date().toISOString(),
): boolean {
  const state = getMemoryContractState(db);
  if (state?.currentnessAuthority !== "memory_assertions") {
    const fact = db.prepare(
      `SELECT id FROM mem_facts
       WHERE id = ? AND owner_id = ? AND superseded_by IS NULL LIMIT 1`,
    ).get(factId, ownerId);
    return Boolean(fact);
  }
  return factInfluenceEligibleUnderAssertionsAt(db, ownerId, factId, at);
}

/** Assertion-only fact-source check. This deliberately ignores the cutover marker. */
export function factInfluenceEligibleUnderAssertionsAt(
  db: DatabaseSync,
  ownerId: string,
  factId: number,
  at = new Date().toISOString(),
): boolean {
  const fact = db.prepare(
    `SELECT id FROM mem_facts
     WHERE id = ? AND owner_id = ? AND superseded_by IS NULL LIMIT 1`,
  ).get(factId, ownerId);
  if (!fact) return false;
  const assertions = db.prepare(
    `SELECT id FROM memory_assertions
     WHERE owner_id = ? AND legacy_fact_id = ?
     ORDER BY id DESC`,
  ).all(ownerId, factId) as Array<{ id?: number }>;
  return assertions.some((assertion) =>
    assertion.id != null && influenceEligibleAt(db, Number(assertion.id), at),
  );
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
}

function hasC1MemorySchema(db: DatabaseSync): boolean {
  return tableExists(db, "memory_assertions") && tableExists(db, "memory_contract_state");
}

function withTransaction<T>(
  db: DatabaseSync,
  inTransaction: boolean,
  callback: () => T,
): T {
  if (inTransaction) return callback();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = callback();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* preserve the original fact-writer error */
    }
    throw error;
  }
}

function upsertLegacyFact(db: DatabaseSync, input: FactInput): number {
  const cleanKey = input.key.trim();
  const cleanValue = input.value.trim();
  if (!cleanKey || !cleanValue) return 0;
  const existing: unknown = db
    .prepare(
      `SELECT id, value
       FROM mem_facts
       WHERE owner_id = ? AND category = ? AND key = ? AND superseded_by IS NULL
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(input.ownerId, input.category, cleanKey);
  const boundedConfidence = Math.max(0, Math.min(1, input.confidence ?? 0.8));
  const boundedImportance = Math.max(
    0,
    Math.min(100, Math.round(input.importance ?? 50)),
  );
  if (
    isRow(existing) &&
    typeof existing.id === "number" &&
    input.origin === "explicit_user" &&
    stringValue(existing.value).toLocaleLowerCase() === cleanValue.toLocaleLowerCase()
  ) {
    return existing.id;
  }
  if (
    isRow(existing) &&
    typeof existing.id === "number" &&
    input.origin !== "explicit_user"
  ) {
    db.prepare(
      `UPDATE mem_facts
       SET value = ?, confidence = ?, importance = ?, source_message_id = ?,
           origin = ?, source_quote = ?
       WHERE id = ?`,
    ).run(
      cleanValue,
      boundedConfidence,
      boundedImportance,
      input.sourceMessageId ?? null,
      input.origin ?? "legacy",
      input.sourceQuote ?? null,
      existing.id,
    );
    return existing.id;
  }
  const hasUuid = db
    .prepare(`PRAGMA table_info(mem_facts)`)
    .all()
    .some((row) => (row as { name?: string }).name === "entity_uuid");
  const result = hasUuid
    ? db
        .prepare(
          `INSERT INTO mem_facts
         (owner_id, category, key, value, confidence, importance,
          source_message_id, origin, source_quote, superseded_by, created_at,
          entity_uuid, data_classification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          input.ownerId,
          input.category,
          cleanKey,
          cleanValue,
          boundedConfidence,
          boundedImportance,
          input.sourceMessageId ?? null,
          input.origin ?? "legacy",
          input.sourceQuote ?? null,
          new Date().toISOString(),
          newEntityUuid(),
          defaultUnclassifiedConversational(),
        )
    : db
        .prepare(
          `INSERT INTO mem_facts
         (owner_id, category, key, value, confidence, importance,
          source_message_id, origin, source_quote, superseded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .run(
          input.ownerId,
          input.category,
          cleanKey,
          cleanValue,
          boundedConfidence,
          boundedImportance,
          input.sourceMessageId ?? null,
          input.origin ?? "legacy",
          input.sourceQuote ?? null,
          new Date().toISOString(),
        );
  const insertedId = Number(result.lastInsertRowid);
  if (isRow(existing) && typeof existing.id === "number") {
    db.prepare(
      "UPDATE mem_facts SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL",
    ).run(insertedId, existing.id);
  }
  return insertedId;
}

function assertionForFact(
  db: DatabaseSync,
  factId: number,
): { id: number; authorityFrom: string | null } | null {
  const row = db.prepare(
    `SELECT id, authority_from FROM memory_assertions
     WHERE legacy_fact_id = ? ORDER BY id DESC LIMIT 1`,
  ).get(factId) as { id?: number; authority_from?: string | null } | undefined;
  return row?.id == null
    ? null
    : { id: Number(row.id), authorityFrom: row.authority_from ?? null };
}

function assertionForFactContent(
  db: DatabaseSync,
  input: FactInput,
  cleanKey: string,
  cleanValue: string,
): number | null {
  const row = db.prepare(
    `SELECT id FROM memory_assertions
     WHERE owner_id = ? AND kind = 'keyed_fact'
       AND category = ? AND key = ? AND value = ?
       AND termination_reason IS NULL
     ORDER BY id DESC LIMIT 1`,
  ).get(input.ownerId, input.category, cleanKey, cleanValue) as { id?: number } | undefined;
  return row?.id == null ? null : Number(row.id);
}

function upsertAssertionFirstFact(db: DatabaseSync, input: FactInput): number {
  const cleanKey = input.key.trim();
  const cleanValue = input.value.trim();
  if (!cleanKey || !cleanValue) return 0;
  const existing = db.prepare(
    `SELECT id, value, origin, superseded_by
     FROM mem_facts
     WHERE owner_id = ? AND category = ? AND key = ? AND superseded_by IS NULL
     ORDER BY id DESC LIMIT 1`,
  ).get(input.ownerId, input.category, cleanKey) as {
    id?: number;
    value?: string;
    origin?: string;
    superseded_by?: number | null;
  } | undefined;
  const boundedConfidence = Math.max(0, Math.min(1, input.confidence ?? 0.8));
  const boundedImportance = Math.max(
    0,
    Math.min(100, Math.round(input.importance ?? 50)),
  );
  if (
    existing?.id != null &&
    input.origin === "explicit_user" &&
    String(existing.value ?? "").toLocaleLowerCase() === cleanValue.toLocaleLowerCase()
  ) return Number(existing.id);

  const now = new Date().toISOString();
  const ownerAuthored = input.origin === "explicit_user" || input.origin === "manual";
  const assertionId = insertAssertion(db, {
    ownerId: input.ownerId,
    kind: "keyed_fact",
    subjectFacet: ownerAuthored ? "owner_model" : "unknown",
    lineageKind: ownerAuthored ? "explicit_seed" : "unknown",
    derivationKind: ownerAuthored ? "observed" : "derived",
    supportState: ownerAuthored ? "supported" : "uncertain",
    influenceClass: ownerAuthored ? "I2" : "I0",
    category: input.category,
    key: cleanKey,
    value: cleanValue,
    sourceKind: input.origin === "explicit_user"
      ? "explicit_user"
      : input.origin === "manual"
        ? "manual_pin"
        : "legacy_fact_writer",
    sourceMessageId: input.sourceMessageId ?? null,
    sourceQuote: input.sourceQuote ?? null,
    recordedAt: now,
    validFrom: null,
    validTo: null,
    worldIntervalBasis: "legacy_unknown",
    authorityFrom: ownerAuthored ? now : null,
    authorityTo: null,
    authorityBasis: ownerAuthored ? "adjudicated" : "legacy_current",
    confidence: boundedConfidence,
    importance: boundedImportance,
    dataClassification: defaultUnclassifiedConversational(),
  });

  const existingId = existing?.id == null ? null : Number(existing.id);
  // Keep the compatibility pointer one-to-one with the current assertion.
  // A changed derived value therefore gets a new projection row and ends the
  // prior row, preserving the assertion-to-projection history.
  const factId = insertFactProjection(
    db,
    input,
    cleanKey,
    cleanValue,
    boundedConfidence,
    boundedImportance,
    now,
  );
  const priorAssertion = existingId == null
    ? (() => {
        const id = assertionForFactContent(db, input, cleanKey, String(existing?.value ?? ""));
        return id == null ? null : { id, authorityFrom: null };
      })()
    : assertionForFact(db, existingId);
  if (priorAssertion != null && priorAssertion.id !== assertionId) {
    const authorityTo = priorAssertion.authorityFrom == null || priorAssertion.authorityFrom < now
      ? now
      : new Date(Math.max(
        Date.parse(priorAssertion.authorityFrom) + 1,
        Date.parse(now) + 1,
      )).toISOString();
    db.prepare(
      `UPDATE memory_assertions
       SET termination_reason = 'superseded', authority_to = ?,
           superseded_by_assertion_id = ?, updated_at = ?
       WHERE id = ? AND termination_reason IS NULL`,
    ).run(authorityTo, assertionId, now, priorAssertion.id);
  }
  linkAssertionToProjectedFact(db, assertionId, factId);
  if (existingId != null) {
    db.prepare(
      `UPDATE mem_facts SET superseded_by = ?
       WHERE id = ? AND superseded_by IS NULL`,
    ).run(factId, existingId);
  }
  return factId;
}

function insertFactProjection(
  db: DatabaseSync,
  input: FactInput,
  cleanKey: string,
  cleanValue: string,
  confidence: number,
  importance: number,
  now: string,
): number {
  const hasUuid = db
    .prepare(`PRAGMA table_info(mem_facts)`)
    .all()
    .some((row) => (row as { name?: string }).name === "entity_uuid");
  const result = hasUuid
    ? db.prepare(
      `INSERT INTO mem_facts
         (owner_id, category, key, value, confidence, importance,
          source_message_id, origin, source_quote, superseded_by, created_at,
          entity_uuid, data_classification)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    ).run(
      input.ownerId,
      input.category,
      cleanKey,
      cleanValue,
      confidence,
      importance,
      input.sourceMessageId ?? null,
      input.origin ?? "legacy",
      input.sourceQuote ?? null,
      now,
      newEntityUuid(),
      defaultUnclassifiedConversational(),
    )
    : db.prepare(
      `INSERT INTO mem_facts
         (owner_id, category, key, value, confidence, importance,
          source_message_id, origin, source_quote, superseded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      input.ownerId,
      input.category,
      cleanKey,
      cleanValue,
      confidence,
      importance,
      input.sourceMessageId ?? null,
      input.origin ?? "legacy",
      input.sourceQuote ?? null,
      now,
    );
  return Number(result.lastInsertRowid);
}

function linkAssertionToProjectedFact(
  db: DatabaseSync,
  assertionId: number,
  factId: number,
): void {
  db.prepare(
    "UPDATE memory_assertions SET legacy_fact_id = ? WHERE id = ?",
  ).run(factId, assertionId);
}

export function forgetByTopic(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
): number {
  const cleanTopic = topic.trim();
  if (!cleanTopic) return 0;
  const ids = listFactsMatchingTopic(db, ownerId, cleanTopic)
    .map((fact) => fact.id);
  if (hasC1MemorySchema(db)) {
    return withTransaction(db, false, () => {
      const now = new Date().toISOString();
      for (const id of ids) {
        const assertion = db.prepare(
          `SELECT id, authority_from FROM memory_assertions
           WHERE owner_id = ? AND legacy_fact_id = ?
           ORDER BY id DESC LIMIT 1`,
        ).get(ownerId, id) as { id?: number; authority_from?: string | null } | undefined;
        if (assertion?.id != null) {
          const authorityTo = assertion.authority_from == null || assertion.authority_from < now
            ? now
            : new Date(Math.max(
              Date.parse(assertion.authority_from) + 1,
              Date.parse(now) + 1,
            )).toISOString();
          db.prepare(
            `UPDATE memory_assertions
             SET termination_reason = 'forgotten', authority_to = ?,
                 key = '', value = '', source_message_id = NULL,
                 source_quote = NULL, updated_at = ?
             WHERE id = ? AND termination_reason IS NULL`,
          ).run(authorityTo, now, assertion.id);
        }
        db.prepare(
          `UPDATE mem_facts
           SET superseded_by = id, key = '', value = ?,
               source_message_id = NULL, source_quote = NULL
           WHERE id = ? AND owner_id = ?`,
        ).run("", id, ownerId);
      }
      return ids.length;
    });
  }
  const update = db.prepare(
    `UPDATE mem_facts SET superseded_by = ? WHERE id = ? AND owner_id = ?`,
  );
  for (const id of ids) update.run(id, id, ownerId);
  return ids.length;
}
