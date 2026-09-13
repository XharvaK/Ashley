import assert from "node:assert/strict";
import test from "node:test";
import {
  F011_STAGE_A_THRESHOLDS,
  assembleF011QualificationResult,
  buildDatasetManifest,
  decideFuseGate,
  digestJson,
  evaluateStageA,
  validateDatasetCoherence,
  validateDatasetManifest,
  validateF011QualificationResult,
} from "./f011-evidence.mjs";
import * as f011 from "./f011-evidence.mjs";

const items = [
  {
    assertionKey: "item:relevant",
    statement: "The relevant current statement",
    dimensions: { time: "current" },
    dataClassification: "never_public",
  },
  {
    assertionKey: "item:historical",
    statement: "The historical statement",
    dimensions: { time: "historical" },
    dataClassification: "never_public",
  },
  {
    assertionKey: "item:other",
    statement: "The other statement",
    dimensions: { time: "historical" },
    dataClassification: "never_public",
  },
];

const labels = {
  "item:relevant": "relevant",
  "item:historical": "irrelevant",
  "item:other": "irrelevant",
};

test("buildDatasetManifest binds exact item and label digests", () => {
  const manifest = buildDatasetManifest({
    datasetId: "fixture-test",
    sourceSchemaIdentity: "sidecar_memory_assertions.v1",
    generatorIdentity: "test-generator.v1",
    labelPolicy: "one declared relevant class",
    items,
    labels,
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
  });

  assert.equal(manifest.schema, "ashley.f011.dataset.v1");
  assert.equal(manifest.itemCount, 3);
  assert.equal(manifest.queryCount, 1);
  assert.match(manifest.labelsDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(manifest.corpusDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(manifest.queryDigest, /^sha256:[0-9a-f]{64}$/);
});

test("dataset manifest binds the query digest and refuses a digest mismatch", () => {
  const query = { queryId: "q1", terms: ["relevant"], k: 2 };
  const manifest = buildDatasetManifest({
    datasetId: "fixture-test",
    sourceSchemaIdentity: "sidecar_memory_assertions.v1",
    generatorIdentity: "test-generator.v1",
    labelPolicy: "one declared relevant class",
    items,
    labels,
    queries: [query],
  });

  assert.throws(
    () => validateDatasetManifest({ ...manifest, queryDigest: "sha256:" + "e".repeat(64) }, {
      items,
      labels,
      queries: [query],
    }),
    /dataset_manifest_mismatch/,
  );
});

test("dataset coherence requires every required query and a positive judgment", () => {
  const query = { queryId: "q1", terms: ["relevant"], k: 2 };

  assert.equal(validateDatasetCoherence({ items, labels, queries: [query] }), true);
  assert.throws(
    () => validateDatasetCoherence({
      items,
      labels,
      queries: [query],
      requiredQueries: [query, { ...query, queryId: "q2" }],
    }),
    /required_query_missing/,
  );
  assert.throws(
    () => validateDatasetCoherence({
      items,
      labels: Object.fromEntries(Object.keys(labels).map((key) => [key, "irrelevant"])),
      queries: [query],
    }),
    /query_relevance_set_empty/,
  );
  assert.throws(
    () => validateDatasetCoherence({
      items,
      labels,
      queries: [{ ...query, relevantKeys: ["item:missing"] }],
    }),
    /query_relevance_key_missing/,
  );
});

test("manifest refuses missing labels and secret fixture content", () => {
  assert.throws(
    () => buildDatasetManifest({ items, labels: { ...labels, "item:missing": "irrelevant" } }),
    /label_key_missing|label_key_set_mismatch/,
  );
  assert.throws(
    () => buildDatasetManifest({
      items: [...items, { ...items[0], assertionKey: "secret:item", dataClassification: "secret" }],
      labels: { ...labels, "secret:item": "irrelevant" },
    }),
    /private_data_in_fixture/,
  );
});

test("Stage A computes per-query metrics and does not count irrelevant output as recall", () => {
  const stageA = evaluateStageA({
    items,
    labels,
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
    rankings: [{ queryId: "q1", rankedKeys: ["item:relevant", "item:historical"] }],
    thresholds: F011_STAGE_A_THRESHOLDS,
  });

  assert.equal(stageA.observed.precisionAtK, 0.5);
  assert.equal(stageA.observed.recallAtK, 1);
  assert.equal(stageA.observed.mrr, 1);
  assert.equal(stageA.observed.requiredQueryCoverage, 1);
  assert.equal(stageA.observed.falseCurrentEvidenceCount, 0);
  assert.equal(stageA.pass, true);
  assert.equal(stageA.perQuery[0].relevantRetrieved, 1);
});

test("Stage A records unreachable Incident C precision without making it a retrieval failure", () => {
  const stageA = evaluateStageA({
    items,
    labels,
    queries: [{ queryId: "incident-c-primary", terms: ["relevant"], k: 16 }],
    rankings: [{ queryId: "incident-c-primary", rankedKeys: ["item:relevant", "item:historical", "item:other"] }],
    thresholds: F011_STAGE_A_THRESHOLDS,
    licensedMetrics: ["recallAtK", "mrr", "requiredQueryCoverage", "falseCurrentEvidenceCount"],
  });

  assert.equal(stageA.observed.precisionAtK, 1 / 16);
  assert.ok(stageA.metricResults);
  assert.equal(stageA.metricResults.precisionAtK.theoreticalMaximum, 1 / 16);
  assert.equal(stageA.metricResults.precisionAtK.applicabilityStatus, "NOT_APPLICABLE");
  assert.equal(stageA.metricResults.precisionAtK.metricStatus, "NOT_MEASURABLE");
  assert.equal(stageA.metricResults.precisionAtK.notMeasurableReason, "CONTRACT_UNREACHABLE");
  assert.equal(stageA.metricResults.recallAtK.metricStatus, "PASS");
  assert.equal(stageA.observed.recallAtK, 1);
  assert.equal(stageA.observed.mrr, 1);
  assert.equal(stageA.observed.requiredQueryCoverage, 1);
  assert.equal(stageA.observed.falseCurrentEvidenceCount, 0);
  assert.equal(stageA.pass, true);
});

function makeDensityCase() {
  const densityItems = Array.from({ length: 17 }, (_, index) => ({
    assertionKey: `density:${String(index).padStart(2, "0")}`,
    statement: index < 8
      ? `The owner explicitly plans the target sleep and tomorrow conversation record ${index}.`
      : `The owner records an unrelated historical activity ${index}.`,
    dimensions: { time: "historical" },
    dataClassification: "never_public",
  }));
  const densityLabels = Object.fromEntries(
    densityItems.map((item, index) => [item.assertionKey, index < 8 ? "relevant" : "irrelevant"]),
  );
  const relevantKeys = densityItems.slice(0, 8).map((item) => item.assertionKey);
  const irrelevantKeys = densityItems.slice(8).map((item) => item.assertionKey);
  return {
    items: densityItems,
    labels: densityLabels,
    query: {
      queryId: "relevance-density-primary",
      terms: ["target", "sleep", "tomorrow", "conversation"],
      k: 16,
      relevantKeys,
    },
    passRanking: [...relevantKeys, ...irrelevantKeys.slice(0, 8)],
    failRanking: [...relevantKeys.slice(0, 7), ...irrelevantKeys.slice(0, 9)],
  };
}

function makeIncidentCase() {
  return {
    caseId: "incident-c-primary",
    items,
    labels,
    queries: [{ queryId: "incident-c-primary", terms: ["relevant"], k: 16 }],
    rankings: [{ queryId: "incident-c-primary", rankedKeys: ["item:relevant", "item:historical", "item:other"] }],
    licensedMetrics: ["recallAtK", "mrr", "requiredQueryCoverage", "falseCurrentEvidenceCount"],
    recordedMetrics: ["precisionAtK", "recallAtK", "mrr", "requiredQueryCoverage", "falseCurrentEvidenceCount"],
  };
}

test("Stage A blocks the purity release property when no frozen case licenses applicable precision", () => {
  const evaluation = f011.evaluateStageACases?.({
    cases: [makeIncidentCase()],
    requiredMetrics: ["precisionAtK", "recallAtK", "mrr", "requiredQueryCoverage", "falseCurrentEvidenceCount"],
    thresholds: F011_STAGE_A_THRESHOLDS,
  });

  assert.ok(evaluation);
  assert.equal(evaluation.propertyResults.precisionAtK.status, "BLOCKED");
  assert.equal(evaluation.propertyResults.precisionAtK.reason, "NO_APPLICABLE_CASE");
  assert.equal(evaluation.pass, false);
});

test("Stage A requires independently licensed properties across Incident C and density cases", () => {
  const density = makeDensityCase();
  const evaluation = f011.evaluateStageACases?.({
    cases: [
      makeIncidentCase(),
      {
        caseId: "relevance-density-primary",
        items: density.items,
        labels: density.labels,
        queries: [density.query],
        rankings: [{ queryId: density.query.queryId, rankedKeys: density.passRanking }],
        licensedMetrics: ["precisionAtK"],
        recordedMetrics: ["precisionAtK"],
      },
    ],
    requiredMetrics: ["precisionAtK", "recallAtK", "mrr", "requiredQueryCoverage", "falseCurrentEvidenceCount"],
    thresholds: F011_STAGE_A_THRESHOLDS,
  });

  assert.ok(evaluation);
  assert.equal(evaluation.propertyResults.precisionAtK.status, "PASS");
  assert.equal(evaluation.propertyResults.recallAtK.status, "PASS");
  assert.equal(evaluation.propertyResults.mrr.status, "PASS");
  assert.equal(evaluation.propertyResults.requiredQueryCoverage.status, "PASS");
  assert.equal(evaluation.propertyResults.falseCurrentEvidenceCount.status, "PASS");
  assert.equal(evaluation.pass, true);
});

test("Stage A does not compensate for an applicable metric failure in another case", () => {
  const density = makeDensityCase();
  const evaluation = f011.evaluateStageACases({
    cases: [
      {
        caseId: "relevance-density-pass",
        items: density.items,
        labels: density.labels,
        queries: [density.query],
        rankings: [{ queryId: density.query.queryId, rankedKeys: density.passRanking }],
        licensedMetrics: ["precisionAtK"],
        recordedMetrics: ["precisionAtK"],
      },
      {
        caseId: "relevance-density-fail",
        items: density.items,
        labels: density.labels,
        queries: [density.query],
        rankings: [{ queryId: density.query.queryId, rankedKeys: density.failRanking }],
        licensedMetrics: ["precisionAtK"],
        recordedMetrics: ["precisionAtK"],
      },
    ],
    requiredMetrics: ["precisionAtK"],
    thresholds: F011_STAGE_A_THRESHOLDS,
  });

  assert.equal(evaluation.propertyResults.precisionAtK.status, "FAIL");
  assert.deepEqual(evaluation.propertyResults.precisionAtK.caseIds, ["relevance-density-fail"]);
  assert.equal(evaluation.pass, false);
});

test("Stage A measures applicable relevance density with ordinary Precision@16", () => {
  const density = makeDensityCase();
  const stageA = evaluateStageA({
    items: density.items,
    labels: density.labels,
    queries: [density.query],
    rankings: [{ queryId: density.query.queryId, rankedKeys: density.passRanking }],
    thresholds: F011_STAGE_A_THRESHOLDS,
    licensedMetrics: ["precisionAtK"],
  });

  assert.ok(stageA.metricResults);
  assert.equal(stageA.metricResults.precisionAtK.theoreticalMaximum, 0.5);
  assert.equal(stageA.metricResults.precisionAtK.applicabilityStatus, "APPLICABLE");
  assert.equal(stageA.metricResults.precisionAtK.metricStatus, "PASS");
  assert.equal(stageA.metricResults.precisionAtK.notMeasurableReason, null);
  assert.equal(stageA.observed.precisionAtK, 0.5);
  assert.equal(stageA.pass, true);
});

test("Stage A keeps the ordinary Precision@16 denominator when fewer than K results exist", () => {
  const density = makeDensityCase();
  const stageA = evaluateStageA({
    items: density.items,
    labels: density.labels,
    queries: [density.query],
    rankings: [{ queryId: density.query.queryId, rankedKeys: density.query.relevantKeys }],
    thresholds: F011_STAGE_A_THRESHOLDS,
    licensedMetrics: ["precisionAtK"],
  });

  assert.equal(stageA.observed.precisionAtK, 8 / 16);
  assert.equal(stageA.metricResults.precisionAtK.metricStatus, "PASS");
});

test("Stage A fails an applicable density case when only seven relevant items enter top 16", () => {
  const density = makeDensityCase();
  const stageA = evaluateStageA({
    items: density.items,
    labels: density.labels,
    queries: [density.query],
    rankings: [{ queryId: density.query.queryId, rankedKeys: density.failRanking }],
    thresholds: F011_STAGE_A_THRESHOLDS,
    licensedMetrics: ["precisionAtK"],
  });

  assert.ok(stageA.metricResults);
  assert.equal(stageA.metricResults.precisionAtK.applicabilityStatus, "APPLICABLE");
  assert.equal(stageA.metricResults.precisionAtK.metricStatus, "FAIL");
  assert.equal(stageA.observed.precisionAtK, 7 / 16);
  assert.ok(stageA.failureCodes.includes("threshold_precision_at_k"));
  assert.equal(stageA.pass, false);
});

test("Stage A refuses a query-specific relevance set containing an irrelevant label", () => {
  const stageA = evaluateStageA({
    items,
    labels,
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2, relevantKeys: ["item:historical"] }],
    rankings: [{ queryId: "q1", rankedKeys: ["item:historical", "item:other"] }],
    thresholds: F011_STAGE_A_THRESHOLDS,
  });

  assert.equal(stageA.pass, false);
  assert.equal(stageA.datasetValid, false);
  assert.ok(stageA.failureCodes.includes("query_relevance_label_invalid"));
  assert.equal(stageA.perQuery[0].precisionAtK, null);
  assert.equal(stageA.perQuery[0].recallAtK, null);
  assert.equal(stageA.perQuery[0].mrr, null);
});

