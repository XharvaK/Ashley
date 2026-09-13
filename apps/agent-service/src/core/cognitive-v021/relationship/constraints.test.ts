import { describe, expect, it } from "vitest";
import { buildInjectedRelationalConstraintView, relationalBoundaryCodes } from "./constraints.js";

describe("v0.2.1 relational constraint view", () => {
  it("converts injected constraints into Authority objections", () => {
    const view = buildInjectedRelationalConstraintView({ neverMention: ["private project"], withdrawalActive: false });
    expect(view.neverMention).toEqual(["private project"]);
    expect(relationalBoundaryCodes("Discuss the private project now.", view)).toEqual(["RELATIONAL_BOUNDARY"]);
  });
});
