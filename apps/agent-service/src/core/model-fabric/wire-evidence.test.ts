import { describe, expect, it } from "vitest";
import { wireEvidenceFor } from "./wire-evidence.js";
import type {
  StructuredOutputSchemaFingerprint,
  TrustedStructuredOutputControl,
} from "./types.js";

describe("W1 sanitized wire evidence", () => {
  it("records the emitted mode and binding without copying message content", () => {
    const evidence = wireEvidenceFor({
      adapterId: "ashley.adapter.nim.v1",
      body: {
        model: "openai/gpt-oss-20b",
        messages: [{ role: "user", content: "private-wire-secret" }],
        response_format: { type: "json_object" },
      },
      structuredOutput: {
        kind: "json_object_compatibility",
        contractId: "ashley.thought.semantic.v1",
        schemaId: "ashley.thought.semantic.v1.schema",
        schemaFingerprint: ("sha256:" + "a".repeat(64)) as StructuredOutputSchemaFingerprint,
        bindingId: "wire:nim-json-object",
      } satisfies TrustedStructuredOutputControl,
    });

    expect(evidence).toMatchObject({
      adapterId: "ashley.adapter.nim.v1",
      wireFormat: "json_object",
      emittedEnforcementMode: "json_object_compatibility",
      providerDeclaredEnforcement: "unavailable",
      bindingId: "wire:nim-json-object",
    });
    expect(JSON.stringify(evidence)).not.toContain("private-wire-secret");
    expect(evidence.sanitizedBodyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("keeps provider declaration unavailable when the adapter has no declaration", () => {
    const evidence = wireEvidenceFor({
      adapterId: "ashley.adapter.groq.v1",
      body: { model: "openai/gpt-oss-20b", messages: [] },
    });
    expect(evidence.providerDeclaredEnforcement).toBe("unavailable");
    expect(evidence.emittedEnforcementMode).toBe("none");
  });
});
