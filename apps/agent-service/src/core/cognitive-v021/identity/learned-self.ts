import type { DatabaseSync } from "node:sqlite";
import { canEnterModelContext } from "../../privacy/classification.js";
import type { LearnedSelfEvidenceEntry, LearnedSelfSlice, MemoryAssertion, MemoryKind, MemorySupport } from "../types.js";
import type { SocialAudience } from "../social/types.js";
import { listMemoryAssertions } from "../memory/assertions.js";
import { listMemorySupports, supportConversationId } from "../memory/supports.js";
import { hasLearnedSelfThoughtAdoption } from "../memory/admission.js";
import { validateSourceSupportRefs } from "../evidence/interpretation-envelope.js";

export type LearnedSelfEntry = {
  memoryKind: MemoryKind;
  statement: string;
};

/** LearnedSelf is a read-only projection; callers cannot persist candidates here. */
export function validateLearnedSelfEntry(input: LearnedSelfEntry): true {
  if (input.memoryKind === "owner_world_claim") {
    throw new Error("learned_self_world_claim_forbidden");
  }
  if (input.memoryKind !== "learned_self_evidence") {
    throw new Error("learned_self_kind_invalid");
  }
  if (!input.statement.trim()) throw new Error("learned_self_statement_required");
  return true;
}

type MutableSelfSlice = {
  broadDispositions: string[];
  broadInterests: string[];
  broadSupportRefs: string[];
  broadEntries: LearnedSelfEvidenceEntry[];
  supportRefs: string[];
  broadAudienceScope: SocialAudience | null;
  broadScopeAmbiguous: boolean;
  broadHasUnscopedEvidence: boolean;
  broadProtectionStatus: "admitted" | "unresolved" | null;
  linked: Map<string, {
    audience: SocialAudience;
    sourcePrincipal: string | null;
    dispositions: string[];
    interests: string[];
    sourceRefs: string[];
    supportRefs: string[];
    entries: LearnedSelfEvidenceEntry[];
    protectionStatus: "admitted" | "unresolved" | null;
  }>;
};

function audienceKey(audience: SocialAudience): string {
  if (audience.kind === "owner_private") return "owner_private";
  if (audience.kind === "owner_dm") return `owner_dm:${audience.threadId}`;
  if (audience.kind === "dm") return `dm:${audience.principalId}`;
  return `room:${audience.roomId}`;
}

function isKnownAudience(value: SocialAudience | null | undefined): value is SocialAudience {
  if (!value || typeof value !== "object") return false;
  return value.kind === "owner_private" || value.kind === "owner_dm" ||
    value.kind === "dm" || value.kind === "room";
}

function addText(target: { dispositions: string[]; interests: string[] }, statement: string): void {
  if (statement.toLowerCase().startsWith("interest:")) {
    target.interests.push(statement.slice("interest:".length).trim());
  } else if (statement.toLowerCase().startsWith("disposition:")) {
    target.dispositions.push(statement.slice("disposition:".length).trim());
  } else {
    target.dispositions.push(statement);
  }
}

function supportAvailability(
  db: DatabaseSync,
  assertion: MemoryAssertion,
  supports: MemorySupport[],
): LearnedSelfEvidenceEntry["supportAvailability"] {
  const typed = supports.filter((support) => support.supportRef !== undefined);
  if (typed.length === 0) return "unknown";
  const ownerOrigin = assertion.dimensions.source === "owner_utterance"
    || assertion.dimensions.reliability === "owner_supplied";
  for (const support of typed) {
    const conversationId = supportConversationId(db, support);
    if (!conversationId || !support.supportRef) return "unavailable";
    try {
      const [source] = validateSourceSupportRefs(db, [support.supportRef], conversationId);
      if (ownerOrigin && source?.principalKind !== "owner") return "unavailable";
    } catch {
      return "unavailable";
    }
  }
  return "intact";
}

