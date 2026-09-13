import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { classifyTable } from "./state-inventory.js";

describe("C1 qualification state inventory", () => {
  it("classifies epoch and event ledgers as control-plane state", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      expect(classifyTable("memory_evidence_qualification_epochs")).toMatchObject({
        cls: "CONTROL_PLANE",
      });
      expect(classifyTable("memory_evidence_qualification_events")).toMatchObject({
        cls: "CONTROL_PLANE",
      });
    } finally {
      db.close();
    }
  });
});
