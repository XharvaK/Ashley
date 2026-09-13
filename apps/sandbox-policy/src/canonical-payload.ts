/**
 * Deterministic canonical payload serialization for owner-signed delegated
 * sandbox policies (Sandbox Wave 4, Commit 2).
 *
 * Contract
 * --------
 * - The canonical form is the UTF-8 encoding (computed by the consumer) of
 *   the JSON text produced here, with NO trailing newline.
 * - Object keys are emitted in ascending UTF-16 code-unit order (the default
 *   JS string sort), so reordering source JSON keys never changes the bytes.
 * - Array order is meaningful and is preserved verbatim; arrays are never
 *   sorted or deduplicated here.
 * - Duplicate set-like entries are rejected by policy-schema validation
 *   (the documented rule: duplicates are invalid, order is signed as-is).
 * - `undefined`, functions, symbols, `BigInt`, and non-finite numbers are
 *   rejected. `null`, strings, finite numbers, and booleans are allowed.
 * - Only plain objects (prototype `Object.prototype` or `null`) are
 *   accepted; class instances, `Date`, `Map`, `Set`, and prototype-polluted
 *   objects are rejected, as are circular references.
 * - There is no wall-clock, randomness, filesystem, or platform-dependent
 *   path normalization anywhere in this module.
 * - The canonical format is versioned via `SANDBOX_POLICY_CANONICAL_FORMAT_VERSION`
 *   and the payload's own `payloadVersion` field, which is part of the
 *   serialized payload.
 */

export const SANDBOX_POLICY_CANONICAL_FORMAT_VERSION = 1;

/** ASCII domain prefix bound into every signed policy message before the canonical payload. */
export const SANDBOX_POLICY_SIGNATURE_PREFIX =
  "ASHLEY-SANDBOX-DELEGATED-POLICY-v1\n";

export type CanonicalizationResult =
  | { ok: true; payload: string }
  | { ok: false; reasons: string[] };

export function canonicalizeSandboxPolicyPayload(
  value: unknown,
): CanonicalizationResult {
  const reasons: string[] = [];
  const payload = serialize(value, reasons, new Set<object>());
  if (payload === undefined || reasons.length > 0) {
    return { ok: false, reasons };
  }
  return { ok: true, payload };
}

function serialize(
  value: unknown,
  reasons: string[],
  stack: Set<object>,
): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        reasons.push("non_finite_number");
        return undefined;
      }
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "bigint":
      reasons.push("bigint_unsupported");
      return undefined;
    case "undefined":
      reasons.push("undefined_unsupported");
      return undefined;
    case "function":
      reasons.push("function_unsupported");
      return undefined;
    case "symbol":
      reasons.push("symbol_unsupported");
      return undefined;
    default:
      break;
  }

  if (Array.isArray(value)) {
    if (stack.has(value)) {
      reasons.push("circular_reference");
      return undefined;
    }
    stack.add(value);
    const parts: string[] = [];
    for (const item of value) {
      const part = serialize(item, reasons, stack);
      if (part === undefined) return undefined;
      parts.push(part);
    }
    stack.delete(value);
    return `[${parts.join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    reasons.push("non_plain_object");
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, "__proto__")) {
    reasons.push("reserved_key");
    return undefined;
  }
  if (stack.has(value)) {
    reasons.push("circular_reference");
    return undefined;
  }
  stack.add(value);
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const part = serialize(record[key], reasons, stack);
    if (part === undefined) return undefined;
    parts.push(`${JSON.stringify(key)}:${part}`);
  }
  stack.delete(value);
  return `{${parts.join(",")}}`;
}