test("Stage A fails closed when the frozen dataset has no relevant labels", () => {
  const stageA = evaluateStageA({
    items,
    labels: Object.fromEntries(Object.keys(labels).map((key) => [key, "irrelevant"])),
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
    rankings: [{ queryId: "q1", rankedKeys: ["item:historical", "item:other"] }],
    thresholds: F011_STAGE_A_THRESHOLDS,
  });

  assert.equal(stageA.pass, false);
  assert.ok(stageA.failureCodes.includes("no_relevant_labels"));
  assert.ok(stageA.failureCodes.includes("dataset_no_positive_relevance"));
  assert.equal(stageA.datasetValid, false);
  assert.equal(stageA.observed.precisionAtK, null);
  assert.equal(stageA.observed.recallAtK, null);
  assert.equal(stageA.observed.mrr, null);
  assert.equal(stageA.observed.requiredQueryCoverage, null);
  assert.equal(stageA.perQuery[0].precisionAtK, null);
  assert.equal(stageA.perQuery[0].mrr, null);
});

test("Fuse decision stays evidence-derived and does not invent a package", () => {
  const passGate = decideFuseGate({ stageAPass: true, falseCurrentEvidenceCount: 0 });
  assert.deepEqual(passGate, {
    needed: false,
    package: null,
    version: null,
    license: null,
    decision: "NOT_NEEDED",
  });

  const unresolvedGate = decideFuseGate({ stageAPass: false, falseCurrentEvidenceCount: 0 });
  assert.equal(unresolvedGate.decision, "NOT_REACHED");
  assert.equal(unresolvedGate.needed, false);
});

