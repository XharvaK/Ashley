import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderReview } from "./identity.js";

describe("identity command", () => {
  it("shows a foundational revision with what it replaces, Ashley's position, and its evidence", () => {
    const rendered = renderReview({
      id: 7,
      revisionId: 7,
      targetKind: "value",
      targetKey: "uncertainty",
      proposedValue: "comfortable with uncertainty, and says so plainly",
      previousValue: "comfortable with uncertainty",
      ashleyPosition: "affirm",
      ashleyRationale: "I keep hedging less and it lands better.",
      docDecision: null,
      evidenceCount: 3,
      appliedAt: null,
      status: "proposed",
    });
    assert.equal(rendered, [
      "#7 value: uncertainty",
      "was: comfortable with uncertainty",
      "comfortable with uncertainty, and says so plainly",
      "Ashley: I keep hedging less and it lands better.",
      "Ashley: affirm; Alex: pending; evidence: 3",
    ].join("\n"));
  });
});

describe("P7b dimensions", () => {
  it("lists dimensions and recent history", async () => {
    const identity = await import("./identity.js") as typeof import("./identity.js");
    const rendered = identity.renderDimensions(
      [{ id: "d1", name: "Sustained inquiry", question: "Did I follow a question past its first answer?", status: "active", origin: "owner_seed" }],
      [{ historyId: "h1", dimensionId: "d1", op: "add", actor: "owner", reason: "owner seed", createdAtMs: 1 }],
    );
    assert.match(rendered, /Sustained inquiry: Did I follow a question past its first answer\?/);
    assert.match(rendered, /add by owner: owner seed/);
  });
});

describe("A3b practice view", () => {
  it("renders earned practices with revision identifiers for reversion", async () => {
    const identity = await import("./identity.js") as any;
    assert.equal(typeof identity.renderPractices, "function", "practice renderer exists");
    assert.match(identity.renderPractices([{ revisionId: 8, text: "Check evidence", heldSinceMs: 1 }]), /#8.*Check evidence/);
  });
});
