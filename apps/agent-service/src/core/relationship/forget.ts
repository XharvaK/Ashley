import type { DatabaseSync } from "node:sqlite";
import type { ForgetTarget } from "../continuity/forget-preview.js";
import {
  consentCurrentlyEligible,
  recordConsentEvent,
} from "./consent.js";
import type { DataClassification } from "../privacy/classification.js";

const RELATIONSHIP_TABLES: Array<{ entityType: string; table: string; textColumn?: string }> = [
  { entityType: "doc_reminder", table: "doc_reminders" },
  { entityType: "ashley_self_commitment", table: "ashley_self_commitments" },
  { entityType: "mutual_commitment", table: "mutual_commitments" },
  { entityType: "scheduled_proactive", table: "scheduled_proactive_messages" },
  { entityType: "relational_tension", table: "relational_tensions" },
  { entityType: "withdrawal", table: "withdrawal_records" },
  { entityType: "relationship_motivation_claim", table: "relationship_motivation_claims" },
  { entityType: "repair_proposal", table: "repair_proposals", textColumn: "repair_text" },
];

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

const C5_FORGET_TABLES = [
  {
    entityType: "relationship_projection",
    table: "relationship_projections",
    searchColumns: ["source_bindings_json", "source_watermark_json"],
  },
  {
    entityType: "interaction_contract",
    table: "interaction_contracts",
    searchColumns: ["scope", "audience", "evidence_refs_json", "typed_evidence_json"],
  },
  {
    entityType: "consent_record",
    table: "consent_records",
    searchColumns: ["scope", "purpose", "evidence_or_decision_ref"],
  },
  {
    entityType: "repair_evidence",
    table: "repair_evidence",
    searchColumns: ["evidence_refs_json"],
  },
  {
    entityType: "repair_adjudication",
    table: "repair_adjudications",
    searchColumns: ["evidence_refs_json", "delivery_receipt_id"],
  },
] as const;

function addTarget(
  targets: ForgetTarget[],
  entityType: string,
  entityUuid: unknown,
  action: ForgetTarget["action"],
): void {
  const uuid = String(entityUuid ?? "").trim();
  if (!uuid) return;
  if (targets.some((target) => target.entityType === entityType && target.entityUuid === uuid)) {
    return;
  }
  targets.push({ entityType, entityUuid: uuid, action });
}

function topicSearchValues(
  db: DatabaseSync,
  ownerId: string,
  needle: string,
): string[] {
  const values = new Set<string>();
  for (const table of ["mem_messages", "episodes", "questions", "mem_facts"]) {
    if (!tableExists(db, table) || !tableHasColumn(db, table, "entity_uuid")) continue;
    const textColumn = table === "episodes"
      ? "summary"
      : table === "mem_facts"
        ? "value"
        : "text";
    if (!tableHasColumn(db, table, textColumn) || !tableHasColumn(db, table, "owner_id")) continue;
    const rows = db.prepare(
      `SELECT entity_uuid FROM ${table}
       WHERE owner_id = ? AND LOWER(COALESCE(${textColumn}, '')) LIKE ?`,
    ).all(ownerId, `%${needle}%`) as Array<{ entity_uuid?: string }>;
    for (const row of rows) {
      const uuid = String(row.entity_uuid ?? "").trim();
      if (uuid) values.add(uuid);
    }
  }
  return [...values];
}

function addC5ForgetTargets(
  db: DatabaseSync,
  ownerId: string,
  needle: string,
  targets: ForgetTarget[],
  preview: string[],
): void {
  const hadAuthoritativeMatch = targets.length > 0;
  const refs = new Set<string>([
    needle,
    ...targets.map((target) => target.entityUuid),
    ...topicSearchValues(db, ownerId, needle),
  ]);
  const patterns = [...refs]
    .map((ref) => ref.trim().toLowerCase())
    .filter(Boolean)
    .map((ref) => `%${ref}%`);
  if (patterns.length === 0) return;

  for (const spec of C5_FORGET_TABLES) {
    if (!tableExists(db, spec.table) || !tableHasColumn(db, spec.table, "entity_uuid") ||
        !tableHasColumn(db, spec.table, "owner_id")) continue;
    const searchable = spec.searchColumns.filter((column) => tableHasColumn(db, spec.table, column));
    if (searchable.length === 0) continue;
    const clauses = searchable.flatMap((column) =>
      patterns.map(() => `LOWER(COALESCE(${column}, '')) LIKE ?`),
    );
    const rows = db.prepare(
      `SELECT entity_uuid FROM ${spec.table}
       WHERE owner_id = ? AND (${clauses.join(" OR ")})`,
    ).all(ownerId, ...searchable.flatMap(() => patterns)) as Array<{ entity_uuid?: string }>;
    for (const row of rows) {
      addTarget(targets, spec.entityType, row.entity_uuid, "detach");
      preview.push(`${spec.entityType}: dependent C5 state`);
    }
  }

  // A matched authoritative source invalidates the current projection even
  // when its source bindings contain only numeric ids or hashes.
  if (hadAuthoritativeMatch && tableExists(db, "relationship_projections") &&
      tableHasColumn(db, "relationship_projections", "entity_uuid")) {
    const current = db.prepare(
      `SELECT entity_uuid FROM relationship_projections
       WHERE owner_id = ? AND kind = 'current_shared_culture'
         AND effective_to IS NULL`,
    ).get(ownerId) as { entity_uuid?: string } | undefined;
    if (current?.entity_uuid) {
      addTarget(targets, "relationship_projection", current.entity_uuid, "detach");
    }
  }
}

