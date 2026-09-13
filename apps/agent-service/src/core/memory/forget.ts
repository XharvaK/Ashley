import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getAuthoritativeLineageId } from "../continuity/db.js";
import {
  cancelForgetPreview,
  confirmPreviewToTombstone,
  createForgetPreview,
  listPendingOrAppliedTombstones,
  listTombstoneTargets,
  markTombstoneApplied,
  type CategoryCounts,
  type ForgetTarget,
} from "../continuity/forget-preview.js";
import { reconcileUnsupportedRevisions } from "../learning/revisions.js";
import {
  detachRelationshipMotivations,
  listRelationshipForgetTargets,
  redactRelationshipTargets,
} from "../relationship/forget.js";
import { recomputeSharedCulture } from "../relationship/projections.js";
import {
  listPerceptionForgetTargets,
  redactPerceptionTargets,
} from "../perception/forget.js";
import {
  forgetEpisodesByIds,
  matchingEpisodes,
  previewEpisodeForget,
} from "./episodes.js";
import {
  listFactsMatchingTopic,
} from "./facts.js";
import {
  listMessageIdsMatchingTopic,
  redactMessages,
} from "./threads.js";
import { newEntityUuid } from "../continuity/entity-uuid.js";
import {
  beginAuthorityTransition,
  beginAuthorityTransitionInExistingTransaction,
  stabilizeAuthorityBarrier,
  stabilizeAuthorityBarrierInExistingTransaction,
  markAuthorityBarrierReconciling,
  hasAuthorityBarrier,
  type AuthorityTransitionToken,
} from "../cognitive-v021/authority/barrier.js";
import { recordDerivedInvalidationInTransaction } from "../cognitive-v021/authority/journal.js";

export type ForgetCounts = {
  messagesRedacted: number;
  episodesForgotten: number;
  factsReconciled: number;
  revisionsReconciled: number;
  stateReconciled: number;
  evidenceRemoved: number;
  runsRedacted: number;
};

export type ForgetHonesty = {
  local: string;
  discord: string;
  mistral: string;
  oldBackups: string;
  providerSubmitted?: string;
};

export type ForgetResult = {
  preview: string[];
  deleted: number;
  receiptId: string | null;
  counts: ForgetCounts;
  previewId?: string | null;
  expiresAt?: string | null;
  categoryCounts?: CategoryCounts;
  honesty?: ForgetHonesty;
  tombstoneId?: string | null;
};

const emptyCounts = (): ForgetCounts => ({
  messagesRedacted: 0,
  episodesForgotten: 0,
  factsReconciled: 0,
  revisionsReconciled: 0,
  stateReconciled: 0,
  evidenceRemoved: 0,
  runsRedacted: 0,
});

const DEFAULT_HONESTY: ForgetHonesty = {
  local:
    "Matching local nuclear records were redacted or reconciled, including perception artifacts where present.",
  discord:
    "Original Discord messages remain under Discord retention and control.",
  mistral: "Provider retention cannot be retroactively erased.",
  providerSubmitted:
    "Inline content previously submitted to the model provider cannot be retroactively erased from provider logs.",
  oldBackups: "Older backup packages may still contain forgotten material.",
};

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}

const OCI_SOURCE_TYPES_BY_FORGET_ENTITY: Record<string, readonly string[]> = {
  mem_messages: ["message", "mem_message"],
  episodes: ["episode"],
  mem_facts: ["fact"],
  questions: ["question", "questions"],
  opinions: ["opinion"],
  mind_state_items: ["mind_state"],
  doc_reminder: ["doc_reminder"],
  ashley_self_commitment: ["ashley_self_commitment"],
  mutual_commitment: ["mutual_commitment"],
  relational_tension: ["relational_tension"],
};

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(name) !== undefined
  );
}

function tableHasColumn(
  db: DatabaseSync,
  table: string,
  column: string,
): boolean {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).some((row) => row.name === column);
}

function entityUuidOf(
  db: DatabaseSync,
  table: string,
  id: number,
): string | null {
  if (!tableHasColumn(db, table, "entity_uuid")) return null;
  const row = db
    .prepare(`SELECT entity_uuid AS u FROM ${table} WHERE id = ?`)
    .get(id) as { u?: string } | undefined;
  return row?.u ?? null;
}

/** Heal missing UUIDs on targetable rows (insert-path gaps) with a random UUID. */
function requireEntityUuid(
  db: DatabaseSync,
  table: string,
  id: number,
): string | null {
  if (!tableHasColumn(db, table, "entity_uuid")) return null;
  const existing = entityUuidOf(db, table, id);
  if (existing) return existing;
  const uuid = newEntityUuid();
  db.prepare(
    `UPDATE ${table} SET entity_uuid = ? WHERE id = ? AND (entity_uuid IS NULL OR entity_uuid = '')`,
  ).run(uuid, id);
  return uuid;
}

function idOfEntityUuid(
  db: DatabaseSync,
  table: string,
  entityUuid: string,
  ownerId: string | null,
): number | null {
  if (!tableHasColumn(db, table, "entity_uuid")) return null;
  const withOwner =
    ownerId != null && tableHasColumn(db, table, "owner_id");
  const row = (
    withOwner
      ? db
          .prepare(
            `SELECT id FROM ${table} WHERE entity_uuid = ? AND owner_id = ?`,
          )
          .get(entityUuid, ownerId)
      : db
          .prepare(`SELECT id FROM ${table} WHERE entity_uuid = ?`)
          .get(entityUuid)
  ) as { id?: number } | undefined;
  return row?.id != null ? Number(row.id) : null;
}

