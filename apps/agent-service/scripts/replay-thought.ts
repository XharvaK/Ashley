/**
 * Replays captured Thought requests through the Command Code adapter (the
 * production provider path) under chosen model:effort configurations, and
 * records wall time, tokens, finish reason, the Thought parser verdict, and the
 * Domus choice. It changes no Ashley state: no attention ledger, no diagnostics,
 * no delivery. Capture format and privacy rules: see replay-capture.ts and the
 * replay section in docs/architecture/Ashley_Observability_Plane.md.
 *
 * Usage (from apps/agent-service):
 *   npx tsx scripts/replay-thought.ts --dir <capture dir> --pass domus --limit 20 \
 *     --config muse:medium --config deepseek/deepseek-v4.1-flash-fast:medium --out <file.csv>
 *   Add --dry-run to count what would be sent without calling the provider.
 *
 * PRIVACY: capture files hold private conversation data. This script never
 * prints message text, model output, or keys. It writes only the CSV rows
 * defined in replay-summary.ts. Requests go only to the Command Code provider.
 *
 * COST: every dispatch spends Command Code quota (one account-wide bucket).
 * Dispatches run one at a time, in capture order.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadEnvFile } from "../src/env.js";
import { AppError } from "../src/errors.js";
import { COMMAND_CODE_DOMUS_POLICY, COMMAND_CODE_POLICY } from "../src/core/command-code/policy.js";
import {
  createCommandCodeAdapter,
  type CommandCodeFetch,
} from "../src/core/model-routing/adapters/command-code-adapter.js";
import { thoughtOutputStructuredRequest } from "../src/core/cognitive-v021/thought/output-contract.js";
import { parseThoughtSemanticOutput } from "../src/core/cognitive-v021/thought/parse.js";
import {
  THOUGHT_REPLAY_CAPTURE_FILE_PATTERN,
  THOUGHT_REPLAY_CAPTURE_SCHEMA,
  type ThoughtReplayCaptureRecord,
} from "../src/core/cognitive-v021/thought/replay-capture.js";
import {
  formatReplayCsv,
  formatReplaySummaryLines,
  summarizeReplayRows,
  type ReplayRow,
} from "../src/core/cognitive-v021/thought/replay-summary.js";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type ReplayEffort = (typeof EFFORTS)[number];

type ReplayConfig = { label: string; modelId: string; effort: ReplayEffort };

type CliArgs = {
  dir: string;
  pass: string | null;
  limit: number | null;
  configs: ReplayConfig[];
  out: string | null;
  timeoutSeconds: number;
  envFile: string | null;
  dryRun: boolean;
};

type LoadedCapture = { file: string; index: number; record: ThoughtReplayCaptureRecord };

const USAGE = [
  "usage: npx tsx scripts/replay-thought.ts --dir <dir> --config <model:effort> [--config ...] --out <csv>",
  "       [--pass <domus|chat|private|awake|night|afterglow>] [--limit <n>] [--timeout-s <n>]",
  "       [--env-file <path>] [--dry-run]",
  "  model aliases: muse (policy Thought model), deepseek (policy Domus model); full ids also accepted",
].join("\n");

class UsageError extends Error {}

/** Thrown before any bytes leave the process when the wire request is not the configuration under test. */
class ReplayWireRefusal extends Error {
  constructor() {
    super("replay_wire_config_mismatch");
    this.name = "ReplayWireRefusal";
  }
}

function parseConfig(raw: string): ReplayConfig {
  const cut = raw.lastIndexOf(":");
  if (cut <= 0) throw new UsageError(`config must be model:effort, got a value without a model or effort`);
  const alias = raw.slice(0, cut);
  const effort = raw.slice(cut + 1);
  if (!(EFFORTS as readonly string[]).includes(effort)) {
    throw new UsageError(`config effort must be one of ${EFFORTS.join(", ")}`);
  }
  const modelId = alias === "muse"
    ? COMMAND_CODE_POLICY.modelId
    : alias === "deepseek"
      ? COMMAND_CODE_DOMUS_POLICY.modelId
      : alias;
  return { label: `${alias}:${effort}`, modelId, effort: effort as ReplayEffort };
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    dir: "",
    pass: null,
    limit: null,
    configs: [],
    out: null,
    timeoutSeconds: 300,
    envFile: null,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = (): string => {
      index += 1;
      const next = argv[index];
      if (next === undefined) throw new UsageError(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case "--dir": args.dir = resolve(value()); break;
      case "--pass": args.pass = value(); break;
      case "--limit": args.limit = positiveInteger(value(), flag); break;
      case "--config": args.configs.push(parseConfig(value())); break;
      case "--out": args.out = resolve(value()); break;
      case "--timeout-s": args.timeoutSeconds = positiveInteger(value(), flag); break;
      case "--env-file": args.envFile = resolve(value()); break;
      case "--dry-run": args.dryRun = true; break;
      default: throw new UsageError(`unknown argument ${flag}`);
    }
  }
  if (!args.dir) throw new UsageError("--dir is required");
  if (args.configs.length === 0) throw new UsageError("at least one --config is required");
  if (!args.dryRun && !args.out) throw new UsageError("--out is required unless --dry-run");
  return args;
}

