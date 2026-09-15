import { describe, expect, it } from "vitest";
import type { ConcernRecord, MindOccupancy, ThoughtInput } from "../types.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { buildThoughtInput } from "./input.js";
import { allocateThoughtProjection } from "./projection-allocator/allocator.js";
import {
  attachOccupiedConcernProjection,
  buildOccupiedConcernProjection,
} from "./occupied-concerns.js";
import {
  modelVisibleThoughtProjection,
  projectThoughtInput,
} from "./projection.js";
import {
  THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT,
} from "./output-contract.js";

const dimensions: ConcernRecord["dimensions"] = {
  source: "owner_utterance",
  status: "asserted",
  time: "current",
  reliability: "owner_supplied",
};

function concern(
  concernId: string,
  statement: string,
  status: ConcernRecord["status"] = "active",
): ConcernRecord {
  return {
    concernId,
    conversationId: "thread-p1",
    statement,
    sourceTurnIds: ["turn-1"],
    dimensions,
    assertionKey: null,
    status,
    snapshotHash: `snapshot-${concernId}`,
  };
}

function occupancy(
  concernId: string,
  status: MindOccupancy["status"],
  priority: number,
  updatedGeneration: number,
): MindOccupancy {
  return {
    conversationId: "thread-p1",
    concernId,
    status,
    priority,
    updatedCycle: "cycle-p1",
    updatedGeneration,
  };
}

function inputWithOccupancy(
  occupancyRows: MindOccupancy[],
  statement = "The exact persisted concern statement.",
): ThoughtInput {
  return {
    cycleId: "cycle-p1",
    generation: 3,
    occupantId: "doc",
    authorityEpoch: 1,
    trigger: { kind: "idle_opportunity", ref: "idle-p1" },
    rawConversation: [],
    workingContext: [],
    occupancy: attachOccupiedConcernProjection(occupancyRows, [
      {
        concernId: "concern-a",
        statement,
        status: "active",
        priority: 7,
        dimensions: { status: "asserted", reliability: "owner_supplied" },
        provenance: "cognitive_sidecar.concerns",
      },
    ]),
    constitution: { constitutional: [], stableSelf: [] },
    learnedSelfSlice: { dispositions: [], interests: [] },
    capabilityReality: {
      vision: false,
      attachmentText: false,
      conversationalRead: false,
      webSearch: false,
      canOfferProjectInspection: false,
      canOfferWorkspace: false,
      canOfferVerification: false,
      canOfferAuthorship: false,
      canOfferBoundedOperation: false,
      canOfferPatchExport: false,
      approvedProjectIds: [],
    },
    observations: [],
    retrieval: {
      request: { triggerTerms: [], workingContextTopics: [], assertionKeys: [], includeLogSearch: true },
      hits: [],
      state: "ready",
      miss: true,
    },
    inFlight: [],
    authorityObjections: [],
    runtimeCondition: {
      fallback: false,
      compression: false,
      lookupFailed: false,
      thoughtUnavailable: false,
    },
    rememberDirective: null,
  };
}

