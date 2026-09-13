import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { env } from "../../env.js";
import { decide } from "./decide.js";
import { collectMotivations } from "./motivations.js";
import { resolveEvidenceRefs } from "./resolve-evidence.js";
import { openNuclearDb } from "../db.js";
import {
  currentBuildIdentity,
  currentContractId,
} from "../rollout/capabilities.js";
import {
  insertItem,
  insertTake,
  listRecentTakes,
  upsertSource,
} from "../curiosity/feed.js";
import { recordSuccessfulRead } from "../curiosity/reads.js";

function activate(db: DatabaseSync, capability: "reading" | "curiosity_consolidation"): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO capability_releases
       (capability, release_id, state, promoted_at, updated_at,
        contract_id, build_identity, model_epoch)
     VALUES (?, ?, 'active', ?, ?, ?, ?, 0)
     ON CONFLICT(capability, release_id) DO UPDATE SET
       state = 'active', promoted_at = excluded.promoted_at,
       updated_at = excluded.updated_at, contract_id = excluded.contract_id,
       build_identity = excluded.build_identity, model_epoch = excluded.model_epoch`,
  ).run(
    capability,
    currentContractId(),
    now,
    now,
    currentContractId(),
    currentBuildIdentity(),
  );
}

describe("P5 curiosity and Reflection authority boundaries", () => {
  it("makes grounded curiosity available through Thought without treating a take as endorsement", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const originalMode = env.cognitionMode;
    env.cognitionMode = "apply";
    try {
      activate(db, "reading");
      activate(db, "curiosity_consolidation");
      const sourceId = upsertSource(db, {
        slug: "p5-authority-source",
        title: "P5 authority source",
        kind: "rss",
        url: "https://example.test/p5-feed.xml",
        interest: "bounded evidence",
      });
      const itemId = insertItem(db, {
        sourceId,
        url: "https://example.test/p5-item",
        title: "Bounded evidence item",
        excerpt: "A source excerpt",
        interest: "bounded evidence",
      });
      expect(itemId).not.toBeNull();
      const readId = recordSuccessfulRead(db, {
        itemId: itemId!,
        finalUrl: "https://example.test/p5-item",
        contentHash: "a".repeat(64),
        model: "deterministic-test-extractor",
        evidenceExcerpts: ["A grounded source excerpt."],
        cleanedChars: 32,
        provenance: "live",
      });
      const takeId = insertTake(db, {
        itemId: itemId!,
        interest: "bounded evidence",
        take: "A source-derived observation.",
        evidenceKind: "read_record",
        readId,
        provenance: "live",
      });
      expect(takeId).not.toBeNull();

      const take = listRecentTakes(db).find((candidate) => candidate.id === takeId);
      expect(take).toMatchObject({
        evidenceKind: "read_record",
        provenance: "live",
        readProvenance: "live",
        authorityClass: "NON_AUTHORITATIVE_DERIVED_CONTENT",
      });
      const motivations = collectMotivations(
        db,
        "doc",
        "proactive",
        undefined,
        undefined,
        { persist: false },
      );
      const takeMotivation = motivations.find(
        (motivation) => motivation.kind === "take" && motivation.refId === takeId,
      );
      expect(takeMotivation).toMatchObject({
        sourceAuthorityClass: "NON_AUTHORITATIVE_DERIVED_CONTENT",
      });
      const decision = decide([takeMotivation!], "proactive");
      expect(decision).toMatchObject({ kind: "share" });
      expect(decision.evidenceRefs).toContainEqual({ type: "take", id: takeId });
      expect(resolveEvidenceRefs(db, "doc", decision.evidenceRefs)).toMatchObject([
        {
          authorityClass: "NON_AUTHORITATIVE_DERIVED_CONTENT",
          text: "Bounded evidence item: A source-derived observation.",
        },
      ]);

      db.prepare("UPDATE cur_reads SET provenance = 'shadow' WHERE id = ?").run(readId);
      expect(
        collectMotivations(db, "doc", "proactive", undefined, undefined, { persist: false })
          .some((motivation) => motivation.kind === "take" && motivation.refId === takeId),
      ).toBe(false);
      expect(resolveEvidenceRefs(db, "doc", decision.evidenceRefs)).toEqual([]);
    } finally {
      env.cognitionMode = originalMode;
      db.close();
    }
  });
});