function topicFingerprint(ownerId: string, topic: string): string {
  return createHash("sha256")
    .update(`forget-topic\0${ownerId}\0${topic.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

function evidenceTargets(
  db: DatabaseSync,
  ownerId: string,
  sourceType: "message" | "episode",
  sourceIds: number[],
): Array<{ type: string; id: number }> {
  if (sourceIds.length === 0) return [];
  return db
    .prepare(
      `SELECT DISTINCT target_type, target_id
     FROM evidence_links
     WHERE owner_id = ? AND source_type = ?
       AND CAST(source_id AS INTEGER) IN (${placeholders(sourceIds)})`,
    )
    .all(ownerId, sourceType, ...sourceIds)
    .flatMap((value) => {
      if (!isRow(value)) return [];
      const id = Number(value.target_id);
      return Number.isFinite(id)
        ? [{ type: String(value.target_type ?? ""), id }]
        : [];
    });
}

function countRows(
  db: DatabaseSync,
  sql: string,
  ...params: (string | number)[]
): number {
  const value = db.prepare(sql).get(...params);
  return isRow(value) ? Number(value.count ?? 0) : 0;
}

function categoryCountsFromTargets(targets: ForgetTarget[]): CategoryCounts {
  const counts: CategoryCounts = {};
  for (const target of targets) {
    counts[target.entityType] = (counts[target.entityType] ?? 0) + 1;
  }
  return counts;
}

/** Forgetting an authoritative source also tombstones its bounded OCI rows. */
function addOpenCognitiveItemForgetTargets(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
): ForgetTarget[] {
  const result = [...targets];
  const seen = new Set(
    result
      .filter((target) => target.entityType === "open_cognitive_items")
      .map((target) => target.entityUuid),
  );
  const add = (entityUuid: unknown) => {
    const uuid = String(entityUuid ?? "");
    if (!uuid || seen.has(uuid)) return;
    seen.add(uuid);
    result.push({
      entityType: "open_cognitive_items",
      entityUuid: uuid,
      action: "redact",
    });
  };

  for (const target of targets) {
    if (target.entityType === "open_cognitive_items") continue;
    const sourceTypes = OCI_SOURCE_TYPES_BY_FORGET_ENTITY[target.entityType];
    if (!sourceTypes) continue;
    const rows = db
      .prepare(
        `SELECT entity_uuid
         FROM open_cognitive_items
         WHERE owner_id = ? AND source_type IN (${placeholders(sourceTypes)})
           AND source_entity_uuid = ?`,
      )
      .all(ownerId, ...sourceTypes, target.entityUuid) as Array<{
      entity_uuid?: string;
    }>;
    for (const row of rows) add(row.entity_uuid);
  }
  return result;
}

function redactOpenCognitiveItems(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
): number {
  const entityUuids = [
    ...new Set(
      targets
        .filter((target) => target.entityType === "open_cognitive_items")
        .map((target) => target.entityUuid),
    ),
  ];
  if (entityUuids.length === 0) return 0;

  const marks = placeholders(entityUuids);
  const rows = db
    .prepare(
      `SELECT id, status
       FROM open_cognitive_items
       WHERE owner_id = ? AND entity_uuid IN (${marks})`,
    )
    .all(ownerId, ...entityUuids) as Array<{
    id?: number;
    status?: string;
  }>;
  const now = new Date().toISOString();
  for (const row of rows) {
    if (Number(row.id) > 0 && row.status === "OPEN") {
      db.prepare(
        `INSERT INTO open_cognitive_item_transitions
           (item_id, owner_id, from_status, to_status, reason, created_at)
         VALUES (?, ?, 'OPEN', 'WITHDRAWN', 'source_forgotten', ?)`,
      ).run(Number(row.id), ownerId, now);
    }
  }

  const changed = Number(
    db
      .prepare(
        `UPDATE open_cognitive_items
         SET semantic_summary = '[redacted]', source_revision = '',
             status_reason = 'source_forgotten',
             redacted_at = COALESCE(redacted_at, ?),
             redaction_code = 'source_forgotten', updated_at = ?,
             status = CASE WHEN status = 'OPEN' THEN 'WITHDRAWN' ELSE status END
         WHERE owner_id = ? AND entity_uuid IN (${marks})`,
      )
      .run(now, now, ownerId, ...entityUuids).changes,
  );
  db.prepare(
    `UPDATE open_cognitive_item_attention
     SET delay_class = 'none', defer_until = NULL,
         last_outcome_code = 'source_forgotten', review_requested_at = NULL,
         updated_at = ?
     WHERE item_id IN (
       SELECT id FROM open_cognitive_items
       WHERE owner_id = ? AND entity_uuid IN (${marks})
     )`,
  ).run(now, ownerId, ...entityUuids);
  return changed;
}

function buildTargetsForTopic(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
): {
  targets: ForgetTarget[];
  messageIds: number[];
  episodeIds: number[];
  questionIds: number[];
  matchedFacts: Array<{ id: number; key: string; value: string }>;
  preview: string[];
} {
  const messageIds = listMessageIdsMatchingTopic(db, ownerId, topic);
  const episodeMatches = matchingEpisodes(db, ownerId, topic, messageIds);
  const episodeIds = episodeMatches.map((episode) => episode.id);
  const questionMatches = db
    .prepare(
      `SELECT id, text
       FROM questions
       WHERE owner_id = ? AND status IN ('open', 'pursuing')
         AND LOWER(text) LIKE ?
       ORDER BY updated_at DESC, id DESC`,
    )
    .all(ownerId, `%${topic.trim().toLowerCase()}%`) as Array<{
    id: number;
    text: string;
  }>;
  const questionIds = questionMatches.map((question) => Number(question.id));
  const matchedFacts = listFactsMatchingTopic(db, ownerId, topic);
  const relationshipMatches = listRelationshipForgetTargets(db, ownerId, topic);
  const perceptionMatches = listPerceptionForgetTargets(db, ownerId, topic);
  const preview = [
    ...matchedFacts.map((fact) => `fact: ${fact.key}: ${fact.value}`),
    ...previewEpisodeForget(db, ownerId, topic),
    ...messageIds.map((id) => `message: ${id}`),
    ...questionMatches.map((question) =>
      `question: ${String(question.text ?? "").slice(0, 120)}`,
    ),
    ...relationshipMatches.preview,
    ...perceptionMatches.preview,
  ];
  const targets: ForgetTarget[] = [];
  const push = (
    entityType: string,
    id: number,
    action: ForgetTarget["action"],
  ) => {
    const entityUuid = requireEntityUuid(db, entityType, id);
    if (!entityUuid) return;
    if (
      targets.some(
        (t) => t.entityType === entityType && t.entityUuid === entityUuid,
      )
    ) {
      return;
    }
    targets.push({ entityType, entityUuid, action });
  };
  for (const id of messageIds) push("mem_messages", id, "redact");
  for (const id of episodeIds) push("episodes", id, "redact");
  for (const id of questionIds) push("questions", id, "redact");
  for (const fact of matchedFacts) push("mem_facts", fact.id, "redact");
  for (const target of relationshipMatches.targets) targets.push(target);
  for (const target of perceptionMatches.targets) targets.push(target);

  const linked = [
    ...evidenceTargets(db, ownerId, "message", messageIds),
    ...evidenceTargets(db, ownerId, "episode", episodeIds),
  ];
  for (const link of linked) {
    if (link.type === "fact") push("mem_facts", link.id, "redact");
    if (link.type === "revision") push("learning_revisions", link.id, "redact");
  }

  if (tableHasColumn(db, "delivery_reservations", "entity_uuid")) {
    for (const messageId of messageIds) {
      const rows = db
        .prepare(
          `SELECT id FROM delivery_reservations
           WHERE owner_id = ? AND user_message_id = ?`,
        )
        .all(ownerId, messageId) as Array<{ id: number }>;
      for (const row of rows) {
        push("delivery_reservations", row.id, "redact");
        if (tableExists(db, "delivery_bubbles")) {
          const bubbles = db
            .prepare(
              `SELECT id FROM delivery_bubbles WHERE reservation_id = ?`,
            )
            .all(row.id) as Array<{ id: number }>;
          for (const bubble of bubbles) {
            push("delivery_bubbles", bubble.id, "redact");
          }
        }
      }
    }
  }

  return {
    targets: addOpenCognitiveItemForgetTargets(db, ownerId, targets),
    messageIds,
    episodeIds,
    questionIds,
    matchedFacts,
    preview,
  };
}

function redactQuestions(
  db: DatabaseSync,
  ownerId: string,
  questionIds: number[],
): number {
  if (questionIds.length === 0) return 0;
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `UPDATE questions
         SET text = '[redacted]', status = 'forgotten',
             resolved_at = COALESCE(resolved_at, ?), updated_at = ?
         WHERE owner_id = ? AND id IN (${placeholders(questionIds)})`,
      )
      .run(now, now, ownerId, ...questionIds).changes,
  );
}

function reconcileFacts(
  db: DatabaseSync,
  ownerId: string,
  factIds: number[],
): number {
  let changed = 0;
  for (const factId of [...new Set(factIds)]) {
    const fact = db
      .prepare(
      `SELECT source_message_id, source_quote, origin, superseded_by
       FROM mem_facts WHERE id = ? AND owner_id = ?`,
      )
      .get(factId, ownerId) as {
      source_message_id?: number | null;
      source_quote?: string | null;
      origin?: string;
      superseded_by?: number | null;
    } | undefined;
    if (!fact) continue;
    const remaining = countRows(
      db,
      `SELECT COUNT(*) AS count FROM evidence_links
       WHERE owner_id = ? AND target_type = 'fact' AND target_id = ?`,
      ownerId,
      String(factId),
    );
    if (fact.origin === "explicit_user" && remaining === 0) {
      changed += Number(
        db
          .prepare(
            `UPDATE mem_facts SET superseded_by = id
         WHERE id = ? AND owner_id = ? AND superseded_by IS NULL`,
          )
          .run(factId, ownerId).changes,
      );
    } else if (
      fact.origin === "explicit_user" &&
      fact.superseded_by == null &&
      fact.source_message_id != null
    ) {
      const visible = db
        .prepare(
          `SELECT m.id, m.text
         FROM evidence_links l
         JOIN mem_messages m ON m.id = CAST(l.source_id AS INTEGER)
         WHERE l.owner_id = ? AND l.target_type = 'fact' AND l.target_id = ?
           AND l.source_type = 'message' AND m.role = 'user'
           AND m.redacted_at IS NULL
         ORDER BY m.id DESC`,
        )
        .all(ownerId, String(factId))
        .flatMap((value) => {
          if (!isRow(value)) return [];
          return [{ id: Number(value.id), text: String(value.text ?? "") }];
        });
      const quote = String(fact.source_quote ?? "")
        .normalize("NFC")
        .replace(/\r\n?/g, "\n");
      const replacement = quote
        ? visible.find((candidate) =>
            candidate.text
              .normalize("NFC")
              .replace(/\r\n?/g, "\n")
              .includes(quote),
          )
        : undefined;
      if (replacement && replacement.id !== fact.source_message_id) {
        db.prepare(
          "UPDATE mem_facts SET source_message_id = ? WHERE id = ?",
        ).run(replacement.id, factId);
        changed += 1;
      } else if (!replacement && remaining === 0) {
        changed += Number(
          db
            .prepare(
              "UPDATE mem_facts SET superseded_by = id WHERE id = ? AND superseded_by IS NULL",
            )
            .run(factId).changes,
        );
      }
    }
    redactLinkedAssertion(db, ownerId, factId);
    db.prepare(
      `UPDATE mem_facts
       SET key = '', value = '', source_message_id = NULL, source_quote = NULL
       WHERE id = ? AND owner_id = ? AND superseded_by IS NOT NULL`,
    ).run(factId, ownerId);
  }
  return changed;
}

function c1MemorySchemaPresent(db: DatabaseSync): boolean {
  const tableExists = (table: string): boolean => Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(table));
  return tableExists("memory_assertions") && tableExists("memory_contract_state");
}

function assertionAuthorityEnd(
  authorityFrom: string | null,
  now: string,
): string {
  if (authorityFrom == null || authorityFrom < now) return now;
  const fromMs = Date.parse(authorityFrom);
  const nowMs = Date.parse(now);
  if (Number.isFinite(fromMs) && Number.isFinite(nowMs)) {
    return new Date(Math.max(fromMs + 1, nowMs + 1)).toISOString();
  }
  return `${now}Z`;
}

function redactLinkedAssertion(
  db: DatabaseSync,
  ownerId: string,
  factId: number,
  force = false,
): void {
  if (!c1MemorySchemaPresent(db)) return;
  const fact = db.prepare(
    `SELECT category, key, value, superseded_by
     FROM mem_facts WHERE id = ? AND owner_id = ?`,
  ).get(factId, ownerId) as {
    category?: string;
    key?: string;
    value?: string;
    superseded_by?: number | null;
  } | undefined;
  if (!force &&
    fact &&
    fact.superseded_by == null &&
    (fact.key ?? "") !== "" &&
    (fact.value ?? "") !== ""
  ) return;
  const assertion = db.prepare(
    `SELECT id, authority_from
     FROM memory_assertions
     WHERE owner_id = ? AND legacy_fact_id = ?
     ORDER BY id DESC LIMIT 1`,
  ).get(ownerId, factId) as { id?: number; authority_from?: string | null } | undefined;
  const fallback = assertion?.id == null && fact
    ? db.prepare(
      `SELECT id, authority_from
       FROM memory_assertions
       WHERE owner_id = ? AND kind = 'keyed_fact'
         AND category = ? AND key = ? AND value = ?
       ORDER BY id DESC LIMIT 1`,
    ).get(ownerId, fact.category ?? null, fact.key ?? null, fact.value ?? null) as {
      id?: number;
      authority_from?: string | null;
    } | undefined
    : undefined;
  const target = assertion ?? fallback;
  if (target?.id == null) return;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE memory_assertions
     SET termination_reason = COALESCE(termination_reason, 'forgotten'),
         authority_to = CASE WHEN termination_reason IS NULL THEN ? ELSE authority_to END,
         key = CASE WHEN kind = 'keyed_fact' THEN '' ELSE key END,
         value = CASE WHEN kind = 'keyed_fact' THEN '' ELSE value END,
         source_message_id = NULL, source_quote = NULL, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    assertionAuthorityEnd(target.authority_from ?? null, now),
    now,
    target.id,
    ownerId,
  );
}

/** Redact episode claims without deleting their assertion or correction identity. */
function redactLinkedEpisodeAssertions(
  db: DatabaseSync,
  ownerId: string,
  episodeIds: number[],
): void {
  if (!c1MemorySchemaPresent(db) || episodeIds.length === 0) return;
  const marks = placeholders(episodeIds);
  const assertions = db.prepare(
    `SELECT DISTINCT a.id, a.authority_from
     FROM memory_assertions a
     WHERE a.owner_id = ?
       AND (a.legacy_episode_id IN (${marks}) OR EXISTS (
         SELECT 1 FROM memory_episode_claims c
         WHERE c.assertion_id = a.id AND c.episode_id IN (${marks})
       ))`,
  ).all(ownerId, ...episodeIds, ...episodeIds).flatMap((value) => {
    if (!isRow(value)) return [];
    return [{
      id: Number(value.id),
      authorityFrom: typeof value.authority_from === "string"
        ? value.authority_from
        : null,
    }];
  });
  const now = new Date().toISOString();
  const updateAssertion = db.prepare(
    `UPDATE memory_assertions
     SET termination_reason = COALESCE(termination_reason, 'forgotten'),
         authority_to = CASE WHEN termination_reason IS NULL THEN ? ELSE authority_to END,
         claim_text = CASE WHEN kind <> 'keyed_fact' THEN '' ELSE claim_text END,
         source_message_id = NULL, source_quote = NULL, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  );
  for (const assertion of assertions) {
    if (!Number.isInteger(assertion.id) || assertion.id <= 0) continue;
    updateAssertion.run(
      assertionAuthorityEnd(assertion.authorityFrom, now),
      now,
      assertion.id,
      ownerId,
    );
  }
  db.prepare(
    `UPDATE memory_episode_claims
     SET excerpt = ''
     WHERE episode_id IN (${marks})`,
  ).run(...episodeIds);
}

