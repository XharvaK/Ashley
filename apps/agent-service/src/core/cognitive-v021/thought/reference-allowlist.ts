import { sha256 } from "../../model-fabric/hash.js";
import type { ExistingRef, LocalAlias, SemanticRef } from "../types.js";

/**
 * Target domains whose identities are present in the current Thought input.
 * Other opaque references remain allowlist-only because this input does not
 * carry enough state to prove their target domain.
 */
export type ThoughtReferenceTarget = "working_context" | "concern" | "observation";

export type ThoughtReferenceTargetMap = ReadonlyMap<
  string,
  readonly ThoughtReferenceTarget[]
>;

export type ThoughtReferenceAllowlist = {
  readonly existing: ReadonlySet<string>;
  readonly fingerprint: string;
  readonly targetDomains: ReadonlyMap<string, ReadonlySet<ThoughtReferenceTarget>>;
  readonly aliases: Set<string>;
};

export function buildReferenceAllowlist(
  references: readonly string[],
  targetDomains: ThoughtReferenceTargetMap = new Map(),
): ThoughtReferenceAllowlist {
  const existing = new Set(references.filter((ref) => typeof ref === "string" && ref.length > 0));
  const knownTargetDomains = new Map<string, ReadonlySet<ThoughtReferenceTarget>>();
  for (const [ref, targets] of targetDomains) {
    if (!existing.has(ref)) continue;
    const known = new Set<ThoughtReferenceTarget>(targets);
    if (known.size > 0) knownTargetDomains.set(ref, known);
  }
  return {
    existing,
    fingerprint: `sha256:${sha256([...existing].sort())}`,
    targetDomains: knownTargetDomains,
    aliases: new Set(),
  };
}

/**
 * Return false only when the allowlist has positively identified a different
 * target domain. A missing domain entry means the reference remains opaque and
 * is therefore accepted by the existing allowlist law.
 */
export function hasReferenceTarget(
  allowlist: ThoughtReferenceAllowlist,
  ref: string,
  expectedTarget: ThoughtReferenceTarget,
): boolean {
  const known = allowlist.targetDomains.get(ref);
  return known === undefined || known.has(expectedTarget);
}

export function registerLocalAlias(
  allowlist: ThoughtReferenceAllowlist,
  alias: string,
): LocalAlias {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(alias)) throw new Error("alias_invalid");
  if (allowlist.existing.has(alias)) throw new Error("alias_collides_with_existing_ref");
  if (allowlist.aliases.has(alias)) throw new Error("alias_duplicate");
  allowlist.aliases.add(alias);
  return alias as LocalAlias;
}

export type ResolvedReference =
  | { ok: true; ref: ExistingRef }
  | { ok: true; alias: LocalAlias }
  | { ok: false; code: "reference_not_allowlisted" | "alias_not_registered" | "reference_shape_invalid" };

export function resolveReference(
  allowlist: ThoughtReferenceAllowlist,
  value: SemanticRef | { kind: "existing"; ref: string } | { kind: "local"; alias: string },
): ResolvedReference {
  if (!value || (value.kind !== "existing" && value.kind !== "local")) {
    return { ok: false, code: "reference_shape_invalid" };
  }
  if (value.kind === "existing") {
    return allowlist.existing.has(value.ref)
      ? { ok: true, ref: value.ref as ExistingRef }
      : { ok: false, code: "reference_not_allowlisted" };
  }
  return allowlist.aliases.has(value.alias)
    ? { ok: true, alias: value.alias as LocalAlias }
    : { ok: false, code: "alias_not_registered" };
}
