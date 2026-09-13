import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import {
  buildEligibleInputs,
  deriveContextRoute,
} from "./eligibility.js";
import type { ContextRequest, ContextInputCandidate } from "./types.js";

const OWNER_ID = "c2-eligibility-owner";

function request(
  inputs: ContextInputCandidate[],
  overrides: Partial<ContextRequest> = {},
): ContextRequest {
  return {
    requestId: "request-1",
    ownerId: OWNER_ID,
    purpose: "thought",
    routeId: "thought",
    surface: "private",
    inputs,
    ...overrides,
  };
}

function candidate(
  content: string,
  overrides: Partial<ContextInputCandidate> = {},
): ContextInputCandidate {
  return {
    ref: { type: "fact", id: 1 },
    sourceType: "fact",
    sourceId: 1,
    section: "evidence",
    content,
    classification: "never_public",
    influenceClass: "I1",
    influenceEligible: true,
    retrievalEligible: true,
    ...overrides,
  };
}

describe("C2 eligibility and route trust", () => {
  it("allows private eligible material but never caller-authorized remote I2/I3", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const inputs = buildEligibleInputs(db, request([
        candidate("eligible private evidence"),
        candidate("owner pattern", {
          ref: { type: "fact", id: 2 },
          sourceId: 2,
          influenceClass: "I2",
          egressApprovalRef: "caller-approval-is-not-authority",
        }),
      ]));
      expect(inputs.map((item) => item.content)).toEqual([
        "eligible private evidence",
      ]);
      expect(inputs[0]?.routeClass).toBe("remote_companion");
    } finally {
      db.close();
    }
  });

  it("allows ordinary content on a public surface and omits protected classifications", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const inputs = buildEligibleInputs(db, request([
        candidate("ordinary", { classification: "ordinary" }),
        candidate("sensitive", {
          ref: { type: "fact", id: 2 },
          sourceId: 2,
          classification: "sensitive",
        }),
        candidate("never public", {
          ref: { type: "fact", id: 3 },
          sourceId: 3,
          classification: "never_public",
        }),
        candidate("secret", {
          ref: { type: "fact", id: 4 },
          sourceId: 4,
          classification: "secret",
        }),
      ], { surface: "public" }));
      expect(inputs.map((item) => item.content)).toEqual(["ordinary"]);
      expect(inputs[0]?.routeClass).toBe("public_surface");
    } finally {
      db.close();
    }
  });

  it("keeps corrected and historical material labeled instead of reviving it as current", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const inputs = buildEligibleInputs(db, request([
        candidate("barrier-covered current", {
          ref: { type: "fact", id: 1 },
          barrierCovered: true,
          memoryContextRole: "current_source_evidence",
        }),
        candidate("labeled correction", {
          ref: { type: "fact", id: 2 },
          barrierCovered: true,
          memoryContextRole: "corrected_source_evidence",
          retrievalEligible: true,
          influenceEligible: false,
        }),
        candidate("shadow historical", {
          ref: { type: "fact", id: 3 },
          provenance: "shadow",
          memoryContextRole: "historical_source_evidence",
          influenceEligible: false,
          retrievalEligible: true,
        }),
      ]));
      expect(inputs.map((item) => [item.content, item.memoryContextRole])).toEqual([
        ["labeled correction", "corrected_source_evidence"],
        ["shadow historical", "historical_source_evidence"],
      ]);
      expect(inputs.every((item) => item.influenceEligible === false)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("derives route metadata and refuses a mismatched caller route hint", () => {
    expect(deriveContextRoute(request([]))).toMatchObject({
      routeId: "thought",
      routeClass: "remote_companion",
      adapterClass: "cloudflare-adapter",
      profileId: "thought_summary",
      profileVersion: 1,
    });
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(() => buildEligibleInputs(db, request([], {
        routeClassHint: "local",
      }))).toThrow("context_route_class_mismatch");
    } finally {
      db.close();
    }
  });
});
