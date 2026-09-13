import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  loadFabricCatalog,
  loadTargetPortfolio,
  hasThoughtQualificationEvidence,
  type TargetPortfolio,
} from "./catalog.js";
import { assertThoughtCapabilityEvidence } from "./capability-identity.js";
import { capabilityProfileFor } from "./profiles.js";
import {
  currentPortfolio,
  defaultRouteForRow,
  occupancyKeyFor,
  resolveCurrentPolicy,
  type CurrentPolicyResolution,
  type CurrentPolicyResolutionInput,
  type ModelFabricOccupant,
  type ModelFabricPolicyRow,
} from "./portfolio.js";
import { freezeDeep, sha256Text, stableJson } from "./hash.js";
import type { QualificationResultRecord } from "./catalog.js";

export type ControlRootMode = "fixture" | "production";
export type ArtifactKind = "fixture" | "production";

type ArtifactMetadata = {
  artifactKind?: ArtifactKind;
  contentHash?: string;
};

export type OwnerApprovalRef = ArtifactMetadata & {
  schema: "ashley.model_fabric.owner_approval_ref.v1";
  ownerApprovalRefId: string;
  decision: "approve" | "revoke";
  qualificationResultId: string;
  logicalRole: string;
  seat: string | null;
  policyRowId: string;
  occupantId: string;
  portfolioRevisionId: string;
  consultationId: string;
  createdBy: "owner";
  createdAt: string;
  revokesOwnerApprovalRefId: string | null;
};

export type ActivationRef = ArtifactMetadata & {
  schema: "ashley.model_fabric.activation_ref.v1";
  activationRefId: string;
  kind: "activate" | "rollback";
  policyRowId: string;
  portfolioRevisionId: string;
  ownerApprovalRefIds: readonly string[];
  occupantsActivated: readonly string[];
  couplingPreflightId: string;
  rollbackOfActivationRefId: string | null;
  createdBy: "owner";
  createdAt: string;
  revokesActivationRefId: string | null;
};

export type StewardshipConsultationRecord = ArtifactMetadata & {
  schema: "ashley.stewardship.consultation.v1";
  consultationId: string;
  clause: "SC-CON-04";
  matterClass: "model_family_activation";
  subject: string;
  doesNotActivate: true;
  ashleyPositionStatus: "recorded";
  ashleyPosition: "affirm" | "decline" | "defer";
  ashleyRationale: string;
  ashleyDecidedAt: string;
  docDecision: string;
  docRationale: string;
  docDecidedAt: string;
};

export type CouplingOverlap = Readonly<{
  couplingId: string;
  activePolicyRowIds: readonly string[];
}>;

export type CouplingPreflightRecord = ArtifactMetadata & {
  schema: "ashley.model_fabric.coupling_preflight.v1";
  couplingPreflightId: string;
  policyRowId: string;
  bucketsTouched: readonly string[];
  overlaps: readonly CouplingOverlap[];
  ownerAcknowledged: boolean;
  passed: boolean;
};

export type ActivePointer = ArtifactMetadata & {
  schema: "ashley.model_fabric.active_pointer.v1";
  pointerGeneration: number;
  replacedPointerGeneration: number;
  rows: Readonly<Record<string, Readonly<Record<string, string>>>>;
};

export type ArtifactValue = Record<string, unknown> & ArtifactMetadata;

export type OwnerAuthorization = Readonly<{
  ownerAuthenticated: boolean;
  controlRootMode: ControlRootMode;
}>;

function defaultControlDir(): string {
  return (
    process.env.ASHLEY_MODEL_FABRIC_CONTROL_DIR?.trim() ||
    join(homedir(), ".composer-assistant", "control", "model-fabric")
  );
}

function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error("model_fabric_artifact_id_invalid");
  }
}

function withoutContentHash(value: ArtifactValue): Record<string, unknown> {
  const copy = { ...value };
  delete copy.contentHash;
  return copy;
}

export function artifactContentHash(value: ArtifactValue): string {
  return `sha256:${sha256Text(stableJson(withoutContentHash(value)))}`;
}

export function assertArtifactIntegrity(value: ArtifactValue): void {
  if (
    value.contentHash !== undefined &&
    value.contentHash !== artifactContentHash(value)
  ) {
    throw new Error("artifact_integrity_mismatch");
  }
}

