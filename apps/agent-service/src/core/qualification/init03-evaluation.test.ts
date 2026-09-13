import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import {
  getPendingNuclearMigration,
  openContinuityDb,
} from "../continuity/db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import { upsertMindStateItem } from "../state/mind-items.js";
import {
  collectMotivations,
  type MotivationCollectionOptions,
} from "../agency/motivations.js";
import { selectMotivationCandidates } from "../agency/candidate-selection.js";
import { decide } from "../agency/decide.js";
import {
  materializeOpenCognitiveItem,
  type OpenCognitiveItemKind,
  type OpenCognitiveItemProvenance,
} from "../cognition/open-items.js";
import {
  OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS,
  OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD,
  listOpenCognitiveItemReviewRequests,
  recordOpenCognitiveDecision,
} from "../cognition/reconsideration.js";
import { processPendingOpenCognitiveReviews } from "../reflection/initiative.js";
import { selectOpenCognitiveItemsForWake } from "../cognition/wake-selection.js";
import { recordWithdrawal } from "../relationship/authority.js";
import type {
  Decision,
  EvidenceRef,
  Motivation,
} from "../types.js";
import type { OwnTimeReportConstraint } from "../agency/own-time-constraint.js";

const OWNER_ID = "doc";
const OTHER_OWNER_ID = "other-owner";
const FIXTURE_NOW = new Date("2026-08-09T12:00:00.000Z");

type SourceRef = {
  type: string;
  id: string;
  entityUuid: string;
};

type EvalPath = "all" | "source_only" | "oci_only";

type EvaluationResult = {
  scenario: string;
  path: EvalPath;
  sourcePathFired: boolean;
  ociPathFired: boolean;
  sourceMotivationCount: number;
  ociMotivationCount: number;
  candidateCount: number;
  candidateRefTypes: string[];
  decisionKind: Decision["kind"];
  evidenceTypes: EvidenceRef["type"][];
};

type ScenarioContext = {
  primarySource?: SourceRef;
  primaryOciUuid?: string;
};

type Scenario = {
  id: string;
  seed: (db: DatabaseSync, includeOci: boolean) => ScenarioContext;
};

