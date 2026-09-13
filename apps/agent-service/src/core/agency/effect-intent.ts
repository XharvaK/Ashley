/**
 * Agency effect-intent derivation (deterministic seam).
 *
 * A pure, zero-authority transform from an Agency `Decision` plus the
 * revalidated open-cognitive-item evidence grounds into an
 * `AgencyEffectIntent`. It exists so the rest of the system can build on a
 * stable, deterministic vocabulary of what Ashley internally intends to do,
 * derived only from open-cognitive-item evidence that has already been
 * *revalidated* by the caller (live provenance, OPEN status, unredacted,
 * owner-bound, epistemic level `known`/`remembered`, trusted source).
 *
 * Intent derivation NEVER admits, schedules, or executes anything. Broker
 * readiness, sandbox state, and capability gates are enforced elsewhere.
 */

import type {
  AgencyEffectIntent,
  AgencyEffectPurpose,
  Decision,
} from "../types.js";

/**
 * A revalidated, owner-bound open-cognitive-item evidence ground. Callers
 * produce grounds only after revalidating the source item against the
 * nuclear database (current + qualified); this module treats grounds as
 * already-verified and never performs DB access.
 */
export type EffectGrounding = {
  entityUuid: string;
  kind: string;
  epistemicLevel: string;
  sourceTrust: string;
};

/**
 * OCI kind → effect purpose mapping. Open cognitive item kinds are
 * `question`, `revisit`, and `concern`; only a grounded *question* is an
 * evidence record that can carry a verification intent. `revisit`/`concern`
 * are action-oriented kinds and produce no purpose. Other purposes in the
 * taxonomy remain reserved for future producers; they are never derived
 * today, which keeps admission fail-closed.
 */
const PURPOSE_BY_KIND: Readonly<Record<string, AgencyEffectPurpose>> = {
  question: "sandbox_verify_build_health",
};

const QUALIFIED_EPISTEMIC_LEVELS: ReadonlySet<string> = new Set([
  "known",
  "remembered",
]);

const QUALIFIED_SOURCE_TRUSTS: ReadonlySet<string> = new Set(["trusted"]);

function groundIsQualified(ground: EffectGrounding): boolean {
  return (
    QUALIFIED_EPISTEMIC_LEVELS.has(ground.epistemicLevel) &&
    QUALIFIED_SOURCE_TRUSTS.has(ground.sourceTrust)
  );
}

export function deriveEffectIntent(
  decision: Decision,
  grounds: ReadonlyArray<EffectGrounding>,
): AgencyEffectIntent {
  const evidenceOciIds = new Set<string>();
  for (const ref of decision?.evidenceRefs ?? []) {
    if (ref.type === "open_cognitive_item" && typeof ref.id === "string" && ref.id) {
      evidenceOciIds.add(ref.id);
    }
  }
  const purposes = new Map<AgencyEffectPurpose, boolean>();
  const groundedRefs: Array<{ type: "open_cognitive_item"; id: string }> = [];
  for (const ground of grounds) {
    if (!evidenceOciIds.has(ground.entityUuid)) continue;
    if (!groundIsQualified(ground)) continue;
    const purpose = PURPOSE_BY_KIND[ground.kind];
    if (!purpose) continue;
    purposes.set(purpose, true);
    groundedRefs.push({
      type: "open_cognitive_item",
      id: ground.entityUuid,
    });
  }
  return {
    purposes: [...purposes.keys()].sort() as AgencyEffectPurpose[],
    groundedRefs,
    intentId: effectIntentId(decision),
    deterministic: true,
  };
}

export function deriveEffectPurposes(
  decision: Decision,
  grounds: ReadonlyArray<EffectGrounding>,
): AgencyEffectPurpose[] {
  return deriveEffectIntent(decision, grounds).purposes;
}

export function effectIntentId(decision: Decision): string {
  return `intent-${decision.id ?? "undecided"}`;
}
