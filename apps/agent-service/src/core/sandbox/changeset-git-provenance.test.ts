/** Verify factual Git seal retention without changing Thought rationale or provisional M4 identity. */
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { getChangeSet, persistProposedChangeSet } from "./changeset-store.js";

const native = { baseCommit: "a".repeat(40), sourceGitTree: "b".repeat(40), baseGitTree: "c".repeat(40), candidateGitTree: "d".repeat(40) };
function seed(db: DatabaseSync) {
  const input = {
    ownerId: "owner", changesetId: "cs_" + "ab".repeat(16), projectId: "project", workspaceId: "workspace",
    sourceSnapshotId: "source", candidateSnapshotId: "candidate", candidateTreeHash: "e".repeat(64), baseTreeHash: "f".repeat(64),
    baseCommit: native.baseCommit, sourceCleanliness: "clean", treeHashAlgorithm: "m4-provisional-tree-v0",
    objective: "repair the admitted candidate", rationale: "Thought's authored rationale", riskClass: "low",
    evidenceRefs: ["friction:authored-id", "journal:other-evidence"], verificationRecipeIds: [], changedPaths: [], linkedVerificationRefs: [],
    patchSha256: "9".repeat(64), patchBytes: 10, artifactRef: "/control/sealed.patch", gitProvenance: native,
  };
  return persistProposedChangeSet(db, input);
}

describe("S0 sealed Git facts", () => {
  it("retains the actual native identities in the sealed event beside the exact patch digest", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const row = seed(db);
      const seal = db.prepare("SELECT metadata_json FROM candidate_changeset_events WHERE changeset_id=? AND event_type='sealed'").get(row.changesetId)!;
      expect(JSON.parse(String(seal.metadata_json))).toMatchObject({ gitProvenance: native, patchSha256: "9".repeat(64), candidateTreeHash: "e".repeat(64) });
    } finally { db.close(); }
  });
  it("returns the authored rationale and recorded base for export without replacing M4 hashes", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const row = seed(db);
      expect(getChangeSet(db, row.changesetId)).toMatchObject({ rationale: "Thought's authored rationale", base_commit: native.baseCommit,
        base_tree_hash: "f".repeat(64), candidate_tree_hash: "e".repeat(64), source_snapshot_id: "source" });
    } finally { db.close(); }
  });
});
