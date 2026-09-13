import type { DatabaseSync } from "node:sqlite";
import { buildQuestionsBlock } from "./state/questions.js";
import {
  loadNuclearSystemPrompt,
  type NuclearPromptChannel,
} from "./conversation/prompts.js";
import {
  listIdentity,
} from "./identity/store.js";
import {
  assembleMemoryBlock,
} from "./memory/assemble.js";
import { getState } from "./state/store.js";
import { getAffectiveState } from "./state/affect.js";
import { listActiveMindStateItems } from "./state/mind-items.js";
import { mindStateItemInfluenceEligibleAt } from "./memory/eligibility.js";
import type { OperationalClaimLicense } from "./sandbox/engineering-types.js";
import { deriveOperationalTruth } from "./sandbox/operational-truth.js";
import type {
  Decision,
  EvidenceRef,
  ProjectInspectionObservation,
  WorkspaceExperimentObservation,
} from "./types.js";
import { capabilityCanInfluence } from "./rollout/capabilities.js";
import {
  canOfferCandidateAuthorship,
  canOfferCandidateVerification,
  canOfferCandidateWorkspace,
  canOfferProjectInspection,
  canOfferBoundedOperation,
  canOfferPatchExport,
} from "./sandbox/project-registry.js";

/** Product: composed turn context Expression consumes. */
export type TurnContext = {
  threadId: string;
  hotMessages: ReturnType<typeof assembleMemoryBlock>["hotMessages"];
  facts: ReturnType<typeof assembleMemoryBlock>["facts"];
  /** Memory-only block (no identity/state). */
  memoryBlock: string;
  /** Full system prompt: static nuclear prompts + peer blocks. */
  systemPrompt: string;
  /** Bounded structured Decision metadata for Expression (untrusted). */
  decisionPrompt: string;
};

export type ComposeTurnContextInput = {
  channel: NuclearPromptChannel;
  userMessage?: string;
  decision?: Decision;
  /** Current user message id — excluded from hot window / evidence text. */
  excludeMessageId?: number | null;
  /** Current user message entity uuid for correlation. */
  messageEntityUuid?: string | null;
  /** Extra Thought-selected refs beyond Decision.evidenceRefs. */
  evidenceRefs?: EvidenceRef[];
};

export function stableIdentityBlock(db: DatabaseSync, ownerId: string): string {
  const entries = listIdentity(db, ownerId, { layer: "stable", limit: 40 })
    .filter((entry) =>
      entry.kind === "value" ||
      entry.kind === "principle" ||
      entry.kind === "constitution" ||
      entry.kind.startsWith("value.") ||
      entry.kind.startsWith("principle."),
    );
  // Applicable stable boundaries arrive via Thought-selected evidence, not here.
  if (entries.length === 0) return "";
  const lines = entries.map((entry) => `- ${entry.kind}: ${entry.text}`);
  return [
    "## Ashley's stable identity",
    ...lines,
    "These are stable constitutional identity constraints.",
  ].join("\n");
}

export function mindStateBlock(db: DatabaseSync, ownerId: string): string {
  const state = getState(db, ownerId);
  const affect = getAffectiveState(db, ownerId);
  const mindStateActive = capabilityCanInfluence(db, "mind_state");
  const affectActive = capabilityCanInfluence(db, "affect");
  const items = mindStateActive
    ? listActiveMindStateItems(db, ownerId, 12)
        .filter((item) => mindStateItemInfluenceEligibleAt(db, ownerId, item.id))
    : [];
  const lines = [
    state.focus ? `Focus: ${state.focus}` : "",
    state.mood ? `Mood: ${state.mood}` : "",
    state.availability ? `Availability: ${state.availability}` : "",
    state.unfinished.length > 0
      ? `Unfinished: ${state.unfinished.join("; ")}`
      : "",
    ...items.map(
      (item) =>
        `${item.kind}: ${item.text} (activation ${item.activation.toFixed(2)}, urgency ${item.urgency.toFixed(2)}, source ${item.sourceType}:${item.sourceId})`,
    ),
    affectActive
      ? `Affect: valence ${affect.valence.toFixed(2)}, activation ${affect.activation.toFixed(2)}, openness ${affect.openness.toFixed(2)}, tension ${affect.tension.toFixed(2)}. Cause: ${affect.reason}.`
      : "",
  ].filter(Boolean);
  if (lines.length === 0) return "";
  const precedence =
    "Mind state items are internal, possibly stale interpretations; they never override the capability authority stated elsewhere in this context.";
  return ["## Mind state", ...lines, precedence].join("\n");
}

