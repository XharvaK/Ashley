import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  F011_STAGE_A_THRESHOLDS,
  digestJson,
  evaluateStageACases,
  prepareF011StageACases,
  readJson,
  validateF011StageACaseSet,
  validateF011StageACasesEvidence,
} from "./f011-evidence.mjs";

const fixtureRoot = fileURLToPath(new URL(
  "../../apps/agent-service/src/core/cognitive-v021/retrieval/fixtures/",
  import.meta.url,
));

const items = readJson(`${fixtureRoot}f011-relevance-density.json`);
const labels = readJson(`${fixtureRoot}f011-relevance-density-labels.json`);
const queries = readJson(`${fixtureRoot}f011-relevance-density-query.json`);
const rubric = readJson(`${fixtureRoot}f011-relevance-density-rubric.json`);
const caseSet = readJson(`${fixtureRoot}f011-stage-a-case-set.json`);

test("density fixture labels are derived from the frozen rubric without candidate knowledge", () => {
  assert.equal(rubric.schema, "ashley.f011.relevance-density.rubric.v1");
  assert.equal(rubric.labelConstruction.method, "deterministic_statement_template");
  assert.equal(rubric.labelConstruction.candidateResultsUsed, false);
  assert.equal(rubric.labelConstruction.postResultRelabeling, false);
  assert.equal(items.length, 17);
  assert.ok(items.length > queries[0].k);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].k, 16);
  assert.equal(queries[0].relevantKeys.length, 8);

  const itemKeys = items.map((item) => item.assertionKey);
  assert.equal(new Set(itemKeys).size, itemKeys.length);
  assert.deepEqual(Object.keys(labels).sort(), [...itemKeys].sort());

  for (const item of items) {
    assert.equal(Object.hasOwn(item, "rank"), false);
    assert.equal(Object.hasOwn(item, "score"), false);
    const expectedLabel = item.statement.startsWith(rubric.relevantStatementPrefix)
      ? "relevant"
      : item.statement.startsWith(rubric.irrelevantStatementPrefix)
        ? "irrelevant"
        : null;
    assert.notEqual(expectedLabel, null, `unclassified fixture item: ${item.assertionKey}`);
    assert.equal(labels[item.assertionKey], expectedLabel);
  }

  assert.equal(Object.values(labels).filter((label) => label === "relevant").length, 8);
  assert.equal(Object.values(labels).filter((label) => label === "irrelevant").length, 9);
  assert.deepEqual(
    [...queries[0].relevantKeys].sort(),
    itemKeys.filter((key) => labels[key] === "relevant").sort(),
  );
});

test("density fixture digests are stable inputs for the later case-set freeze", () => {
  assert.match(digestJson(items), /^sha256:[0-9a-f]{64}$/);
  assert.match(digestJson(labels), /^sha256:[0-9a-f]{64}$/);
  assert.match(digestJson(queries), /^sha256:[0-9a-f]{64}$/);
  assert.match(digestJson(rubric), /^sha256:[0-9a-f]{64}$/);
});

