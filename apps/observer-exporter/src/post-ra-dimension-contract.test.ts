import { describe, expect, it } from "vitest";
import * as coverageModule from "./coverage.js";
import { BUNDLE_SCHEMA_VERSION } from "./exporter.js";

type PostRaContractModule = typeof coverageModule & {
  POST_RA_COVERAGE_DIMENSIONS: readonly string[];
  POST_RA_PACKET_COVERAGE_OBLIGATIONS: readonly { packet: string; obligation: string }[];
  POST_RA_P_W1_00_EVIDENCE_SURFACES: readonly {
    source: "nuclear" | "cognitive_sidecar";
    table: string;
    columns: readonly string[];
  }[];
  resolvePostRaDimensionContract: () => readonly {
    dimension: string;
    status: "SUPPORTED" | "AWAITING-BEHAVIOR";
  }[];
  hasRequiredDatabaseSurface: (source: "nuclear" | "cognitive_sidecar", table: string, columns: readonly string[]) => boolean;
};

const contract = coverageModule as PostRaContractModule;

describe("Post-RA Observer calibration contract", () => {
  it("resolves all ten declared dimensions without run-level completion", () => {
    const dimensions = contract.resolvePostRaDimensionContract();

    expect(dimensions).toHaveLength(10);
    expect(new Set(dimensions.map((dimension) => dimension.dimension)).size).toBe(10);
    expect(dimensions.every((dimension) => ["SUPPORTED", "AWAITING-BEHAVIOR"].includes(dimension.status))).toBe(true);
    expect(dimensions.some((dimension) => dimension.status === "COMPLETE")).toBe(false);
    expect(dimensions.every((dimension) => dimension.dimension.trim() !== "")).toBe(true);
  });

  it("freezes the ten dimension identifiers and packet obligations", () => {
    expect(contract.POST_RA_COVERAGE_DIMENSIONS).toEqual([
      "meaningful_proactivity",
      "concern_lifecycle",
      "learned_personality",
      "personal_workspace_use",
      "current_world_awareness",
      "audience_aware_expression",
      "self_inspection",
      "sustained_inquiry",
      "candidate_improvement",
      "failure_repair",
    ]);
    expect(contract.POST_RA_PACKET_COVERAGE_OBLIGATIONS.map(({ packet }) => packet)).toEqual([
      "P-W1-01",
      "P-W1-02",
      "P-W1-03",
      "P-W2-01A",
      "P-W2-01B",
      "P-W2-02A",
      "P-W2-02B",
      "P-W2-03",
      "P-W3-01",
      "P-W3-02A",
      "P-W3-03",
      "P-W4-01",
    ]);
  });

  it("maps P-W1-00 evidence only to existing exporter surfaces", () => {
    expect(contract.POST_RA_P_W1_00_EVIDENCE_SURFACES).toEqual([
      { source: "cognitive_sidecar", table: "settlements", columns: ["payload_json"] },
      { source: "cognitive_sidecar", table: "speech_outbox", columns: ["settlement_id", "nuclear_reservation_id"] },
      { source: "nuclear", table: "delivery_reservations", columns: ["delivery_lane", "state"] },
    ]);

    for (const surface of contract.POST_RA_P_W1_00_EVIDENCE_SURFACES) {
      expect(contract.hasRequiredDatabaseSurface(surface.source, surface.table, surface.columns)).toBe(true);
    }
  });

  it("binds the first desk surface addition to the bumped bundle schema", () => {
    expect(BUNDLE_SCHEMA_VERSION).toBe(4);
    expect(contract.hasRequiredDatabaseSurface("cognitive_sidecar", "desk_entries", ["id", "body", "updated_at_ms"])).toBe(true);
  });
});
