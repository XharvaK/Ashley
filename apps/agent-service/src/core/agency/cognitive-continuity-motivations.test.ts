import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import {
  collectMotivations,
} from "./motivations.js";
import { decide } from "./decide.js";
import { resolveEvidenceRefs } from "./resolve-evidence.js";
import {
  materializeOpenCognitiveItem,
  type OpenCognitiveItemProposal,
} from "../cognition/open-items.js";

function seedQuestion(
  db: DatabaseSync,
  ownerId: string,
  entityUuid: string,
): void {
  const now = "2026-08-09T00:00:00.000Z";
  db.prepare(
    `INSERT INTO questions
       (owner_id, subject, text, status, priority, created_at, updated_at,
        entity_uuid, data_classification)
     VALUES (?, 'about_self', ?, 'open', ?, ?, ?, ?, ?)`,
  ).run(
    ownerId,
    "A grounded source question",
    0.8,
    now,
    now,
    entityUuid,
    "never_public",
  );
}

function proposal(
  ownerId: string,
  sourceId: string,
  sourceEntityUuid: string,
  provenance: "shadow" | "live",
  semanticKeyMaterial: string,
): OpenCognitiveItemProposal {
  return {
    ownerId,
    kind: "question",
    semanticSummary: "A bounded persistent question",
    source: {
      type: "question",
      id: sourceId,
      entityUuid: sourceEntityUuid,
    },
    origin: "manual",
    semanticKeyMaterial,
    provenance,
    sourceCapability: "reading",
    contractId: currentContractId(),
    buildIdentity: currentBuildIdentity(),
    modelEpoch: 0,
  };
}

describe("cognitive continuity motivation projection", () => {
  it("projects live OCI into existing transient motivation kinds", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    try {
      env.cognitionMode = "apply";
      seedQuestion(db, "doc", "question-source-live");
      db.prepare(
        `INSERT INTO capability_releases
           (capability, release_id, state, promoted_at, updated_at,
            contract_id, build_identity, model_epoch)
         VALUES ('reading', ?, 'active', ?, ?, ?, ?, 0)
         ON CONFLICT(capability, release_id) DO UPDATE SET
           state = 'active', promoted_at = excluded.promoted_at,
           updated_at = excluded.updated_at, contract_id = excluded.contract_id,
           build_identity = excluded.build_identity, model_epoch = excluded.model_epoch`,
      ).run(
        currentContractId(),
        new Date().toISOString(),
        new Date().toISOString(),
        currentContractId(),
        currentBuildIdentity(),
      );
      const item = materializeOpenCognitiveItem(
        db,
        proposal("doc", "1", "question-source-live", "live", "live-question"),
      ).item;

      const motivations = collectMotivations(db, "doc", "proactive");
      expect(motivations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            refType: "open_cognitive_item",
            refId: item.entityUuid,
            kind: "question",
          }),
        ]),
      );
      const decision = decide(motivations, "proactive");
      expect(decision.evidenceRefs).toContainEqual({
        type: "open_cognitive_item",
        id: item.entityUuid,
      });
      expect(
        resolveEvidenceRefs(db, "doc", [
          { type: "open_cognitive_item", id: item.entityUuid },
        ]),
      ).toEqual([
        expect.objectContaining({
          text: expect.stringContaining("A bounded persistent question"),
        }),
      ]);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });

  it("does not project shadow or forgotten-source OCI into live motivations", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    seedQuestion(db, "doc", "question-source-shadow");
    const shadow = materializeOpenCognitiveItem(
      db,
      proposal(
        "doc",
        "1",
        "question-source-shadow",
        "shadow",
        "shadow-question",
      ),
    ).item;
    expect(
      collectMotivations(db, "doc", "proactive").some(
        (motivation) =>
          motivation.refType === "open_cognitive_item" &&
          motivation.refId === shadow.entityUuid,
      ),
    ).toBe(false);

    db.prepare("UPDATE questions SET status = 'forgotten' WHERE id = 1").run();
    expect(
      collectMotivations(db, "doc", "proactive").some(
        (motivation) => motivation.refType === "open_cognitive_item",
      ),
    ).toBe(false);
    db.close();
  });
});