/** Forget removes sensitive correction wording but preserves correction identity and outcomes. */
function redactMatchingCorrectionContent(
  db: DatabaseSync,
  ownerId: string,
  messageIds: number[],
  episodeIds: number[],
  factIds: number[],
): number {
  if (!c1MemorySchemaPresent(db)) return 0;
  const correctionIds = new Set<number>();
  if (messageIds.length > 0) {
    const marks = placeholders(messageIds);
    for (const value of db.prepare(
      `SELECT id FROM memory_corrections
       WHERE owner_id = ? AND source_message_id IN (${marks})`,
    ).all(ownerId, ...messageIds)) {
      if (isRow(value)) correctionIds.add(Number(value.id));
    }
  }
  if (episodeIds.length > 0 || factIds.length > 0) {
    const factClause = factIds.length > 0
      ? `a.legacy_fact_id IN (${placeholders(factIds)})`
      : "0";
    const episodeClause = episodeIds.length > 0
      ? `(a.legacy_episode_id IN (${placeholders(episodeIds)}) OR EXISTS (
           SELECT 1 FROM memory_episode_claims ec
           WHERE ec.assertion_id = a.id AND ec.episode_id IN (${placeholders(episodeIds)})
         ))`
      : "0";
    const values = db.prepare(
      `SELECT DISTINCT c.id
       FROM memory_corrections c
       JOIN memory_correction_targets t ON t.correction_id = c.id
       JOIN memory_assertions a ON a.id = t.assertion_id
       WHERE c.owner_id = ? AND a.owner_id = ?
         AND (${factClause} OR ${episodeClause})`,
    ).all(
      ownerId,
      ownerId,
      ...factIds,
      ...episodeIds,
      ...episodeIds,
    );
    for (const value of values) {
      if (isRow(value)) correctionIds.add(Number(value.id));
    }
  }
  if (correctionIds.size === 0) return 0;
  const marks = placeholders([...correctionIds]);
  return Number(db.prepare(
    `UPDATE memory_corrections
     SET scope_text = '[redacted]', proposal_json = '{}'
     WHERE owner_id = ? AND id IN (${marks})`,
  ).run(ownerId, ...correctionIds).changes);
}

