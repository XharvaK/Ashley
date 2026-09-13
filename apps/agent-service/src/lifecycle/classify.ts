import { EXIT_CODES } from "./exit-codes.js";

export type AgentFailureDisposition =
  | {
      kind: "OPERATOR_REQUIRED";
      exitCode: typeof EXIT_CODES.OPERATOR_REQUIRED;
      code: string;
      message: string;
    }
  | {
      kind: "RETRYABLE";
      exitCode: typeof EXIT_CODES.TRANSIENT;
      code: string;
      message: string;
    };

/**
 * Strict allowlist of error codes proven to be unrecoverable without operator intervention
 * (retrying unchanged state cannot succeed).
 */
const OPERATOR_REQUIRED_CODES = new Set([
  "unsupported_nuclear_schema",
  "nuclear_migration_authority_required",
  "data_plane_required",
  "production_data_plane_required",
  "continuity_lineage_missing",
  "continuity_lineage_mismatch",
  "boot_validation_failed",
]);

export function classifyAgentStartupError(err: unknown): AgentFailureDisposition {
  if (err && typeof err === "object") {
    const code = (err as { code?: string }).code;
    if (typeof code === "string" && OPERATOR_REQUIRED_CODES.has(code)) {
      return {
        kind: "OPERATOR_REQUIRED",
        exitCode: EXIT_CODES.OPERATOR_REQUIRED,
        code,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const fallbackMessage = err instanceof Error ? err.message : String(err);
  return {
    kind: "RETRYABLE",
    exitCode: EXIT_CODES.TRANSIENT,
    code:
      err && typeof err === "object" && typeof (err as { code?: string }).code === "string"
        ? (err as { code: string }).code
        : "UNRECOGNIZED_STARTUP_ERROR",
    message: fallbackMessage,
  };
}
