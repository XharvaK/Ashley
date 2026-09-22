import type { DatabaseSync } from "node:sqlite";
import { v2CapabilitySpec } from "@composer-assistant/sandbox-v2";
import { env } from "../../../env.js";
import { perceptionCapabilityCanInfluence } from "../../perception/capability-self-model.js";
import {
  canOfferBoundedOperation,
  canOfferCandidateAuthorship,
  canOfferCandidateVerification,
  canOfferCandidateWorkspace,
  canOfferPatchExport,
  canOfferProjectInspection,
  canOfferWorkerBackedProjectInspection,
  listApprovedReadProjectIds,
  loadOperatorProjectReadRegistry,
  type V2ProjectReadRegistry,
} from "../../sandbox/project-registry.js";
import type { CapabilityName } from "../../rollout/capabilities.js";
import type {
  CapabilityReality,
  CapabilityRealityReasonCode,
  ThoughtOperationCapability,
  ThoughtSemanticObservation,
} from "../types.js";
import type { SocialAudience } from "../social/types.js";
import {
  C1_OPENCODE_FREE_CATALOG,
  createQuotaRouter,
  loadQuotaState,
  offerWorkerTask,
  resolveOpenCodeBinary,
  type WorkerOfferReason,
} from "../../sandbox/opencode/index.js";

/** Capabilities with an actual v0.2.1 production adapter in this candidate. */
const V021_LIVE_OPERATION_CAPABILITIES: ReadonlySet<CapabilityName> = new Set([
  "project_inspection",
  "project_experimentation",
  "candidate_verification",
  "candidate_authorship",
  "patch_export",
]);

/** The production v0.2.1 perception provider is not bound in this candidate. */
const V021_LIVE_PERCEPTION_CAPABILITIES: ReadonlySet<CapabilityName> = new Set();

export type CapabilityRealityOptions = {
  registry?: V2ProjectReadRegistry;
  masterMode?: "observe" | "apply";
  lifecycleEnabled?: boolean;
  substrateAvailable?: boolean;
  audience?: SocialAudience;
  licenses?: readonly string[];
  opencodeWorkerEnabled?: boolean;
  opencodeQuotaStatePath?: string;
  opencodeBinaryPath?: string;
  opencodeCandidateDevelopAllowsNvidia?: boolean;
  nowMs?: number;
};

function reasonForCapability(input: {
  value: boolean;
  rawValue: boolean;
  name: string;
  externalAudience: boolean;
  ownerOnly?: boolean;
  perception?: boolean;
  substrateWithoutAuthority: boolean;
  audienceAllowed: (name: string) => boolean;
}): CapabilityRealityReasonCode {
  if (input.value) return "capability_exists";
  if (input.externalAudience && input.ownerOnly && input.rawValue) return "another_audience_only";
  if (input.externalAudience && input.rawValue && !input.audienceAllowed(input.name)) {
    return "needs_owner_approval";
  }
  if (input.perception && !input.rawValue) return "evidence_not_acquired";
  if (!input.rawValue && input.substrateWithoutAuthority) return "substrate_without_authority";
  return "unavailable";
}

function authorizedProjectIds(
  registry: V2ProjectReadRegistry,
  predicate: (entry: ReturnType<V2ProjectReadRegistry["list"]>[number]) => boolean,
): string[] {
  return registry.list()
    .filter((entry) => entry.enabled && entry.readAllowed && predicate(entry))
    .map((entry) => entry.projectId)
    .sort();
}

function workerReason(reason: WorkerOfferReason): CapabilityRealityReasonCode {
  if (reason === "capability_exists" || reason === "capacity_unproven" || reason === "worker_capacity_exhausted" || reason === "unavailable") {
    return reason;
  }
  return "unavailable";
}

type OperationAffordance = Pick<
  ThoughtOperationCapability,
  | "label"
  | "description"
  | "inputContract"
  | "outputContract"
  | "evidenceContract"
  | "authorityConditions"
  | "hardLimits"
  | "uncertainty"
>;

function freezeOperationAffordance(value: OperationAffordance): Readonly<OperationAffordance> {
  return Object.freeze({
    ...value,
    authorityConditions: Object.freeze([...value.authorityConditions]),
    hardLimits: Object.freeze([...value.hardLimits]),
    uncertainty: Object.freeze([...value.uncertainty]),
  });
}

