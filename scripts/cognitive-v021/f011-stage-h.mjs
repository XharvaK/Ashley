#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  F011_STAGE_H_THRESHOLDS,
  readJson,
  sha256Text,
  stableJson,
} from "./f011-evidence.mjs";

export function percentile(values, quantile) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const q = Math.max(0, Math.min(1, quantile));
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index];
}

export function stageHChecksPass(checks) {
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => check?.pass === true);
}

/** Stage H must enter the cycle through the authoritative wake owner. */
export function admitStageHWakeAndCycle({
  sidecar,
  admitWake,
  admitCycle,
  occurrenceIdFor,
  conversationId,
  cycleId,
  triggerRef,
  occupantId,
  authorityEpoch,
  nowMs,
  capturedAuthorityRevision = 0,
}) {
  const admission = admitWake(sidecar, {
    occurrenceId: occurrenceIdFor({
      sourceKind: "inbox",
      triggerRef,
      conversationId,
    }),
    triggerRef,
    sourceKind: "inbox",
    conversationId,
    cycleId,
    triggerKind: "owner_message",
    occupantId,
    authorityEpoch,
    capturedAuthorityRevision,
    nowMs,
  });
  if (
    (admission?.kind !== "created" && admission?.kind !== "existing")
    || typeof admission?.wake?.wakeId !== "string"
    || admission.wake.wakeId.trim() === ""
  ) {
    throw new Error("stage_h_wake_not_admissible");
  }
  return admitCycle(sidecar, {
    cycleId,
    conversationId,
    wakeId: admission.wake.wakeId,
    triggerKind: "owner_message",
    triggerRef,
    occupantId,
    authorityEpoch,
    nowMs,
  });
}

export function isSafeIsolatedRoot(root) {
  if (typeof root !== "string" || !root.trim()) return false;
  const candidate = resolve(root);
  const productionRoot = resolve(join(homedir(), ".composer-assistant"));
  const relation = relative(productionRoot, candidate);
  return relation !== "" && (relation === ".." || relation.startsWith(".." + "/") || relation.startsWith(".." + "\\") || isAbsolute(relation));
}

export function buildStageHResult({ candidateSha, environment, checks, raw, runId = `f011-stage-h-${randomUUID()}` }) {
  if (typeof candidateSha !== "string" || !/^[0-9a-f]{40}$/i.test(candidateSha)) {
    throw new Error("stage_h_candidate_sha_invalid");
  }
  if (typeof environment !== "string" || !environment.trim()) throw new Error("stage_h_environment_missing");
  if (!Array.isArray(checks) || checks.length === 0) throw new Error("stage_h_checks_missing");
  return Object.freeze({
    schema: "ashley.f011.stage-h.v1",
    runId,
    candidateSha,
    environment,
    thresholds: F011_STAGE_H_THRESHOLDS,
    checks: Object.freeze(checks.map((check) => Object.freeze({ ...check }))),
    raw: raw ?? {},
    pass: stageHChecksPass(checks),
  });
}

function writeImmutableJson(path, value) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const bytes = JSON.stringify(value, null, 2) + "\n";
  if (existsSync(absolute)) {
    if (readFileSync(absolute, "utf8") !== bytes) throw new Error(`immutable_artifact_collision:${absolute}`);
    return absolute;
  }
  const temporary = `${absolute}.tmp-${process.pid}`;
  writeFileSync(temporary, bytes, "utf8");
  renameSync(temporary, absolute);
  return absolute;
}

function moduleUrl(repoRoot, path) {
  return pathToFileURL(join(repoRoot, "apps", "agent-service", "dist", ...path)).href;
}

function currentGitHead(repoRoot) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function check(id, pass, observed, threshold, evidence = {}) {
  return Object.freeze({ id, pass: Boolean(pass), observed, threshold, evidence });
}

function schemaFingerprint(db) {
  const rows = db.prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const version = db.prepare("PRAGMA user_version").get();
  return { userVersion: Number(version?.user_version ?? 0), objects: rows };
}

function openSidecar(sidecarModule, path) {
  return sidecarModule.openCognitiveSidecarDb(new DatabaseSync(path), {
    dataPlane: { kind: "isolated" },
  });
}

function defaultDimensions() {
  return {
    source: "owner_utterance",
    status: "asserted",
    time: "historical",
    reliability: "owner_supplied",
  };
}

function seedAssertions(sidecar, upsertMemoryAssertion, count, prefix = "stage-h") {
  const dimensions = defaultDimensions();
  for (let i = 0; i < count; i += 1) {
    upsertMemoryAssertion(sidecar, {
      assertionKey: `${prefix}:assertion:${i}`,
      statement: `Stage H bounded retrieval assertion ${i} about project ashley derived index measurement`,
      memoryKind: "owner_world_claim",
      dimensions,
      dataClassification: "never_public",
      lineageParentKey: null,
      admittedGeneration: 1,
      live: true,
    });
  }
}

