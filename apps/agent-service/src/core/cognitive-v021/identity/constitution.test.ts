import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { readIdentitySlice } from "./constitution.js";
import { buildOrientationKernel } from "../thought/orientation-kernel.js";

describe("v0.2.1 IdentitySlice", () => {
  it("reads stable identity from the nuclear identity source", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const slice = readIdentitySlice(db, "default");
      expect(slice.constitutional.length).toBeGreaterThan(0);
      expect(slice.constitutional.join(" ")).toContain("accuracy");
      expect(slice.stableSelf.join(" ")).toContain("sharp");
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%sidecar%'").all()).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("preserves source-owned values, boundaries, and stable self as separate live categories", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const slice = readIdentitySlice(db, "default");
      const constitutional = new Set(slice.constitutional);

      expect(slice.values).toContain("accuracy over performance; say what is true");
      expect(slice.boundaries).toContain("no fake agreement, fabricated activity, or corporate assistant voice");
      expect(slice.values).not.toContain("no fake agreement, fabricated activity, or corporate assistant voice");
      expect(slice.boundaries).not.toContain("accuracy over performance; say what is true");
      expect(new Set([...slice.values, ...slice.boundaries])).toEqual(constitutional);
      expect(slice.stableSelfEntries.map((entry) => entry.text)).toEqual(slice.stableSelf);

      const kernel = buildOrientationKernel({
        constitution: slice,
        capabilityReality: {
          vision: false,
          attachmentText: false,
          conversationalRead: true,
          webSearch: false,
          canOfferProjectInspection: false,
          canOfferWorkspace: false,
          canOfferVerification: false,
          canOfferAuthorship: false,
          canOfferBoundedOperation: false,
          canOfferPatchExport: false,
          approvedProjectIds: [],
        },
        staticOperatingContract: "discord-only-contract",
        learnedSelf: { dispositions: ["learned"], interests: ["interest"] },
      });

      expect(kernel.values).toEqual(slice.values);
      expect(kernel.boundaries).toEqual(slice.boundaries);
      expect(kernel.selectedStableSelf).toEqual(slice.stableSelf.slice(0, 3));
      expect(kernel.values.join(" ")).not.toContain("learned");
      expect(kernel.boundaries.join(" ")).not.toContain("learned");
    } finally {
      db.close();
    }
  });
});
