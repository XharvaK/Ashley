import type { DatabaseSync } from "node:sqlite";
import { listIdentity, reviseOpinion } from "../identity/store.js";
import type { CognitionMode, EvidenceProvenance } from "../types.js";

export type RevisionLayer = "dynamic_identity" | "stable_identity" | "opinion";

export type LearningRevision = {
  id: number;
  ownerId: string;
  targetLayer: RevisionLayer;
  targetKey: string;
  previousValue: string | null;
  proposedValue: string;
  rationale: string;
  status: "proposed" | "applied" | "reverted" | "rejected";
  applyAfter: string;
  provenance: EvidenceProvenance;
  createdAt: string;
  updatedAt: string;
  appliedTargetId: number | null;
  evidenceCount?: number;
  evidenceSpanDays?: number;
};

export type IdentityReview = {
  id: number;
  ownerId: string;
  revisionId: number;
  targetKind: "value" | "boundary";
  targetKey: string;
  proposedValue: string;
  ashleyPosition: "affirm" | "object" | "defer" | null;
  ashleyRationale: string | null;
  ashleyEvidenceType: string | null;
  ashleyEvidenceId: string | null;
  docDecision: "approve" | "reject" | "defer" | null;
  docRationale: string | null;
  appliedAt: string | null;
  updatedAt: string;
};

type Row = Record<string, unknown>;

function mapRevision(value: unknown): LearningRevision | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Row;
  const layer = String(row.target_layer);
  const status = String(row.status);
  if (!(["dynamic_identity", "stable_identity", "opinion"] as string[]).includes(layer)) return null;
  if (!(["proposed", "applied", "reverted", "rejected"] as string[]).includes(status)) return null;
  return {
    id: Number(row.id),
    ownerId: String(row.owner_id),
    targetLayer: layer as RevisionLayer,
    targetKey: String(row.target_key),
    previousValue: typeof row.previous_value === "string" ? row.previous_value : null,
    proposedValue: String(row.proposed_value),
    rationale: String(row.rationale),
    status: status as LearningRevision["status"],
    applyAfter: String(row.apply_after),
    provenance: row.provenance === "live" ? "live" : "shadow",
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    appliedTargetId:
      row.applied_target_id == null ? null : Number(row.applied_target_id),
    evidenceCount:
      row.evidence_count == null ? undefined : Number(row.evidence_count),
    evidenceSpanDays:
      row.evidence_span_days == null ? undefined : Number(row.evidence_span_days),
  };
}

function latestValue(
  db: DatabaseSync,
  ownerId: string,
  layer: RevisionLayer,
  key: string,
): string | null {
  if (layer === "opinion") {
    const row = db.prepare(
      "SELECT stance FROM opinions WHERE owner_id = ? AND topic = ? ORDER BY id DESC LIMIT 1",
    ).get(ownerId, key) as { stance?: string } | undefined;
    return row?.stance ?? null;
  }
  const identityLayer = layer === "stable_identity" ? "stable" : "dynamic";
  const entry = listIdentity(db, ownerId, { layer: identityLayer, limit: 100 })
    .filter((item) => item.kind === key)
    .at(-1);
  return entry?.text ?? null;
}

function appendIdentityRevision(
  db: DatabaseSync,
  input: {
    ownerId: string;
    layer: "stable" | "dynamic";
    kind: string;
    text: string;
    revisedFrom: number | null;
  },
): number {
  const now = new Date().toISOString();
  const result = db.prepare(
    `INSERT INTO identity_entries
       (owner_id, layer, kind, text, source, revised_from, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'organic', ?, ?, ?)`,
  ).run(
    input.ownerId,
    input.layer,
    input.kind,
    input.text,
    input.revisedFrom,
    now,
    now,
  );
  return Number(result.lastInsertRowid);
}

function foundationalKind(
  layer: RevisionLayer,
  key: string,
): "value" | "boundary" | null {
  if (layer !== "stable_identity") return null;
  if (key.startsWith("value.")) return "value";
  if (key.startsWith("boundary.")) return "boundary";
  return null;
}

