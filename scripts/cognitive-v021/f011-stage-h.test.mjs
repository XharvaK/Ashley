import assert from "node:assert/strict";
import test from "node:test";
import {
  admitStageHWakeAndCycle,
  buildStageHResult,
  isSafeIsolatedRoot,
  percentile,
  stageHChecksPass,
} from "./f011-stage-h.mjs";

test("percentile uses a deterministic nearest-rank distribution", () => {
  assert.equal(percentile([30, 10, 20], 0.5), 20);
  assert.equal(percentile([30, 10, 20], 0.95), 30);
  assert.equal(percentile([], 0.95), null);
});

test("Stage H passes only when every independent check passes", () => {
  const checks = [
    { id: "fts5", pass: true },
    { id: "rebuild", pass: true },
  ];
  assert.equal(stageHChecksPass(checks), true);
  assert.equal(stageHChecksPass([...checks, { id: "source_scan", pass: false }]), false);
  assert.equal(stageHChecksPass([]), false);
});

test("Stage H refuses production roots and validates a complete result", () => {
  assert.equal(isSafeIsolatedRoot("C:/Users/Xharv/Projects/isolated-f011"), true);
  assert.equal(isSafeIsolatedRoot("C:/Users/Xharv/.composer-assistant/f011"), false);

  const result = buildStageHResult({
    candidateSha: "a".repeat(40),
    environment: "linux",
    checks: [{ id: "fts5", pass: true }],
    raw: { cpu: "x86_64" },
  });
  assert.equal(result.schema, "ashley.f011.stage-h.v1");
  assert.equal(result.pass, true);
  assert.throws(
    () => buildStageHResult({ candidateSha: "a".repeat(40), environment: "linux", checks: [], raw: {} }),
    /stage_h_checks_missing/,
  );
});

test("Stage H admits the authoritative wake and forwards its durable identity", () => {
  const wakeInputs = [];
  const cycleInputs = [];
  const cycle = admitStageHWakeAndCycle({
    sidecar: {},
    occurrenceIdFor: () => "occurrence:stage-h",
    admitWake: (_sidecar, input) => {
      wakeInputs.push(input);
      return { kind: "created", wake: { wakeId: "wake:authoritative" } };
    },
    admitCycle: (_sidecar, input) => {
      cycleInputs.push(input);
      return { cycleId: input.cycleId, wakeId: input.wakeId };
    },
    conversationId: "stage-h-conversation",
    cycleId: "stage-h-cycle",
    triggerRef: "stage-h-trigger",
    occupantId: "mfo_nim_openai_gpt_oss_20b_low",
    authorityEpoch: 1,
    nowMs: 1000,
  });

  assert.equal(wakeInputs.length, 1);
  assert.equal(cycleInputs.length, 1);
  assert.equal(cycleInputs[0].wakeId, "wake:authoritative");
  assert.equal(cycle.wakeId, "wake:authoritative");
});

test("Stage H refuses to admit a cycle when wake admission is stale or cancelled", () => {
  let cycleCalls = 0;
  for (const kind of ["stale", "cancelled"]) {
    assert.throws(
      () => admitStageHWakeAndCycle({
        sidecar: {},
        occurrenceIdFor: () => "occurrence:stage-h",
        admitWake: () => ({ kind, wake: { wakeId: "wake:terminal" }, terminalWake: { wakeId: "wake:terminal" } }),
        admitCycle: () => {
          cycleCalls += 1;
          return {};
        },
        conversationId: "stage-h-conversation",
        cycleId: "stage-h-cycle",
        triggerRef: "stage-h-trigger",
        occupantId: "mfo_nim_openai_gpt_oss_20b_low",
        authorityEpoch: 1,
        nowMs: 1000,
      }),
      /stage_h_wake_not_admissible/,
    );
  }
  assert.equal(cycleCalls, 0);
});
