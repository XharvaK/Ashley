import { describe, expect, it } from "vitest";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar, makeThoughtDraft } from "../test-support.js";
import { publishSemanticTransaction } from "../settlement/publish.js";
import {
  createRememberDirective,
  getDurableNomination,
  listDurableNominations,
} from "./nomination.js";
import type { DurableNomination } from "../types.js";

function nomination(overrides: Partial<DurableNomination> = {}): DurableNomination {
  return {
    nominationId: "nomination-1",
    cycleId: "cycle-1",
    generation: 1,
    assertionKey: "owner:tooling",
    statement: "The owner prefers small tools.",
    memoryKind: "owner_preference",
    dimensions: {
      source: "owner_utterance",
      status: "asserted",
      time: "current",
      reliability: "owner_supplied",
    },
    dataClassification: "never_public",
    supersedesAssertionKey: null,
    concernId: null,
    ...overrides,
  };
}

describe("v0.2.1 durable nominations", () => {
  it("stores a nomination at publication but does not create live Memory", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-1",
        conversationId: "thread-1",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: "owner-1",
        occupantId: "doc",
        nowMs: 1,
      });
      const result = publishSemanticTransaction(db, {
        ...makeThoughtDraft({
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          speech: {
            mode: "none",
            mustSay: [],
            mustNot: [],
            surfaceDraft: null,
            acceptableRealizations: [],
            presentationDirectives: [],
          },
          durableNominations: [nomination()],
        }),
        settlementId: "settlement-1",
        speech: {
          mode: "none",
          mustSay: [],
          mustNot: [],
          surfaceDraft: null,
          acceptableRealizations: [],
          presentationDirectives: [],
          finalLicensedText: null,
        },
      });

      expect(result.published).toBe(true);
      expect(listDurableNominations(db)).toHaveLength(1);
      expect(getDurableNomination(db, "nomination-1")).toMatchObject({
        assertionKey: "owner:tooling",
        statement: "The owner prefers small tools.",
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM sidecar_memory_assertions").get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  it("creates a reference-only remember directive", () => {
    const db = openTestSidecar();
    try {
      const evidence = appendOwnerUtterance(db, {
        conversationId: "thread-1",
        text: "Please remember that I prefer small tools.",
        discordMessageIds: ["discord-remember-1"],
        nowMs: 1,
      });
      const directive = createRememberDirective(evidence);
      expect(directive).toEqual({
        rememberRequested: true,
        evidenceLineageId: evidence.lineageId,
        evidenceRowId: evidence.rowId,
        dataClassification: "never_public",
      });
      expect(directive).not.toHaveProperty("ownerText");
      expect(JSON.stringify(directive)).not.toContain(evidence.text);
    } finally {
      db.close();
    }
  });
});
