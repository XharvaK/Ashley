import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { appendOwnerUtterance } from "../../evidence/conversation-log.js";
import { runGovernedAdmissionCatchup } from "../../memory/admission.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../../test-support.js";
import type { DurableNomination } from "../../types.js";
import { MEMORY_FORMATION_GUIDANCE, thoughtOutputCompatibilityInstruction } from "../output-contract.js";
import { parseThoughtSemanticOutput } from "../parse.js";

const QUOTE = "I haven't created my own Sim yet";
const OWNER_TEXT = `I haven't created my own Sim yet, and it should not be more than a few days.`;

function workedExample(rowId: string): unknown {
  const line = MEMORY_FORMATION_GUIDANCE.find((item) => item.includes("A valid nomination is:"));
  expect(line).toBeTruthy();
  const markerAt = line!.indexOf("A valid nomination is:");
  const start = line!.indexOf("{", markerAt);
  expect(start).toBeGreaterThan(markerAt);
  let depth = 0;
  let end = -1;
  for (let index = start; index < line!.length; index += 1) {
    const char = line![index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  expect(end).toBeGreaterThan(start);
  return JSON.parse(line!.slice(start, end + 1).replaceAll('"R"', JSON.stringify(rowId)));
}

function publish(db: DatabaseSync, nomination: DurableNomination): void {
  const draft = makeThoughtDraft({
    cycleId: nomination.cycleId,
    generation: nomination.generation,
    speech: {
      mode: "none",
      mustSay: [],
      mustNot: [],
      surfaceDraft: null,
      acceptableRealizations: [],
      presentationDirectives: [],
    },
    operations: { ...makeThoughtDraft().operations, observationsConsumed: [] },
    durableNominations: [nomination],
  });
  expect(publishSemanticTransaction(db, {
    ...draft,
    settlementId: "settlement-guidance-example",
    speech: { ...draft.speech, finalLicensedText: null },
  }).published).toBe(true);
}

describe("memory nomination guidance example", () => {
  it("stops treating an empty nomination list as the ordinary answer", () => {
    expect(MEMORY_FORMATION_GUIDANCE[0]).not.toContain("when nothing new came up");
    const chat = thoughtOutputCompatibilityInstruction({
      pass: "chat",
      ownerPrivate: true,
      engineering: false,
      publicPresence: false,
    });
    expect(chat).toContain("durableNominations is never omitted");
    expect(chat).toContain("durableNominations is not an optional domain");
  });

  it("admits the worked owner_goal example against the Owner's own words", () => {
    const db = openTestSidecar();
    try {
      const owner = appendOwnerUtterance(db, {
        conversationId: "guidance-example",
        text: OWNER_TEXT,
        discordMessageIds: ["guidance-owner"],
        nowMs: 1,
      });
      admitTestCycle(db, {
        cycleId: "cycle-guidance-example",
        conversationId: "guidance-example",
        generation: 1,
        triggerKind: "owner_message",
        triggerRef: owner.rowId,
        occupantId: "doc",
        nowMs: 1,
      });
      const example = workedExample(owner.rowId);
      const parsed = parseThoughtSemanticOutput({
        kind: "settlement",
        speech: { mode: "none" },
        durableNominations: [example],
      }, new Set([owner.rowId]));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || parsed.value.kind !== "settlement") return;
      const item = parsed.value.durableNominations?.[0];
      expect(item?.memoryKind).toBe("owner_goal");
      expect(item?.supportRefs?.[0]).toMatchObject({ kind: "conversation_text_span", quote: QUOTE });
      publish(db, {
        nominationId: "nomination-guidance-example",
        cycleId: "cycle-guidance-example",
        generation: 1,
        assertionKey: "key:guidance-example",
        statement: item!.statement,
        memoryKind: item!.memoryKind,
        dimensions: item!.dimensions,
        dataClassification: item!.dataClassification,
        supersedesAssertionKey: item!.supersedesRef,
        concernId: null,
        sourceRefs: [...item!.sourceRefs],
        supportRefs: item!.supportRefs ? [...item!.supportRefs] : undefined,
        salience: item!.salience,
      });
      const result = runGovernedAdmissionCatchup(db, { nowMs: 3 });
      expect(result.admitted).toBe(1);
      const rows = db.prepare("SELECT statement FROM sidecar_memory_assertions").all() as Array<{ statement: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.statement).toBe(item!.statement);
    } finally {
      db.close();
    }
  });
});
