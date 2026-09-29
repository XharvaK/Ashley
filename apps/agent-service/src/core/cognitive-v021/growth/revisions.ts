import type { DatabaseSync } from "node:sqlite";
import { maxClassification, type DataClassification } from "../../privacy/classification.js";
import { listIdentity } from "../../identity/store.js";
import { getMemoryAssertion, REDACTED_MEMORY_STATEMENT } from "../memory/assertions.js";
import { getEpisode } from "../memory/episodes.js";
import { getExpectation } from "./expectations.js";

/**
 * Growth V1 §6.2: the revision engine (v0.2.1 port of the stale
 * `learning/revisions.ts`).
 *
 * Slow things change slowly. Ashley's Thought proposes every revision and
 * cites the evidence for it; the Host only resolves that evidence, counts
 * it, and applies a revision once its layer's threshold holds:
 *
 * | layer            | applies when                                        |
 * |------------------|-----------------------------------------------------|
 * | opinion          | 2 pieces of live evidence                           |
 * | taste            | 2 pieces of evidence spanning at least 2 days       |
 * | trait            | 3 pieces spanning at least 14 days, then a 72 h wait |
 * | value / boundary | Ashley affirms (in a later pass) AND the Owner approves via /identity |
 *
 * Proposals to the same target accumulate evidence; the wording is the
 * latest she gave. Nothing applies on a single impulse. An applied identity
 * revision appends a new `identity_entries` row (nuclear, the canonical
 * identity store) that revises the old one, so it is revertible and the
 * seeded entries stay until revised. Opinions live here.
 */

export const REVISION_LAYERS = ["opinion", "taste", "trait", "value", "boundary"] as const;
export type RevisionLayer = (typeof REVISION_LAYERS)[number];
export const REVISION_POSITIONS = ["affirm", "object", "defer"] as const;
export type RevisionPositionKind = (typeof REVISION_POSITIONS)[number];
export type RevisionStatus = "proposed" | "ripe" | "applied" | "superseded" | "reverted" | "rejected" | "forgotten";
export type OwnerRevisionDecision = "approve" | "reject" | "defer";

export const REVISION_TEXT_MAX_CHARS = 400;
export const REVISION_TOPIC_MAX_CHARS = 80;
export const REVISION_RATIONALE_MAX_CHARS = 400;
export const REVISION_EVIDENCE_REFS_MAX = 8;
export const REVISIONS_PER_SETTLEMENT = 3;
export const REVISION_POSITIONS_PER_SETTLEMENT = 3;

const DAY_MS = 24 * 60 * 60_000;
export const REVISION_THRESHOLDS: Readonly<Record<"opinion" | "taste" | "trait", { evidence: number; spanMs: number; delayMs: number }>> = Object.freeze({
  opinion: { evidence: 2, spanMs: 0, delayMs: 0 },
  taste: { evidence: 2, spanMs: 2 * DAY_MS, delayMs: 0 },
  trait: { evidence: 3, spanMs: 14 * DAY_MS, delayMs: 72 * 60 * 60_000 },
});

/** What Thought proposes. */
export type RevisionProposal = {
  layer: RevisionLayer;
  /** A short, stable name for what this is about; reusing it adds evidence to the same revision. */
  topic?: string;
  /** The current identity entry this revises (from growth.self). */
  revisesEntryId?: number;
  text: string;
  rationale: string;
  evidenceRefs: readonly string[];
};

/** Ashley's own position on a foundational revision, taken in a later pass. */
export type RevisionPosition = { revisionId: number; position: RevisionPositionKind; rationale: string };

export type RevisionRecord = {
  revisionId: number;
  layer: RevisionLayer;
  targetKey: string;
  topic: string | null;
  revisesEntryId: number | null;
  previousText: string | null;
  proposedText: string;
  rationale: string | null;
  status: RevisionStatus;
  ripeAtMs: number | null;
  appliedAtMs: number | null;
  appliedEntryId: number | null;
  ashleyPosition: RevisionPositionKind | null;
  ownerDecision: OwnerRevisionDecision | null;
  proposedCycleId: string;
  dataClassification: DataClassification;
  createdAtMs: number;
  updatedAtMs: number;
};

export type RevisionEvidenceStats = { count: number; spanMs: number; refs: string[] };

export type ProposalOutcome =
  | { outcome: "proposed" | "reinforced"; revisionId: number }
  | { outcome: "no_evidence" | "bad_target" | "identity_unavailable" };

