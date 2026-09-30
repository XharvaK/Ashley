import type { DatabaseSync } from "node:sqlite";
import type { MemoryKind, SourceSupportRef } from "../types.js";
import { getConversationEvidence } from "../evidence/conversation-log.js";

/**
 * Growth V1 §4.3 grounded automatic admission. Every MemoryKind may be
 * admitted without an Owner directive, but only on the evidence its kind
 * requires. Claims about the Owner must quote the Owner's words verbatim (the
 * literal-quote rule); Ashley-authored kinds are admitted as her own
 * interpretation and are labelled as such by their dimensions.
 */
export type AdmissionGrounding =
  | "owner_quote"
  | "owner_quote_or_observation"
  | "conversation_quote"
  | "ashley_authored";

export const AUTOMATIC_ADMISSION_GROUNDING: Readonly<Record<MemoryKind, AdmissionGrounding>> = Object.freeze({
  owner_preference: "owner_quote",
  owner_self_description: "owner_quote",
  owner_goal: "owner_quote",
  relational_boundary: "owner_quote",
  commitment: "owner_quote",
  owner_world_claim: "owner_quote_or_observation",
  project_knowledge: "owner_quote_or_observation",
  shared_episode: "conversation_quote",
  ashley_interpretation: "ashley_authored",
  open_question: "ashley_authored",
  learned_self_evidence: "ashley_authored",
});

const GROUNDING_RANK: Readonly<Record<AdmissionGrounding, number>> = Object.freeze({
  owner_quote: 3,
  owner_quote_or_observation: 2,
  conversation_quote: 1,
  ashley_authored: 0,
});

/**
 * R6: a memory may replace another only if its kind needs at least the same
 * grounding, so her reading of the Owner can never retire what the Owner said.
 */
export function canReplaceMemoryKind(next: MemoryKind, previous: MemoryKind): boolean {
  const nextRank = GROUNDING_RANK[AUTOMATIC_ADMISSION_GROUNDING[next]];
  const previousRank = GROUNDING_RANK[AUTOMATIC_ADMISSION_GROUNDING[previous]];
  return nextRank !== undefined && previousRank !== undefined && nextRank >= previousRank;
}

export const AUTOMATIC_ADMISSION_KINDS = Object.freeze(
  Object.keys(AUTOMATIC_ADMISSION_GROUNDING) as MemoryKind[],
);

type ResolvedPrincipal = { principalKind: string };

const OBSERVATION_REF_KINDS = new Set<SourceSupportRef["kind"]>([
  "observation_ref",
  "receipt_ref",
  "artifact_text_span",
  "document_page_region",
  "image_region",
  "structured_path",
]);

/**
 * Models quote reliably but count characters badly. A conversation span whose
 * quote occurs verbatim in the cited row is re-anchored to that occurrence;
 * a quote that does not occur is left untouched and fails validation.
 */
export function alignConversationSpans(
  db: DatabaseSync,
  refs: readonly unknown[],
): unknown[] {
  return refs.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const ref = value as Record<string, unknown>;
    if (ref.kind !== "conversation_text_span" || typeof ref.evidenceRowId !== "string"
      || typeof ref.quote !== "string" || ref.quote.length === 0) return value;
    const evidence = getConversationEvidence(db, ref.evidenceRowId);
    const text = evidence?.text;
    if (typeof text !== "string") return value;
    if (typeof ref.start === "number" && typeof ref.end === "number"
      && text.slice(ref.start, ref.end) === ref.quote) return value;
    const at = text.indexOf(ref.quote);
    if (at < 0) return value;
    return { ...ref, start: at, end: at + ref.quote.length };
  });
}

/** Row ids of Owner messages quoted by resolved conversation spans. */
export function ownerQuotedRowIds(
  refs: readonly SourceSupportRef[],
  resolved: readonly ResolvedPrincipal[],
): string[] {
  return refs.flatMap((ref, index) =>
    ref.kind === "conversation_text_span" && resolved[index]?.principalKind === "owner"
      ? [ref.evidenceRowId]
      : []);
}

export function isGroundedForKind(
  kind: MemoryKind,
  refs: readonly SourceSupportRef[],
  resolved: readonly ResolvedPrincipal[],
  options: { socialConversation?: boolean } = {},
): boolean {
  const ownerQuote = ownerQuotedRowIds(refs, resolved).length > 0;
  switch (AUTOMATIC_ADMISSION_GROUNDING[kind]) {
    case "owner_quote":
      return ownerQuote;
    case "owner_quote_or_observation":
      return ownerQuote || refs.some((ref) => OBSERVATION_REF_KINDS.has(ref.kind));
    case "conversation_quote":
      // A3/A9: in a contact's own conversation, what the contact said grounds
      // a shared memory attributed to them (people are the authority on
      // themselves). A contact never grounds a memory about the Owner.
      return refs.some((ref, index) =>
        ref.kind === "conversation_text_span"
        && (resolved[index]?.principalKind === "owner" || resolved[index]?.principalKind === "ashley"
          || (options.socialConversation === true && resolved[index]?.principalKind === "external_human")));
    case "ashley_authored":
      return true;
    default:
      return false;
  }
}
