import type { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { isSandboxV2Available } from "../sandbox/v2-execution.js";
import { contractMismatch } from "../attention/ledger.js";
import {
  capabilityCanInfluence,
  currentContractId,
  currentReleaseId,
} from "../rollout/capabilities.js";
import type { CognitionMode } from "../types.js";
import { listApprovedReadProjectIds, canOfferCandidateWorkspace, canOfferCandidateVerification, canOfferCandidateAuthorship, canOfferBoundedOperation, canOfferPatchExport } from "../sandbox/project-registry.js";

export type PerceptionCapabilityName =
  | "vision"
  | "attachment_text"
  | "conversational_read"
  | "web_search";

type CapabilityState = "observe" | "active" | "rolled_back" | "disabled";

const PERCEPTION_CAPABILITY_DEPS: Record<PerceptionCapabilityName, string[]> = {
  vision: ["thought"],
  attachment_text: ["thought"],
  conversational_read: ["reading", "thought"],
  web_search: ["thought"],
};

const PERCEPTION_CAPABILITIES: PerceptionCapabilityName[] = [
  "vision",
  "attachment_text",
  "conversational_read",
  "web_search",
];

function releaseState(
  db: DatabaseSync,
  capability: string,
  releaseId: string,
): CapabilityState {
  const row = db
    .prepare(
      `SELECT state FROM capability_releases
       WHERE capability = ? AND release_id = ?`,
    )
    .get(capability, releaseId) as { state?: string } | undefined;
  switch (row?.state) {
    case "active":
    case "rolled_back":
    case "disabled":
      return row.state;
    default:
      return "observe";
  }
}

function dependenciesReady(
  db: DatabaseSync,
  capability: PerceptionCapabilityName,
  releaseId: string,
): boolean {
  return PERCEPTION_CAPABILITY_DEPS[capability].every(
    (dependency) => releaseState(db, dependency, releaseId) === "active",
  );
}

/**
 * Mirrors capabilityCanInfluence for v3 perception capabilities until they join
 * the primary capability registry.
 */
export function perceptionCapabilityCanInfluence(
  db: DatabaseSync,
  capability: PerceptionCapabilityName,
  masterMode: CognitionMode = env.cognitionMode,
  releaseId = currentReleaseId() || currentContractId(),
): boolean {
  if (contractMismatch(db)) return false;
  if (masterMode !== "apply") return false;
  return (
    releaseState(db, capability, releaseId) === "active" &&
    dependenciesReady(db, capability, releaseId)
  );
}

export type PerceptionCapabilitySnapshot = {
  capability: PerceptionCapabilityName;
  state: CapabilityState;
  effective: boolean;
};

export function listPerceptionCapabilitySnapshots(
  db: DatabaseSync,
  masterMode: CognitionMode = env.cognitionMode,
  releaseId = currentReleaseId() || currentContractId(),
): PerceptionCapabilitySnapshot[] {
  return PERCEPTION_CAPABILITIES.map((capability) => {
    const state = releaseState(db, capability, releaseId);
    const effective =
      !contractMismatch(db) &&
      masterMode === "apply" &&
      state === "active" &&
      dependenciesReady(db, capability, releaseId);
    return { capability, state, effective };
  });
}

function describeCapability(snapshot: PerceptionCapabilitySnapshot): string {
  const label = snapshot.capability.replace(/_/g, " ");
  if (snapshot.effective) {
    return `${label}: active (may influence this turn when licensed)`;
  }
  if (snapshot.state === "active" && !snapshot.effective) {
    return `${label}: active release but blocked (dependencies or master observe)`;
  }
  return `${label}: observe (recorded only; not licensed for model influence)`;
}

export function describeSandboxV2Availability(options?: {
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  lifecycleEnabled?: boolean;
  substrateAvailable?: boolean;
  approvedProjects?: string[];
  inspectionCanInfluence?: boolean;
}): string {
  const lifecycleEnabled =
    options?.lifecycleEnabled ?? env.sandboxEngineeringLifecycleEnabled;
  const substrateAvailable =
    options?.substrateAvailable ?? isSandboxV2Available();
  const approvedProjects =
    options?.approvedProjects ?? listApprovedReadProjectIds();

  const canInfluence =
    options?.inspectionCanInfluence !== undefined
      ? options.inspectionCanInfluence
      : options?.db
        ? (() => {
            try {
              return capabilityCanInfluence(options.db, "project_inspection", options.masterMode);
            } catch {
              return false;
            }
          })()
        : false;

  if (lifecycleEnabled && substrateAvailable) {
    if (approvedProjects.length > 0) {
      if (canInfluence) {
        return `Sandbox V2: available (bounded read-only inspection of approved projects: ${approvedProjects.join(", ")}; workspace file roundtrip enabled).`;
      }
      return `Sandbox V2: inspection capability not active in rollout (observe-only / non-influencing; cannot inspect repository; workspace file roundtrip enabled).`;
    }
    return "Sandbox V2: substrate available (file.roundtrip enabled; no approved read-only projects configured).";
  }
  if (!lifecycleEnabled) {
    return "Sandbox V2: disabled (ASHLEY_SANDBOX_ENGINEERING_LIFECYCLE_ENABLED is not true).";
  }
  return "Sandbox V2: substrate unavailable (Linux bubblewrap required).";
}

export function describeCandidateWorkspaceAvailability(options?: {
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  /** Test seam: skip live capability lookup when provided. */
  canInfluence?: boolean;
  /** Test seam: skip live registry/substrate lookup when provided. */
  registryAllows?: boolean;
}): string {
  if (!options?.db) {
    return "Candidate workspace (M3): unavailable (no db for capability check); cannot offer candidate workspace experiments this turn.";
  }
  const canInfluence =
    options.canInfluence ??
    (() => {
      try {
        return capabilityCanInfluence(options.db, "project_experimentation", options.masterMode);
      } catch {
        return false;
      }
    })();
  const registryAllows =
    options.registryAllows ?? canOfferCandidateWorkspace(options.db);
  if (canInfluence && registryAllows) {
    return "Candidate workspace (M3): available (project_experimentation active and candidateWorkspaceAllowed true; bounded typed mutation of private durable candidate copies; not live-repository mutation).";
  }
  return `Candidate workspace (M3): ${
    !canInfluence
      ? "inspection capability not active in rollout (observe-only; cannot offer candidate workspace experiments)"
      : "candidateWorkspaceAllowed closed on the project registry (cannot offer candidate workspace experiments)"
  }`;
}

export function describeCandidateVerificationAvailability(options?: {
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  canInfluence?: boolean;
  registryAllows?: boolean;
}): string {
  if (!options?.db) {
    return "Candidate verification (M4): unavailable (no db for capability check); cannot request workspace.verify this turn.";
  }
  const canInfluence =
    options.canInfluence ??
    (() => {
      try {
        return capabilityCanInfluence(options.db, "candidate_verification", options.masterMode);
      } catch {
        return false;
      }
    })();
  const registryAllows =
    options.registryAllows ?? canOfferCandidateVerification(options.db);
  if (canInfluence && registryAllows) {
    return "Candidate verification (M4): offerable (candidate_verification active and verificationAllowed with a recipe allowlist; when grounded state is currently resolvable, emit candidate_verification with projectId only and omit workspaceId/recipeId; those are operator-bound control-plane facts, not owner-supplied magic words; mechanical recipe outcome for a named snapshot; not engineering judgment). Deadline-branch availability is a separate runtime gate.";
  }
  return `Candidate verification (M4): ${
    !canInfluence
      ? "capability not active in rollout (observe-only; cannot request workspace.verify)"
      : "verificationAllowed closed or recipe allowlist empty (cannot request workspace.verify)"
  }`;
}

export function describeCandidateAuthorshipAvailability(options?: {
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  canInfluence?: boolean;
  registryAllows?: boolean;
}): string {
  if (!options?.db) {
    return "Candidate authorship (M5): unavailable (no db for capability check); cannot request changeset.author this turn.";
  }
  const canInfluence =
    options.canInfluence ??
    (() => {
      try {
        return capabilityCanInfluence(options.db, "candidate_authorship", options.masterMode);
      } catch {
        return false;
      }
    })();
  const registryAllows =
    options.registryAllows ?? canOfferCandidateAuthorship(options.db);
  if (canInfluence && registryAllows) {
    return "Candidate authorship (M5): offerable (candidate_authorship active and authorshipAllowed; sealed advisory candidate change-set; not apply, merge, or self-change). Deadline-branch availability is a separate runtime gate.";
  }
  return `Candidate authorship (M5): ${
    !canInfluence
      ? "capability not active in rollout (observe-only; cannot request changeset.author)"
      : "authorshipAllowed closed on the project registry (cannot request changeset.author)"
  }`;
}

export function describeBoundedOperationAvailability(options?: {
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  canInfluence?: boolean;
  registryAllows?: boolean;
}): string {
  if (!options?.db) {
    return "Bounded operation (M6): unavailable (no db for capability check); cannot request objective.operate this turn.";
  }
  const canInfluence =
    options.canInfluence ??
    (() => {
      try {
        return capabilityCanInfluence(options.db, "bounded_operation", options.masterMode);
      } catch {
        return false;
      }
    })();
  const registryAllows =
    options.registryAllows ?? canOfferBoundedOperation(options.db);
  if (canInfluence && registryAllows) {
    return "Bounded operation (M6): offerable (bounded_operation active and operationAllowed; finite admitted M3/M4/M5 sequence; not a border effect, worker, or second Agency).";
  }
  return `Bounded operation (M6): ${
    !canInfluence
      ? "capability not active in rollout (observe-only; cannot request objective.operate)"
      : "operationAllowed closed on the project registry (cannot request objective.operate)"
  }`;
}

export function describePatchExportAvailability(options?: {
  db?: DatabaseSync;
  masterMode?: CognitionMode;
  canInfluence?: boolean;
  registryAllows?: boolean;
}): string {
  if (!options?.db) {
    return "Patch export (M7): unavailable (no db for capability check); cannot request patch_export this turn.";
  }
  const canInfluence =
    options.canInfluence ??
    (() => {
      try {
        return capabilityCanInfluence(options.db, "patch_export", options.masterMode);
      } catch {
        return false;
      }
    })();
  const registryAllows =
    options.registryAllows ?? canOfferPatchExport(options.db);
  if (canInfluence && registryAllows) {
    return "Patch export (M7): offerable (patch_export active and patchExportAllowed; sealed artifact copy to operator review location; not apply, Git, or deploy).";
  }
  return `Patch export (M7): ${
    !canInfluence
      ? "capability not active in rollout (observe-only; cannot request patch_export)"
      : "patchExportAllowed closed on the project registry (cannot request patch_export)"
  }`;
}

export function composeSelfCapabilityContext(
  db: DatabaseSync,
  options?: {
    masterMode?: CognitionMode;
  },
): string {
  const snapshots = listPerceptionCapabilitySnapshots(db, options?.masterMode);
  const lines = [
    "Perception capabilities (honest self-model):",
    ...snapshots.map((snapshot) => `- ${describeCapability(snapshot)}`),
    "- Attachment fetch requires sufficient thought deadline and capability release.",
    "- Conversational page reads require explicit user URL-read intent plus authorization.",
    "- Web search has no configured provider in this deployment.",
    `- ${describeSandboxV2Availability({ db, masterMode: options?.masterMode })}`,
    `- ${describeCandidateWorkspaceAvailability({ db, masterMode: options?.masterMode })}`,
    `- ${describeCandidateVerificationAvailability({ db, masterMode: options?.masterMode })}`,
    `- ${describeCandidateAuthorshipAvailability({ db, masterMode: options?.masterMode })}`,
    `- ${describeBoundedOperationAvailability({ db, masterMode: options?.masterMode })}`,
    `- ${describePatchExportAvailability({ db, masterMode: options?.masterMode })}`,
  ];
  return lines.join("\n");
}
