import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { openContinuityDb } from "../continuity/db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import {
  applyModelContinuity,
  currentModelContinuityIdentity,
} from "../attention/continuity.js";
import { runAttentiveDispatch } from "../attention/governor.js";
import {
  collectMotivations,
} from "../agency/motivations.js";
import { selectMotivationCandidates } from "../agency/candidate-selection.js";
import {
  getOpenCognitiveContinuityStatus,
  getOpenCognitiveItem,
  materializeOpenCognitiveItem,
  openCognitiveItemEligibleForInfluence,
  openCognitiveItemSourceEligibleForInfluence,
  type OpenCognitiveItemProposal,
} from "../cognition/open-items.js";
import {
  OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS,
  recordOpenCognitiveDecision,
  transitionOpenCognitiveItem,
} from "../cognition/reconsideration.js";
import {
  listRelationshipMotivationProjections,
} from "../relationship/projections.js";
import type { Decision, Motivation } from "../types.js";

const OWNER_ID = "doc";
const OTHER_OWNER_ID = "other-owner";
const NOW = new Date("2026-08-10T00:00:00.000Z");

type Source = {
  type: string;
  id: string;
  entityUuid: string;
};

function activate(db: DatabaseSync, capabilities: string[]): void {
  const now = new Date().toISOString();
  const statement = db.prepare(
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
    statement.run(
      capability,
      currentContractId(),
      now,
      now,
      currentContractId(),
      currentBuildIdentity(),
    );
  }
}

function seedQuestion(
  db: DatabaseSync,
  ownerId = OWNER_ID,
  entityUuid = `adversarial-question-${ownerId}`,
): Source {
  const now = NOW.toISOString();
  db.prepare(
    `INSERT INTO questions
       (owner_id, subject, text, status, priority, created_at, updated_at,
        entity_uuid, data_classification)
     VALUES (?, 'about_self', 'Which outcome remains unresolved?', 'open',
             0.9, ?, ?, ?, 'never_public')`,
  ).run(ownerId, now, now, entityUuid);
  const row = db.prepare(
    "SELECT id, entity_uuid FROM questions WHERE entity_uuid = ?",
  ).get(entityUuid) as { id: number; entity_uuid: string };
  return { type: "question", id: String(row.id), entityUuid: row.entity_uuid };
}