export function proposeRevision(
  db: DatabaseSync,
  input: {
    ownerId: string;
    targetLayer: RevisionLayer;
    targetKey: string;
    proposedValue: string;
    rationale: string;
    evidenceType: string;
    evidenceId: string | number;
    provenance?: EvidenceProvenance;
  },
): number {
  const key = input.targetKey.trim().slice(0, 120);
  const value = input.proposedValue.trim().slice(0, 1000);
  const provenance = input.provenance ?? "shadow";
  if (!key || !value) return 0;
  if (/^(?:vision|core_principle)\./.test(key)) return 0;
  if (
    input.targetLayer !== "opinion" &&
    !/^[a-z][a-z0-9_]*\.[a-z0-9_.-]+$/.test(key)
  ) {
    return 0;
  }
  const existing = db.prepare(
    `SELECT id FROM learning_revisions
     WHERE owner_id = ? AND target_layer = ? AND target_key = ?
       AND lower(proposed_value) = lower(?) AND status = 'proposed'
       AND provenance = ?
     ORDER BY id DESC LIMIT 1`,
  ).get(input.ownerId, input.targetLayer, key, value, provenance) as { id?: number } | undefined;
  const now = new Date();
  let id = existing?.id ?? 0;
  if (!id) {
    const applyAfter = new Date(
      now.getTime() + (input.targetLayer === "stable_identity" ? 72 * 3_600_000 : 0),
    ).toISOString();
    const result = db.prepare(
      `INSERT INTO learning_revisions
         (owner_id, target_layer, target_key, previous_value, proposed_value,
          rationale, status, apply_after, applied_at, reverted_at,
          created_at, updated_at, provenance)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, NULL, NULL, ?, ?, ?)`,
    ).run(
      input.ownerId,
      input.targetLayer,
      key,
      latestValue(db, input.ownerId, input.targetLayer, key),
      value,
      input.rationale.trim().slice(0, 1000),
      applyAfter,
      now.toISOString(),
      now.toISOString(),
      provenance,
    );
    id = Number(result.lastInsertRowid);
  }
  db.prepare(
    `INSERT OR IGNORE INTO evidence_links
       (owner_id, target_type, target_id, source_type, source_id, created_at)
     VALUES (?, 'revision', ?, ?, ?, ?)`,
  ).run(
    input.ownerId,
    String(id),
    input.evidenceType,
    String(input.evidenceId),
    now.toISOString(),
  );
  const foundation = foundationalKind(input.targetLayer, key);
  if (foundation) {
    db.prepare(
      `INSERT OR IGNORE INTO identity_reviews
         (owner_id, revision_id, target_kind, ashley_position,
          ashley_rationale, ashley_evidence_type, ashley_evidence_id,
          ashley_decided_at, doc_decision, doc_rationale, doc_decided_at,
          applied_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL,
               NULL, NULL, NULL, NULL, ?, ?)`,
    ).run(
      input.ownerId,
      id,
      foundation,
      now.toISOString(),
      now.toISOString(),
    );
  }
  return id;
}

function evidenceStats(
  db: DatabaseSync,
  ownerId: string,
  revisionId: number,
): { count: number; spanDays: number } {
  // Time-shift isolation: only evidence created with behavioral authority
  // (provenance = 'live') counts toward eligibility. Non-table source types
  // (message, question, opinion) are user-flow artifacts and count as-is.
  const row = db.prepare(
    `SELECT COUNT(*) AS count,
            MIN(COALESCE(e.created_at, l.created_at)) AS first_at,
            MAX(COALESCE(e.created_at, l.created_at)) AS last_at
     FROM evidence_links l
     LEFT JOIN episodes e
       ON l.source_type = 'episode' AND e.id = CAST(l.source_id AS INTEGER)
     LEFT JOIN cur_reads rd
       ON l.source_type = 'read' AND rd.id = CAST(l.source_id AS INTEGER)
     LEFT JOIN cur_takes tk
       ON l.source_type = 'take' AND tk.id = CAST(l.source_id AS INTEGER)
     WHERE l.owner_id = ? AND l.target_type = 'revision' AND l.target_id = ?
       AND (
         (l.source_type = 'episode' AND e.id IS NOT NULL AND e.provenance = 'live')
         OR (l.source_type = 'read' AND rd.id IS NOT NULL AND rd.provenance = 'live')
         OR (l.source_type = 'take' AND tk.id IS NOT NULL AND tk.provenance = 'live')
         OR (l.source_type NOT IN ('episode', 'read', 'take'))
       )`,
  ).get(ownerId, String(revisionId)) as
    { count?: number; first_at?: string; last_at?: string } | undefined;
  const first = Date.parse(row?.first_at ?? "");
  const last = Date.parse(row?.last_at ?? "");
  return {
    count: Number(row?.count ?? 0),
    spanDays: Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, (last - first) / 86_400_000) : 0,
  };
}

export type ApplyRevisionsOptions = {
  /**
   * When true, allow shadow-provenance revisions to apply. This crosses the
   * shadow -> behavioral boundary and MUST be paired with `revisionIds`
   * naming exactly the revision(s) an explicit owner action authorized;
   * a broad allowShadow scan is refused. Only the owner-authorized
   * identity-review flows pass this; the worker auto-apply path never does.
   */
  allowShadow?: boolean;
  /** Exact revision ids to evaluate (narrows the scan). */
  revisionIds?: number[];
};

