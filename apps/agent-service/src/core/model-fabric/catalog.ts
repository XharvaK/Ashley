import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freezeDeep } from "./hash.js";
import { currentPortfolio } from "./portfolio.js";
import type {
  ModelFabricOccupant,
  ModelFabricPolicyRow,
} from "./portfolio.js";
import type { LogicalModelRole, ModelCapabilityProfile } from "./types.js";
import type { ThoughtCapabilityIdentity } from "./capability-identity.js";

export const THOUGHT_QUALIFICATION_RESULT_SCHEMA =
  "ashley.evaluation.qualification_result.v2" as const;
export type QualificationResultSchema =
  | "ashley.evaluation.qualification_result.v1"
  | typeof THOUGHT_QUALIFICATION_RESULT_SCHEMA;

export type ThoughtLogicalQualificationEvidence = Readonly<{
  contractId: string;
  schemaFingerprint: string;
  bindingId: string;
}>;

export type ThoughtWireQualificationEvidence = Readonly<{
  adapterId: string;
  wireFormat: string;
  sanitizedBodyDigest: string;
  emittedEnforcementMode: string;
  providerDeclaredEnforcement: string | "unavailable";
  bindingId?: string | null;
}>;

export type ThoughtResourceQualificationEvidence = Readonly<{
  deadlineMs: number;
  maxOutputTokens: number;
  attempts: number;
}>;

export type CatalogLifecycle =
  | "discovered"
  | "unqualified"
  | "qualifying"
  | "qualified"
  | "owner_approved"
  | "degraded"
  | "unavailable"
  | "retired";

export type CatalogEntry = Readonly<{
  occupantId: string;
  provider: string;
  configuredModelId: string;
  independenceGroup: string;
  lifecycle: CatalogLifecycle;
  discoveredBy: "owner_import" | "operator_import" | "authorized_discovery";
  qualificationResultId: string | null;
  ownerApprovalRefId: string | null;
}>;

export type FabricSeat = Readonly<{
  seat: string;
  userVisibleProductionRole: boolean;
  candidateOnly: boolean;
  firstVertical?: boolean;
  requiresIndependentDualReview?: boolean;
  ownedBy?: string;
  targetOccupant?: string;
  independenceConstraint?: string | null;
}>;

export type FabricCatalog = Readonly<{
  independenceGroups: Readonly<Record<string, readonly string[]>>;
  seats: readonly FabricSeat[];
  couplings: Readonly<Record<string, readonly string[]>>;
}>;

export type QualificationResultRecord = {
  schema: QualificationResultSchema;
  qualificationResultId: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "INCONCLUSIVE" | "NOT_RUN";
  policyRowId: string;
  occupantId: string;
  subject: {
    logicalRole: LogicalModelRole;
    seat: string | null;
    materialInferenceFingerprint: string;
  };
  profileBinding: {
    profileId: string;
    profileVersion: number;
    profileFingerprint: string;
    provider: string;
    configuredModelId: string;
  };
  identityContinuityEpoch: string | number | null;
  recommendation: "owner_review" | "do_not_promote" | string;
  limitations: readonly string[];
  invalidated: boolean;
  invalidatedBy: string | null;
  /** Present only on W1 Thought qualification records; old records remain audit-readable. */
  capability?: ThoughtCapabilityIdentity;
  logicalEvidence?: ThoughtLogicalQualificationEvidence;
  wireEvidence?: ThoughtWireQualificationEvidence;
  resourceEvidence?: ThoughtResourceQualificationEvidence;
};

export type ThoughtQualificationResultRecord = Omit<
  QualificationResultRecord,
  "schema" | "capability" | "logicalEvidence" | "wireEvidence" | "resourceEvidence"
