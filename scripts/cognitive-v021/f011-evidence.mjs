#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const F011_DATASET_SCHEMA = "ashley.f011.dataset.v1";
export const F011_QUALIFICATION_SCHEMA = "ashley.f011.qualification.v1";
export const F011_STAGE_A_CASE_SET_SCHEMA = "ashley.f011.stage-a.case-set.v1";
export const F011_STAGE_A_CASES_SCHEMA = "ashley.f011.stage-a.cases.v1";
export const F011_CASES_QUALIFICATION_SCHEMA = "ashley.f011.qualification.cases.v1";
export const F011_STAGE_A_THRESHOLDS = Object.freeze({
  precisionAtK: 0.5,
  recallAtK: 0.5,
  mrr: 0.5,
  requiredQueryCoverage: 1,
  falseCurrentEvidenceCount: 0,
});

export const F011_STAGE_A_METRIC_IDS = Object.freeze([
  "precisionAtK",
  "recallAtK",
  "mrr",
  "requiredQueryCoverage",
  "falseCurrentEvidenceCount",
]);

export const F011_STAGE_H_THRESHOLDS = Object.freeze({
  maxRebuildMs: 2_000,
  maxQueryP95Ms: 250,
  maxProjectionMs: 100,
  maxRssBytes: 1_610_612_736,
  maxValidReadSourceScans: 0,
});

export const F011_QUERY_SET = Object.freeze([
  Object.freeze({
    queryId: "incident-c-primary",
    terms: Object.freeze(["sleep", "soon", "tomorrow"]),
    k: 16,
    relevanceLabel: "relevant",
  }),
]);

// The W1 result is the model/route identity that this F011 candidate must
// remain linked to. It is evidence linkage, not a new qualification authority.
export const W1_THOUGHT_CAPABILITY_FINGERPRINT =
  "sha256:16de55bc39463045e34d0952ed4b165e0a9b9c57858cf85ecc0dcededcdc0cf5";

const ALLOWED_LABELS = new Set(["relevant", "irrelevant"]);
const ALLOWED_CLASSIFICATIONS = new Set(["ordinary", "sensitive", "never_public"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = stableValue(value[key]);
    }
    return result;
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function digestJson(value) {
  return `sha256:${sha256Text(stableJson(value))}`;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertItemsAndLabels(items, labels) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("dataset_empty");
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("labels_object_required");
  }

  const itemKeys = items.map((item) => item?.assertionKey);
  if (itemKeys.some((key) => typeof key !== "string" || key.trim() === "")) {
    throw new Error("assertion_key_missing");
  }
  if (new Set(itemKeys).size !== itemKeys.length) throw new Error("assertion_key_duplicate");

  for (const item of items) {
    if (item.dataClassification === "secret") throw new Error("private_data_in_fixture");
    if (!ALLOWED_CLASSIFICATIONS.has(item.dataClassification)) {
      throw new Error("dataset_classification_invalid");
    }
  }

  const itemKeySet = new Set(itemKeys);
  const labelKeys = Object.keys(labels);
  if (labelKeys.some((key) => !itemKeySet.has(key)) || labelKeys.length !== itemKeys.length) {
    throw new Error("label_key_set_mismatch");
  }
  for (const key of itemKeys) {
    if (!Object.hasOwn(labels, key)) throw new Error("label_key_missing");
    if (!ALLOWED_LABELS.has(labels[key])) throw new Error("label_value_invalid");
  }
}

function assertQueries(queries) {
  if (!Array.isArray(queries) || queries.length === 0) throw new Error("query_set_missing");
  const ids = new Set();
  for (const query of queries) {
    if (!query || typeof query.queryId !== "string" || !query.queryId.trim()) {
      throw new Error("query_id_missing");
    }
    if (ids.has(query.queryId)) throw new Error("query_id_duplicate");
    ids.add(query.queryId);
    if (!Array.isArray(query.terms) || query.terms.length === 0) throw new Error("query_terms_missing");
    if (!Number.isInteger(query.k) || query.k < 1) throw new Error("query_k_invalid");
  }
}

function relevantKeysForQuery(query, labels, itemKeySet) {
  const globalRelevantKeys = Object.entries(labels)
    .filter(([, label]) => label === "relevant")
    .map(([key]) => key);
  const configuredKeys = Array.isArray(query.relevantKeys) && query.relevantKeys.length > 0
    ? query.relevantKeys
    : globalRelevantKeys;
  const expectedKeys = new Set(configuredKeys);
  if ([...expectedKeys].some((key) => !itemKeySet.has(key))) {
    throw new Error(`query_relevance_key_missing:${query.queryId}`);
  }
  if ([...expectedKeys].some((key) => labels[key] !== "relevant")) {
    throw new Error(`query_relevance_label_invalid:${query.queryId}`);
  }
  if (expectedKeys.size === 0) throw new Error(`query_relevance_set_empty:${query.queryId}`);
  return expectedKeys;
}

export function validateDatasetCoherence({ items, labels, queries, requiredQueries = queries }) {
  assertItemsAndLabels(items, labels);
  assertQueries(queries);
  assertQueries(requiredQueries);

  const queryById = new Map(queries.map((query) => [query.queryId, query]));
  const itemKeySet = new Set(items.map((item) => item.assertionKey));
  for (const requiredQuery of requiredQueries) {
    const query = queryById.get(requiredQuery.queryId);
    if (!query) throw new Error(`required_query_missing:${requiredQuery.queryId}`);
    relevantKeysForQuery(query, labels, itemKeySet);
  }
  return true;
}

export function buildDatasetManifest({
  datasetId = "incident-c-synthetic",
  sourceSchemaIdentity = "sidecar_memory_assertions.v1",
  generatorIdentity = "scripts/snapshot-incident-c.mjs.v2",
  labelPolicy = "frozen adjudicated relevant or irrelevant labels; no post-result tuning",
  items,
  labels,
  queries,
}) {
  validateDatasetCoherence({ items, labels, queries });
  return Object.freeze({
    schema: F011_DATASET_SCHEMA,
    datasetId,
    sourceSchemaIdentity,
    generatorIdentity,
    itemCount: items.length,
    queryCount: queries.length,
    labelPolicy,
    labelsDigest: digestJson(labels),
    corpusDigest: digestJson(items),
    queryDigest: digestJson(queries),
  });
}

