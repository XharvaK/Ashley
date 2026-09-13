import { describe, expect, it } from "vitest";
import { parseThoughtSemanticOutput } from "./parse.js";
import { makeSemanticSettlement } from "../test-support.js";

const ALLOWLIST = new Set(["obs-page-1", "obs-image-2", "v021:observation:req-1", "turn-1"]);

const TOOL_DIMS = {
  source: "tool",
  status: "asserted",
  time: "historical",
  reliability: "fallible_observation",
};

const INTERP_DIMS = {
  source: "ashley_interpretation",
  status: "interpreted",
  time: "historical",
  reliability: "inferred",
};

function boundSettlement(draft: string, epistemic: unknown[], evidenceRefsUsed?: string[]) {
  return makeSemanticSettlement({
    speech: { mode: "draft", surfaceDraft: draft },
    commitments: { epistemic, conversational: ["answer"] },
    ...(evidenceRefsUsed === undefined ? {} : { evidenceUse: { observationRefsUsed: evidenceRefsUsed } }),
  });
}

function toolClaim(span: string, refs: string[]) {
  return {
    dimensions: { ...TOOL_DIMS },
    statement: "page-backed external claim",
    surfaceSpan: span,
    observationRefs: refs,
  };
}

describe("F2 per-claim epistemic evidence binding", () => {
  it("accepts a fully bound external claim", () => {
    const draft = "I read the Cloudflare documentation. It helped.";
    const value = boundSettlement(draft, [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])], ["obs-page-1"]);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({ ok: true });
  });

  it("accepts legacy commitments without the new optional fields", () => {
    const value = makeSemanticSettlement({});
    expect(parseThoughtSemanticOutput(value, new Set(["turn-1"]))).toMatchObject({ ok: true });
  });

  it("rejects non-array observationRefs as wrong_type", () => {
    const draft = "I read the Cloudflare documentation.";
    const claim = { dimensions: { ...TOOL_DIMS }, statement: "x", observationRefs: "obs-page-1" };
    const value = boundSettlement(draft, [claim], ["obs-page-1"]);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "wrong_type",
      field: "commitments.epistemic[0].observationRefs",
    });
  });

  it("rejects non-string observationRef items as wrong_type", () => {
    const draft = "I read the Cloudflare documentation.";
    const claim = { dimensions: { ...TOOL_DIMS }, statement: "x", observationRefs: [42] };
    const value = boundSettlement(draft, [claim], []);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "wrong_type",
      field: "commitments.epistemic[0].observationRefs[0]",
    });
  });

  it("rejects present-empty observationRefs as empty_when_present", () => {
    const draft = "I read the Cloudflare documentation.";
    const claim = { dimensions: { ...TOOL_DIMS }, statement: "x", observationRefs: [] };
    const value = boundSettlement(draft, [claim], []);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "empty_when_present",
      field: "commitments.epistemic[0].observationRefs",
    });
  });

  it("rejects well-typed non-allowlisted refs as reference_not_allowlisted", () => {
    const draft = "I read the Cloudflare documentation.";
    const claim = { dimensions: { ...TOOL_DIMS }, statement: "x", observationRefs: ["obs-forged"] };
    const value = boundSettlement(draft, [claim], ["obs-forged"]);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "reference_not_allowlisted",
      field: "commitments.epistemic[0].observationRefs[0]",
    });
  });

  it("rejects empty surfaceSpan as wrong_type", () => {
    const draft = "I read the Cloudflare documentation.";
    const claim = { dimensions: { ...TOOL_DIMS }, statement: "x", surfaceSpan: "" };
    const value = boundSettlement(draft, [claim]);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "wrong_type",
      field: "commitments.epistemic[0].surfaceSpan",
    });
  });

  it("rejects unknown commitment fields as wrong_type", () => {
    const draft = "hello";
    const claim = {
      dimensions: { ...TOOL_DIMS },
      statement: "x",
      inventedField: true,
    };
    const value = boundSettlement(draft, [claim]);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "wrong_type",
      field: "commitments.epistemic[0]",
    });
  });

  it("rejects a span absent from the authored draft as commitment_binding_invalid", () => {
    const value = boundSettlement(
      "Unrelated draft text here.",
      [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])],
      ["obs-page-1"],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[0].surfaceSpan",
    });
  });

  it("rejects a duplicated authored span as commitment_binding_invalid (F2-M)", () => {
    const value = boundSettlement(
      "I read the page. I read the page.",
      [toolClaim("I read the page.", ["obs-page-1"])],
      ["obs-page-1"],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[0].surfaceSpan",
    });
  });

  it("rejects overlapping authored occurrences as commitment_binding_invalid (F2-Q)", () => {
    const value = boundSettlement(
      "I read I read I",
      [toolClaim("I read I", ["obs-page-1"])],
      ["obs-page-1"],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[0].surfaceSpan",
    });
  });

  it("rejects overlapping authored spans as commitment_binding_invalid (F2-N)", () => {
    const value = boundSettlement(
      "I read the page and I read the article today.",
      [
        toolClaim("I read the page and I read", ["obs-page-1"]),
        { dimensions: { ...TOOL_DIMS }, statement: "y", surfaceSpan: "read the article", observationRefs: ["obs-page-1"] },
      ],
      ["obs-page-1"],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[1].surfaceSpan",
    });
  });

  it("allows a completely unbound external epistemic commitment", () => {
    const value = boundSettlement(
      "hello",
      [{ dimensions: { ...TOOL_DIMS }, statement: "an unbound external fact" }],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({ ok: true });
  });

  it("rejects an external surfaceSpan without observationRefs", () => {
    const value = boundSettlement(
      "hello",
      [{ dimensions: { ...TOOL_DIMS }, statement: "an external fact", surfaceSpan: "hello" }],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[0].observationRefs",
    });
  });

  it("rejects external observationRefs without a surfaceSpan", () => {
    const value = boundSettlement(
      "hello",
      [{ dimensions: { ...TOOL_DIMS }, statement: "an external fact", observationRefs: ["obs-page-1"] }],
      ["obs-page-1"],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[0].surfaceSpan",
    });
  });

  it("rejects claim refs missing from evidenceUse as commitment_binding_invalid (F2-K/R)", () => {
    const draft = "I read the Cloudflare documentation.";
    const value = boundSettlement(
      draft,
      [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])],
      ["obs-image-2"],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[0].observationRefs[0]",
    });
  });

  it("rejects claim refs with no evidenceUse at all as commitment_binding_invalid", () => {
    const draft = "I read the Cloudflare documentation.";
    const value = boundSettlement(draft, [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])]);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({
      ok: false,
      code: "commitment_binding_invalid",
      field: "commitments.epistemic[0].observationRefs[0]",
    });
  });

  it("allows settlement reliance strictly broader than claim refs (F2-L)", () => {
    const draft = "I read the Cloudflare documentation.";
    const value = boundSettlement(
      draft,
      [toolClaim("I read the Cloudflare documentation.", ["obs-page-1"])],
      ["obs-page-1", "obs-image-2"],
    );
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({ ok: true });
  });

  it("accepts an interpretive span without observation refs", () => {
    const draft = "yeah, I read 'online' as reachable again.";
    const value = boundSettlement(draft, [{
      dimensions: { ...INTERP_DIMS },
      statement: "Ashley interprets online as reachable",
      surfaceSpan: "I read 'online' as reachable again.",
    }]);
    expect(parseThoughtSemanticOutput(value, ALLOWLIST)).toMatchObject({ ok: true });
  });
});