export function listRelationshipForgetTargets(
  db: DatabaseSync,
  ownerId: string,
  topic: string,
): { targets: ForgetTarget[]; preview: string[] } {
  const needle = topic.trim().toLowerCase();
  if (!needle) return { targets: [], preview: [] };
  const targets: ForgetTarget[] = [];
  const preview: string[] = [];
  for (const spec of RELATIONSHIP_TABLES) {
    if (!tableExists(db, spec.table)) continue;
    if (spec.table === "relationship_motivation_claims") {
      const rows = db
        .prepare(
          `SELECT entity_uuid FROM relationship_motivation_claims
           WHERE owner_id = ? AND relationship_entity_uuid IN (
             SELECT entity_uuid FROM doc_reminders
             WHERE owner_id = ? AND LOWER(text) LIKE ?
           )`,
        )
        .all(ownerId, ownerId, `%${needle}%`) as Array<{ entity_uuid?: string }>;
      for (const row of rows) {
        const entityUuid = String(row.entity_uuid ?? "");
        if (!entityUuid) continue;
        targets.push({
          entityType: spec.entityType,
          entityUuid,
          action: "redact",
        });
      }
      continue;
    }
    const textColumn = spec.textColumn ?? "text";
    if (!tableHasColumn(db, spec.table, textColumn)) continue;
    const rows = db
      .prepare(
        `SELECT entity_uuid, ${textColumn} AS text FROM ${spec.table}
         WHERE owner_id = ? AND LOWER(${textColumn}) LIKE ?`,
      )
      .all(ownerId, `%${needle}%`) as Array<{
      entity_uuid?: string;
      text?: string;
    }>;
    for (const row of rows) {
      const entityUuid = String(row.entity_uuid ?? "");
      if (!entityUuid) continue;
      if (
        targets.some(
          (target) =>
            target.entityType === spec.entityType &&
            target.entityUuid === entityUuid,
        )
      ) {
        continue;
      }
      targets.push({
        entityType: spec.entityType,
        entityUuid,
        action: "redact",
      });
      preview.push(`${spec.entityType}: ${String(row.text ?? "").slice(0, 120)}`);
    }
  }
  addC5ForgetTargets(db, ownerId, needle, targets, preview);
  return { targets, preview };
}

function validIntervalEnd(effectiveFrom: unknown, nowIso: string): string {
  const start = Date.parse(String(effectiveFrom ?? ""));
  const now = Date.parse(nowIso);
  const end = Number.isFinite(start) ? Math.max(start + 1, now) : now;
  return new Date(end).toISOString();
}

function detachRepairState(
  db: DatabaseSync,
  ownerId: string,
  proposalId: number,
): number {
  const proposal = db.prepare(
    `SELECT tension_id FROM repair_proposals
     WHERE id = ? AND owner_id = ?`,
  ).get(proposalId, ownerId) as { tension_id?: number | null } | undefined;
  if (!proposal) return 0;
  let changed = Number(
    db.prepare(
      `UPDATE repair_proposals
       SET repair_text = '[redacted]', lifecycle_state = 'withdrawn'
       WHERE id = ? AND owner_id = ? AND repair_text <> '[redacted]'`,
    ).run(proposalId, ownerId).changes,
  );
  if (proposal.tension_id != null) {
    changed += Number(
      db.prepare(
        `UPDATE relational_tensions
         SET repair_status = 'none', repair_proposal_id = NULL,
             updated_at = ?
         WHERE id = ? AND owner_id = ?`,
      ).run(new Date().toISOString(), proposal.tension_id, ownerId).changes,
    );
  }
  return changed;
}

