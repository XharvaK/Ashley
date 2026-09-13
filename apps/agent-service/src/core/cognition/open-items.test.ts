import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import {
  applyModelContinuity,
  currentModelContinuityIdentity,
} from "../attention/continuity.js";
import { runAttentiveDispatch } from "../attention/governor.js";
import {
  getOpenCognitiveItem,
  listOpenCognitiveItems,
  materializeOpenCognitiveItem,
  openCognitiveItemSourceCurrent,
  type OpenCognitiveItemProposal,
} from "./open-items.js";
import {
  currentBuildIdentity,
  currentContractId,
  currentReleaseId,
} from "../rollout/capabilities.js";

const HASH = "a".repeat(64);

describe("open cognitive item store", () => {
  it("reads bounded OCI rows only within the requested owner scope", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const now = "2026-08-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO open_cognitive_items
         (owner_id, entity_uuid, kind, status, semantic_summary,
          source_type, source_id, source_entity_uuid, semantic_key_hash,
          source_capability, contract_id, provenance, source_revision, origin,
          build_identity, model_epoch, data_classification, status_reason,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "owner-1",
      "oci-1",
      "question",
      "OPEN",
      "A bounded unresolved question",
      "question",
      "12",
      "question-source-1",
      HASH,
      "curiosity_consolidation",
      "contract-1",
      "live",
      "source-rev-1",
      "cognition",
      "build-1",
      0,
      "never_public",
      "created",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO open_cognitive_items
         (owner_id, entity_uuid, kind, status, semantic_summary,
          source_type, source_id, source_entity_uuid, semantic_key_hash,
          source_capability, contract_id, provenance, source_revision, origin,
          build_identity, model_epoch, data_classification, status_reason,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "owner-2",
      "oci-2",
      "concern",
      "OPEN",
      "Other owner item",
      "mind_state",
      "13",
      "mind-state-source-2",
      "b".repeat(64),
      "mind_state",
      "contract-1",
      "live",
      "",
      "runtime",
      "build-1",
      0,
      "never_public",
      "created",
      now,
      now,
    );
    db.prepare(
      `INSERT INTO open_cognitive_items
         (owner_id, entity_uuid, kind, status, semantic_summary,
          source_type, source_id, source_entity_uuid, semantic_key_hash,
          source_capability, contract_id, provenance, source_revision, origin,
          build_identity, model_epoch, data_classification, status_reason,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "owner-1",
      "oci-3",
      "revisit",
      "OPEN",
      "A newer bounded revisit",
      "episode",
      "14",
      "episode-source-3",
      "c".repeat(64),
      "episode_revisit",
      "contract-1",
      "live",
      "episode-rev-3",
      "reflection",
      "build-1",
      0,
      "never_public",
      "created",
      "2026-08-10T00:00:00.000Z",
      "2026-08-10T00:00:00.000Z",
    );

    expect(listOpenCognitiveItems(db, "owner-1")).toEqual([
      expect.objectContaining({
        ownerId: "owner-1",
        entityUuid: "oci-3",
        kind: "revisit",
      }),
      expect.objectContaining({
        ownerId: "owner-1",
        entityUuid: "oci-1",
        kind: "question",
        status: "OPEN",
        semanticSummary: "A bounded unresolved question",
        sourceType: "question",
        sourceId: "12",
        sourceEntityUuid: "question-source-1",
        semanticKeyHash: HASH,
        provenance: "live",
        attention: null,
      }),
    ]);
    expect(listOpenCognitiveItems(db, "owner-1", { limit: 1 })).toEqual([
      expect.objectContaining({ entityUuid: "oci-3" }),
    ]);
    expect(getOpenCognitiveItem(db, "owner-1", "oci-1")).toEqual(
      expect.objectContaining({ entityUuid: "oci-1" }),
    );
    expect(listOpenCognitiveItems(db, "owner-2")).toEqual([
      expect.objectContaining({
        ownerId: "owner-2",
        entityUuid: "oci-2",
        kind: "concern",
      }),
    ]);
    db.close();
  });

  it("materializes one owner-scoped item per semantic key under retries", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const now = "2026-08-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO questions
         (owner_id, subject, text, status, priority, created_at, updated_at,
          entity_uuid, data_classification)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    ).run(
      "owner-1",
      "about_self",
      "What should remain unresolved?",
      0.8,
      now,
      now,
      "question-source-1",
      "never_public",
    );

    const proposal = (semanticKeyMaterial: string): OpenCognitiveItemProposal => ({
      ownerId: "owner-1",
      kind: "question",
      semanticSummary: "A bounded unresolved question",
      source: {
        type: "question",
        id: "1",
        entityUuid: "question-source-1",
      },
      origin: "manual",
      semanticKeyMaterial,
      provenance: "shadow",
      sourceCapability: "reading",
      contractId: currentContractId(),
      buildIdentity: currentBuildIdentity(),
      modelEpoch: 0,
      sourceRevision: "question-rev-1",
      dataClassification: "never_public",
    });

    const first = materializeOpenCognitiveItem(db, proposal("same meaning"));
    const retry = materializeOpenCognitiveItem(db, proposal("same meaning"));
    const distinct = materializeOpenCognitiveItem(db, {
      ...proposal("same meaning"),
      semanticSummary: "A different bounded unresolved question",
    });

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.item.entityUuid).toBe(first.item.entityUuid);
    expect(distinct.created).toBe(true);
    expect(
      listOpenCognitiveItems(db, "owner-1", { status: "OPEN" }),
    ).toHaveLength(2);
    db.close();
  });

  it("derives semantic identity from the bounded conclusion, not proposed key material", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const now = "2026-08-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO questions
         (owner_id, subject, text, status, priority, created_at, updated_at,
          entity_uuid, data_classification)
       VALUES (?, 'about_self', ?, 'open', 0.8, ?, ?, ?, 'never_public')`,
    ).run(
      "owner-1",
      "What remains unresolved?",
      now,
      now,
      "question-source-identity",
    );
    const source = db
      .prepare("SELECT id, entity_uuid FROM questions WHERE entity_uuid = ?")
      .get("question-source-identity") as { id: number; entity_uuid: string };
    const makeProposal = (
      semanticSummary: string,
      semanticKeyMaterial: string,
    ): OpenCognitiveItemProposal => ({
      ownerId: "owner-1",
      kind: "question",
      semanticSummary,
      source: {
        type: "question",
        id: String(source.id),
        entityUuid: source.entity_uuid,
      },
      origin: "manual",
      semanticKeyMaterial,
      provenance: "shadow",
      sourceCapability: "reading",
      contractId: currentContractId(),
      buildIdentity: currentBuildIdentity(),
      modelEpoch: 0,
      sourceRevision: "caller-controlled-revision-must-be-ignored",
      dataClassification: "never_public",
    });

    const first = materializeOpenCognitiveItem(
      db,
      makeProposal("Same bounded conclusion", "model-key-a"),
    );
    const retry = materializeOpenCognitiveItem(
      db,
      makeProposal("Same bounded conclusion", "model-key-b"),
    );
    const distinct = materializeOpenCognitiveItem(
      db,
      makeProposal("A different bounded conclusion", "model-key-a"),
    );

    expect(retry.created).toBe(false);
    expect(retry.item.entityUuid).toBe(first.item.entityUuid);
    expect(distinct.created).toBe(true);
    expect(distinct.item.entityUuid).not.toBe(first.item.entityUuid);
    db.close();
  });

  it("binds identity to the authoritative source revision and supersedes stale open rows", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const firstRevision = "2026-08-09T00:00:00.000Z";
    const secondRevision = "2026-08-10T00:00:00.000Z";
    db.prepare(
      `INSERT INTO questions
         (owner_id, subject, text, status, priority, created_at, updated_at,
          entity_uuid, data_classification)
       VALUES (?, 'about_self', 'Revision-bound question', 'open', 0.8, ?, ?, ?, 'never_public')`,
    ).run(
      "owner-1",
      firstRevision,
      firstRevision,
      "question-source-revision",
    );
    const source = db
      .prepare("SELECT id, entity_uuid FROM questions WHERE entity_uuid = ?")
      .get("question-source-revision") as { id: number; entity_uuid: string };
    const makeProposal = (): OpenCognitiveItemProposal => ({
      ownerId: "owner-1",
      kind: "question",
      semanticSummary: "A revision-bound conclusion",
      source: {
        type: "question",
        id: String(source.id),
        entityUuid: source.entity_uuid,
      },
      origin: "manual",
      semanticKeyMaterial: "reused-model-key",
      provenance: "shadow",
      sourceCapability: "reading",
      contractId: currentContractId(),
      buildIdentity: currentBuildIdentity(),
      modelEpoch: 0,
      sourceRevision: "stale-caller-value",
      dataClassification: "never_public",
    });

    const old = materializeOpenCognitiveItem(db, makeProposal());
    expect(old.item.sourceRevision).toBe(firstRevision);
    db.prepare("UPDATE questions SET updated_at = ? WHERE id = ?").run(
      secondRevision,
      source.id,
    );

    const current = materializeOpenCognitiveItem(db, makeProposal());
    expect(current.created).toBe(true);
    expect(current.item.sourceRevision).toBe(secondRevision);
    expect(
      getOpenCognitiveItem(db, "owner-1", old.item.entityUuid),
    ).toMatchObject({ status: "SUPERSEDED" });
    expect(
      db
        .prepare(
          `SELECT to_status, reason FROM open_cognitive_item_transitions
           WHERE item_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(old.item.id),
    ).toEqual({
      to_status: "SUPERSEDED",
      reason: "source_revision_superseded",
    });
    db.close();
  });

  it("invalidates cognition-derived Recall OCI when the resolved model changes", async () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalNimKey = env.nimApiKey;
    const utilityModelAlias = "nvidia/nemotron-3.5-lightning-30b-a3b";
    env.nimApiKey = "test-key";
    const now = "2026-08-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO capability_releases
         (capability, release_id, state, promoted_at, updated_at,
          contract_id, build_identity, model_epoch)
       VALUES ('recall', ?, 'active', ?, ?, ?, ?, 0)`,
    ).run(
      currentReleaseId(),
      now,
      now,
      currentContractId(),
      currentBuildIdentity(),
    );
    db.prepare(
      `INSERT INTO questions
         (owner_id, subject, text, status, priority, created_at, updated_at,
          entity_uuid, data_classification)
       VALUES (?, 'about_self', 'Model-bound question', 'open', 0.8, ?, ?, ?, 'never_public')`,
    ).run("owner-1", now, now, "question-source-model");
    const source = db
      .prepare("SELECT id, entity_uuid FROM questions WHERE entity_uuid = ?")
      .get("question-source-model") as { id: number; entity_uuid: string };
    const jobId = Number(db.prepare(
      `INSERT INTO cognitive_jobs
         (owner_id, kind, source_key, payload_json, status, attempts,
          available_at, last_error, created_at, updated_at)
       VALUES (?, 'consolidate_thread', ?, '{}', 'pending', 0, ?, NULL, ?, ?)`
    ).run(
      "owner-1",
      "open-items-model-continuity-test",
      now,
      now,
      now,
    ).lastInsertRowid);
    try {
      const dispatch = await runAttentiveDispatch<{ text: string }>(db, {
        messages: [{ role: "user", content: "model continuity fixture" }],
        purpose: "maintenance",
        lane: "curiosity_maintenance",
        modelAlias: utilityModelAlias,
        providerId: "nim",
        quotaBucket: "nim:open-items-model-continuity-test",
        ownerId: "owner-1",
        cognitiveJobId: jobId,
        dispatch: async () => ({
          providerModel: "model-a",
          usage: { promptTokens: 2, completionTokens: 2 },
          result: { text: "accepted" },
        }),
      });
      const current = currentModelContinuityIdentity(db, utilityModelAlias);
      const item = materializeOpenCognitiveItem(db, {
      ownerId: "owner-1",
      kind: "question",
      semanticSummary: "A model-bound conclusion",
      source: {
        type: "question",
        id: String(source.id),
        entityUuid: source.entity_uuid,
      },
      origin: "cognition",
      semanticKeyMaterial: "ignored-model-key",
      provenance: "live",
      sourceCapability: "recall",
      contractId: currentContractId(),
      buildIdentity: currentBuildIdentity(),
      modelEpoch: current.modelEpoch,
      modelIdentity: current.identity ?? "",
      dispatchIdentity: dispatch.acceptedDispatchIdentity,
      dataClassification: "never_public",
      }).item;

      expect(item.modelEpoch).toBe(1);
      expect(item.modelIdentity).toBe(current.identity);
      expect(openCognitiveItemSourceCurrent(db, item)).toBe(true);
      applyModelContinuity(
        db,
        {
          alias: utilityModelAlias,
          resolvedModelId: "model-b",
          unresolvedAlias: false,
          dispatchSequence: dispatch.acceptedDispatchIdentity.dispatchSequence + 1,
        },
        () => undefined,
      );
      expect(
        db.prepare("SELECT model_epoch FROM model_continuity_state WHERE alias = ?")
          .get(utilityModelAlias),
      ).toEqual({ model_epoch: 2 });
      expect(openCognitiveItemSourceCurrent(db, item)).toBe(false);
    } finally {
      env.nimApiKey = originalNimKey;
      db.close();
    }
  });

  it("keeps manual source OCI independent of model continuity", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const now = "2026-08-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO capability_releases
         (capability, release_id, state, promoted_at, updated_at,
          contract_id, build_identity, model_epoch)
       VALUES ('reading', ?, 'active', ?, ?, ?, ?, 0)`,
    ).run(
      currentContractId(),
      now,
      now,
      currentContractId(),
      currentBuildIdentity(),
    );
    db.prepare(
      `INSERT INTO questions
         (owner_id, subject, text, status, priority, created_at, updated_at,
          entity_uuid, data_classification)
       VALUES (?, 'about_self', 'Manual source question', 'open', 0.8, ?, ?, ?, 'never_public')`,
    ).run("owner-1", now, now, "question-source-manual-model");
    const source = db
      .prepare("SELECT id, entity_uuid FROM questions WHERE entity_uuid = ?")
      .get("question-source-manual-model") as { id: number; entity_uuid: string };
    applyModelContinuity(
      db,
      {
        alias: env.mistralModel,
        resolvedModelId: "model-a",
        unresolvedAlias: false,
        dispatchSequence: 1,
      },
      () => undefined,
    );
    const item = materializeOpenCognitiveItem(db, {
      ownerId: "owner-1",
      kind: "question",
      semanticSummary: "A manual conclusion",
      source: {
        type: "question",
        id: String(source.id),
        entityUuid: source.entity_uuid,
      },
      origin: "manual",
      provenance: "live",
      sourceCapability: "reading",
      contractId: currentContractId(),
      buildIdentity: currentBuildIdentity(),
      modelEpoch: 0,
      dataClassification: "never_public",
    }).item;
    expect(item.modelIdentity).toBe("");
    expect(openCognitiveItemSourceCurrent(db, item)).toBe(true);
    applyModelContinuity(
      db,
      {
        alias: env.mistralModel,
        resolvedModelId: "model-b",
        unresolvedAlias: false,
        dispatchSequence: 2,
      },
      () => undefined,
    );
    expect(openCognitiveItemSourceCurrent(db, item)).toBe(true);
    db.close();
  });

  it("fails closed for source, provenance, and capability mismatches", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const now = "2026-08-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO questions
         (owner_id, subject, text, status, priority, created_at, updated_at,
          entity_uuid, data_classification)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    ).run(
      "owner-1",
      "about_self",
      "A source question",
      0.8,
      now,
      now,
      "question-source-1",
      "never_public",
    );
    const base: OpenCognitiveItemProposal = {
      ownerId: "owner-1",
      kind: "question",
      semanticSummary: "A bounded unresolved question",
      source: {
        type: "question",
        id: "1",
        entityUuid: "question-source-1",
      },
      origin: "manual",
      semanticKeyMaterial: "mismatch-check",
      provenance: "shadow",
      sourceCapability: "reading",
      contractId: currentContractId(),
      buildIdentity: currentBuildIdentity(),
      modelEpoch: 0,
      dataClassification: "never_public",
    };

    expect(() =>
      materializeOpenCognitiveItem(db, {
        ...base,
        source: { ...base.source, entityUuid: "wrong-source" },
      }),
    ).toThrow("oci_source_entity_mismatch");
    expect(() =>
      materializeOpenCognitiveItem(db, {
        ...base,
        ownerId: "owner-2",
      }),
    ).toThrow("oci_source_missing_or_owner_mismatch");
    expect(() =>
      materializeOpenCognitiveItem(db, {
        ...base,
        provenance: "live",
      }),
    ).toThrow("oci_source_capability_not_live");
    db.prepare("UPDATE questions SET status = 'forgotten' WHERE id = 1").run();
    expect(() =>
      materializeOpenCognitiveItem(db, base),
    ).toThrow("oci_source_unavailable");
    db.close();
  });
});
