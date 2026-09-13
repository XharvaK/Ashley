import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { listIdentity, recordIdentityEntry } from "../identity/store.js";
import { createEpisode } from "../memory/episodes.js";
import { insertMessage, resolveActiveThread } from "../memory/threads.js";
import {
  applyEligibleRevisions,
  listIdentityReviews,
  listRevisions,
  proposeRevision,
  recordAshleyReviewPosition,
  recordDocReviewDecision,
  reconcileUnsupportedRevisions,
  revertRevision,
} from "./revisions.js";

let episodeSeed = 10_000;

function seedLiveEpisode(
  db: DatabaseSync,
  ownerId: string,
  createdAt = new Date().toISOString(),
): number {
  const threadId = resolveActiveThread(db, ownerId);
  const messageId = insertMessage(db, {
    threadId,
    ownerId,
    role: "user",
    text: `grounded episode message ${episodeSeed}`,
  });
  const episode = createEpisode(db, {
    ownerId,
    threadId,
    summary: "grounded episode seed",
    messageIds: [messageId],
    provenance: "live",
  });
  if (episode == null) throw new Error("episode_seed_failed");
  db.prepare(
    "UPDATE episodes SET created_at = ?, updated_at = ? WHERE id = ?",
  ).run(createdAt, createdAt, episode.id);
  return episode.id;
}

