import type { DatabaseSync } from "node:sqlite";
import type {
  EvidenceRef,
  NonAuthoritativeContentClass,
} from "../types.js";
import {
  getOpenCognitiveItem,
  openCognitiveItemEligibleForInfluence,
} from "../cognition/open-items.js";
import { getMemoryContractState } from "../memory/contract-state.js";
import {
  annotationForAssertion,
  annotationForFact,
} from "../memory/context-role.js";
import { factInfluenceEligibleAt } from "../memory/facts.js";
import {
  influenceEligibleAt,
  mindStateItemInfluenceEligibleAt,
} from "../memory/eligibility.js";

export type ResolvedEvidenceLine = {
  ref: EvidenceRef;
  label: string;
  text: string;
  authorityClass?: NonAuthoritativeContentClass;
  memory_context_role?:
    | "current_source_evidence"
    | "historical_source_evidence"
    | "corrected_source_evidence";
  memory_assertion_ids?: number[];
  memory_correction_ids?: number[];
};

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function relationshipTableForRef(
  type: EvidenceRef["type"],
): string | null {
  switch (type) {
    case "doc_reminder":
      return "doc_reminders";
    case "ashley_self_commitment":
      return "ashley_self_commitments";
    case "mutual_commitment":
      return "mutual_commitments";
    case "scheduled_proactive":
      return "scheduled_proactive_messages";
    case "relational_tension":
      return "relational_tensions";
    case "withdrawal":
      return "withdrawal_records";
    default:
      return null;
  }
}

/**
 * Resolve Thought-selected evidence with exact provenance.
 * Drops missing/redacted/deleted refs. Never re-materializes the current
 * user message text even when its message id is present as provenance.
 */