function assertForgetIntegrity(
  db: DatabaseSync,
  ownerId: string,
  receiptId: string,
  messageIds: number[],
  episodeIds: number[],
  matchedFactIds: number[],
  questionIds: number[],
  openCognitiveItemUuids: string[],
): void {
  if (messageIds.length > 0) {
    const marks = placeholders(messageIds);
    const visibleMessages = countRows(
      db,
      `SELECT COUNT(*) AS count FROM mem_messages
       WHERE owner_id = ? AND id IN (${marks})
         AND (redacted_at IS NULL OR redaction_receipt_id IS NULL
              OR redaction_receipt_id <> ? OR text <> '')`,
      ownerId,
      ...messageIds,
      receiptId,
    );
    const messageEvidence = countRows(
      db,
      `SELECT COUNT(*) AS count FROM evidence_links
       WHERE owner_id = ? AND source_type = 'message'
         AND CAST(source_id AS INTEGER) IN (${marks})`,
      ownerId,
      ...messageIds,
    );
    if (visibleMessages > 0 || messageEvidence > 0) {
      throw new Error("forget_integrity_failed:message");
    }
  }
  if (episodeIds.length > 0) {
    const marks = placeholders(episodeIds);
    const visibleEpisodes = countRows(
      db,
      `SELECT COUNT(*) AS count FROM episodes
       WHERE owner_id = ? AND id IN (${marks})
         AND (status <> 'forgotten' OR summary <> '' OR entities <> '')`,
      ownerId,
      ...episodeIds,
    );
    const episodeEvidence = countRows(
      db,
      `SELECT COUNT(*) AS count FROM evidence_links
       WHERE owner_id = ? AND source_type = 'episode'
         AND CAST(source_id AS INTEGER) IN (${marks})`,
      ownerId,
      ...episodeIds,
    );
    const activeState =
      countRows(
        db,
        `SELECT COUNT(*) AS count FROM mind_state_items
       WHERE owner_id = ? AND status = 'active' AND source_type = 'episode'
         AND CAST(source_id AS INTEGER) IN (${marks})`,
        ownerId,
        ...episodeIds,
      ) +
      countRows(
        db,
        `SELECT COUNT(*) AS count FROM affective_events
       WHERE owner_id = ? AND source_type = 'episode'
         AND CAST(source_id AS INTEGER) IN (${marks})`,
        ownerId,
        ...episodeIds,
      ) +
      countRows(
        db,
        `SELECT COUNT(*) AS count FROM affective_state
       WHERE owner_id = ? AND source_type = 'episode'
         AND CAST(source_id AS INTEGER) IN (${marks})`,
        ownerId,
        ...episodeIds,
      );
    const visibleRuns = countRows(
      db,
      `SELECT COUNT(*) AS count FROM cognitive_runs
       WHERE owner_id = ? AND episode_id IN (${marks}) AND output_json <> '{}'`,
      ownerId,
      ...episodeIds,
    );
    if (visibleEpisodes + episodeEvidence + activeState + visibleRuns > 0) {
      throw new Error("forget_integrity_failed:episode");
    }
  }
  if (matchedFactIds.length > 0) {
    const visibleFacts = countRows(
      db,
      `SELECT COUNT(*) AS count FROM mem_facts
       WHERE owner_id = ? AND id IN (${placeholders(matchedFactIds)})
         AND (superseded_by IS NULL OR key <> '' OR value <> '')`,
      ownerId,
      ...matchedFactIds,
    );
    if (visibleFacts > 0) throw new Error("forget_integrity_failed:fact");
  }
  if (questionIds.length > 0) {
    const visibleQuestions = countRows(
      db,
      `SELECT COUNT(*) AS count FROM questions
       WHERE owner_id = ? AND id IN (${placeholders(questionIds)})
         AND (status <> 'forgotten' OR text <> '[redacted]')`,
      ownerId,
      ...questionIds,
    );
    if (visibleQuestions > 0) {
      throw new Error("forget_integrity_failed:question");
    }
  }
  if (openCognitiveItemUuids.length > 0) {
    const visibleItems = countRows(
      db,
      `SELECT COUNT(*) AS count FROM open_cognitive_items
       WHERE owner_id = ? AND entity_uuid IN (${placeholders(openCognitiveItemUuids)})
         AND (redacted_at IS NULL OR semantic_summary <> '[redacted]')`,
      ownerId,
      ...openCognitiveItemUuids,
    );
    if (visibleItems > 0) {
      throw new Error("forget_integrity_failed:open_cognitive_item");
    }
  }
}