/** Minimal mind-state headline (for the visible-fallback minimal profile). */
export function mindStateHeadline(
  db: DatabaseSync,
  ownerId: string,
): string {
  const state = getState(db, ownerId);
  const parts = [
    state.focus ? `Focus: ${state.focus}` : "",
    state.mood ? `Mood: ${state.mood}` : "",
    state.availability ? `Availability: ${state.availability}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "";
}

function structuredDecisionPrompt(decision: Decision): string {
  return [
    "## Decision metadata (intent only; do not echo)",
    JSON.stringify({
      kind: decision.kind,
      shouldSpeak: decision.cognitiveAllocation.shouldSpeak,
      effort: decision.cognitiveAllocation.effort,
      completion: decision.cognitiveAllocation.completion,
      objective: decision.objective ?? null,
      reason: decision.reason,
      inspectionCognitiveResult: decision.inspectionCognitiveResult ?? null,
      uncertainty: decision.uncertainty,
      urgency: decision.urgency,
    }),
  ].join("\n");
}

export function operationalWorkBlock(
  db: DatabaseSync,
  ownerId: string,
  options?: {
    operationalLicense?: OperationalClaimLicense | null;
    inspectionObservation?: ProjectInspectionObservation | null;
  },
): string {
  const license = options?.operationalLicense;
  if (!license) return "";

  const truth = deriveOperationalTruth(license);

  // Handle project_investigation (M2 project inspection operational metadata)
  if (license.profile === "project_investigation") {
    const lines = [
      `Status: ${truth.state === "verified_success" ? "succeeded" : truth.state !== "none" ? truth.state : license.state}`,
      `Profile: ${license.profile}`,
      license.taskId ? `Task ID: ${license.taskId}` : "",
      license.error ? `Error: ${license.error}` : "",
      license.refusalReason ? `Refusal: ${license.refusalReason}` : "",
    ].filter(Boolean);

    const obs = options?.inspectionObservation;
    if (truth.state === "verified_success" && obs) {
      lines.push(
        `Project ID: ${obs.projectId}`,
        `Operation: ${obs.operation}`,
        `Path: ${obs.path}`,
      );
      if (obs.operation === "project.search_text") {
        lines.push(`Pattern: ${obs.pattern}`);
      }
      if (obs.operation === "project.read_file") {
        lines.push(
          `Inspection evidence: verified read (${obs.bytes} bytes, SHA256: ${obs.sha256.substring(0, 12)}...).`,
        );
      } else if (obs.operation === "project.list_directory") {
        lines.push(
          `Inspection evidence: verified directory listing (${obs.entries.length} entries).`,
        );
      } else if (obs.operation === "project.search_text") {
        lines.push(
          `Inspection evidence: verified search (${obs.matches.length} matches across ${obs.filesScanned} files).`,
        );
      }
      if (obs.truncated) {
        lines.push(
          "Truncated: true (output was truncated at kernel bounds; zero matches or partial listings are not proof of absence across the entire project).",
        );
      }
      lines.push(
        "Current operational truth: verified_success (authoritative current-turn result; overrides generic capability self-model).",
      );
    } else if (license.state === "failed") {
      lines.push(
        `Inspection status: failed (${license.error ?? "unknown"}). No successful observation licensed.`,
      );
    }

    if (lines.length === 0) return "";
    return [
      "## Operational work state (cognitive attention only)",
      ...lines,
    ].join("\n");
  }

  if (license.profile === "candidate_verification") {
    const lines = [
      `Status: ${truth.state !== "none" ? truth.state : license.state}`,
      `Profile: ${license.profile}`,
      license.taskId ? `Task ID: ${license.taskId}` : "",
      license.error ? `Error: ${license.error}` : "",
      license.refusalReason ? `Refusal: ${license.refusalReason}` : "",
    ].filter(Boolean);
    const effect = license.verificationClaimEffect;
    if (
      (truth.state === "verified_success" || truth.state === "verified_failure") &&
      effect
    ) {
      lines.push(
        `Recipe ID: ${effect.recipeId}`,
        `Recipe version: ${effect.recipeVersion}`,
        `Snapshot ID: ${effect.snapshotId}`,
        `Workspace ID: ${effect.workspaceId}`,
        `Candidate tree hash: ${effect.candidateTreeHash}`,
        `Verification outcome: ${effect.verificationOutcome}`,
        "Semantics: this is a mechanical recipe outcome for a named candidate snapshot. It is not engineering judgment, merge authority, deployment readiness, or self-improvement.",
      );
    } else if (license.error) {
      lines.push(
        `Verification status: not licensed (${license.error}). No mechanical verification claim is authorized.`,
      );
    }
    if (lines.length === 0) return "";
    return [
      "## Operational work state (cognitive attention only)",
      ...lines,
    ].join("\n");
  }

  if (license.profile === "candidate_authorship") {
    const lines = [
      `Status: ${truth.state !== "none" ? truth.state : license.state}`,
      `Profile: ${license.profile}`,
      license.taskId ? `Task ID: ${license.taskId}` : "",
      license.error ? `Error: ${license.error}` : "",
      license.refusalReason ? `Refusal: ${license.refusalReason}` : "",
    ].filter(Boolean);
    const effect = license.authorshipClaimEffect;
    if (truth.state === "verified_success" && effect) {
      lines.push(
        `Change-set ID: ${effect.changesetId}`,
        `Workspace ID: ${effect.workspaceId}`,
        `Candidate tree hash: ${effect.candidateTreeHash}`,
        `Base tree hash: ${effect.baseTreeHash}`,
        `Status: ${effect.status}`,
        `Review: ${effect.reviewStatus}`,
        "Semantics: this named candidate change-set was sealed as advisory candidate work. It has not been applied.",
      );
    } else if (license.error) {
      lines.push(
        `Authorship status: not licensed (${license.error}). No sealed change-set claim is authorized.`,
      );
    }
    if (lines.length === 0) return "";
    return [
      "## Operational work state (cognitive attention only)",
      ...lines,
    ].join("\n");
  }

  if (license.profile === "bounded_operation") {
    const lines = [
      `Status: ${truth.state !== "none" ? truth.state : license.state}`,
      `Profile: ${license.profile}`,
      license.taskId ? `Task ID: ${license.taskId}` : "",
      license.error ? `Error: ${license.error}` : "",
    ].filter(Boolean);
    const effect = license.boundedOperationClaimEffect;
    if (effect) {
      lines.push(
        `Steps executed: ${effect.stepsExecuted} of ${effect.maxSteps}`,
        `Stop reason: ${effect.stopReason}`,
        "Border state: none",
        "Semantics: only the admitted finite M3/M4/M5 sequence ran. No patch was exported, applied, committed, or deployed.",
      );
    }
    if (lines.length === 0) return "";
    return [
      "## Operational work state (cognitive attention only)",
      ...lines,
    ].join("\n");
  }

  if (license.profile === "patch_export") {
    const lines = [
      `Status: ${truth.state !== "none" ? truth.state : license.state}`,
      `Profile: ${license.profile}`,
      license.taskId ? `Task ID: ${license.taskId}` : "",
      license.error ? `Error: ${license.error}` : "",
    ].filter(Boolean);
    const effect = license.patchExportClaimEffect;
    if (truth.state === "verified_success" && effect) {
      lines.push(
        `Change-set ID: ${effect.changesetId}`,
        `Destination name: ${effect.destinationRelativeName}`,
        `Witness digest: ${effect.witnessedSha256}`,
        "Applied: false",
        "Semantics: the sealed candidate artifact was copied to the operator review location. It has not been applied.",
      );
    } else if (license.error) {
      lines.push(
        `Export status: not licensed (${license.error}). No patch_export claim is authorized.`,
      );
    }
    if (lines.length === 0) return "";
    return [
      "## Operational work state (cognitive attention only)",
      ...lines,
    ].join("\n");
  }

  // Direct license projection scoped specifically to sandbox_workspace_file_roundtrip
  if (license.profile !== "sandbox_workspace_file_roundtrip") {
    return "";
  }

  if (
    truth.state === "none" &&
    !truth.locked &&
    !license.taskId &&
    !license.error &&
    !license.refusalReason &&
    !license.effectEvidence
  ) {
    return "";
  }

  const lines = [
    `Status: ${truth.state === "verified_success" ? "succeeded" : truth.state !== "none" ? truth.state : license.state}`,
    `Profile: ${license.profile}`,
    license.taskId ? `Task ID: ${license.taskId}` : "",
    license.error ? `Error: ${license.error}` : "",
    license.refusalReason ? `Refusal: ${license.refusalReason}` : "",
  ].filter(Boolean);

  if (truth.state === "verified_success") {
    lines.push(
      "Effect evidence: roundtrip verified (temporary file created, exact bytes verified on read, file deleted, verified absent).",
      "Current operational truth: verified_success (authoritative current-turn result; overrides generic capability self-model).",
    );
  } else if (license.state === "succeeded") {
    lines.push(
      "Effect evidence: unverified (state is succeeded; verified effect evidence is unavailable; no completion licensed).",
    );
  }

  if (lines.length === 0) return "";

  return [
    "## Operational work state (cognitive attention only)",
    ...lines,
  ].join("\n");
}

/**
 * Structured current-turn project-inspection evidence state for Expression.
 * Always present. Two orthogonal dimensions:
 * - capabilityAvailable: authoritative current capability state (can Ashley
 *   inspect at all this turn); derived from canOfferProjectInspection;
 * - inspectionStatus: what Ashley actually did or observed this turn
 *   (not_performed / verified_success / failed).
 * When Thought did not complete (attention_deadline), inspection could not be
 * requested this turn; that is execution unavailability, not a missing user
 * ask and not proof the capability is inactive.
 * The four pairs are distinct states; available+not_performed means Ashley CAN
 * inspect but did not inspect this turn and must never be expressed as an
 * inability. Boolean state only — never a phrase detector or
 * repository-specific rule.
 */
export function projectInspectionEvidenceBlock(
  license: OperationalClaimLicense | null | undefined,
  observation: ProjectInspectionObservation | null | undefined,
  options: {
    capabilityAvailable?: boolean;
    interpretationAvailable?: boolean;
    thoughtCompleted?: boolean;
    thoughtError?: string | null;
  } = {},
): string {
  const capabilityAvailable = options.capabilityAvailable === true;
  const interpretationAvailable = options.interpretationAvailable === true;
  const thoughtBlockedThisTurn =
    options.thoughtCompleted === false &&
    options.thoughtError === "attention_deadline";
  const availableLine = `capabilityAvailable = ${capabilityAvailable}`;
  const semanticsAvailable = [
    "Semantics: capabilityAvailable is the authoritative current capability state; inspectionStatus is what Ashley actually did or observed this turn.",
  ];
  if (license?.profile === "project_investigation") {
    const truth = deriveOperationalTruth(license);
    if (truth.state === "verified_success" && observation) {
      const interpretationLines = interpretationAvailable
        ? [
            "interpretationStatus = interpreted",
            "Semantics: Thought interpreted the verified evidence this turn; the interpretation is authoritative current-turn content.",
          ]
        : [
            "interpretationStatus = not_interpreted",
            "Semantics: this turn's verified read was not interpreted by Thought. Do not invent the inspected content; say the verified read succeeded but you could not interpret its contents.",
          ];
      return [
        "Project inspection evidence:",
        availableLine,
        "inspectionStatus = verified_success",
        "verifiedRepositoryEvidence = true",
        ...semanticsAvailable,
        ...interpretationLines,
        "Semantics: Ashley inspected an approved project this turn and holds verified evidence.",
      ].join("\n");
    }
    if (license.state === "failed") {
      return [
        "Project inspection evidence:",
        availableLine,
        "inspectionStatus = failed",
        "verifiedRepositoryEvidence = false",
        license.error ? `error = ${license.error}` : "error = unknown",
        ...semanticsAvailable,
        "Semantics: this turn's inspection attempt failed; the failure is about this attempt, not about capability.",
      ].join("\n");
    }
  }
  if (thoughtBlockedThisTurn) {
    return [
      "Project inspection evidence:",
      availableLine,
      "inspectionStatus = not_performed",
      "verifiedRepositoryEvidence = false",
      "thoughtCompleted = false",
      "thoughtError = attention_deadline",
      ...semanticsAvailable,
      "Semantics: Thought did not complete this turn (attention_deadline), so inspection could not be requested or executed. This is this-turn execution unavailability, not a wording problem and not proof that the inspection capability is inactive. Do not invite the user to ask for inspection as if they had not already asked. Do not claim an inspection occurred.",
    ].join("\n");
  }
  return [
    "Project inspection evidence:",
    availableLine,
    "inspectionStatus = not_performed",
    "verifiedRepositoryEvidence = false",
    ...semanticsAvailable,
    capabilityAvailable
      ? "Semantics: capabilityAvailable = true with inspectionStatus = not_performed means Ashley CAN inspect approved projects but did not inspect this turn; this is not an inability and must never be expressed as one."
      : "Semantics: Ashley cannot inspect this turn because the inspection capability is not active; this is the only case in which an inspection inability may be expressed.",
  ].join("\n");
}

const M3_MUTATING_OPERATIONS = new Set([
  "workspace.write_file",
  "workspace.replace_file",
  "workspace.edit_text",
  "workspace.delete_file",
  "workspace.create_directory",
]);

/**
 * Structured current-turn candidate-workspace evidence state for Expression.
 * Always present. Two orthogonal dimensions:
 * - capabilityAvailable: authoritative current capability state (can Ashley
 *   offer a candidate workspace at all this turn); derived from
 *   canOfferCandidateWorkspace;
 * - workspaceStatus: what Ashley actually did or observed this turn
 *   (not_performed / verified_success / failed).
 *
 * Verified success is candidate-workspace evidence only. It never licenses a
 * live-repository mutation claim.
 */
export function candidateWorkspaceEvidenceBlock(
  license: OperationalClaimLicense | null | undefined,
  observation: WorkspaceExperimentObservation | null | undefined,
  options: { capabilityAvailable?: boolean } = {},
): string {
  const capabilityAvailable = options.capabilityAvailable === true;
  const availableLine = `capabilityAvailable = ${capabilityAvailable}`;
  const semanticsAvailable = [
    "Semantics: capabilityAvailable is the authoritative current capability state; workspaceStatus is what Ashley actually did or observed this turn.",
  ];
  if (license?.profile === "project_experimentation") {
    const truth = deriveOperationalTruth(license);
    if (truth.state === "verified_success" && observation) {
      const candidateChanged = M3_MUTATING_OPERATIONS.has(observation.operation);
      return [
        "Candidate workspace evidence:",
        availableLine,
        "workspaceStatus = verified_success",
        "verifiedWorkspaceEffect = true",
        `candidateWorkspaceChanged = ${candidateChanged}`,
        "liveRepositoryUnchanged = true",
        ...semanticsAvailable,
        "Semantics: Ashley executed a candidate workspace operation this turn and holds verified evidence.",
        candidateChanged
          ? "Semantics: the private candidate workspace changed; the live repository did not."
          : "Semantics: this verified candidate-workspace observation did not mutate the live repository.",
      ].join("\n");
    }
    if (license.state === "failed") {
      return [
        "Candidate workspace evidence:",
        availableLine,
        "workspaceStatus = failed",
        "verifiedWorkspaceEffect = false",
        "liveRepositoryUnchanged = true",
        license.error ? `error = ${license.error}` : "error = unknown",
        ...semanticsAvailable,
        "Semantics: this turn's workspace attempt failed; the failure is about this attempt, not about capability.",
        "Semantics: a failed candidate-workspace attempt is not live-repository mutation.",
      ].join("\n");
    }
  }
  return [
    "Candidate workspace evidence:",
    availableLine,
    "workspaceStatus = not_performed",
    "verifiedWorkspaceEffect = false",
    ...semanticsAvailable,
    capabilityAvailable
      ? "Semantics: capabilityAvailable = true with workspaceStatus = not_performed means Ashley CAN offer a candidate workspace this turn but did not; this is not an inability and must never be expressed as one."
      : "Semantics: Ashley cannot offer a candidate workspace this turn because the workspace capability is not active or candidateWorkspaceAllowed is closed; this is the only case in which a workspace inability may be expressed.",
  ].join("\n");
}

/**
 * Structured current-turn candidate-verification evidence for Expression.
 * Always present. Licensed facts are mechanical recipe outcomes only.
 */
export function candidateVerificationEvidenceBlock(
  license: OperationalClaimLicense | null | undefined,
  options: { capabilityAvailable?: boolean } = {},
): string {
  const capabilityAvailable = options.capabilityAvailable === true;
  const availableLine = `capabilityAvailable = ${capabilityAvailable}`;
  const semanticsAvailable = [
    "Semantics: capabilityAvailable is the authoritative current capability state; verificationStatus is what Ashley actually did or observed this turn.",
    "Semantics: a licensed verification outcome is a mechanical recipe result for a named snapshot. It is not engineering judgment, quality, approval, merge, deployment, or self-improvement.",
  ];
  if (license?.profile === "candidate_verification") {
    const truth = deriveOperationalTruth(license);
    if (
      (truth.state === "verified_success" || truth.state === "verified_failure") &&
      license.verificationClaimEffect
    ) {
      const effect = license.verificationClaimEffect;
      return [
        "Candidate verification evidence:",
        availableLine,
        `verificationStatus = ${effect.verificationOutcome}`,
        `recipeId = ${effect.recipeId}`,
        `recipeVersion = ${effect.recipeVersion}`,
        `snapshotId = ${effect.snapshotId}`,
        `candidateTreeHash = ${effect.candidateTreeHash}`,
        `verificationOutcome = ${effect.verificationOutcome}`,
        ...semanticsAvailable,
        `Semantics: the verification recipe completed with outcome ${effect.verificationOutcome} for snapshot ${effect.snapshotId}.`,
      ].join("\n");
    }
    if (license.state === "outcome_unknown" || license.error === "outcome_unknown") {
      return [
        "Candidate verification evidence:",
        availableLine,
        "verificationStatus = outcome_unknown",
        "verifiedMechanicalOutcome = false",
        "error = outcome_unknown",
        ...semanticsAvailable,
        "Semantics: the verification observer timed out or the recipe postcondition is unknown. Do not describe this as a recipe failure.",
      ].join("\n");
    }
    if (license.error === "sandbox_failure") {
      return [
        "Candidate verification evidence:",
        availableLine,
        "verificationStatus = outcome_unknown",
        "protocolState = sandbox_failure",
        "verifiedMechanicalOutcome = false",
        "error = sandbox_failure",
        ...semanticsAvailable,
        "Semantics: verification protocol ended in sandbox_failure. Recipe outcome is unknown, not verified_failure.",
      ].join("\n");
    }
    if (license.error) {
      return [
        "Candidate verification evidence:",
        availableLine,
        "verificationStatus = refused",
        "verifiedMechanicalOutcome = false",
        `error = ${license.error}`,
        ...semanticsAvailable,
        "Semantics: this turn did not produce a licensed mechanical verification claim.",
      ].join("\n");
    }
  }
  return [
    "Candidate verification evidence:",
    availableLine,
    "verificationStatus = not_performed",
    "verifiedMechanicalOutcome = false",
    ...semanticsAvailable,
    capabilityAvailable
      ? "Semantics: capabilityAvailable = true with verificationStatus = not_performed means Ashley CAN run an admitted verification recipe this turn but did not; this is not an inability and must never be expressed as one."
      : "Semantics: Ashley cannot run candidate verification this turn because candidate_verification is not active or verificationAllowed/recipe allowlist is closed.",
  ].join("\n");
}

/**
 * Structured current-turn candidate-authorship evidence for Expression.
 * Always present. Licensed facts are sealed advisory change-sets only.
 */
export function candidateAuthorshipEvidenceBlock(
  license: OperationalClaimLicense | null | undefined,
  options: { capabilityAvailable?: boolean } = {},
): string {
  const capabilityAvailable = options.capabilityAvailable === true;
  const availableLine = `capabilityAvailable = ${capabilityAvailable}`;
  const semanticsAvailable = [
    "Semantics: capabilityAvailable is the authoritative current capability state; authorshipStatus is what Ashley actually did or observed this turn.",
    "Semantics: a licensed authorship outcome is a sealed advisory candidate change-set. It is not apply, merge, deployment, Identity change, or self-improvement.",
  ];
  if (license?.profile === "candidate_authorship") {
    const truth = deriveOperationalTruth(license);
    if (truth.state === "verified_success" && license.authorshipClaimEffect) {
      const effect = license.authorshipClaimEffect;
      return [
        "Candidate authorship evidence:",
        availableLine,
        "authorshipStatus = proposed",
        `changesetId = ${effect.changesetId}`,
        `snapshotId = ${effect.snapshotId}`,
        `candidateTreeHash = ${effect.candidateTreeHash}`,
        `baseTreeHash = ${effect.baseTreeHash}`,
        `reviewStatus = ${effect.reviewStatus}`,
        ...semanticsAvailable,
        "Semantics: this named candidate change-set was sealed against this named base as advisory candidate work. It has not been applied.",
      ].join("\n");
    }
    if (license.error) {
      return [
        "Candidate authorship evidence:",
        availableLine,
        "authorshipStatus = refused",
        "sealedAdvisoryChangeset = false",
        `error = ${license.error}`,
        ...semanticsAvailable,
        "Semantics: this turn did not produce a licensed sealed candidate change-set.",
      ].join("\n");
    }
  }
  return [
    "Candidate authorship evidence:",
    availableLine,
    "authorshipStatus = not_performed",
    "sealedAdvisoryChangeset = false",
    ...semanticsAvailable,
    capabilityAvailable
      ? "Semantics: capabilityAvailable = true with authorshipStatus = not_performed means Ashley CAN seal an admitted candidate change-set this turn but did not; this is not an inability and must never be expressed as one."
      : "Semantics: Ashley cannot seal a candidate change-set this turn because candidate_authorship is not active or authorshipAllowed is closed.",
  ].join("\n");
}

export function boundedOperationEvidenceBlock(
  license: OperationalClaimLicense | null | undefined,
  options: { capabilityAvailable?: boolean } = {},
): string {
  const capabilityAvailable = options.capabilityAvailable === true;
  const availableLine = `capabilityAvailable = ${capabilityAvailable}`;
  const semantics = [
    "Semantics: capabilityAvailable is the authoritative current M6 grant; operationStatus is what actually ran.",
    "Semantics: a licensed bounded operation is a finite admitted M3/M4/M5 sequence. It is not apply, export, deploy, or a second Agency.",
  ];
  if (license?.profile === "bounded_operation") {
    const effect = license.boundedOperationClaimEffect;
    if (effect) {
      return [
        "Bounded operation evidence:",
        availableLine,
        `operationStatus = ${effect.stopReason}`,
        `stepsExecuted = ${effect.stepsExecuted}`,
        `maxSteps = ${effect.maxSteps}`,
        "borderState = none",
        "applied = false",
        "exported = false",
        ...semantics,
        effect.stopReason === "succeeded"
          ? "Semantics: the admitted finite sequence completed. No border effect was performed."
          : `Semantics: the admitted sequence stopped because ${effect.stopReason}. No border effect was performed.`,
      ].join("\n");
    }
    if (license.error) {
      return [
        "Bounded operation evidence:",
        availableLine,
        "operationStatus = refused",
        `error = ${license.error}`,
        ...semantics,
      ].join("\n");
    }
  }
  return [
    "Bounded operation evidence:",
    availableLine,
    "operationStatus = not_performed",
    ...semantics,
    capabilityAvailable
      ? "Semantics: M6 is offerable this turn but no bounded operation ran."
      : "Semantics: Ashley cannot run a bounded operation this turn because bounded_operation is not active or operationAllowed is closed.",
  ].join("\n");
}

export function patchExportEvidenceBlock(
  license: OperationalClaimLicense | null | undefined,
  options: { capabilityAvailable?: boolean } = {},
): string {
  const capabilityAvailable = options.capabilityAvailable === true;
  const availableLine = `capabilityAvailable = ${capabilityAvailable}`;
  const semantics = [
    "Semantics: capabilityAvailable is the authoritative current M7 grant; exportStatus is what actually ran.",
    "Semantics: a licensed patch_export is a witnessed copy of a sealed M5 artifact to the operator review location. It is not apply, merge, Git, deploy, or Ashley.",
  ];
  if (license?.profile === "patch_export") {
    const effect = license.patchExportClaimEffect;
    if (effect) {
      return [
        "Patch export evidence:",
        availableLine,
        "exportStatus = witnessed",
        `changesetId = ${effect.changesetId}`,
        `destinationRelativeName = ${effect.destinationRelativeName}`,
        `witnessedSha256 = ${effect.witnessedSha256}`,
        "applied = false",
        "liveUnwritten = true",
        "gitUnwritten = true",
        ...semantics,
        "Semantics: the sealed candidate artifact was copied to the operator review location. It has not been applied.",
      ].join("\n");
    }
    if (license.error) {
      return [
        "Patch export evidence:",
        availableLine,
        "exportStatus = refused",
        `error = ${license.error}`,
        ...semantics,
      ].join("\n");
    }
  }
  return [
    "Patch export evidence:",
    availableLine,
    "exportStatus = not_performed",
    ...semantics,
    capabilityAvailable
      ? "Semantics: M7 patch_export is offerable this turn but no export ran."
      : "Semantics: Ashley cannot export a patch this turn because patch_export is not active or patchExportAllowed is closed.",
  ].join("\n");
}

/**
 * ContextComposer — sole owner of turn context assembly.
 * Assembles existing peer outputs; does not reinterpret, score, or rewrite them.
 * Omitting an empty peer section is assembly, not filtering.
 */
export function composeTurnContext(
  db: DatabaseSync,
  ownerId: string,
  input: ComposeTurnContextInput,
): TurnContext {
  const decision = input.decision;
  const evidenceRefs = [
    ...(decision?.evidenceRefs ?? []),
    ...(input.evidenceRefs ?? []),
  ];
  const memory = assembleMemoryBlock(db, ownerId, {
    userMessage: input.userMessage,
    excludeMessageId: input.excludeMessageId ?? null,
    evidenceRefs,
  });
  const identity = stableIdentityBlock(db, ownerId);
  const mindState = mindStateBlock(db, ownerId);
  const operational = operationalWorkBlock(db, ownerId, {
    operationalLicense: decision?.operationalLicense,
    inspectionObservation: decision?.inspectionObservation,
  });
   const inspectionEvidence = projectInspectionEvidenceBlock(
     decision?.operationalLicense,
     decision?.inspectionObservation,
     {
       capabilityAvailable: canOfferProjectInspection(db),
       interpretationAvailable: Boolean(decision?.inspectionCognitiveResult),
       thoughtCompleted: decision?.thoughtSource === "model",
       thoughtError: decision?.thoughtError ?? null,
     },
   );
   const workspaceEvidence = candidateWorkspaceEvidenceBlock(
     decision?.operationalLicense,
      decision?.operationalObservation &&
      "kind" in decision.operationalObservation &&
      decision.operationalObservation.kind === "workspace_experiment_observation"
        ? decision.operationalObservation
        : null,
     {
       capabilityAvailable: canOfferCandidateWorkspace(db),
     },
   );
   const verificationEvidence = candidateVerificationEvidenceBlock(
     decision?.operationalLicense,
     {
       capabilityAvailable: canOfferCandidateVerification(db),
     },
   );
   const authorshipEvidence = candidateAuthorshipEvidenceBlock(
     decision?.operationalLicense,
     {
       capabilityAvailable: canOfferCandidateAuthorship(db),
     },
   );
   const operationEvidence = boundedOperationEvidenceBlock(
     decision?.operationalLicense,
     {
       capabilityAvailable: canOfferBoundedOperation(db),
     },
   );
   const exportEvidence = patchExportEvidenceBlock(
     decision?.operationalLicense,
     {
       capabilityAvailable: canOfferPatchExport(db),
     },
   );
  // Questions only when Thought selected question evidence or none selected yet
  // would dump — skip global question dump; selected questions arrive via evidence.
  const questions = "";
  void buildQuestionsBlock;
  const staticPrompt = loadNuclearSystemPrompt(input.channel);

  const peerSections = [
    identity,
    memory.memoryBlock
      ? `## Memory context\n${memory.memoryBlock}`
      : "",
    mindState,
    operational,
    inspectionEvidence,
    workspaceEvidence,
    verificationEvidence,
    authorshipEvidence,
    operationEvidence,
    exportEvidence,
    questions,
  ].filter(Boolean);

  const systemPrompt = [staticPrompt, ...peerSections].join("\n\n");
  const decisionPrompt = decision ? structuredDecisionPrompt(decision) : "";

  return {
    threadId: memory.threadId,
    hotMessages: memory.hotMessages,
    facts: memory.facts,
    memoryBlock: memory.memoryBlock,
    systemPrompt,
    decisionPrompt,
  };
}
