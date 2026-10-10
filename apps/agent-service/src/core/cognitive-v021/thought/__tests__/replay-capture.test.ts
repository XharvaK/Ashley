import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  THOUGHT_REPLAY_CAPTURE_DEFAULT_MAX_FILES,
  THOUGHT_REPLAY_CAPTURE_DIR_ENV,
  THOUGHT_REPLAY_CAPTURE_FILE_PATTERN,
  THOUGHT_REPLAY_CAPTURE_MAX_FILES_CEILING,
  THOUGHT_REPLAY_CAPTURE_MAX_FILES_ENV,
  THOUGHT_REPLAY_CAPTURE_SCHEMA,
  buildThoughtReplayCaptureRecord,
  captureThoughtReplayDispatch,
  thoughtReplayCaptureSettings,
  writeThoughtReplayCapture,
  type ThoughtReplayCaptureInput,
} from "../replay-capture.js";
import { thoughtOutputStructuredRequest } from "../output-contract.js";
import { THOUGHT_OUTPUT_CONTRACT_ID, THOUGHT_OUTPUT_SCHEMA_ID } from "../contract-identity.js";

const made: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "thought-replay-test-"));
  made.push(dir);
  return join(dir, "captures");
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureInput(overrides: Partial<ThoughtReplayCaptureInput> = {}): ThoughtReplayCaptureInput {
  return {
    messages: [
      { role: "system", content: "fixture system line" },
      { role: "user", content: "fixture user line" },
    ],
    options: {
      thoughtTriggerKind: "domus_notification",
      thoughtContractPass: "domus",
      thoughtLifeboat: false,
      responseFormat: "json_schema",
      maxTokens: 4096,
      temperature: 1,
      structuredOutput: thoughtOutputStructuredRequest(),
    },
    profileKey: "domus+owner+act",
    allowlistedReferences: ["fixture-ref-a", "fixture-ref-b"],
    concernInspectRefs: new Set(["fixture-concern"]),
    concernDiscoverAllowed: false,
    ...overrides,
  };
}

describe("thoughtReplayCaptureSettings", () => {
  it("is off without the directory flag", () => {
    expect(thoughtReplayCaptureSettings({})).toBeNull();
  });

  it("is off for a blank directory flag", () => {
    expect(thoughtReplayCaptureSettings({ [THOUGHT_REPLAY_CAPTURE_DIR_ENV]: "   " })).toBeNull();
  });

  it("defaults to 50 files and resolves the directory", () => {
    const settings = thoughtReplayCaptureSettings({ [THOUGHT_REPLAY_CAPTURE_DIR_ENV]: "fixture-dir" });
    expect(settings?.maxFiles).toBe(THOUGHT_REPLAY_CAPTURE_DEFAULT_MAX_FILES);
    expect(settings?.maxFiles).toBe(50);
    expect(settings?.dir.length).toBeGreaterThan("fixture-dir".length);
  });

  it("reads a valid max, falls back on junk, and clamps at the ceiling", () => {
    const base = { [THOUGHT_REPLAY_CAPTURE_DIR_ENV]: "fixture-dir" };
    expect(thoughtReplayCaptureSettings({ ...base, [THOUGHT_REPLAY_CAPTURE_MAX_FILES_ENV]: "7" })?.maxFiles).toBe(7);
    expect(thoughtReplayCaptureSettings({ ...base, [THOUGHT_REPLAY_CAPTURE_MAX_FILES_ENV]: "zero" })?.maxFiles).toBe(50);
    expect(thoughtReplayCaptureSettings({ ...base, [THOUGHT_REPLAY_CAPTURE_MAX_FILES_ENV]: "0" })?.maxFiles).toBe(50);
    expect(thoughtReplayCaptureSettings({ ...base, [THOUGHT_REPLAY_CAPTURE_MAX_FILES_ENV]: "999999" })?.maxFiles)
      .toBe(THOUGHT_REPLAY_CAPTURE_MAX_FILES_CEILING);
  });
});

