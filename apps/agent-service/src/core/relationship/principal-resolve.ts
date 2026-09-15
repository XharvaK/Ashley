/**
 * Mechanical principal resolution for the bounded Owner control phase.
 *
 * This module deliberately receives source-owned candidate indexes. It does
 * not infer identity from display-name similarity, handles, or free text.
 */

export type PrincipalRef =
  | { kind: "mention"; userId: string; messageId: string }
  | { kind: "reply_to"; messageId: string }
  | { kind: "name"; value: string; messageId: string };

export type NamedPrincipalCandidate = {
  exactName: string;
  principalId: string;
};

export type PrincipalResolutionContext = {
  replyAuthors?: Readonly<Record<string, string>>;
  roomMembers?: readonly NamedPrincipalCandidate[];
  permits?: readonly NamedPrincipalCandidate[];
  recentEnvelopes?: readonly NamedPrincipalCandidate[];
};

export type PrincipalResolution =
  | { ok: true; principalId: string; source: "mention" | "reply_to" | "room_member" | "permit" | "recent_envelope" }
  | { ok: false; reason: "ambiguous_principal" | "principal_missing" };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function exactCandidates(
  value: string,
  candidates: readonly NamedPrincipalCandidate[] | undefined,
): string[] {
  if (!candidates) return [];
  return [...new Set(candidates
    .filter((candidate) => candidate.exactName === value && nonEmpty(candidate.principalId))
    .map((candidate) => candidate.principalId.trim()))];
}

function resolveNamed(
  value: string,
  candidates: readonly NamedPrincipalCandidate[] | undefined,
  source: "room_member" | "permit" | "recent_envelope",
): PrincipalResolution | null {
  const matches = exactCandidates(value, candidates);
  if (matches.length === 0) return null;
  if (matches.length !== 1) return { ok: false, reason: "ambiguous_principal" };
  return { ok: true, principalId: matches[0], source };
}

/** Resolve an already-attributed reference without guessing identity. */
export function resolvePrincipalRef(
  ref: PrincipalRef,
  context: PrincipalResolutionContext = {},
): PrincipalResolution {
  if (ref.kind === "mention") {
    return nonEmpty(ref.userId)
      ? { ok: true, principalId: ref.userId.trim(), source: "mention" }
      : { ok: false, reason: "principal_missing" };
  }

  if (ref.kind === "reply_to") {
    const principalId = context.replyAuthors?.[ref.messageId];
    return nonEmpty(principalId)
      ? { ok: true, principalId: principalId.trim(), source: "reply_to" }
      : { ok: false, reason: "principal_missing" };
  }

  if (!nonEmpty(ref.value)) return { ok: false, reason: "principal_missing" };
  const value = ref.value.trim();
  return resolveNamed(value, context.roomMembers, "room_member")
    ?? resolveNamed(value, context.permits, "permit")
    ?? resolveNamed(value, context.recentEnvelopes, "recent_envelope")
    ?? { ok: false, reason: "ambiguous_principal" };
}