test("qualification evidence rejects Fuse owner decision before a successful Stage A", () => {
  const manifest = buildDatasetManifest({
    datasetId: "fixture-test",
    sourceSchemaIdentity: "sidecar_memory_assertions.v1",
    generatorIdentity: "test-generator.v1",
    labelPolicy: "one declared relevant class",
    items,
    labels,
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
  });
  const failedStageA = evaluateStageA({
    items,
    labels: Object.fromEntries(Object.keys(labels).map((key) => [key, "irrelevant"])),
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
    rankings: [{ queryId: "q1", rankedKeys: ["item:historical", "item:other"] }],
  });

  assert.throws(
    () => validateF011QualificationResult({
      schema: "ashley.f011.qualification.v1",
      capabilityFingerprint: "sha256:" + "a".repeat(64),
      candidate: { buildIdentity: "a".repeat(40) },
      dataset: manifest,
      querySet: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
      stageA: failedStageA,
      fuseGate: { needed: true, package: null, version: null, license: null, decision: "OWNER_DECISION_REQUIRED" },
      stageH: {
        schema: "ashley.f011.stage-h.v1",
        runId: null,
        candidateSha: "a".repeat(40),
        environment: "not_run",
        thresholds: null,
        checks: [],
        raw: {},
        pass: false,
        state: "AUTHORIZATION_REQUIRED",
      },
      verdict: "FAIL",
    }),
    /fuse_gate_evaluated_before_stage_a/,
  );
});

