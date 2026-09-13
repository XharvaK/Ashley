import { createHash } from "node:crypto";

function hashMaterial(material: string): string {
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function semanticIdentityHash(input: {
  ownerId: string;
  sourceType: string;
  sourceId: string;
  sourceEntityUuid: string;
  kind: string;
  semanticSummary: string;
  sourceRevision: string;
}): string {
  return hashMaterial([
    "open-cognitive-item-semantic-v1",
    input.ownerId,
    input.sourceType,
    input.sourceId,
    input.sourceEntityUuid,
    input.kind,
    input.semanticSummary,
    input.sourceRevision,
  ].join("\u0000"));
}

export function continuityGeneration(input: {
  contractId: string;
  buildIdentity: string;
  modelIdentity: string;
  modelEpoch: number;
}): string {
  return hashMaterial([
    "open-cognitive-item-continuity-generation-v1",
    input.contractId,
    input.buildIdentity,
    input.modelIdentity,
    String(input.modelEpoch),
  ].join("\u0000"));
}

export function durableSemanticKeyHash(input: {
  semanticIdentityHash: string;
  continuityGeneration: string;
}): string {
  return hashMaterial([
    "open-cognitive-item-durable-key-v4",
    input.semanticIdentityHash,
    input.continuityGeneration,
  ].join("\u0000"));
}
