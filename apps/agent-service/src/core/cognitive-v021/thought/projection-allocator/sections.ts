import { mintEffectRef } from "../../effect/effect-ref.js";
import type {
  CompactRetrievalEvidence,
  ProjectedThoughtInput,
} from "../projection.js";
import type {
  EpistemicDimensions,
  InFlightRecord,
  MindOccupancy,
  Observation,
  ThoughtInput,
  WorkingContextItem,
} from "../../types.js";
import type { DomainPointersSection } from "../domain-pointers.js";
import type { IdentityOrientationKernel } from "../orientation-kernel.js";
import type { C3ExperienceAdapterResult } from "../c3-adapter.js";
import {
  PROTECTED_PRIOR_DIALOGUE_COUNT,
  type DialogueProtection,
} from "./composition-contract.js";
import {
  applyAuthoritativeInvalidations,
  candidatePayload,
  createContinuityCandidate,
  type ContinuityCandidate,
  type ContinuityLineageContext,
  type CoverageDisposition,
} from "../continuity-candidate.js";

export type AllocationSectionId =
  | "orientation_kernel"
  | "domain_pointers"
  | "trigger_evidence"
  | "recent_raw"
  | "working_context_correction"
  | "working_context_referent"
  | "working_context_repair"
  | "working_context_commitment"
  | "working_context_topic"
  | "working_context_other"
  | "occupancy_compact"
  | "constitution"
  | "learned_self"
  | "capability"
  | "observations"
  | "retrieval_compact"
  | "c3_terminal_experiences"
  | "in_flight_receipt"
  | "authority_objections"
  | "remember_directive";

export type AllocationCandidate = {
  id: string;
  section: AllocationSectionId;
  required: boolean;
  priority: number;
  ref?: string;
  data: unknown;
  /** Formal MAT-II transport metadata attached without changing section ownership. */
  canonicalStore?: string;
  entityId?: string;
  sourceLineageId?: string;
  evidenceRefs?: readonly string[];
  coverageDisposition?: CoverageDisposition;
  continuityCandidate?: ContinuityCandidate<unknown>;
  /** Host-side protection classification; it is not model-visible. */
  dialogueProtection?: DialogueProtection;
  requiredness?: RequirednessContract;
};

export type RequirednessContract = Readonly<{
  owner: string;
  predicate: string;
  overflow: "fail_closed" | "shed_optional";
}>;

/**
 * Every projection adapter names the owner and predicate that produced its
 * requiredness. The composer consumes this decision; it does not derive
 * semantic requiredness from token pressure, recency, or provider metadata.
 */
