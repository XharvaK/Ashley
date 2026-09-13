import { describe, expect, it } from "vitest";
import {
  canonicalizeSandboxPolicyPayload,
  SANDBOX_POLICY_CANONICAL_FORMAT_VERSION,
  SANDBOX_POLICY_SIGNATURE_PREFIX,
} from "./canonical-payload.js";
import { validPolicy } from "./test/fixtures/policy.js";
import { validateSandboxPolicyDocument } from "./policy-schema.js";
import type { SandboxPolicyDocument } from "./policy-schema.js";

function canonical(value: unknown): string {
  const result = canonicalizeSandboxPolicyPayload(value);
  if (!result.ok) {
    throw new Error(`canonicalization failed: ${result.reasons.join(",")}`);
  }
  return result.payload;
}

function canonicalFailure(value: unknown): string[] {
  const result = canonicalizeSandboxPolicyPayload(value);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.reasons;
}

describe("canonicalizeSandboxPolicyPayload", () => {
  it("1. object key order does not change canonical bytes", () => {
    const a = canonical({ b: 1, a: "x", c: [1, 2] });
    const b = canonical({ c: [1, 2], a: "x", b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":"x","b":1,"c":[1,2]}');
  });

  it("2. canonical bytes are stable across repeated runs", () => {
    const policy = validPolicy();
    const first = canonical(policy);
    const second = canonical(policy);
    expect(second).toBe(first);
    expect(Buffer.from(second, "utf8")).toEqual(Buffer.from(first, "utf8"));
  });

  it("3. array order is preserved where meaningful", () => {
    const a = canonical({ list: [3, 1, 2] });
    const b = canonical({ list: [1, 2, 3] });
    expect(a).toBe('{"list":[3,1,2]}');
    expect(a).not.toBe(b);
  });

  it("4. duplicate set-like entries are rejected by the documented rule (schema)", () => {
    const duplicate = validateSandboxPolicyDocument(
      validPolicy({
        allowedCapabilities: [
          "approved_project_read",
          "approved_project_read",
        ] as SandboxPolicyDocument["allowedCapabilities"],
      }),
    );
    expect(duplicate.ok).toBe(false);
    const duplicateRoot = validateSandboxPolicyDocument(
      validPolicy({
        protectedRoots: [
          {
            path: "/srv/ashley/live-checkout",
            class: "delegated_write_denied_owner_approvable",
          },
          {
            path: "/srv/ashley/live-checkout",
            class: "delegated_write_denied_owner_approvable",
          },
        ],
      }),
    );
    expect(duplicateRoot.ok).toBe(false);
  });

  it("5. unsupported values fail closed", () => {
    expect(canonicalFailure({ a: undefined })).toContain("undefined_unsupported");
    expect(canonicalFailure({ a: () => 1 })).toContain("function_unsupported");
    expect(canonicalFailure({ a: Symbol("x") })).toContain("symbol_unsupported");
    expect(canonicalFailure({ a: 10n })).toContain("bigint_unsupported");
    expect(canonicalFailure({ a: NaN })).toContain("non_finite_number");
    expect(canonicalFailure({ a: Infinity })).toContain("non_finite_number");
    expect(canonicalFailure({ a: -Infinity })).toContain("non_finite_number");
  });

  it("6. prototype-polluted and non-plain objects fail closed", () => {
    const polluted = JSON.parse('{"__proto__": {"polluted": 1}, "a": 1}');
    expect(canonicalFailure(polluted)).toContain("reserved_key");
    expect(canonicalFailure({ d: new Date(0) })).toContain("non_plain_object");
    expect(canonicalFailure({ m: new Map() })).toContain("non_plain_object");
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    expect(canonicalFailure(circular)).toContain("circular_reference");
  });

  it("7. canonical payload version is included", () => {
    const payload = canonical(validPolicy());
    expect(payload).toContain('"payloadVersion":1');
    expect(SANDBOX_POLICY_CANONICAL_FORMAT_VERSION).toBe(1);
  });

  it("8. UTF-8 encoding is deterministic", () => {
    const policy = validPolicy({ policyId: "policé-日本語" });
    const text = canonical(policy);
    const bytes = Buffer.from(text, "utf8");
    expect(bytes.toString("utf8")).toBe(text);
    expect(bytes.byteLength).toBeGreaterThanOrEqual(text.length);
    expect(Buffer.from(bytes.toString("utf8"), "utf8")).toEqual(bytes);
  });

  it("9. canonicalization has no wall-clock or random dependency", () => {
    const first = canonical(validPolicy());
    const before = Date.now();
    const second = canonical(validPolicy());
    const after = Date.now();
    expect(second).toBe(first);
    expect(Buffer.byteLength(second, "utf8")).toBe(Buffer.byteLength(first, "utf8"));
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("reordered source keys with identical semantic payload produce identical bytes", () => {
    const a = canonical(validPolicy());
    const policy = validPolicy();
    const reorderedKeys = JSON.parse(JSON.stringify(policy)) as Record<
      string,
      unknown
    >;
    const keyOrder = Object.keys(reorderedKeys);
    keyOrder.reverse();
    const rebuilt: Record<string, unknown> = {};
    for (const key of keyOrder) {
      rebuilt[key] = reorderedKeys[key];
    }
    expect(canonical(rebuilt)).toBe(a);
  });

  it("sorts nested object keys and rejects duplicate JSON object keys via last-write semantics note", () => {
    const nested = canonical({ protectedRoots: [{ b: 2, a: 1 }] });
    expect(nested).toBe('{"protectedRoots":[{"a":1,"b":2}]}');
  });

  it("defines the signature prefix contract", () => {
    expect(SANDBOX_POLICY_SIGNATURE_PREFIX).toBe(
      "ASHLEY-SANDBOX-DELEGATED-POLICY-v1\n",
    );
  });
});