> & {
  schema: typeof THOUGHT_QUALIFICATION_RESULT_SCHEMA;
  capability: ThoughtCapabilityIdentity;
  logicalEvidence: ThoughtLogicalQualificationEvidence;
  wireEvidence: ThoughtWireQualificationEvidence;
  resourceEvidence: ThoughtResourceQualificationEvidence;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Structural W1 gate. Full canonical validation belongs to the ledger writer/reader. */
export function hasThoughtQualificationEvidence(
  result: QualificationResultRecord,
): result is ThoughtQualificationResultRecord {
  const capability = result.capability;
  const logical = result.logicalEvidence;
  const wire = result.wireEvidence;
  const resource = result.resourceEvidence;
  return (
    result.schema === THOUGHT_QUALIFICATION_RESULT_SCHEMA &&
    capability !== undefined &&
    nonEmptyString(capability.fingerprint) &&
    logical !== undefined &&
    nonEmptyString(logical.contractId) &&
    nonEmptyString(logical.schemaFingerprint) &&
    nonEmptyString(logical.bindingId) &&
    wire !== undefined &&
    nonEmptyString(wire.adapterId) &&
    nonEmptyString(wire.wireFormat) &&
    nonEmptyString(wire.sanitizedBodyDigest) &&
    nonEmptyString(wire.emittedEnforcementMode) &&
    nonEmptyString(wire.providerDeclaredEnforcement) &&
    resource !== undefined &&
    Number.isInteger(resource.deadlineMs) &&
    Number.isInteger(resource.maxOutputTokens) &&
    Number.isInteger(resource.attempts)
  );
}

export type QualificationBinding = Readonly<{
  qualificationResultId: string;
  policyRowId: string;
  occupantId: string;
  profileId: string;
  profileVersion: number;
  profileFingerprint: string;
  provider: string;
  configuredModelId: string;
  materialInferenceFingerprint: string;
  identityContinuityEpoch: string | number | null;
}>;

export type TargetPortfolio = Readonly<{
  schema: "ashley.model_fabric.portfolio_revision.v1";
  portfolioRevisionId: string;
  kind: "candidate_target";
  status: "declared" | "superseded";
  rows: readonly ModelFabricPolicyRow[];
  sourcePath: string;
  incompleteFixture?: boolean;
}>;

const LIFECYCLE_TRANSITIONS: Readonly<Record<CatalogLifecycle, readonly CatalogLifecycle[]>> = {
  discovered: ["unqualified", "retired"],
  unqualified: ["qualifying", "retired"],
  qualifying: ["qualified", "unqualified", "retired"],
  qualified: ["owner_approved", "degraded", "unavailable", "retired"],
  owner_approved: ["degraded", "unavailable", "retired"],
  degraded: ["unavailable", "retired"],
  unavailable: ["retired"],
  retired: [],
};

export function modelFabricConfigFilePath(relative: string): string {
  return configFilePath(relative);
}

function configFilePath(relative: string): string {
  const configuredRoot = process.env.ASHLEY_MODEL_FABRIC_CONFIG_ROOT?.trim();
  if (configuredRoot) {
    const candidate = join(configuredRoot, relative);
    if (existsSync(candidate)) return candidate;
  }
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let index = 0; index < 8; index += 1) {
    const candidate = join(cursor, "config", "model-fabric", relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`model_fabric_catalog_file_missing:${relative}`);
}

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(configFilePath(relative), "utf-8")) as Record<string, unknown>;
}

export function loadFabricCatalog(): FabricCatalog {
  const independence = readJson("catalog/independence-groups.json");
  const seatData = readJson("catalog/seats.json");
  const coupling = readJson("catalog/coupling.json");
  if (
    independence.schema !== "ashley.model_fabric.independence_groups.v1" ||
    seatData.schema !== "ashley.model_fabric.seats.v1" ||
    coupling.schema !== "ashley.model_fabric.coupling.v1"
  ) {
    throw new Error("model_fabric_catalog_schema_invalid");
  }
  const groups: Record<string, readonly string[]> = {};
  for (const group of (independence.groups ?? []) as Array<Record<string, unknown>>) {
    if (typeof group.independenceGroupId !== "string" || !Array.isArray(group.includes)) {
      throw new Error("model_fabric_independence_group_invalid");
    }
    groups[group.independenceGroupId] = Object.freeze(
      group.includes.filter((value): value is string => typeof value === "string"),
    );
  }
  const seats = ((seatData.seats ?? []) as Array<Record<string, unknown>>).map((seat) => ({
    seat: String(seat.seat),
    userVisibleProductionRole: seat.userVisibleProductionRole === true,
    candidateOnly: seat.candidateOnly !== false,
    ...(seat.firstVertical === true ? { firstVertical: true } : {}),
    ...(seat.requiresIndependentDualReview === true
      ? { requiresIndependentDualReview: true }
      : {}),
    ...(typeof seat.ownedBy === "string" ? { ownedBy: seat.ownedBy } : {}),
    ...(typeof seat.targetOccupant === "string" ? { targetOccupant: seat.targetOccupant } : {}),
    ...(typeof seat.independenceConstraint === "string" || seat.independenceConstraint === null
      ? { independenceConstraint: seat.independenceConstraint }
      : {}),
  } satisfies FabricSeat));
  const couplings: Record<string, readonly string[]> = {};
  for (const item of (coupling.couplings ?? []) as Array<Record<string, unknown>>) {
    if (typeof item.id !== "string" || !Array.isArray(item.members)) {
      throw new Error("model_fabric_coupling_invalid");
    }
    couplings[item.id] = Object.freeze(
      item.members.filter((value): value is string => typeof value === "string"),
    );
  }
  return freezeDeep({
    independenceGroups: groups,
    seats,
    couplings,
  });
}

