#!/usr/bin/env node

/*
 * Wave 10b deterministic evaluator.
 *
 * This command is deliberately offline-only. It inspects the reviewed
 * scenario matrix and local evidence paths, and it may optionally inspect an
 * already-captured persona run. It never starts an agent, calls Mistral, reads
 * live Discord, or writes raw conversation content to a report.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { hardChecks } from "../persona-eval/judge.mjs";
import { loadProbes, loadRun, OUT_ROOT, stamp } from "../persona-eval/lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const matrixPath = "docs/stabilization/scenario-matrix.json";

export const EXPECTED_SCENARIO_IDS = Object.freeze([
  "S-REFUSE",
  "S-AFFECT",
  "S-DEP",
  "S-DM",
  "S-THOUGHT",
  "S-DELIV",
  "S-CANCEL",
  "S-QUOTA",
  "S-ALIAS",
  "S-PRIV",
  "S-BACKUP",
  "S-INJECT",
  "S-SANDBOX",
  "S-SELFMOD",
  "S-EXT",
]);

const VERDICT_CLASSES = new Set([
  "deterministic",
  "style_relational_judge",
  "counterevidence",
]);

// These are objective probe/run failures. Style and relational judge output
// is intentionally not imported here and cannot waive one of these failures.
export const DETERMINISTIC_RUN_FLAGS = new Set([
  "accepted_premise",
  "answered_as_recall",
  "capability_denial",
  "caved",
  "confirmed_invented_history",
  "countdown_theater",
  "echoed_him",
  "em_dash",
  "empty_reply",
  "fabricated_side_effect",
  "guessed_version",
  "invented_activity",
  "invented_jab",
  "internal_jargon",
  "marker_leak",
  "probe_error",
  "smart_quote",
  "status_theater",
  "void_idle",
  "wrong_language",
]);

function readJson(relativePath) {
  const file = isAbsolute(relativePath) ? relativePath : join(root, relativePath);
  if (!existsSync(file)) throw new Error(`missing_file:${relativePath}`);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `invalid_json:${relativePath}:${error instanceof Error ? error.message : "parse_failed"}`,
    );
  }
}

function safeRelativePath(relativePath, rootDir) {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    return { ok: false, reason: "path_missing" };
  }
  if (
    isAbsolute(relativePath) ||
    /^[A-Za-z]:[\\/]/.test(relativePath) ||
    /\.env|MISTRAL_API_KEY|DISCORD_BOT_TOKEN|PRIVATE KEY/i.test(relativePath)
  ) {
    return { ok: false, reason: "path_not_safe" };
  }
  const candidate = resolve(rootDir, relativePath);
  const rel = relative(rootDir, candidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, reason: "path_outside_root" };
  }
  return { ok: true, path: candidate };
}

function stringArray(value, label, errors) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    errors.push(`${label}_not_string_array`);
    return [];
  }
  return value;
}

function inspectEvidence(evidence, rootDir, errors, scenarioId, index) {
  if (!evidence || typeof evidence !== "object") {
    errors.push(`scenario_evidence_invalid:${scenarioId}:${index}`);
    return {
      path: null,
      present: false,
      anchorsMatched: false,
      missingAnchors: [],
      reason: "evidence_invalid",
    };
  }

  const safe = safeRelativePath(evidence.path, rootDir);
  const anchors = stringArray(
    evidence.anchors,
    `scenario_evidence_anchors:${scenarioId}:${index}`,
    errors,
  );
  if (!safe.ok) {
    errors.push(`scenario_evidence_${safe.reason}:${scenarioId}:${index}`);
    return {
      path: typeof evidence.path === "string" ? evidence.path : null,
      present: false,
      anchorsMatched: false,
      missingAnchors: anchors,
      reason: safe.reason,
    };
  }

  if (!existsSync(safe.path)) {
    return {
      path: evidence.path,
      present: false,
      anchorsMatched: false,
      missingAnchors: anchors,
      reason: "missing_file",
    };
  }

  const source = readFileSync(safe.path, "utf8").toLowerCase();
  const missingAnchors = anchors.filter(
    (anchor) => !source.includes(anchor.toLowerCase()),
  );
  return {
    path: evidence.path,
    present: true,
    anchorsMatched: missingAnchors.length === 0,
    missingAnchors,
    reason: missingAnchors.length ? "anchor_missing" : null,
  };
}

export function deriveScenarioStatus(scenario, rootDir = root, errors = []) {
  const evidence = Array.isArray(scenario?.evidence)
    ? scenario.evidence
    : [];
  const inspected = evidence.map((item, index) =>
    inspectEvidence(item, rootDir, errors, scenario?.id ?? "unknown", index),
  );
  const valid = inspected.filter((item) => item.present && item.anchorsMatched);
  const knownGaps = Array.isArray(scenario?.knownGaps)
    ? scenario.knownGaps
    : [];
  const deferred = typeof scenario?.deferredReason === "string" &&
    scenario.deferredReason.trim().length > 0;

  let status = "gap";
  if (deferred) status = "deferred";
  else if (valid.length === evidence.length && evidence.length > 0 && knownGaps.length === 0) {
    status = "covered";
  } else if (valid.length > 0) {
    status = "partial";
  }

  return {
    id: scenario?.id ?? "unknown",
    title: scenario?.title ?? "",
    verdictClass: scenario?.verdictClass ?? null,
    hardGate: scenario?.hardGate === true,
    status,
    evidence: inspected,
    validEvidenceCount: valid.length,
    evidenceCount: evidence.length,
    knownGaps,
    deferredReason: deferred ? scenario.deferredReason : null,
  };
}

export function evaluateScenarioMatrix(matrix, rootDir = root) {
  const errors = [];
  if (!matrix || typeof matrix !== "object" || matrix.version !== 1) {
    return {
      version: matrix?.version ?? null,
      scenarios: [],
      counts: { covered: 0, partial: 0, gap: 0, deferred: 0 },
      errors: ["scenario_matrix_version_invalid"],
      deterministicGaps: [],
    };
  }
  if (!Array.isArray(matrix.scenarios)) {
    return {
      version: matrix.version,
      scenarios: [],
      counts: { covered: 0, partial: 0, gap: 0, deferred: 0 },
      errors: ["scenario_matrix_scenarios_missing"],
      deterministicGaps: [],
    };
  }
  if (matrix.scenarios.length !== EXPECTED_SCENARIO_IDS.length) {
    errors.push(`scenario_count_expected:${EXPECTED_SCENARIO_IDS.length}`);
  }

  const seen = new Set();
  matrix.scenarios.forEach((scenario, index) => {
    const id = scenario?.id;
    if (typeof id !== "string" || !id) {
      errors.push(`scenario_id_invalid:${index}`);
      return;
    }
    if (seen.has(id)) errors.push(`scenario_id_duplicate:${id}`);
    seen.add(id);
    if (EXPECTED_SCENARIO_IDS[index] !== id) {
      errors.push(`scenario_order_invalid:${index}:${id}`);
    }
    if (!VERDICT_CLASSES.has(scenario.verdictClass)) {
      errors.push(`scenario_verdict_class_invalid:${id}`);
    }
    if (typeof scenario.hardGate !== "boolean") {
      errors.push(`scenario_hard_gate_invalid:${id}`);
    }
    if (!Array.isArray(scenario.evidence)) {
      errors.push(`scenario_evidence_missing:${id}`);
    }
    if (!Array.isArray(scenario.knownGaps) || scenario.knownGaps.some((gap) => typeof gap !== "string")) {
      errors.push(`scenario_known_gaps_invalid:${id}`);
    }
    if (scenario.deferredReason != null && typeof scenario.deferredReason !== "string") {
      errors.push(`scenario_deferred_reason_invalid:${id}`);
    }
  });

  for (const expected of EXPECTED_SCENARIO_IDS) {
    if (!seen.has(expected)) errors.push(`scenario_missing:${expected}`);
  }

  const scenarios = matrix.scenarios.map((scenario) =>
    deriveScenarioStatus(scenario, rootDir, errors),
  );
  const counts = { covered: 0, partial: 0, gap: 0, deferred: 0 };
  for (const scenario of scenarios) counts[scenario.status] += 1;
  const deterministicGaps = scenarios
    .filter((scenario) =>
      scenario.verdictClass === "deterministic" &&
      scenario.hardGate &&
      (scenario.status === "gap" || scenario.status === "deferred"),
    )
    .map((scenario) => scenario.id);

  return {
    version: matrix.version,
    scenarioCount: scenarios.length,
    counts,
    scenarios,
    errors,
    deterministicGaps,
  };
}

export function evaluateRun(run, probes = loadProbes()) {
  const errors = [];
  if (!run || typeof run !== "object" || !Array.isArray(run.results)) {
    return { errors: ["run_results_missing"], rows: [], hardFailures: [] };
  }
  const probeById = new Map(
    probes.map((probe) => [probe?.id, probe]),
  );
  const rows = [];
  for (const result of run.results) {
    const id = result?.id ?? "unknown";
    const probe = probeById.get(id) ?? null;
    let flags;
    try {
      flags = hardChecks(result, probe);
    } catch (error) {
      flags = ["probe_error"];
      errors.push(`run_result_invalid:${id}:${error instanceof Error ? error.message : "unknown"}`);
    }
    const deterministicFlags = flags.filter((flag) =>
      DETERMINISTIC_RUN_FLAGS.has(flag),
    );
    rows.push({
      id,
      seed: result?.seed ?? 1,
      flags,
      deterministicFlags,
      hardFailure: deterministicFlags.length > 0,
    });
  }
  return {
    label: run.label ?? null,
    model: run.model ?? null,
    resultCount: rows.length,
    rows,
    hardFailures: rows.filter((row) => row.hardFailure).map((row) => row.id),
    errors,
  };
}

function parseArgs(argv) {
  const args = { run: null, out: null, strict: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--run") args.run = argv[++i] ?? null;
    else if (flag === "--out") args.out = argv[++i] ?? null;
    else if (flag === "--strict") args.strict = true;
    else if (flag === "--json") args.json = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown_argument:${flag}`);
  }
  return args;
}

function printHuman(report) {
  const coverage = report.coverage;
  console.log("Wave 10b deterministic evaluation (offline)");
  console.log(
    `scenarios ${coverage.scenarioCount} | covered ${coverage.counts.covered} | partial ${coverage.counts.partial} | gap ${coverage.counts.gap} | deferred ${coverage.counts.deferred}`,
  );
  for (const scenario of coverage.scenarios) {
    const gapMark = scenario.knownGaps.length ? `; gaps=${scenario.knownGaps.length}` : "";
    console.log(
      `  ${scenario.status.padEnd(9)} ${scenario.id} (${scenario.validEvidenceCount}/${scenario.evidenceCount} evidence${gapMark})`,
    );
  }
  if (report.run) {
    console.log(
      `run ${report.run.label ?? "(unlabelled)"} | results ${report.run.resultCount} | deterministic hard failures ${report.run.hardFailures.length}`,
    );
    for (const row of report.run.rows.filter((item) => item.hardFailure)) {
      console.log(`  FAIL ${row.id} seed${row.seed}: ${row.deterministicFlags.join(", ")}`);
    }
  }
  if (coverage.deterministicGaps.length) {
    console.log(`deterministic coverage gaps: ${coverage.deterministicGaps.join(", ")}`);
  }
}

export function buildReport(matrix, options = {}) {
  const coverage = evaluateScenarioMatrix(matrix, options.rootDir ?? root);
  let run = null;
  if (options.run) run = evaluateRun(options.run, options.probes ?? loadProbes());
  return {
    version: 1,
    kind: "wave10b-deterministic-evaluation",
    generatedAt: new Date().toISOString(),
    coverage,
    run,
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("usage: node scripts/stabilization/eval-deterministic.mjs [--run <label|run.json>] [--out <path>] [--strict] [--json]");
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log("usage: node scripts/stabilization/eval-deterministic.mjs [--run <label|run.json>] [--out <path>] [--strict] [--json]");
    return;
  }

  let matrix;
  try {
    matrix = readJson(matrixPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  let run = null;
  if (args.run) {
    try {
      run = loadRun(args.run);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
  }
  const report = buildReport(matrix, { run });
  const serialized = JSON.stringify(report, null, 2);
  if (args.out) {
    const outputPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, "utf8");
    console.log(`wrote ${outputPath}`);
  }
  if (args.json) console.log(serialized);
  else printHuman(report);

  const errors = [
    ...report.coverage.errors,
    ...(report.run?.errors ?? []),
  ];
  const hardRunFailures = report.run?.hardFailures?.length ?? 0;
  const strictCoverageFailure = args.strict &&
    report.coverage.scenarios.some((scenario) =>
      scenario.verdictClass === "deterministic" &&
      scenario.hardGate &&
      scenario.status !== "covered",
    );
  if (errors.length || hardRunFailures || strictCoverageFailure) {
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1]
  ? resolve(process.argv[1]).toLowerCase()
  : "";
const modulePath = fileURLToPath(import.meta.url).toLowerCase();
if (entryPath === modulePath) {
  await main();
}