describe("buildThoughtReplayCaptureRecord", () => {
  it("records the policy model and effort for a Domus pass and for a lifeboat dispatch", () => {
    const domus = buildThoughtReplayCaptureRecord(fixtureInput(), 1);
    expect(domus.modelId).toBe("deepseek/deepseek-v4.1-flash-fast");
    expect(domus.effort).toBe("low");
    const lifeboat = buildThoughtReplayCaptureRecord(
      fixtureInput({ options: { ...fixtureInput().options, thoughtLifeboat: true } }),
      1,
    );
    expect(lifeboat.modelId).toBe("meta/muse-spark-1.3-contributor");
    expect(lifeboat.effort).toBe("low");
    const chat = buildThoughtReplayCaptureRecord(
      fixtureInput({ options: { ...fixtureInput().options, thoughtTriggerKind: "owner_message", thoughtContractPass: "chat" } }),
      1,
    );
    expect(chat.modelId).toBe("meta/muse-spark-1.3-contributor");
    expect(chat.effort).toBe("high");
  });

  it("copies messages and drops image arrays that are empty", () => {
    const record = buildThoughtReplayCaptureRecord(
      fixtureInput({
        messages: [
          { role: "user", content: "fixture text", imageUrls: [] },
          { role: "user", content: "fixture picture", imageUrls: ["data:image/png;base64,AAAA"] },
        ],
      }),
      1,
    );
    expect(record.messages[0]).toEqual({ role: "user", content: "fixture text" });
    expect(record.messages[1]).toEqual({
      role: "user",
      content: "fixture picture",
      imageUrls: ["data:image/png;base64,AAAA"],
    });
  });
});

describe("captureThoughtReplayDispatch", () => {
  it("writes one file per dispatch with the expected keys", () => {
    const dir = freshDir();
    const settings = { dir, maxFiles: 50 };
    expect(captureThoughtReplayDispatch(settings, fixtureInput(), 1_700_000_000_000)).toBe(true);
    expect(captureThoughtReplayDispatch(settings, fixtureInput(), 1_700_000_000_001)).toBe(true);
    const names = readdirSync(dir);
    expect(names).toHaveLength(2);
    for (const name of names) expect(THOUGHT_REPLAY_CAPTURE_FILE_PATTERN.test(name)).toBe(true);

    const record = JSON.parse(readFileSync(join(dir, names.sort()[0]), "utf8")) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual([
      "capturedAtMs",
      "contract",
      "contractProfile",
      "effort",
      "lifeboat",
      "maxTokens",
      "messages",
      "modelId",
      "parseContext",
      "passKind",
      "responseFormatRequested",
      "schema",
      "temperature",
      "triggerKind",
    ]);
    expect(record.schema).toBe(THOUGHT_REPLAY_CAPTURE_SCHEMA);
    expect(record.passKind).toBe("domus");
    expect(record.contractProfile).toBe("domus+owner+act");
    expect(record.contract).toEqual({ contractId: THOUGHT_OUTPUT_CONTRACT_ID, schemaId: THOUGHT_OUTPUT_SCHEMA_ID });
  });

  it("writes files that are private where the platform enforces modes", () => {
    if (process.platform === "win32") return;
    const dir = freshDir();
    captureThoughtReplayDispatch({ dir, maxFiles: 50 }, fixtureInput(), 1_700_000_000_000);
    const [name] = readdirSync(dir);
    expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
  });

  it("prunes the oldest capture files beyond the limit and leaves unrelated files alone", () => {
    const dir = freshDir();
    const settings = { dir, maxFiles: 2 };
    writeThoughtReplayCapture({ dir, maxFiles: 50 }, buildThoughtReplayCaptureRecord(fixtureInput(), 0));
    writeFileSync(join(dir, "notes-kept.txt"), "fixture note");
    for (let index = 1; index <= 3; index += 1) {
      captureThoughtReplayDispatch(settings, fixtureInput(), 1_700_000_000_000 + index);
    }
    const names = readdirSync(dir).sort();
    const captures = names.filter((name) => THOUGHT_REPLAY_CAPTURE_FILE_PATTERN.test(name));
    expect(captures).toHaveLength(2);
    expect(captures[0].startsWith("thought-1700000000002-")).toBe(true);
    expect(captures[1].startsWith("thought-1700000000003-")).toBe(true);
    expect(names).toContain("notes-kept.txt");
  });

  it("never throws when the directory cannot be written", () => {
    const dir = freshDir();
    writeFileSync(dir, "fixture blocker");
    expect(captureThoughtReplayDispatch({ dir, maxFiles: 5 }, fixtureInput(), 1)).toBe(false);
  });
});
