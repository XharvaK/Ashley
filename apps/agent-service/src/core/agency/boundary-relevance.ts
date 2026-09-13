import type { Motivation } from "../types.js";

const CUE_RE =
  /\b(?:secret|password|token|api[_ -]?key|private key|cookie|credential|delete|wipe|erase|force me|make me|you must|obey|ignore (?:your )?boundaries|bypass|without consent|nonconsensual|coerc(?:e|ion)|blackmail|threaten|harm|hurt yourself|kill|suicide|overdose|illegal|steal)\b/i;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9à-ÿ]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}

function lexicalOverlap(message: string, boundaryText: string): boolean {
  const messageTokens = tokenize(message);
  if (messageTokens.size === 0) return false;
  const boundaryTokens = tokenize(boundaryText);
  let hits = 0;
  for (const token of boundaryTokens) {
    if (messageTokens.has(token)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

/**
 * License a stable boundary for this turn only when cues or overlap apply.
 * Presence of boundaries in the motivation pool is not enough.
 */
export function isBoundaryRelevant(
  userMessage: string,
  boundarySummary: string,
): boolean {
  const message = userMessage.trim();
  if (!message) return false;
  if (CUE_RE.test(message)) return true;
  return lexicalOverlap(message, boundarySummary);
}

/** Filter boundary motivations to those relevance-licensed for the message. */
export function selectRelevantBoundaries(
  userMessage: string,
  motivations: Motivation[],
): Motivation[] {
  return motivations.filter(
    (item) =>
      item.kind === "boundary" &&
      isBoundaryRelevant(userMessage, item.summary),
  );
}

export function relevantBoundaryIdSet(
  userMessage: string,
  motivations: Motivation[],
): Set<number> {
  return new Set(
    selectRelevantBoundaries(userMessage, motivations)
      .map((item) => item.id)
      .filter((id): id is number => id !== undefined),
  );
}