function seedFixture(sidecar, upsertMemoryAssertion, items) {
  const dimensions = defaultDimensions();
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
}

async function runPhysicalChecks({ repoRoot, isolatedRoot, datasetItems }) {
  const [sidecarModule, derivedModule, assertionModule, ftsModule, discoverModule, cycleModule, wakeIdentityModule, wakeModule, evidenceModule, inputModule, allocatorModule] =
    await Promise.all([
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "sidecar", "db.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "retrieval", "derived-store.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "memory", "assertions.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "retrieval", "fts.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "retrieval", "discover.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "cycle", "inbox.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "wake", "identity.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "wake", "ledger.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "evidence", "conversation-log.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "thought", "input.js"])),
      import(moduleUrl(repoRoot, ["core", "cognitive-v021", "thought", "projection-allocator", "allocator.js"])),
    ]);
  const { openCognitiveSidecarDb } = sidecarModule;
  const { openDerivedStore, DERIVED_INDEX_SCHEMA_VERSION } = derivedModule;
  const { upsertMemoryAssertion } = assertionModule;
  const { searchMemoryFts } = ftsModule;
  const { retrieveCandidates } = discoverModule;
  const { admitCycle } = cycleModule;
  const { occurrenceIdFor } = wakeIdentityModule;
  const { admitWake } = wakeModule;
  const { appendOwnerUtterance } = evidenceModule;
  const { buildThoughtInput } = inputModule;
  const { allocateThoughtProjection } = allocatorModule;

  mkdirSync(isolatedRoot, { recursive: true });
  const probe = new DatabaseSync(":memory:");
  let sqliteVersion = "unknown";
  let fts5Available = false;
  let ftsError = null;
  try {
    sqliteVersion = String(probe.prepare("SELECT sqlite_version() AS version").get()?.version ?? "unknown");
    probe.exec("CREATE VIRTUAL TABLE f011_fts_probe USING fts5(value); INSERT INTO f011_fts_probe(value) VALUES ('probe');");
    probe.exec("INSERT INTO f011_fts_probe(f011_fts_probe) VALUES('integrity-check');");
    fts5Available = true;
  } catch (error) {
    ftsError = error instanceof Error ? error.message : String(error);
  } finally {
    probe.close();
  }

  const crashDir = join(isolatedRoot, "crash-gap");
  mkdirSync(crashDir, { recursive: true });
  const crashSidecarPath = join(crashDir, "sidecar.db");
  const crashDerivedPath = join(crashDir, "derived.db");
  let crashSidecar = openSidecar(sidecarModule, crashSidecarPath);
  let crashDerived = openDerivedStore(crashDerivedPath);
  seedAssertions(crashSidecar, upsertMemoryAssertion, 5, "crash-gap");
  crashDerived.reconcileAtStartup(crashSidecar);
  upsertMemoryAssertion(crashSidecar, {
    assertionKey: "crash-gap:target",
    statement: "UniqueCrashTargetStatement committed before derived synchronization",
    memoryKind: "owner_world_claim",
    dimensions: defaultDimensions(),
    dataClassification: "never_public",
    lineageParentKey: null,
    admittedGeneration: 1,
    live: true,
  });
  crashDerived.close();
  crashSidecar.close();
  crashSidecar = openSidecar(sidecarModule, crashSidecarPath);
  crashDerived = openDerivedStore(crashDerivedPath);
  const startupBefore = crashDerived.getIndexState();
  const startupReconciled = crashDerived.reconcileAtStartup(crashSidecar);
  const crashSearch = searchMemoryFts(crashDerived, crashSidecar, "UniqueCrashTargetStatement");
  const startupAfter = crashDerived.getIndexState();
  const crashGapPass = startupReconciled
    && crashSearch.state === "ready"
    && crashSearch.rows.some((row) => row.assertionKey === "crash-gap:target")
    && (startupBefore?.sidecarAssertionCount ?? 0) < (startupAfter?.sidecarAssertionCount ?? 0);
  crashDerived.close();
  crashSidecar.close();

  const scaleDir = join(isolatedRoot, "scale");
  mkdirSync(scaleDir, { recursive: true });
  const scaleSidecar = openSidecar(sidecarModule, join(scaleDir, "sidecar.db"));
  const scaleDerived = openDerivedStore(join(scaleDir, "derived.db"));
  seedFixture(scaleSidecar, upsertMemoryAssertion, datasetItems);
  seedAssertions(scaleSidecar, upsertMemoryAssertion, 1_000, "scale");

  const rebuildStarted = performance.now();
  const rebuilt = scaleDerived.reconcileAtStartup(scaleSidecar);
  const rebuildMs = Math.max(0, performance.now() - rebuildStarted);

  let validReadSourceScans = 0;
  const originalPrepare = scaleSidecar.prepare.bind(scaleSidecar);
  scaleSidecar.prepare = (sql) => {
    if (
      sql.includes("SELECT assertion_key, content_hash FROM sidecar_memory_assertions") ||
      sql.includes("SELECT row_id, content_hash, version FROM conversation_evidence_log")
    ) {
      validReadSourceScans += 1;
    }
    return originalPrepare(sql);
  };

  const querySamples = [];
  for (let i = 0; i < 20; i += 1) {
    const queryStarted = performance.now();
    const search = searchMemoryFts(scaleDerived, scaleSidecar, "bounded retrieval assertion");
    querySamples.push(Math.max(0, performance.now() - queryStarted));
    if (search.state !== "ready") validReadSourceScans += 1_000;
  }
  const queryP95Ms = percentile(querySamples, 0.95);

  const cycle = admitStageHWakeAndCycle({
    sidecar: scaleSidecar,
    admitWake,
    admitCycle,
    occurrenceIdFor,
    cycleId: "f011-stage-h-cycle",
    conversationId: "f011-stage-h-conversation",
    triggerRef: "sleep soon tomorrow",
    occupantId: "mfo_nim_openai_gpt_oss_20b_low",
    authorityEpoch: 1,
    nowMs: 1_000,
  });
  const utterance = appendOwnerUtterance(scaleSidecar, {
    conversationId: cycle.conversationId,
    text: "I need bounded retrieval evidence.",
    discordMessageIds: ["f011-stage-h-message"],
    nowMs: 1_001,
  });
  const thoughtInput = buildThoughtInput({
    sidecar: scaleSidecar,
    cycle,
    triggerText: "bounded retrieval evidence",
    triggerEvidence: utterance,
    constitution: {
      constitutional: ["Truth first", "Be grounded and precise"],
      stableSelf: ["Project Ashley companion runtime"],
    },
    capabilityReality: {
      vision: false,
      attachmentText: false,
      conversationalRead: false,
      webSearch: false,
      canOfferProjectInspection: false,
      canOfferWorkspace: false,
      canOfferVerification: false,
      canOfferAuthorship: false,
      canOfferBoundedOperation: false,
      canOfferPatchExport: false,
      approvedProjectIds: ["project-ashley"],
    },
    observations: [],
    inFlight: [],
    runtimeCondition: { thoughtUnavailable: false },
    rememberDirective: null,
    authorityObjections: [],
    derivedStore: scaleDerived,
  });
  const projectionStarted = performance.now();
  const allocation = allocateThoughtProjection({
    sidecar: scaleSidecar,
    thoughtInput,
    quotaBucket: "nim:openai/gpt-oss-20b",
    requestId: "f011-stage-h-projection",
  });
  const projectionMs = Math.max(0, performance.now() - projectionStarted);
  const projectionPass = allocation.receipt.requiredOverflow === false
    && allocation.receipt.totalDemandTokens <= allocation.receipt.hardTpm
    && projectionMs <= F011_STAGE_H_THRESHOLDS.maxProjectionMs;

  const memory = process.memoryUsage();
  const maxRssBytes = Math.max(memory.rss, Number(process.resourceUsage?.().maxRSS ?? 0) * 1024);
  const rebuildPass = rebuilt && rebuildMs <= F011_STAGE_H_THRESHOLDS.maxRebuildMs;
  const queryPass = queryP95Ms !== null && queryP95Ms <= F011_STAGE_H_THRESHOLDS.maxQueryP95Ms;
  const scanPass = validReadSourceScans === F011_STAGE_H_THRESHOLDS.maxValidReadSourceScans;
  const resourcePass = maxRssBytes <= F011_STAGE_H_THRESHOLDS.maxRssBytes;

  const checks = [
    check("linux_environment", process.platform === "linux", process.platform, "linux"),
    check("fts5", fts5Available, { sqliteVersion, error: ftsError }, "available"),
    check("startup_crash_gap_reconciliation", crashGapPass, {
      startupReconciled,
      crashSearchState: crashSearch.state,
      crashSearchRows: crashSearch.rows.length,
      startupBefore,
      startupAfter,
    }, "new authoritative row retrievable after restart"),
    check("derived_rebuild_bound", rebuildPass, { rebuilt, rebuildMs }, `<=${F011_STAGE_H_THRESHOLDS.maxRebuildMs}ms`),
    check("valid_read_zero_source_scans", scanPass, { validReadSourceScans }, "0"),
    check("query_latency_p95", queryPass, { querySamples, queryP95Ms }, `<=${F011_STAGE_H_THRESHOLDS.maxQueryP95Ms}ms`),
    check("bounded_projection", projectionPass, {
      projectionMs,
      totalDemandTokens: allocation.receipt.totalDemandTokens,
      hardTpm: allocation.receipt.hardTpm,
      requiredOverflow: allocation.receipt.requiredOverflow,
    }, `<=${F011_STAGE_H_THRESHOLDS.maxProjectionMs}ms and within hard TPM`),
    check("process_memory_bound", resourcePass, { rssBytes: memory.rss, maxRssBytes }, `<=${F011_STAGE_H_THRESHOLDS.maxRssBytes} bytes`),
  ];

  scaleDerived.close();
  scaleSidecar.close();
  return {
    checks,
    raw: {
      environment: {
        platform: process.platform,
        arch: arch(),
        release: release(),
        node: process.version,
        cpu: cpus()[0]?.model ?? "unknown",
        totalMemoryBytes: totalmem(),
        uname: runCommand("uname", ["-a"]),
        osRelease: readOsRelease(),
      },
      sqliteVersion,
      derivedIndexSchemaVersion: DERIVED_INDEX_SCHEMA_VERSION,
      sidecarSchema: (() => {
        const schemaSidecar = openSidecar(sidecarModule, ":memory:");
        try {
          return schemaFingerprint(schemaSidecar);
        } finally {
          schemaSidecar.close();
        }
      })(),
      datasetItemCount: datasetItems.length,
      rebuildMs,
      querySamples,
      queryP95Ms,
      validReadSourceScans,
      projectionMs,
      rssBytes: memory.rss,
      maxRssBytes,
      crashGapPass,
      stageHThresholds: F011_STAGE_H_THRESHOLDS,
    },
  };
}

