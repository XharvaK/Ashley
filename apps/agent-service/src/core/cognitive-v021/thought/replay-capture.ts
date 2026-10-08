/**
 * Opt-in capture of dispatched Thought requests for offline replay.
 *
 * Developer measurement tooling only. It changes nothing about what Ashley
 * sends or decides. Off unless ASHLEY_THOUGHT_REPLAY_CAPTURE_DIR is set. When
 * on, each Thought dispatch writes one JSON file to that directory BEFORE the
 * provider call: the exact messages array, the pass kind, the contract profile
 * key, the policy model and effort, and the parse context the Thought parser
 * needs to replay the answer.
 *
 * PRIVACY: these files contain private conversation data. They are local only.
 * They must never be committed, logged, uploaded, or sent to any service other
 * than the provider the pass already uses. Keep the directory outside the
 * repository. Replay (scripts/replay-thought.ts) reads them and sends them only
 * through the Command Code adapter, the same provider path production uses.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  thoughtLifeboatForTrigger,
  thoughtModelForTrigger,
  thoughtReasoningEffortForTrigger,
} from "../../command-code/policy.js";
import type { ChatMessage, CompletionOptions } from "../../model-routing/types.js";

export const THOUGHT_REPLAY_CAPTURE_DIR_ENV = "ASHLEY_THOUGHT_REPLAY_CAPTURE_DIR";
export const THOUGHT_REPLAY_CAPTURE_MAX_FILES_ENV = "ASHLEY_THOUGHT_REPLAY_CAPTURE_MAX_FILES";
export const THOUGHT_REPLAY_CAPTURE_DEFAULT_MAX_FILES = 50;
export const THOUGHT_REPLAY_CAPTURE_MAX_FILES_CEILING = 1000;
export const THOUGHT_REPLAY_CAPTURE_SCHEMA = "ashley.thought_replay_capture.v1" as const;
/** Zero-padded epoch milliseconds first, so lexical order is capture order. */
export const THOUGHT_REPLAY_CAPTURE_FILE_PATTERN = /^thought-\d{13}-[0-9a-f]{8}\.json$/;

export type ThoughtReplayCaptureSettings = Readonly<{
  dir: string;
  maxFiles: number;
}>;

/** Resolves the opt-in settings. Null means capture is OFF (no env flag, or a blank one). */
export function thoughtReplayCaptureSettings(
  env: NodeJS.ProcessEnv = process.env,
): ThoughtReplayCaptureSettings | null {
  const raw = env[THOUGHT_REPLAY_CAPTURE_DIR_ENV]?.trim();
  if (!raw) return null;
  const requestedMax = Number(env[THOUGHT_REPLAY_CAPTURE_MAX_FILES_ENV]);
  const maxFiles = Number.isSafeInteger(requestedMax) && requestedMax >= 1
    ? Math.min(requestedMax, THOUGHT_REPLAY_CAPTURE_MAX_FILES_CEILING)
    : THOUGHT_REPLAY_CAPTURE_DEFAULT_MAX_FILES;
  return Object.freeze({ dir: resolve(raw), maxFiles });
}

export type ThoughtReplayCaptureRecord = {
  schema: typeof THOUGHT_REPLAY_CAPTURE_SCHEMA;
  capturedAtMs: number;
  /** Profile pass: domus, chat, private, awake, night or afterglow. */
  passKind: string | null;
  /** Full contract profile key, for example domus+owner+act. */
  contractProfile: string | null;
  triggerKind: string | null;
  lifeboat: boolean;
  /** Policy model and effort this dispatch used (the same policy functions the adapter gates on). */
  modelId: string;
  effort: string;
  /** Requested wire format. Command Code always sends json_object; the replay records what it sent. */
  responseFormatRequested: string | null;
  maxTokens: number | null;
  temperature: number | null;
  contract: {
    contractId: string | null;
    schemaId: string | null;
  };
  /** Inputs the Thought parser needs to judge the answer the same way production does. */
  parseContext: {
    allowlistedReferences: string[];
    concernInspectRefs: string[];
    concernDiscoverAllowed: boolean;
  };
  messages: ChatMessage[];
};

