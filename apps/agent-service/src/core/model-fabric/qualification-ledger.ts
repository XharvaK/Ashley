import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertArtifactIntegrity,
  writeImmutableArtifact,
  type ArtifactValue,
  type ControlRootMode,
} from "./activation.js";
import {
  hasThoughtQualificationEvidence,
  THOUGHT_QUALIFICATION_RESULT_SCHEMA,
  type QualificationResultRecord,
  type ThoughtQualificationResultRecord,
} from "./catalog.js";
import {
  assertThoughtCapabilityEvidence,
  buildThoughtCapabilityIdentity,
  type ThoughtCapabilityIdentity,
} from "./capability-identity.js";
import { releaseTruthForRuntime, type ReleaseTruthResult } from "./release-truth.js";
import type { WireDispatchEvidence } from "../model-routing/types.js";
import { freezeDeep } from "./hash.js";

export type ThoughtQualificationResult = ThoughtQualificationResultRecord & {
  capability: ThoughtCapabilityIdentity;
  logicalEvidence: { contractId: string; schemaFingerprint: string; bindingId: string };
  wireEvidence: WireDispatchEvidence;
  resourceEvidence: { deadlineMs: number; maxOutputTokens: number; attempts: number };
};

function safeId(value: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("model_fabric_artifact_id_invalid");
}

function validateThoughtEvidence(input: {
  capability: ThoughtCapabilityIdentity;
  logicalEvidence: ThoughtQualificationResult["logicalEvidence"];
  wireEvidence: ThoughtQualificationResult["wireEvidence"];
  resourceEvidence: ThoughtQualificationResult["resourceEvidence"];
}): void {
  assertThoughtCapabilityEvidence(input);
}

export function createThoughtQualificationResult(input: {
  base: Omit<QualificationResultRecord, "capability" | "logicalEvidence" | "wireEvidence" | "resourceEvidence">;
  capability: ThoughtCapabilityIdentity;
  logicalEvidence: ThoughtQualificationResult["logicalEvidence"];
  wireEvidence: ThoughtQualificationResult["wireEvidence"];
  resourceEvidence: ThoughtQualificationResult["resourceEvidence"];
}): ThoughtQualificationResult {
  if (input.base.status !== "PASS") throw new Error("qualification_result_not_pass");
  if (input.base.invalidated) throw new Error("qualification_result_invalidated");
  validateThoughtEvidence(input);
  if (input.base.profileBinding.provider !== input.capability.components.provider
    || input.base.profileBinding.configuredModelId !== input.capability.components.configuredModelId
    || input.base.occupantId !== input.capability.components.occupantId) {
    throw new Error("qualification_capability_mismatch");
  }
  return freezeDeep({
    ...input.base,
    schema: THOUGHT_QUALIFICATION_RESULT_SCHEMA,
    capability: input.capability,
    logicalEvidence: { ...input.logicalEvidence },
    wireEvidence: { ...input.wireEvidence },
    resourceEvidence: { ...input.resourceEvidence },
  }) as ThoughtQualificationResult;
}

export function writeThoughtQualificationArtifact(input: {
  controlDir: string;
  result: ThoughtQualificationResult;
  controlRootMode: ControlRootMode;
}): string {
  return writeImmutableArtifact({
    controlDir: input.controlDir,
    directory: "qualifications",
    id: input.result.qualificationResultId,
    artifact: input.result as ThoughtQualificationResult & ArtifactValue,
    controlRootMode: input.controlRootMode,
  });
}

export function writeReleaseTruthArtifact(input: {
  controlDir: string;
  result: ReleaseTruthResult;
  controlRootMode: ControlRootMode;
}): string {
  return writeImmutableArtifact({
    controlDir: input.controlDir,
    directory: "release-truth",
    id: input.result.releaseTruthId,
    artifact: input.result as ReleaseTruthResult & ArtifactValue,
    controlRootMode: input.controlRootMode,
  });
}

function readArtifact<T extends ArtifactValue>(input: {
  controlDir: string;
  directory: "qualifications" | "release-truth";
  id: string;
  controlRootMode: ControlRootMode;
}): T | null {
  safeId(input.id);
  const path = join(input.controlDir, input.directory, `${input.id}.json`);
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8")) as T;
  if (value.artifactKind !== undefined && value.artifactKind !== input.controlRootMode) {
    throw new Error(value.artifactKind === "fixture" ? "fixture_artifact_in_production_control_dir" : "production_artifact_in_fixture_control_dir");
  }
  assertArtifactIntegrity(value);
  return value;
}

export function readThoughtQualificationArtifact(input: {
  controlDir: string;
  qualificationResultId: string;
  controlRootMode: ControlRootMode;
}): ThoughtQualificationResult | null {
  const result = readArtifact<ThoughtQualificationResult & ArtifactValue>({ ...input, directory: "qualifications", id: input.qualificationResultId });
  if (!result) return null;
  if (!hasThoughtQualificationEvidence(result)) {
    throw new Error("qualification_schema_unsupported");
  }
  validateThoughtEvidence(result);
  return result as ThoughtQualificationResult;
}

export function readReleaseTruthArtifact(input: {
  controlDir: string;
  releaseTruthId: string;
  controlRootMode: ControlRootMode;
}): ReleaseTruthResult | null {
  const result = readArtifact<ReleaseTruthResult & ArtifactValue>({ ...input, directory: "release-truth", id: input.releaseTruthId });
  if (!result) return null;
  if (result.schema !== "ashley.release_truth.v1" || !result.contentHash || !Array.isArray(result.mismatchCodes)) throw new Error("release_truth_schema_unsupported");
  return result;
}

export { buildThoughtCapabilityIdentity, releaseTruthForRuntime };