type Row = Record<string, unknown>;

const LAYERS = new Set<string>(REVISION_LAYERS);
const POSITIONS = new Set<string>(REVISION_POSITIONS);
const IDENTITY_LAYERS = new Set<string>(["taste", "trait", "value", "boundary"]);

export function isRevisionLayer(value: unknown): value is RevisionLayer {
  return typeof value === "string" && LAYERS.has(value);
}

export function isRevisionPosition(value: unknown): value is RevisionPositionKind {
  return typeof value === "string" && POSITIONS.has(value);
}

export function isFoundationalLayer(layer: RevisionLayer): layer is "value" | "boundary" {
  return layer === "value" || layer === "boundary";
}

function classification(value: unknown): DataClassification {
  return value === "sensitive" || value === "never_public" || value === "secret" ? value : "ordinary";
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function mapRevision(row: Row): RevisionRecord {
  const position = row.ashley_position;
  const decision = row.owner_decision;
  return {
    revisionId: Number(row.revision_id),
    layer: (isRevisionLayer(row.layer) ? row.layer : "opinion"),
    targetKey: String(row.target_key),
    topic: typeof row.topic === "string" ? row.topic : null,
    revisesEntryId: nullableNumber(row.revises_entry_id),
    previousText: typeof row.previous_text === "string" ? row.previous_text : null,
    proposedText: String(row.proposed_text ?? ""),
    rationale: typeof row.rationale === "string" ? row.rationale : null,
    status: String(row.status) as RevisionStatus,
    ripeAtMs: nullableNumber(row.ripe_at_ms),
    appliedAtMs: nullableNumber(row.applied_at_ms),
    appliedEntryId: nullableNumber(row.applied_entry_id),
    ashleyPosition: isRevisionPosition(position) ? position : null,
    ownerDecision: decision === "approve" || decision === "reject" || decision === "defer" ? decision : null,
    proposedCycleId: String(row.proposed_cycle_id ?? ""),
    dataClassification: classification(row.data_classification),
    createdAtMs: Number(row.created_at_ms ?? 0),
    updatedAtMs: Number(row.updated_at_ms ?? 0),
  };
}

export function getRevision(db: DatabaseSync, revisionId: number): RevisionRecord | null {
  const row = db.prepare("SELECT * FROM growth_revisions WHERE revision_id = ?").get(revisionId) as Row | undefined;
  return row ? mapRevision(row) : null;
}

/** One live identity entry Ashley may revise. */
export type RevisableIdentityEntry = { entryId: number; kind: "taste" | "trait" | "value" | "boundary"; text: string };

/** The current (unrevised) identity entries of the kinds the engine may touch. */
export function revisableIdentityEntries(nuclear: DatabaseSync, ownerId: string): RevisableIdentityEntry[] {
  return listIdentity(nuclear, ownerId, { layer: "stable", limit: 100 })
    .filter((entry) => IDENTITY_LAYERS.has(entry.kind))
    .map((entry) => ({ entryId: entry.id, kind: entry.kind as RevisableIdentityEntry["kind"], text: entry.text }));
}

type ResolvedEvidence = { ref: string; atMs: number; dataClassification: DataClassification };

/**
 * Resolve one cited ref against what exists now. Only live evidence counts:
 * a forgotten memory, episode, journal entry, interest branch, or
 * expectation stops counting
 * the moment it is forgotten.
 */
export function resolveRevisionEvidence(db: DatabaseSync, ref: string): ResolvedEvidence | null {
  const value = ref.trim();
  if (!value) return null;
  if (value.startsWith("expectation:")) {
    const expectation = getExpectation(db, value);
    if (!expectation || expectation.checkedAtMs === null || !["met", "missed", "mixed"].includes(expectation.status)) return null;
    return { ref: value, atMs: expectation.checkedAtMs, dataClassification: expectation.dataClassification };
  }
  if (value.startsWith("journal:")) {
    const row = db.prepare("SELECT created_at_ms, entry, data_classification FROM activity_journal WHERE entry_id = ? AND forgotten_at_ms IS NULL")
      .get(value) as Row | undefined;
    if (!row || typeof row.entry !== "string") return null;
    return { ref: value, atMs: Number(row.created_at_ms), dataClassification: classification(row.data_classification) };
  }
  if (value.startsWith("interest:")) {
    // A branch she lived, as her interest graph records it: dated by when she
    // last lived it. A seed she never lived is not evidence of anything.
    const row = db.prepare(
      "SELECT origin, lived_count, last_lived_at_ms FROM interest_branches WHERE branch_id = ? AND forgotten_at_ms IS NULL",
    ).get(value.slice("interest:".length)) as Row | undefined;
    if (!row || row.last_lived_at_ms == null || (row.origin === "seed" && Number(row.lived_count) < 2)) return null;
    return { ref: value, atMs: Number(row.last_lived_at_ms), dataClassification: "ordinary" };
  }
  if (value.startsWith("episode:")) {
    const episode = getEpisode(db, value);
    return episode ? { ref: value, atMs: episode.endedAtMs, dataClassification: episode.dataClassification } : null;
  }
  const assertion = getMemoryAssertion(db, value);
  if (!assertion || !assertion.live || assertion.statement === REDACTED_MEMORY_STATEMENT) return null;
  const strength = db.prepare("SELECT formed_at_ms FROM memory_strength WHERE assertion_key = ?").get(value) as Row | undefined;
  const linked = db.prepare(
    "SELECT MIN(linked_at_ms) AS at_ms FROM growth_revision_evidence WHERE evidence_ref = ?",
  ).get(value) as Row | undefined;
  const atMs = strength?.formed_at_ms != null ? Number(strength.formed_at_ms)
    : linked?.at_ms != null ? Number(linked.at_ms) : null;
  if (atMs === null) return null;
  return { ref: value, atMs, dataClassification: assertion.dataClassification };
}

/** The revision's evidence as it stands now (live refs only). */
export function revisionEvidenceStats(db: DatabaseSync, revisionId: number): RevisionEvidenceStats {
  const refs = (db.prepare("SELECT evidence_ref FROM growth_revision_evidence WHERE revision_id = ? ORDER BY evidence_ref").all(revisionId) as Row[])
    .map((row) => String(row.evidence_ref));
  const live = refs.flatMap((ref) => {
    const resolved = resolveRevisionEvidence(db, ref);
    return resolved ? [resolved] : [];
  });
  if (live.length === 0) return { count: 0, spanMs: 0, refs: [] };
  const times = live.map((item) => item.atMs);
  return { count: live.length, spanMs: Math.max(...times) - Math.min(...times), refs: live.map((item) => item.ref) };
}

function currentHead(nuclear: DatabaseSync, entryId: number): number {
  let head = entryId;
  for (let guard = 0; guard < 100; guard += 1) {
    const newer = nuclear.prepare("SELECT id FROM identity_entries WHERE revised_from = ? ORDER BY id DESC LIMIT 1").get(head) as Row | undefined;
    if (!newer) return head;
    head = Number(newer.id);
  }
  return head;
}

function targetFor(
  proposal: RevisionProposal,
  identity: readonly RevisableIdentityEntry[] | null,
): { targetKey: string; topic: string | null; revisesEntryId: number | null; previousText: string | null } | "bad_target" | "identity_unavailable" {
  const topic = proposal.topic?.trim().slice(0, REVISION_TOPIC_MAX_CHARS) || null;
  if (proposal.layer === "opinion") {
    if (!topic || !slug(topic)) return "bad_target";
    return { targetKey: `opinion:${slug(topic)}`, topic, revisesEntryId: null, previousText: null };
  }
  if (proposal.revisesEntryId !== undefined) {
    if (!identity) return "identity_unavailable";
    const entry = identity.find((item) => item.entryId === proposal.revisesEntryId);
    // Only a current entry of the same kind can be revised: a taste cannot rewrite a boundary.
    if (!entry || entry.kind !== proposal.layer) return "bad_target";
    return { targetKey: `identity:${entry.entryId}`, topic, revisesEntryId: entry.entryId, previousText: entry.text };
  }
  if (!topic || !slug(topic)) return "bad_target";
  return { targetKey: `new:${proposal.layer}:${slug(topic)}`, topic, revisesEntryId: null, previousText: null };
}

/**
 * Record Ashley's proposals. A proposal with no evidence that resolves now
 * is not recorded. A proposal to a target that already has an open revision
 * reinforces it: the evidence adds up, and her latest wording stands. If the
 * wording of a foundational revision changes, any positions taken on the old
 * wording are cleared, so nobody approves one text and gets another.
 */
export function proposeRevisions(
  db: DatabaseSync,
  input: {
    cycleId: string;
    proposals: readonly RevisionProposal[];
    identity: readonly RevisableIdentityEntry[] | null;
    nowMs: number;
  },
): ProposalOutcome[] {
  return input.proposals.slice(0, REVISIONS_PER_SETTLEMENT).map((proposal): ProposalOutcome => {
    if (!isRevisionLayer(proposal.layer)) return { outcome: "bad_target" };
    const text = proposal.text.trim().slice(0, REVISION_TEXT_MAX_CHARS);
    if (!text) return { outcome: "bad_target" };
    const target = targetFor(proposal, input.identity);
    if (target === "bad_target" || target === "identity_unavailable") return { outcome: target };
    const evidence = [...new Set(proposal.evidenceRefs.slice(0, REVISION_EVIDENCE_REFS_MAX))].flatMap((ref) => {
      const resolved = resolveRevisionEvidence(db, ref);
      if (resolved) return [resolved];
      // A memory with no formation time yet is dated by when she first cited it.
      const assertion = getMemoryAssertion(db, ref.trim());
      return assertion && assertion.live && assertion.statement !== REDACTED_MEMORY_STATEMENT
        ? [{ ref: ref.trim(), atMs: input.nowMs, dataClassification: assertion.dataClassification }]
        : [];
    });
    if (evidence.length === 0) return { outcome: "no_evidence" };
    const rationale = proposal.rationale.trim().slice(0, REVISION_RATIONALE_MAX_CHARS) || null;
    const dataClassification = maxClassification("ordinary", ...evidence.map((item) => item.dataClassification));
    const open = db.prepare(
      `SELECT * FROM growth_revisions WHERE target_key = ? AND status IN ('proposed', 'ripe')
        ORDER BY revision_id DESC LIMIT 1`,
    ).get(target.targetKey) as Row | undefined;
    let revisionId: number;
    let outcome: "proposed" | "reinforced";
    if (open) {
      const existing = mapRevision(open);
      revisionId = existing.revisionId;
      outcome = "reinforced";
      const reworded = existing.proposedText !== text;
      db.prepare(
        `UPDATE growth_revisions
            SET proposed_text = ?, rationale = COALESCE(?, rationale), layer = ?,
                data_classification = ?, updated_at_ms = ?,
                ashley_position = CASE WHEN ? THEN NULL ELSE ashley_position END,
                ashley_rationale = CASE WHEN ? THEN NULL ELSE ashley_rationale END,
                owner_decision = CASE WHEN ? THEN NULL ELSE owner_decision END,
                owner_rationale = CASE WHEN ? THEN NULL ELSE owner_rationale END,
                proposed_cycle_id = CASE WHEN ? THEN ? ELSE proposed_cycle_id END
          WHERE revision_id = ?`,
      ).run(text, rationale, proposal.layer, maxClassification(existing.dataClassification, dataClassification), input.nowMs,
        reworded ? 1 : 0, reworded ? 1 : 0, reworded ? 1 : 0, reworded ? 1 : 0, reworded ? 1 : 0, input.cycleId, revisionId);
    } else {
      const inserted = db.prepare(
        `INSERT INTO growth_revisions
           (layer, target_key, topic, revises_entry_id, previous_text, proposed_text, rationale, status,
            proposed_cycle_id, data_classification, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?)`,
      ).run(proposal.layer, target.targetKey, target.topic, target.revisesEntryId, target.previousText, text, rationale,
        input.cycleId, dataClassification, input.nowMs, input.nowMs);
      revisionId = Number(inserted.lastInsertRowid);
      outcome = "proposed";
    }
    for (const item of evidence) {
      db.prepare(
        `INSERT OR IGNORE INTO growth_revision_evidence (revision_id, evidence_ref, cited_cycle_id, linked_at_ms)
         VALUES (?, ?, ?, ?)`,
      ).run(revisionId, item.ref, input.cycleId, input.nowMs);
    }
    return { outcome, revisionId };
  });
}

/**
 * Ashley's own position on a foundational revision. Never in the pass that
 * proposed it: affirming a value is a second, deliberate act.
 */
export function recordRevisionPositions(
  db: DatabaseSync,
  input: { cycleId: string; positions: readonly RevisionPosition[]; nowMs: number },
): number[] {
  const recorded: number[] = [];
  for (const position of input.positions.slice(0, REVISION_POSITIONS_PER_SETTLEMENT)) {
    if (!isRevisionPosition(position.position) || !Number.isSafeInteger(position.revisionId)) continue;
    const rationale = position.rationale.trim().slice(0, REVISION_RATIONALE_MAX_CHARS);
    if (!rationale) continue;
    const result = db.prepare(
      `UPDATE growth_revisions
          SET ashley_position = ?, ashley_rationale = ?, ashley_cycle_id = ?, ashley_decided_at_ms = ?, updated_at_ms = ?
        WHERE revision_id = ? AND layer IN ('value', 'boundary') AND status = 'proposed' AND proposed_cycle_id != ?`,
    ).run(position.position, rationale, input.cycleId, input.nowMs, input.nowMs, position.revisionId, input.cycleId);
    if (Number(result.changes ?? 0) > 0) recorded.push(position.revisionId);
  }
  return recorded;
}

/** The Owner's decision on a foundational revision (/identity). A rejection closes it. */
export function recordOwnerRevisionDecision(
  db: DatabaseSync,
  input: { revisionId: number; decision: OwnerRevisionDecision; rationale?: string; nowMs: number },
): boolean {
  const result = db.prepare(
    `UPDATE growth_revisions
        SET owner_decision = ?, owner_rationale = ?, owner_decided_at_ms = ?, updated_at_ms = ?,
            status = CASE WHEN ? = 'reject' THEN 'rejected' ELSE status END
      WHERE revision_id = ? AND layer IN ('value', 'boundary') AND status = 'proposed'`,
  ).run(input.decision, input.rationale?.trim().slice(0, 1000) || null, input.nowMs, input.nowMs, input.decision, input.revisionId);
  return Number(result.changes ?? 0) > 0;
}

function applyToIdentity(
  db: DatabaseSync,
  nuclear: DatabaseSync,
  ownerId: string,
  revision: RevisionRecord,
  nowMs: number,
): number {
  const revisedFrom = revision.revisesEntryId === null ? null : currentHead(nuclear, revision.revisesEntryId);
  const previous = revisedFrom === null ? null
    : nuclear.prepare("SELECT text FROM identity_entries WHERE id = ?").get(revisedFrom) as Row | undefined;
  const at = new Date(nowMs).toISOString();
  const inserted = nuclear.prepare(
    `INSERT INTO identity_entries (owner_id, layer, kind, text, source, revised_from, created_at, updated_at)
     VALUES (?, 'stable', ?, ?, 'organic', ?, ?, ?)`,
  ).run(ownerId, revision.layer, revision.proposedText, revisedFrom, at, at);
  const entryId = Number(inserted.lastInsertRowid);
  db.prepare(
    `UPDATE growth_revisions
        SET status = 'applied', applied_at_ms = ?, applied_entry_id = ?, previous_text = COALESCE(?, previous_text), updated_at_ms = ?
      WHERE revision_id = ?`,
  ).run(nowMs, entryId, typeof previous?.text === "string" ? previous.text : null, nowMs, revision.revisionId);
  return entryId;
}

function applyOpinion(db: DatabaseSync, revision: RevisionRecord, nowMs: number): void {
  db.prepare(
    "UPDATE growth_revisions SET status = 'superseded', updated_at_ms = ? WHERE target_key = ? AND status = 'applied' AND revision_id != ?",
  ).run(nowMs, revision.targetKey, revision.revisionId);
  db.prepare("UPDATE growth_revisions SET status = 'applied', applied_at_ms = ?, updated_at_ms = ? WHERE revision_id = ?")
    .run(nowMs, nowMs, revision.revisionId);
}

export type RevisionEvaluation = { applied: number[]; ripened: number[]; waiting: number[] };

/**
 * Check every open revision against its threshold and apply the ones that
 * hold. Identity layers need the nuclear identity store; without it they
 * wait. Mechanical only: the Host counts, it never judges the content.
 */
export function evaluateRevisions(
  db: DatabaseSync,
  identityStore: { nuclear: DatabaseSync; ownerId: string } | null,
  nowMs: number,
): RevisionEvaluation {
  const result: RevisionEvaluation = { applied: [], ripened: [], waiting: [] };
  const open = (db.prepare("SELECT * FROM growth_revisions WHERE status IN ('proposed', 'ripe') ORDER BY revision_id ASC").all() as Row[])
    .map(mapRevision);
  for (const revision of open) {
    const stats = revisionEvidenceStats(db, revision.revisionId);
    let due = false;
    if (isFoundationalLayer(revision.layer)) {
      due = stats.count >= 1 && revision.ashleyPosition === "affirm" && revision.ownerDecision === "approve";
    } else {
      const threshold = REVISION_THRESHOLDS[revision.layer];
      const met = stats.count >= threshold.evidence && stats.spanMs >= threshold.spanMs;
      if (!met) {
        if (revision.status === "ripe") {
          // Evidence was forgotten: the wait starts over when it is met again.
          db.prepare("UPDATE growth_revisions SET status = 'proposed', ripe_at_ms = NULL, updated_at_ms = ? WHERE revision_id = ?")
            .run(nowMs, revision.revisionId);
        }
      } else if (threshold.delayMs === 0) {
        due = true;
      } else if (revision.ripeAtMs === null) {
        db.prepare("UPDATE growth_revisions SET status = 'ripe', ripe_at_ms = ?, updated_at_ms = ? WHERE revision_id = ?")
          .run(nowMs, nowMs, revision.revisionId);
        result.ripened.push(revision.revisionId);
      } else {
        due = nowMs >= revision.ripeAtMs + threshold.delayMs;
      }
    }
    if (!due) continue;
    if (revision.layer === "opinion") {
      applyOpinion(db, revision, nowMs);
      result.applied.push(revision.revisionId);
      continue;
    }
    if (!identityStore || revision.dataClassification === "secret") {
      result.waiting.push(revision.revisionId);
      continue;
    }
    applyToIdentity(db, identityStore.nuclear, identityStore.ownerId, revision, nowMs);
    result.applied.push(revision.revisionId);
  }
  return result;
}

/**
 * Undo an applied revision (Owner). An identity revision removes the entry it
 * appended and relinks anything built on it; an opinion falls back to the
 * one it replaced.
 */
export function revertRevision(
  db: DatabaseSync,
  identityStore: { nuclear: DatabaseSync; ownerId: string } | null,
  revisionId: number,
  nowMs: number,
): boolean {
  const revision = getRevision(db, revisionId);
  if (!revision || revision.status !== "applied") return false;
  if (revision.layer === "opinion") {
    const previous = db.prepare(
      "SELECT revision_id FROM growth_revisions WHERE target_key = ? AND status = 'superseded' ORDER BY applied_at_ms DESC, revision_id DESC LIMIT 1",
    ).get(revision.targetKey) as Row | undefined;
    if (previous) db.prepare("UPDATE growth_revisions SET status = 'applied', updated_at_ms = ? WHERE revision_id = ?").run(nowMs, Number(previous.revision_id));
  } else {
    if (!identityStore || revision.appliedEntryId === null) return false;
    if (!removeOrganicIdentityEntry(identityStore.nuclear, identityStore.ownerId, revision.appliedEntryId)) return false;
  }
  db.prepare("UPDATE growth_revisions SET status = 'reverted', updated_at_ms = ? WHERE revision_id = ?").run(nowMs, revisionId);
  return true;
}

/** Remove one organic identity entry and relink the entries that revised it. Seeded entries are never removed here. */
export function removeOrganicIdentityEntry(nuclear: DatabaseSync, ownerId: string, entryId: number): boolean {
  const target = nuclear.prepare("SELECT revised_from, source FROM identity_entries WHERE id = ? AND owner_id = ?")
    .get(entryId, ownerId) as Row | undefined;
  if (!target || target.source !== "organic") return false;
  nuclear.prepare("UPDATE identity_entries SET revised_from = ? WHERE revised_from = ?")
    .run(target.revised_from == null ? null : Number(target.revised_from), entryId);
  nuclear.prepare("DELETE FROM identity_entries WHERE id = ? AND owner_id = ?").run(entryId, ownerId);
  return true;
}

/** Her opinions as they stand, newest first. */
export function listCurrentOpinions(db: DatabaseSync, limit = 12): RevisionRecord[] {
  return (db.prepare(
    `SELECT * FROM growth_revisions WHERE layer = 'opinion' AND status = 'applied' AND data_classification != 'secret'
      ORDER BY applied_at_ms DESC, revision_id DESC LIMIT ?`,
  ).all(Math.max(1, limit)) as Row[]).map(mapRevision);
}

/** Open revisions, oldest first. */
export function listOpenRevisions(db: DatabaseSync, limit = 12): RevisionRecord[] {
  return (db.prepare(
    `SELECT * FROM growth_revisions WHERE status IN ('proposed', 'ripe') AND data_classification != 'secret'
      ORDER BY revision_id ASC LIMIT ?`,
  ).all(Math.max(1, limit)) as Row[]).map(mapRevision);
}

/** Recently applied identity revisions, newest first. */
export function listAppliedRevisions(db: DatabaseSync, input: { sinceMs?: number; limit: number }): RevisionRecord[] {
  return (db.prepare(
    `SELECT * FROM growth_revisions WHERE status = 'applied' AND applied_at_ms >= ? AND data_classification != 'secret'
      ORDER BY applied_at_ms DESC, revision_id DESC LIMIT ?`,
  ).all(input.sinceMs ?? 0, Math.max(1, input.limit)) as Row[]).map(mapRevision);
}

/** Foundational revisions in the shape the Owner's /identity command reads. */
export type FoundationalReview = {
  id: number;
  revisionId: number;
  targetKind: "value" | "boundary";
  targetKey: string;
  proposedValue: string;
  previousValue: string | null;
  ashleyPosition: RevisionPositionKind | null;
  ashleyRationale: string | null;
  docDecision: OwnerRevisionDecision | null;
  evidenceCount: number;
  appliedAt: string | null;
  status: RevisionStatus;
};

export function listFoundationalReviews(db: DatabaseSync, limit = 50): FoundationalReview[] {
  return (db.prepare(
    `SELECT * FROM growth_revisions WHERE layer IN ('value', 'boundary') AND status NOT IN ('forgotten')
      ORDER BY revision_id DESC LIMIT ?`,
  ).all(Math.max(1, Math.min(100, limit))) as Row[]).map((row) => {
    const revision = mapRevision(row);
    return {
      id: revision.revisionId,
      revisionId: revision.revisionId,
      targetKind: revision.layer as "value" | "boundary",
      targetKey: revision.topic ?? revision.targetKey,
      proposedValue: revision.proposedText,
      previousValue: revision.previousText,
      ashleyPosition: revision.ashleyPosition,
      ashleyRationale: typeof row.ashley_rationale === "string" ? row.ashley_rationale : null,
      docDecision: revision.ownerDecision,
      evidenceCount: revisionEvidenceStats(db, revision.revisionId).count,
      appliedAt: revision.appliedAtMs === null ? null : new Date(revision.appliedAtMs).toISOString(),
      status: revision.status,
    };
  });
}

/**
 * Revisions whose words mention a forgotten topic. (Evidence that a forget
 * removes simply stops counting at the next evaluation.)
 */
export function revisionIdsForForget(db: DatabaseSync, topic: string): string[] {
  const needle = topic.trim().toLowerCase();
  if (!needle) return [];
  return (db.prepare(
    "SELECT revision_id, topic, previous_text, proposed_text, rationale, ashley_rationale, owner_rationale FROM growth_revisions WHERE status != 'forgotten'",
  ).all() as Row[])
    .filter((row) => ["topic", "previous_text", "proposed_text", "rationale", "ashley_rationale", "owner_rationale"]
      .some((key) => typeof row[key] === "string" && (row[key] as string).toLowerCase().includes(needle)))
    .map((row) => String(row.revision_id));
}

/**
 * Her words go and the revision can never apply. An applied identity
 * revision keeps its entry id so the caller holding the nuclear store can
 * remove the entry (commands.ts).
 */
export function forgetRevision(db: DatabaseSync, revisionId: string, nowMs: number): number {
  return Number(db.prepare(
    `UPDATE growth_revisions
        SET topic = NULL, previous_text = NULL, proposed_text = ?, rationale = NULL, ashley_rationale = NULL,
            owner_rationale = NULL, status = 'forgotten', forgotten_at_ms = ?, updated_at_ms = ?
      WHERE revision_id = ? AND status != 'forgotten'`,
  ).run(REDACTED_MEMORY_STATEMENT, nowMs, nowMs, Number(revisionId)).changes ?? 0);
}

/** Identity entries appended by revisions that a forget just closed. */
export function appliedEntryIdsForRevisions(db: DatabaseSync, revisionIds: Iterable<string>): number[] {
  const ids: number[] = [];
  for (const id of revisionIds) {
    const row = db.prepare(
      "SELECT applied_entry_id FROM growth_revisions WHERE revision_id = ? AND layer != 'opinion' AND applied_entry_id IS NOT NULL",
    ).get(Number(id)) as Row | undefined;
    if (row) ids.push(Number(row.applied_entry_id));
  }
  return ids;
}