function redactC5Target(
  db: DatabaseSync,
  ownerId: string,
  target: ForgetTarget,
): number | null {
  const now = new Date().toISOString();
  if (target.entityType === "relationship_projection") {
    const row = db.prepare(
      `SELECT id, kind, effective_from, effective_to
       FROM relationship_projections
       WHERE entity_uuid = ? AND owner_id = ?`,
    ).get(target.entityUuid, ownerId) as {
      id?: number;
      kind?: string;
      effective_from?: string;
      effective_to?: string | null;
    } | undefined;
    if (!row?.id || row.kind !== "current_shared_culture" || row.effective_to != null) return 0;
    return Number(
      db.prepare(
        `UPDATE relationship_projections
         SET kind = 'historical_as_of', effective_to = ?
         WHERE id = ? AND owner_id = ? AND kind = 'current_shared_culture'
           AND effective_to IS NULL`,
      ).run(validIntervalEnd(row.effective_from, now), row.id, ownerId).changes,
    );
  }

  if (target.entityType === "interaction_contract") {
    const row = db.prepare(
      `SELECT id, kind, lifecycle_state, effective_from
       FROM interaction_contracts
       WHERE entity_uuid = ? AND owner_id = ?`,
    ).get(target.entityUuid, ownerId) as {
      id?: number;
      kind?: string;
      lifecycle_state?: string;
      effective_from?: string;
    } | undefined;
    if (!row?.id || row.lifecycle_state === "withdrawn" || row.lifecycle_state === "superseded") return 0;
    if (row.kind === "implicit_hypothesis") {
      // Hypotheses remain hypotheses; ending their interval prevents binding
      // without turning a hypothesis into an accepted contract state.
      return Number(
        db.prepare(
          `UPDATE interaction_contracts SET effective_to = ?,
             correction_refs_json = ?
           WHERE id = ? AND owner_id = ? AND effective_to IS NULL`,
        ).run(validIntervalEnd(row.effective_from, now), JSON.stringify(["forget"]), row.id, ownerId).changes,
      );
    }
    return Number(
      db.prepare(
        `UPDATE interaction_contracts
         SET lifecycle_state = 'withdrawn', effective_to = ?,
             correction_refs_json = ?
         WHERE id = ? AND owner_id = ? AND lifecycle_state NOT IN ('withdrawn', 'superseded')`,
      ).run(validIntervalEnd(row.effective_from, now), JSON.stringify(["forget"]), row.id, ownerId).changes,
    );
  }

  if (target.entityType === "consent_record") {
    const row = db.prepare(
      `SELECT id, owner_id, grantor_identity_role, grantee_or_consumer,
              scope, purpose, classification, event_kind
       FROM consent_records WHERE entity_uuid = ? AND owner_id = ?`,
    ).get(target.entityUuid, ownerId) as Record<string, unknown> | undefined;
    const id = Number(row?.id ?? 0);
    if (!row || !id || String(row.event_kind) !== "grant" ||
        !consentCurrentlyEligible(db, id)) return 0;
    const alreadyRevoked = db.prepare(
      `SELECT 1 FROM consent_records
       WHERE owner_id = ? AND supersedes_consent_id = ?
         AND event_kind IN ('revoke', 'expire', 'supersede') LIMIT 1`,
    ).get(ownerId, id);
    if (alreadyRevoked) return 0;
    recordConsentEvent(db, {
      ownerId,
      grantorIdentityRole: String(row.grantor_identity_role) as "doc" | "ashley",
      granteeOrConsumer: String(row.grantee_or_consumer),
      scope: String(row.scope),
      purpose: String(row.purpose),
      evidenceOrDecisionRef: `forget:${target.entityUuid}`,
      classification: String(row.classification) as DataClassification,
      eventKind: "revoke",
      supersedesConsentId: id,
      grantedAt: now,
      effectiveFrom: now,
    });
    return 1;
  }

  if (target.entityType === "repair_evidence") {
    const row = db.prepare(
      `SELECT proposal_id FROM repair_evidence
       WHERE entity_uuid = ? AND owner_id = ?`,
    ).get(target.entityUuid, ownerId) as { proposal_id?: number } | undefined;
    return row?.proposal_id == null ? 0 : detachRepairState(db, ownerId, Number(row.proposal_id));
  }

  if (target.entityType === "repair_adjudication") {
    const row = db.prepare(
      `SELECT proposal_id FROM repair_adjudications
       WHERE entity_uuid = ? AND owner_id = ?`,
    ).get(target.entityUuid, ownerId) as { proposal_id?: number } | undefined;
    return row?.proposal_id == null ? 0 : detachRepairState(db, ownerId, Number(row.proposal_id));
  }

  return null;
}