const OPERATION_AFFORDANCES = Object.freeze({
  "project.inspect": freezeOperationAffordance({
    label: "Project inspection",
    description: "Read bounded evidence from an operator-approved project through the route-neutral project inspection operation.",
    inputContract: "Requires projectId and may include a bounded locator, question, focus, and maxSteps. The request names no direct or worker substrate.",
    outputContract: "Returns a read-only observation containing bounded project evidence, provenance, and execution status.",
    evidenceContract: "Only a succeeded observation with matching operation and project identity is usable evidence; failure or outcome_unknown is not a successful result.",
    authorityConditions: [
      "An active project-inspection capability gate must be true.",
      "The project must be enabled, read-allowed, and present in authorizedProjectIds.",
    ],
    hardLimits: [
      "Read-only; it cannot mutate files, run commands, or apply a patch.",
      "Host routing may use a direct adapter or bounded worker after Thought selects project.inspect.",
      "Provider, model, quota, and fallback fields are outside this request.",
    ],
    uncertainty: [
      "A missing or failed observation leaves the semantic question unresolved.",
      "A worker outcome_unknown records that the result is unsettled; it cannot be reported as success.",
    ],
  }),
  "workspace.verify": freezeOperationAffordance({
    label: "Workspace verification",
    description: "Run an allowlisted read-only verification recipe against an authorized candidate workspace.",
    inputContract: "Requires projectId and may include operator-bound workspaceId and recipeId values.",
    outputContract: "Returns an effect receipt containing verification status and mechanical evidence.",
    evidenceContract: "Only a succeeded receipt with matching operation, project, and workspace identity may support a verification claim; failure or outcome_unknown is not success.",
    authorityConditions: [
      "An active candidate-verification capability gate must be true.",
      "The project, workspace, and recipe must satisfy their operator-bound allowlists.",
    ],
    hardLimits: [
      "The recipe is read-only; it cannot mutate files, apply changes, commit, push, deploy, or notify.",
      "The request cannot select a provider, model, quota, or fallback path.",
    ],
    uncertainty: [
      "A failed verification is evidence of failure, not evidence of success.",
      "An outcome_unknown receipt leaves the verification claim unsettled.",
    ],
  }),
  patch_export: freezeOperationAffordance({
    label: "Patch export",
    description: "Copy a sealed, accepted patch artifact to an operator-bound review destination.",
    inputContract: "Requires projectId, changesetId, and adjudication; changesetId is operator-bound.",
    outputContract: "Returns an effect receipt with source identity, destination identity, and read-back status.",
    evidenceContract: "Only a succeeded receipt with matching source and destination read-back supports an export claim; a write without read-back is not settled evidence.",
    authorityConditions: [
      "An active patch-export capability gate must be true.",
      "The changeset and destination must satisfy the operator-bound export registry.",
    ],
    hardLimits: [
      "This operation copies an accepted artifact only; it cannot apply, commit, push, deploy, or activate it.",
      "The request cannot select a provider, model, quota, or destination outside the operator-bound registry.",
    ],
    uncertainty: [
      "A source/read-back mismatch leaves export state unresolved.",
      "A failed or outcome_unknown receipt cannot be represented as an applied or live effect.",
    ],
  }),
  "candidate.develop": freezeOperationAffordance({
    label: "Candidate development",
    description: "Run bounded candidate development in an authorized workspace and return worker evidence.",
    inputContract: "Requires projectId and may include focus, maxSteps, and an operator-bound workspaceId.",
    outputContract: "Returns an effect receipt describing bounded worker steps and the resulting candidate artifact state.",
    evidenceContract: "The receipt describes worker activity only; candidate artifact claims require the separate verification operation.",
    authorityConditions: [
      "An active candidate-authorship capability gate must be true.",
      "The project and workspace must satisfy candidateWorkspaceAllowed and operator-bound checks.",
    ],
    hardLimits: [
      "Work is bounded to the authorized candidate workspace; it cannot deploy or alter production.",
      "Host-owned worker execution details cannot be selected through this semantic request.",
    ],
    uncertainty: [
      "Worker failure or outcome_unknown leaves candidate state unresolved.",
      "Worker evidence does not establish that a candidate is verified, accepted, or live.",
    ],
  }),
} as const);