export function catalogEntryFromDiscovery(input: {
  occupantId: string;
  provider: string;
  configuredModelId: string;
  independenceGroup: string;
  discoveredBy: CatalogEntry["discoveredBy"];
}): CatalogEntry {
  return freezeDeep({
    ...input,
    lifecycle: "unqualified" as const,
    qualificationResultId: null,
    ownerApprovalRefId: null,
  });
}

export function transitionCatalogLifecycle(
  entry: CatalogEntry,
  lifecycle: CatalogLifecycle,
  input: { ownerApprovalRefId?: string | null } = {},
): CatalogEntry {
  if (lifecycle === "owner_approved" && !input.ownerApprovalRefId) {
    throw new Error("owner_approval_required");
  }
  if (!LIFECYCLE_TRANSITIONS[entry.lifecycle].includes(lifecycle)) {
    if (entry.lifecycle === "degraded" && lifecycle === "qualified") {
      throw new Error("recovery_does_not_requalify");
    }
    throw new Error("invalid_catalog_lifecycle_transition");
  }
  return freezeDeep({
    ...entry,
    lifecycle,
    ownerApprovalRefId:
      lifecycle === "owner_approved"
        ? input.ownerApprovalRefId!
        : entry.ownerApprovalRefId,
  });
}

function normalizeTargetRow(raw: Record<string, unknown>): ModelFabricPolicyRow {
  const occupants = Array.isArray(raw.occupants)
    ? raw.occupants.map((occupant) => occupant as ModelFabricOccupant)
    : [];
  if (typeof raw.policyRowId !== "string" || occupants.length === 0) {
    throw new Error("model_fabric_target_policy_row_invalid");
  }
  return {
    schema: "ashley.model_fabric.policy_row.v1",
    policyRowId: raw.policyRowId,
    portfolioRevisionId: String(raw.portfolioRevisionId),
    logicalRole: String(raw.logicalRole) as LogicalModelRole,
    occupancyKey: String(raw.occupancyKey),
    seat: (raw.seat as string | null | undefined) ?? null,
    purposes: (raw.purposes as ModelFabricPolicyRow["purposes"] | undefined) ?? [],
    ...(typeof raw.configuredRouteId === "string" ? { configuredRouteId: raw.configuredRouteId } : {}),
    ...(typeof raw.dispatchedRouteId === "string" ? { dispatchedRouteId: raw.dispatchedRouteId } : {}),
    latencyClass: (raw.latencyClass as ModelFabricPolicyRow["latencyClass"] | undefined) ?? "background",
    reliabilityClass: (raw.reliabilityClass as ModelFabricPolicyRow["reliabilityClass"] | undefined) ?? "single_attempt",
    privacyPolicyId: String(raw.privacyPolicyId ?? "utility_redacted"),
    contextPolicyId: String(raw.contextPolicyId ?? "utility_redacted"),
    quotaCouplingIds: (raw.quotaCouplingIds as readonly string[] | undefined) ?? [],
    reasoningPolicy: String(raw.reasoningPolicy ?? "standard") as ModelFabricPolicyRow["reasoningPolicy"],
    structuredOutput: (raw.structuredOutput as ModelFabricPolicyRow["structuredOutput"] | undefined) ?? "none",
    deadlineMs: typeof raw.deadlineMs === "number" ? raw.deadlineMs : null,
    maxOutputTokens: typeof raw.maxOutputTokens === "number" ? raw.maxOutputTokens : null,
    failoverRemainingMsFloor:
      typeof raw.failoverRemainingMsFloor === "number" ? raw.failoverRemainingMsFloor : null,
    failClosed: String(raw.failClosed ?? "role_existing"),
    unorderedCandidates: (raw.unorderedCandidates as readonly ModelFabricOccupant[] | undefined) ?? [],
    occupants,
    ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
  };
}

export function loadTargetPortfolio(): TargetPortfolio {
  const path = configFilePath("portfolios/target-12-9.v2.json");
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  if (
    raw.schema !== "ashley.model_fabric.portfolio_revision.v1" ||
    raw.kind !== "candidate_target" ||
    raw.status !== "declared"
  ) {
    throw new Error("model_fabric_target_portfolio_invalid");
  }
  if (raw.incompleteFixture === true) {
    throw new Error("model_fabric_target_portfolio_incomplete");
  }
  const rows = (raw.rows as Array<Record<string, unknown>> | undefined)?.map(normalizeTargetRow) ?? [];
  return freezeDeep({
    schema: "ashley.model_fabric.portfolio_revision.v1",
    portfolioRevisionId: String(raw.portfolioRevisionId),
    kind: "candidate_target",
    status: "declared",
    rows,
    sourcePath: path,
    ...(raw.incompleteFixture === true ? { incompleteFixture: true } : {}),
  });
}