function positiveInteger(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new UsageError(`${flag} must be a positive integer`);
  return parsed;
}

function isCaptureRecord(value: unknown): value is ThoughtReplayCaptureRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ThoughtReplayCaptureRecord>;
  return record.schema === THOUGHT_REPLAY_CAPTURE_SCHEMA
    && Array.isArray(record.messages)
    && typeof record.modelId === "string"
    && typeof record.effort === "string"
    && typeof record.lifeboat === "boolean"
    && typeof record.parseContext === "object"
    && record.parseContext !== null
    && Array.isArray(record.parseContext.allowlistedReferences)
    && Array.isArray(record.parseContext.concernInspectRefs);
}

/** Loads captures in capture order, keeps the newest --limit after the pass filter. Skips unreadable files. */
function loadCaptures(args: CliArgs): { captures: LoadedCapture[]; skipped: number } {
  if (!existsSync(args.dir)) throw new UsageError("capture directory not found");
  const names = readdirSync(args.dir).filter((name) => THOUGHT_REPLAY_CAPTURE_FILE_PATTERN.test(name)).sort();
  let skipped = 0;
  const loaded: LoadedCapture[] = [];
  names.forEach((file, index) => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(args.dir, file), "utf8"));
      if (!isCaptureRecord(parsed)) {
        skipped += 1;
        return;
      }
      if (args.pass !== null && parsed.passKind !== args.pass) return;
      loaded.push({ file, index, record: parsed });
    } catch {
      skipped += 1;
    }
  });
  const captures = args.limit === null ? loaded : loaded.slice(Math.max(0, loaded.length - args.limit));
  return { captures, skipped };
}

function wireFields(body: unknown): { model: string | null; effort: string | null } {
  const parsed = (typeof body === "string" ? JSON.parse(body) : {}) as Record<string, unknown>;
  return {
    model: typeof parsed.model === "string" ? parsed.model : null,
    effort: typeof parsed.reasoning_effort === "string" ? parsed.reasoning_effort : null,
  };
}

function reasonCode(raw: string): string {
  return /^[a-z0-9_]{1,80}$/.test(raw) ? raw : "unclassified";
}

function classifyFailure(error: unknown): { status: ReplayRow["status"]; errorCode: string } {
  if (error instanceof ReplayWireRefusal) return { status: "refused", errorCode: "replay_wire_config_mismatch" };
  if (error instanceof AppError) {
    const status = error.code === "capability_mismatch" ? "refused" : "error";
    return { status, errorCode: `${reasonCode(error.code)}/${reasonCode(error.message)}` };
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { status: "timeout", errorCode: error.name };
  }
  return { status: "error", errorCode: "unclassified_error" };
}

