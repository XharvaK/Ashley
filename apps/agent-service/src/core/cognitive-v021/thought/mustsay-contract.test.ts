import { describe, expect, it } from "vitest";
import { thoughtOutputCompatibilityInstruction } from "./output-contract.js";
import { fidelityCheck } from "../speech/fidelity.js";

const commitments = {
  epistemic: [
    {
      dimensions: {
        source: "owner_utterance" as const,
        status: "asserted" as const,
        time: "current" as const,
        reliability: "owner_supplied" as const,
      },
      statement: "The owner asked a question",
    },
  ],
  conversational: ["answer" as const],
  stance: {
    warmth: "medium" as const,
    humorAllowed: false,
    disagreement: false,
    uncertaintyDisplay: true,
  },
};

describe("mustSay literal producer contract", () => {
  it("tells Thought that mustSay is verbatim and presentationDirectives owns behavior", () => {
    const instruction = thoughtOutputCompatibilityInstruction();
    expect(instruction).toContain("mustSay");
    expect(instruction).toContain("verbatim");
    expect(instruction).toContain("surfaceDraft");
    expect(instruction).toContain("Omit mustSay when no exact literal wording is required");
    expect(instruction).toContain("presentationDirectives");
    expect(instruction).toContain("Behavioral");
  });

  it("preserves strict checker behavior for a behavioral mustSay entry", () => {
    // Behavioral/style/procedural text in mustSay is still a literal requirement:
    // a paraphrase draft must FAIL.
    expect(
      fidelityCheck({
        mode: "draft",
        draft: "Yes — I think the important part is...",
        mustSay: ["Acknowledge the question directly"],
        mustNot: [],
        acceptableRealizations: [],
        commitments,
      }),
    ).toMatchObject({ ok: false });
  });

  it("passes the literal positive control", () => {
    expect(
      fidelityCheck({
        mode: "draft",
        draft: "This is Project Ashley in production.",
        mustSay: ["Project Ashley"],
        mustNot: [],
        acceptableRealizations: [],
        commitments,
      }),
    ).toMatchObject({ ok: true });
  });
});