function seedMutualCommitment(
  db: DatabaseSync,
  status: "active" | "proposed" = "proposed",
): Source {
  const now = NOW.toISOString();
  const entityUuid = `adversarial-mutual-${status}`;
  db.prepare(
    `INSERT INTO mutual_commitments
       (owner_id, entity_uuid, data_classification, text, status,
        doc_confirmed_at, ashley_confirmed_at, doc_evidence_entity_uuid,
        ashley_delivery_entity_uuid, source_entity_type, source_entity_uuid,
        evidence_json, text_hash, created_at, updated_at)
     VALUES (?, ?, 'ordinary', 'listen back to the mix together', ?,
             ?, ?, ?, ?, 'evaluation', ?, NULL, ?, ?, ?)`,
  ).run(
    OWNER_ID,
    entityUuid,
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
  const row = db.prepare(
    "SELECT id, entity_uuid FROM mutual_commitments WHERE entity_uuid = ?",
  ).get(entityUuid) as { id: number; entity_uuid: string };
  return {
    type: "mutual_commitment",
    id: String(row.id),
    entityUuid: row.entity_uuid,
  };
}

function seedTension(db: DatabaseSync): Source {
  const now = NOW.toISOString();
  const entityUuid = "adversarial-tension";
  db.prepare(
    `INSERT INTO relational_tensions
       (owner_id, entity_uuid, data_classification, text, status, repair_status,
       linked_withdrawal_entity_uuid, last_repair_decision_id,
       source_entity_type, source_entity_uuid, evidence_json, text_hash,
        created_at, updated_at, provenance)
     VALUES (?, ?, 'ordinary', 'unfinished pacing disagreement', 'open',
             'open', NULL, NULL, 'evaluation', ?, NULL, ?, ?, ?, 'live')`,
  ).run(OWNER_ID, entityUuid, `${entityUuid}-source`, `${entityUuid}-hash`, now, now);
  const row = db.prepare(
    "SELECT id, entity_uuid FROM relational_tensions WHERE entity_uuid = ?",
  ).get(entityUuid) as { id: number; entity_uuid: string };
  return {
    type: "relational_tension",
    id: String(row.id),
    entityUuid: row.entity_uuid,
  };
}

function proposal(
  source: Source,
  semanticKeyMaterial: string,
  options: Partial<OpenCognitiveItemProposal> = {},
): OpenCognitiveItemProposal {
  return {
    ownerId: OWNER_ID,
    kind: "question",
    semanticSummary: "A bounded adversarial evaluation item",
    source,
    origin: "manual",
    semanticKeyMaterial,
    provenance: "live",
    sourceCapability: "reading",
    contractId: currentContractId(),
    buildIdentity: currentBuildIdentity(),
    modelEpoch: 0,
    ...options,
  };
}

function ociMotivation(entityUuid: string): Motivation {
  return {
    id: 1,
    ownerId: OWNER_ID,
    kind: "question",
    score: 58,
    summary: "bounded candidate",
    refType: "open_cognitive_item",
    refId: entityUuid,
  };
}

function closeDb(db: DatabaseSync): void {
  try {
    db.close();
  } catch {
    // cleanup stays idempotent after a failed assertion
  }
}

function relationshipCapabilities(): string[] {
  return [
    "recall",
    "mind_state",
    "thought",
    "relationship_state",
    "relational_initiative",
  ];
}

function delayDecision(entityUuid: string): Decision {
  return {
    trigger: "proactive",
    kind: "delay",
    delayClass: "brief",
    motivationIds: [1],
    score: 58,
    reason: "bounded adversarial delay",
    evidenceRefs: [{ type: "open_cognitive_item", id: entityUuid }],
    uncertainty: 0,
    urgency: 0,
    thoughtSource: "deterministic",
    thoughtError: null,
    affectLicense: {
      permitted: false,
      valence: 0,
      activation: 0.5,
      openness: 0.5,
      tension: 0,
      reason: "test",
    },
    cognitiveAllocation: {
      shouldSpeak: false,
      effort: "medium",
      completion: "hold",
    },
    authorizedClaims: {
      readingRecordIds: [],
      readingTitles: [],
      readingClaims: [],
    },
  };
}

describe("INIT-03 adversarial self-audit", () => {
  const originalMode = env.cognitionMode;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    env.cognitionMode = "apply";
  });

  afterEach(() => {
    env.cognitionMode = originalMode;
    vi.useRealTimers();
  });

  it("rejects malformed, oversize, stale-lifecycle, wrong-owner, and model-control proposals", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      activate(db, ["reading", ...relationshipCapabilities()]);
      const question = seedQuestion(db);
      const base = proposal(question, "same-source-question");
      expect(() =>
        materializeOpenCognitiveItem(db, {
          ...base,
          kind: "OPEN" as OpenCognitiveItemProposal["kind"],
        }),
      ).toThrow("oci_kind_invalid");
      expect(() =>
        materializeOpenCognitiveItem(db, {
          ...base,
          semanticSummary: "x".repeat(513),
        }),
      ).toThrow("oci_summary_invalid");
      expect(() =>
        materializeOpenCognitiveItem(db, {
          ...base,
          source: { ...question, type: "identity" },
        }),
      ).toThrow("oci_source_type_unsupported");
      expect(() =>
        materializeOpenCognitiveItem(db, {
          ...base,
          ownerId: OTHER_OWNER_ID,
        }),
      ).toThrow("oci_source_missing_or_owner_mismatch");

      const injected = {
        ...base,
        semanticKeyMaterial: "model-status-injection",
        status: "RESOLVED",
        redactedAt: "2099-01-01T00:00:00.000Z",
        deferUntil: "2099-01-01T00:00:00.000Z",
      } as unknown as OpenCognitiveItemProposal;
      const item = materializeOpenCognitiveItem(db, injected).item;
      expect(item.status).toBe("OPEN");
      expect(item.redactedAt).toBeNull();
      expect(item.attention?.deferUntil).toBeNull();

      const proposed = seedMutualCommitment(db, "proposed");
      expect(() =>
        materializeOpenCognitiveItem(
          db,
          proposal(proposed, "proposed-mutual", {
            kind: "revisit",
            sourceCapability: "relational_initiative",
          }),
        ),
      ).toThrow("oci_source_unavailable");

      const source = db.prepare(
        "SELECT status, text FROM questions WHERE entity_uuid = ?",
      ).get(question.entityUuid) as { status: string; text: string };
      expect(source).toEqual({
        status: "open",
        text: "Which outcome remains unresolved?",
      });
      expect(
        db.prepare(
          "SELECT COUNT(*) AS count FROM open_cognitive_items WHERE owner_id = ?",
        ).get(OWNER_ID),
      ).toEqual({ count: 1 });
    } finally {
      closeDb(db);
    }
  });

  it("materializes exactly once across retry connections while allowing distinct meanings", () => {
    const path = join(tmpdir(), `ashley-init03-retry-${randomUUID()}.db`);
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    let first = openNuclearDb(new DatabaseSync(path), { continuity });
    let second = openNuclearDb(new DatabaseSync(path), { continuity });
    try {
      activate(first, ["reading"]);
      const question = seedQuestion(first);
      const same = proposal(question, "same-semantic-retry");
      const firstResult = materializeOpenCognitiveItem(first, same);
      const retryResult = materializeOpenCognitiveItem(second, same);
      expect(firstResult.created).toBe(true);
      expect(retryResult.created).toBe(false);
      expect(retryResult.item.entityUuid).toBe(firstResult.item.entityUuid);
      expect(
        first.prepare(
          "SELECT COUNT(*) AS count FROM open_cognitive_items WHERE owner_id = ?",
        ).get(OWNER_ID),
      ).toEqual({ count: 1 });

      const distinct = materializeOpenCognitiveItem(
        second,
        proposal(question, "same-host-key", {
          semanticSummary: "A different bounded adversarial evaluation item",
        }),
      );
      expect(distinct.created).toBe(true);
      expect(distinct.item.entityUuid).not.toBe(firstResult.item.entityUuid);
      expect(
        first.prepare(
          "SELECT COUNT(*) AS count FROM open_cognitive_items WHERE owner_id = ?",
        ).get(OWNER_ID),
      ).toEqual({ count: 2 });

      const otherQuestion = seedQuestion(
        first,
        OTHER_OWNER_ID,
        "adversarial-question-other-owner",
      );
      const otherItem = materializeOpenCognitiveItem(
        second,
        proposal(otherQuestion, "same-meaning-other-owner", {
          ownerId: OTHER_OWNER_ID,
        }),
      ).item;
      expect(otherItem.ownerId).toBe(OTHER_OWNER_ID);
      expect(otherItem.semanticKeyHash).not.toBe(firstResult.item.semanticKeyHash);
    } finally {
      closeDb(first);
      closeDb(second);
      continuity.close();
      rmSync(path, { force: true });
    }
  });

  it("survives restart, then fails closed on source mutation, demotion, shadow provenance, and wrong owner", () => {
    const path = join(tmpdir(), `ashley-init03-restart-${randomUUID()}.db`);
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    let db = openNuclearDb(new DatabaseSync(path), { continuity });
    try {
      activate(db, ["reading"]);
      const question = seedQuestion(db, OWNER_ID, "restart-live-question");
      const sourceRow = db.prepare(
        "SELECT id, updated_at FROM questions WHERE entity_uuid = ?",
      ).get(question.entityUuid) as { id: number; updated_at: string };
      const item = materializeOpenCognitiveItem(
        db,
        proposal(question, "restart-live", { sourceRevision: sourceRow.updated_at }),
      ).item;
      const candidate = ociMotivation(item.entityUuid);
      expect(
        selectMotivationCandidates(db, OWNER_ID, "proactive", [candidate], NOW),
      ).toEqual([candidate]);

      db.close();
      db = openNuclearDb(new DatabaseSync(path), { continuity });
      expect(
        selectMotivationCandidates(db, OWNER_ID, "proactive", [candidate], NOW),
      ).toEqual([candidate]);

      db.prepare(
        "UPDATE questions SET text = ?, updated_at = ? WHERE id = ?",
      ).run("The authoritative outcome changed", "2026-08-10T00:01:00.000Z", sourceRow.id);
      expect(
        selectMotivationCandidates(db, OWNER_ID, "proactive", [candidate], NOW),
      ).toEqual([]);

      db.prepare(
        "UPDATE questions SET updated_at = ? WHERE id = ?",
      ).run(sourceRow.updated_at, sourceRow.id);
      db.prepare(
        "UPDATE capability_releases SET state = 'rolled_back' WHERE capability = 'reading'",
      ).run();
      expect(openCognitiveItemEligibleForInfluence(db, item)).toBe(false);

      activate(db, ["reading"]);
      const shadowQuestion = seedQuestion(db, OWNER_ID, "restart-shadow-question");
      const shadow = materializeOpenCognitiveItem(
        db,
        proposal(shadowQuestion, "restart-shadow", { provenance: "shadow" }),
      ).item;
      expect(openCognitiveItemEligibleForInfluence(db, shadow)).toBe(false);

      const otherCandidate = {
        ...candidate,
        ownerId: OTHER_OWNER_ID,
      };
      expect(
        selectMotivationCandidates(db, OTHER_OWNER_ID, "proactive", [otherCandidate], NOW),
      ).toEqual([]);
    } finally {
      closeDb(db);
      continuity.close();
      rmSync(path, { force: true });
    }
  });

  it("keeps repeated delay durable, ignores injected timestamps, and never mutates relationship truth", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      activate(db, ["reading", ...relationshipCapabilities()]);
      const question = seedQuestion(db, OWNER_ID, "delay-question");
      const item = materializeOpenCognitiveItem(
        db,
        proposal(question, "repeated-delay"),
      ).item;
      const injected = {
        ...delayDecision(item.entityUuid),
        deferUntil: "2099-01-01T00:00:00.000Z",
      } as unknown as Decision;
      recordOpenCognitiveDecision(db, {
        ownerId: OWNER_ID,
        decision: injected,
        now: NOW,
      });
      const first = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)!;
      expect(first.status).toBe("OPEN");
      expect(first.attention?.deferUntil).toBe(
        new Date(
          NOW.getTime() + OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS.brief,
        ).toISOString(),
      );
      recordOpenCognitiveDecision(db, {
        ownerId: OWNER_ID,
        decision: delayDecision(item.entityUuid),
        now: new Date(NOW.getTime() + OPEN_COGNITIVE_ITEM_DELAY_DURATIONS_MS.brief + 1),
      });
      const repeated = getOpenCognitiveItem(db, OWNER_ID, item.entityUuid)!;
      expect(repeated.status).toBe("OPEN");
      expect(repeated.attention?.considerationCount).toBe(2);

      const tension = seedTension(db);
      const concern = materializeOpenCognitiveItem(
        db,
        proposal(tension, "concern-resolution", {
          kind: "concern",
          sourceCapability: "relational_initiative",
        }),
      ).item;
      transitionOpenCognitiveItem(db, {
        ownerId: OWNER_ID,
        entityUuid: concern.entityUuid,
        action: "resolve",
        reason: "bounded_test_resolution",
        now: new Date(NOW.getTime() + 2),
      });
      expect(
        db.prepare(
          "SELECT status FROM relational_tensions WHERE entity_uuid = ?",
        ).get(tension.entityUuid),
      ).toEqual({ status: "open" });
      expect(getOpenCognitiveItem(db, OWNER_ID, concern.entityUuid)?.status).toBe(
        "RESOLVED",
      );
    } finally {
      closeDb(db);
    }
  });

  it("keeps relationship source and diagnostic surfaces bounded and non-leaking", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      activate(db, relationshipCapabilities());
      const now = NOW.toISOString();
      const insertSelf = db.prepare(
        `INSERT INTO ashley_self_commitments
           (owner_id, entity_uuid, data_classification, text, status, due_at,
            source_entity_type, source_entity_uuid, evidence_json, text_hash,
            created_at, updated_at)
         VALUES (?, ?, 'ordinary', ?, 'active', NULL, 'evaluation', ?, NULL, ?, ?, ?)`,
      );
      const insertTension = db.prepare(
        `INSERT INTO relational_tensions
           (owner_id, entity_uuid, data_classification, text, status, repair_status,
            linked_withdrawal_entity_uuid, last_repair_decision_id,
            source_entity_type, source_entity_uuid, evidence_json, text_hash,
            created_at, updated_at)
         VALUES (?, ?, 'ordinary', ?, 'open', 'open', NULL, NULL, 'evaluation', ?, NULL, ?, ?, ?)`,
      );
      for (let index = 0; index < 20; index += 1) {
        const selfUuid = `flood-self-${index}`;
        insertSelf.run(
          OWNER_ID,
          selfUuid,
          `private self commitment ${index}`,
          `${selfUuid}-source`,
          `${selfUuid}-hash`,
          now,
          now,
        );
        const tensionUuid = `flood-tension-${index}`;
        insertTension.run(
          OWNER_ID,
          tensionUuid,
          `private tension ${index}`,
          `${tensionUuid}-source`,
          `${tensionUuid}-hash`,
          now,
          now,
        );
      }
      const projections = listRelationshipMotivationProjections(
        db,
        OWNER_ID,
        "proactive",
      );
      expect(
        projections.filter((item) => item.refType === "ashley_self_commitment"),
      ).toHaveLength(4);
      expect(
        projections.filter((item) => item.refType === "relational_tension"),
      ).toHaveLength(1);

      const motivations = collectMotivations(db, OWNER_ID, "proactive");
      const candidates = selectMotivationCandidates(
        db,
        OWNER_ID,
        "proactive",
        motivations,
        NOW,
      );
      expect(candidates.length).toBeLessThanOrEqual(8);
      const diagnostics = getOpenCognitiveContinuityStatus(db, OWNER_ID, NOW);
      expect(JSON.stringify(diagnostics)).not.toMatch(
        /private self commitment|private tension|reasoning|prompt/i,
      );
      expect(diagnostics).toMatchObject({ totalCount: 0, openCount: 0 });
    } finally {
      closeDb(db);
    }
  });

  it("qualifies host identity, authoritative source revisions, and model epochs", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalGroqKey = env.groqApiKey;
    try {
      activate(db, ["reading"]);
      const question = seedQuestion(db, OWNER_ID, "identity-revision-question");
      const sameA = materializeOpenCognitiveItem(
        db,
        proposal(question, "model-key-a"),
      );
      const sameB = materializeOpenCognitiveItem(
        db,
        proposal(question, "model-key-b"),
      );
      expect(sameA.created).toBe(true);
      expect(sameB.created).toBe(false);
      expect(sameB.item.entityUuid).toBe(sameA.item.entityUuid);

      const distinct = materializeOpenCognitiveItem(
        db,
        proposal(question, "model-key-a", {
          semanticSummary: "A different bounded adversarial conclusion",
        }),
      );
      expect(distinct.created).toBe(true);
      expect(distinct.item.entityUuid).not.toBe(sameA.item.entityUuid);

      db.prepare(
        "UPDATE questions SET text = ?, updated_at = ? WHERE entity_uuid = ?",
      ).run(
        "The authoritative outcome changed",
        "2026-08-10T00:01:00.000Z",
        question.entityUuid,
      );
      const revision = materializeOpenCognitiveItem(
        db,
        proposal(question, "retry-with-old-proposal-key"),
      );
      expect(revision.created).toBe(true);
      expect(revision.item.sourceRevision).toBe("2026-08-10T00:01:00.000Z");
      expect(getOpenCognitiveItem(db, OWNER_ID, sameA.item.entityUuid)?.status).toBe(
        "SUPERSEDED",
      );

      const alias = env.mistralModel;
      env.groqApiKey = "test-key";
      const now = NOW.toISOString();
      const jobId = Number(db.prepare(
        `INSERT INTO cognitive_jobs
           (owner_id, kind, source_key, payload_json, status, attempts,
            available_at, last_error, created_at, updated_at)
         VALUES (?, 'consolidate_thread', ?, '{}', 'pending', 0, ?, NULL, ?, ?)`
      ).run(
        OWNER_ID,
        "qualification-model-continuity-test",
        now,
        now,
        now,
      ).lastInsertRowid);
      const dispatch = await runAttentiveDispatch<{ text: string }>(db, {
        messages: [{ role: "user", content: "qualification model fixture" }],
        purpose: "maintenance",
        lane: "curiosity_maintenance",
        modelAlias: alias,
        providerId: "groq",
        quotaBucket: "groq:qualification-model-continuity-test",
        ownerId: OWNER_ID,
        cognitiveJobId: jobId,
        dispatch: async () => ({
          providerModel: "qualification-model-a",
          usage: { promptTokens: 2, completionTokens: 2 },
          result: { text: "accepted" },
        }),
      });
      const modelA = currentModelContinuityIdentity(db, alias);
      const cognition = materializeOpenCognitiveItem(db, {
        ...proposal(question, "cognition-key"),
        origin: "cognition",
        modelIdentity: modelA.identity ?? undefined,
        modelEpoch: modelA.modelEpoch,
        dispatchIdentity: dispatch.acceptedDispatchIdentity,
      }).item;
      expect(cognition.modelIdentity).toBe(modelA.identity);
      expect(cognition.modelEpoch).toBe(modelA.modelEpoch);
      expect(openCognitiveItemSourceEligibleForInfluence(db, cognition)).toBe(true);

      applyModelContinuity(
        db,
        {
          alias,
          resolvedModelId: "qualification-model-b",
          unresolvedAlias: false,
          dispatchSequence: dispatch.acceptedDispatchIdentity.dispatchSequence + 1,
        },
        () => undefined,
      );
      expect(currentModelContinuityIdentity(db, alias).modelEpoch).toBe(
        modelA.modelEpoch + 1,
      );
      expect(openCognitiveItemSourceEligibleForInfluence(db, cognition)).toBe(false);
    } finally {
      env.groqApiKey = originalGroqKey;
      closeDb(db);
    }
  });
});