function addEntry(slice: MutableSelfSlice, assertion: MemoryAssertion, db: DatabaseSync): void {
  if (!assertion.live || assertion.memoryKind !== "learned_self_evidence") return;
  if (!canEnterModelContext(assertion.dataClassification, "private")) return;
  if (!hasLearnedSelfThoughtAdoption(db, assertion.assertionKey)) return;
  const statement = assertion.statement.trim();
  if (!statement) return;
  const supports = listMemorySupports(db, assertion.assertionKey);
  const supportRefs = supports.flatMap(
    (support) => support.sourceRef == null ? [] : [support.sourceRef],
  );
  slice.supportRefs.push(...supportRefs);
  const projectedEvidence: LearnedSelfEvidenceEntry = {
    statement,
    time: assertion.dimensions.time,
    supportAvailability: supportAvailability(db, assertion, supports),
  };

  const scope = isKnownAudience(assertion.audienceScope) ? assertion.audienceScope : null;
  if (scope && (scope.kind === "owner_dm" || scope.kind === "dm" || scope.kind === "room")) {
    // A room can contain more than one participant. Keep each attributed
    // source separate so a participant statement cannot lose its speaker.
    const sourcePrincipal = assertion.sourcePrincipal ?? null;
    const key = `${audienceKey(scope)}:${sourcePrincipal ?? ""}`;
    const linked = slice.linked.get(key) ?? {
      audience: scope,
      sourcePrincipal,
      dispositions: [],
      interests: [],
      sourceRefs: [],
      supportRefs: [],
      entries: [],
      protectionStatus: null,
    };
    addText(linked, statement);
    linked.entries.push(projectedEvidence);
    if (assertion.sourceEvidenceRef) linked.sourceRefs.push(assertion.sourceEvidenceRef);
    linked.supportRefs.push(...supportRefs);
    if (linked.protectionStatus === null && assertion.protectionStatus !== undefined) {
      linked.protectionStatus = assertion.protectionStatus;
    }
    slice.linked.set(key, linked);
    return;
  }

  addText({ dispositions: slice.broadDispositions, interests: slice.broadInterests }, statement);
  slice.broadEntries.push(projectedEvidence);
  slice.broadSupportRefs.push(...supportRefs);
  if (!scope) {
    slice.broadHasUnscopedEvidence = true;
  } else if (slice.broadAudienceScope === null && !slice.broadHasUnscopedEvidence && !slice.broadScopeAmbiguous) {
    slice.broadAudienceScope = scope;
  } else if (slice.broadAudienceScope && audienceKey(slice.broadAudienceScope) !== audienceKey(scope)) {
    slice.broadScopeAmbiguous = true;
    slice.broadAudienceScope = null;
  }
  if (slice.broadProtectionStatus === null && assertion.protectionStatus !== undefined) {
    slice.broadProtectionStatus = assertion.protectionStatus;
  }
}

export function buildLearnedSelfSlice(
  db: DatabaseSync,
  supplied?: MemoryAssertion[],
): LearnedSelfSlice {
  const slice: MutableSelfSlice = {
    broadDispositions: [],
    broadInterests: [],
    broadSupportRefs: [],
    broadEntries: [],
    supportRefs: [],
    broadAudienceScope: null,
    broadScopeAmbiguous: false,
    broadHasUnscopedEvidence: false,
    broadProtectionStatus: null,
    linked: new Map(),
  };
  const assertions = supplied ?? listMemoryAssertions(db, {
    live: true,
    memoryKinds: ["learned_self_evidence"],
    modelContext: true,
  });
  for (const assertion of assertions) addEntry(slice, assertion, db);

  // Keep participant-linked memory out of the Owner-facing aggregate. The
  // audience-separated projection remains available to the input filter as
  // non-enumerable in-process metadata and becomes enumerable only when an
  // external Thought input is assembled for the matching audience.
  const result: LearnedSelfSlice = {
    dispositions: [...new Set(slice.broadDispositions)],
    interests: [...new Set(slice.broadInterests)],
  };
  const broadOrientation = Object.freeze({
    dispositions: [...new Set(slice.broadDispositions)],
    interests: [...new Set(slice.broadInterests)],
    ...(slice.broadSupportRefs.length > 0 ? { supportRefs: [...new Set(slice.broadSupportRefs)] } : {}),
    entries: [...slice.broadEntries],
    audienceScope: slice.broadScopeAmbiguous || slice.broadHasUnscopedEvidence ? null : slice.broadAudienceScope,
    protectionStatus: slice.broadProtectionStatus,
  });
  const personLinked = Object.freeze([...slice.linked.values()].map((entry) => Object.freeze({
    audience: entry.audience,
    sourcePrincipal: entry.sourcePrincipal,
    dispositions: [...new Set(entry.dispositions)],
    interests: [...new Set(entry.interests)],
    sourceRefs: [...new Set(entry.sourceRefs)],
    ...(entry.supportRefs.length > 0 ? { supportRefs: [...new Set(entry.supportRefs)] } : {}),
    entries: [...entry.entries],
    protectionStatus: entry.protectionStatus,
  })));
  const supportRefs = [...new Set(slice.supportRefs)];
  Object.defineProperties(result, {
    broadOrientation: {
      value: broadOrientation,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    personLinked: {
      value: personLinked,
      enumerable: false,
      writable: false,
      configurable: false,
    },
  });
  if (supportRefs.length > 0) result.supportRefs = supportRefs;
  return result;
}

export const readLearnedSelfSlice = buildLearnedSelfSlice;
