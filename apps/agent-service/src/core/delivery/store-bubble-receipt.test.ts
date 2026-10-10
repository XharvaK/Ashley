import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { recordBubbleReceipt } from "./store.js";

describe("bubble receipt for a missing bubble", () => {
  it("reports delivery_bubble_missing, not a SQLite transaction error", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      let failure: unknown;
      try {
        recordBubbleReceipt(db, 987654, 1, "receipt-probe");
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("delivery_bubble_missing");
      expect(db.isTransaction).not.toBe(true);
    } finally {
      db.close();
    }
  });
});
