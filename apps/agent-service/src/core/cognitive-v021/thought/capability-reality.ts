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
import type {
  CapabilityReality,
  CapabilityRealityReasonCode,
  ThoughtOperationCapability,
} from "../types.js";
import type { SocialAudience } from "../social/types.js";

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

function thoughtOperationCapabilities(input: {
  registry: V2ProjectReadRegistry;
  projectInspectionAvailable: boolean;
  verificationAvailable: boolean;
  patchExportAvailable: boolean;
}): readonly ThoughtOperationCapability[] {
  const projectReadFileSpec = v2CapabilitySpec("project.read_file");
  const projectListDirectorySpec = v2CapabilitySpec("project.list_directory");
  const projectSearchTextSpec = v2CapabilitySpec("project.search_text");
  const workspaceVerifySpec = v2CapabilitySpec("workspace.verify");
  const patchExportSpec = v2CapabilitySpec("patch_export");
  if (!projectReadFileSpec || !projectListDirectorySpec || !projectSearchTextSpec || !workspaceVerifySpec || !patchExportSpec) {
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
      operationKind: "project.list_directory",
      semanticClass: "observation" as const,
      family: projectListDirectorySpec.family,
      readOnly: projectListDirectorySpec.readOnly,
      requiresProject: projectListDirectorySpec.requiresProject,
      available: input.projectInspectionAvailable,
      requiredRequestFields: Object.freeze(["projectId", "path"]),
      optionalRequestFields: Object.freeze([]),
      operatorBoundRequestFields: Object.freeze([]),
      authorizedProjectIds: Object.freeze(approvedProjectIds),
    }),
    Object.freeze({
      operationKind: "project.search_text",
      semanticClass: "observation" as const,
      family: projectSearchTextSpec.family,
      readOnly: projectSearchTextSpec.readOnly,
      requiresProject: projectSearchTextSpec.requiresProject,
      available: input.projectInspectionAvailable,
      requiredRequestFields: Object.freeze(["projectId", "pattern"]),
      optionalRequestFields: Object.freeze(["path", "maxMatches"]),
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
    Object.freeze({
      operationKind: "patch_export",
      semanticClass: "effect" as const,
      family: patchExportSpec.family,
      readOnly: patchExportSpec.readOnly,
      requiresProject: patchExportSpec.requiresProject,
      available: input.patchExportAvailable,
      requiredRequestFields: Object.freeze(["projectId", "changesetId", "adjudication"]),
      optionalRequestFields: Object.freeze([]),
      operatorBoundRequestFields: Object.freeze(["changesetId"]),
      authorizedProjectIds: Object.freeze(patchExportProjectIds),
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
  const operationCapabilities = thoughtOperationCapabilities({
    registry,
    projectInspectionAvailable,
    verificationAvailable,
    patchExportAvailable,
  });
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
    canOfferPatchExport: !externalAudience && patchExportAvailable,
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
    name: "canOfferProjectInspection" | "canOfferWorkspace" | "canOfferVerification" | "canOfferAuthorship" | "canOfferPatchExport";
    value: boolean;
    rawValue: boolean;
  }> = [
    { name: "canOfferProjectInspection", value: facts.canOfferProjectInspection, rawValue: projectInspectionAvailable },
    { name: "canOfferWorkspace", value: facts.canOfferWorkspace, rawValue: workspaceAvailable },
    { name: "canOfferVerification", value: facts.canOfferVerification, rawValue: verificationAvailable },
    { name: "canOfferAuthorship", value: facts.canOfferAuthorship, rawValue: authorshipAvailable },
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
  const projectedOperationCapabilities = externalAudience
    ? operationCapabilities.map((capability) => ({
      ...capability,
      available: false,
      authorizedProjectIds: [],
    }))
    : operationCapabilities;
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
  const reality: CapabilityReality = {
    ...facts,
    approvedProjectIds: externalAudience ? [] : listApprovedReadProjectIds(registry),
    operationCapabilities: projectedOperationCapabilities,
    reachability: {
      audience: { ...audience },
      reasons: reachabilityReasons,
    },
  };
  return reality;
}