function resolveIdsFromTargets(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
): {
  messageIds: number[];
  episodeIds: number[];
  factIds: number[];
  revisionIds: number[];
  questionIds: number[];
} {
  const messageIds: number[] = [];
  const episodeIds: number[] = [];
  const factIds: number[] = [];
  const revisionIds: number[] = [];
  const questionIds: number[] = [];
  for (const target of targets) {
    const id = idOfEntityUuid(
      db,
      target.entityType,
      target.entityUuid,
      ownerId,
    );
    if (id == null) continue;
    switch (target.entityType) {
      case "mem_messages":
        messageIds.push(id);
        break;
      case "episodes":
        episodeIds.push(id);
        break;
      case "mem_facts":
        factIds.push(id);
        break;
      case "questions":
        questionIds.push(id);
        break;
      case "learning_revisions":
        revisionIds.push(id);
        break;
      case "delivery_reservations":
      case "delivery_bubbles":
        break;
      default:
        break;
    }
  }
  return {
    messageIds: [...new Set(messageIds)],
    episodeIds: [...new Set(episodeIds)],
    factIds: [...new Set(factIds)],
    revisionIds: [...new Set(revisionIds)],
    questionIds: [...new Set(questionIds)],
  };
}

function forgetConversationId(
  db: DatabaseSync,
  ownerId: string,
  messageIds: readonly number[],
  episodeIds: readonly number[],
): string | null {
  const values = new Set<string>();
  if (messageIds.length > 0) {
    for (const row of db.prepare(
      `SELECT DISTINCT thread_id FROM mem_messages
        WHERE owner_id = ? AND id IN (${placeholders(messageIds)})`,
    ).all(ownerId, ...messageIds) as Array<{ thread_id?: unknown }>) {
      if (typeof row.thread_id === "string" && row.thread_id) values.add(row.thread_id);
    }
  }
  if (episodeIds.length > 0) {
    for (const row of db.prepare(
      `SELECT DISTINCT thread_id FROM episodes
        WHERE owner_id = ? AND id IN (${placeholders(episodeIds)})`,
    ).all(ownerId, ...episodeIds) as Array<{ thread_id?: unknown }>) {
      if (typeof row.thread_id === "string" && row.thread_id) values.add(row.thread_id);
    }
  }
  return values.size === 1 ? [...values][0]! : null;
}