describe("bounded identity growth", () => {
  it("requires independent evidence and never applies in observe mode", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.modular_synthesis",
      text: "interested in sound design",
      source: "organic",
    });
    const base = {
      ownerId: "doc",
      targetLayer: "dynamic_identity" as const,
      targetKey: "interest.modular_synthesis",
      proposedValue: "curious about modular synthesis",
      rationale: "Repeated voluntary engagement.",
      evidenceType: "episode",
      provenance: "live" as const,
    };
    const first = seedLiveEpisode(db, "doc");
    proposeRevision(db, { ...base, evidenceId: first });
    expect(applyEligibleRevisions(db, "doc", "apply")).toHaveLength(0);
    const second = seedLiveEpisode(db, "doc");
    proposeRevision(db, { ...base, evidenceId: second });
    expect(applyEligibleRevisions(db, "doc", "observe")).toHaveLength(0);
    const [revisionId] = applyEligibleRevisions(db, "doc", "apply");
    expect(revisionId).toBeTypeOf("number");
    expect(
      listIdentity(db, "doc", { layer: "dynamic" })
        .some((entry) => entry.text === base.proposedValue),
    ).toBe(true);
    expect(revertRevision(db, "doc", revisionId!)).toBe(true);
    expect(
      listIdentity(db, "doc", { layer: "dynamic" })
        .some((entry) => entry.text === base.proposedValue),
    ).toBe(false);
    expect(
      listIdentity(db, "doc", { layer: "dynamic" })
        .some((entry) => entry.text === "interested in sound design"),
    ).toBe(true);
    db.close();
  });

  it("does not turn three same-day observations into stable identity", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const base = {
      ownerId: "doc",
      targetLayer: "stable_identity" as const,
      targetKey: "taste.modular_synthesis",
      proposedValue: "drawn to modular synthesis",
      rationale: "A possible durable taste.",
      evidenceType: "episode",
      provenance: "live" as const,
    };
    const sameDay = new Date().toISOString();
    const one = seedLiveEpisode(db, "doc", sameDay);
    const id = proposeRevision(db, { ...base, evidenceId: one });
    proposeRevision(db, { ...base, evidenceId: seedLiveEpisode(db, "doc", sameDay) });
    proposeRevision(db, { ...base, evidenceId: seedLiveEpisode(db, "doc", sameDay) });
    db.prepare(
      "UPDATE learning_revisions SET apply_after = ? WHERE id = ?",
    ).run(new Date(0).toISOString(), id);
    expect(applyEligibleRevisions(db, "doc", "apply")).toHaveLength(0);
    db.close();
  });

  it("keeps a later supported revision visible when an earlier leaf loses evidence", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const baselineId = recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.modular_synthesis",
      text: "interested in sound design",
      source: "manual",
    });
    const common = {
      ownerId: "doc",
      targetLayer: "dynamic_identity" as const,
      targetKey: "interest.modular_synthesis",
      rationale: "Repeated voluntary engagement.",
      evidenceType: "episode",
      provenance: "live" as const,
    };
    const firstId = proposeRevision(db, {
      ...common,
      proposedValue: "curious about modular synthesis",
      evidenceId: seedLiveEpisode(db, "doc"),
    });
    proposeRevision(db, {
      ...common,
      proposedValue: "curious about modular synthesis",
      evidenceId: seedLiveEpisode(db, "doc"),
    });
    expect(applyEligibleRevisions(db, "doc", "apply")).toContain(firstId);

    const secondId = proposeRevision(db, {
      ...common,
      proposedValue: "studying modular synthesis deeply",
      evidenceId: seedLiveEpisode(db, "doc"),
    });
    proposeRevision(db, {
      ...common,
      proposedValue: "studying modular synthesis deeply",
      evidenceId: seedLiveEpisode(db, "doc"),
    });
    expect(applyEligibleRevisions(db, "doc", "apply")).toContain(secondId);

    db.prepare(
      "DELETE FROM evidence_links WHERE target_type = 'revision' AND target_id = ?",
    ).run(String(firstId));
    expect(reconcileUnsupportedRevisions(db, "doc", [firstId])).toBe(1);

    const visible = listIdentity(db, "doc", { layer: "dynamic" })
      .filter((entry) => entry.kind === common.targetKey);
    expect(visible.at(-1)?.text).toBe("studying modular synthesis deeply");
    expect(visible.at(-1)?.revisedFrom).toBe(baselineId);
    const statuses = new Map(
      listRevisions(db, "doc").map((revision) => [revision.id, revision.status]),
    );
    expect(statuses.get(firstId)).toBe("reverted");
    expect(statuses.get(secondId)).toBe("applied");
    db.close();
  });

  it("uses indexed evidence and episode lookups", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const plan = db.prepare(
      `EXPLAIN QUERY PLAN
       SELECT COUNT(*)
       FROM evidence_links l
       LEFT JOIN episodes e
         ON l.source_type = 'episode' AND e.id = CAST(l.source_id AS INTEGER)
       WHERE l.owner_id = ? AND l.target_type = 'revision' AND l.target_id = ?`,
    ).all("doc", "1") as Array<{ detail: string }>;
    expect(plan.some((row) => /SEARCH l USING.*INDEX/i.test(row.detail))).toBe(true);
    expect(plan.some((row) => /SEARCH e USING INTEGER PRIMARY KEY/i.test(row.detail))).toBe(true);
    expect(plan.some((row) => /^SCAN (?:l|e)\b/i.test(row.detail))).toBe(false);
    db.close();
  });

  it("keeps foundational values in joint review until Ashley affirms and Doc approves", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const episodeId = seedLiveEpisode(db, "doc");
    const revisionId = proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "stable_identity",
      targetKey: "boundary.truthful_refusal",
      proposedValue: "refuse requests that require deliberate deception",
      rationale: "A possible foundational boundary.",
      evidenceType: "episode",
      evidenceId: episodeId,
      provenance: "live",
    });
    const [review] = listIdentityReviews(db, "doc");
    expect(review).toMatchObject({
      revisionId,
      ashleyPosition: null,
      docDecision: null,
    });
    expect(applyEligibleRevisions(db, "doc", "apply")).toEqual([]);
    expect(recordDocReviewDecision(db, {
      ownerId: "doc", reviewId: review!.id, decision: "approve",
    })).toBe(true);
    expect(applyEligibleRevisions(db, "doc", "apply")).toEqual([]);
    expect(recordAshleyReviewPosition(db, {
      ownerId: "doc",
      reviewId: review!.id,
      position: "affirm",
      rationale: "This follows from the grounded truth commitment.",
      evidenceType: "episode",
      evidenceId: episodeId,
    })).toBe(true);
    expect(applyEligibleRevisions(db, "doc", "apply")).toEqual([revisionId]);
    expect(listIdentity(db, "doc", { layer: "stable" }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: "boundary.truthful_refusal",
          text: "refuse requests that require deliberate deception",
        }),
      ]));
    expect(listIdentityReviews(db, "doc")[0]).toMatchObject({
      ashleyPosition: "affirm",
      docDecision: "approve",
      appliedAt: expect.any(String),
    });
    expect(proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "stable_identity",
      targetKey: "vision.rewrite",
      proposedValue: "change the Vision at runtime",
      rationale: "forbidden",
      evidenceType: "episode",
      evidenceId: 43,
    })).toBe(0);
    db.close();
  });

  it("never auto-applies shadow revisions even with live evidence (time-shift isolation)", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.shadow_era",
      text: "baseline",
      source: "manual",
    });
    const one = seedLiveEpisode(db, "doc");
    const two = seedLiveEpisode(db, "doc");
    proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.shadow_era",
      proposedValue: "shadow-era learning",
      rationale: "Proposed while reading was inactive.",
      evidenceType: "episode",
      evidenceId: one,
      provenance: "shadow",
    });
    proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.shadow_era",
      proposedValue: "shadow-era learning",
      rationale: "Proposed while reading was inactive.",
      evidenceType: "episode",
      evidenceId: two,
      provenance: "shadow",
    });
    expect(applyEligibleRevisions(db, "doc", "apply")).toEqual([]);
    expect(
      listIdentity(db, "doc", { layer: "dynamic" })
        .some((entry) => entry.text === "shadow-era learning"),
    ).toBe(false);
    db.close();
  });

  it("only applyEligibleRevisions with allowShadow can apply shadow revisions", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.shadow_review",
      text: "baseline",
      source: "manual",
    });
    const one = seedLiveEpisode(db, "doc");
    const two = seedLiveEpisode(db, "doc");
    const revisionId = proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.shadow_review",
      proposedValue: "owner-reviewed shadow learning",
      rationale: "Grounds the explicit owner-review exception.",
      evidenceType: "episode",
      evidenceId: one,
      provenance: "shadow",
    });
    proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.shadow_review",
      proposedValue: "owner-reviewed shadow learning",
      rationale: "Grounds the explicit owner-review exception.",
      evidenceType: "episode",
      evidenceId: two,
      provenance: "shadow",
    });
    expect(
      applyEligibleRevisions(db, "doc", "apply", {
        allowShadow: true,
        revisionIds: [revisionId],
      }),
    ).toHaveLength(1);
    db.close();
  });

  it("refuses a broad allowShadow scan without exact revision ids", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.shadow_scan",
      text: "baseline",
      source: "manual",
    });
    const one = seedLiveEpisode(db, "doc");
    const two = seedLiveEpisode(db, "doc");
    proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.shadow_scan",
      proposedValue: "shadow scan learning",
      rationale: "observe-era proposal",
      evidenceType: "episode",
      evidenceId: one,
      provenance: "shadow",
    });
    proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.shadow_scan",
      proposedValue: "shadow scan learning",
      rationale: "observe-era proposal",
      evidenceType: "episode",
      evidenceId: two,
      provenance: "shadow",
    });
    expect(() =>
      applyEligibleRevisions(db, "doc", "apply", { allowShadow: true }),
    ).toThrow(/allowShadow_requires_exact_revision_ids/);
    db.close();
  });

  it("an exact-item allowShadow never applies unrelated shadow revisions", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.authorized_item",
      text: "baseline",
      source: "manual",
    });
    recordIdentityEntry(db, {
      ownerId: "doc",
      layer: "dynamic",
      kind: "interest.unrelated_item",
      text: "baseline",
      source: "manual",
    });
    const authorized = proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.authorized_item",
      proposedValue: "exact item crosses the boundary",
      rationale: "owner authorized this one",
      evidenceType: "episode",
      evidenceId: seedLiveEpisode(db, "doc"),
      provenance: "shadow",
    });
    proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.authorized_item",
      proposedValue: "exact item crosses the boundary",
      rationale: "owner authorized this one",
      evidenceType: "episode",
      evidenceId: seedLiveEpisode(db, "doc"),
      provenance: "shadow",
    });
    const unrelated = proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.unrelated_item",
      proposedValue: "unrelated shadow learning",
      rationale: "observe-era proposal",
      evidenceType: "episode",
      evidenceId: seedLiveEpisode(db, "doc"),
      provenance: "shadow",
    });
    proposeRevision(db, {
      ownerId: "doc",
      targetLayer: "dynamic_identity",
      targetKey: "interest.unrelated_item",
      proposedValue: "unrelated shadow learning",
      rationale: "observe-era proposal",
      evidenceType: "episode",
      evidenceId: seedLiveEpisode(db, "doc"),
      provenance: "shadow",
    });
    expect(
      applyEligibleRevisions(db, "doc", "apply", {
        allowShadow: true,
        revisionIds: [authorized],
      }),
    ).toEqual([authorized]);
    expect(
      listIdentity(db, "doc", { layer: "dynamic" })
        .some((entry) => entry.text === "unrelated shadow learning"),
    ).toBe(false);
    expect(unrelated).not.toBe(authorized);
    db.close();
  });
});