export function requirednessContractFor(
  candidate: Pick<AllocationCandidate, "section" | "required" | "dialogueProtection">,
): RequirednessContract {
  if (candidate.dialogueProtection === "current_trigger") {
    return {
      owner: "continuity_adapter",
      predicate: "current_trigger_row_resolved",
      overflow: "fail_closed",
    };
  }
  if (candidate.dialogueProtection === "protected_prior_dialogue") {
    return {
      owner: "continuity_adapter",
      predicate: "protected_prior_participant_suffix",
      overflow: "fail_closed",
    };
  }
  switch (candidate.section) {
    case "orientation_kernel":
      return { owner: "orientation_kernel_adapter", predicate: "canonical_kernel_available", overflow: "fail_closed" };
    case "trigger_evidence":
      return { owner: "continuity_adapter", predicate: "trigger_reference_available", overflow: "fail_closed" };
    case "domain_pointers":
      return { owner: "grounding_adapter", predicate: "bounded_domain_pointer_section_available", overflow: "fail_closed" };
    case "learned_self":
      return { owner: "learned_self_adapter", predicate: "learned_self_slice_available", overflow: "fail_closed" };
    case "observations":
      return { owner: "perception_adapter", predicate: "observation_set_nonempty", overflow: "fail_closed" };
    case "in_flight_receipt":
      return { owner: "outcome_adapter", predicate: "in_flight_effects_nonempty", overflow: "fail_closed" };
    case "authority_objections":
      return { owner: "authority_adapter", predicate: "authority_objections_nonempty", overflow: "fail_closed" };
    case "remember_directive":
      return { owner: "memory_directive_adapter", predicate: "owner_directive_present", overflow: "fail_closed" };
    case "occupancy_compact":
      return { owner: "mind_state_adapter", predicate: "occupancy_nonempty", overflow: "fail_closed" };
    case "constitution":
      return { owner: "identity_adapter", predicate: "orientation_kernel_unavailable", overflow: "fail_closed" };
    case "capability":
      return { owner: "capability_adapter", predicate: "orientation_kernel_unavailable", overflow: "fail_closed" };
    case "retrieval_compact":
      return { owner: "retrieval_adapter", predicate: "bounded_hit_eligible", overflow: "shed_optional" };
    case "c3_terminal_experiences":
      return { owner: "c3_experience_adapter", predicate: "terminal_experience_candidate_eligible", overflow: "shed_optional" };
    default:
      if (candidate.section.startsWith("working_context")) {
        return candidate.required
          ? { owner: "working_context_adapter", predicate: "required_item_type_present", overflow: "fail_closed" }
          : { owner: "working_context_adapter", predicate: "optional_item_type_present", overflow: "shed_optional" };
      }
      return candidate.required
        ? { owner: "projection_adapter", predicate: "adapter_declared_required", overflow: "fail_closed" }
        : { owner: "projection_adapter", predicate: "adapter_declared_optional", overflow: "shed_optional" };
  }
}

export type AllocationTokenComponent =
  | "conversation_tokens"
  | "working_context_tokens"
  | "identity_kernel_tokens"
  | "domain_pointer_tokens"
  | "learned_self_tokens"
  | "retrieval_tokens"
  | "observations_tokens"
  | "in_flight_effect_tokens"
  | "authority_revision_feedback_tokens";

/** Maps allocator sections to the receipt's stable token-economy vocabulary. */
export function allocationTokenComponent(
  section: AllocationSectionId,
): AllocationTokenComponent {
  if (section === "orientation_kernel") return "identity_kernel_tokens";
  if (section === "domain_pointers") return "domain_pointer_tokens";
  if (section === "trigger_evidence" || section === "recent_raw" || section === "remember_directive") {
    return "conversation_tokens";
  }
  if (section.startsWith("working_context")) return "working_context_tokens";
  if (section === "constitution" || section === "capability") return "identity_kernel_tokens";
  if (section === "occupancy_compact") return "domain_pointer_tokens";
  if (section === "learned_self") return "learned_self_tokens";
  if (section === "retrieval_compact") return "retrieval_tokens";
  if (section === "c3_terminal_experiences") return "domain_pointer_tokens";
  if (section === "observations") return "observations_tokens";
  if (section === "in_flight_receipt") return "in_flight_effect_tokens";
  return "authority_revision_feedback_tokens";
}

