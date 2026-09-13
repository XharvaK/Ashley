import { vi } from "vitest";

const cloudflareState = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock("../../model-routing/adapters/cloudflare-adapter.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../model-routing/adapters/cloudflare-adapter.js")
  >();
  return {
    ...actual,
    createCloudflareAdapter: () => ({
      provider: "cloudflare" as const,
      dispatch: cloudflareState.dispatch,
    }),
  };
});

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../../env.js";
import { completeChat, resetAdapterCache } from "../../../mistral-client.js";
import { openNuclearDb } from "../../db.js";
import {
  currentTpmUsage,
  realClock,
  runAttentiveDispatch,
} from "../../attention/index.js";
import { estimateRequestTokens } from "../../attention/estimate.js";
import {
  buildCloudflareRequestBody,
  cloudflareRequestWireAdditionalBytes,
} from "../../model-routing/adapters/cloudflare-adapter.js";
import { resolveCurrentPolicy } from "../../model-fabric/portfolio.js";
import { quotaContractFor } from "../../model-routing/router.js";
import type { ChatMessage } from "../../model-routing/types.js";
import type {
  CapabilityReality,
  IdentitySlice,
  KernelDeps,
  Observation,
  ThoughtInput,
} from "../types.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { buildOperationalEffectNamespace } from "../effect/effect-ref.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { buildThoughtInput } from "./input.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import { thoughtOutputStructuredRequest } from "./output-contract.js";
import {
  runThoughtModel,
  STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS,
} from "./run.js";

const constitution: IdentitySlice = {
  constitutional: ["truth first"],
  stableSelf: ["curious"],
};
const capabilityReality: CapabilityReality = {
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
  approvedProjectIds: [],
};

const CLOUDFLARE_MODEL = "@cf/deepseek-ai/deepseek-v4-flash-0731";
const CLOUDFLARE_BUCKET = `cloudflare:${CLOUDFLARE_MODEL}`;
const SEEDED_CURRENT_TPM_USAGE = 14_000;
const TPM_LIMIT = 65_536;
const EXPECTED_RETRY_OUTPUT = STRUCTURAL_RETRY_MAX_OUTPUT_TOKENS;
const savedCloudflareToken = env.cloudflareApiToken;
const savedCloudflareAccount = env.cloudflareAccountId;

function deps(attentionDb: DatabaseSync): KernelDeps {
  return {
    nowMs: () => Date.now(),
    attentionDb,
    completeChat,
    runPerception: vi.fn(async (): Promise<Observation[]> => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false },
      currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} },
      capability: capabilityReality,
      operational: { sandboxAvailable: false },
      relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution,
    capabilityReality,
  };
}

function helloInput(): { sidecar: DatabaseSync; input: ThoughtInput } {
  const sidecar = openTestSidecar();
  const cycle = admitTestCycle(sidecar, {
    cycleId: "cycle-retry-admission",
    conversationId: "thread-retry-admission",
    triggerKind: "owner_message",
    triggerRef: "owner-retry-admission",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 1,
  });
  const evidence = appendOwnerUtterance(sidecar, {
    conversationId: cycle.conversationId,
    text: "hello",
    discordMessageIds: ["retry-admission-message"],
    nowMs: 2,
  });
  appendInboxEvent(sidecar, {
    conversationId: cycle.conversationId,
    kind: "owner_message",
    payload: { cycleId: cycle.cycleId, evidenceRowId: evidence.rowId, ownerMessage: "hello" },
    createdAtMs: 2,
  });
  const input = buildThoughtInput({
    sidecar,
    cycle,
    triggerText: "hello",
    triggerEvidence: evidence,
    constitution,
    capabilityReality,
  });
  // Keep the semantic request hello-style while exercising the conservative
  // estimator near the live failure's high-context admission boundary.
  input.rawConversation = input.rawConversation.map((row) => ({
    ...row,
    text: `${row.text} ${"hello ".repeat(600)}`,
  }));
  return { sidecar, input };
}

const savedOfflineEnv = process.env.ASHLEY_PHASE0_OFFLINE;

afterEach(() => {
  cloudflareState.dispatch.mockReset();
  resetAdapterCache();
  env.cloudflareApiToken = savedCloudflareToken;
  env.cloudflareAccountId = savedCloudflareAccount;
  if (savedOfflineEnv === undefined) {
    delete process.env.ASHLEY_PHASE0_OFFLINE;
  } else {
    process.env.ASHLEY_PHASE0_OFFLINE = savedOfflineEnv;
  }
});

