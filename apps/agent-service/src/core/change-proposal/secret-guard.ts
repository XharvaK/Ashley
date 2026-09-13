import { detectCredentialShape } from "../privacy/secrets.js";

export function scanProposalText(
  fields: Record<string, string | null | undefined>,
): { ok: true } | { ok: false; reason: "secret_detected" } {
  for (const value of Object.values(fields)) {
    if (!value) continue;
    const hit = detectCredentialShape(value);
    if (hit.hit) {
      return { ok: false, reason: "secret_detected" };
    }
  }
  return { ok: true };
}