test("Stage A case set is frozen and eligible before candidate evaluation", () => {
  assert.equal(caseSet.schema, "ashley.f011.stage-a.case-set.v1");
  assert.equal(caseSet.freeze.status, "FROZEN");
  assert.equal(caseSet.freeze.labelsFrozenBeforeCandidateEvaluation, true);
  assert.equal(caseSet.freeze.candidateResultsAvailableAtFreeze, false);
  assert.equal(caseSet.freeze.candidateRanksOrScoresInspectedAtFreeze, false);
  assert.equal(caseSet.freeze.runtimeRetrievalBehaviorChanged, false);
  assert.equal(caseSet.freeze.denominator, "K");
  assert.equal(caseSet.freeze.precisionK, 16);
  assert.deepEqual(caseSet.thresholds, F011_STAGE_A_THRESHOLDS);
  assert.equal(caseSet.cases.length, 2);

  const incident = caseSet.cases.find((stageACase) => stageACase.caseId === "incident-c-primary");
  const density = caseSet.cases.find((stageACase) => stageACase.caseId === "relevance-density-primary");
  assert.ok(incident);
  assert.ok(density);

  assert.equal(incident.dataset.corpusDigest, "sha256:0aeb44e6f5a3556a2518594e0ae909c0693c97e6e69b0eb6be9ffc1b93503499");
  assert.equal(incident.dataset.labelsDigest, "sha256:0dc5152d206cfce8938d04f3b4c857de801e8a5f0694b28249b03339bdfad4c2");
  assert.equal(incident.dataset.queryDigest, digestJson(incident.querySet));
  assert.equal(incident.theoreticalMaximum.precisionAtK, 1 / 16);
  assert.equal(incident.applicabilityPrecondition.precisionAtK.status, "NOT_APPLICABLE");
  assert.equal(incident.applicabilityPrecondition.precisionAtK.reason, "CONTRACT_UNREACHABLE");

  assert.equal(density.dataset.itemCount, 17);
  assert.ok(density.dataset.itemCount > density.querySet[0].k);
  assert.equal(density.dataset.relevantJudgmentCount, 8);
  assert.equal(density.dataset.corpusDigest, digestJson(items));
  assert.equal(density.dataset.labelsDigest, digestJson(labels));
  assert.equal(density.dataset.queryDigest, digestJson(queries));
  assert.equal(density.dataset.rubricDigest, digestJson(rubric));
  assert.deepEqual(density.querySet, queries);
  assert.deepEqual(density.licensedMetrics, ["precisionAtK"]);
  assert.equal(density.thresholds.precisionAtK, 0.5);
  assert.equal(density.theoreticalMaximum.precisionAtK, 0.5);
  assert.equal(density.applicabilityPrecondition.precisionAtK.status, "APPLICABLE");
  assert.equal(density.applicabilityPrecondition.precisionAtK.reason, null);
  assert.equal(validateF011StageACaseSet(caseSet, { repoRoot: process.cwd() }), true);
  const prepared = prepareF011StageACases({ repoRoot: process.cwd() });
  assert.equal(prepared.caseSet.caseSetId, "f011-stage-a-case-set-v1");
  assert.deepEqual(
    prepared.cases.map((stageACase) => stageACase.caseId),
    ["incident-c-primary", "relevance-density-primary"],
  );
});

test("Stage A case evidence carries independent declarations and metric statuses", () => {
  const prepared = prepareF011StageACases({ repoRoot: process.cwd() });
  const incident = prepared.cases[0];
  const density = prepared.cases[1];
  const incidentRelevantKey = Object.entries(incident.labels).find(([, label]) => label === "relevant")?.[0];
  const densityRelevantKeys = density.queries[0].relevantKeys;
  const densityIrrelevantKeys = density.items
    .map((item) => item.assertionKey)
    .filter((key) => !densityRelevantKeys.includes(key));
  const evaluated = evaluateStageACases({
    cases: [
      {
        ...incident,
        rankings: [{ queryId: incident.queries[0].queryId, rankedKeys: [incidentRelevantKey] }],
      },
      {
        ...density,
        rankings: [{
          queryId: density.queries[0].queryId,
          rankedKeys: [...densityRelevantKeys, ...densityIrrelevantKeys.slice(0, 8)],
        }],
      },
    ],
    requiredMetrics: prepared.caseSet.requiredMetrics,
    thresholds: prepared.caseSet.thresholds,
  });
  const stageA = {
    ...evaluated,
    schema: "ashley.f011.stage-a.cases.v1",
    caseSetId: prepared.caseSet.caseSetId,
  };
  assert.equal(validateF011StageACasesEvidence(stageA, prepared.caseSet), true);
  const incidentEvidence = stageA.cases.find((stageACase) => stageACase.caseId === "incident-c-primary");
  assert.equal(incidentEvidence.metricResults.precisionAtK.metricStatus, "NOT_MEASURABLE");
  assert.equal(incidentEvidence.metricResults.precisionAtK.notMeasurableReason, "CONTRACT_UNREACHABLE");
  assert.equal(incidentEvidence.metricStatus.precisionAtK, "NOT_MEASURABLE");
  assert.equal(incidentEvidence.applicabilityStatus.precisionAtK, "NOT_APPLICABLE");
  assert.equal(incidentEvidence.notMeasurableReason.precisionAtK, "CONTRACT_UNREACHABLE");
});
