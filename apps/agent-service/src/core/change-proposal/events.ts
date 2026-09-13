import { ALLOWED_EVENT_PAYLOAD_KEYS } from "./types.js";

const FORBIDDEN_PAYLOAD_PATTERNS = [
  /-----BEGIN .*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /patch/i,
  /stdout/i,
  /stderr/i,
];

export function sanitizeEventPayload(
  payload: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!ALLOWED_EVENT_PAYLOAD_KEYS.has(key)) {
      throw new Error(`forbidden_event_payload_key:${key}`);
    }
    if (typeof value === "string") {
      for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        if (pattern.test(value)) {
          throw new Error(`forbidden_event_payload_content:${key}`);
        }
      }
      out[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      throw new Error(`invalid_event_payload_type:${key}`);
    }
  }
  return out;
}