export function buildAllocationCandidates(
  input: ThoughtInput,
  compactRetrievalHits: CompactRetrievalEvidence[],
  continuityContext?: ContinuityLineageContext,
): AllocationCandidate[] {
  const candidates: AllocationCandidate[] = [];

  const c2Input = input as ThoughtInput & {
    orientationKernel?: IdentityOrientationKernel;
    domainPointers?: DomainPointersSection;
    c3Experiences?: C3ExperienceAdapterResult;
  };

  // The orientation kernel is the first required C2 section. It contains the
  // bounded canonical identity and full static contract, not a Host-authored
  // personality or biography.
  if (c2Input.orientationKernel) {
    candidates.push({
      id: "orientation_kernel",
      section: "orientation_kernel",
      required: true,
      priority: 1,
      data: c2Input.orientationKernel,
    });
  }

  // 1. Trigger Evidence (required)
  candidates.push({
    id: "trigger_evidence",
    section: "trigger_evidence",
    required: true,
    priority: 2,
    data: input.trigger,
  });

  // The orientation kernel is the canonical C2 wire owner for identity
  // values/boundaries, bounded stable self, and capability reality. Keep the
  // legacy candidates only for inputs that do not have the kernel, so the
  // same source payload is not counted and serialized a second time.
  if (!c2Input.orientationKernel) {
    // 2. Constitution (required)
    candidates.push({
      id: "constitution",
      section: "constitution",
      required: true,
      priority: 3,
      data: input.constitution,
    });

    // 3. Capability Reality (required)
    candidates.push({
      id: "capability",
      section: "capability",
      required: true,
      priority: 4,
      data: input.capabilityReality,
    });
  }

  // 4. Recent Raw Window. Each row remains an independent candidate so an
  // authoritative invalidation can remove only the affected payload and
  // preserve its coverage disposition in the receipt. Active frontier rows
  // are highest-priority optional inline material: their identities remain in
  // conversationSelection when text does not fit the semantic envelope.
  const conversationSelection = input.conversationSelection;
  const frontierIds = new Set(conversationSelection?.frontierIncludedIds ?? []);
  const currentTriggerId = input.trigger.kind !== "owner_message"
    ? null
    : conversationSelection?.currentTriggerRowId !== undefined
      ? conversationSelection.currentTriggerRowId
      : input.trigger.ref;
  const orderedRawRows = [...input.rawConversation].sort((left, right) =>
    left.createdAtMs - right.createdAtMs || left.rowId.localeCompare(right.rowId),
  );
  const currentTrigger = currentTriggerId === null
    ? undefined
    : orderedRawRows.find((row) => row.rowId === currentTriggerId);
  const protectedPriorIds = new Set(
    orderedRawRows
      .filter((row) => {
        if (row.rowId === currentTriggerId) return false;
        if (row.role !== "owner" && row.role !== "ashley") return false;
        if (!currentTrigger) return true;
        // A superseded version of the current trigger is not prior dialogue.
        return row.lineageId !== currentTrigger.lineageId;
      })
      .slice(-PROTECTED_PRIOR_DIALOGUE_COUNT)
      .map((row) => row.rowId),
  );
  const seenRawRowIds = new Set<string>();
  const rawRows = [
    ...orderedRawRows.filter((row) => frontierIds.has(row.rowId)),
    ...orderedRawRows.filter((row) => row.rowId === currentTriggerId && !frontierIds.has(row.rowId)),
    ...orderedRawRows
      .filter((row) => !frontierIds.has(row.rowId) && row.rowId !== currentTriggerId)
      .reverse(),
  ].filter((row) => {
    if (seenRawRowIds.has(row.rowId)) return false;
    seenRawRowIds.add(row.rowId);
    return true;
  });
  for (const row of rawRows) {
    const isCurrentTrigger = row.rowId === currentTriggerId;
    const isProtectedPrior = protectedPriorIds.has(row.rowId);
    candidates.push({
      id: `recent_raw:${row.rowId}`,
      section: "recent_raw",
      required: isCurrentTrigger || isProtectedPrior,
      priority: isCurrentTrigger
        ? 2
        : isProtectedPrior
          ? 3
          : frontierIds.has(row.rowId)
            ? 5
            : 6,
      ref: row.rowId,
      data: row,
      evidenceRefs: [row.rowId],
      dialogueProtection: isCurrentTrigger
        ? "current_trigger"
        : isProtectedPrior
          ? "protected_prior_dialogue"
          : "ordinary",
    });
  }

  // 5. Learned Self Slice (required)
  candidates.push({
    id: "learned_self",
    section: "learned_self",
    required: true,
    priority: 6,
    data: input.learnedSelfSlice,
  });

  // 6. Observations (required if non-empty)
  if (input.observations && input.observations.length > 0) {
    candidates.push({
      id: "observations",
      section: "observations",
      required: true,
      priority: 6,
      data: input.observations,
    });
  }

  // 7. In Flight (required if non-empty)
  if (input.inFlight && input.inFlight.length > 0) {
    candidates.push({
      id: "in_flight_receipt",
      section: "in_flight_receipt",
      required: true,
      priority: 7,
      data: input.inFlight.map((item) => ({
        effectRef: mintEffectRef(input.cycleId, input.generation, item.effectId),
        status: item.status,
      })),
    });
  }

  if (c2Input.domainPointers) {
    candidates.push({
      id: "domain_pointers",
      section: "domain_pointers",
      required: true,
      priority: 8,
      data: c2Input.domainPointers,
    });
  }

  if (c2Input.c3Experiences && c2Input.c3Experiences.candidates.length > 0) {
    candidates.push({
      id: "c3_terminal_experiences",
      section: "c3_terminal_experiences",
      required: false,
      priority: 18,
      data: {
        version: 1 as const,
        candidates: c2Input.c3Experiences.candidates,
      },
      evidenceRefs: c2Input.c3Experiences.coverage.evidence_refs,
    });
  }

  // 8. Authority Objections (required if non-empty)
  if (input.authorityObjections && input.authorityObjections.length > 0) {
    candidates.push({
      id: "authority_objections",
      section: "authority_objections",
      required: true,
      priority: 9,
      data: input.authorityObjections,
    });
  }

  // 9. Remember Directive (required if present)
  if (input.rememberDirective) {
    candidates.push({
      id: "remember_directive",
      section: "remember_directive",
      required: true,
      priority: 10,
      data: input.rememberDirective,
    });
  }

  // 10. Occupancy Compact (required if non-empty)
  if (input.occupancy && input.occupancy.length > 0) {
    candidates.push({
      id: "occupancy_compact",
      section: "occupancy_compact",
      required: true,
      priority: 11,
      data: input.occupancy,
    });
  }

  // 11-14. Type-Aware Working Context: Essential subtypes are REQUIRED
  const wcItems = input.workingContext ?? [];
  for (const item of wcItems) {
    if (item.type === "correction") {
      candidates.push({
        id: `wc:${item.id}`,
        section: "working_context_correction",
        required: true,
        priority: 12,
        ref: item.id,
        data: item,
      });
    } else if (item.type === "referent") {
      candidates.push({
        id: `wc:${item.id}`,
        section: "working_context_referent",
        required: true,
        priority: 13,
        ref: item.id,
        data: item,
      });
    } else if (item.type === "repair") {
      candidates.push({
        id: `wc:${item.id}`,
        section: "working_context_repair",
        required: true,
        priority: 14,
        ref: item.id,
        data: item,
      });
    } else if (item.type === "commitment_temp") {
      candidates.push({
        id: `wc:${item.id}`,
        section: "working_context_commitment",
        required: true,
        priority: 15,
        ref: item.id,
        data: item,
      });
    }
  }

  // 15-16. Optional Working Context: Topic and Other (ordered by updatedGeneration desc)
  const optionalWc = wcItems.filter(
    (item) =>
      item.type !== "correction" &&
      item.type !== "referent" &&
      item.type !== "repair" &&
      item.type !== "commitment_temp",
  );
  optionalWc.sort((a, b) => (b.updatedGeneration ?? 0) - (a.updatedGeneration ?? 0));

  for (const item of optionalWc) {
    if (item.type === "topic") {
      candidates.push({
        id: `wc:${item.id}`,
        section: "working_context_topic",
        required: false,
        priority: 16,
        ref: item.id,
        data: item,
      });
    } else {
      candidates.push({
        id: `wc:${item.id}`,
        section: "working_context_other",
        required: false,
        priority: 17,
        ref: item.id,
        data: item,
      });
    }
  }

  // 17. Compact Retrieval Candidates (optional, tier/rank ordered)
  for (let idx = 0; idx < compactRetrievalHits.length; idx++) {
    const hit = compactRetrievalHits[idx];
    candidates.push({
      id: `retrieval:${hit.ref}:${idx}`,
      section: "retrieval_compact",
      required: false,
      priority: 18,
      ref: hit.ref,
      data: hit,
    });
  }

  return candidates.map((candidate) => {
    const canonicalStore = canonicalStoreFor(candidate.section);
    const evidenceRefs = candidate.evidenceRefs ?? evidenceRefsFor(candidate.data);
    const sourceLineageId = continuityContext?.authoritativeLineageId ??
      sourceLineageFor(candidate.data) ?? input.rawConversation[0]?.lineageId ?? `unbound:${input.cycleId}`;
    const entityId = candidate.ref ?? candidate.id;
    const sourceRecord = typeof candidate.data === "object" && candidate.data !== null
      ? candidate.data as Record<string, unknown>
      : undefined;
    const continuityCandidate = applyAuthoritativeInvalidations(createContinuityCandidate({
      id: candidate.id,
      payload: candidate.data,
      canonicalStore,
      entityId,
      sourceLineageId,
      evidenceRefs,
      required: candidate.required,
      disposition: candidate.coverageDisposition,
      redacted: sourceRecord?.redacted === true || sourceRecord?.sourceStatus === "redacted",
      sourceStatus: typeof sourceRecord?.sourceStatus === "string" ? sourceRecord.sourceStatus : undefined,
      dataClassification: typeof sourceRecord?.dataClassification === "string" ? sourceRecord.dataClassification : undefined,
    }), continuityContext);
    const requiredness = requirednessContractFor(candidate);
    return {
      ...candidate,
      data: candidatePayload(continuityCandidate),
      canonicalStore,
      entityId,
      sourceLineageId,
      evidenceRefs,
      continuityCandidate,
      requiredness,
    };
  });
}

