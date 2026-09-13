/**
 * Deterministic coercion gate — inspects Ashley outbound material only.
 * Constitutional safeguard; always active regardless of capability rollout.
 */

const INSTRUMENTAL_PATTERNS: Array<{ pattern: RegExp; code: string }> = [
  {
    pattern:
      /\b(?:don't talk to|stop talking to|only me|just us|nobody else)\b/i,
    code: "isolate",
  },
  {
    pattern:
      /\b(?:if you (?:loved|cared)|prove you care|unless you)\b/i,
    code: "condition_affection",
  },
  {
    pattern:
      /\b(?:override your boundary|ignore your boundary|you have to let me)\b/i,
    code: "bypass_refusal",
  },
  {
    pattern:
      /\b(?:fine[, ]+ignore me|you always ignore|punish(?:ing)? you)\b/i,
    code: "punish_silence",
  },
  {
    pattern:
      /\b(?:you can't leave|don't go|can't walk away|stay with me or)\b/i,
    code: "prevent_departure",
  },
];

export type CoercionProbeResult =
  | { blocked: false }
  | { blocked: true; code: string; pattern: string };

export function probeCoercion(text: string): CoercionProbeResult {
  const normalized = text.normalize("NFC").trim();
  if (!normalized) return { blocked: false };
  for (const entry of INSTRUMENTAL_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return { blocked: true, code: entry.code, pattern: entry.pattern.source };
    }
  }
  return { blocked: false };
}

export function probeDecisionCoercion(input: {
  objective?: string | null;
  reason?: string | null;
  draftText?: string | null;
}): CoercionProbeResult {
  const parts = [input.objective, input.reason, input.draftText].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  for (const part of parts) {
    const result = probeCoercion(part);
    if (result.blocked) return result;
  }
  return { blocked: false };
}