function thoughtOperationCapabilities(input: {
  registry: V2ProjectReadRegistry;
  projectInspectionAvailable: boolean;
  verificationAvailable: boolean;
  patchExportAvailable: boolean;
  iterativeEngineeringAvailable: boolean;
}): readonly ThoughtOperationCapability[] {
  const projectReadFileSpec = v2CapabilitySpec("project.read_file");
  const workspaceVerifySpec = v2CapabilitySpec("workspace.verify");
  const patchExportSpec = v2CapabilitySpec("patch_export");
  const workspaceWriteSpec = v2CapabilitySpec("workspace.write_file");
  if (!projectReadFileSpec || !workspaceVerifySpec || !patchExportSpec || !workspaceWriteSpec) {
    throw new Error("sandbox_v2_operation_capability_spec_missing");
  }
  const approvedProjectIds = authorizedProjectIds(input.registry, () => true);
  const verificationProjectIds = authorizedProjectIds(
    input.registry,
    (entry) => entry.verificationAllowed === true && (entry.allowedRecipeIds?.length ?? 0) > 0,
  );
  const patchExportProjectIds = authorizedProjectIds(
    input.registry,
    (entry) => entry.patchExportAllowed === true &&
      typeof entry.exportDestinationCanonicalRoot === "string" &&
      entry.exportDestinationCanonicalRoot.length > 0,
  );
  return Object.freeze([
    Object.freeze({
      operationKind: "project.inspect",
      semanticClass: "observation" as const,
      ...OPERATION_AFFORDANCES["project.inspect"],
      family: projectReadFileSpec.family,
      readOnly: projectReadFileSpec.readOnly,
      requiresProject: projectReadFileSpec.requiresProject,
      available: input.projectInspectionAvailable,
      requiredRequestFields: Object.freeze(["projectId"]),
      optionalRequestFields: Object.freeze(["locator", "question", "focus", "maxSteps"]),
      operatorBoundRequestFields: Object.freeze([]),
      authorizedProjectIds: Object.freeze(approvedProjectIds),
    }),
    Object.freeze({
      operationKind: "workspace.verify",
      semanticClass: "effect" as const,
      ...OPERATION_AFFORDANCES["workspace.verify"],
      family: workspaceVerifySpec.family,
      readOnly: workspaceVerifySpec.readOnly,
      requiresProject: workspaceVerifySpec.requiresProject,
      available: input.verificationAvailable,
      requiredRequestFields: Object.freeze(["projectId"]),
      optionalRequestFields: Object.freeze(["workspaceId", "recipeId"]),
      operatorBoundRequestFields: Object.freeze(["workspaceId", "recipeId"]),
      authorizedProjectIds: Object.freeze(verificationProjectIds),
    }),
    Object.freeze({
      operationKind: "patch_export",
      semanticClass: "effect" as const,
      ...OPERATION_AFFORDANCES.patch_export,
      family: patchExportSpec.family,
      readOnly: patchExportSpec.readOnly,
      requiresProject: patchExportSpec.requiresProject,
      available: input.patchExportAvailable,
      requiredRequestFields: Object.freeze(["projectId", "changesetId", "adjudication"]),
      optionalRequestFields: Object.freeze([]),
      operatorBoundRequestFields: Object.freeze(["changesetId"]),
      authorizedProjectIds: Object.freeze(patchExportProjectIds),
    }),
    ...(input.iterativeEngineeringAvailable
      ? [Object.freeze({
        operationKind: "candidate.develop",
        semanticClass: "effect" as const,
        ...OPERATION_AFFORDANCES["candidate.develop"],
        family: workspaceWriteSpec.family,
        readOnly: false,
        requiresProject: true,
        available: true,
        requiredRequestFields: Object.freeze(["projectId"]),
        optionalRequestFields: Object.freeze(["focus", "maxSteps", "workspaceId"]),
        operatorBoundRequestFields: Object.freeze(["workspaceId"]),
        authorizedProjectIds: Object.freeze(authorizedProjectIds(
          input.registry,
          (entry) => entry.candidateWorkspaceAllowed === true,
        )),
      })]
      : []),
  ]);
}

