import type { DatabaseSync } from "node:sqlite";
import { canEnterModelContext } from "../../privacy/classification.js";
import type { LearnedSelfSlice, MemoryAssertion, MemoryKind } from "../types.js";
import type { SocialAudience } from "../social/types.js";
import { listMemoryAssertions } from "../memory/assertions.js";

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
  broadAudienceScope: SocialAudience | null;
  broadScopeAmbiguous: boolean;
  broadHasUnscopedEvidence: boolean;
  broadProtectionStatus: "admitted" | "unresolved" | null;
  linked: Map<string, {
    audience: SocialAudience;
    dispositions: string[];
    interests: string[];
    sourceRefs: string[];
    protectionStatus: "admitted" | "unresolved" | null;
  }>;
};

function audienceKey(audience: SocialAudience): string {
  if (audience.kind === "owner_private") return "owner_private";
  if (audience.kind === "dm") return `dm:${audience.principalId}`;
  return `room:${audience.roomId}`;
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

function addEntry(slice: MutableSelfSlice, assertion: MemoryAssertion): void {
  if (!assertion.live || assertion.memoryKind !== "learned_self_evidence") return;
  if (!canEnterModelContext(assertion.dataClassification, "private")) return;
  const statement = assertion.statement.trim();
  if (!statement) return;

  const scope = assertion.audienceScope;
  if (scope && (scope.kind === "dm" || scope.kind === "room")) {
    const key = audienceKey(scope);
    const linked = slice.linked.get(key) ?? {
      audience: scope,
      dispositions: [],
      interests: [],
      sourceRefs: [],
      protectionStatus: null,
    };
    addText(linked, statement);
    if (assertion.sourceEvidenceRef) linked.sourceRefs.push(assertion.sourceEvidenceRef);
    if (linked.protectionStatus === null && assertion.protectionStatus !== undefined) {
      linked.protectionStatus = assertion.protectionStatus;
    }
    slice.linked.set(key, linked);
    return;
  }

  addText({ dispositions: slice.broadDispositions, interests: slice.broadInterests }, statement);
  if (!assertion.audienceScope) {
    slice.broadHasUnscopedEvidence = true;
  } else if (slice.broadAudienceScope === null && !slice.broadHasUnscopedEvidence && !slice.broadScopeAmbiguous) {
    slice.broadAudienceScope = assertion.audienceScope;
  } else if (slice.broadAudienceScope && audienceKey(slice.broadAudienceScope) !== audienceKey(assertion.audienceScope)) {
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
  for (const assertion of assertions) addEntry(slice, assertion);

  // Keep the legacy enumerable shape stable for Owner-path snapshots. The
  // audience-separated projection is available to the P12 filter as
  // non-enumerable in-process metadata and becomes enumerable only when an
  // external Thought input is assembled.
  const result: LearnedSelfSlice = {
    dispositions: [...new Set([
      ...slice.broadDispositions,
      ...[...slice.linked.values()].flatMap((entry) => entry.dispositions),
    ])],
    interests: [...new Set([
      ...slice.broadInterests,
      ...[...slice.linked.values()].flatMap((entry) => entry.interests),
    ])],
  };
  const broadOrientation = Object.freeze({
    dispositions: [...new Set(slice.broadDispositions)],
    interests: [...new Set(slice.broadInterests)],
    audienceScope: slice.broadScopeAmbiguous || slice.broadHasUnscopedEvidence ? null : slice.broadAudienceScope,
    protectionStatus: slice.broadProtectionStatus,
  });
  const personLinked = Object.freeze([...slice.linked.values()].map((entry) => Object.freeze({
    audience: entry.audience,
    dispositions: [...new Set(entry.dispositions)],
    interests: [...new Set(entry.interests)],
    sourceRefs: [...new Set(entry.sourceRefs)],
    protectionStatus: entry.protectionStatus,
  })));
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
  return result;
}

export const readLearnedSelfSlice = buildLearnedSelfSlice;
