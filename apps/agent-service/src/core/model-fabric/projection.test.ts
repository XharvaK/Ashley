import { describe, expect, it } from "vitest";
import { createContextProjection } from "./projection.js";

describe("minimal C2 Model Fabric projection seam", () => {
  it("is immutable, bounded, and carries non-empty evidence references", () => {
    const projection = createContextProjection({
      contextPolicyId: "policy-1",
      purpose: "thought",
      messages: [
        { role: "system", content: "schema" },
        { role: "user", content: "candidate evidence" },
      ],
      evidenceRefs: [{ type: "fact", id: 7 }],
      bounds: { maxUtf8Bytes: 100, maxParts: 4, maxEstimatedTokens: 25 },
    });
    expect(projection.evidenceRefs).toHaveLength(1);
    expect(projection.parts).toHaveLength(2);
    expect(projection.measured.utf8Bytes).toBeGreaterThan(0);
    expect(projection.contentBinding.algorithm).toBe("sha256");
    expect(projection.bounds.maxUtf8Bytes).toBe(100);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.parts)).toBe(true);
    expect(Object.isFrozen(projection.bounds)).toBe(true);
  });

  it("binds exact content and evidence while keeping structural telemetry content-free", () => {
    const base = {
      contextPolicyId: "policy-1",
      purpose: "expression" as const,
      messages: [
        { role: "system" as const, content: "safety" },
        { role: "user" as const, content: "same shape" },
      ],
      evidenceRefs: [{ type: "fact" as const, id: 1 }],
      bounds: { maxUtf8Bytes: 100, maxParts: 4, maxEstimatedTokens: 25 },
    };
    const changedText = createContextProjection({
      ...base,
      messages: [
        { role: "system", content: "safety" },
        { role: "user", content: "different text" },
      ],
    });
    const changedRef = createContextProjection({
      ...base,
      evidenceRefs: [{ type: "fact", id: 2 }],
    });
    const original = createContextProjection(base);
    expect(changedText.contentBinding.value).not.toBe(original.contentBinding.value);
    expect(changedRef.contentBinding.value).not.toBe(original.contentBinding.value);
    expect(changedText.telemetryFingerprint).toBe(original.telemetryFingerprint);
    expect(changedRef.telemetryFingerprint).toBe(original.telemetryFingerprint);
    expect(changedText.telemetryFingerprint).not.toContain("different text");
    expect(changedText.telemetryFingerprint).not.toContain("fact");
  });

  it("refuses duplicate current-user content when a current message is declared", () => {
    expect(() => createContextProjection({
      contextPolicyId: "policy-1",
      purpose: "expression",
      currentMessage: "current",
      messages: [
        { role: "system", content: "safety" },
        { role: "user", content: "current" },
        { role: "user", content: "current" },
      ],
      evidenceRefs: [],
      bounds: { maxUtf8Bytes: 100, maxParts: 5, maxEstimatedTokens: 25 },
    })).toThrow("context_current_message_duplicated");
  });
});
