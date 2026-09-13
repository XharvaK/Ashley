const READ_VERB_RE =
  /\b(?:read|open|check|look at|look through|skim|browse|visit|see what's on|see whats on)\b/i;

const EXPLICIT_READ_PHRASES = [
  /\bread this (?:page|link|url|site|article)\b/i,
  /\blook at this (?:page|link|url|site|article)\b/i,
  /\bcheck (?:this|out) (?:page|link|url|site)\b/i,
  /\bcan you read (?:this|the) (?:page|link|url|site|article)\b/i,
  /\bplease read (?:this|the) (?:page|link|url|site|article)\b/i,
  /\bwhat(?:'s| is) on (?:this|the) (?:page|link|url|site)\b/i,
];

const URL_RE =
  /https?:\/\/[^\s<>"'`]+/i;

export type ResearchIntentResult =
  | { intent: true; url: string }
  | { intent: false };

function normalizeUrl(raw: string): string {
  return raw.replace(/[),.!?]+$/g, "").trim();
}

export function classifyResearchIntent(message: string): ResearchIntentResult {
  const text = message.trim();
  if (!text) return { intent: false };
  const urlMatch = text.match(URL_RE);
  if (!urlMatch) return { intent: false };
  const url = normalizeUrl(urlMatch[0] ?? "");
  if (!url) return { intent: false };

  const explicitPhrase = EXPLICIT_READ_PHRASES.some((pattern) => pattern.test(text));
  const urlWithReadVerb = READ_VERB_RE.test(text);
  if (!explicitPhrase && !urlWithReadVerb) {
    return { intent: false };
  }
  return { intent: true, url };
}

export function extractFirstUrl(message: string): string | null {
  const match = message.trim().match(URL_RE);
  if (!match?.[0]) return null;
  return normalizeUrl(match[0]);
}
