import type {
  CapabilityActivationReadiness,
  CapabilityName,
} from "./capabilities.js";

export type OwnerBootstrapAvailability = {
  commandCode: boolean;
  webFetch: boolean;
  webSearch: boolean;
  projectInspection: boolean;
  projectExperimentation: boolean;
  candidateVerification: boolean;
  candidateAuthorship: boolean;
  boundedOperation: boolean;
  patchExport: boolean;
  ownerGrantedCapabilities: ReadonlySet<CapabilityName>;
};

function providerReadiness(available: boolean): CapabilityActivationReadiness {
  return available
    ? { ready: true }
    : { ready: false, reason: "provider_unavailable" };
}

function hostReadiness(available: boolean): CapabilityActivationReadiness {
  return available
    ? { ready: true }
    : { ready: false, reason: "dependencies_unavailable" };
}

function ownerGrantReadiness(
  capability: CapabilityName,
  availability: OwnerBootstrapAvailability,
): CapabilityActivationReadiness {
  return availability.ownerGrantedCapabilities.has(capability)
    ? { ready: true }
    : { ready: false, reason: "owner_grant_required" };
}

/**
 * Resolve the independently observed prerequisites for the explicit fresh-host
 * owner-bootstrap path. Maturation evidence is intentionally absent here; it
 * remains owned by the ordinary promotion path.
 */
export function ownerBootstrapReadinessFor(
  capability: CapabilityName,
  availability: OwnerBootstrapAvailability,
): CapabilityActivationReadiness {
  switch (capability) {
    case "thought":
    case "vision":
    case "attachment_text":
      return providerReadiness(availability.commandCode);
    case "reading":
    case "conversational_read":
      return providerReadiness(availability.webFetch);
    case "web_search":
      return providerReadiness(availability.webSearch);
    case "project_inspection":
      return hostReadiness(availability.projectInspection);
    case "project_experimentation":
      return hostReadiness(availability.projectExperimentation);
    case "candidate_verification":
      return hostReadiness(availability.candidateVerification);
    case "candidate_authorship":
      return hostReadiness(availability.candidateAuthorship);
    case "bounded_operation":
      return hostReadiness(availability.boundedOperation);
    case "patch_export":
      return hostReadiness(availability.patchExport);
    case "memory_evidence":
    case "context_budget":
    case "learned_autonomy":
    case "cognitive_graduation":
    case "relational_graduation":
    case "external_observe":
    case "external_prepare":
    case "external_private":
    case "external_public":
      return ownerGrantReadiness(capability, availability);
    default:
      return { ready: true };
  }
}
