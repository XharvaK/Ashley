import { createHash } from "node:crypto";
import type { NuclearTake } from "../../curiosity/feed.js";
import type { ReadRecord } from "../../curiosity/reads.js";
import {
  CREDENTIAL_OMITTED_PLACEHOLDER,
  detectCredentialShape,
} from "../../privacy/secrets.js";
import {
  type CycleId,
  type Generation,
  type Observation,
} from "../types.js";

type ObservationDraft = Omit<Observation, "cycleId" | "generation">;

export type PerceptionAdapterInput = {
  cycleId: CycleId;
  generation: Generation;
  ownerMessage: string;
  runPerception: (input: {
    cycleId: CycleId;
    generation: Generation;
    ownerMessage: string;
  }) => Promise<Observation[]>;
};

/**
 * Perception is an upstream read. It is normalized into the active cycle
 * identity before Thought sees it; this adapter has no semantic publication
 * or execution side effects.
 */
export async function adaptPerception(
  input: PerceptionAdapterInput,
): Promise<Observation[]> {
  const observations = await input.runPerception({
    cycleId: input.cycleId,
    generation: input.generation,
    ownerMessage: input.ownerMessage,
  });
  return observations.map((observation) => ({
    ...observation,
    cycleId: input.cycleId,
    generation: input.generation,
    derived: observation.derived === true,
    replaySafe: observation.replaySafe === true,
    provenance: observation.provenance || "perception",
    dataClassification: observation.dataClassification ?? "never_public",
    secretOmitted: observation.secretOmitted === true,
  }));
}

export const runPerceptionBeforeThought = adaptPerception;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function curiosityProvenance(
  sourceIdentity: string,
  evidenceIdentity: string,
  capturedAt: string,
  citationRefs: string[],
): {
  sourceIdentity: string;
  evidenceIdentity: string;
  capturedAt: string;
  citationRefs: string[];
  completeness: "complete";
} {
  return {
    sourceIdentity,
    evidenceIdentity,
    capturedAt,
    citationRefs,
    completeness: "complete",
  };
}

/**
 * Adapt one live grounded read into non-authoritative Thought evidence.
 * Shadow reads remain time-shift isolated and are never projected here.
 */
export function readRecordToObservationDraft(
  read: ReadRecord,
): ObservationDraft | null {
  if (read.provenance !== "live") return null;
  const credential = detectCredentialShape(
    `${read.finalUrl}\n${read.title}\n${read.evidenceExcerpts.join("\n")}`,
  ).hit;
  const identity = `curiosity:read:${read.id}:${read.contentHash.trim().toLowerCase()}`;
  const provenance = curiosityProvenance(
    `url:${sha256(read.finalUrl)}`,
    `sha256:${read.contentHash.trim().toLowerCase()}`,
    read.retrievedAt,
    [`curiosity:read:${read.id}`],
  );
  return {
    observationId: identity,
    derived: true,
    replaySafe: true,
    modality: "page",
    payload: {
      readId: read.id,
      itemId: read.itemId,
      finalUrl: credential ? CREDENTIAL_OMITTED_PLACEHOLDER : read.finalUrl,
      contentHash: read.contentHash,
      retrievedAt: read.retrievedAt,
      title: credential ? CREDENTIAL_OMITTED_PLACEHOLDER : read.title,
      excerpts: credential ? [] : read.evidenceExcerpts.slice(0, 6),
      inputTrust: "untrusted_evidence",
      provenance,
    },
    provenance: identity,
    dataClassification: credential ? "secret" : "ordinary",
    secretOmitted: credential,
  };
}

/** Adapt one live source-derived take without creating a semantic nomination. */
export function nuclearTakeToObservationDraft(
  take: NuclearTake,
): ObservationDraft | null {
  if (take.provenance !== "live") return null;
  if (take.evidenceKind === "read_record" && take.readProvenance !== "live") {
    return null;
  }
  const credential = detectCredentialShape(
    `${take.url}\n${take.title}\n${take.take}`,
  ).hit;
  const identity = `curiosity:take:${take.id}`;
  const evidenceIdentity = take.evidenceKind === "read_record" && take.readId != null
    ? `curiosity:read:${take.readId}`
    : `sha256:${sha256(take.take)}`;
  const provenance = curiosityProvenance(
    `url:${sha256(take.url)}`,
    evidenceIdentity,
    take.createdAt,
    [
      `curiosity:take:${take.id}`,
      ...(take.readId != null ? [`curiosity:read:${take.readId}`] : []),
    ],
  );
  return {
    observationId: identity,
    derived: true,
    replaySafe: true,
    modality: "subscription",
    payload: {
      takeId: take.id,
      itemId: take.itemId,
      readId: take.readId,
      evidenceKind: take.evidenceKind,
      sourceUrl: credential ? CREDENTIAL_OMITTED_PLACEHOLDER : take.url,
      title: credential ? CREDENTIAL_OMITTED_PLACEHOLDER : take.title,
      take: credential ? CREDENTIAL_OMITTED_PLACEHOLDER : take.take,
      authorityClass: take.authorityClass,
      inputTrust: "untrusted_evidence",
      provenance,
    },
    provenance: identity,
    dataClassification: credential ? "secret" : "ordinary",
    secretOmitted: credential,
  };
}