test("qualification result validator rejects an unsubstantiated Stage H pass", () => {
  const result = {
    schema: "ashley.f011.qualification.v1",
    capabilityFingerprint: "sha256:" + "a".repeat(64),
    dataset: {
      schema: "ashley.f011.dataset.v1",
      datasetId: "fixture-test",
      sourceSchemaIdentity: "sidecar_memory_assertions.v1",
      generatorIdentity: "test-generator.v1",
      itemCount: 3,
      queryCount: 1,
      labelPolicy: "one declared relevant class",
      labelsDigest: "sha256:" + "b".repeat(64),
      corpusDigest: "sha256:" + "c".repeat(64),
      queryDigest: digestJson([{ queryId: "q1", terms: ["relevant"], k: 2 }]),
    },
    querySet: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
    stageA: {
      thresholds: F011_STAGE_A_THRESHOLDS,
      observed: { precisionAtK: 1, recallAtK: 1, mrr: 1, requiredQueryCoverage: 1, falseCurrentEvidenceCount: 0 },
      pass: true,
      perQuery: [],
      failureCodes: [],
    },
    fuseGate: { needed: false, package: null, version: null, license: null, decision: "NOT_NEEDED" },
    stageH: { environment: "linux", checks: [], pass: true },
    verdict: "PASS",
  };

  assert.throws(() => validateF011QualificationResult(result), /stage_h_checks_missing/);
});

