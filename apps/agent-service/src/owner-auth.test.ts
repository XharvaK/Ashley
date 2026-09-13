import { describe, expect, it } from "vitest";
import { isAuthorizedOwnerId } from "./owner-auth.js";

describe("owner authorization", () => {
  it("allows scoped evaluation owners only in explicit evaluation mode", () => {
    const scoped = "doc:persona-eval:release:probe:1";
    expect(isAuthorizedOwnerId(scoped, {
      configuredOwnerId: "doc",
      personaEvalMode: true,
    })).toBe(true);
    expect(isAuthorizedOwnerId(scoped, {
      configuredOwnerId: "doc",
      personaEvalMode: false,
    })).toBe(false);
    expect(isAuthorizedOwnerId("attacker:persona-eval:x", {
      configuredOwnerId: "doc",
      personaEvalMode: true,
    })).toBe(false);
  });
});