export type ThoughtReplayCaptureInput = {
  messages: readonly ChatMessage[];
  options: CompletionOptions;
  profileKey: string;
  allowlistedReferences: Iterable<string>;
  concernInspectRefs: ReadonlySet<string>;
  concernDiscoverAllowed: boolean;
};

export function buildThoughtReplayCaptureRecord(
  input: ThoughtReplayCaptureInput,
  capturedAtMs: number,
): ThoughtReplayCaptureRecord {
  const kind = input.options.thoughtTriggerKind;
  const lifeboat = input.options.thoughtLifeboat === true;
  const lifeboatTarget = lifeboat ? thoughtLifeboatForTrigger(kind) : null;
  const structured = input.options.structuredOutput;
  return {
    schema: THOUGHT_REPLAY_CAPTURE_SCHEMA,
    capturedAtMs,
    passKind: input.options.thoughtContractPass ?? null,
    contractProfile: input.profileKey,
    triggerKind: kind ?? null,
    lifeboat,
    modelId: lifeboatTarget ? lifeboatTarget.modelId : thoughtModelForTrigger(kind),
    effort: lifeboatTarget ? lifeboatTarget.effort : thoughtReasoningEffortForTrigger(kind),
    responseFormatRequested: input.options.responseFormat ?? null,
    maxTokens: input.options.maxTokens ?? null,
    temperature: input.options.temperature ?? null,
    contract: {
      contractId: structured?.contractId ?? null,
      schemaId: structured?.schemaId ?? null,
    },
    parseContext: {
      allowlistedReferences: [...input.allowlistedReferences],
      concernInspectRefs: [...input.concernInspectRefs],
      concernDiscoverAllowed: input.concernDiscoverAllowed,
    },
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.imageUrls?.length ? { imageUrls: [...message.imageUrls] } : {}),
    })),
  };
}

/**
 * Writes one capture file (mode 0600 where the platform honours it) and prunes
 * the oldest capture files beyond maxFiles. Only files matching the capture
 * name pattern are ever removed. Throws on I/O failure; the caller decides.
 */
export function writeThoughtReplayCapture(
  settings: ThoughtReplayCaptureSettings,
  record: ThoughtReplayCaptureRecord,
): string {
  mkdirSync(settings.dir, { recursive: true, mode: 0o700 });
  const name = `thought-${String(record.capturedAtMs).padStart(13, "0")}-${randomUUID().slice(0, 8)}.json`;
  writeFileSync(join(settings.dir, name), JSON.stringify(record), { flag: "wx", mode: 0o600 });
  pruneThoughtReplayCaptures(settings);
  return name;
}

function pruneThoughtReplayCaptures(settings: ThoughtReplayCaptureSettings): void {
  const names = readdirSync(settings.dir)
    .filter((name) => THOUGHT_REPLAY_CAPTURE_FILE_PATTERN.test(name))
    .sort();
  const excess = names.length - settings.maxFiles;
  for (const name of names.slice(0, Math.max(0, excess))) {
    unlinkSync(join(settings.dir, name));
  }
}

/**
 * Capture entry point for the Thought dispatch boundary. Never throws and never
 * changes the pass: a failed write is swallowed, and nothing is logged, because
 * a log line could carry paths or content.
 */
export function captureThoughtReplayDispatch(
  settings: ThoughtReplayCaptureSettings,
  input: ThoughtReplayCaptureInput,
  capturedAtMs: number,
): boolean {
  try {
    writeThoughtReplayCapture(settings, buildThoughtReplayCaptureRecord(input, capturedAtMs));
    return true;
  } catch {
    return false;
  }
}