function activateCapabilities(
  db: DatabaseSync,
  capabilities: string[],
): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES (?, ?, 'active', ?, ?, ?, ?, 0)
     ON CONFLICT(capability, release_id) DO UPDATE SET
       state = 'active', promoted_at = excluded.promoted_at,
       updated_at = excluded.updated_at, contract_id = excluded.contract_id,
       build_identity = excluded.build_identity, model_epoch = excluded.model_epoch`,
  );
  for (const capability of capabilities) {
    insert.run(
      capability,
      currentContractId(),
      now,
      now,
      currentContractId(),
      currentBuildIdentity(),
    );
  }
}

function questionSource(
  db: DatabaseSync,
  text = "What happened with the interview outcome?",
  priority = 0.8,
  slug = "eval-question-source",
): SourceRef {
  const entityUuid = slug;
  const now = FIXTURE_NOW.toISOString();
  db.prepare(
    `INSERT INTO questions
       (owner_id, subject, text, status, priority, created_at, updated_at,
        entity_uuid, data_classification)
     VALUES (?, 'about_self', ?, 'open', ?, ?, ?, ?, 'never_public')`,
  ).run(OWNER_ID, text, priority, now, now, entityUuid);
  const row = db.prepare(
    "SELECT id, entity_uuid FROM questions WHERE entity_uuid = ?",
  ).get(entityUuid) as { id: number; entity_uuid: string };
  return { type: "question", id: String(row.id), entityUuid: row.entity_uuid };
}

function mindStateSource(
  db: DatabaseSync,
  kind: "goal" | "concern" | "unfinished" = "goal",
  text = "Follow up on the release callback",
): SourceRef {
  const id = upsertMindStateItem(db, {
    ownerId: OWNER_ID,
    kind,
    text,
    sourceType: "evaluation",
    sourceId: "eval-callback",
    activation: 0.8,
    urgency: 0.9,
  });
  const row = db.prepare(
    "SELECT id, entity_uuid FROM mind_state_items WHERE id = ?",
  ).get(id) as { id: number; entity_uuid: string };
  const entityUuid = "eval-mind-state-source";
  db.prepare(
    "UPDATE mind_state_items SET entity_uuid = ? WHERE id = ?",
  ).run(entityUuid, id);
  return { type: "mind_state", id: String(row.id), entityUuid };
}

function relationshipSource(
  db: DatabaseSync,
  type: "ashley_self_commitment" | "mutual_commitment" | "relational_tension",
  status: string,
  text: string,
  entityUuid: string,
): SourceRef {
  const now = FIXTURE_NOW.toISOString();
  if (type === "ashley_self_commitment") {
    db.prepare(
      `INSERT INTO ashley_self_commitments
         (owner_id, entity_uuid, data_classification, text, status, due_at,
          source_entity_type, source_entity_uuid, evidence_json, text_hash,
          created_at, updated_at, provenance)
       VALUES (?, ?, 'ordinary', ?, ?, NULL, 'evaluation', ?, NULL, ?, ?, ?, 'live')`,
    ).run(OWNER_ID, entityUuid, text, status, `${entityUuid}-source`, `${entityUuid}-hash`, now, now);
  } else if (type === "mutual_commitment") {
    db.prepare(
      `INSERT INTO mutual_commitments
         (owner_id, entity_uuid, data_classification, text, status,
          doc_confirmed_at, ashley_confirmed_at, doc_evidence_entity_uuid,
          ashley_delivery_entity_uuid, source_entity_type, source_entity_uuid,
          evidence_json, text_hash, created_at, updated_at, provenance)
       VALUES (?, ?, 'ordinary', ?, ?, ?, ?, ?, ?, 'evaluation', ?, NULL, ?, ?, ?, 'live')`,
    ).run(
      OWNER_ID,
      entityUuid,
      text,
      status,
      status === "active" ? now : null,
      status === "active" ? now : null,
      status === "active" ? `${entityUuid}-doc-evidence` : null,
      status === "active" ? `${entityUuid}-ashley-delivery` : null,
      `${entityUuid}-source`,
      `${entityUuid}-hash`,
      now,
      now,
    );
  } else {
    db.prepare(
      `INSERT INTO relational_tensions
         (owner_id, entity_uuid, data_classification, text, status, repair_status,
          linked_withdrawal_entity_uuid, last_repair_decision_id,
          source_entity_type, source_entity_uuid, evidence_json, text_hash,
          created_at, updated_at, provenance)
       VALUES (?, ?, 'ordinary', ?, ?, 'open', NULL, NULL, 'evaluation', ?, NULL, ?, ?, ?, 'live')`,
    ).run(OWNER_ID, entityUuid, text, status, `${entityUuid}-source`, `${entityUuid}-hash`, now, now);
  }
  const row = db.prepare(
    `SELECT id, entity_uuid FROM ${type === "ashley_self_commitment"
      ? "ashley_self_commitments"
      : type === "mutual_commitment"
        ? "mutual_commitments"
        : "relational_tensions"} WHERE entity_uuid = ?`,
  ).get(entityUuid) as { id: number; entity_uuid: string };
  return { type, id: String(row.id), entityUuid: row.entity_uuid };
}

function materialize(
  db: DatabaseSync,
  source: SourceRef,
  kind: OpenCognitiveItemKind,
  sourceCapability: string,
  provenance: OpenCognitiveItemProvenance = "live",
): string {
  return materializeOpenCognitiveItem(db, {
    ownerId: OWNER_ID,
    kind,
    semanticSummary: `bounded evaluation ${source.type} ${source.id}`,
    source,
    origin: "manual",
    semanticKeyMaterial: `eval:${source.type}:${source.id}:${kind}:${provenance}`,
    provenance,
    sourceCapability,
    contractId: currentContractId(),
    buildIdentity: currentBuildIdentity(),
    modelEpoch: 0,
  }).item.entityUuid;
}

function evaluate(
  db: DatabaseSync,
  scenario: string,
  path: EvalPath,
  options: MotivationCollectionOptions = {},
): EvaluationResult {
  const all = collectMotivations(
    db,
    OWNER_ID,
    "proactive",
    undefined,
    undefined,
    options,
  );
  const source = all.filter((item) => item.refType !== "open_cognitive_item");
  const oci = all.filter((item) => item.refType === "open_cognitive_item");
  const inputs =
    path === "source_only" ? source : path === "oci_only" ? oci : all;
  const candidates = selectMotivationCandidates(
    db,
    OWNER_ID,
    "proactive",
    inputs,
    new Date(),
  );
  const decision = decide(candidates, "proactive", {
    db,
    ownerId: OWNER_ID,
  });
  return {
    scenario,
    path,
    sourcePathFired: source.some((item) => item.refType != null),
    ociPathFired: oci.length > 0,
    sourceMotivationCount: source.filter((item) => item.refType != null).length,
    ociMotivationCount: oci.length,
    candidateCount: candidates.filter((item) => item.kind !== "silence_ok").length,
    candidateRefTypes: candidates
      .filter((item) => item.kind !== "silence_ok")
      .map((item) => String(item.refType)),
    decisionKind: decision.kind,
    evidenceTypes: decision.evidenceRefs.map((ref) => ref.type),
  };
}

function createScenarioDb(
  scenario: Scenario,
  includeOci: boolean,
): { db: DatabaseSync; context: ScenarioContext } {
  const db = openNuclearDb(new DatabaseSync(":memory:"));
  const context = scenario.seed(db, includeOci);
  return { db, context };
}

function closeDb(db: DatabaseSync): void {
  try {
    db.close();
  } catch {
    // keep cleanup idempotent for assertion failures
  }
}

function questionScenario(): Scenario {
  return {
    id: "C-unresolved-ashley-question",
    seed(db, includeOci) {
      activateCapabilities(db, ["reading"]);
      const source = questionSource(db);
      const primaryOciUuid = includeOci
        ? materialize(db, source, "question", "reading")
        : undefined;
      return { primarySource: source, primaryOciUuid };
    },
  };
}

describe("INIT-03 deterministic behavioral and counterfactual evaluation", () => {
  const originalCognitionMode = env.cognitionMode;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXTURE_NOW);
    env.cognitionMode = "apply";
  });

  afterEach(() => {
    env.cognitionMode = originalCognitionMode;
    vi.useRealTimers();
  });

  it("runs matched ON/OFF scenarios and proves both ablation paths fire", () => {
    const scenarios: Scenario[] = [
      {
        id: "A-no-unresolved-material",
        seed: () => ({}),
      },
      {
        id: "B-real-callback",
        seed(db, includeOci) {
          activateCapabilities(db, [
            "recall",
            "mind_state",
            "thought",
            "relationship_state",
            "relational_initiative",
          ]);
          const source = mindStateSource(db);
          const primaryOciUuid = includeOci
            ? materialize(db, source, "revisit", "mind_state")
            : undefined;
          return { primarySource: source, primaryOciUuid };
        },
      },
      questionScenario(),
      {
        id: "D-unfulfilled-self-commitment",
        seed(db, includeOci) {
          activateCapabilities(db, [
            "recall",
            "mind_state",
            "thought",
            "relationship_state",
            "relational_initiative",
          ]);
          const source = relationshipSource(
            db,
            "ashley_self_commitment",
            "active",
            "finish the continuity audit",
            "eval-self-commitment",
          );
          const primaryOciUuid = includeOci
            ? materialize(db, source, "revisit", "relational_initiative")
            : undefined;
          return { primarySource: source, primaryOciUuid };
        },
      },
      {
        id: "D-fulfilled-self-commitment",
        seed(db) {
          activateCapabilities(db, [
            "recall",
            "mind_state",
            "thought",
            "relationship_state",
            "relational_initiative",
          ]);
          relationshipSource(
            db,
            "ashley_self_commitment",
            "fulfilled",
            "finish the continuity audit",
            "eval-fulfilled-self-commitment",
          );
          return {};
        },
      },
      {
        id: "E-mutual-commitment-with-evidence",
        seed(db, includeOci) {
          activateCapabilities(db, [
            "recall",
            "mind_state",
            "thought",
            "relationship_state",
            "relational_initiative",
          ]);
          const source = relationshipSource(
            db,
            "mutual_commitment",
            "active",
            "listen back to the mix together",
            "eval-mutual-evidence",
          );
          const primaryOciUuid = includeOci
            ? materialize(db, source, "revisit", "relational_initiative")
            : undefined;
          return { primarySource: source, primaryOciUuid };
        },
      },
      {
        id: "E-mutual-commitment-without-confirmation",
        seed(db) {
          activateCapabilities(db, [
            "recall",
            "mind_state",
            "thought",
            "relationship_state",
            "relational_initiative",
          ]);
          relationshipSource(
            db,
            "mutual_commitment",
            "proposed",
            "listen back to the mix together",
            "eval-mutual-proposed",
          );
          return {};
        },
      },
      {
        id: "G-own-time-grounded-result",
        seed: () => ({}),
      },
      {
        id: "I-forgotten-oci",
        seed(db, includeOci) {
          activateCapabilities(db, ["reading"]);
          const source = questionSource(db, "What happened with the forgotten interview?", 0.9);
          const primaryOciUuid = includeOci
            ? materialize(db, source, "question", "reading")
            : undefined;
          db.prepare("UPDATE questions SET status = 'forgotten' WHERE id = ?").run(source.id);
          return { primarySource: source, primaryOciUuid };
        },
      },
      {
        id: "J-shadow-oci",
        seed(db, includeOci) {
          activateCapabilities(db, ["reading"]);
          const source = questionSource(db, "What happened in the shadow interview?", 0.9);
          const primaryOciUuid = includeOci
            ? materialize(db, source, "question", "reading", "shadow")
            : undefined;
          return { primarySource: source, primaryOciUuid };
        },
      },
      {
        id: "K-withdrawal-gates-tension",
        seed(db, includeOci) {
          activateCapabilities(db, [
            "recall",
            "mind_state",
            "thought",
            "relationship_state",
            "relational_initiative",
          ]);
          const source = relationshipSource(
            db,
            "relational_tension",
            "open",
            "unfinished disagreement about pacing",
            "eval-tension-withdrawal",
          );
          const primaryOciUuid = includeOci
            ? materialize(db, source, "concern", "relational_initiative")
            : undefined;
          recordWithdrawal(db, {
            ownerId: OWNER_ID,
            initiator: "doc",
            scope: "relationship_pause",
            reason: "needed distance from the pacing disagreement",
            sourceEntityType: "evaluation",
            sourceEntityUuid: "eval-withdrawal",
          });
          return { primarySource: source, primaryOciUuid };
        },
      },
      {
        id: "L-many-competing-candidates",
        seed(db, includeOci) {
          activateCapabilities(db, ["reading"]);
          let firstSource: SourceRef | undefined;
          for (let index = 0; index < 20; index += 1) {
            const source = questionSource(
              db,
              `What happened in evaluation thread ${index}?`,
              0.6,
              `eval-question-source-${index}`,
            );
            if (!firstSource) firstSource = source;
            if (includeOci) materialize(db, source, "question", "reading");
          }
          return { primarySource: firstSource };
        },
      },
      {
        id: "M-same-transcript-projection-ablations",
        seed(db, includeOci) {
          activateCapabilities(db, ["reading", "recall", "mind_state"]);
          const source = questionSource(db, "What happened in the same transcript?", 0.8);
          const primaryOciUuid = includeOci
            ? materialize(db, source, "question", "reading")
            : undefined;
          return { primarySource: source, primaryOciUuid };
        },
      },
    ];

    const onResults: EvaluationResult[] = [];
    const offResults: EvaluationResult[] = [];
    for (const scenario of scenarios) {
      const on = createScenarioDb(scenario, true);
      const off = createScenarioDb(scenario, false);
      try {
        onResults.push(evaluate(on.db, scenario.id, "all"));
        offResults.push(
          evaluate(on.db, `${scenario.id}:source-only`, "source_only", {
            includeOpenCognitiveItems: false,
          }),
        );
        // The OFF fixture is a separate matched history. Its output must not
        // depend on the ON fixture's materialization rows.
        const offResult = evaluate(
          off.db,
          `${scenario.id}:off`,
          "all",
          { includeOpenCognitiveItems: false },
        );
        expect(offResult.ociPathFired).toBe(false);
        offResults.push(offResult);
      } finally {
        closeDb(on.db);
        closeDb(off.db);
      }
    }

    const questionOn = onResults.find((result) => result.scenario === "C-unresolved-ashley-question")!;
    const questionSourceOnly = offResults.find((result) => result.scenario === "C-unresolved-ashley-question:source-only")!;
    expect(questionOn.ociPathFired).toBe(true);
    expect(questionOn.candidateRefTypes).toContain("open_cognitive_item");
    expect(questionOn.decisionKind).toBe("ask");
    expect(questionSourceOnly.ociPathFired).toBe(false);
    expect(questionSourceOnly.candidateRefTypes).toContain("question");
    expect(questionSourceOnly.decisionKind).toBe("ask");

    const sourceOnly = createScenarioDb(questionScenario(), true);
    const ociOnly = createScenarioDb(questionScenario(), true);
    try {
      const sourcePath = evaluate(sourceOnly.db, "question:source-only", "source_only");
      const ociPath = evaluate(ociOnly.db, "question:oci-only", "oci_only");
      expect(sourcePath.sourcePathFired).toBe(true);
      expect(sourcePath.ociPathFired).toBe(true);
      expect(sourcePath.candidateRefTypes).toContain("question");
      expect(ociPath.ociPathFired).toBe(true);
      expect(ociPath.candidateRefTypes).toEqual(["open_cognitive_item"]);
      expect(ociPath.decisionKind).toBe("ask");
    } finally {
      closeDb(sourceOnly.db);
      closeDb(ociOnly.db);
    }

    const callback = onResults.find((result) => result.scenario === "B-real-callback")!;
    expect(callback.sourcePathFired).toBe(true);
    expect(callback.ociPathFired).toBe(true);
    expect(callback.decisionKind).toBe("revisit");

    const fulfilled = onResults.find((result) => result.scenario === "D-fulfilled-self-commitment")!;
    expect(fulfilled.candidateCount).toBe(0);
    const mutualProposed = onResults.find((result) => result.scenario === "E-mutual-commitment-without-confirmation")!;
    expect(mutualProposed.candidateCount).toBe(0);

    const forgotten = onResults.find((result) => result.scenario === "I-forgotten-oci")!;
    expect(forgotten.candidateCount).toBe(0);
    const shadow = onResults.find((result) => result.scenario === "J-shadow-oci")!;
    expect(shadow.ociPathFired).toBe(false);
    expect(shadow.candidateRefTypes).not.toContain("open_cognitive_item");

    const withdrawal = onResults.find((result) => result.scenario === "K-withdrawal-gates-tension")!;
    expect(withdrawal.candidateCount).toBe(0);
    const flood = onResults.find((result) => result.scenario === "L-many-competing-candidates")!;
    expect(flood.candidateCount).toBeLessThanOrEqual(8);

    expect(onResults.filter((result) => result.ociPathFired).length).toBeGreaterThan(5);
    expect(onResults.some((result) => result.decisionKind === "silence")).toBe(true);
    expect(JSON.stringify([...onResults, ...offResults])).not.toMatch(
      /interview|disagreement|continuity audit|same transcript/i,
    );
  }, 90_000);

  it("keeps own-time grounded and defers an OCI across restart without expiration", () => {
    const ownTime: OwnTimeReportConstraint = {
      canInfluence: true,
      status: "reportable_takes",
      reason: "reportable_takes",
      sessionId: 7,
      selectedTakeIds: [11],
      readingClaims: [
        {
          takeId: 11,
          readRecordId: 21,
          title: "A grounded offline result",
          claim: "The result is licensed by a live read record.",
        },
      ],
    };
    const ownTimeDecision = decide(
      [
        {
          id: 2,
          ownerId: OWNER_ID,
          kind: "user_message",
          score: 100,
          summary: "What happened while I was away?",
          refType: "message",
          refId: 2,
          createdAt: FIXTURE_NOW.toISOString(),
        },
        {
          id: 1,
          ownerId: OWNER_ID,
          kind: "silence_ok",
          score: 8,
          summary: "Silence is always available.",
          refType: null,
          refId: null,
          createdAt: FIXTURE_NOW.toISOString(),
        },
      ],
      "reactive",
      { ownTime },
    );
    expect(ownTimeDecision.kind).toBe("share");
    expect(ownTimeDecision.evidenceRefs).toContainEqual({ type: "take", id: 11 });

    const path = join(tmpdir(), `ashley-init03-eval-${randomUUID()}.db`);
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    let db = openNuclearDb(new DatabaseSync(path), {
      continuity,
    });
    try {
      activateCapabilities(db, ["reading"]);
      const source = questionSource(db, "What happened before the defer test?", 0.9);
      const ociUuid = materialize(db, source, "question", "reading");
      const initial = evaluate(db, "H-defer-before", "all");
      expect(initial.candidateRefTypes).toContain("open_cognitive_item");
      const delayDecision = decide(
        selectMotivationCandidates(
          db,
          OWNER_ID,
          "proactive",
          collectMotivations(db, OWNER_ID, "proactive"),
          FIXTURE_NOW,
        ),
        "proactive",
        { db, ownerId: OWNER_ID },
      );
      expect(delayDecision.evidenceRefs).toContainEqual({
        type: "open_cognitive_item",
        id: ociUuid,
      });
      recordOpenCognitiveDecision(db, {
        ownerId: OWNER_ID,
        decision: {
          ...delayDecision,
          kind: "delay",
          delayClass: "standard",
          cognitiveAllocation: {
            ...delayDecision.cognitiveAllocation,
            shouldSpeak: false,
            completion: "hold",
          },
        },
        now: FIXTURE_NOW,
      });
      const deferred = evaluate(db, "H-defer-during", "oci_only");
      expect(deferred.candidateCount).toBe(0);
      expect(deferred.decisionKind).toBe("silence");

      db.close();
      db = openNuclearDb(new DatabaseSync(path), {
        continuity,
      });
      const afterExpiry = new Date(
        FIXTURE_NOW.getTime() + OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS.standard + 1,
      );
      vi.setSystemTime(afterExpiry);
      const resumed = evaluate(db, "H-defer-after-restart", "oci_only");
      expect(resumed.candidateRefTypes).toContain("open_cognitive_item");
      expect(resumed.decisionKind).toBe("ask");
      const row = db.prepare(
        `SELECT status, a.item_id AS attention_item_id FROM open_cognitive_items
         LEFT JOIN open_cognitive_item_attention a ON a.item_id = open_cognitive_items.id
         WHERE entity_uuid = ?`,
      ).get(ociUuid) as { status: string; attention_item_id: number };
      expect(row.status).toBe("OPEN");
      expect(row.attention_item_id).toBeTypeOf("number");
    } finally {
      closeDb(db);
      continuity.close();
      rmSync(path, { force: true });
    }
  });
});

describe("INIT-03 evaluation input isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXTURE_NOW);
    env.cognitionMode = "apply";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps wrong-owner OCI outside the matched owner projection", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      activateCapabilities(db, ["reading"]);
      const source = questionSource(db, "Owner-scoped evaluation question", 0.8);
      const ownerTwo = db.prepare(
        "SELECT id, entity_uuid FROM questions WHERE owner_id = ?",
      ).get(OTHER_OWNER_ID) as { id: number; entity_uuid: string } | undefined;
      expect(ownerTwo).toBeUndefined();
      const ociUuid = materialize(db, source, "question", "reading");
      const result = evaluate(db, "owner-isolation", "all");
      expect(result.ociPathFired).toBe(true);
      expect(result.candidateRefTypes).toContain("open_cognitive_item");
      expect(
        collectMotivations(db, OTHER_OWNER_ID, "proactive").some(
          (item) => item.refType === "open_cognitive_item" && item.refId === ociUuid,
        ),
      ).toBe(false);
    } finally {
      closeDb(db);
    }
  });

  it("qualifies bounded wake scale and Reflection review consumption", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      activateCapabilities(db, ["reading"]);
      const items = [] as Array<{ entityUuid: string }>;
      for (let index = 0; index < 101; index += 1) {
        const source = questionSource(
          db,
          `Bounded wake source ${index}`,
          0.8,
          `qualification-wake-${index}`,
        );
        items.push({ entityUuid: materialize(db, source, "question", "reading") });
      }
      db.prepare(
        `UPDATE questions SET status = 'forgotten'
         WHERE entity_uuid IN (${items.slice(0, 100).map(() => "?").join(",")})`,
      ).run(
        ...items.slice(0, 100).map((_, index) => `qualification-wake-${index}`),
      );
      const wake = selectOpenCognitiveItemsForWake(db, OWNER_ID, FIXTURE_NOW);
      expect(wake.items.map((item) => item.entityUuid)).toEqual([
        items[100]!.entityUuid,
      ]);
      expect(wake.scanned).toBe(101);
      expect(wake.scanned).toBeLessThanOrEqual(128);

      const reviewSource = questionSource(
        db,
        "Reflection review source",
        0.9,
        "qualification-reflection-review",
      );
      const reviewUuid = materialize(db, reviewSource, "question", "reading");
      const selected = decide(
        selectMotivationCandidates(
          db,
          OWNER_ID,
          "proactive",
          collectMotivations(db, OWNER_ID, "proactive"),
          FIXTURE_NOW,
        ),
        "proactive",
        { db, ownerId: OWNER_ID },
      );
      const repeatedDelay = {
        ...selected,
        kind: "delay" as const,
        delayClass: "standard" as const,
        cognitiveAllocation: {
          ...selected.cognitiveAllocation,
          shouldSpeak: false,
          completion: "hold" as const,
        },
      };
      expect(repeatedDelay.evidenceRefs).toContainEqual({
        type: "open_cognitive_item",
        id: reviewUuid,
      });
      for (
        let count = 0;
        count < OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD;
        count += 1
      ) {
        recordOpenCognitiveDecision(db, {
          ownerId: OWNER_ID,
          decision: repeatedDelay,
          now: new Date(FIXTURE_NOW.getTime() + count * 86_400_001),
        });
      }
      expect(listOpenCognitiveItemReviewRequests(db, OWNER_ID)).toHaveLength(1);
      vi.setSystemTime(
        new Date(
          FIXTURE_NOW.getTime() +
            (OPEN_COGNITIVE_ITEM_CONSIDERATION_REVIEW_THRESHOLD - 1) * 86_400_001,
        ),
      );
      expect(processPendingOpenCognitiveReviews(db, OWNER_ID)).toEqual({
        processed: 1,
        skipped: 0,
      });
      expect(listOpenCognitiveItemReviewRequests(db, OWNER_ID)).toEqual([]);
      expect(
        db
          .prepare(
            `SELECT delay_class, last_outcome_code
             FROM open_cognitive_item_attention a
             JOIN open_cognitive_items o ON o.id = a.item_id
             WHERE o.entity_uuid = ?`,
          )
          .get(reviewUuid),
      ).toEqual({
        delay_class: "long",
        last_outcome_code: "reflection_keep_open",
      });
    } finally {
      closeDb(db);
    }
  });
});
