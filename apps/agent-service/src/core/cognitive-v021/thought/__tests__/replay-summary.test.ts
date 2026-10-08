import { describe, it, expect } from "vitest";
import {
  REPLAY_ROW_COLUMNS,
  formatReplayCsv,
  formatReplaySummaryLines,
  percentile,
  summarizeReplayRows,
  type ReplayRow,
} from "../replay-summary.js";

const CONFIG_A = "fixture-a:medium";
const CONFIG_B = "fixture-b:medium";

function row(overrides: Partial<ReplayRow>): ReplayRow {
  return {
    captureFile: "thought-0000000000001-aaaaaaaa.json",
    captureIndex: 0,
    passKind: "domus",
    contractProfile: "domus+owner+act",
    config: CONFIG_A,
    status: "ok",
    wallSeconds: 10,
    inputTokens: 100,
    outputTokens: 1000,
    reasoningTokens: 200,
    finishReason: "stop",
    parseOk: true,
    parseCode: null,
    domusOption: "r1",
    wireModel: "fixture-model",
    wireEffort: "medium",
    errorCode: null,
    ...overrides,
  };
}

/** Four captures, two configs. Expected values are worked out by hand in each test. */
function fixtureRows(): ReplayRow[] {
  const file = (n: number) => `thought-000000000000${n}-aaaaaaaa.json`;
  return [
    row({ captureFile: file(1), captureIndex: 1, config: CONFIG_A, wallSeconds: 10, outputTokens: 1000, reasoningTokens: 200, domusOption: "r1" }),
    row({ captureFile: file(2), captureIndex: 2, config: CONFIG_A, wallSeconds: 20, outputTokens: 2000, reasoningTokens: 400, domusOption: "r2" }),
    row({ captureFile: file(3), captureIndex: 3, config: CONFIG_A, wallSeconds: 30, outputTokens: 3000, reasoningTokens: null, parseOk: false, parseCode: "wrong_type", domusOption: null }),
    row({ captureFile: file(4), captureIndex: 4, config: CONFIG_A, status: "refused", wallSeconds: null, outputTokens: null, reasoningTokens: null, parseOk: null, domusOption: null, errorCode: "capability_mismatch/command_code_policy_effort_required" }),
    row({ captureFile: file(1), captureIndex: 1, config: CONFIG_B, wallSeconds: 5, outputTokens: 500, reasoningTokens: 100, domusOption: "r1" }),
    row({ captureFile: file(2), captureIndex: 2, config: CONFIG_B, wallSeconds: 15, outputTokens: 1500, reasoningTokens: 300, domusOption: "r9" }),
    row({ captureFile: file(3), captureIndex: 3, config: CONFIG_B, wallSeconds: 25, outputTokens: 2500, reasoningTokens: 500, domusOption: "r3" }),
    row({ captureFile: file(4), captureIndex: 4, config: CONFIG_B, status: "timeout", wallSeconds: null, outputTokens: null, reasoningTokens: null, parseOk: null, domusOption: null, errorCode: "TimeoutError" }),
  ];
}

describe("percentile", () => {
  it("uses the nearest-rank method on sorted values", () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(ten, 50)).toBe(5);
    expect(percentile(ten, 90)).toBe(9);
    expect(percentile(ten, 100)).toBe(10);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });

  it("returns the only value for a single sample and null for none", () => {
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("summarizeReplayRows", () => {
  const [baseline, other] = summarizeReplayRows(fixtureRows(), [CONFIG_A, CONFIG_B]);

  it("counts dispatches by outcome", () => {
    expect(baseline).toMatchObject({ config: CONFIG_A, dispatches: 4, completed: 3, refused: 1, failed: 0 });
    expect(other).toMatchObject({ config: CONFIG_B, dispatches: 4, completed: 3, refused: 0, failed: 1 });
  });

  it("takes p50 and p90 over completed dispatches only", () => {
    expect(baseline.p50Seconds).toBe(20);
    expect(baseline.p90Seconds).toBe(30);
    expect(other.p50Seconds).toBe(15);
    expect(other.p90Seconds).toBe(25);
  });

  it("means output and reasoning tokens over completed dispatches that report them", () => {
    expect(baseline.meanOutputTokens).toBe(2000);
    expect(baseline.meanReasoningTokens).toBe(300);
    expect(other.meanOutputTokens).toBe(1500);
    expect(other.meanReasoningTokens).toBe(300);
  });

  it("reports parse success over completed dispatches", () => {
    expect(baseline.parseOkPct).toBeCloseTo(66.7, 1);
    expect(other.parseOkPct).toBe(100);
  });

  it("compares Domus choices with the baseline only where both produced one", () => {
    expect(baseline.domusAgreementPct).toBeNull();
    expect(baseline.domusComparable).toBe(0);
    // Captures 1 and 2 compare (match, then mismatch); 3 has no baseline choice; 4 was refused.
    expect(other.domusComparable).toBe(2);
    expect(other.domusAgreementPct).toBe(50);
  });

  it("returns nulls rather than NaN when a config has no completed dispatches", () => {
    const [, empty] = summarizeReplayRows(
      fixtureRows().map((item) => (item.config === CONFIG_B ? { ...item, status: "error" as const, wallSeconds: null } : item)),
      [CONFIG_A, CONFIG_B],
    );
    expect(empty.p50Seconds).toBeNull();
    expect(empty.meanOutputTokens).toBeNull();
    expect(empty.parseOkPct).toBeNull();
  });
});

describe("replay output carries measurements, never content", () => {
  it("summary objects and printed lines hold only fixed numeric and label fields", () => {
    const summaries = summarizeReplayRows(fixtureRows(), [CONFIG_A, CONFIG_B]);
    expect(Object.keys(summaries[0]).sort()).toEqual([
      "completed",
      "config",
      "dispatches",
      "domusAgreementPct",
      "domusComparable",
      "failed",
      "meanOutputTokens",
      "meanReasoningTokens",
      "p50Seconds",
      "p90Seconds",
      "parseOkPct",
      "refused",
    ]);
    const lines = formatReplaySummaryLines(summaries);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("p50_s");
    expect(lines[2]).toContain("50.0 (2)");
    expect(lines[1].endsWith("| baseline")).toBe(true);
  });

  it("CSV columns hold no field for model text, output text or messages", () => {
    const forbidden = ["content", "text", "message", "messages", "answer", "output_text", "prompt", "body"];
    for (const column of REPLAY_ROW_COLUMNS) {
      for (const word of forbidden) expect(column.toLowerCase()).not.toContain(word);
    }
  });
});

describe("formatReplayCsv", () => {
  it("writes the header, one line per row, empty cells for nulls, and quotes awkward cells", () => {
    const csv = formatReplayCsv([
      row({ captureFile: "fixture,with-comma.json", wallSeconds: null, domusOption: null }),
    ]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(REPLAY_ROW_COLUMNS.join(","));
    expect(lines[1].startsWith('"fixture,with-comma.json",0,domus,domus+owner+act,fixture-a:medium,ok,,100,1000,200,stop,true,,,fixture-model,medium,')).toBe(true);
  });
});
