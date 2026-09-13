/**
 * User-facing errors in her voice. Nothing here names infra services or vendors.
 */
export function agentErrorMessage(
  code?: string,
  retryAfterSec?: number,
): string {
  switch (code) {
    case "agent_not_ready":
      return "I'm offline right now. Give me a minute and try again.";
    case "mistral_unavailable":
      return retryAfterSec
        ? `My brain's unreachable right now — I'll be able to answer in about ${retryAfterSec}s.`
        : "My brain's unreachable right now. Try again in a bit.";
    case "rate_limited":
      return retryAfterSec
        ? `I'm getting rate-limited — try again in about ${retryAfterSec}s.`
        : "I'm getting rate-limited — try again in a minute.";
    case "message_too_long":
      return "That message is too long for me.";
    case "forbidden":
      return "Not authorized.";
    case "chat_in_progress":
      return "Still on the last one — give me a sec.";
    case "agent_timeout":
      return "That took too long — try again?";
    case "internal_error":
      return "I glitched on that one — try again?";
    default:
      return "Something went wrong on my end. Try again?";
  }
}
