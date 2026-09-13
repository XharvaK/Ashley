import {
  isVerifiedRoundtripEffectEvidence,
  isVerifiedVerificationClaimEffect,
  isVerifiedAuthorshipClaimEffect,
  isVerifiedBoundedOperationClaimEffect,
  isVerifiedPatchExportClaimEffect,
  isVerifiedWorkspaceClaimEffect,
  type OperationalClaimLicense,
} from "./engineering-types.js";

export type OperationalTruthState =
  | "none"
  | "admitted"
  | "running"
  | "verified_success"
  | "verified_failure"
  | "failed"
  | "outcome_unknown";

export type OperationalTruth = {
  state: OperationalTruthState;
  locked: boolean;
  profile?: string | null;
  taskId?: string | null;
  error?: string | null;
  refusalReason?: string | null;
  semanticOutput?: string | null;
  snapshotId?: string | null;
  workspaceId?: string | null;
  candidateTreeHash?: string | null;
  recipeId?: string | null;
  recipeVersion?: string | null;
  recipeDefinitionHash?: string | null;
  verificationOutcome?: "verified_success" | "verified_failure" | null;
};

/**
 * Derives the single authoritative deterministic operational truth from an
 * OperationalClaimLicense.
 *
 * Precedence:
 *   verified current-turn effect
 *     > current OperationalClaimLicense
 *     > general capability self-model
 *     > Expression / model inference
 */
