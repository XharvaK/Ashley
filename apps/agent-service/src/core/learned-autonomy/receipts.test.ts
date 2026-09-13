import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { recordChoiceReceipt, listChoiceReceipts } from "./receipts.js";
import { admitAndAccept, c1Assertion, evidence, OWNER_ID } from "./test-fixtures.js";

describe("C3 learned choice receipts", () => {
  it("records typed ids, bounded deltas, hashes, and no unrestricted before/after payload", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = c1Assertion(db, { text: "compilers", observedAt: "2026-08-01T00:00:00.000Z" });
      const second = c1Assertion(db, { text: "toolchains", observedAt: "2026-08-02T00:00:00.000Z" });
      const learned = admitAndAccept(db, [
        evidence(first, "2026-08-01T00:00:00.000Z"),
        evidence(second, "2026-08-02T00:00:00.000Z"),
      ]);
      const receipt = recordChoiceReceipt(db, {
        learnedInfluenceId: learned.id,
        choiceKind: "motivation_admission",
        candidateIds: ["m1", "m2"],
        selectedIds: ["m1"],
        rankDelta: { m1: 12 },
        policyBinding: "c3-dark-v1",
        reasonCode: "qualified_learned_interest",
        inputContentHash: "sha256:" + "a".repeat(64),
        outputContentHash: "sha256:" + "b".repeat(64),
        eligibleInputAffectedRanking: true,
        agencyMadeFinalChoice: false,
      });
      expect(receipt.learnedInfluenceId).toBe(learned.id);
      expect(receipt.rankDelta).toEqual({ m1: 12 });
      expect(listChoiceReceipts(db, OWNER_ID)).toEqual([
        expect.objectContaining({ choiceKind: "motivation_admission" }),
      ]);
      const columns = db.prepare("PRAGMA table_info(learned_choice_receipts)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).not.toContain("before_json");
      expect(columns.map((column) => column.name)).not.toContain("after_json");
    } finally {
      db.close();
    }
  });
});
