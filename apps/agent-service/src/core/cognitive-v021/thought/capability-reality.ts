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
  listApprovedReadProjectIds,
  loadOperatorProjectReadRegistry,
  type V2ProjectReadRegistry,
} from "../../sandbox/project-registry.js";
import type { CapabilityName } from "../../rollout/capabilities.js";
import type { CapabilityReality, ThoughtOperationCapability } from "../types.js";

/** Capabilities with an actual v0.2.1 production adapter in this candidate. */
const V021_LIVE_OPERATION_CAPABILITIES: ReadonlySet<CapabilityName> = new Set([
  "project_inspection",
  "project_experimentation",
  "candidate_verification",
  "candidate_authorship",
]);

/** The production v0.2.1 perception provider is not bound in this candidate. */
const V021_LIVE_PERCEPTION_CAPABILITIES: ReadonlySet<CapabilityName> = new Set();

export type CapabilityRealityOptions = {
  registry?: V2ProjectReadRegistry;
  masterMode?: "observe" | "apply";
  lifecycleEnabled?: boolean;
  substrateAvailable?: boolean;
};

function authorizedProjectIds(
  registry: V2ProjectReadRegistry,
  predicate: (entry: ReturnType<V2ProjectReadRegistry["list"]>[number]) => boolean,
): string[] {
  return registry.list()
    .filter((entry) => entry.enabled && entry.readAllowed && predicate(entry))
    .map((entry) => entry.projectId)
    .sort();
}

function thoughtOperationCapabilities(input: {
  registry: V2ProjectReadRegistry;
  projectInspectionAvailable: boolean;
  verificationAvailable: boolean;
}): readonly ThoughtOperationCapability[] {
  const projectReadFileSpec = v2CapabilitySpec("project.read_file");
  const workspaceVerifySpec = v2CapabilitySpec("workspace.verify");
  if (!projectReadFileSpec || !workspaceVerifySpec) {
    throw new Error("sandbox_v2_operation_capability_spec_missing");
  }
  const approvedProjectIds = authorizedProjectIds(input.registry, () => true);
  const verificationProjectIds = authorizedProjectIds(
    input.registry,
    (entry) => entry.verificationAllowed === true && (entry.allowedRecipeIds?.length ?? 0) > 0,
  );
  return Object.freeze([
    Object.freeze({
      operationKind: "project.read_file",
      semanticClass: "observation" as const,
      family: projectReadFileSpec.family,
      readOnly: projectReadFileSpec.readOnly,
      requiresProject: projectReadFileSpec.requiresProject,
      available: input.projectInspectionAvailable,
      requiredRequestFields: Object.freeze(["projectId", "path"]),
      optionalRequestFields: Object.freeze([]),
      operatorBoundRequestFields: Object.freeze([]),
      authorizedProjectIds: Object.freeze(approvedProjectIds),
    }),
    Object.freeze({
      operationKind: "workspace.verify",
      semanticClass: "effect" as const,
      family: workspaceVerifySpec.family,
      readOnly: workspaceVerifySpec.readOnly,
      requiresProject: workspaceVerifySpec.requiresProject,
      available: input.verificationAvailable,
      requiredRequestFields: Object.freeze(["projectId"]),
      optionalRequestFields: Object.freeze(["workspaceId", "recipeId"]),
      operatorBoundRequestFields: Object.freeze(["workspaceId", "recipeId"]),
      authorizedProjectIds: Object.freeze(verificationProjectIds),
    }),
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
  const projectInspectionAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("project_inspection") &&
    canOfferProjectInspection(db, sandboxOptions);
  const verificationAvailable = V021_LIVE_OPERATION_CAPABILITIES.has("candidate_verification") &&
    canOfferCandidateVerification(db, sandboxOptions);
  return {
    vision: V021_LIVE_PERCEPTION_CAPABILITIES.has("vision") &&
      perceptionCapabilityCanInfluence(db, "vision", masterMode),
    attachmentText: V021_LIVE_PERCEPTION_CAPABILITIES.has("attachment_text") &&
      perceptionCapabilityCanInfluence(db, "attachment_text", masterMode),
    conversationalRead: V021_LIVE_PERCEPTION_CAPABILITIES.has("conversational_read") &&
      perceptionCapabilityCanInfluence(db, "conversational_read", masterMode),
    webSearch: V021_LIVE_PERCEPTION_CAPABILITIES.has("web_search") &&
      perceptionCapabilityCanInfluence(db, "web_search", masterMode),
    canOfferProjectInspection: projectInspectionAvailable,
    canOfferWorkspace: V021_LIVE_OPERATION_CAPABILITIES.has("project_experimentation") &&
      canOfferCandidateWorkspace(db, sandboxOptions),
    canOfferVerification: verificationAvailable,
    canOfferAuthorship: V021_LIVE_OPERATION_CAPABILITIES.has("candidate_authorship") &&
      canOfferCandidateAuthorship(db, sandboxOptions),
    canOfferBoundedOperation: false,
    canOfferPatchExport: false,
    approvedProjectIds: listApprovedReadProjectIds(registry),
    operationCapabilities: thoughtOperationCapabilities({
      registry,
      projectInspectionAvailable,
      verificationAvailable,
    }),
  };
}