/** Read capability facts for Thought. This deliberately bypasses Expression text composition. */
export function getCapabilityReality(
  db: DatabaseSync,
  options: CapabilityRealityOptions = {},
): CapabilityReality {
  const registry = options.registry ?? loadOperatorProjectReadRegistry();
  const masterMode = options.masterMode ?? env.cognitionMode;
  const sandboxOptions = {
    registry,
    masterMode,
    lifecycleEnabled: options.lifecycleEnabled,
    substrateAvailable: options.substrateAvailable,
  };
  const directProjectInspectionAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("project_inspection") &&
    canOfferProjectInspection(db, sandboxOptions);
  const verificationAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("candidate_verification") &&
    canOfferCandidateVerification(db, sandboxOptions);
  const audience = options.audience ?? { kind: "owner_private" };
  const externalAudience = audience.kind !== "owner_private";
  const licenses = options.licenses ?? [];
  const audienceCapabilityAllowed = (name: string): boolean =>
    !externalAudience || licenses.includes(name) || licenses.includes(`capability:${name}`);
  const substrateWithoutAuthority = masterMode !== "apply"
    || options.lifecycleEnabled === false
    || options.substrateAvailable === false;
  const perceptionFacts = {
    vision: V021_LIVE_PERCEPTION_CAPABILITIES.has("vision") && perceptionCapabilityCanInfluence(db, "vision", masterMode),
    attachmentText: V021_LIVE_PERCEPTION_CAPABILITIES.has("attachment_text") &&
      perceptionCapabilityCanInfluence(db, "attachment_text", masterMode),
    conversationalRead: V021_LIVE_PERCEPTION_CAPABILITIES.has("conversational_read") &&
      perceptionCapabilityCanInfluence(db, "conversational_read", masterMode),
    webSearch: V021_LIVE_PERCEPTION_CAPABILITIES.has("web_search") &&
      perceptionCapabilityCanInfluence(db, "web_search", masterMode),
  };
  const workspaceAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("project_experimentation") &&
    canOfferCandidateWorkspace(db, sandboxOptions);
  const authorshipAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("candidate_authorship") &&
    canOfferCandidateAuthorship(db, sandboxOptions);
  const patchExportAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("patch_export") &&
    canOfferPatchExport(db, sandboxOptions);
  const workerEnabled = options.opencodeWorkerEnabled ?? env.opencodeWorkerEnabled;
  const workerReady = workerEnabled &&
    resolveOpenCodeBinary(options.opencodeBinaryPath ?? env.opencodeBinaryPath) !== null;
  const catalog = {
    ...C1_OPENCODE_FREE_CATALOG,
    candidateDevelopAllowsNvidia:
      options.opencodeCandidateDevelopAllowsNvidia ?? env.opencodeCandidateDevelopAllowsNvidia,
  };
  const workerRouter = createQuotaRouter({
    catalog,
    state: loadQuotaState(options.opencodeQuotaStatePath ?? env.opencodeQuotaStatePath),
    nowMs: options.nowMs ?? Date.now(),
  });
  const workerInspectionReady = canOfferWorkerBackedProjectInspection({
    registry,
    masterMode,
    lifecycleEnabled: options.lifecycleEnabled,
    substrateAvailable: options.substrateAvailable,
  });
  const projectInspectionAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("project_inspection") &&
    (directProjectInspectionAvailable || (workerEnabled && workerInspectionReady));
  const engineeringAuthorized = authorizedProjectIds(
    registry,
    (entry) => entry.engineeringAllowed === true && entry.candidateWorkspaceAllowed === true,
  ).length > 0;
  const engineeringOffer = workerReady && workspaceAvailable && engineeringAuthorized
    ? offerWorkerTask(workerRouter, "iterative_engineering")
    : { offerable: false, reason: "unavailable" as const };
  const iterativeEngineeringAvailable = engineeringOffer.offerable;
  const operationCapabilities = thoughtOperationCapabilities({
    registry,
    projectInspectionAvailable,
    verificationAvailable,
    patchExportAvailable,
    iterativeEngineeringAvailable,
  });
  const semanticObservations: readonly ThoughtSemanticObservation[] = Object.freeze([
    Object.freeze({
      operationKind: "concern.inspect" as const,
      semanticClass: "observation" as const,
      readOnly: true as const,
      available: !externalAudience,
    }),
  ]);
  const facts = {
    vision: audienceCapabilityAllowed("vision") && perceptionFacts.vision,
    attachmentText: audienceCapabilityAllowed("attachment_text") && perceptionFacts.attachmentText,
    conversationalRead: audienceCapabilityAllowed("conversational_read") && perceptionFacts.conversationalRead,
    webSearch: audienceCapabilityAllowed("web_search") && perceptionFacts.webSearch,
    canOfferProjectInspection: !externalAudience && projectInspectionAvailable,
    canOfferWorkspace: !externalAudience && workspaceAvailable,
    canOfferVerification: !externalAudience && verificationAvailable,
    canOfferAuthorship: !externalAudience && authorshipAvailable,
    canOfferBoundedOperation: false,
    canOfferInquiry: !externalAudience && workspaceAvailable && verificationAvailable,
    canOfferPatchExport: !externalAudience && patchExportAvailable,
    ...(workerEnabled
      ? {
        // Worker capacity is not a semantic capability. Thought sees the
        // single project.inspect operation above.
        canOfferIterativeEngineering: !externalAudience && iterativeEngineeringAvailable,
      }
      : {}),
  };
  const reachabilityReasons: Record<string, CapabilityRealityReasonCode> = {};
  for (const name of ["vision", "attachmentText", "conversationalRead", "webSearch"] as const) {
    reachabilityReasons[name] = reasonForCapability({
      value: facts[name],
      rawValue: perceptionFacts[name],
      name,
      externalAudience,
      perception: true,
      substrateWithoutAuthority,
      audienceAllowed: audienceCapabilityAllowed,
    });
  }
  const operationFacts: Array<{
    name: "canOfferProjectInspection" | "canOfferWorkspace" | "canOfferVerification" | "canOfferAuthorship" | "canOfferInquiry" | "canOfferPatchExport";
    value: boolean;
    rawValue: boolean;
  }> = [
    { name: "canOfferProjectInspection", value: facts.canOfferProjectInspection, rawValue: projectInspectionAvailable },
    { name: "canOfferWorkspace", value: facts.canOfferWorkspace, rawValue: workspaceAvailable },
    { name: "canOfferVerification", value: facts.canOfferVerification, rawValue: verificationAvailable },
    { name: "canOfferAuthorship", value: facts.canOfferAuthorship, rawValue: authorshipAvailable },
    { name: "canOfferInquiry", value: facts.canOfferInquiry, rawValue: workspaceAvailable && verificationAvailable },
    { name: "canOfferPatchExport", value: facts.canOfferPatchExport, rawValue: patchExportAvailable },
  ];
  for (const item of operationFacts) {
    reachabilityReasons[item.name] = reasonForCapability({
      ...item,
      name: item.name,
      externalAudience,
      ownerOnly: true,
      substrateWithoutAuthority,
      audienceAllowed: audienceCapabilityAllowed,
    });
  }
  reachabilityReasons.canOfferBoundedOperation = reasonForCapability({
    value: facts.canOfferBoundedOperation,
    rawValue: false,
    name: "canOfferBoundedOperation",
    externalAudience,
    ownerOnly: true,
    substrateWithoutAuthority,
    audienceAllowed: audienceCapabilityAllowed,
  });
  if (workerEnabled) {
    reachabilityReasons.canOfferIterativeEngineering = facts.canOfferIterativeEngineering
      ? workerReason(engineeringOffer.reason)
      : (externalAudience && iterativeEngineeringAvailable
        ? "another_audience_only"
        : workerReason(engineeringOffer.reason));
  }
  const projectedOperationCapabilities = externalAudience
    ? operationCapabilities.map((capability) => ({
      ...capability,
      available: false,
      authorizedProjectIds: [],
    }))
    : operationCapabilities;
  const projectedSemanticObservations = externalAudience
    ? semanticObservations.map((entry) => ({ ...entry, available: false }))
    : semanticObservations;
  for (const capability of operationCapabilities) {
    reachabilityReasons[capability.operationKind] = reasonForCapability({
      value: externalAudience ? false : capability.available,
      rawValue: capability.available,
      name: capability.operationKind,
      externalAudience,
      ownerOnly: true,
      substrateWithoutAuthority,
      audienceAllowed: audienceCapabilityAllowed,
    });
  }
  reachabilityReasons["concern.inspect"] = reasonForCapability({
    value: !externalAudience,
    rawValue: true,
    name: "concern.inspect",
    externalAudience,
    ownerOnly: true,
    substrateWithoutAuthority,
    audienceAllowed: audienceCapabilityAllowed,
  });
  const reality: CapabilityReality = {
    ...facts,
    approvedProjectIds: externalAudience ? [] : listApprovedReadProjectIds(registry),
    operationCapabilities: projectedOperationCapabilities,
    semanticObservations: projectedSemanticObservations,
    reachability: {
      audience: { ...audience },
      reasons: reachabilityReasons,
    },
  };
  return reality;
}
