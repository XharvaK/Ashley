/**
 * Empty sendable text: one silent agent retry, then the fumble bank.
 * attempt is 0-based (0 = first reply, 1 = after retry).
 */
export function emptyReplyAction(attempt: number): "retry" | "fumble" {
  return attempt < 1 ? "retry" : "fumble";
}