function roundSeconds(milliseconds: number): number {
  return Math.round(milliseconds) / 1000;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { captures, skipped } = loadCaptures(args);
  const passCounts = new Map<string, number>();
  for (const capture of captures) {
    const key = capture.record.passKind ?? "unknown";
    passCounts.set(key, (passCounts.get(key) ?? 0) + 1);
  }
  const passes = [...passCounts].map(([pass, count]) => `${pass}=${count}`).join(" ") || "none";
  console.error(`[replay] captures=${captures.length} skipped=${skipped} passes: ${passes}`);
  console.error(`[replay] configs=${args.configs.map((config) => config.label).join(",")} dispatches=${captures.length * args.configs.length}`);
  if (args.dryRun) return;
  if (captures.length === 0) throw new UsageError("no matching captures");

  const envFile = args.envFile ?? join(homedir(), ".composer-assistant", ".env");
  if (!existsSync(envFile)) throw new UsageError("env file not found; pass --env-file");
  loadEnvFile(envFile);

  // The guard sits in front of the real fetch. A request whose model or effort differs from the
  // configuration under test is refused before it leaves the process.
  let expected: { modelId: string; effort: string } | null = null;
  let wire: { model: string | null; effort: string | null } = { model: null, effort: null };
  const guardedFetch: CommandCodeFetch = async (url, init) => {
    wire = wireFields(init?.body);
    if (!expected || wire.model !== expected.modelId || wire.effort !== expected.effort) {
      throw new ReplayWireRefusal();
    }
    return fetch(url, init);
  };
  const adapter = createCommandCodeAdapter(guardedFetch);

  const rows: ReplayRow[] = [];
  const total = captures.length * args.configs.length;
  let done = 0;
  for (const capture of captures) {
    for (const config of args.configs) {
      done += 1;
      const record = capture.record;
      expected = { modelId: config.modelId, effort: config.effort };
      wire = { model: null, effort: null };
      const started = performance.now();
      const base = {
        captureFile: capture.file,
        captureIndex: capture.index,
        passKind: record.passKind,
        contractProfile: record.contractProfile,
        config: config.label,
        wallSeconds: null,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        finishReason: null,
        parseOk: null,
        parseCode: null,
        domusOption: null,
      };
      let row: ReplayRow;
      try {
        const completion = await adapter.dispatch({
          messages: record.messages,
          modelId: config.modelId,
          options: {
            thoughtTriggerKind: record.triggerKind ?? undefined,
            thoughtContractPass: record.passKind ?? undefined,
            thoughtLifeboat: record.lifeboat,
            structuredOutput: thoughtOutputStructuredRequest(),
            maxTokens: record.maxTokens ?? undefined,
            temperature: record.temperature ?? undefined,
            reasoningEffort: config.effort,
            // Command Code always sends json_object (adapter constant); the wire fields above show it.
            responseFormat: "json_object",
          },
          signal: AbortSignal.timeout(args.timeoutSeconds * 1000),
        });
        const verdict = parseThoughtSemanticOutput(
          completion.text,
          new Set(record.parseContext.allowlistedReferences),
          {
            concernInspectRefs: new Set(record.parseContext.concernInspectRefs),
            concernDiscoverAllowed: record.parseContext.concernDiscoverAllowed,
          },
        );
        const domusOption = verdict.ok && verdict.value.kind === "settlement"
          ? verdict.value.domusAct?.option ?? null
          : null;
        row = {
          ...base,
          status: "ok",
          wallSeconds: roundSeconds(performance.now() - started),
          inputTokens: completion.usage?.promptTokens ?? null,
          outputTokens: completion.usage?.completionTokens ?? null,
          reasoningTokens: completion.usage?.reasoningTokens ?? null,
          finishReason: completion.finishReason ?? null,
          parseOk: verdict.ok,
          parseCode: verdict.ok ? null : verdict.code,
          domusOption,
          wireModel: wire.model,
          wireEffort: wire.effort,
          errorCode: null,
        };
      } catch (error) {
        const failure = classifyFailure(error);
        row = {
          ...base,
          ...failure,
          wireModel: wire.model,
          wireEffort: wire.effort,
        };
      }
      rows.push(row);
      console.error(
        `[replay] ${done}/${total} ${config.label} ${row.status}`
        + ` wall_s=${row.wallSeconds ?? "-"} out=${row.outputTokens ?? "-"} parse_ok=${row.parseOk ?? "-"}`
        + (row.errorCode ? ` error=${row.errorCode}` : ""),
      );
    }
  }

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, formatReplayCsv(rows), "utf8");
    console.error(`[replay] wrote ${rows.length} rows`);
  }
  for (const line of formatReplaySummaryLines(summarizeReplayRows(rows, args.configs.map((config) => config.label)))) {
    console.log(line);
  }
}

// exitCode, not process.exit: piped stdout on Windows can be cut short by an immediate exit.
main().then(
  () => {
    process.exitCode = 0;
  },
  (error: unknown) => {
    // Never print the error object: it may carry request context. Only a usage hint or a fixed code.
    if (error instanceof UsageError) {
      console.error(`${error.message}\n${USAGE}`);
    } else {
      console.error(`[replay] failed: ${classifyFailure(error).errorCode}`);
    }
    process.exitCode = 1;
  },
);
