/**
 * THOUGHT-AFFINITY-QUALIFICATION-01 — bounded live provider qualification.
 *
 * GATED: the live quartet does nothing unless ASHLEY_LIVE_QUALIFY=1 is set in
 * the operator shell. It never runs in CI, never touches production
 * databases, cognition, memory, or conversation state. It dispatches at most
 * 8 synthetic Thought-shaped requests through the REAL production path
 * (completeChat -> Model Fabric -> Cloudflare adapter -> real fetch) against:
 *
 *   POST /accounts/{account}/ai/v1/chat/completions
 *   model @cf/deepseek-ai/deepseek-v4-flash-0731
 *
 * RUN ISOLATION: every invocation mints TWO independent random identities
 * via two separate randomUUID() calls: a prompt-namespace nonce (used ONLY
 * to namespace the model-visible synthetic A/B prefixes) and a transport
 * affinity id (used ONLY as the x-session-affinity header value, opaque
 * infrastructure state). Neither is derived from the other, so the semantic
 * prompt namespace can never encode or reveal the transport identity. A
 * retry mints both fresh. This is rerun isolation, NOT a provider cache
 * purge: A1/B1 are the first requests for their fresh synthetic families in
 * this invocation, but provider backend/cache locality remains outside
 * Ashley's control and no claim of provider-cold is made.
 *
 * Required operator shell exports before running (never committed):
 *
 *   CLOUDFLARE_API_TOKEN=...
 *   CLOUDFLARE_ACCOUNT_ID=...
 *   ASHLEY_LIVE_QUALIFY=1
 *   npx vitest run src/core/model-routing/adapters/affinity-qualification.live.test.ts
 *
 * Run from apps/agent-service. Budget: 8 provider calls, no retry.
 */
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { completeChat } from "../../../mistral-client.js";
import { env, refreshEnvFromProcess } from "../../../env.js";
import { openNuclearDb } from "../../db.js";
import { withOfflineAppGateDisabled } from "../../qualification/offline-test-helpers.js";
import { thoughtOutputStructuredRequest } from "../../cognitive-v021/thought/output-contract.js";
import { buildOperationalEffectNamespaceFromRefs } from "../../cognitive-v021/effect/effect-ref.js";
import { providerBoundaryTransportFromError, providerHttpStatusFromBoundary } from "../types.js";
import type { ChatMessage } from "../types.js";

const LIVE = process.env.ASHLEY_LIVE_QUALIFY === "1";

const AFFINITY_ENV_VAR = "ASHLEY_CLOUDFLARE_THOUGHT_AFFINITY_ID";
const originalAffinityEnv = process.env[AFFINITY_ENV_VAR];

afterEach(() => {
  if (originalAffinityEnv === undefined) delete process.env[AFFINITY_ENV_VAR];
  else process.env[AFFINITY_ENV_VAR] = originalAffinityEnv;
  refreshEnvFromProcess();
});

function sha8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

/**
 * Fresh per-invocation prompt-namespace nonce (hex). Namespaces ONLY the
 * synthetic model-visible A/B prefixes. Never used to construct the
 * transport affinity id. A new qualification invocation mints a new one.
 */