export function deriveOperationalTruth(
  license: OperationalClaimLicense | undefined | null,
): OperationalTruth {
  if (!license) {
    return { state: "none", locked: false };
  }

  if (license.refusalReason) {
    const semanticOutput = `i haven't started that check because the sandbox admission was refused: ${license.refusalReason}.`;
    return {
      state: "none",
      locked: true,
      profile: license.profile,
      taskId: license.taskId,
      refusalReason: license.refusalReason,
      semanticOutput,
    };
  }

  if (license.profile === "sandbox_workspace_file_roundtrip") {
    switch (license.state) {
      case "succeeded":
        if (isVerifiedRoundtripEffectEvidence(license.effectEvidence)) {
          return {
            state: "verified_success",
            locked: true,
            profile: license.profile,
            taskId: license.taskId,
            semanticOutput:
              "the sandbox workspace check completed and the roundtrip verified.",
          };
        }
        // Succeeded state without verified effect evidence fails closed
        return {
          state: "none",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
        };

      case "failed":
        return {
          state: "failed",
          locked: true,
          profile: license.profile,
          taskId: license.taskId,
          error: license.error ?? null,
          semanticOutput: `the sandbox check was attempted but failed${license.error ? `: ${license.error}.` : "."}`,
        };

      case "outcome_unknown":
        return {
          state: "outcome_unknown",
          locked: true,
          profile: license.profile,
          taskId: license.taskId,
          semanticOutput: "the sandbox check outcome is unknown after restart.",
        };

      case "admitted":
        return {
          state: "admitted",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
          semanticOutput: "i've accepted that sandbox check and it's queued to run.",
        };

      case "running":
        return {
          state: "running",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
          semanticOutput: "i'm currently running that check in the sandbox.",
        };

      case "proposed":
      case "none":
      default:
        return {
          state: "none",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
          error: license.error ?? null,
        };
    }
  }

  if (license.profile === "project_investigation") {
    switch (license.state) {
      case "succeeded":
        return {
          state: "verified_success",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
        };

      case "failed":
        return {
          state: "failed",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
          error: license.error ?? null,
        };

      case "none":
      default:
        return {
          state: "none",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
          error: license.error ?? null,
        };
    }
  }

  if (license.profile === "project_experimentation") {
    switch (license.state) {
      case "succeeded":
        if (isVerifiedWorkspaceClaimEffect(license.workspaceClaimEffect)) {
          return {
            state: "verified_success",
            locked: false,
            profile: license.profile,
            taskId: license.taskId,
          };
        }
        return {
          state: "none",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
        };

      case "failed":
        return {
          state: "failed",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
          error: license.error ?? null,
        };

      case "none":
      default:
        return {
          state: "none",
          locked: false,
          profile: license.profile,
          taskId: license.taskId,
          error: license.error ?? null,
        };
    }
  }

  if (license.profile === "candidate_verification") {
    if (
      license.state === "succeeded" &&
      isVerifiedVerificationClaimEffect(license.verificationClaimEffect)
    ) {
      const effect = license.verificationClaimEffect;
      return {
        state: effect.verificationOutcome,
        locked: true,
        profile: license.profile,
        taskId: license.taskId,
        snapshotId: effect.snapshotId,
        workspaceId: effect.workspaceId,
        candidateTreeHash: effect.candidateTreeHash,
        recipeId: effect.recipeId,
        recipeVersion: effect.recipeVersion,
        recipeDefinitionHash: effect.recipeDefinitionHash,
        verificationOutcome: effect.verificationOutcome,
        semanticOutput:
          `recipe ${effect.recipeId} version ${effect.recipeVersion} produced ${effect.verificationOutcome} against snapshot ${effect.snapshotId}.`,
      };
    }
    if (license.state === "outcome_unknown" || license.error === "outcome_unknown") {
      return {
        state: "outcome_unknown",
        locked: true,
        profile: license.profile,
        taskId: license.taskId,
        error: "outcome_unknown",
        semanticOutput:
          "the verification observer timed out; recipe postcondition is unknown.",
      };
    }
    if (license.error === "sandbox_failure") {
      return {
        state: "failed",
        locked: true,
        profile: license.profile,
        taskId: license.taskId,
        error: "sandbox_failure",
        semanticOutput:
          "verification protocol ended in sandbox_failure; recipe outcome is unknown.",
      };
    }
    return {
      state: "none",
      locked: false,
      profile: license.profile,
      taskId: license.taskId,
      error: license.error ?? null,
    };
  }

  if (license.profile === "candidate_authorship") {
    if (
      license.state === "succeeded" &&
      isVerifiedAuthorshipClaimEffect(license.authorshipClaimEffect)
    ) {
      const effect = license.authorshipClaimEffect;
      return {
        state: "verified_success",
        locked: true,
        profile: license.profile,
        taskId: license.taskId,
        snapshotId: effect.snapshotId,
        workspaceId: effect.workspaceId,
        candidateTreeHash: effect.candidateTreeHash,
        semanticOutput:
          `named candidate change-set ${effect.changesetId} was sealed against this named base as advisory candidate work. it has not been applied.`,
      };
    }
    return {
      state: "none",
      locked: false,
      profile: license.profile,
      taskId: license.taskId,
      error: license.error ?? null,
    };
  }

  if (license.profile === "bounded_operation") {
    if (
      (license.state === "succeeded" || license.state === "failed") &&
      isVerifiedBoundedOperationClaimEffect(license.boundedOperationClaimEffect)
    ) {
      const effect = license.boundedOperationClaimEffect;
      const semanticOutput =
        effect.stopReason === "succeeded"
          ? `completed ${effect.stepsExecuted} admitted sandbox operations toward the named objective. no border effect was performed.`
          : `stopped after ${effect.stepsExecuted} of ${effect.maxSteps} admitted sandbox operations because ${effect.stopReason}. no border effect was performed.`;
      return {
        state: effect.stopReason === "succeeded" ? "verified_success" : "failed",
        locked: true,
        profile: license.profile,
        taskId: license.taskId,
        workspaceId: effect.workspaceId,
        semanticOutput,
      };
    }
    return {
      state: "none",
      locked: false,
      profile: license.profile,
      taskId: license.taskId,
      error: license.error ?? null,
    };
  }

  if (license.profile === "patch_export") {
    if (
      license.state === "succeeded" &&
      isVerifiedPatchExportClaimEffect(license.patchExportClaimEffect)
    ) {
      const effect = license.patchExportClaimEffect;
      return {
        state: "verified_success",
        locked: true,
        profile: license.profile,
        taskId: license.taskId,
        semanticOutput:
          `copied sealed candidate change-set ${effect.changesetId} to the operator review location as ${effect.destinationRelativeName}. the export was witnessed by digest ${effect.witnessedSha256}. it has not been applied.`,
      };
    }
    if (license.state === "outcome_unknown") {
      return {
        state: "outcome_unknown",
        locked: true,
        profile: license.profile,
        taskId: license.taskId,
        error: license.error ?? "outcome_unknown",
        semanticOutput:
          "patch export commit may have occurred and the effect witness is missing or conflicting; the outcome is unknown and was not repeated.",
      };
    }
    return {
      state: "none",
      locked: false,
      profile: license.profile,
      taskId: license.taskId,
      error: license.error ?? null,
    };
  }

  return {
    state: "none",
    locked: false,
    profile: license.profile,
    taskId: license.taskId,
    error: license.error ?? null,
  };
}

export function renderOperationalTruth(truth: OperationalTruth): string | null {
  return truth.semanticOutput ?? null;
}