describe("v0.2.1 structural Thought retry admission", () => {
  it("keeps the primary at 16_384 and admits a corrective retry at 16_384 under real rolling TPM accounting", async () => {
    delete process.env.ASHLEY_PHASE0_OFFLINE;
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-account";
    resetAdapterCache();
    const { sidecar, input } = helloInput();
    const primaryDb = openNuclearDb(new DatabaseSync(":memory:"));
    const retryDb = openNuclearDb(new DatabaseSync(":memory:"));
    const captured: Array<{
      messages: ChatMessage[];
      options: { maxTokens?: number; responseFormat?: string };
    }> = [];
    let captureAdmission: Record<string, unknown> | null = null;

    cloudflareState.dispatch.mockImplementation(async (args: {
      messages: ChatMessage[];
      options: { maxTokens?: number; responseFormat?: string };
    }) => {
      captured.push({ messages: args.messages, options: args.options });
      if (captureAdmission) {
        captureAdmission = retryDb.prepare(
          `SELECT state, estimated_input_tokens, estimated_output_tokens,
                  reserved_input_tokens, reserved_output_tokens,
                  dispatch_started_at, deadline_at
             FROM attention_requests
            WHERE quota_bucket = ?
            ORDER BY id DESC LIMIT 1`,
        ).get(CLOUDFLARE_BUCKET) as Record<string, unknown>;
      }
      const parsed = JSON.parse(args.messages[1]?.content ?? "{}") as ThoughtInput;
      const response = captured.length === 1
        ? {
            text: "not json",
            providerModel: CLOUDFLARE_MODEL,
            usage: { promptTokens: 4_772, completionTokens: 55 },
          }
        : {
            text: JSON.stringify(makeSemanticSettlement()),
            providerModel: CLOUDFLARE_MODEL,
            usage: { promptTokens: 1, completionTokens: 1 },
          };
      return response;
    });

    const currentPolicy = resolveCurrentPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "urgent_grounded",
      routeId: "thought",
    });
    expect(currentPolicy.policyRow.maxOutputTokens).toBe(16_384);
    expect(quotaContractFor(CLOUDFLARE_BUCKET).tpm).toBe(TPM_LIMIT);

    const primary = await runThoughtModel(input, deps(primaryDb), {
      deadlineAtMs: Date.now() + 60_000,
    });
    expect(primary.malformed).toBe(true);
    const primaryRow = primaryDb.prepare(
      `SELECT estimated_input_tokens, estimated_output_tokens,
              actual_input_tokens, actual_output_tokens
         FROM attention_requests
        WHERE quota_bucket = ?
        ORDER BY id DESC LIMIT 1`,
     ).get(CLOUDFLARE_BUCKET) as Record<string, unknown>;
    const currentPrimaryEstimatedInput = Number(primaryRow.estimated_input_tokens);
    expect(Number(primaryRow.estimated_output_tokens)).toBe(16_384);
    expect(Number(primaryRow.actual_input_tokens)).toBe(4_772);
    expect(Number(primaryRow.actual_output_tokens)).toBe(55);

    await runAttentiveDispatch(retryDb, {
      messages: [{ role: "user", content: "seeded primary" }],
      purpose: "thought",
      lane: "urgent_grounded",
       providerId: "cloudflare",
       quotaBucket: CLOUDFLARE_BUCKET,
       modelAlias: CLOUDFLARE_MODEL,
       maxTokens: 16_384,
      deadlineAtMs: Date.now() + 60_000,
      ownerId: "doc",
      dispatch: async () => ({
         providerModel: CLOUDFLARE_MODEL,
        usage: { promptTokens: 12_000, completionTokens: 2_000 },
        result: { text: "seeded" },
      }),
    });
     expect(currentTpmUsage(retryDb, realClock, CLOUDFLARE_BUCKET)).toBe(SEEDED_CURRENT_TPM_USAGE);

    captureAdmission = {};
    const retry = await runThoughtModel(input, deps(retryDb), {
      deadlineAtMs: Date.now() + 60_000,
      structuralFeedback: "invalid_json",
      maxTokens: EXPECTED_RETRY_OUTPUT,
    } as Parameters<typeof runThoughtModel>[2] & { maxTokens: number });
    expect(retry.output.kind).toBe("settlement");
    expect(captured).toHaveLength(2);
    expect(captured[0]?.options.maxTokens).toBe(16_384);
    expect(captured[1]?.options.maxTokens).toBe(EXPECTED_RETRY_OUTPUT);
    expect(captured[1]?.options.responseFormat).toBe("json_object");
    expect(captured[1]?.messages[1]?.content).toBe(captured[0]?.messages[1]?.content);
    expect(captured[1]?.messages[0]?.content).toContain("invalid_json");
    expect(captured[1]?.messages[0]?.content).toContain("schemaId=ashley.thought.semantic.v2.schema");
    expect(captureAdmission).not.toBeNull();

    const retryInput = Number(captureAdmission?.estimated_input_tokens);
    const retryReservedOutput = Number(captureAdmission?.reserved_output_tokens);
    const retryTotal = retryInput + retryReservedOutput;
    const combinedDemand = SEEDED_CURRENT_TPM_USAGE + retryTotal;
    const headroom = TPM_LIMIT - combinedDemand;
    const operationalNamespace = buildOperationalEffectNamespace(
      input.cycleId,
      input.generation,
      input.inFlight.map((item) => item.effectId),
    );
    const structuredOutput = thoughtOutputStructuredRequest(operationalNamespace);
    const retryBody = buildCloudflareRequestBody(
      captured[1]!.messages,
      { maxTokens: EXPECTED_RETRY_OUTPUT, responseFormat: "json_schema", temperature: 1.0 },
      CLOUDFLARE_MODEL,
      { kind: "reasoning_effort", value: "high" },
      {
        kind: "json_object_compatibility",
        contractId: structuredOutput.contractId,
        schemaId: structuredOutput.schemaId,
        schemaFingerprint: structuredOutput.schemaFingerprint,
        bindingId: "compat_thought_cloudflare_deepseek_v4_flash_json_object_v1",
      },
    );
    const estimatedRetry = estimateRequestTokens(captured[1]!.messages, {
      maxTokens: EXPECTED_RETRY_OUTPUT,
      wireAdditionalBytes: cloudflareRequestWireAdditionalBytes({ body: retryBody }),
    });
    const dispatchStartedAt = Date.parse(String(captureAdmission?.dispatch_started_at));
    const retryDeadline = Date.parse(String(captureAdmission?.deadline_at));
    expect(Number(captureAdmission?.estimated_output_tokens)).toBe(EXPECTED_RETRY_OUTPUT);
    expect(retryInput).toBe(estimatedRetry.estimatedInputTokens);
    expect(retryReservedOutput).toBe(EXPECTED_RETRY_OUTPUT);
    expect(combinedDemand).toBeLessThanOrEqual(TPM_LIMIT);
    expect(captureAdmission?.state).toBe("running");
    expect(dispatchStartedAt).toBeLessThan(retryDeadline);
    expect(retryInput + 16_384 + SEEDED_CURRENT_TPM_USAGE).toBeLessThanOrEqual(TPM_LIMIT);
    expect(retryInput + 50_000 + SEEDED_CURRENT_TPM_USAGE).toBeGreaterThan(TPM_LIMIT);
    expect(headroom).toBeGreaterThanOrEqual(0);
    expect(currentPrimaryEstimatedInput).toBeGreaterThan(0);
    expect(currentPrimaryEstimatedInput + 16_384 + SEEDED_CURRENT_TPM_USAGE).toBeLessThanOrEqual(TPM_LIMIT);

    console.info([
      `CURRENT_HELLO_RETRY_ESTIMATED_INPUT=${retryInput}`,
      `CURRENT_HELLO_RETRY_RESERVED_OUTPUT=${retryReservedOutput}`,
      `CURRENT_HELLO_RETRY_TOTAL=${retryTotal}`,
      `CURRENT_PRIMARY_ESTIMATED_INPUT=${currentPrimaryEstimatedInput}`,
      `SEEDED_CURRENT_TPM_USAGE=${SEEDED_CURRENT_TPM_USAGE}`,
      `COMBINED_TPM_DEMAND=${combinedDemand}`,
      `TPM_LIMIT=${TPM_LIMIT}`,
      `HEADROOM=${headroom}`,
      "RETRY_ADMISSION=PASS",
       `CLOUDFLARE_THOUGHT_TPM=${quotaContractFor(CLOUDFLARE_BUCKET).tpm}`,
       `PRIMARY_16384_TOTAL=${currentPrimaryEstimatedInput + 16_384}`,
       `CLOUDFLARE_SINGLE_REQUEST_ADMISSIBLE=${currentPrimaryEstimatedInput + 16_384 <= quotaContractFor(CLOUDFLARE_BUCKET).tpm ? "yes" : "no"}`,
    ].join("\n"));

    sidecar.close();
    primaryDb.close();
    retryDb.close();
  });
});
