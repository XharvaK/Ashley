import { describe, expect, it } from "vitest";
import {
  buildReferenceAllowlist,
  hasReferenceTarget,
  registerLocalAlias,
  resolveReference,
} from "./reference-allowlist.js";
import { parseThoughtSemanticOutput } from "./parse.js";

describe("Thought reference allowlist", () => {
  it("fingerprints supplied references and rejects stale references", () => {
    const allowlist = buildReferenceAllowlist(["turn-1", "observation-1"]);
    expect(allowlist.fingerprint).toMatch(/^sha256:/);
    expect(resolveReference(allowlist, { kind: "existing", ref: "turn-1" })).toEqual({ ok: true, ref: "turn-1" });
    expect(resolveReference(allowlist, { kind: "existing", ref: "stale" })).toMatchObject({ ok: false, code: "reference_not_allowlisted" });
  });

  it("requires unique local aliases and never resolves them as existing references", () => {
    const allowlist = buildReferenceAllowlist(["turn-1"]);
    registerLocalAlias(allowlist, "new_concern");
    expect(() => registerLocalAlias(allowlist, "new_concern")).toThrow("alias_duplicate");
    expect(() => registerLocalAlias(allowlist, "turn-1")).toThrow("alias_collides_with_existing_ref");
  });

  it("rejects only a positively known target mismatch and preserves opaque refs", () => {
    const allowlist = buildReferenceAllowlist(
      ["concern-1", "observation-1", "opaque-1"],
      new Map([
        ["concern-1", ["concern"]],
        ["observation-1", ["observation"]],
      ]),
    );
    expect(hasReferenceTarget(allowlist, "concern-1", "concern")).toBe(true);
    expect(hasReferenceTarget(allowlist, "observation-1", "concern")).toBe(false);
    expect(hasReferenceTarget(allowlist, "opaque-1", "concern")).toBe(true);
  });

  it("keeps inspect and discover authority out of settlement write authority", () => {
    const ordinary = new Set(["owner-1"]);
    const inspect = new Set(["concern-dormant"]);
    expect(parseThoughtSemanticOutput({
      kind: "settlement",
      speech: { mode: "none" },
      concernDeltas: [{
        op: "upsert",
        record: {
          identity: { kind: "existing", ref: "concern-dormant" },
          statement: "inspect must not authorize write",
          sourceTurnRefs: [],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          status: "active",
        },
      }],
    }, ordinary)).toMatchObject({ ok: false, code: "wrong_type", field: "concernDeltas" });
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "concern.inspect",
      request: { concernRef: "concern-dormant" },
      purpose: "read one dormant meaning",
      evidenceNeed: "the canonical statement",
      existingRefs: ["concern-dormant"],
    }, ordinary, { concernInspectRefs: inspect })).toMatchObject({
      ok: false,
      code: "reference_not_allowlisted",
      field: "existingRefs",
    });
    expect(parseThoughtSemanticOutput({
      kind: "observation_intent",
      operationKind: "concern.inspect",
      request: { discover: {} },
      purpose: "list inspectable concerns",
      evidenceNeed: "the bounded id page",
      existingRefs: ["concern-dormant"],
    }, ordinary, { concernInspectRefs: inspect, concernDiscoverAllowed: true })).toMatchObject({
      ok: false,
      code: "reference_not_allowlisted",
      field: "existingRefs",
    });
  });
});