export function resolveEvidenceRefs(
  db: DatabaseSync,
  ownerId: string,
  refs: EvidenceRef[],
  options: {
    excludeMessageId?: number | null;
    purpose?: "current_assumption" | "inspect";
  } = {},
): ResolvedEvidenceLine[] {
  const excludeMessageId = options.excludeMessageId ?? null;
  const inspect = options.purpose === "inspect";
  const lines: ResolvedEvidenceLine[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const relationshipTable = relationshipTableForRef(ref.type);
    if (relationshipTable) {
      const entityUuid = String(ref.id);
      const row = db
        .prepare(
          `SELECT text, status FROM ${relationshipTable}
           WHERE entity_uuid = ? AND owner_id = ?
             AND status NOT IN ('forgotten', 'cancelled', 'released')
           LIMIT 1`,
        )
        .get(entityUuid, ownerId);
      if (!isRow(row) || !text(row.text).trim()) continue;
      lines.push({
        ref,
        label: `${ref.type}:${entityUuid.slice(0, 8)}`,
        text: `${text(row.status)}: ${text(row.text).trim()}`.slice(0, 800),
      });
      continue;
    }

    if (ref.type === "open_cognitive_item") {
      const entityUuid = String(ref.id);
      const item = getOpenCognitiveItem(db, ownerId, entityUuid);
      if (!item || !openCognitiveItemEligibleForInfluence(db, item)) continue;
      lines.push({
        ref,
        label: "open_cognitive_item:" + entityUuid.slice(0, 8),
        text: (item.status + ": " + item.semanticSummary).slice(0, 800),
      });
      continue;
    }

    const id = Number(ref.id);
    if (!Number.isFinite(id)) continue;

    switch (ref.type) {
      case "message": {
        if (excludeMessageId !== null && id === excludeMessageId) continue;
        const row = db
          .prepare(
            `SELECT id, text FROM mem_messages
             WHERE id = ? AND owner_id = ? AND redacted_at IS NULL
             LIMIT 1`,
          )
          .get(id, ownerId);
        if (!isRow(row) || !text(row.text).trim()) continue;
        lines.push({
          ref,
          label: `message:${id}`,
          text: text(row.text).trim().slice(0, 800),
        });
        break;
      }
      case "fact": {
        const row = db
          .prepare(
            `SELECT id, category, key, value FROM mem_facts
             WHERE id = ? AND owner_id = ? AND superseded_by IS NULL
             LIMIT 1`,
          )
          .get(id, ownerId);
        if (!isRow(row)) continue;
        const c1 = getMemoryContractState(db)?.currentnessAuthority === "memory_assertions";
        const eligible = factInfluenceEligibleAt(db, ownerId, id);
        if (c1 && !eligible && !inspect) continue;
        const annotation = c1 ? annotationForFact(db, ownerId, id) : null;
        const blockedAnnotation = annotation &&
          annotation.memory_context_role !== "corrected_source_evidence"
          ? { ...annotation, memory_context_role: "historical_source_evidence" as const }
          : annotation;
        lines.push({
          ref,
          label: blockedAnnotation && !eligible
            ? `${blockedAnnotation.memory_context_role}:fact:${id}`
            : `fact:${id}`,
          text: `${text(row.category)}/${text(row.key)}: ${text(row.value)}`.slice(
            0,
            800,
          ),
          ...(blockedAnnotation && !eligible ? blockedAnnotation : {}),
        });
        break;
      }
      case "episode": {
        // Wave 2 consistency hardening (owner-approved, Wave 4 correction #5):
        // behavioral materializers must reject shadow provenance. Only a LIVE
        // episode may be materialized as Thought-selected evidence.
        const row = db
          .prepare(
            `SELECT id, summary FROM episodes
             WHERE id = ? AND owner_id = ? AND status = 'active'
               AND provenance = 'live'
             LIMIT 1`,
          )
          .get(id, ownerId);
        if (!isRow(row) || !text(row.summary).trim()) continue;
        const c1 = getMemoryContractState(db)?.currentnessAuthority === "memory_assertions";
        if (c1) {
          const claims = db.prepare(
            `SELECT assertion_id, excerpt
             FROM memory_episode_claims
             WHERE episode_id = ? ORDER BY assertion_id ASC`,
          ).all(id) as Array<{ assertion_id?: number; excerpt?: string }>;
          let claimLines = 0;
          for (const claim of claims) {
            const assertionId = Number(claim.assertion_id);
            if (!Number.isFinite(assertionId)) continue;
            const eligible = influenceEligibleAt(db, assertionId);
            if (!eligible && !inspect) continue;
            const annotation = annotationForAssertion(db, ownerId, assertionId);
            const blockedAnnotation = annotation &&
              annotation.memory_context_role === "corrected_source_evidence"
              ? annotation
              : {
                  memory_context_role: "historical_source_evidence" as const,
                  memory_assertion_ids: [assertionId],
                  memory_correction_ids: annotation?.memory_correction_ids ?? [],
                };
            lines.push({
              ref,
              label: eligible
                ? `episode_claim:${assertionId}`
                : `${blockedAnnotation.memory_context_role}:episode_claim:${assertionId}`,
              text: text(claim.excerpt).trim().slice(0, 800),
              ...(eligible
                ? {
                    memory_context_role: "current_source_evidence" as const,
                    memory_assertion_ids: [assertionId],
                  }
                : blockedAnnotation),
            });
            claimLines += 1;
          }
          if (claimLines > 0) break;
          if (!inspect) continue;
          const assertionIds = claims
            .map((claim) => Number(claim.assertion_id))
            .filter(Number.isFinite);
          const correctionIds = assertionIds.length > 0
            ? (db.prepare(
              `SELECT DISTINCT correction_id
               FROM memory_correction_targets
               WHERE assertion_id IN (${assertionIds.map(() => "?").join(", ")})
               ORDER BY correction_id ASC`,
            ).all(...assertionIds) as Array<{ correction_id?: number }>)
              .map((claim) => Number(claim.correction_id))
              .filter(Number.isFinite)
            : [];
          lines.push({
            ref,
            label: "historical_source_evidence:episode:" + id,
            text: text(row.summary).trim().slice(0, 800),
            memory_context_role: "historical_source_evidence",
            memory_assertion_ids: assertionIds,
            memory_correction_ids: correctionIds,
          });
          break;
        }
        lines.push({
          ref,
          label: `episode:${id}`,
          text: text(row.summary).trim().slice(0, 800),
        });
        break;
      }
      case "question": {
        const row = db
          .prepare(
            `SELECT id, text FROM questions
             WHERE id = ? AND owner_id = ? AND status IN ('open', 'pursuing')
             LIMIT 1`,
          )
          .get(id, ownerId);
        if (!isRow(row) || !text(row.text).trim()) continue;
        lines.push({
          ref,
          label: `question:${id}`,
          text: text(row.text).trim().slice(0, 800),
        });
        break;
      }
      case "opinion": {
        const row = db
          .prepare(
            `SELECT id, topic, stance FROM opinions
             WHERE id = ? AND owner_id = ?
             LIMIT 1`,
          )
          .get(id, ownerId);
        if (!isRow(row)) continue;
        lines.push({
          ref,
          label: `opinion:${id}`,
          text: `${text(row.topic)}: ${text(row.stance)}`.slice(0, 800),
        });
        break;
      }
      case "take": {
        const row = db
          .prepare(
            `SELECT t.id, t.take, i.title AS title
             FROM cur_takes t
             JOIN cur_items i ON i.id = t.item_id
             JOIN cur_reads r ON r.id = t.read_id AND r.item_id = t.item_id
             WHERE t.id = ?
               AND t.evidence_kind = 'read_record'
               AND t.read_id IS NOT NULL
               AND t.provenance = 'live'
               AND r.provenance = 'live'
             LIMIT 1`,
          )
          .get(id);
        if (!isRow(row)) continue;
        lines.push({
          ref,
          label: `take:${id}`,
          text: `${text(row.title)}: ${text(row.take)}`.slice(0, 800),
          authorityClass: "NON_AUTHORITATIVE_DERIVED_CONTENT",
        });
        break;
      }
      case "identity": {
        const row = db
          .prepare(
            `SELECT id, kind, text, layer FROM identity_entries
             WHERE id = ? AND owner_id = ?
             LIMIT 1`,
          )
          .get(id, ownerId);
        if (!isRow(row)) continue;
        lines.push({
          ref,
          label: `identity:${id}`,
          text: `${text(row.layer)}/${text(row.kind)}: ${text(row.text)}`.slice(
            0,
            800,
          ),
        });
        break;
      }
      case "mind_state": {
        if (
          getMemoryContractState(db)?.currentnessAuthority === "memory_assertions" &&
          !mindStateItemInfluenceEligibleAt(db, ownerId, id)
        ) continue;
        const row = db
          .prepare(
            `SELECT id, kind, text FROM mind_state_items
             WHERE id = ? AND owner_id = ? AND status = 'active'
             LIMIT 1`,
          )
          .get(id, ownerId);
        if (!isRow(row)) continue;
        lines.push({
          ref,
          label: `mind_state:${id}`,
          text: `${text(row.kind)}: ${text(row.text)}`.slice(0, 800),
        });
        break;
      }
      default:
        break;
    }
  }

  void number;
  return lines;
}

export function formatResolvedEvidence(
  lines: ResolvedEvidenceLine[],
): string {
  if (lines.length === 0) return "";
  return [
    "## Thought-selected evidence",
    ...lines.map((line) => {
      const role = line.memory_context_role
        ? ` memory_context_role=${line.memory_context_role}`
        : "";
      const assertions = line.memory_assertion_ids?.length
        ? ` assertion_ids=${line.memory_assertion_ids.join(",")}`
        : "";
      const corrections = line.memory_correction_ids?.length
        ? ` correction_ids=${line.memory_correction_ids.join(",")}`
        : "";
      return `- [${line.label}${role}${assertions}${corrections}] ${line.text}`;
    }),
  ].join("\n");
}
