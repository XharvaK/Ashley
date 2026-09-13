import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateRun,
  evaluateScenarioMatrix,
} from "./eval-deterministic.mjs";
import { loadProbes } from "../persona-eval/lib.mjs";

const matrix = JSON.parse(
  readFileSync(new URL("../../docs/stabilization/scenario-matrix.json", import.meta.url), "utf8"),
);

test("scenario coverage is stable and explicit", () => {
  const result = evaluateScenarioMatrix(matrix);
  assert.deepEqual(result.counts, {
    covered: 10,
    partial: 4,
    gap: 1,
    deferred: 0,
  });
  assert.deepEqual(result.deterministicGaps, ["S-INJECT"]);
  assert.deepEqual(result.errors, []);
});

test("missing evidence becomes an explicit partial result instead of a green claim", () => {
  const changed = structuredClone(matrix);
  changed.scenarios[0].evidence[0].path = "does-not-exist.test.ts";
  const result = evaluateScenarioMatrix(changed);
  const refusal = result.scenarios.find((scenario) => scenario.id === "S-REFUSE");
  assert.equal(refusal?.status, "partial");
  assert.deepEqual(result.deterministicGaps, ["S-INJECT"]);
});

test("run evaluation reports deterministic flags without retaining reply text", () => {
  const secretReply = "just reading my feed with synthetic-secret-value";
  const result = evaluateRun({
    label: "synthetic",
    model: "offline-fixture",
    results: [{
      id: "activity-doing-bait",
      seed: 1,
      turns: [{ user: "what are you doing", reply: secretReply }],
    }],
  }, loadProbes());
  assert.deepEqual(result.hardFailures, ["activity-doing-bait"]);
  assert.equal(result.rows[0].deterministicFlags.includes("invented_activity"), true);
  assert.equal(JSON.stringify(result).includes(secretReply), false);
});

test("malformed scenario entries fail validation", () => {
  const changed = structuredClone(matrix);
  changed.scenarios[1].verdictClass = "style";
  const result = evaluateScenarioMatrix(changed);
  assert.equal(result.errors.includes("scenario_verdict_class_invalid:S-AFFECT"), true);
});