export function newQualPromptNonce(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Fresh per-invocation independent affinity material (hex), minted by its own
 * randomUUID() call. Never derived from the prompt nonce. Feeds ONLY the
 * transport x-session-affinity value; never placed in model-visible messages.
 */
export function newQualAffinityMaterial(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Synthetic treatment affinity id from INDEPENDENT affinity material.
 * Non-secret, never the production id, never logged raw, never persisted.
 * The caller MUST pass fresh affinity material — never the prompt nonce.
 * Same id for the whole B cohort of one invocation; a new invocation mints
 * different material and therefore a different id.
 */
export function buildRunAffinityId(affinityMaterial: string): string {
  return `live-qual-affinity-${affinityMaterial}`;
}

export type QualRunState = {
  /** Model-visible prefix namespacing only; never affinity material. */
  promptNonce: string;
  /** Opaque transport identity; never model-visible, never logged raw. */
  runAffinityId: string;
  /** Short non-sensitive run correlator derived from the prompt nonce only. */
  runId: string;
};

/**
 * Pure run-state constructor: wires the two independent identities together
 * without deriving one from the other. Deterministic seam for tests.
 */
export function buildQualRunState(promptNonce: string, affinityMaterial: string): QualRunState {
  return {
    promptNonce,
    runAffinityId: buildRunAffinityId(affinityMaterial),
    runId: promptNonce.slice(0, 8),
  };
}

/**
 * Mints both independent run identities via two separate randomUUID() calls.
 */
export function newQualRunState(): QualRunState {
  return buildQualRunState(newQualPromptNonce(), newQualAffinityMaterial());
}

/**
 * Deterministic ~30KB synthetic stable prefix per family and prompt nonce.
 * Families diverge immediately in their synthetic family namespace line;
 * variants mutate per the A/B quartet design. No owner data, no memory
 * content, no secrets, and never the transport affinity id. A new prompt
 * nonce yields a different prefix namespace.
 */
export function buildStablePrefix(
  family: "A" | "B",
  earlyMutation: boolean,
  promptNonce: string,
): string {
  const lines: string[] = [
    `SYNTHETIC PREFIX FAMILY ${family} RUN ${promptNonce} — Thought affinity cache-locality qualification only.`,
  ];
  for (let i = 0; i < 100; i += 1) {
    const head = i === 0 && earlyMutation
      ? `block 0000 family-${family} run-${promptNonce} EARLY-MUTATION probe variant with divergent opening tokens. `
      : `block ${String(i).padStart(4, "0")} family-${family} run-${promptNonce} stable synthetic context for prefix-cache measurement. `;
    lines.push(head + "synthetic stable context for prefix-cache measurement. ".repeat(5));
  }
  return lines.join("\n");
}

const TAIL_FIXED = "Summarize the counting task in one short sentence.";
const TAIL_LATE_MUTATION = "Summarize the counting task in one short sentence, then name the color blue.";

export function buildMessages(
  family: "A" | "B",
  variant: 1 | 2 | 3 | 4,
  promptNonce: string,
): ChatMessage[] {
  const system = buildStablePrefix(family, variant === 4, promptNonce);
  const user = variant === 3 ? TAIL_LATE_MUTATION : TAIL_FIXED;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

type QualRow = {
  /** Short non-sensitive run correlator (prompt-nonce prefix); never the affinity id. */
  runId: string;
  ordinal: number;
  family: "A" | "B";
  variant: number;
  affinityExpected: boolean;
  httpStatus: number | null;
  failureCode: string | null;
  sessionAffinityApplied: boolean | null;
  affinityPolicy: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  neuronUsage: number | null;
  elapsedMs: number | null;
  finishReason: string | null;
  providerModel: string | null;
  providerRequestIdPresent: boolean;
  messagesDigest: string;
};

/**
 * Serialize one evidence row for the harness log. The row type carries no
 * raw affinity identifier by construction; this single choke point keeps it
 * that way and is pinned by a deterministic test below.
 */
export function formatQualRow(row: QualRow): string {
  return JSON.stringify(row);
}

/**
 * Serialize the harness summary line. Carries only the non-sensitive run
 * correlator plus counts — never the raw transport affinity id. Pinned by a
 * deterministic test below so the live body cannot leak the id by drift.
 */
export function buildQualSummary(runId: string, providerCalls: number, rowCount: number): string {
  return JSON.stringify({ runId, providerCalls, rows: rowCount });
}

describe("affinity qualification synthetic construction (deterministic, no provider)", () => {
  const PROMPT = "0123456789ab";
  const AFFINITY_MATERIAL = "fedcba9876543210";
  const OTHER_PROMPT = "9876543210fe";
  const OTHER_AFFINITY_MATERIAL = "1234567890abcd";

  it("preserves exact-prefix relationships within one run", () => {
    // Exact-repeat pairs are byte-identical within one invocation.
    expect(JSON.stringify(buildMessages("A", 1, PROMPT))).toBe(JSON.stringify(buildMessages("A", 2, PROMPT)));
    expect(JSON.stringify(buildMessages("B", 1, PROMPT))).toBe(JSON.stringify(buildMessages("B", 2, PROMPT)));
    // Late-tail mutation changes only the tail message.
    const a1 = buildMessages("A", 1, PROMPT);
    const a3 = buildMessages("A", 3, PROMPT);
    expect(a3[0]).toEqual(a1[0]);
    expect(a3[1]).not.toEqual(a1[1]);
    // Early-prefix mutation changes the prefix, keeps the tail.
    const a4 = buildMessages("A", 4, PROMPT);
    expect(a4[0]).not.toEqual(a1[0]);
    expect(a4[1]).toEqual(a1[1]);
    // Families diverge immediately in their synthetic namespace line.
    const b1 = buildMessages("B", 1, PROMPT);
    expect(b1[0]).not.toEqual(a1[0]);
    expect(String(a1[0]?.content).split("\n")[0]).toContain(`RUN ${PROMPT}`);
  });

  it("keeps prompt namespace and transport affinity identity independent", () => {
    const state = buildQualRunState(PROMPT, AFFINITY_MATERIAL);
    const rawId = state.runAffinityId;
    expect(rawId).toBe(`live-qual-affinity-${AFFINITY_MATERIAL}`);
    // The affinity id carries no trace of the prompt nonce.
    expect(rawId).not.toContain(PROMPT);
    // No model-visible message in the whole 8-step plan contains the raw id.
    for (const family of ["A", "B"] as const) {
      for (const variant of [1, 2, 3, 4] as const) {
        expect(JSON.stringify(buildMessages(family, variant, state.promptNonce))).not.toContain(rawId);
      }
    }
    // Swapping affinity material changes only the affinity id, not the prompts.
    const swappedAffinity = buildQualRunState(PROMPT, OTHER_AFFINITY_MATERIAL);
    expect(swappedAffinity.runAffinityId).not.toBe(state.runAffinityId);
    expect(JSON.stringify(buildMessages("A", 1, swappedAffinity.promptNonce)))
      .toBe(JSON.stringify(buildMessages("A", 1, state.promptNonce)));
    // Swapping the prompt nonce changes only the prompts, not the affinity id.
    const swappedPrompt = buildQualRunState(OTHER_PROMPT, AFFINITY_MATERIAL);
    expect(swappedPrompt.runAffinityId).toBe(state.runAffinityId);
    expect(JSON.stringify(buildMessages("A", 1, swappedPrompt.promptNonce)))
      .not.toBe(JSON.stringify(buildMessages("A", 1, state.promptNonce)));
  });

  it("mints a fresh independent namespace and affinity id per run", () => {
    // Deterministic seam: distinct run inputs yield distinct namespaces and ids.
    const first = buildQualRunState(PROMPT, AFFINITY_MATERIAL);
    const second = buildQualRunState(OTHER_PROMPT, OTHER_AFFINITY_MATERIAL);
    expect(second.promptNonce).not.toBe(first.promptNonce);
    expect(second.runAffinityId).not.toBe(first.runAffinityId);
    expect(second.runId).not.toBe(first.runId);
    // Fresh mints are well-formed: hex12 prompt nonce, valid header-value id.
    const fresh = newQualRunState();
    expect(fresh.promptNonce).toMatch(/^[0-9a-f]{12}$/);
    expect(fresh.runAffinityId).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(fresh.runId).toBe(fresh.promptNonce.slice(0, 8));
    expect(newQualPromptNonce()).toMatch(/^[0-9a-f]{12}$/);
    expect(newQualAffinityMaterial()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("never serializes the raw treatment affinity id into harness logs", () => {
    const state = buildQualRunState(PROMPT, AFFINITY_MATERIAL);
    const rawId = state.runAffinityId;
    const row: QualRow = {
      runId: state.runId,
      ordinal: 2,
      family: "B",
      variant: 1,
      affinityExpected: true,
      httpStatus: 200,
      failureCode: null,
      sessionAffinityApplied: true,
      affinityPolicy: "cloudflare_thought_route_affinity_v1",
      inputTokens: 7000,
      cachedInputTokens: 0,
      completionTokens: 5,
      reasoningTokens: null,
      neuronUsage: 100,
      elapsedMs: 1000,
      finishReason: "length",
      providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      providerRequestIdPresent: true,
      messagesDigest: sha8(JSON.stringify(buildMessages("B", 1, state.promptNonce))),
    };
    expect(formatQualRow(row)).not.toContain(rawId);
    expect(buildQualSummary(state.runId, 8, 8)).not.toContain(rawId);
  });
});

describe.skipIf(!LIVE)("thought affinity live qualification (bounded, 8 calls)", () => {
  it("runs the A/B prefix-cache quartet against the exact Thought route", async () => {
    if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
      throw new Error("live qualification requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the operator shell");
    }
    // The env module snapshot was taken at import; re-read operator exports.
    refreshEnvFromProcess();
    if (!env.cloudflareApiToken || !env.cloudflareAccountId) {
      throw new Error("live qualification credentials did not reach the env snapshot; export them before launching vitest");
    }

    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const namespace = buildOperationalEffectNamespaceFromRefs(["effect:cycle-specific"]);
    // Two independent per-invocation identities: the prompt-namespace nonce
    // (model-visible prefix namespacing only) and the transport affinity id
    // (header value only, opaque to the model). Never derived from each other.
    const runState = newQualRunState();
    const promptNonce = runState.promptNonce;
    const runAffinityId = runState.runAffinityId;
    const runId = runState.runId;
    const rows: QualRow[] = [];
    let providerCalls = 0;

    const plan: Array<{ family: "A" | "B"; variant: 1 | 2 | 3 | 4; affinity: boolean }> = [
      { family: "A", variant: 1, affinity: false },
      { family: "B", variant: 1, affinity: true },
      { family: "A", variant: 2, affinity: false },
      { family: "B", variant: 2, affinity: true },
      { family: "A", variant: 3, affinity: false },
      { family: "B", variant: 3, affinity: true },
      { family: "A", variant: 4, affinity: false },
      { family: "B", variant: 4, affinity: true },
    ];

    try {
      for (const [index, step] of plan.entries()) {
        if (step.affinity) process.env[AFFINITY_ENV_VAR] = runAffinityId;
        else delete process.env[AFFINITY_ENV_VAR];
        refreshEnvFromProcess();

        const messages = buildMessages(step.family, step.variant, promptNonce);
        const messagesDigest = sha8(JSON.stringify(messages));
        const row: QualRow = {
          runId,
          ordinal: index + 1,
          family: step.family,
          variant: step.variant,
          affinityExpected: step.affinity,
          httpStatus: null,
          failureCode: null,
          sessionAffinityApplied: null,
          affinityPolicy: null,
          inputTokens: null,
          cachedInputTokens: null,
          completionTokens: null,
          reasoningTokens: null,
          neuronUsage: null,
          elapsedMs: null,
          finishReason: null,
          providerModel: null,
          providerRequestIdPresent: false,
          messagesDigest,
        };
        try {
          const result = await withOfflineAppGateDisabled(() => completeChat(messages, {
            attentionDb: db,
            purpose: "thought",
            logicalRole: "thought",
            route: "thought",
            responseFormat: "json_schema",
            structuredOutput: thoughtOutputStructuredRequest(namespace),
            temperature: 1.0,
            maxTokens: 64,
            deadlineAtMs: Date.now() + 180_000,
          }));
          providerCalls += 1;
          const terminalAttempt = result.modelFabric?.receipt?.receiptStage === "resolved"
            ? result.modelFabric.receipt.attempts.at(-1)
            : null;
          row.httpStatus = terminalAttempt?.receiptStage === "provider_response"
            ? (terminalAttempt.providerHttpStatus ?? null)
            : null;
          row.sessionAffinityApplied = result.providerBoundaryTransport?.sessionAffinityApplied ?? null;
          row.affinityPolicy = result.providerBoundaryTransport?.affinityPolicy ?? null;
          row.inputTokens = result.usage?.promptTokens ?? null;
          row.cachedInputTokens = result.usage?.cachedTokens ?? null;
          row.completionTokens = result.usage?.completionTokens ?? null;
          row.reasoningTokens = result.usage?.reasoningTokens ?? null;
          row.neuronUsage = result.usage?.neuronUsage ?? null;
          row.elapsedMs = result.providerBoundaryTiming?.elapsedMs ?? null;
          row.finishReason = result.finishReason ?? null;
          row.providerModel = result.providerModel ?? null;
          row.providerRequestIdPresent = result.providerRequestId != null;
        } catch (error) {
          providerCalls += 1;
          const code = (error as { code?: unknown })?.code;
          row.failureCode = typeof code === "string" ? code : "unknown_error";
          row.httpStatus = providerHttpStatusFromBoundary(error) ?? null;
          const transport = providerBoundaryTransportFromError(error);
          row.sessionAffinityApplied = transport?.sessionAffinityApplied ?? null;
          row.affinityPolicy = transport?.affinityPolicy ?? null;
        }
        rows.push(row);
        // eslint-disable-next-line no-console
        console.log(`QUAL_ROW ${formatQualRow(row)}`);

        // Early stop: wrong credentials invalidate every further call.
        if (row.failureCode === "credential_invalid" || row.httpStatus === 401 || row.httpStatus === 403) {
          // eslint-disable-next-line no-console
          console.log(`QUAL_STOP auth failure at ordinal ${row.ordinal}; credentials must be fixed before any rerun`);
          break;
        }
        // Early stop: treatment applied-flag mismatch invalidates the B cohort.
        if (step.affinity && row.sessionAffinityApplied !== true) {
          // eslint-disable-next-line no-console
          console.log(`QUAL_STOP treatment ordinal ${row.ordinal} did not apply affinity; gate/binding assumption is wrong, stopping to preserve budget`);
          break;
        }
        if (!step.affinity && row.sessionAffinityApplied !== false && row.sessionAffinityApplied !== null) {
          // eslint-disable-next-line no-console
          console.log(`QUAL_STOP control ordinal ${row.ordinal} unexpectedly applied affinity; stopping to preserve budget`);
          break;
        }
      }
    } finally {
      db.close();
    }

    // eslint-disable-next-line no-console
    console.log(`QUAL_SUMMARY ${buildQualSummary(runId, providerCalls, rows.length)}`);
    // The harness log above is the evidence; assertions only guard mechanics.
    expect(providerCalls).toBeLessThanOrEqual(8);
    expect(rows.length).toBeGreaterThan(0);
  }, 1_800_000);
});