describe("P1 occupied-concern projection", () => {
  it("fails closed when occupancy and concern lifecycle status diverge", () => {
    const projected = buildOccupiedConcernProjection(
      [occupancy("concern-a", "active", 10, 1)],
      [concern("concern-a", "Divergent lifecycle status.", "investigating")],
    );

    expect(projected).toEqual([]);
  });

  it("projects exact persisted statements for eligible occupied concerns in deterministic order", () => {
    const rows = [
      occupancy("concern-b", "active", 8, 1),
      occupancy("concern-a", "active", 8, 2),
      occupancy("concern-c", "investigating", 8, 2),
      occupancy("concern-w", "waiting_for_evidence", 7, 4),
      occupancy("concern-dormant", "dormant_but_revisitable", 99, 99),
      occupancy("concern-resolved", "resolved", 99, 99),
      occupancy("concern-quarantined", "quarantined", 99, 99),
      occupancy("concern-missing", "active", 100, 100),
    ];
    const concerns = [
      concern("concern-a", "The exact statement for A."),
      concern("concern-b", "The exact statement for B."),
      concern("concern-c", "The exact statement for C.", "investigating"),
      concern("concern-w", "The exact statement for W.", "waiting_for_evidence"),
      concern("concern-dormant", "Do not project this dormant statement.", "dormant_but_revisitable"),
      concern("concern-resolved", "Do not project this resolved statement.", "resolved"),
      concern("concern-quarantined", "Do not project this quarantined statement.", "quarantined"),
    ];

    const projected = buildOccupiedConcernProjection(rows, concerns);

    expect(projected).toEqual([
      {
        concernId: "concern-a",
        statement: "The exact statement for A.",
        status: "active",
        priority: 8,
        dimensions: { status: "asserted", reliability: "owner_supplied" },
        provenance: "cognitive_sidecar.concerns",
      },
      {
        concernId: "concern-c",
        statement: "The exact statement for C.",
        status: "investigating",
        priority: 8,
        dimensions: { status: "asserted", reliability: "owner_supplied" },
        provenance: "cognitive_sidecar.concerns",
      },
      {
        concernId: "concern-b",
        statement: "The exact statement for B.",
        status: "active",
        priority: 8,
        dimensions: { status: "asserted", reliability: "owner_supplied" },
        provenance: "cognitive_sidecar.concerns",
      },
      {
        concernId: "concern-w",
        statement: "The exact statement for W.",
        status: "waiting_for_evidence",
        priority: 7,
        dimensions: { status: "asserted", reliability: "owner_supplied" },
        provenance: "cognitive_sidecar.concerns",
      },
    ]);
    expect(projected).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ concernId: "concern-missing" }),
      expect.objectContaining({ concernId: "concern-resolved" }),
      expect.objectContaining({ concernId: "concern-dormant" }),
      expect.objectContaining({ concernId: "concern-quarantined" }),
    ]));
    expect(projected[0]).not.toHaveProperty("summary");
    expect(projected[0]).not.toHaveProperty("order");
    expect(projected[0]).not.toHaveProperty("salience");
    expect(rows[0]).not.toHaveProperty("statement");
  });

  it("makes the projection model-visible, strips mechanical occupancy internals, and changes the semantic hash when the statement changes", () => {
    const first = inputWithOccupancy([occupancy("concern-a", "active", 7, 1)]);
    const firstProjection = projectThoughtInput(first, []).projected;
    const firstVisible = modelVisibleThoughtProjection(firstProjection);

    expect(firstVisible.occupancy).toEqual([{
      concernId: "concern-a",
      statement: "The exact persisted concern statement.",
      status: "active",
      priority: 7,
      dimensions: { status: "asserted", reliability: "owner_supplied" },
      provenance: "cognitive_sidecar.concerns",
    }]);
    expect(firstVisible.occupancy).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ conversationId: "thread-p1" }),
      expect.objectContaining({ updatedCycle: "cycle-p1" }),
      expect.objectContaining({ updatedGeneration: 1 }),
    ]));

    const changed = inputWithOccupancy(
      [occupancy("concern-a", "active", 7, 1)],
      "The changed persisted concern statement.",
    );
    expect(projectThoughtInput(first, []).semanticProjectionHash)
      .not.toBe(projectThoughtInput(changed, []).semanticProjectionHash);
  });

  it("joins the persisted concern ledger and survives the existing allocator handoff", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-p1-db",
        conversationId: "thread-p1-db",
        triggerKind: "idle_opportunity",
        triggerRef: "idle-p1-db",
        occupantId: "doc",
        nowMs: 1,
      });
      const insertConcern = db.prepare(
        `INSERT INTO concerns
           (concern_id, conversation_id, statement, source_refs_json, dimensions_json,
            assertion_key, status, snapshot_hash, updated_cycle)
         VALUES (?, ?, ?, '[]', '{"source":"owner_utterance","status":"asserted","time":"current","reliability":"owner_supplied"}', NULL, ?, ?, 'cycle-p1-db')`,
      );
      insertConcern.run("concern-db-active", "thread-p1-db", "Persisted concern statement for DB.", "active", "snapshot-db-active");
      insertConcern.run("concern-db-resolved", "thread-p1-db", "Resolved statement must stay out.", "resolved", "snapshot-db-resolved");
      db.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("thread-p1-db", "concern-db-active", "active", 4, "cycle-p1-db", 2);
      db.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("thread-p1-db", "concern-db-resolved", "active", 9, "cycle-p1-db", 3);
      db.prepare(
        `INSERT INTO mind_occupancy
           (conversation_id, concern_id, status, priority, updated_cycle, updated_generation)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run("thread-p1-db", "concern-db-missing", "active", 10, "cycle-p1-db", 4);

      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        constitution: { constitutional: ["truth first"], stableSelf: ["steady"] },
        capabilityReality: {
          vision: false,
          attachmentText: false,
          conversationalRead: false,
          webSearch: false,
          canOfferProjectInspection: false,
          canOfferWorkspace: false,
          canOfferVerification: false,
          canOfferAuthorship: false,
          canOfferBoundedOperation: false,
          canOfferPatchExport: false,
          approvedProjectIds: [],
        },
        learnedSelfSlice: { dispositions: [], interests: [] },
      });

      expect(input.occupancy.map((row) => row.concernId)).toEqual([
        "concern-db-missing",
        "concern-db-resolved",
        "concern-db-active",
      ]);
      const allocated = allocateThoughtProjection({
        thoughtInput: input,
        requestId: "p1-db-allocator",
        semanticBudgetTokens: 10_000,
        maxOutputTokens: 1_024,
      });
      const visible = JSON.parse(String(allocated.messages[1]?.content ?? "{}")) as Record<string, unknown>;
      expect(visible.occupancy).toEqual([{
        concernId: "concern-db-active",
        statement: "Persisted concern statement for DB.",
        status: "active",
        priority: 4,
        dimensions: { status: "asserted", reliability: "owner_supplied" },
        provenance: "cognitive_sidecar.concerns",
      }]);
    } finally {
      db.close();
    }
  });

  it("keeps the Thought output semantic schema identity pinned", () => {
    expect(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT).toBe(THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT);
    expect(THOUGHT_OUTPUT_SCHEMA_FINGERPRINT).toBe(
      "sha256:89cb5048209cbb58769fc592aa4f3a85bcae8bf4ba90327e9a030697ca804a8c",
    );
  });
});