function forgetTargetGeneration(db: DatabaseSync, conversationId: string | null): number {
  if (!conversationId || !tableExists(db, "cycle_records")) return 0;
  const row = db.prepare(
    "SELECT MAX(generation) AS generation FROM cycle_records WHERE conversation_id = ?",
  ).get(conversationId) as { generation?: unknown } | undefined;
  const generation = Number(row?.generation ?? 0);
  return Number.isInteger(generation) && generation >= 0 ? generation : 0;
}

function redactDeliveryTargets(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
): void {
  for (const target of targets) {
    if (target.entityType === "delivery_reservations") {
      const id = idOfEntityUuid(
        db,
        "delivery_reservations",
        target.entityUuid,
        ownerId,
      );
      if (id == null) continue;
      db.prepare(
        `UPDATE delivery_reservations SET draft_text = '' WHERE id = ? AND owner_id = ?`,
      ).run(id, ownerId);
    }
    if (target.entityType === "delivery_bubbles") {
      const id = idOfEntityUuid(
        db,
        "delivery_bubbles",
        target.entityUuid,
        null,
      );
      if (id == null) continue;
      db.prepare(`UPDATE delivery_bubbles SET text = '' WHERE id = ?`).run(id);
    }
  }
}

/**
 * Nuclear cascade keyed by entity_uuid targets (idempotent when rows already gone).
 */