export function redactRelationshipTargets(
  db: DatabaseSync,
  ownerId: string,
  targets: ForgetTarget[],
): number {
  let changed = 0;
  for (const target of targets) {
    const c5Changed = redactC5Target(db, ownerId, target);
    if (c5Changed !== null) {
      changed += c5Changed;
      continue;
    }
    const spec = RELATIONSHIP_TABLES.find(
      (row) => row.entityType === target.entityType,
    );
    if (!spec || !tableExists(db, spec.table)) continue;
    const row = db
      .prepare(
        `SELECT id FROM ${spec.table}
         WHERE entity_uuid = ? AND owner_id = ?`,
      )
      .get(target.entityUuid, ownerId) as { id?: number } | undefined;
    if (!row?.id) continue;
    if (spec.table === "relationship_motivation_claims") {
      changed += Number(
        db
          .prepare(
            `UPDATE relationship_motivation_claims
             SET claim_state = 'released', updated_at = ?
             WHERE id = ? AND owner_id = ?`,
          )
          .run(new Date().toISOString(), row.id, ownerId).changes,
      );
      continue;
    }
    if (spec.table === "repair_proposals") {
      changed += detachRepairState(db, ownerId, Number(row.id));
      continue;
    }
    changed += Number(
      db
        .prepare(
          `UPDATE ${spec.table}
           SET text = '[redacted]', status = ?, updated_at = ?
           WHERE id = ? AND owner_id = ?`,
        )
        .run(
          redactedStatusForTable(spec.table),
          new Date().toISOString(),
          row.id,
          ownerId,
        ).changes,
    );
  }
  return changed;
}

function redactedStatusForTable(table: string): string {
  switch (table) {
    case "doc_reminders":
    case "scheduled_proactive_messages":
      return "cancelled";
    case "ashley_self_commitments":
      return "forgotten";
    case "mutual_commitments":
      return "released";
    case "relational_tensions":
      return "resolved";
    case "withdrawal_records":
      return "lifted";
    default:
      return "cancelled";
  }
}

export function detachRelationshipMotivations(
  db: DatabaseSync,
  ownerId: string,
  entityUuids: string[],
): number {
  if (entityUuids.length === 0) return 0;
  const placeholders = entityUuids.map(() => "?").join(", ");
  const now = new Date().toISOString();
  let changed = 0;
  changed += Number(
    db
      .prepare(
        `UPDATE motivations SET consumed_at = COALESCE(consumed_at, ?)
         WHERE owner_id = ? AND ref_id IN (${placeholders})`,
      )
      .run(now, ownerId, ...entityUuids).changes,
  );
  if (tableExists(db, "relationship_motivation_claims")) {
    changed += Number(
      db
        .prepare(
          `UPDATE relationship_motivation_claims
           SET claim_state = 'released', updated_at = ?
           WHERE owner_id = ? AND relationship_entity_uuid IN (${placeholders})
             AND claim_state = 'claimed'`,
        )
        .run(now, ownerId, ...entityUuids).changes,
    );
  }
  if (tableExists(db, "decision_log")) {
    for (const entityUuid of entityUuids) {
      const decisions = db
        .prepare(
          `SELECT id, evidence_refs_json FROM decision_log
           WHERE owner_id = ? AND evidence_refs_json LIKE ?`,
        )
        .all(ownerId, `%${entityUuid}%`) as Array<{
        id?: number;
        evidence_refs_json?: string;
      }>;
      for (const decision of decisions) {
        if (!decision.evidence_refs_json) continue;
        try {
          const refs = JSON.parse(decision.evidence_refs_json) as Array<{
            id?: string;
          }>;
          const filtered = refs.filter((ref) => ref.id !== entityUuid);
          if (filtered.length === refs.length) continue;
          if (decision.id == null) continue;
          db.prepare(
            `UPDATE decision_log SET evidence_refs_json = ? WHERE id = ?`,
          ).run(JSON.stringify(filtered), decision.id);
          changed += 1;
        } catch {
          /* ignore malformed */
        }
      }
    }
  }
  return changed;
}