function artifactWithHash<T extends ArtifactValue>(
  value: T,
  controlRootMode: ControlRootMode,
): T {
  if (value.artifactKind !== undefined && value.artifactKind !== controlRootMode) {
    throw new Error(
      value.artifactKind === "fixture"
        ? "fixture_artifact_in_production_control_dir"
        : "production_artifact_in_fixture_control_dir",
    );
  }
  const normalized = {
    ...value,
    artifactKind: value.artifactKind ?? controlRootMode,
  } as T;
  return {
    ...normalized,
    contentHash: artifactContentHash(normalized),
  } as T;
}

function assertReadableArtifactKind(
  value: ArtifactValue,
  controlRootMode: ControlRootMode,
): void {
  if (value.artifactKind === "fixture" && controlRootMode === "production") {
    throw new Error("fixture_artifact_in_production_control_dir");
  }
  if (value.artifactKind === "production" && controlRootMode === "fixture") {
    throw new Error("production_artifact_in_fixture_control_dir");
  }
  assertArtifactIntegrity(value);
}

function readJson(path: string): ArtifactValue {
  return JSON.parse(readFileSync(path, "utf8")) as ArtifactValue;
}

function writeJsonImmutable(
  path: string,
  value: ArtifactValue,
): void {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    writeFileSync(path, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Repeating the exact immutable publication is idempotent. A different
    // byte sequence under the same identity remains a hard immutability
    // violation.
    if (readFileSync(path, "utf8") === serialized) return;
    throw new Error("artifact_immutable");
  }
}