function readOsRelease() {
  try {
    return readFileSync("/etc/os-release", "utf8").split(/\r?\n/).filter(Boolean).join("\n");
  } catch {
    return null;
  }
}

export async function runStageH({
  repoRoot,
  candidateSha,
  datasetManifestPath,
  datasetPath,
  isolatedRoot,
  output,
}) {
  if (!isSafeIsolatedRoot(isolatedRoot) || !isSafeIsolatedRoot(output)) {
    throw new Error("stage_h_reserved_or_unsafe_path");
  }
  const actualHead = currentGitHead(repoRoot);
  const manifest = readJson(datasetManifestPath);
  const datasetItems = readJson(datasetPath);
  const baseRaw = {
    actualHead,
    candidateSha,
    datasetManifestPath: resolve(datasetManifestPath),
    datasetManifestDigest: `sha256:${sha256Text(stableJson(manifest))}`,
    datasetPath: resolve(datasetPath),
  };

  if (process.platform !== "linux") {
    const result = buildStageHResult({
      candidateSha,
      environment: process.platform,
      checks: [check("linux_environment", false, process.platform, "linux", { code: "NOT_RUN_WRONG_ENVIRONMENT" })],
      raw: { ...baseRaw, state: "NOT_RUN_WRONG_ENVIRONMENT" },
    });
    writeImmutableJson(join(output, "f011-stage-h.json"), result);
    return result;
  }

  if (actualHead !== candidateSha) {
    const result = buildStageHResult({
      candidateSha,
      environment: process.platform,
      checks: [check("candidate_build_identity", false, actualHead, candidateSha, { code: "environment_mismatch" })],
      raw: { ...baseRaw, state: "BLOCKED_CANDIDATE_MISMATCH" },
    });
    writeImmutableJson(join(output, "f011-stage-h.json"), result);
    return result;
  }

  const execution = await runPhysicalChecks({ repoRoot, isolatedRoot: resolve(isolatedRoot), datasetItems });
  const result = buildStageHResult({
    candidateSha,
    environment: process.platform,
    checks: [
      check("candidate_build_identity", true, actualHead, candidateSha),
      ...execution.checks,
    ],
    raw: { ...baseRaw, ...execution.raw },
  });
  writeImmutableJson(join(output, "f011-stage-h.json"), result);
  return result;
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
      console.log("usage: node scripts/cognitive-v021/f011-stage-h.mjs --candidate-sha <sha> --dataset-manifest <path> --isolated-root <path> --output <path> [--dataset <path>]");
    } else {
      const repoRoot = resolve(args["repo-root"] ?? fileURLToPath(new URL("../..", import.meta.url)));
      const candidateSha = args["candidate-sha"];
      const datasetManifestPath = resolve(args["dataset-manifest"]);
      const datasetPath = resolve(args.dataset ?? join(repoRoot, "apps", "agent-service", "src", "core", "cognitive-v021", "retrieval", "fixtures", "incident-c-synthetic.json"));
      const result = await runStageH({
        repoRoot,
        candidateSha,
        datasetManifestPath,
        datasetPath,
        isolatedRoot: resolve(args["isolated-root"]),
        output: resolve(args.output),
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.pass) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
