import { describe, expect, it } from "vitest";
import { isAuthorizedOwnerId } from "./owner-auth.js";

describe("owner authorization", () => {
  it("fails closed when no owner id is configured", () => {
    expect(isAuthorizedOwnerId("doc", { configuredOwnerId: "", personaEvalMode: false })).toBe(false);
    expect(isAuthorizedOwnerId("doc:persona-eval:x", { configuredOwnerId: "", personaEvalMode: true })).toBe(false);
    expect(isAuthorizedOwnerId(undefined, { configuredOwnerId: "", personaEvalMode: false })).toBe(false);
  });

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