export function writeImmutableArtifact<T extends ArtifactValue>(input: {
  controlDir: string;
  directory: "qualifications" | "consultations" | "preflights" | "release-truth";
  id: string;
  artifact: T;
  controlRootMode: ControlRootMode;
}): string {
  assertSafeId(input.id);
  const value = artifactWithHash(input.artifact, input.controlRootMode);
  const directory = join(input.controlDir, input.directory);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${input.id}.json`);
  writeJsonImmutable(path, value);
  return path;
}

export function writeOwnerArtifact(input: {
  controlDir: string;
  artifact: OwnerApprovalRef | ActivationRef;
  authorization: OwnerAuthorization;
}): string {
  if (!input.authorization.ownerAuthenticated) {
    throw new Error("owner_authentication_required");
  }
  const isApproval =
    input.artifact.schema === "ashley.model_fabric.owner_approval_ref.v1";
  const id = isApproval
    ? (input.artifact as OwnerApprovalRef).ownerApprovalRefId
    : (input.artifact as ActivationRef).activationRefId;
  assertSafeId(id);
  const directory = isApproval ? "approvals" : "activations";
  const value = artifactWithHash(
    input.artifact as ArtifactValue,
    input.authorization.controlRootMode,
  );
  const targetDirectory = join(input.controlDir, directory);
  mkdirSync(targetDirectory, { recursive: true });
  const path = join(targetDirectory, `${id}.json`);
  writeJsonImmutable(path, value);
  return path;
}

function syncDirectory(directory: string): void {
  try {
    const fd = openSync(directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Windows directory handles may not support fsync. File fsync and the
    // same-directory rename still provide the supported local primitive.
  }
}

function writeAtomicJson(
  path: string,
  value: ArtifactValue,
): void {
  const temporary = `${path}.tmp`;
  const fd = openSync(temporary, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

function validatePointer(value: ArtifactValue): ActivePointer {
  const pointerGeneration = value.pointerGeneration;
  const replacedPointerGeneration = value.replacedPointerGeneration;
  if (
    value.schema !== "ashley.model_fabric.active_pointer.v1" ||
    typeof pointerGeneration !== "number" ||
    !Number.isInteger(pointerGeneration) ||
    pointerGeneration < 1 ||
    typeof replacedPointerGeneration !== "number" ||
    !Number.isInteger(replacedPointerGeneration) ||
    replacedPointerGeneration < 0 ||
    !value.rows ||
    typeof value.rows !== "object" ||
    Array.isArray(value.rows)
  ) {
    throw new Error("active_pointer_invalid");
  }
  for (const [logicalRole, byOccupancy] of Object.entries(value.rows)) {
    if (!logicalRole || !byOccupancy || typeof byOccupancy !== "object") {
      throw new Error("active_pointer_rows_invalid");
    }
    for (const [occupancyKey, activationRefId] of Object.entries(
      byOccupancy as Record<string, unknown>,
    )) {
      if (!occupancyKey || typeof activationRefId !== "string") {
        throw new Error("active_pointer_rows_invalid");
      }
      assertSafeId(activationRefId);
    }
  }
  return value as unknown as ActivePointer;
}

export function writeActivePointerAtomic(input: {
  controlDir: string;
  pointer: ActivePointer;
  authorization: OwnerAuthorization;
}): string {
  if (!input.authorization.ownerAuthenticated) {
    throw new Error("owner_authentication_required");
  }
  const value = artifactWithHash(
    input.pointer as ArtifactValue,
    input.authorization.controlRootMode,
  );
  const pointer = validatePointer(value);
  const directory = input.controlDir;
  mkdirSync(directory, { recursive: true });
  const activePath = join(directory, "active.json");
  if (existsSync(activePath)) {
    const existing = readJson(activePath);
    assertReadableArtifactKind(existing, input.authorization.controlRootMode);
    const existingPointer = validatePointer(existing);
    if (
      pointer.replacedPointerGeneration !== existingPointer.pointerGeneration
    ) {
      throw new Error("active_pointer_generation_mismatch");
    }
  } else if (pointer.replacedPointerGeneration !== 0) {
    throw new Error("active_pointer_generation_mismatch");
  }
  writeAtomicJson(activePath, pointer as unknown as ArtifactValue);
  return activePath;
}

export type ActivePointerRead = Readonly<{
  source: "active_pointer" | "current_compatibility";
  pointer: ActivePointer | null;
  reason: string | null;
}>;

export function readActivePointer(input: {
  controlDir?: string;
  controlRootMode?: ControlRootMode;
} = {}): ActivePointerRead {
  const controlDir = input.controlDir ?? defaultControlDir();
  const controlRootMode = input.controlRootMode ?? "production";
  const path = join(controlDir, "active.json");
  if (!existsSync(path)) {
    return { source: "current_compatibility", pointer: null, reason: "missing" };
  }
  try {
    const raw = readJson(path);
    assertReadableArtifactKind(raw, controlRootMode);
    return {
      source: "active_pointer",
      pointer: validatePointer(raw),
      reason: null,
    };
  } catch (error) {
    return {
      source: "current_compatibility",
      pointer: null,
      reason: error instanceof Error ? error.message : "unreadable",
    };
  }
}

export function createCouplingPreflight(input: {
  couplingPreflightId: string;
  policyRow: ModelFabricPolicyRow;
  activeRows: readonly ModelFabricPolicyRow[];
  ownerAcknowledged: boolean;
}): CouplingPreflightRecord {
  assertSafeId(input.couplingPreflightId);
  const catalog = loadFabricCatalog();
  const bucketsTouched = input.policyRow.quotaCouplingIds.filter(
    (couplingId) => catalog.couplings[couplingId] !== undefined,
  );
  const overlaps: CouplingOverlap[] = [];
  for (const couplingId of bucketsTouched) {
    const activePolicyRowIds = input.activeRows
      .filter(
        (row) =>
          row.policyRowId !== input.policyRow.policyRowId &&
          row.quotaCouplingIds.includes(couplingId),
      )
      .map((row) => row.policyRowId);
    if (activePolicyRowIds.length > 0) {
      overlaps.push({ couplingId, activePolicyRowIds });
    }
  }
  return Object.freeze({
    schema: "ashley.model_fabric.coupling_preflight.v1",
    couplingPreflightId: input.couplingPreflightId,
    policyRowId: input.policyRow.policyRowId,
    bucketsTouched,
    overlaps,
    ownerAcknowledged: input.ownerAcknowledged,
    passed: overlaps.length === 0 || input.ownerAcknowledged,
  });
}

function isNewFamily(occupant: ModelFabricOccupant): boolean {
  return !currentPortfolio().rows.some((row) =>
    row.occupants.some(
      (current) =>
        current.provider === occupant.provider &&
        current.configuredModelId === occupant.configuredModelId,
    ),
  );
}

function validateConsultation(
  consultation: StewardshipConsultationRecord | undefined,
): void {
  if (
    !consultation ||
    consultation.schema !== "ashley.stewardship.consultation.v1" ||
    consultation.clause !== "SC-CON-04" ||
    consultation.matterClass !== "model_family_activation" ||
    consultation.doesNotActivate !== true ||
    consultation.ashleyPositionStatus !== "recorded" ||
    consultation.ashleyPosition !== "affirm"
  ) {
    throw new Error("activation_consultation_invalid");
  }
}

export type ValidatedActivation = Readonly<{
  activation: ActivationRef;
  policyRow: ModelFabricPolicyRow;
  qualifications: readonly QualificationResultRecord[];
  approvals: readonly OwnerApprovalRef[];
  preflight: CouplingPreflightRecord;
}>;

export function validateRollbackProvenance(input: {
  rollback: ActivationRef;
  previous: ActivationRef;
}): void {
  if (
    input.rollback.kind !== "rollback" ||
    input.rollback.rollbackOfActivationRefId !== input.previous.activationRefId ||
    input.previous.kind !== "activate" ||
    input.rollback.policyRowId !== input.previous.policyRowId ||
    input.rollback.portfolioRevisionId !== input.previous.portfolioRevisionId
  ) {
    throw new Error("rollback_provenance_mismatch");
  }
  for (const approvalId of input.rollback.ownerApprovalRefIds) {
    if (!input.previous.ownerApprovalRefIds.includes(approvalId)) {
      throw new Error("rollback_approval_provenance_mismatch");
    }
  }
}

export function validateActivation(input: {
  activation: ActivationRef;
  targetPortfolio?: TargetPortfolio;
  qualifications: readonly QualificationResultRecord[];
  approvals: readonly OwnerApprovalRef[];
  consultations: readonly StewardshipConsultationRecord[];
  preflights: readonly CouplingPreflightRecord[];
  previousActivation?: ActivationRef;
}): ValidatedActivation {
  const activation = input.activation;
  assertArtifactIntegrity(activation as ArtifactValue);
  if (
    activation.schema !== "ashley.model_fabric.activation_ref.v1" ||
    (activation.kind !== "activate" && activation.kind !== "rollback") ||
    activation.createdBy !== "owner" ||
    !activation.activationRefId ||
    !activation.policyRowId ||
    activation.ownerApprovalRefIds.length === 0 ||
    activation.occupantsActivated.length === 0
  ) {
    throw new Error("activation_schema_invalid");
  }
  const targetPortfolio = input.targetPortfolio ?? loadTargetPortfolio();
  const row = targetPortfolio.rows.find(
    (candidate) => candidate.policyRowId === activation.policyRowId,
  );
  if (!row) throw new Error("activation_policy_row_missing");
  if (activation.portfolioRevisionId !== targetPortfolio.portfolioRevisionId) {
    throw new Error("activation_portfolio_revision_mismatch");
  }
  if (row.portfolioRevisionId !== activation.portfolioRevisionId) {
    throw new Error("activation_policy_provenance_mismatch");
  }
  const preflight = input.preflights.find(
    (candidate) =>
      candidate.couplingPreflightId === activation.couplingPreflightId,
  );
  if (!preflight) throw new Error("coupling_preflight_missing");
  if (preflight.policyRowId !== row.policyRowId) {
    throw new Error("coupling_preflight_policy_mismatch");
  }
  if (!preflight.passed) {
    if (preflight.overlaps.length > 0 && !preflight.ownerAcknowledged) {
      throw new Error("coupling_ack_required");
    }
    throw new Error("coupling_preflight_failed");
  }
  if (activation.kind === "rollback") {
    if (!input.previousActivation) {
      throw new Error("rollback_previous_activation_missing");
    }
    validateRollbackProvenance({
      rollback: activation,
      previous: input.previousActivation,
    });
  }
  const qualifications: QualificationResultRecord[] = [];
  const approvals: OwnerApprovalRef[] = [];
  const approvalIds = new Set<string>();
  const occupantIds = new Set<string>();
  for (const approvalRef of input.approvals) {
    assertArtifactIntegrity(approvalRef as ArtifactValue);
  }
  for (const result of input.qualifications) {
    assertArtifactIntegrity(result as ArtifactValue);
  }
  for (const consultation of input.consultations) {
    assertArtifactIntegrity(consultation as ArtifactValue);
  }
  for (const candidate of input.preflights) {
    assertArtifactIntegrity(candidate as ArtifactValue);
  }
  for (const occupantId of activation.occupantsActivated) {
    if (occupantIds.has(occupantId)) {
      throw new Error("activation_occupants_duplicate");
    }
    occupantIds.add(occupantId);
    const occupant = row.occupants.find(
      (candidate) => candidate.occupantId === occupantId,
    );
    if (!occupant) throw new Error("activation_occupant_not_on_policy_row");
    if (!occupant.privacyEligibility?.includes(row.privacyPolicyId)) {
      throw new Error("activation_privacy_mismatch");
    }
    const approvalId = activation.ownerApprovalRefIds.find((candidateId) => {
      const candidate = input.approvals.find(
        (approvalRef) => approvalRef.ownerApprovalRefId === candidateId,
      );
      return candidate?.occupantId === occupantId;
    });
    if (!approvalId || approvalIds.has(approvalId)) {
      throw new Error("activation_owner_approval_missing");
    }
    approvalIds.add(approvalId);
    const approvalRef = input.approvals.find(
      (candidate) => candidate.ownerApprovalRefId === approvalId,
    );
    if (
      !approvalRef ||
      approvalRef.schema !== "ashley.model_fabric.owner_approval_ref.v1" ||
      approvalRef.decision !== "approve" ||
      approvalRef.createdBy !== "owner" ||
      approvalRef.logicalRole !== row.logicalRole ||
      approvalRef.seat !== row.seat ||
      approvalRef.policyRowId !== row.policyRowId ||
      approvalRef.occupantId !== occupant.occupantId ||
      approvalRef.portfolioRevisionId !== row.portfolioRevisionId
    ) {
      throw new Error("activation_owner_approval_invalid");
    }
    const result = input.qualifications.find(
      (candidate) =>
        candidate.qualificationResultId === approvalRef.qualificationResultId,
    );
    if (!result) throw new Error("activation_qualification_missing");
    if (
      (result.schema !== "ashley.evaluation.qualification_result.v1" &&
        result.schema !== "ashley.evaluation.qualification_result.v2") ||
      result.status !== "PASS" ||
      result.invalidated
    ) {
      throw new Error("activation_qualification_invalid");
    }
    if (
      result.policyRowId !== row.policyRowId ||
      result.occupantId !== occupant.occupantId ||
      result.subject.logicalRole !== row.logicalRole ||
      result.subject.seat !== row.seat
    ) {
      throw new Error("activation_qualification_provenance_mismatch");
    }
    const expectedProfile = capabilityProfileFor(
      occupant.provider,
      occupant.configuredModelId,
    );
    if (
      result.profileBinding.profileId !== expectedProfile.profileId ||
      result.profileBinding.profileVersion !== expectedProfile.profileVersion ||
      result.profileBinding.profileFingerprint !== expectedProfile.profileFingerprint ||
      result.profileBinding.provider !== expectedProfile.provider ||
      result.profileBinding.configuredModelId !== expectedProfile.configuredModelId
    ) {
      throw new Error("activation_profile_binding_mismatch");
    }
    if (row.logicalRole === "thought") {
      if (!hasThoughtQualificationEvidence(result)) {
        throw new Error("activation_qualification_capability_missing");
      }
      assertThoughtCapabilityEvidence(result);
    }
    if (isNewFamily(occupant)) {
      const consultation = input.consultations.find(
        (candidate) => candidate.consultationId === approvalRef.consultationId,
      );
      validateConsultation(consultation);
    }
    qualifications.push(result);
    approvals.push(approvalRef);
  }
  if (approvalIds.size !== activation.ownerApprovalRefIds.length) {
    throw new Error("activation_owner_approval_extra");
  }
  return Object.freeze({
    activation,
    policyRow: row,
    qualifications,
    approvals,
    preflight,
  });
}

function readArtifactIfPresent<T extends ArtifactValue>(
  path: string,
  controlRootMode: ControlRootMode,
): T | null {
  if (!existsSync(path)) return null;
  const raw = readJson(path);
  assertReadableArtifactKind(raw, controlRootMode);
  return raw as T;
}

export function loadActivationRef(
  controlDir: string,
  activationRefId: string,
  controlRootMode: ControlRootMode = "production",
): ActivationRef | null {
  assertSafeId(activationRefId);
  const path = join(controlDir, "activations", `${activationRefId}.json`);
  const raw = readArtifactIfPresent<ActivationRef & ArtifactValue>(
    path,
    controlRootMode,
  );
  if (!raw) return null;
  if (
    raw.schema !== "ashley.model_fabric.activation_ref.v1" ||
    raw.activationRefId !== activationRefId
  ) {
    throw new Error("activation_artifact_invalid");
  }
  return raw;
}

function loadOwnerApproval(
  controlDir: string,
  ownerApprovalRefId: string,
  controlRootMode: ControlRootMode,
): OwnerApprovalRef | null {
  assertSafeId(ownerApprovalRefId);
  const raw = readArtifactIfPresent<OwnerApprovalRef & ArtifactValue>(
    join(controlDir, "approvals", `${ownerApprovalRefId}.json`),
    controlRootMode,
  );
  if (!raw) return null;
  if (
    raw.schema !== "ashley.model_fabric.owner_approval_ref.v1" ||
    raw.ownerApprovalRefId !== ownerApprovalRefId
  ) {
    throw new Error("owner_approval_artifact_invalid");
  }
  return raw;
}

function loadQualification(
  controlDir: string,
  qualificationResultId: string,
  controlRootMode: ControlRootMode,
): QualificationResultRecord | null {
  assertSafeId(qualificationResultId);
  const raw = readArtifactIfPresent<QualificationResultRecord & ArtifactValue>(
    join(controlDir, "qualifications", `${qualificationResultId}.json`),
    controlRootMode,
  );
  if (!raw) return null;
  if (
    (raw.schema !== "ashley.evaluation.qualification_result.v1" &&
      raw.schema !== "ashley.evaluation.qualification_result.v2") ||
    raw.qualificationResultId !== qualificationResultId
  ) {
    throw new Error("qualification_artifact_invalid");
  }
  return raw;
}

function loadConsultation(
  controlDir: string,
  consultationId: string,
  controlRootMode: ControlRootMode,
): StewardshipConsultationRecord | null {
  assertSafeId(consultationId);
  return readArtifactIfPresent<StewardshipConsultationRecord & ArtifactValue>(
    join(controlDir, "consultations", `${consultationId}.json`),
    controlRootMode,
  );
}

function loadPreflight(
  controlDir: string,
  couplingPreflightId: string,
  controlRootMode: ControlRootMode,
): CouplingPreflightRecord | null {
  assertSafeId(couplingPreflightId);
  return readArtifactIfPresent<CouplingPreflightRecord & ArtifactValue>(
    join(controlDir, "preflights", `${couplingPreflightId}.json`),
    controlRootMode,
  );
}

export type ActivePolicyResolution = Readonly<{
  source: "activated" | "current_compatibility" | "fail_closed";
  row: ModelFabricPolicyRow | null;
  activationRefId: string | null;
  reason: string | null;
}>;

export type DispatchPolicyResolution = CurrentPolicyResolution &
  Readonly<{
    source: ActivePolicyResolution["source"];
    activationRefId: string | null;
    activationReason: string | null;
  }>;

function resolveActivatedDispatch(
  row: ModelFabricPolicyRow,
): CurrentPolicyResolution {
  const occupant = row.occupants[0];
  if (!occupant) {
    throw new Error(`model_fabric_activated_occupants_missing:${row.policyRowId}`);
  }
  const configuredRouteId = row.configuredRouteId ?? defaultRouteForRow(row);
  const dispatchedRouteId = row.dispatchedRouteId ?? configuredRouteId;
  return freezeDeep({
    registryVersion: currentPortfolio().registryVersion,
    portfolioRevisionId: row.portfolioRevisionId,
    policyRow: row,
    occupant,
    specialistRequirement: null,
    configuredRouteId,
    dispatchedRouteId,
    configuredModelId: occupant.configuredModelId,
    routeOverride: null,
    modelOverride: null,
  });
}

/**
 * Canonical production dispatch resolver. Activation authority is
 * `resolveActivePolicy`; this maps that result onto the CURRENT dispatch
 * shape. Caller route/model overrides apply only on the compatibility path.
 */
export function resolveDispatchPolicy(
  input: CurrentPolicyResolutionInput & {
    controlDir?: string;
    controlRootMode?: ControlRootMode;
  },
): DispatchPolicyResolution {
  const occupancyKey = occupancyKeyFor(input);
  const active = resolveActivePolicy({
    logicalRole: input.logicalRole,
    occupancyKey,
    controlDir: input.controlDir,
    controlRootMode: input.controlRootMode,
  });
  if (active.source === "activated" && active.row) {
    return freezeDeep({
      ...resolveActivatedDispatch(active.row),
      specialistRequirement: input.specialistRequirement ?? null,
      source: "activated" as const,
      activationRefId: active.activationRefId,
      activationReason: null,
    });
  }
  const current = resolveCurrentPolicy(input);
  return freezeDeep({
    ...current,
    source: active.source,
    activationRefId: null,
    activationReason: active.reason,
  });
}

function currentRowFor(
  logicalRole: string,
  occupancyKey: string,
): ModelFabricPolicyRow | null {
  return (
    currentPortfolio().rows.find(
      (row) =>
        row.logicalRole === logicalRole && row.occupancyKey === occupancyKey,
    ) ?? null
  );
}

export function resolveActivePolicy(input: {
  logicalRole: string;
  occupancyKey: string;
  controlDir?: string;
  controlRootMode?: ControlRootMode;
}): ActivePolicyResolution {
  const currentRow = currentRowFor(input.logicalRole, input.occupancyKey);
  const controlDir = input.controlDir ?? defaultControlDir();
  const controlRootMode = input.controlRootMode ?? "production";
  const pointer = readActivePointer({ controlDir, controlRootMode });
  if (!pointer.pointer) {
    return {
      source: currentRow ? "current_compatibility" : "fail_closed",
      row: currentRow,
      activationRefId: null,
      reason: pointer.reason,
    };
  }
  const activationRefId =
    pointer.pointer.rows[input.logicalRole]?.[input.occupancyKey];
  if (!activationRefId) {
    return {
      source: currentRow ? "current_compatibility" : "fail_closed",
      row: currentRow,
      activationRefId: null,
      reason: "compatibility_key_absent",
    };
  }
  try {
    const activation = loadActivationRef(
      controlDir,
      activationRefId,
      controlRootMode,
    );
    if (!activation) throw new Error("activation_ref_missing");
    const target = loadTargetPortfolio();
    const approvals = activation.ownerApprovalRefIds
      .map((id) => loadOwnerApproval(controlDir, id, controlRootMode))
      .filter((value): value is OwnerApprovalRef => value !== null);
    const qualifications = approvals
      .map((approval) =>
        loadQualification(
          controlDir,
          approval.qualificationResultId,
          controlRootMode,
        ),
      )
      .filter((value): value is QualificationResultRecord => value !== null);
    const consultations = approvals
      .map((approval) =>
        loadConsultation(controlDir, approval.consultationId, controlRootMode),
      )
      .filter(
        (value): value is StewardshipConsultationRecord => value !== null,
      );
    const preflight = loadPreflight(
      controlDir,
      activation.couplingPreflightId,
      controlRootMode,
    );
    const validated = validateActivation({
      activation,
      targetPortfolio: target,
      qualifications,
      approvals,
      consultations,
      preflights: preflight ? [preflight] : [],
    });
    if (
      validated.policyRow.logicalRole !== input.logicalRole ||
      validated.policyRow.occupancyKey !== input.occupancyKey
    ) {
      throw new Error("activation_pointer_key_mismatch");
    }
    return {
      source: "activated",
      row: validated.policyRow,
      activationRefId,
      reason: null,
    };
  } catch (error) {
    return {
      source: currentRow ? "current_compatibility" : "fail_closed",
      row: currentRow,
      activationRefId: null,
      reason: error instanceof Error ? error.message : "activation_invalid",
    };
  }
}

export function writeOwnerActivation(input: {
  controlDir: string;
  activation: ActivationRef;
  pointer: ActivePointer;
  targetPortfolio?: TargetPortfolio;
  qualifications: readonly QualificationResultRecord[];
  approvals: readonly OwnerApprovalRef[];
  consultations: readonly StewardshipConsultationRecord[];
  preflights: readonly CouplingPreflightRecord[];
  previousActivation?: ActivationRef;
  authorization: OwnerAuthorization;
}): void {
  if (!input.authorization.ownerAuthenticated) {
    throw new Error("owner_authentication_required");
  }
  const validated = validateActivation(input);
  const pointerActivationRefId =
    input.pointer.rows[validated.policyRow.logicalRole]?.[
      validated.policyRow.occupancyKey
    ];
  if (pointerActivationRefId !== input.activation.activationRefId) {
    throw new Error("activation_pointer_reference_mismatch");
  }
  writeOwnerArtifact({
    controlDir: input.controlDir,
    artifact: input.activation,
    authorization: input.authorization,
  });
  writeActivePointerAtomic({
    controlDir: input.controlDir,
    pointer: input.pointer,
    authorization: input.authorization,
  });
}