export function createQualificationBinding(input: {
  qualificationResult: QualificationResultRecord;
  policyRow: Pick<ModelFabricPolicyRow, "policyRowId" | "logicalRole" | "seat" | "portfolioRevisionId">;
  occupant: ModelFabricOccupant;
  profile: ModelCapabilityProfile;
  materialInferenceFingerprint?: string;
  expectedCapability?: ThoughtCapabilityIdentity;
}): QualificationBinding {
  const result = input.qualificationResult;
  if (
    result.schema !== "ashley.evaluation.qualification_result.v1" &&
    result.schema !== THOUGHT_QUALIFICATION_RESULT_SCHEMA
  ) {
    throw new Error("qualification_result_schema_invalid");
  }
  if (input.occupant.admissionBasis?.kind === "existing_compatibility") {
    throw new Error("existing_compatibility_not_qualification");
  }
  if (result.status !== "PASS") throw new Error("qualification_result_not_pass");
  if (result.invalidated) throw new Error("qualification_result_invalidated");
  if (result.policyRowId !== input.policyRow.policyRowId) {
    throw new Error("qualification_policy_row_mismatch");
  }
  if (result.occupantId !== input.occupant.occupantId) {
    throw new Error("qualification_occupant_mismatch");
  }
  if (
    result.subject.logicalRole !== input.policyRow.logicalRole ||
    result.subject.seat !== input.policyRow.seat
  ) {
    throw new Error("qualification_subject_mismatch");
  }
  if (input.materialInferenceFingerprint &&
      result.subject.materialInferenceFingerprint !== input.materialInferenceFingerprint) {
    throw new Error("qualification_inference_fingerprint_mismatch");
  }
  if (input.expectedCapability) {
    if (!hasThoughtQualificationEvidence(result)) {
      throw new Error("qualification_capability_missing");
    }
    if (result.capability.fingerprint !== input.expectedCapability.fingerprint) {
      throw new Error("qualification_capability_mismatch");
    }
  }
  const binding = result.profileBinding;
  if (
    binding.profileId !== input.profile.profileId ||
    binding.profileVersion !== input.profile.profileVersion ||
    binding.profileFingerprint !== input.profile.profileFingerprint ||
    binding.provider !== input.profile.provider ||
    binding.configuredModelId !== input.profile.configuredModelId
  ) {
    throw new Error("qualification_profile_binding_mismatch");
  }
  return freezeDeep({
    qualificationResultId: result.qualificationResultId,
    policyRowId: result.policyRowId,
    occupantId: result.occupantId,
    profileId: binding.profileId,
    profileVersion: binding.profileVersion,
    profileFingerprint: binding.profileFingerprint,
    provider: binding.provider,
    configuredModelId: binding.configuredModelId,
    materialInferenceFingerprint: result.subject.materialInferenceFingerprint,
    identityContinuityEpoch: result.identityContinuityEpoch,
  });
}

export function qualificationResultUsable(input: {
  result: QualificationResultRecord;
  policyRowId: string;
  occupantId: string;
  materialInferenceFingerprint: string;
  identityContinuityEpoch?: string | number | null;
  expectedCapability?: ThoughtCapabilityIdentity;
}): boolean {
  const { result } = input;
  return (
    (result.schema === "ashley.evaluation.qualification_result.v1" ||
      result.schema === THOUGHT_QUALIFICATION_RESULT_SCHEMA) &&
    result.status === "PASS" &&
    result.invalidated === false &&
    result.policyRowId === input.policyRowId &&
    result.occupantId === input.occupantId &&
    result.subject.materialInferenceFingerprint === input.materialInferenceFingerprint &&
    (input.identityContinuityEpoch === undefined ||
      result.identityContinuityEpoch === input.identityContinuityEpoch) &&
    (!input.expectedCapability ||
      (hasThoughtQualificationEvidence(result) &&
        result.capability.fingerprint === input.expectedCapability.fingerprint))
  );
}

export function assertIndependentJudgeGroups(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return Boolean(left && right && left !== right);
}

export function currentRowIsCompatibility(row: ModelFabricPolicyRow): boolean {
  return row.occupants.every(
    (occupant) => occupant.admissionBasis?.kind === "existing_compatibility",
  ) && row.portfolioRevisionId === currentPortfolio().portfolioRevisionId;
}
