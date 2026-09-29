import { describe, expect, it } from "vitest";
import { MEMORY_FORMATION_GUIDANCE, thoughtOutputCompatibilityInstruction } from "./output-contract.js";
import { AUTOMATIC_ADMISSION_GROUNDING } from "../memory/grounding.js";

describe("Growth V1 memory formation guidance", () => {
  it("reaches Thought through the contract instruction", () => {
    const instruction = thoughtOutputCompatibilityInstruction();
    for (const paragraph of MEMORY_FORMATION_GUIDANCE) expect(instruction).toContain(paragraph);
  });

  it("names the grounding each Owner-facing kind needs, matching the admission rule", () => {
    const text = MEMORY_FORMATION_GUIDANCE.join(" ");
    for (const [kind, grounding] of Object.entries(AUTOMATIC_ADMISSION_GROUNDING)) {
      expect(text).toContain(kind);
      if (grounding === "owner_quote") expect(text).toMatch(new RegExp(`${kind}[^.]*conversation_text_span quoting the Owner`));
    }
  });
});