test("aggregate assembly links Stage A and Stage H without converting a failed stage", () => {
  const manifest = buildDatasetManifest({
    datasetId: "fixture-test",
    sourceSchemaIdentity: "sidecar_memory_assertions.v1",
    generatorIdentity: "test-generator.v1",
    labelPolicy: "one declared relevant class",
    items,
    labels,
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
  });
  const stageA = evaluateStageA({
    items,
    labels,
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
    rankings: [{ queryId: "q1", rankedKeys: ["item:relevant", "item:historical"] }],
  });
  const stageH = {
    schema: "ashley.f011.stage-h.v1",
    candidateSha: "a".repeat(40),
    environment: "linux",
    checks: [{ id: "fts5", pass: true }],
    raw: {},
    pass: true,
  };
  const result = assembleF011QualificationResult({
    capabilityFingerprint: "sha256:" + "d".repeat(64),
    candidate: { buildIdentity: "a".repeat(40) },
    manifest,
    queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
    stageA,
    fuseGate: decideFuseGate({ stageAPass: stageA.pass, falseCurrentEvidenceCount: 0 }),
    stageH,
  });

  assert.equal(result.verdict, "PASS");
  assert.equal(result.stageH.pass, true);
  assert.equal(result.stageH.checks[0].id, "fts5");
  assert.throws(
    () => assembleF011QualificationResult({
      capabilityFingerprint: "sha256:" + "d".repeat(64),
      candidate: { buildIdentity: "b".repeat(40) },
      manifest,
      queries: [{ queryId: "q1", terms: ["relevant"], k: 2 }],
      stageA,
      fuseGate: decideFuseGate({ stageAPass: stageA.pass, falseCurrentEvidenceCount: 0 }),
      stageH,
    }),
    /stage_h_candidate_mismatch/,
  );
});