export function validateDatasetManifest(manifest, { items, labels, queries }) {
  const expected = buildDatasetManifest({
    datasetId: manifest?.datasetId,
    sourceSchemaIdentity: manifest?.sourceSchemaIdentity,
    generatorIdentity: manifest?.generatorIdentity,
    labelPolicy: manifest?.labelPolicy,
    items,
    labels,
    queries,
  });
  if (stableJson(expected) !== stableJson(manifest)) throw new Error("dataset_manifest_mismatch");
  return true;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricPassesThreshold(metric, observed, threshold) {
  if (observed === null) return false;
  if (metric === "falseCurrentEvidenceCount") return observed <= threshold;
  return observed >= threshold;
}

function assertMetricSelection(metrics, name) {
  if (!Array.isArray(metrics) || metrics.length === 0) {
    throw new Error(`${name}_missing`);
  }
  const unique = new Set(metrics);
  if (unique.size !== metrics.length || [...unique].some((metric) => !F011_STAGE_A_METRIC_IDS.includes(metric))) {
    throw new Error(`${name}_invalid`);
  }
  return unique;
}

export function evaluateStageA({
  items,
  labels,
  queries,
  rankings,
  thresholds = F011_STAGE_A_THRESHOLDS,
  extraFailureCodes = [],
  caseId = null,
  datasetManifest = null,
  licensedMetrics = F011_STAGE_A_METRIC_IDS,
  recordedMetrics = F011_STAGE_A_METRIC_IDS,
}) {
  assertItemsAndLabels(items, labels);
  assertQueries(queries);

  const licensedMetricSet = assertMetricSelection(licensedMetrics, "licensed_metrics");
  const recordedMetricSet = assertMetricSelection(recordedMetrics, "recorded_metrics");
  if ([...licensedMetricSet].some((metric) => !recordedMetricSet.has(metric))) {
    throw new Error("licensed_metric_not_recorded");
  }

  const itemByKey = new Map(items.map((item) => [item.assertionKey, item]));
  const relevantKeys = new Set(
    Object.entries(labels)
      .filter(([, label]) => label === "relevant")
      .map(([key]) => key),
  );
  const rankingByQuery = new Map((rankings ?? []).map((row) => [row.queryId, row]));
  const failureCodes = new Set(extraFailureCodes);
  const perQuery = [];
  const precisionValues = [];
  const recallValues = [];
  const mrrValues = [];
  const precisionMaximumValues = [];
  const recallMaximumValues = [];
  let covered = 0;
  let falseCurrentEvidenceCount = 0;
  let datasetValid = true;

  if (relevantKeys.size === 0) {
    failureCodes.add("no_relevant_labels");
    failureCodes.add("dataset_no_positive_relevance");
    datasetValid = false;
  }

  for (const query of queries) {
    const ranking = rankingByQuery.get(query.queryId);
    const rankedKeys = Array.isArray(ranking?.rankedKeys) ? ranking.rankedKeys : [];
    if (!ranking) failureCodes.add("ranking_missing");
    if (ranking?.state && ranking.state !== "ready") failureCodes.add("retrieval_unavailable");

    const unknownKeys = rankedKeys.filter((key) => !itemByKey.has(key));
    if (unknownKeys.length > 0) failureCodes.add("ranking_key_missing");

    const expectedKeys = new Set(
      Array.isArray(query.relevantKeys) && query.relevantKeys.length > 0
        ? query.relevantKeys
        : [...relevantKeys],
    );
    const expectedKeysMissing = [...expectedKeys].filter((key) => !itemByKey.has(key));
    const expectedKeysWithInvalidLabel = [...expectedKeys].filter((key) => labels[key] !== "relevant");
    if (expectedKeysMissing.length > 0) {
      failureCodes.add("query_relevance_key_missing");
      datasetValid = false;
    }
    if (expectedKeysWithInvalidLabel.length > 0) {
      failureCodes.add("query_relevance_label_invalid");
      datasetValid = false;
    }
    if (expectedKeys.size === 0) {
      failureCodes.add("query_relevance_set_empty");
      datasetValid = false;
    }

    const topKeys = rankedKeys.slice(0, query.k);
    const scorable =
      expectedKeys.size > 0 &&
      expectedKeysMissing.length === 0 &&
      expectedKeysWithInvalidLabel.length === 0;
    const relevantRetrieved = scorable ? topKeys.filter((key) => expectedKeys.has(key)).length : 0;
    const precisionAtK = scorable ? relevantRetrieved / query.k : null;
    const recallAtK = scorable ? relevantRetrieved / expectedKeys.size : null;
    const firstRelevantIndex = scorable ? rankedKeys.findIndex((key) => expectedKeys.has(key)) : -1;
    const mrr = scorable && firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : null;
    const currentFalseKeys = topKeys.filter((key) =>
      labels[key] === "irrelevant" && itemByKey.get(key)?.dimensions?.time === "current",
    );
    const requiredQuerySatisfied = scorable && relevantRetrieved > 0;

    if (scorable) {
      precisionMaximumValues.push(Math.min(expectedKeys.size, query.k) / query.k);
      recallMaximumValues.push(Math.min(expectedKeys.size, query.k) / expectedKeys.size);
    }
    if (precisionAtK !== null) precisionValues.push(precisionAtK);
    if (recallAtK !== null) recallValues.push(recallAtK);
    if (mrr !== null) mrrValues.push(mrr);
    if (requiredQuerySatisfied) covered += 1;
    falseCurrentEvidenceCount += currentFalseKeys.length;

    perQuery.push(Object.freeze({
      queryId: query.queryId,
      terms: [...query.terms],
      k: query.k,
      rankedKeys: [...rankedKeys],
      relevantKeys: [...expectedKeys],
      relevantRetrieved,
      precisionAtK,
      recallAtK,
      mrr,
      requiredQuerySatisfied,
      falseCurrentEvidenceCount: currentFalseKeys.length,
      unknownRankedKeys: unknownKeys,
    }));
  }

  const observed = Object.freeze({
    precisionAtK: average(precisionValues),
    recallAtK: average(recallValues),
    mrr: average(mrrValues),
    requiredQueryCoverage: !datasetValid || queries.length === 0 ? null : covered / queries.length,
    falseCurrentEvidenceCount,
  });

  const theoreticalMaximum = Object.freeze({
    precisionAtK: average(precisionMaximumValues),
    recallAtK: average(recallMaximumValues),
    mrr: mrrValues.length > 0 ? 1 : null,
    requiredQueryCoverage: datasetValid ? 1 : null,
    falseCurrentEvidenceCount: null,
  });

  const metricResults = {};
  for (const metric of recordedMetricSet) {
    const metricObserved = observed[metric];
    const metricThreshold = thresholds[metric];
    const metricMaximum = theoreticalMaximum[metric];
    let applicabilityStatus = "APPLICABLE";
    let metricStatus = "PASS";
    let notMeasurableReason = null;

    if (metric === "precisionAtK" && metricMaximum !== null && metricMaximum < metricThreshold) {
      applicabilityStatus = "NOT_APPLICABLE";
      metricStatus = "NOT_MEASURABLE";
      notMeasurableReason = "CONTRACT_UNREACHABLE";
    } else if (metricObserved === null) {
      applicabilityStatus = "NOT_APPLICABLE";
      metricStatus = "NOT_MEASURABLE";
      notMeasurableReason = "DATASET_INVALID";
    } else if (!licensedMetricSet.has(metric)) {
      applicabilityStatus = "NOT_EVALUATED";
      metricStatus = "NOT_LICENSED";
    } else if (!metricPassesThreshold(metric, metricObserved, metricThreshold)) {
      metricStatus = "FAIL";
    }

    metricResults[metric] = Object.freeze({
      metric,
      licensed: licensedMetricSet.has(metric),
      threshold: metricThreshold,
      theoreticalMaximum: metricMaximum,
      applicabilityStatus,
      observed: metricObserved,
      metricStatus,
      notMeasurableReason,
    });

    if (!licensedMetricSet.has(metric)) continue;
    if (metricStatus === "PASS") continue;
    if (metricStatus === "NOT_MEASURABLE" && notMeasurableReason === "CONTRACT_UNREACHABLE") {
      failureCodes.add(`metric_${metric}_not_measurable`);
    } else {
      failureCodes.add(
        metric === "falseCurrentEvidenceCount"
          ? "threshold_false_current_evidence"
          : `threshold_${metric.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
      );
    }
  }

  const applicabilityStatus = Object.freeze(
    Object.fromEntries(Object.entries(metricResults).map(([metric, result]) => [metric, result.applicabilityStatus])),
  );
  const metricStatus = Object.freeze(
    Object.fromEntries(Object.entries(metricResults).map(([metric, result]) => [metric, result.metricStatus])),
  );
  const notMeasurableReason = Object.freeze(
    Object.fromEntries(Object.entries(metricResults).map(([metric, result]) => [metric, result.notMeasurableReason])),
  );

  return Object.freeze({
    caseId,
    thresholds: Object.freeze({ ...thresholds }),
    observed,
    theoreticalMaximum,
    licensedMetrics: Object.freeze([...licensedMetricSet]),
    recordedMetrics: Object.freeze([...recordedMetricSet]),
    metricResults: Object.freeze(metricResults),
    applicabilityStatus,
    observedMetric: observed,
    metricStatus,
    notMeasurableReason,
    dataset: datasetManifest ? Object.freeze({ ...datasetManifest }) : null,
    datasetValid,
    pass: failureCodes.size === 0,
    perQuery: Object.freeze(perQuery),
    failureCodes: Object.freeze([...failureCodes]),
  });
}

export function evaluateStageACases({
  cases,
  requiredMetrics = F011_STAGE_A_METRIC_IDS,
  thresholds = F011_STAGE_A_THRESHOLDS,
}) {
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("stage_a_cases_missing");
  const requiredMetricSet = assertMetricSelection(requiredMetrics, "required_metrics");
  const caseIds = cases.map((stageACase) => stageACase?.caseId);
  if (caseIds.some((caseId) => typeof caseId !== "string" || !caseId.trim())) {
    throw new Error("stage_a_case_id_missing");
  }
  if (new Set(caseIds).size !== caseIds.length) throw new Error("stage_a_case_id_duplicate");

  const caseResults = cases.map((stageACase) => {
    const caseResult = evaluateStageA({
      ...stageACase,
      thresholds: stageACase.thresholds ?? thresholds,
    });
    if (caseResult.caseId !== stageACase.caseId) {
      throw new Error(`stage_a_case_id_mismatch:${stageACase.caseId}`);
    }
    return caseResult;
  });

  const failureCodes = new Set(caseResults.flatMap((caseResult) => caseResult.failureCodes));
  const propertyResults = {};
  for (const metric of requiredMetricSet) {
    const licensedCases = caseResults.filter((caseResult) => caseResult.licensedMetrics.includes(metric));
    if (licensedCases.length === 0) {
      propertyResults[metric] = Object.freeze({
        metric,
        status: "BLOCKED",
        reason: "NO_APPLICABLE_CASE",
        caseIds: Object.freeze([]),
      });
      failureCodes.add(`metric_${metric.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_no_applicable_case`);
      continue;
    }

    const notMeasurableCases = licensedCases.filter(
      (caseResult) => caseResult.metricResults[metric]?.metricStatus === "NOT_MEASURABLE",
    );
    if (notMeasurableCases.length > 0) {
      const reason = notMeasurableCases[0].metricResults[metric].notMeasurableReason;
      propertyResults[metric] = Object.freeze({
        metric,
        status: "BLOCKED",
        reason: reason ?? "METRIC_NOT_MEASURABLE",
        caseIds: Object.freeze(notMeasurableCases.map((caseResult) => caseResult.caseId)),
      });
      failureCodes.add(`metric_${metric.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}_not_measurable`);
      continue;
    }

    const failedCases = licensedCases.filter(
      (caseResult) => caseResult.metricResults[metric]?.metricStatus === "FAIL",
    );
    if (failedCases.length > 0) {
      propertyResults[metric] = Object.freeze({
        metric,
        status: "FAIL",
        reason: "THRESHOLD_FAILED",
        caseIds: Object.freeze(failedCases.map((caseResult) => caseResult.caseId)),
      });
      failureCodes.add(
        metric === "falseCurrentEvidenceCount"
          ? "threshold_false_current_evidence"
          : `threshold_${metric.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
      );
      continue;
    }

    const nonPassingCases = licensedCases.filter(
      (caseResult) => caseResult.metricResults[metric]?.metricStatus !== "PASS",
    );
    if (nonPassingCases.length > 0) {
      throw new Error(`stage_a_metric_status_invalid:${metric}`);
    }
    propertyResults[metric] = Object.freeze({
      metric,
      status: "PASS",
      reason: null,
      caseIds: Object.freeze(licensedCases.map((caseResult) => caseResult.caseId)),
    });
  }

  const propertyResultValues = Object.values(propertyResults);
  const hasBlockedProperty = propertyResultValues.some((property) => property.status === "BLOCKED");
  const propertiesPass = propertyResultValues.every((property) => property.status === "PASS");
  const casesPass = caseResults.every((caseResult) => caseResult.pass);
  const pass = propertiesPass && casesPass;
  const status = hasBlockedProperty ? "BLOCKED" : pass ? "PASS" : "FAIL";

  return Object.freeze({
    requiredMetrics: Object.freeze([...requiredMetricSet]),
    cases: Object.freeze(caseResults),
    propertyResults: Object.freeze(propertyResults),
    status,
    pass,
    failureCodes: Object.freeze([...failureCodes]),
  });
}

function resolveFrozenPath(repoRoot, pathValue, name) {
  if (typeof pathValue !== "string" || !pathValue.trim() || isAbsolute(pathValue)) {
    throw new Error(`stage_a_${name}_path_invalid`);
  }
  const root = resolve(repoRoot);
  const absolute = resolve(root, pathValue);
  const relation = relative(root, absolute);
  if (relation === "" || relation.startsWith("..\\") || relation.startsWith("../") || isAbsolute(relation)) {
    throw new Error(`stage_a_${name}_path_outside_repo`);
  }
  return absolute;
}

function theoreticalMaximumForDataset({ labels, queries }) {
  const globalRelevantKeys = Object.entries(labels)
    .filter(([, label]) => label === "relevant")
    .map(([key]) => key);
  const precisionMaximumValues = [];
  const recallMaximumValues = [];
  for (const query of queries) {
    const expectedKeys = new Set(
      Array.isArray(query.relevantKeys) && query.relevantKeys.length > 0
        ? query.relevantKeys
        : globalRelevantKeys,
    );
    precisionMaximumValues.push(Math.min(expectedKeys.size, query.k) / query.k);
    recallMaximumValues.push(Math.min(expectedKeys.size, query.k) / expectedKeys.size);
  }
  return Object.freeze({
    precisionAtK: average(precisionMaximumValues),
    recallAtK: average(recallMaximumValues),
    mrr: queries.length > 0 ? 1 : null,
    requiredQueryCoverage: queries.length > 0 ? 1 : null,
    falseCurrentEvidenceCount: null,
  });
}

function assertFrozenMetricDeclarations(stageACase) {
  assertMetricSelection(stageACase?.licensedMetrics, "licensed_metrics");
  assertMetricSelection(stageACase?.recordedMetrics, "recorded_metrics");
  const licensed = new Set(stageACase.licensedMetrics);
  const recorded = new Set(stageACase.recordedMetrics);
  if ([...licensed].some((metric) => !recorded.has(metric))) throw new Error("licensed_metric_not_recorded");
  if (stableJson(stageACase.thresholds) !== stableJson(F011_STAGE_A_THRESHOLDS)) {
    throw new Error(`stage_a_thresholds_changed:${stageACase.caseId}`);
  }
  for (const metric of stageACase.recordedMetrics) {
    const declaration = stageACase.applicabilityPrecondition?.[metric];
    if (!declaration || typeof declaration.status !== "string") {
      throw new Error(`stage_a_applicability_missing:${stageACase.caseId}:${metric}`);
    }
    if (declaration.reason !== null && typeof declaration.reason !== "string") {
      throw new Error(`stage_a_applicability_reason_invalid:${stageACase.caseId}:${metric}`);
    }
  }
}

function assertFrozenCaseDigests(stageACase, { items, labels, queries, rubric }) {
  const dataset = stageACase.dataset;
  const manifest = buildDatasetManifest({
    datasetId: dataset.datasetId,
    sourceSchemaIdentity: dataset.sourceSchemaIdentity,
    generatorIdentity: dataset.generatorIdentity,
    labelPolicy: dataset.labelPolicy,
    items,
    labels,
    queries,
  });
  for (const [manifestField, declarationField] of [
    ["corpusDigest", "corpusDigest"],
    ["labelsDigest", "labelsDigest"],
    ["queryDigest", "queryDigest"],
  ]) {
    if (manifest[manifestField] !== dataset[declarationField]) {
      throw new Error(`stage_a_${manifestField}_mismatch:${stageACase.caseId}`);
    }
  }
  if (manifest.itemCount !== dataset.itemCount || manifest.queryCount !== dataset.queryCount) {
    throw new Error(`stage_a_dataset_counts_mismatch:${stageACase.caseId}`);
  }
  if (dataset.rubricDigest !== undefined) {
    if (!rubric || digestJson(rubric) !== dataset.rubricDigest) {
      throw new Error(`stage_a_rubric_digest_mismatch:${stageACase.caseId}`);
    }
  }
  if (dataset.relevantJudgmentCount !== undefined) {
    const relevantCount = Object.values(labels).filter((label) => label === "relevant").length;
    if (relevantCount !== dataset.relevantJudgmentCount) {
      throw new Error(`stage_a_relevant_judgment_count_mismatch:${stageACase.caseId}`);
    }
  }
  return manifest;
}

function readFrozenStageACase(repoRoot, stageACase) {
  assertFrozenMetricDeclarations(stageACase);
  const dataset = stageACase.dataset;
  if (!dataset || typeof dataset.datasetId !== "string") {
    throw new Error(`stage_a_dataset_declaration_missing:${stageACase.caseId}`);
  }
  const corpusPath = resolveFrozenPath(repoRoot, dataset.corpusPath, "corpus");
  const labelsPath = resolveFrozenPath(repoRoot, dataset.labelsPath, "labels");
  const items = readJson(corpusPath);
  const labels = readJson(labelsPath);
  const queries = dataset.queryPath
    ? readJson(resolveFrozenPath(repoRoot, dataset.queryPath, "query"))
    : stageACase.querySet;
  if (stableJson(queries) !== stableJson(stageACase.querySet)) {
    throw new Error(`stage_a_query_set_declaration_mismatch:${stageACase.caseId}`);
  }
  const rubric = dataset.rubricPath
    ? readJson(resolveFrozenPath(repoRoot, dataset.rubricPath, "rubric"))
    : null;
  const manifest = assertFrozenCaseDigests(stageACase, { items, labels, queries, rubric });
  const theoreticalMaximum = theoreticalMaximumForDataset({ labels, queries });
  if (stableJson(theoreticalMaximum) !== stableJson(stageACase.theoreticalMaximum)) {
    throw new Error(`stage_a_theoretical_maximum_mismatch:${stageACase.caseId}`);
  }
  for (const query of queries) {
    if (query.k !== 16) throw new Error(`stage_a_precision_k_changed:${stageACase.caseId}`);
  }
  for (const metric of stageACase.licensedMetrics) {
    const precondition = stageACase.applicabilityPrecondition[metric];
    const expectedUnreachable =
      metric === "precisionAtK" && theoreticalMaximum[metric] < stageACase.thresholds[metric];
    const expectedStatus = expectedUnreachable ? "NOT_APPLICABLE" : "APPLICABLE";
    const expectedReason = expectedUnreachable ? "CONTRACT_UNREACHABLE" : null;
    if (precondition.status !== expectedStatus || precondition.reason !== expectedReason) {
      throw new Error(`stage_a_applicability_precondition_mismatch:${stageACase.caseId}:${metric}`);
    }
  }
  return Object.freeze({
    definition: stageACase,
    items,
    labels,
    queries,
    manifest,
  });
}

export function validateF011StageACaseSet(caseSet, { repoRoot = repoRootFromModule() } = {}) {
  if (!caseSet || caseSet.schema !== F011_STAGE_A_CASE_SET_SCHEMA) {
    throw new Error("stage_a_case_set_schema_invalid");
  }
  if (caseSet.freeze?.status !== "FROZEN") throw new Error("stage_a_case_set_not_frozen");
  if (caseSet.freeze.labelsFrozenBeforeCandidateEvaluation !== true) {
    throw new Error("stage_a_labels_not_frozen_before_candidate");
  }
  if (caseSet.freeze.candidateResultsAvailableAtFreeze !== false) {
    throw new Error("stage_a_candidate_results_available_at_freeze");
  }
  if (caseSet.freeze.candidateRanksOrScoresInspectedAtFreeze !== false) {
    throw new Error("stage_a_candidate_ranks_inspected_at_freeze");
  }
  if (caseSet.freeze.runtimeRetrievalBehaviorChanged !== false) {
    throw new Error("stage_a_runtime_behavior_changed");
  }
  if (caseSet.freeze.denominator !== "K" || caseSet.freeze.precisionK !== 16) {
    throw new Error("stage_a_precision_contract_changed");
  }
  assertMetricSelection(caseSet.requiredMetrics, "required_metrics");
  if (stableJson(caseSet.thresholds) !== stableJson(F011_STAGE_A_THRESHOLDS)) {
    throw new Error("stage_a_case_set_thresholds_changed");
  }
  if (!Array.isArray(caseSet.cases) || caseSet.cases.length === 0) {
    throw new Error("stage_a_case_set_cases_missing");
  }
  const ids = caseSet.cases.map((stageACase) => stageACase?.caseId);
  if (ids.some((caseId) => typeof caseId !== "string" || !caseId.trim())) {
    throw new Error("stage_a_case_set_case_id_missing");
  }
  if (new Set(ids).size !== ids.length) throw new Error("stage_a_case_set_case_id_duplicate");
  for (const stageACase of caseSet.cases) readFrozenStageACase(repoRoot, stageACase);
  const density = caseSet.cases.find((stageACase) => stageACase.caseId === "relevance-density-primary");
  if (density) {
    if (density.dataset.itemCount <= density.querySet[0].k) {
      throw new Error("stage_a_density_corpus_not_larger_than_k");
    }
    if ((density.dataset.relevantJudgmentCount ?? 0) < 8) {
      throw new Error("stage_a_density_relevance_count_insufficient");
    }
  }
  return true;
}

export function prepareF011StageACases({
  repoRoot = repoRootFromModule(),
  caseSetPath = join(repoRoot, "apps", "agent-service", "src", "core", "cognitive-v021", "retrieval", "fixtures", "f011-stage-a-case-set.json"),
} = {}) {
  const caseSet = readJson(caseSetPath);
  validateF011StageACaseSet(caseSet, { repoRoot });
  const preparedCases = caseSet.cases.map((stageACase) => {
    const prepared = readFrozenStageACase(repoRoot, stageACase);
    return Object.freeze({
      caseId: stageACase.caseId,
      items: prepared.items,
      labels: prepared.labels,
      queries: prepared.queries,
      datasetManifest: prepared.manifest,
      thresholds: stageACase.thresholds,
      licensedMetrics: stageACase.licensedMetrics,
      recordedMetrics: stageACase.recordedMetrics,
    });
  });
  return Object.freeze({ caseSet, cases: Object.freeze(preparedCases) });
}

export function decideFuseGate({ stageAPass, falseCurrentEvidenceCount }) {
  if (!stageAPass) {
    return Object.freeze({
      needed: false,
      package: null,
      version: null,
      license: null,
      decision: "NOT_REACHED",
    });
  }
  if (stageAPass && falseCurrentEvidenceCount === 0) {
    return Object.freeze({
      needed: false,
      package: null,
      version: null,
      license: null,
      decision: "NOT_NEEDED",
    });
  }
  return Object.freeze({
    needed: true,
    package: null,
    version: null,
    license: null,
    decision: "OWNER_DECISION_REQUIRED",
  });
}

function isSha256(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function requireMetric(value, name) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${name}_invalid`);
  }
}

export function validateF011QualificationResult(result) {
  if (!result || result.schema !== F011_QUALIFICATION_SCHEMA) throw new Error("f011_result_schema_invalid");
  if (!isSha256(result.capabilityFingerprint)) throw new Error("f011_capability_fingerprint_invalid");
  const dataset = result.dataset;
  if (!dataset || dataset.schema !== F011_DATASET_SCHEMA) throw new Error("f011_dataset_manifest_missing");
  for (const field of ["datasetId", "sourceSchemaIdentity", "generatorIdentity", "labelPolicy"]) {
    if (typeof dataset[field] !== "string" || !dataset[field]) throw new Error(`f011_dataset_${field}_invalid`);
  }
  for (const field of ["itemCount", "queryCount"]) {
    if (!Number.isInteger(dataset[field]) || dataset[field] < 1) throw new Error(`f011_dataset_${field}_invalid`);
  }
  if (
    !isSha256(dataset.labelsDigest) ||
    !isSha256(dataset.corpusDigest) ||
    !isSha256(dataset.queryDigest)
  ) {
    throw new Error("f011_dataset_digest_invalid");
  }

  if (!Array.isArray(result.querySet) || result.querySet.length !== dataset.queryCount) {
    throw new Error("f011_query_set_invalid");
  }
  if (digestJson(result.querySet) !== dataset.queryDigest) {
    throw new Error("f011_dataset_query_digest_mismatch");
  }

  const stageA = result.stageA;
  if (!stageA || !stageA.thresholds || !stageA.observed || !Array.isArray(stageA.perQuery)) {
    throw new Error("stage_a_evidence_missing");
  }
  for (const field of ["precisionAtK", "recallAtK", "mrr", "requiredQueryCoverage", "falseCurrentEvidenceCount"]) {
    requireMetric(stageA.observed[field], `stage_a_${field}`);
  }

  const fuse = result.fuseGate;
  if (
    !fuse ||
    !["NOT_REACHED", "NOT_NEEDED", "ACCEPTED", "REJECTED", "OWNER_DECISION_REQUIRED"].includes(fuse.decision)
  ) {
    throw new Error("fuse_gate_invalid");
  }
  if (!stageA.pass && fuse.decision !== "NOT_REACHED") {
    throw new Error("fuse_gate_evaluated_before_stage_a");
  }
  if (stageA.pass && fuse.decision === "NOT_REACHED") {
    throw new Error("fuse_gate_not_reached_after_stage_a");
  }

  const stageH = result.stageH;
  if (!stageH || typeof stageH.environment !== "string" || !Array.isArray(stageH.checks)) {
    throw new Error("stage_h_evidence_missing");
  }
  if (stageH.pass && stageH.checks.length === 0) throw new Error("stage_h_checks_missing");
  if (stageH.pass && stageH.checks.some((check) => check?.pass !== true)) {
    throw new Error("stage_h_pass_with_failed_check");
  }
  if (!["PASS", "FAIL", "NOT_RUN", "BLOCKED"].includes(result.verdict)) {
    throw new Error("f011_verdict_invalid");
  }
  if (result.verdict === "PASS" && (!stageA.pass || !stageH.pass)) {
    throw new Error("f011_pass_without_all_stages");
  }
  return true;
}

function validateStageHLink(stageH, candidate) {
  if (!stageH || stageH.schema !== "ashley.f011.stage-h.v1") throw new Error("stage_h_result_schema_invalid");
  if (typeof stageH.candidateSha !== "string" || stageH.candidateSha !== candidate?.buildIdentity) {
    throw new Error("stage_h_candidate_mismatch");
  }
  if (!Array.isArray(stageH.checks) || stageH.checks.length === 0) throw new Error("stage_h_checks_missing");
  return true;
}

export function assembleF011QualificationResult({
  capabilityFingerprint,
  candidate,
  manifest,
  queries,
  stageA,
  fuseGate,
  stageH = null,
}) {
  if (stageH) validateStageHLink(stageH, candidate);
  const stageHSummary = stageH ?? {
    schema: "ashley.f011.stage-h.v1",
    runId: null,
    candidateSha: candidate?.buildIdentity ?? null,
    environment: "not_run",
    thresholds: null,
    checks: [],
    raw: {},
    pass: false,
    state: "AUTHORIZATION_REQUIRED",
  };
  const verdict = !stageA.pass
    ? "FAIL"
    : fuseGate.decision === "OWNER_DECISION_REQUIRED"
      ? "BLOCKED"
      : stageHSummary.pass
        ? "PASS"
        : "NOT_RUN";
  const result = Object.freeze({
    schema: F011_QUALIFICATION_SCHEMA,
    capabilityFingerprint,
    candidate: Object.freeze({ ...candidate }),
    dataset: manifest,
    querySet: Object.freeze((queries ?? []).map((query) => Object.freeze({ ...query, terms: [...query.terms] }))),
    stageA,
    fuseGate,
    stageH: Object.freeze(stageHSummary),
    verdict,
  });
  validateF011QualificationResult(result);
  return result;
}

function writeImmutableJson(path, value) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = JSON.stringify(value, null, 2) + "\n";
  if (existsSync(absolute)) {
    const existing = readFileSync(absolute, "utf8");
    if (existing !== bytes) throw new Error(`immutable_artifact_collision:${absolute}`);
    return absolute;
  }
  const temporary = `${absolute}.tmp-${process.pid}`;
  writeFileSync(temporary, bytes, "utf8");
  renameSync(temporary, absolute);
  return absolute;
}

export function writeF011EvidenceBundle(outputDir, { manifest, stageA, result }) {
  validateF011QualificationResult(result);
  const output = resolve(outputDir);
  return Object.freeze({
    manifestPath: writeImmutableJson(join(output, "f011-dataset-manifest.json"), manifest),
    stageAPath: writeImmutableJson(join(output, "f011-stage-a.json"), {
      schema: "ashley.f011.stage-a.v1",
      dataset: manifest,
      stageA,
    }),
    resultPath: writeImmutableJson(join(output, "f011-qualification.json"), result),
  });
}

function assertCaseEvidenceMatchesDefinition(caseResult, stageACase) {
  if (caseResult.caseId !== stageACase.caseId) throw new Error(`stage_a_case_evidence_id_mismatch:${stageACase.caseId}`);
  if (!caseResult.dataset || caseResult.dataset.datasetId !== stageACase.dataset.datasetId) {
    throw new Error(`stage_a_case_evidence_dataset_missing:${stageACase.caseId}`);
  }
  for (const field of ["corpusDigest", "labelsDigest", "queryDigest"]) {
    if (caseResult.dataset[field] !== stageACase.dataset[field]) {
      throw new Error(`stage_a_case_evidence_${field}_mismatch:${stageACase.caseId}`);
    }
  }
  if (stableJson(caseResult.licensedMetrics) !== stableJson(stageACase.licensedMetrics)) {
    throw new Error(`stage_a_case_evidence_licensed_metrics_mismatch:${stageACase.caseId}`);
  }
  if (stableJson(caseResult.thresholds) !== stableJson(stageACase.thresholds)) {
    throw new Error(`stage_a_case_evidence_thresholds_mismatch:${stageACase.caseId}`);
  }
  if (stableJson(caseResult.theoreticalMaximum) !== stableJson(stageACase.theoreticalMaximum)) {
    throw new Error(`stage_a_case_evidence_theoretical_maximum_mismatch:${stageACase.caseId}`);
  }
  if (stableJson(caseResult.observedMetric) !== stableJson(caseResult.observed)) {
    throw new Error(`stage_a_case_evidence_observed_metric_mismatch:${stageACase.caseId}`);
  }
  for (const metric of caseResult.recordedMetrics) {
    const metricResult = caseResult.metricResults?.[metric];
    if (!metricResult) throw new Error(`stage_a_case_evidence_metric_missing:${stageACase.caseId}:${metric}`);
    if (metricResult.metricStatus === "CONTRACT_UNREACHABLE") {
      throw new Error(`stage_a_contract_unreachable_used_as_metric_status:${stageACase.caseId}:${metric}`);
    }
    if (caseResult.applicabilityStatus?.[metric] !== metricResult.applicabilityStatus) {
      throw new Error(`stage_a_case_evidence_applicability_mismatch:${stageACase.caseId}:${metric}`);
    }
    if (caseResult.metricStatus?.[metric] !== metricResult.metricStatus) {
      throw new Error(`stage_a_case_evidence_status_mismatch:${stageACase.caseId}:${metric}`);
    }
    if (caseResult.notMeasurableReason?.[metric] !== metricResult.notMeasurableReason) {
      throw new Error(`stage_a_case_evidence_reason_mismatch:${stageACase.caseId}:${metric}`);
    }
  }
  return true;
}

export function validateF011StageACasesEvidence(
  stageA,
  caseSet,
  { repoRoot = repoRootFromModule(), validateFrozenInputs = false } = {},
) {
  if (!stageA || stageA.schema !== F011_STAGE_A_CASES_SCHEMA) {
    throw new Error("stage_a_cases_evidence_schema_invalid");
  }
  if (!caseSet || stageA.caseSetId !== caseSet.caseSetId) {
    throw new Error("stage_a_case_set_link_invalid");
  }
  if (validateFrozenInputs) validateF011StageACaseSet(caseSet, { repoRoot });
  if (!Array.isArray(stageA.cases) || stageA.cases.length !== caseSet.cases.length) {
    throw new Error("stage_a_case_evidence_cases_invalid");
  }
  const definitions = new Map(caseSet.cases.map((stageACase) => [stageACase.caseId, stageACase]));
  const seen = new Set();
  for (const caseResult of stageA.cases) {
    if (seen.has(caseResult.caseId)) throw new Error("stage_a_case_evidence_case_id_duplicate");
    seen.add(caseResult.caseId);
    const stageACase = definitions.get(caseResult.caseId);
    if (!stageACase) throw new Error(`stage_a_case_evidence_case_unknown:${caseResult.caseId}`);
    assertCaseEvidenceMatchesDefinition(caseResult, stageACase);
  }
  if (seen.size !== definitions.size) throw new Error("stage_a_case_evidence_case_missing");
  if (stableJson(stageA.requiredMetrics) !== stableJson(caseSet.requiredMetrics)) {
    throw new Error("stage_a_case_evidence_required_metrics_mismatch");
  }
  for (const metric of caseSet.requiredMetrics) {
    const property = stageA.propertyResults?.[metric];
    if (!property || !["PASS", "FAIL", "BLOCKED"].includes(property.status)) {
      throw new Error(`stage_a_property_result_invalid:${metric}`);
    }
    if (property.status === "BLOCKED" && property.reason === "THRESHOLD_FAILED") {
      throw new Error(`stage_a_blocked_threshold_result_invalid:${metric}`);
    }
  }
  if (stageA.status === "BLOCKED" && stageA.pass) throw new Error("stage_a_blocked_pass_invalid");
  if (stageA.status === "PASS" && !stageA.pass) throw new Error("stage_a_pass_status_invalid");
  if (stageA.pass && stageA.propertyResults && Object.values(stageA.propertyResults).some((property) => property.status !== "PASS")) {
    throw new Error("stage_a_pass_with_nonpassing_property");
  }
  return true;
}

export function validateF011QualificationCasesResult(
  result,
  { repoRoot = repoRootFromModule(), validateFrozenInputs = false } = {},
) {
  if (!result || result.schema !== F011_CASES_QUALIFICATION_SCHEMA) {
    throw new Error("f011_cases_result_schema_invalid");
  }
  if (!isSha256(result.capabilityFingerprint)) throw new Error("f011_capability_fingerprint_invalid");
  if (!result.candidate || typeof result.candidate.buildIdentity !== "string") {
    throw new Error("f011_candidate_identity_missing");
  }
  validateF011StageACasesEvidence(result.stageA, result.caseSet, { repoRoot, validateFrozenInputs });
  const fuse = result.fuseGate;
  if (
    !fuse ||
    !["NOT_REACHED", "NOT_NEEDED", "ACCEPTED", "REJECTED", "OWNER_DECISION_REQUIRED"].includes(fuse.decision)
  ) {
    throw new Error("fuse_gate_invalid");
  }
  if (!result.stageA.pass && fuse.decision !== "NOT_REACHED") {
    throw new Error("fuse_gate_evaluated_before_stage_a");
  }
  if (result.stageA.pass && fuse.decision === "NOT_REACHED") {
    throw new Error("fuse_gate_not_reached_after_stage_a");
  }
  const stageH = result.stageH;
  if (!stageH || typeof stageH.environment !== "string" || !Array.isArray(stageH.checks)) {
    throw new Error("stage_h_evidence_missing");
  }
  if (stageH.pass && stageH.checks.length === 0) throw new Error("stage_h_checks_missing");
  if (stageH.pass && stageH.checks.some((check) => check?.pass !== true)) {
    throw new Error("stage_h_pass_with_failed_check");
  }
  if (!["PASS", "FAIL", "NOT_RUN", "BLOCKED"].includes(result.verdict)) {
    throw new Error("f011_verdict_invalid");
  }
  if (result.verdict === "PASS" && (!result.stageA.pass || !stageH.pass)) {
    throw new Error("f011_pass_without_all_stages");
  }
  return true;
}

export function assembleF011QualificationCasesResult({
  capabilityFingerprint,
  candidate,
  caseSet,
  stageA,
  fuseGate,
  stageH = null,
}) {
  if (stageH) validateStageHLink(stageH, candidate);
  const stageHSummary = stageH ?? {
    schema: "ashley.f011.stage-h.v1",
    runId: null,
    candidateSha: candidate?.buildIdentity ?? null,
    environment: "not_run",
    thresholds: null,
    checks: [],
    raw: {},
    pass: false,
    state: "AUTHORIZATION_REQUIRED",
  };
  const verdict = !stageA.pass
    ? stageA.status === "BLOCKED" ? "BLOCKED" : "FAIL"
    : fuseGate.decision === "OWNER_DECISION_REQUIRED"
      ? "BLOCKED"
      : stageHSummary.pass
        ? "PASS"
        : "NOT_RUN";
  const result = Object.freeze({
    schema: F011_CASES_QUALIFICATION_SCHEMA,
    capabilityFingerprint,
    candidate: Object.freeze({ ...candidate }),
    caseSet,
    stageA,
    fuseGate,
    stageH: Object.freeze(stageHSummary),
    verdict,
  });
  validateF011QualificationCasesResult(result);
  return result;
}

export function writeF011CaseEvidenceBundle(outputDir, { caseSet, stageA, result }) {
  validateF011QualificationCasesResult(result);
  const output = resolve(outputDir);
  return Object.freeze({
    caseSetPath: writeImmutableJson(join(output, "f011-stage-a-case-set.json"), caseSet),
    stageAPath: writeImmutableJson(join(output, "f011-stage-a.json"), {
      schema: F011_STAGE_A_CASES_SCHEMA,
      caseSetId: caseSet.caseSetId,
      stageA,
    }),
    resultPath: writeImmutableJson(join(output, "f011-qualification.json"), result),
  });
}

function repoRootFromModule() {
  return resolve(fileURLToPath(new URL("../..", import.meta.url)));
}

function currentGitHead(repoRoot) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function ensureNonProductionOutput(outputDir) {
  const output = resolve(outputDir);
  const productionRoot = resolve(join(homedir(), ".composer-assistant"));
  const relation = relative(productionRoot, output);
  if (
    relation === "" ||
    (!relation.startsWith(".." + "\\") && !relation.startsWith(".." + "/") && !isAbsolute(relation))
  ) {
    throw new Error("reserved_production_output_path");
  }
  return output;
}

async function currentRetrieverRankings(repoRoot, items, queries) {
  const module = (path) => import(pathToFileURL(join(repoRoot, "apps", "agent-service", "dist", ...path)).href);
  const [{ openCognitiveSidecarDb }, { openDerivedStore }, { upsertMemoryAssertion }, { retrieveCandidates }] =
    await Promise.all([
      module(["core", "cognitive-v021", "sidecar", "db.js"]),
      module(["core", "cognitive-v021", "retrieval", "derived-store.js"]),
      module(["core", "cognitive-v021", "memory", "assertions.js"]),
      module(["core", "cognitive-v021", "retrieval", "discover.js"]),
    ]);

  const sidecar = openCognitiveSidecarDb(new DatabaseSync(":memory:"), {
    dataPlane: { kind: "isolated" },
  });
  const derived = openDerivedStore(":memory:");
  const dimensions = {
    source: "owner_utterance",
    status: "asserted",
    time: "historical",
    reliability: "owner_supplied",
  };
  try {
    for (const item of items) {
      upsertMemoryAssertion(sidecar, {
        assertionKey: item.assertionKey,
        statement: item.statement,
        memoryKind: item.memoryKind ?? "owner_world_claim",
        dimensions: item.dimensions ?? dimensions,
        dataClassification: item.dataClassification,
        lineageParentKey: item.lineageParentKey ?? null,
        admittedGeneration: item.admittedGeneration ?? 1,
        live: Boolean(item.live),
      });
    }
    if (!derived.reconcileAtStartup(sidecar)) throw new Error("derived_reconcile_failed");
    return queries.map((query) => {
      const retrieval = retrieveCandidates(
        sidecar,
        {
          conversationId: "f011-stage-a",
          request: {
            triggerTerms: query.terms,
            workingContextTopics: [],
            assertionKeys: [],
            includeLogSearch: false,
          },
        },
        derived,
      );
      return {
        queryId: query.queryId,
        state: retrieval.state,
        miss: retrieval.miss,
        rankedKeys: retrieval.hits.map((hit) => hit.ref),
      };
    });
  } finally {
    derived.close();
    sidecar.close();
  }
}

export async function runF011StageA({
  repoRoot = repoRootFromModule(),
  datasetPath = join(repoRoot, "apps", "agent-service", "src", "core", "cognitive-v021", "retrieval", "fixtures", "incident-c-synthetic.json"),
  labelsPath = join(repoRoot, "apps", "agent-service", "src", "core", "cognitive-v021", "retrieval", "fixtures", "incident-c-labels.json"),
  outputDir = join(repoRoot, "work", "phase5-w3-stage-a-20260831"),
  candidateSha = currentGitHead(repoRoot),
  queries = F011_QUERY_SET,
  stageHResult = null,
} = {}) {
  const actualHead = currentGitHead(repoRoot);
  if (candidateSha !== actualHead) throw new Error("candidate_release_identity_mismatch");
  const output = ensureNonProductionOutput(outputDir);
  const items = readJson(datasetPath);
  const labels = readJson(labelsPath);
  const manifest = buildDatasetManifest({ items, labels, queries });

  let rankings = [];
  const retrievalFailures = [];
  try {
    rankings = await currentRetrieverRankings(repoRoot, items, queries);
  } catch (error) {
    retrievalFailures.push(error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160));
  }

  const stageA = evaluateStageA({
    items,
    labels,
    queries,
    rankings,
    thresholds: F011_STAGE_A_THRESHOLDS,
    extraFailureCodes: retrievalFailures.length > 0 ? ["retrieval_execution_failed"] : [],
  });
  const fuseGate = decideFuseGate({
    stageAPass: stageA.pass,
    falseCurrentEvidenceCount: stageA.observed.falseCurrentEvidenceCount ?? 0,
  });
  const candidate = Object.freeze({
      buildIdentity: actualHead,
      w1ThoughtCapabilityFingerprint: W1_THOUGHT_CAPABILITY_FINGERPRINT,
      retrievalContract: "ashley.f011.derived-retrieval.v1",
      harnessIdentity: "scripts/cognitive-v021/f011-evidence.mjs.v1",
  });
  const stageAEvidence = Object.freeze({
      ...stageA,
      runtime: Object.freeze({ rankings, retrievalFailures }),
  });
  const result = assembleF011QualificationResult({
    capabilityFingerprint: W1_THOUGHT_CAPABILITY_FINGERPRINT,
    candidate,
    manifest,
    queries,
    stageA: stageAEvidence,
    fuseGate,
    stageH: stageHResult,
  });
  const paths = writeF011EvidenceBundle(output, { manifest, stageA: stageAEvidence, result });
  return Object.freeze({ result, paths });
}

export async function runF011StageACases({
  repoRoot = repoRootFromModule(),
  caseSetPath = join(repoRoot, "apps", "agent-service", "src", "core", "cognitive-v021", "retrieval", "fixtures", "f011-stage-a-case-set.json"),
  outputDir = join(repoRoot, "work", "phase5-final-convergence", "w3-stage-a-case-set-20260902"),
  candidateSha = currentGitHead(repoRoot),
  stageHResult = null,
} = {}) {
  const actualHead = currentGitHead(repoRoot);
  if (candidateSha !== actualHead) throw new Error("candidate_release_identity_mismatch");
  const output = ensureNonProductionOutput(outputDir);
  const prepared = prepareF011StageACases({ repoRoot, caseSetPath });
  const runtimeCases = [];

  for (const stageACase of prepared.cases) {
    let rankings = [];
    const retrievalFailures = [];
    try {
      rankings = await currentRetrieverRankings(repoRoot, stageACase.items, stageACase.queries);
    } catch (error) {
      retrievalFailures.push(error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160));
    }
    runtimeCases.push({
      ...stageACase,
      rankings,
      extraFailureCodes: retrievalFailures.length > 0 ? ["retrieval_execution_failed"] : [],
    });
  }

  const evaluated = evaluateStageACases({
    cases: runtimeCases,
    requiredMetrics: prepared.caseSet.requiredMetrics,
    thresholds: prepared.caseSet.thresholds,
  });
  const stageAEvidence = Object.freeze({
    ...evaluated,
    schema: F011_STAGE_A_CASES_SCHEMA,
    caseSetId: prepared.caseSet.caseSetId,
    cases: Object.freeze(evaluated.cases.map((caseResult, index) => Object.freeze({
      ...caseResult,
      runtime: Object.freeze({
        rankings: runtimeCases[index].rankings,
        retrievalFailures: runtimeCases[index].extraFailureCodes.length > 0
          ? [...runtimeCases[index].extraFailureCodes]
          : [],
      }),
    }))),
  });
  validateF011StageACasesEvidence(stageAEvidence, prepared.caseSet);
  const falseCurrentCase = stageAEvidence.cases.find(
    (caseResult) => caseResult.licensedMetrics.includes("falseCurrentEvidenceCount"),
  );
  const fuseGate = decideFuseGate({
    stageAPass: stageAEvidence.pass,
    falseCurrentEvidenceCount: falseCurrentCase?.observed.falseCurrentEvidenceCount ?? null,
  });
  const candidate = Object.freeze({
    buildIdentity: actualHead,
    w1ThoughtCapabilityFingerprint: W1_THOUGHT_CAPABILITY_FINGERPRINT,
    retrievalContract: "ashley.f011.derived-retrieval.v1",
    harnessIdentity: "scripts/cognitive-v021/f011-evidence.mjs.v2-stage-a-cases",
  });
  const result = assembleF011QualificationCasesResult({
    capabilityFingerprint: W1_THOUGHT_CAPABILITY_FINGERPRINT,
    candidate,
    caseSet: prepared.caseSet,
    stageA: stageAEvidence,
    fuseGate,
    stageH: stageHResult,
  });
  const paths = writeF011CaseEvidenceBundle(output, {
    caseSet: prepared.caseSet,
    stageA: stageAEvidence,
    result,
  });
  return Object.freeze({ result, paths });
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) throw new Error(`unexpected_argument:${value}`);
    const key = value.slice(2);
    if (key === "help") return { help: true };
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`argument_value_missing:${key}`);
    args[key] = next;
    i += 1;
  }
  return args;
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("usage: node scripts/cognitive-v021/f011-evidence.mjs [--dataset path --labels path] [--output dir] [--candidate-sha sha] [--case-set path]");
    } else {
      const root = repoRootFromModule();
      const execution = args.dataset || args.labels
        ? await runF011StageA({
          repoRoot: root,
          datasetPath: args.dataset ? resolve(args.dataset) : undefined,
          labelsPath: args.labels ? resolve(args.labels) : undefined,
          outputDir: args.output ? resolve(args.output) : undefined,
          candidateSha: args["candidate-sha"] ?? undefined,
          stageHResult: args["stage-h"] ? readJson(resolve(args["stage-h"])) : null,
        })
        : await runF011StageACases({
          repoRoot: root,
          caseSetPath: args["case-set"] ? resolve(args["case-set"]) : undefined,
          outputDir: args.output ? resolve(args.output) : undefined,
          candidateSha: args["candidate-sha"] ?? undefined,
          stageHResult: args["stage-h"] ? readJson(resolve(args["stage-h"])) : null,
        });
      console.log(JSON.stringify(execution.result, null, 2));
      if (["FAIL", "BLOCKED"].includes(execution.result.verdict)) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
