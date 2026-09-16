/** Host operational status messages. Nothing here speaks for Ashley. */
export function agentErrorMessage(
  code?: string,
  retryAfterSec?: number,
): string {
  switch (code) {
    case "agent_not_ready":
      return "System status: agent is not ready. Try again shortly.";
    case "mistral_unavailable":
      return retryAfterSec
        ? `System status: response service is unavailable. Try again in about ${retryAfterSec}s.`
        : "System status: response service is unavailable. Try again shortly.";
    case "rate_limited":
      return retryAfterSec
        ? `System status: request rate limit reached. Try again in about ${retryAfterSec}s.`
        : "System status: request rate limit reached. Try again shortly.";
    case "message_too_long":
      return "System status: message exceeds the allowed length.";
    case "forbidden":
      return "System status: request is not authorized.";
    case "chat_in_progress":
      return "System status: a previous request is still in progress. Try again shortly.";
    case "agent_timeout":
      return "System status: request timed out. Try again.";
    case "internal_error":
      return "System status: request failed. Try again.";
    default:
      return "System status: request could not be completed. Try again.";
  }
}
