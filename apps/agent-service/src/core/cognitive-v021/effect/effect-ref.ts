import { createHash } from "node:crypto";
import { sha256 } from "../../model-fabric/hash.js";

const EFFECT_REF_DOMAIN_SEPARATOR = "ashley:effect:v1:";

/**
 * Mint a deterministic opaque host-derived effect reference.
 * Thought may only echo allowlisted refs; Thought must never receive raw host effect UUIDs.
 */
export function mintEffectRef(cycleId: string, generation: number, effectId: string): string {
  const hash = createHash("sha256")
    .update(`${EFFECT_REF_DOMAIN_SEPARATOR}${cycleId}:${generation}:${effectId}`, "utf8")
    .digest("hex");
  return `effect:${hash}`;
}

export type OperationalEffectNamespace = Readonly<{
  allowedOperationalEffectRefs: readonly string[];
  fingerprint: `sha256:${string}`;
}>;

/**
 * Normalize the complete Host-owned operational reference namespace. The
 * normalized value is the shared source for Thought projection, wire-schema
 * narrowing, and dynamic settlement validation.
 */
export function buildOperationalEffectNamespaceFromRefs(
  refs: readonly string[],
): OperationalEffectNamespace {
  const allowedOperationalEffectRefs = Object.freeze(
    [...new Set(refs.filter((ref) => typeof ref === "string" && ref.length > 0))].sort(),
  );
  return Object.freeze({
    allowedOperationalEffectRefs,
    fingerprint: `sha256:${sha256({
      namespace: "ashley.operational-effects.v1",
      allowedOperationalEffectRefs,
    })}` as `sha256:${string}`,
  });
}

export function buildOperationalEffectNamespace(
  cycleId: string,
  generation: number,
  effectIds: readonly string[],
): OperationalEffectNamespace {
  return buildOperationalEffectNamespaceFromRefs(
    effectIds.map((effectId) => mintEffectRef(cycleId, generation, effectId)),
  );
}

export function buildEffectRefMap(
  cycleId: string,
  generation: number,
  effectIds: readonly string[],
): {
  refToId: Map<string, string>;
  idToRef: Map<string, string>;
  allowlist: Set<string>;
} {
  const namespace = buildOperationalEffectNamespace(cycleId, generation, effectIds);
  const refToId = new Map<string, string>();
  const idToRef = new Map<string, string>();
  const normalizedEffectIds = [...new Set(effectIds)].sort();
  for (const id of normalizedEffectIds) {
    const ref = mintEffectRef(cycleId, generation, id);
    refToId.set(ref, id);
    idToRef.set(id, ref);
  }
  return {
    refToId,
    idToRef,
    allowlist: new Set(namespace.allowedOperationalEffectRefs),
  };
}