export function applyEligibleRevisions(
  db: DatabaseSync,
  ownerId: string,
  mode: CognitionMode,
  options: ApplyRevisionsOptions = {},
): number[] {
  if (mode !== "apply") return [];
  if (
    options.allowShadow === true &&
    (!options.revisionIds || options.revisionIds.length === 0)
  ) {
    throw new Error("allowShadow_requires_exact_revision_ids");
  }
  const now = new Date().toISOString();
  const idFilter =
    options.revisionIds && options.revisionIds.length > 0
      ? `AND id IN (${options.revisionIds.map(() => "?").join(", ")})`
      : "";
  const provenanceFilter =
    options.allowShadow === true ? "" : "AND provenance = 'live'";
  const params: Array<string | number> = [ownerId, now, ...(options.revisionIds ?? [])];
  const revisions = db.prepare(
    `SELECT id, owner_id, target_layer, target_key, previous_value,
            proposed_value, rationale, status, apply_after, created_at, updated_at,
            applied_target_id, provenance
     FROM learning_revisions
     WHERE owner_id = ? AND status = 'proposed'
       AND (apply_after <= ? OR (
         target_layer = 'stable_identity' AND
         (target_key LIKE 'value.%' OR target_key LIKE 'boundary.%')
       ))
       ${provenanceFilter}
       ${idFilter}
     ORDER BY id ASC`,
  ).all(...params).map(mapRevision).filter((item): item is LearningRevision => item !== null);
  const applied: number[] = [];
  for (const revision of revisions) {
    const evidence = evidenceStats(db, ownerId, revision.id);
    const foundation = foundationalKind(revision.targetLayer, revision.targetKey);
    const review = foundation
      ? db.prepare(
          `SELECT ashley_position, doc_decision FROM identity_reviews
           WHERE owner_id = ? AND revision_id = ?`,
        ).get(ownerId, revision.id) as {
          ashley_position?: string;
          doc_decision?: string;
        } | undefined
      : undefined;
    const eligible = foundation
      ? review?.ashley_position === "affirm" && review?.doc_decision === "approve"
      : revision.targetLayer === "stable_identity"
      ? evidence.count >= 3 && evidence.spanDays >= 14
      : evidence.count >= 2;
    if (!eligible) continue;
    let appliedTargetId: number;
    if (revision.targetLayer === "opinion") {
      appliedTargetId = reviseOpinion(db, {
        ownerId,
        topic: revision.targetKey,
        stance: revision.proposedValue,
        confidence: Math.min(0.9, 0.5 + evidence.count * 0.1),
      });
    } else {
      const layer = revision.targetLayer === "stable_identity" ? "stable" : "dynamic";
      const previous = listIdentity(db, ownerId, { layer, limit: 100 })
        .filter((entry) => entry.kind === revision.targetKey)
        .at(-1);
      appliedTargetId = appendIdentityRevision(db, {
        ownerId,
        layer,
        kind: revision.targetKey,
        text: revision.proposedValue,
        revisedFrom: previous?.id ?? null,
      });
    }
    db.prepare(
      `UPDATE learning_revisions
       SET status = 'applied', applied_at = ?, applied_target_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(now, appliedTargetId, now, revision.id);
    if (foundation) {
      db.prepare(
        `UPDATE identity_reviews SET applied_at = ?, updated_at = ?
         WHERE owner_id = ? AND revision_id = ?`,
      ).run(now, now, ownerId, revision.id);
    }
    applied.push(revision.id);
  }
  return applied;
}

function mapIdentityReview(value: unknown): IdentityReview | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Row;
  const targetKind = String(row.target_kind);
  if (targetKind !== "value" && targetKind !== "boundary") return null;
  const ashley = row.ashley_position;
  const doc = row.doc_decision;
  return {
    id: Number(row.id),
    ownerId: String(row.owner_id),
    revisionId: Number(row.revision_id),
    targetKind,
    targetKey: String(row.target_key),
    proposedValue: String(row.proposed_value),
    ashleyPosition: ashley === "affirm" || ashley === "object" || ashley === "defer" ? ashley : null,
    ashleyRationale: typeof row.ashley_rationale === "string" ? row.ashley_rationale : null,
    ashleyEvidenceType: typeof row.ashley_evidence_type === "string" ? row.ashley_evidence_type : null,
    ashleyEvidenceId: typeof row.ashley_evidence_id === "string" ? row.ashley_evidence_id : null,
    docDecision: doc === "approve" || doc === "reject" || doc === "defer" ? doc : null,
    docRationale: typeof row.doc_rationale === "string" ? row.doc_rationale : null,
    appliedAt: typeof row.applied_at === "string" ? row.applied_at : null,
    updatedAt: String(row.updated_at),
  };
}

export function listIdentityReviews(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): IdentityReview[] {
  return db.prepare(
    `SELECT r.id, r.owner_id, r.revision_id, r.target_kind,
            r.ashley_position, r.ashley_rationale, r.ashley_evidence_type,
            r.ashley_evidence_id, r.doc_decision, r.doc_rationale,
            r.applied_at, r.updated_at, l.target_key, l.proposed_value
     FROM identity_reviews r
     JOIN learning_revisions l ON l.id = r.revision_id
     WHERE r.owner_id = ? ORDER BY r.id DESC LIMIT ?`,
  ).all(ownerId, Math.max(1, Math.min(100, limit)))
    .map(mapIdentityReview)
    .filter((review): review is IdentityReview => review !== null);
}

export function recordAshleyReviewPosition(
  db: DatabaseSync,
  input: {
    ownerId: string;
    reviewId: number;
    position: "affirm" | "object" | "defer";
    rationale: string;
    evidenceType: string;
    evidenceId: string | number;
  },
): boolean {
  const review = db.prepare(
    `SELECT revision_id FROM identity_reviews WHERE id = ? AND owner_id = ?`,
  ).get(input.reviewId, input.ownerId) as { revision_id?: number } | undefined;
  if (!review?.revision_id) return false;
  const grounded = db.prepare(
    `SELECT 1 AS grounded FROM evidence_links
     WHERE owner_id = ? AND target_type = 'revision' AND target_id = ?
       AND source_type = ? AND source_id = ? LIMIT 1`,
  ).get(
    input.ownerId,
    String(review.revision_id),
    input.evidenceType,
    String(input.evidenceId),
  );
  if (!grounded) return false;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE identity_reviews
     SET ashley_position = ?, ashley_rationale = ?, ashley_evidence_type = ?,
         ashley_evidence_id = ?, ashley_decided_at = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    input.position,
    input.rationale.trim().slice(0, 1000),
    input.evidenceType,
    String(input.evidenceId),
    now,
    now,
    input.reviewId,
    input.ownerId,
  );
  return true;
}

export function recordDocReviewDecision(
  db: DatabaseSync,
  input: {
    ownerId: string;
    reviewId: number;
    decision: "approve" | "reject" | "defer";
    rationale?: string;
  },
): boolean {
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE identity_reviews
     SET doc_decision = ?, doc_rationale = ?, doc_decided_at = ?, updated_at = ?
     WHERE id = ? AND owner_id = ? AND applied_at IS NULL`,
  ).run(
    input.decision,
    input.rationale?.trim().slice(0, 1000) || null,
    now,
    now,
    input.reviewId,
    input.ownerId,
  );
  if (result.changes === 0) return false;
  db.prepare(
    `UPDATE learning_revisions SET status = ?, updated_at = ?
     WHERE id = (SELECT revision_id FROM identity_reviews WHERE id = ? AND owner_id = ?)`,
  ).run(input.decision === "reject" ? "rejected" : "proposed", now, input.reviewId, input.ownerId);
  return true;
}

export function listRevisions(
  db: DatabaseSync,
  ownerId: string,
  limit = 50,
): LearningRevision[] {
  return db.prepare(
    `SELECT r.id, r.owner_id, r.target_layer, r.target_key, r.previous_value,
            r.proposed_value, r.rationale, r.status, r.apply_after,
            r.created_at, r.updated_at, r.applied_target_id, r.provenance,
            COUNT(l.id) AS evidence_count,
            CASE
              WHEN COUNT(l.id) = 0 THEN 0
              ELSE MAX(
                0,
                (julianday(MAX(COALESCE(e.created_at, l.created_at))) -
                 julianday(MIN(COALESCE(e.created_at, l.created_at))))
              )
            END AS evidence_span_days
     FROM learning_revisions r
     LEFT JOIN evidence_links l
       ON l.owner_id = r.owner_id
      AND l.target_type = 'revision'
      AND l.target_id = CAST(r.id AS TEXT)
     LEFT JOIN episodes e
       ON l.source_type = 'episode' AND e.id = CAST(l.source_id AS INTEGER)
     WHERE r.owner_id = ?
     GROUP BY r.id
     ORDER BY r.id DESC LIMIT ?`,
  ).all(ownerId, Math.max(1, Math.min(100, limit)))
    .map(mapRevision)
    .filter((item): item is LearningRevision => item !== null);
}

export function revertRevision(
  db: DatabaseSync,
  ownerId: string,
  revisionId: number,
): boolean {
  const revision = mapRevision(db.prepare(
    `SELECT id, owner_id, target_layer, target_key, previous_value,
            proposed_value, rationale, status, apply_after, created_at, updated_at,
            applied_target_id, provenance
     FROM learning_revisions
     WHERE id = ? AND owner_id = ?`,
  ).get(revisionId, ownerId));
  if (!revision || revision.status !== "applied") return false;
  if (revision.appliedTargetId !== null) {
    if (revision.targetLayer === "opinion") {
      const target = db.prepare(
        "SELECT revised_from FROM opinions WHERE id = ? AND owner_id = ?",
      ).get(revision.appliedTargetId, ownerId) as
        { revised_from?: number | null } | undefined;
      if (!target) return false;
      db.prepare(
        "UPDATE opinions SET revised_from = ? WHERE revised_from = ?",
      ).run(target.revised_from ?? null, revision.appliedTargetId);
      db.prepare("DELETE FROM opinions WHERE id = ? AND owner_id = ?").run(
        revision.appliedTargetId,
        ownerId,
      );
    } else {
      const target = db.prepare(
        `SELECT revised_from, source FROM identity_entries
         WHERE id = ? AND owner_id = ?`,
      ).get(revision.appliedTargetId, ownerId) as
        { revised_from?: number | null; source?: string } | undefined;
      if (!target || target.source !== "organic") return false;
      db.prepare(
        "UPDATE identity_entries SET revised_from = ? WHERE revised_from = ?",
      ).run(target.revised_from ?? null, revision.appliedTargetId);
      db.prepare("DELETE FROM identity_entries WHERE id = ? AND owner_id = ?").run(
        revision.appliedTargetId,
        ownerId,
      );
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE learning_revisions
       SET status = 'reverted', reverted_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, revision.id);
    return true;
  }
  if (revision.targetLayer === "opinion") {
    const latest = db.prepare(
      `SELECT id, stance FROM opinions
       WHERE owner_id = ? AND topic = ? ORDER BY id DESC LIMIT 1`,
    ).get(ownerId, revision.targetKey) as { id?: number; stance?: string } | undefined;
    if (revision.previousValue === null) {
      if (latest?.id === undefined || latest.stance !== revision.proposedValue) return false;
      db.prepare("DELETE FROM opinions WHERE id = ?").run(latest.id);
    } else {
      reviseOpinion(db, {
        ownerId,
        topic: revision.targetKey,
        stance: revision.previousValue,
        confidence: 0.5,
      });
    }
  } else {
    const layer = revision.targetLayer === "stable_identity" ? "stable" : "dynamic";
    const latest = listIdentity(db, ownerId, { layer, limit: 100 })
      .filter((entry) => entry.kind === revision.targetKey)
      .at(-1);
    if (revision.previousValue === null) {
      if (!latest || latest.text !== revision.proposedValue || latest.source !== "organic") return false;
      db.prepare("DELETE FROM identity_entries WHERE id = ?").run(latest.id);
    } else {
      appendIdentityRevision(db, {
        ownerId,
        layer,
        kind: revision.targetKey,
        text: revision.previousValue,
        revisedFrom: latest?.id ?? null,
      });
    }
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE learning_revisions
     SET status = 'reverted', reverted_at = ?, updated_at = ? WHERE id = ?`,
  ).run(now, now, revision.id);
  return true;
}

export function reconcileUnsupportedRevisions(
  db: DatabaseSync,
  ownerId: string,
  revisionIds: number[],
): number {
  let changed = 0;
  for (const revisionId of [...new Set(revisionIds)].sort((a, b) => b - a)) {
    const revision = mapRevision(db.prepare(
      `SELECT id, owner_id, target_layer, target_key, previous_value,
              proposed_value, rationale, status, apply_after, created_at,
              updated_at, applied_target_id, provenance
       FROM learning_revisions WHERE id = ? AND owner_id = ?`,
    ).get(revisionId, ownerId));
    if (!revision || evidenceStats(db, ownerId, revision.id).count > 0) continue;
    if (revision.status === "proposed") {
      db.prepare(
        `UPDATE learning_revisions SET status = 'rejected', updated_at = ?
         WHERE id = ?`,
      ).run(new Date().toISOString(), revision.id);
      changed += 1;
      continue;
    }
    if (revision.status === "applied" && revertRevision(db, ownerId, revision.id)) {
      changed += 1;
    }
  }
  return changed;
}
