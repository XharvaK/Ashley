export type ErrorCode =
  | "message_required"
  | "invalid_channel"
  | "invalid_json"
  | "bad_request"
  | "forbidden"
  | "chat_in_progress"
  | "message_too_long"
  | "rate_limited"
  | "quota_exhausted"
  | "credential_invalid"
  | "mistral_unavailable"
  | "provider_unavailable"
  | "timeout"
  | "capability_mismatch"
   | "agent_not_ready"
  | "route_disabled"
  | "operator_disabled"
  | "initiative_skipped"
  | "channel_retired"
  | "endpoint_retired"
  | "not_found"
  | "internal_error"
  | "unknown_approval_proposal"
  | "approval_owner_mismatch"
  | "approval_capability_missing"
  | "approval_invalid_risk_class"
  | "approval_no_target_paths"
  | "approval_too_many_target_paths"
  | "approval_invalid_path_intent"
  | "approval_invalid_persistence"
  | "approval_network_mode_unsupported"
  | "approval_policy_unbound"
  | "approval_not_approvable"
  | "approval_not_rejectable"
  | "approval_not_withdrawable"
  | "approval_not_staleable"
  | "approval_not_resumable"
  | "approval_update_failed"
  | "approval_session_unbound"
  | "approval_stale_policy"
  | "owner_approval_key_unavailable"
  | "broker_client_unavailable"
  | "policy_unavailable"
  | "unknown_session"
  | "session_not_awaiting_owner"
  | "context_allocation_required_overflow";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSec?: number;
  /** Provider-account versus provider-wide failure classification. */
  readonly credentialFailureDomain?: "account" | "provider";

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    retryAfterSec?: number,
    credentialFailureDomain?: "account" | "provider",
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterSec = retryAfterSec;
    this.credentialFailureDomain = credentialFailureDomain;
  }
}

export function toErrorResponse(err: unknown): {
  status: number;
  body: { error: string; code: string; retryAfterSec?: number };
} {
  if (err instanceof AppError) {
    return {
      status: err.httpStatus,
      body: {
        error: err.message,
        code: err.code,
        ...(err.retryAfterSec !== undefined
          ? { retryAfterSec: err.retryAfterSec }
          : {}),
      },
    };
  }
  console.error("[agent-service] unhandled:", err);
  return {
    status: 500,
    body: { error: "Internal server error", code: "internal_error" },
  };
}
