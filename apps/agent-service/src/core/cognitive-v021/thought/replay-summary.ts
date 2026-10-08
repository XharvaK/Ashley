/**
 * Pure summary and CSV formatting for the Thought replay tool
 * (scripts/replay-thought.ts). Rows hold measurements and parse verdicts only.
 * No field carries message text, model output, or credentials, by construction:
 * the replay never writes answer text, and this module has no field for it.
 */

export type ReplayRowStatus = "ok" | "refused" | "timeout" | "error";

export type ReplayRow = {
  captureFile: string;
  captureIndex: number;
  passKind: string | null;
  contractProfile: string | null;
  /** The configuration asked for, as model:effort. */
  config: string;
  status: ReplayRowStatus;
  /** Set only for ok rows. */
  wallSeconds: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  finishReason: string | null;
  parseOk: boolean | null;
  /** Parser failure code (a fixed code-owned value), never prose. */
  parseCode: string | null;
  /** Chosen domusAct.option ref (a short game ref, max 16 characters), for Domus passes only. */
  domusOption: string | null;
  /** What the adapter actually put on the wire. Shows a config the adapter cannot express. */
  wireModel: string | null;
  wireEffort: string | null;
  /** Code-owned refusal or error class, never message text. */
  errorCode: string | null;
};

export const REPLAY_ROW_COLUMNS: ReadonlyArray<keyof ReplayRow> = [
  "captureFile",
  "captureIndex",
  "passKind",
  "contractProfile",
  "config",
  "status",
  "wallSeconds",
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "finishReason",
  "parseOk",
  "parseCode",
  "domusOption",
  "wireModel",
  "wireEffort",
  "errorCode",
];

export type ReplayConfigSummary = {
  config: string;
  dispatches: number;
  completed: number;
  refused: number;
  failed: number;
  p50Seconds: number | null;
  p90Seconds: number | null;
  meanOutputTokens: number | null;
  meanReasoningTokens: number | null;
  parseOkPct: number | null;
  /** Captures where both this config and the baseline produced a Domus choice. */
  domusComparable: number;
  /** Null for the baseline config itself. */
  domusAgreementPct: number | null;
};

/** Nearest-rank percentile (p in 0..100). Null when there are no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : (100 * part) / whole;
}

/**
 * Summarizes rows per config. configs[0] is the baseline for Domus agreement.
 * Timings and token means use only completed (ok) dispatches.
 */
export function summarizeReplayRows(
  rows: readonly ReplayRow[],
  configs: readonly string[],
): ReplayConfigSummary[] {
  const byCaptureAndConfig = new Map<string, ReplayRow>();
  for (const row of rows) byCaptureAndConfig.set(`${row.captureFile}\u0000${row.config}`, row);
  const baseline = configs[0];
  return configs.map((config, configIndex) => {
    const own = rows.filter((row) => row.config === config);
    const ok = own.filter((row) => row.status === "ok");
    const seconds = ok.flatMap((row) => (row.wallSeconds === null ? [] : [row.wallSeconds]));
    const outputs = ok.flatMap((row) => (row.outputTokens === null ? [] : [row.outputTokens]));
    const reasoning = ok.flatMap((row) => (row.reasoningTokens === null ? [] : [row.reasoningTokens]));
    let domusComparable = 0;
    let domusMatching = 0;
    if (configIndex > 0 && baseline !== undefined) {
      for (const row of own) {
        const base = byCaptureAndConfig.get(`${row.captureFile}\u0000${baseline}`);
        if (!base || base.domusOption === null || row.domusOption === null) continue;
        domusComparable += 1;
        if (base.domusOption === row.domusOption) domusMatching += 1;
      }
    }
    const failed = own.filter((row) => row.status === "timeout" || row.status === "error").length;
    return {
      config,
      dispatches: own.length,
      completed: ok.length,
      refused: own.filter((row) => row.status === "refused").length,
      failed,
      p50Seconds: percentile(seconds, 50),
      p90Seconds: percentile(seconds, 90),
      meanOutputTokens: mean(outputs),
      meanReasoningTokens: mean(reasoning),
      parseOkPct: pct(ok.filter((row) => row.parseOk === true).length, ok.length),
      domusComparable,
      domusAgreementPct: configIndex === 0 ? null : pct(domusMatching, domusComparable),
    };
  });
}

function fixed(value: number | null, digits: number): string {
  return value === null ? "-" : value.toFixed(digits);
}

/** Printable summary lines. Only numbers and config labels, never row content. */
export function formatReplaySummaryLines(summaries: readonly ReplayConfigSummary[]): string[] {
  const header = "config | n | ok | refused | failed | p50_s | p90_s | mean_out_tok | mean_reason_tok | parse_ok_% | domus_agree_% (n)";
  const lines = [header];
  summaries.forEach((summary, index) => {
    const agreement = index === 0
      ? "baseline"
      : `${fixed(summary.domusAgreementPct, 1)} (${summary.domusComparable})`;
    lines.push([
      summary.config,
      summary.dispatches,
      summary.completed,
      summary.refused,
      summary.failed,
      fixed(summary.p50Seconds, 1),
      fixed(summary.p90Seconds, 1),
      fixed(summary.meanOutputTokens, 0),
      fixed(summary.meanReasoningTokens, 0),
      fixed(summary.parseOkPct, 1),
      agreement,
    ].join(" | "));
  });
  return lines;
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatReplayCsv(rows: readonly ReplayRow[]): string {
  const lines = [REPLAY_ROW_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(REPLAY_ROW_COLUMNS.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}
