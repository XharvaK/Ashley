import {
  claimsOwnConversationalReadActivity,
  claimsOwnReadingActivity,
  stripQuotedHypotheticals,
} from "../../honesty/claims.js";

const CURRENTNESS_PATTERNS = [
  /\b(?:currently|right now|as of now)\s*,?\s*(?:the|this|that|it|our|your|status|state|version|update|result|build|deployment|service|system|task|test|check)\b[^.!?]{0,120}\b(?:is|are|remains|stands|shows|says|has|have)\b/i,
  /\b(?:the|this|that|our|your)\s+(?:latest|most recent|current)\s+(?:status|state|version|update|result|build|deployment|file|message|release|report|data|service|system|task|test|check)\b[^.!?]{0,120}\b(?:is|are|was|were|shows|says|looks|remains|stands|has|have)\b/i,
  /\b(?:the|this|that|our|your)\s+(?:status|state|version|update|result|build|deployment|file|message|release|report|data|service|system|task|test|check)\b[^.!?]{0,120}\b(?:currently|right now|as of now)\b/i,
  /\b(?:today|this morning|this week|this month)\b\s*,?\s*(?:the|this|that|our|your)\s+(?:status|state|version|update|result|build|deployment|service|system|task|test|check)\b[^.!?]{0,100}\b(?:is|are|was|were|shows|says|remains|stands)\b/i,
];

export function claimsCurrentness(text: string): boolean {
  const clean = stripQuotedHypotheticals(text)
    .replace(/\b(?:they|he|she|you|someone|the user)\s+(?:said|says|mentioned|reported|claimed|asked|wrote)\b[^.!?]*(?:[.!?]|$)/gi, " ")
    .replace(/\b(?:i|we)\s+(?:do not|don't|cannot|can't|can not|never)\s+(?:claim|say|pretend|mean|have|know)\b[^.!?]*(?:[.!?]|$)/gi, " ");
  return clean
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .some((segment) => CURRENTNESS_PATTERNS.some((pattern) => pattern.test(segment)));
}

export function claimsUnwitnessedReading(text: string): boolean {
  return claimsOwnReadingActivity(text) || claimsOwnConversationalReadActivity(text);
}