function applyForgetTargetsInTransaction(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
  options: { tombstoneId?: string | null; journalChangeId?: string } = {},
): ForgetResult {
  const effectiveTargets = addOpenCognitiveItemForgetTargets(
    db,
    ownerId,
    targets,
  );
  const { messageIds, episodeIds, factIds, revisionIds, questionIds } =
    resolveIdsFromTargets(db, ownerId, effectiveTargets);
  const openCognitiveItemUuids = [
    ...new Set(
      effectiveTargets
        .filter((target) => target.entityType === "open_cognitive_items")
        .map((target) => target.entityUuid),
    ),
  ];
  const episodeMarks = placeholders(episodeIds);
  const stateReconciled =
    episodeIds.length === 0
      ? 0
      : countRows(
          db,
          `SELECT COUNT(*) AS count FROM mind_state_items
       WHERE owner_id = ? AND status = 'active' AND source_type = 'episode'
         AND CAST(source_id AS INTEGER) IN (${episodeMarks})`,
          ownerId,
          ...episodeIds,
        ) +
        countRows(
          db,
          `SELECT COUNT(*) AS count FROM affective_events
       WHERE owner_id = ? AND source_type = 'episode'
         AND CAST(source_id AS INTEGER) IN (${episodeMarks})`,
          ownerId,
          ...episodeIds,
        );
  const runsRedacted =
    episodeIds.length === 0
      ? 0
      : countRows(
          db,
          `SELECT COUNT(*) AS count FROM cognitive_runs
     WHERE owner_id = ? AND episode_id IN (${episodeMarks})
       AND output_json <> '{}'`,
          ownerId,
          ...episodeIds,
        );
  const evidenceBefore =
    evidenceTargets(db, ownerId, "message", messageIds).length +
    evidenceTargets(db, ownerId, "episode", episodeIds).length;
  const receiptId = randomUUID();
  if (tableHasColumn(db, "forget_receipts", "tombstone_id")) {
    db.prepare(
      `INSERT INTO forget_receipts
         (id, owner_id, created_at, tombstone_id, category_counts_json, external_non_erasure_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      receiptId,
      ownerId,
      new Date().toISOString(),
      options.tombstoneId ?? null,
      JSON.stringify(categoryCountsFromTargets(effectiveTargets)),
      JSON.stringify(DEFAULT_HONESTY),
    );
  } else {
    db.prepare(
      `INSERT INTO forget_receipts (id, owner_id, created_at)
       VALUES (?, ?, ?)`,
    ).run(receiptId, ownerId, new Date().toISOString());
  }

  // Governed forget redacts correction wording in the same transaction. The
  // correction row, class, targets, and outcomes remain durable history.
  redactMatchingCorrectionContent(
    db,
    ownerId,
    messageIds,
    episodeIds,
    factIds,
  );

  let factsForgotten = 0;
  for (const factId of factIds) {
    // The assertion is the semantic owner of the ending. The compatibility
    // row is updated only after this write succeeds in the same transaction.
    redactLinkedAssertion(db, ownerId, factId, true);
    factsForgotten += Number(
      db
        .prepare(
          `UPDATE mem_facts SET superseded_by = id
             WHERE id = ? AND owner_id = ? AND superseded_by IS NULL`,
        )
        .run(factId, ownerId).changes,
    );
  }
  let episodesForgotten = 0;
  if (episodeIds.length > 0) {
    episodesForgotten = forgetEpisodesByIds(db, ownerId, episodeIds, true);
  }
  redactQuestions(db, ownerId, questionIds);
  let messageEvidenceRemoved = 0;
  if (messageIds.length > 0) {
    messageEvidenceRemoved = Number(
      db
        .prepare(
          `DELETE FROM evidence_links
       WHERE owner_id = ? AND source_type = 'message'
         AND CAST(source_id AS INTEGER) IN (${placeholders(messageIds)})`,
        )
        .run(ownerId, ...messageIds).changes,
    );
  }
  const messagesRedacted = redactMessages(db, ownerId, messageIds, receiptId);
  redactDeliveryTargets(db, ownerId, targets);
  redactRelationshipTargets(db, ownerId, targets);
  recomputeSharedCulture(db, ownerId);
  redactPerceptionTargets(db, ownerId, targets);
  redactOpenCognitiveItems(db, ownerId, effectiveTargets);
  detachRelationshipMotivations(
    db,
    ownerId,
    targets
      .filter((target) => target.entityType !== "relationship_motivation_claim")
      .map((target) => target.entityUuid),
  );
  const factChanges = reconcileFacts(db, ownerId, factIds);
  const revisionChanges = reconcileUnsupportedRevisions(
    db,
    ownerId,
    revisionIds,
  );
  if (revisionIds.length > 0) {
    db.prepare(
      `UPDATE learning_revisions
       SET target_key = '[redacted]', previous_value = NULL,
           proposed_value = '', rationale = '[redacted]', updated_at = ?
       WHERE owner_id = ? AND id IN (${placeholders(revisionIds)})
         AND NOT EXISTS (
           SELECT 1 FROM evidence_links l
           WHERE l.owner_id = learning_revisions.owner_id
             AND l.target_type = 'revision'
             AND l.target_id = CAST(learning_revisions.id AS TEXT)
         )`,
    ).run(new Date().toISOString(), ownerId, ...revisionIds);
  }
  const counts: ForgetCounts = {
    messagesRedacted,
    episodesForgotten,
    factsReconciled: Math.max(factsForgotten, factChanges, factIds.length),
    revisionsReconciled: Math.max(revisionChanges, revisionIds.length),
    stateReconciled,
    evidenceRemoved: Math.max(evidenceBefore, messageEvidenceRemoved),
    runsRedacted,
  };
  db.prepare(
    `UPDATE forget_receipts
     SET messages_redacted = ?, episodes_forgotten = ?,
         facts_reconciled = ?, revisions_reconciled = ?,
         state_reconciled = ?, evidence_removed = ?, runs_redacted = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    counts.messagesRedacted,
    counts.episodesForgotten,
    counts.factsReconciled,
    counts.revisionsReconciled,
    counts.stateReconciled,
    counts.evidenceRemoved,
    counts.runsRedacted,
    receiptId,
    ownerId,
  );
  assertForgetIntegrity(
    db,
    ownerId,
    receiptId,
    messageIds,
    episodeIds,
    factIds,
    questionIds,
    openCognitiveItemUuids,
  );
  if (options.journalChangeId && effectiveTargets.length > 0 && hasAuthorityBarrier(db)) {
    const conversationId = forgetConversationId(db, ownerId, messageIds, episodeIds);
    recordDerivedInvalidationInTransaction({
      db,
      changeId: options.journalChangeId,
      ownerId,
      conversationId,
      sourceRefs: effectiveTargets.map((target) => `${target.entityType}:${target.entityUuid}`),
      invalidationKind: "forget",
      canonicalOwner: "nuclear",
      targetGeneration: forgetTargetGeneration(db, conversationId),
      nowMs: Date.now(),
    });
  }
  return {
    preview: [],
    deleted: messagesRedacted + episodesForgotten + factsForgotten,
    receiptId,
    counts,
    honesty: DEFAULT_HONESTY,
    tombstoneId: options.tombstoneId ?? null,
    categoryCounts: categoryCountsFromTargets(effectiveTargets),
  };
}

export function applyForgetTargets(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
  options: { tombstoneId?: string | null; inTransaction?: boolean } = {},
): ForgetResult {
  if (options.inTransaction === true) {
    if (!hasAuthorityBarrier(db)) return applyForgetTargetsInTransaction(db, ownerId, targets, options);
    const transition = beginAuthorityTransitionInExistingTransaction(db, "forget", Date.now());
    try {
      const result = applyForgetTargetsInTransaction(db, ownerId, targets, {
        ...options,
        journalChangeId: options.tombstoneId ? `forget:${options.tombstoneId}` : `forget:${randomUUID()}`,
      });
      stabilizeAuthorityBarrierInExistingTransaction(
        db,
        (db.prepare("SELECT owner_name, version FROM canonical_owner_versions").all() as Array<{ owner_name: string; version: number }>)
          .reduce((vector, row) => ({ ...vector, [row.owner_name]: Number(row.version) }), { nuclear: 0, continuity: 0, cognitive_sidecar: 0 } as { nuclear: number; continuity: number; cognitive_sidecar: number }),
        Date.now(),
        transition.transitionId,
      );
      return result;
    } catch (error) {
      throw error;
    }
  }
  const transition: AuthorityTransitionToken | null = hasAuthorityBarrier(db)
    ? beginAuthorityTransition(db, "forget", Date.now())
    : null;
  const journalChangeId = transition
    ? options.tombstoneId ? `forget:${options.tombstoneId}` : `forget:${randomUUID()}`
    : undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = applyForgetTargetsInTransaction(db, ownerId, targets, { ...options, journalChangeId });
    db.exec("COMMIT");
    if (transition) {
      const rows = db.prepare("SELECT owner_name, version FROM canonical_owner_versions").all() as Array<{ owner_name: string; version: number }>;
      const vector = rows.reduce((value, row) => ({ ...value, [row.owner_name]: Number(row.version) }), { nuclear: 0, continuity: 0, cognitive_sidecar: 0 } as { nuclear: number; continuity: number; cognitive_sidecar: number });
      stabilizeAuthorityBarrier(db, vector, Date.now(), transition.transitionId);
    }
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* preserve canonical failure */ }
    if (transition) {
      try { markAuthorityBarrierReconciling(db, "forget_commit_failed", Date.now()); } catch { /* preserve original */ }
    }
    throw error;
  }
}

