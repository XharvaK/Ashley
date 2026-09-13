import { EXIT_CODES } from "./exit-codes.js";

export type DiscordFailureDisposition =
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

export function classifyDiscordStartupError(err: unknown): DiscordFailureDisposition {
  if (err && typeof err === "object") {
    const code = (err as { code?: string }).code;
    const msg = err instanceof Error ? err.message : String(err);

    // Proven machine-readable configuration failure
    if (code === "config_missing") {
      return {
        kind: "OPERATOR_REQUIRED",
        exitCode: EXIT_CODES.OPERATOR_REQUIRED,
        code: "config_missing",
        message: msg,
      };
    }
  }

  // Guardrail 4 & R5: All unproven / runtime errors default to RETRYABLE
  return {
    kind: "RETRYABLE",
    exitCode: EXIT_CODES.TRANSIENT,
    code:
      err && typeof err === "object" && typeof (err as { code?: string }).code === "string"
        ? (err as { code: string }).code
        : "UNRECOGNIZED_DISCORD_STARTUP_ERROR",
    message: err instanceof Error ? err.message : String(err),
  };
}
