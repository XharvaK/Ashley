const MARKER_RE = /\[\[(?:react|gif|react-only):[^\]]*\]\]/gi;

/**
 * Remove delivery markers from assistant text before it is persisted.
 *
 * The bot needs them at send time, but hot history is replayed into the next
 * prompt, so persisting them raw teaches her that `[[gif:...]]` is part of how
 * she talks. Telegram has no parser and would print them literally.
 */
export function stripMediaMarkers(text: string): string {
  return text
    .replace(MARKER_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