export function replayPendingTombstones(
  continuity: DatabaseSync,
  nuclear: DatabaseSync,
): void {
  const lineageId = getAuthoritativeLineageId(continuity);
  const stones = listPendingOrAppliedTombstones(continuity, lineageId);
  for (const stone of stones) {
    const targets = listTombstoneTargets(continuity, stone.tombstoneId);
    if (targets.length === 0) {
      if (stone.status === "pending") {
        markTombstoneApplied(continuity, stone.tombstoneId, null);
      }
      continue;
    }
    const result = applyForgetTargets(nuclear, stone.ownerId, targets, {
      tombstoneId: stone.tombstoneId,
    });
    if (stone.status === "pending") {
      markTombstoneApplied(continuity, stone.tombstoneId, result.receiptId);
    }
  }
}

export type ForgetOwnerOptions = {
  continuity?: DatabaseSync | null;
  previewId?: string | null;
  confirmationDiscordMessageId?: string | null;
  cancel?: boolean;
  inTransaction?: boolean;
};

export function forgetOwnerTopic(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
  confirmed: boolean,
  options: ForgetOwnerOptions = {},
): ForgetResult {
  const continuity = options.continuity ?? null;
  if (options.cancel && options.previewId && continuity) {
    cancelForgetPreview(continuity, options.previewId, ownerId);
    return {
      preview: [],
      deleted: 0,
      receiptId: null,
      counts: emptyCounts(),
      previewId: options.previewId,
      honesty: DEFAULT_HONESTY,
    };
  }

  // Hard invariant: destructive confirmation requires preview_id only.
  if (confirmed) {
    if (!options.previewId?.trim()) {
      throw new Error("forget_preview_id_required");
    }
    if (!continuity) {
      throw new Error("continuity_unavailable");
    }
    const { tombstoneId, targets, categoryCounts } = confirmPreviewToTombstone(
      continuity,
      { previewId: options.previewId.trim(), ownerId },
    );
    if (targets.length === 0) {
      throw new Error("forget_preview_targets_missing");
    }
    // Exact stored targets only — never recompute from topic / topicHint.
    const result = applyForgetTargets(db, ownerId, targets, {
      tombstoneId,
      inTransaction: options.inTransaction,
    });
    markTombstoneApplied(continuity, tombstoneId, result.receiptId);
    return {
      ...result,
      previewId: options.previewId.trim(),
      categoryCounts,
      tombstoneId,
      honesty: DEFAULT_HONESTY,
    };
  }

  const cleanTopic = topic.trim();
  if (!cleanTopic) {
    return { preview: [], deleted: 0, receiptId: null, counts: emptyCounts() };
  }

  if (!continuity) {
    throw new Error("continuity_unavailable");
  }

  const built = buildTargetsForTopic(db, ownerId, cleanTopic);
  if (built.targets.length === 0) {
    return {
      preview: built.preview,
      deleted: 0,
      receiptId: null,
      counts: emptyCounts(),
    };
  }
  const categoryCounts = categoryCountsFromTargets(built.targets);
  const created = createForgetPreview(continuity, {
    ownerId,
    targets: built.targets,
    categoryCounts,
    confirmationDiscordMessageId: options.confirmationDiscordMessageId,
    topicDiagnosticFingerprint: topicFingerprint(ownerId, cleanTopic),
  });
  return {
    preview: built.preview,
    deleted: 0,
    receiptId: null,
    counts: emptyCounts(),
    previewId: created.previewId,
    expiresAt: created.expiresAt,
    categoryCounts: created.categoryCounts,
    honesty: DEFAULT_HONESTY,
  };
}

/**
 * Auto-forget helper: build a durable preview then confirm by preview_id.
 * Never confirms by raw topic.
 */
export function forgetOwnerTopicImmediate(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
  continuity: DatabaseSync,
): ForgetResult {
  const preview = forgetOwnerTopic(db, ownerId, topic, false, { continuity });
  if (!preview.previewId) {
    return preview;
  }
  return forgetOwnerTopic(db, ownerId, "", true, {
    continuity,
    previewId: preview.previewId,
  });
}