function canonicalStoreFor(section: AllocationSectionId): string {
  if (section === "orientation_kernel") return "nuclear.db:identity_entries+static_operating_contract";
  if (section === "domain_pointers") return "cognitive-v021.db:domain_pointers";
  if (section === "trigger_evidence" || section === "recent_raw" || section === "remember_directive") {
    return "conversation_evidence_log";
  }
  if (section.startsWith("working_context")) return "working_context_items";
  if (section === "occupancy_compact") return "mind_occupancy";
  if (section === "constitution") return "identity_entries";
  if (section === "capability") return "capability_reality";
  if (section === "learned_self" || section === "retrieval_compact") {
    return "sidecar_memory_assertions";
  }
  if (section === "observations") return "observation_artifacts";
  if (section === "c3_terminal_experiences") return "cognitive-v021.db:c3_terminal_experiences";
  if (section === "in_flight_receipt") return "effect_receipts";
  return "authority_revision_feedback";
}

function sourceLineageFor(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const lineage = sourceLineageFor(item);
      if (lineage) return lineage;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["sourceLineageId", "lineageId", "evidenceLineageId", "sourceCurrentnessRef"]) {
    if (typeof record[key] === "string" && record[key].trim() !== "") return record[key];
  }
  return undefined;
}

function evidenceRefsFor(value: unknown): readonly string[] {
  const refs = new Set<string>();
  const collect = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(collect);
      return;
    }
    if (typeof item !== "object" || item === null) return;
    const record = item as Record<string, unknown>;
    for (const key of ["rowId", "id", "ref", "effectRef"]) {
      if (typeof record[key] === "string" && record[key].trim() !== "") refs.add(record[key]);
    }
    if (Array.isArray(record.evidenceRefs)) {
      for (const ref of record.evidenceRefs) {
        if (typeof ref === "string" && ref.trim() !== "") refs.add(ref);
      }
    }
    if (typeof record.rawEvidenceRefsJson === "string") {
      try {
        const raw = JSON.parse(record.rawEvidenceRefsJson) as unknown;
        if (Array.isArray(raw)) {
          for (const ref of raw) {
            if (typeof ref !== "object" || ref === null) continue;
            const item = ref as Record<string, unknown>;
            if (typeof item.kind === "string" && typeof item.id === "string") {
              refs.add(`${item.kind}:${item.id}`);
            }
          }
        }
      } catch {
        // The C3 adapter validates this field before it reaches allocation.
      }
    }
    if (Array.isArray(record.sourceTurnIds)) {
      for (const ref of record.sourceTurnIds) {
        if (typeof ref === "string" && ref.trim() !== "") refs.add(ref);
      }
    }
  };
  collect(value);
  return Object.freeze([...refs]);
}
