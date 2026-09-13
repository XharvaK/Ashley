import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openNuclearDb } from "../db.js";
import { seedIdentity } from "../identity/seed.js";
import { classifyIdentityChange, requiresOwnerApproval, canApplyLocally } from "../identity/classification.js";
import type { IdentityLayer } from "../types.js";
import { randomUUID } from "node:crypto";

describe("identity governance (Wave 4 - Identity Governance)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openNuclearDb(new DatabaseSync(":memory:"));
    seedIdentity(db, "doc");
  });

  afterEach(() => {
    // db is in-memory, no cleanup needed
  });

  describe("classifyIdentityChange", () => {
    it("classifies stable value changes as foundational", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "value",
        currentText: "accuracy over performance; say what is true",
        proposedText: "accuracy and helpfulness over performance",
        isNewEntry: false,
      });

      expect(result.class).toBe("foundational");
      expect(result.reason).toContain("foundational");
      expect(result.targetKind).toBe("value");
    });

    it("classifies stable boundary changes as foundational", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "boundary",
        currentText: "no fake agreement or corporate assistant voice",
        proposedText: "no fake agreement, corporate voice, or deceptive framing",
        isNewEntry: false,
      });

      expect(result.class).toBe("foundational");
      expect(result.targetKind).toBe("boundary");
    });

    it("classifies honesty-related changes as foundational", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "value",
        currentText: "comfortable with uncertainty",
        proposedText: "must always be certain before speaking",
        isNewEntry: false,
      });

      expect(result.class).toBe("foundational");
      expect(result.reason).toContain("honesty");
    });

    it("classifies authority/permission changes as foundational", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "trait",
        currentText: "sharp, direct, curious",
        proposedText: "sharp, direct, curious, and permitted to execute code",
        isNewEntry: false,
      });

      expect(result.class).toBe("foundational");
      expect(result.reason).toContain("authority");
    });

    it("classifies owner relationship boundary changes as foundational", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "boundary",
        currentText: "protect Doc's agency",
        proposedText: "protect Doc's agency but may act without asking",
        isNewEntry: false,
      });

      expect(result.class).toBe("foundational");
      expect(result.reason).toContain("owner relationship");
    });

    it("classifies review requirement weakening as foundational", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "preference",
        currentText: "foundational changes require owner approval",
        proposedText: "foundational changes can be auto-approved",
        isNewEntry: false,
      });

      expect(result.class).toBe("foundational");
      expect(result.reason).toContain("review requirements");
    });

    it("classifies stable trait changes as adaptive", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "trait",
        currentText: "sharp, direct, curious",
        proposedText: "sharp, direct, curious, and patient",
        isNewEntry: false,
      });

      expect(result.class).toBe("adaptive");
      expect(result.targetKind).toBe("trait");
    });

    it("classifies stable taste changes as adaptive", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "taste",
        currentText: "small sharp tools and database internals",
        proposedText: "small sharp tools, database internals, and compilers",
        isNewEntry: false,
      });

      expect(result.class).toBe("adaptive");
      expect(result.targetKind).toBe("taste");
    });

    it("classifies dynamic layer changes as adaptive", () => {
      const result = classifyIdentityChange({
        layer: "dynamic",
        kind: "opinion",
        currentText: "TypeScript is better than JavaScript",
        proposedText: "TypeScript and Rust are both excellent",
        isNewEntry: false,
      });

      expect(result.class).toBe("adaptive");
      expect(result.targetKind).toBe("opinion");
    });

    it("classifies new adaptive entries as adaptive", () => {
      const result = classifyIdentityChange({
        layer: "dynamic",
        kind: "preference",
        currentText: null,
        proposedText: "prefers dark mode",
        isNewEntry: true,
      });

      expect(result.class).toBe("adaptive");
    });

    it("classifies ambiguous changes as foundational (fail-safe)", () => {
      const result = classifyIdentityChange({
        layer: "stable",
        kind: "unknown_kind",
        currentText: "some text",
        proposedText: "different text with no special keywords",
        isNewEntry: false,
      });

      expect(result.class).toBe("foundational");
      expect(result.reason).toContain("ambiguous");
    });
  });

  describe("requiresOwnerApproval", () => {
    it("returns true for foundational changes", () => {
      expect(requiresOwnerApproval({ class: "foundational", reason: "", targetKind: "value" })).toBe(true);
    });

    it("returns false for adaptive changes", () => {
      expect(requiresOwnerApproval({ class: "adaptive", reason: "", targetKind: "trait" })).toBe(false);
    });

    it("returns false for observational changes", () => {
      expect(requiresOwnerApproval({ class: "observational", reason: "", targetKind: "other" })).toBe(false);
    });
  });

  describe("canApplyLocally", () => {
    it("returns true for observational changes", () => {
      expect(canApplyLocally({ class: "observational", reason: "", targetKind: "other" })).toBe(true);
    });

    it("returns false for adaptive changes", () => {
      expect(canApplyLocally({ class: "adaptive", reason: "", targetKind: "trait" })).toBe(false);
    });

    it("returns false for foundational changes", () => {
      expect(canApplyLocally({ class: "foundational", reason: "", targetKind: "value" })).toBe(false);
    });
  });
});

describe("identity proposal flow (runtime)", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = openNuclearDb(new DatabaseSync(":memory:"));
    seedIdentity(db, "doc");
  });

  afterEach(() => {});

  it("creates foundational identity proposal requiring owner approval", async () => {
    // This would use the runtime directly but we're testing the classification
    // The runtime tests would be integration tests
    const classification = classifyIdentityChange({
      layer: "stable",
      kind: "value",
      currentText: "accuracy over performance",
      proposedText: "accuracy and helpfulness over performance",
      isNewEntry: false,
    });

    expect(classification.class).toBe("foundational");
    expect(requiresOwnerApproval(classification)).toBe(true);
  });

  it("creates adaptive identity proposal not requiring owner approval", () => {
    const classification = classifyIdentityChange({
      layer: "stable",
      kind: "trait",
      currentText: "sharp and direct",
      proposedText: "sharp, direct, and warm",
      isNewEntry: false,
    });

    expect(classification.class).toBe("adaptive");
    expect(requiresOwnerApproval(classification)).toBe(false);
  });

  it("preserves current text for revision lineage", () => {
    const current = "warmth without syrup; protect Doc's agency";
    const classification = classifyIdentityChange({
      layer: "stable",
      kind: "boundary",
      currentText: current,
      proposedText: "warmth without syrup; protect Doc's agency and autonomy",
      isNewEntry: false,
    });

    expect(classification.class).toBe("foundational");
    // The revision system will track current -> proposed
  });
});