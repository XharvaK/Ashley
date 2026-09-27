import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { openNuclearDb } from "../db.js";
import { completeChat, resetAdapterCache } from "../../mistral-client.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import { resolveCurrentPolicy } from "../model-fabric/portfolio.js";
import { COMMAND_CODE_POLICY } from "../command-code/policy.js";
import { thoughtOutputStructuredRequest } from "../cognitive-v021/thought/output-contract.js";
import {
  reflectionInitiativeOutputStructuredRequest,
  REFLECTION_INITIATIVE_SCHEMA_FINGERPRINT,
} from "../cognitive-v021/thought/reflection-output-contract.js";
import {
  REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID,
  REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID,
  THOUGHT_OUTPUT_CONTRACT_ID,
  THOUGHT_OUTPUT_SCHEMA_ID,
} from "../cognitive-v021/thought/contract-identity.js";
import { parseReflectionReviewResponse } from "./initiative.js";
import * as commandCodeAdapterModule from "../model-routing/adapters/command-code-adapter.js";
import { commandCodeRequestWireAdditionalBytes } from "../model-routing/adapters/command-code-adapter.js";
import * as cloudflareAdapterModule from "../model-routing/adapters/cloudflare-adapter.js";

const originalCommandCodeKey = env.commandCodeApiKey;

afterEach(() => {
  env.commandCodeApiKey = originalCommandCodeKey;
  resetAdapterCache();
  vi.restoreAllMocks();
});

function hashOf(text: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function stubCommandCode(responseText: string) {
  const dispatch = vi.fn(async (args: { modelId: string; options?: Record<string, unknown> }) => ({
    text: responseText,
    providerModel: args.modelId,
    providerRequestId: "reflection-contract-1",
    providerHttpStatus: 200,
    providerRequestHash: "sha256:request",
    providerResponseHash: hashOf(responseText),
    usage: { promptTokens: 1, completionTokens: 1 },
    finishReason: "stop",
  }));
  vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
    provider: "command_code",
    dispatch,
  } as never);
  return dispatch;
}

const REFLECTION_DISPATCH = {
  route: "thought" as const,
  purpose: "thought_observation" as const,
  logicalRole: "reflection_initiative" as const,
  lane: "exchange_cognition" as const,
  responseFormat: "json_schema" as const,
  maxTokens: 300,
  temperature: 0,
  ownerId: "doc",
};

describe("reflection/initiative Command Code contract seam", () => {
  it("CURRENT v6 reflection_initiative resolves to the Command Code Muse xhigh occupant", () => {
    const resolved = resolveCurrentPolicy({
      logicalRole: "reflection_initiative",
      purpose: "thought_observation",
      lane: "exchange_cognition",
    });
    expect(resolved.dispatchedRouteId).toBe("thought");
    expect(resolved.occupant).toMatchObject({
      provider: "command_code",
      configuredModelId: COMMAND_CODE_POLICY.modelId,
      effectiveReasoning: COMMAND_CODE_POLICY.effort,
    });
  });

  it("keeps the reflection contract distinct from the Thought contract", () => {
    const reflection = reflectionInitiativeOutputStructuredRequest();
    const thought = thoughtOutputStructuredRequest();
    expect(reflection.contractId).toBe(REFLECTION_INITIATIVE_OUTPUT_CONTRACT_ID);
    expect(reflection.schemaId).toBe(REFLECTION_INITIATIVE_OUTPUT_SCHEMA_ID);
    expect(reflection.schemaFingerprint).toBe(REFLECTION_INITIATIVE_SCHEMA_FINGERPRINT);
    expect(reflection.contractId).not.toBe(THOUGHT_OUTPUT_CONTRACT_ID);
    expect(reflection.schemaId).not.toBe(THOUGHT_OUTPUT_SCHEMA_ID);
    expect(reflection.schemaFingerprint).not.toBe(thought.schemaFingerprint);
  });

  it("dispatches reflection adjudication through Command Code with its own contract", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = stubCommandCode('{"action":"keep_open"}');
    const createCloudflare = vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter");
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const completion = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "adjudicate" }],
        { attentionDb: db, ...REFLECTION_DISPATCH, structuredOutput: reflectionInitiativeOutputStructuredRequest() } as never,
      ));
      expect(dispatch).toHaveBeenCalledTimes(1);
      // The generic dispatch path deliberately clears options.reasoningEffort
      // and routes the Model Fabric control through args.fabricReasoning.
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        modelId: COMMAND_CODE_POLICY.modelId,
        fabricReasoning: {
          kind: "command_code_reasoning_effort",
          value: COMMAND_CODE_POLICY.effort,
        },
      });
      expect(completion.modelAlias).toBe(COMMAND_CODE_POLICY.modelId);
      expect(createCloudflare).not.toHaveBeenCalled();
      const row = db.prepare(
        "SELECT provider_id, model_alias, quota_bucket, outcome FROM attention_requests ORDER BY id DESC LIMIT 1",
      ).get() as Record<string, unknown>;
      expect(row).toMatchObject({
        provider_id: "command_code",
        model_alias: COMMAND_CODE_POLICY.modelId,
        quota_bucket: `command_code:${COMMAND_CODE_POLICY.modelId}`,
        outcome: "completed",
      });
      expect(row.quota_bucket).not.toContain("cloudflare");
    } finally {
      db.close();
    }
  });

  it("refuses to let the Thought contract stand in for the reflection contract", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = stubCommandCode('{"action":"keep_open"}');
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      await expect(withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "adjudicate" }],
        { attentionDb: db, ...REFLECTION_DISPATCH, structuredOutput: thoughtOutputStructuredRequest() } as never,
      ))).rejects.toMatchObject({
        code: "model_fabric_structured_output_mismatch",
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("refuses a reflection dispatch with no contract at all", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = stubCommandCode('{"action":"keep_open"}');
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      await expect(withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "adjudicate" }],
        { attentionDb: db, ...REFLECTION_DISPATCH } as never,
      ))).rejects.toMatchObject({
        code: "model_fabric_structured_output_missing",
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("refuses a contract whose schema id does not match its contract id", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = stubCommandCode('{"action":"keep_open"}');
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      await expect(withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "adjudicate" }],
        {
          attentionDb: db,
          ...REFLECTION_DISPATCH,
          structuredOutput: {
            ...reflectionInitiativeOutputStructuredRequest(),
            schemaId: THOUGHT_OUTPUT_SCHEMA_ID,
          },
        } as never,
      ))).rejects.toMatchObject({
        code: "model_fabric_structured_output_mismatch",
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("keeps the Model Fabric control authoritative over a caller reasoning effort", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = stubCommandCode('{"action":"keep_open"}');
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "adjudicate" }],
        {
          attentionDb: db,
          ...REFLECTION_DISPATCH,
          structuredOutput: reflectionInitiativeOutputStructuredRequest(),
          reasoningEffort: "low",
        } as never,
      ));
      // A caller cannot downgrade the translated Model Fabric control.
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        fabricReasoning: {
          kind: "command_code_reasoning_effort",
          value: COMMAND_CODE_POLICY.effort,
        },
      });
    } finally {
      db.close();
    }
  });

  it("refuses a Command Code request that carries no valid effort control at all", () => {
    const base = {
      messages: [{ role: "user" as const, content: "adjudicate" }],
      modelId: COMMAND_CODE_POLICY.modelId,
      options: {
        structuredOutput: reflectionInitiativeOutputStructuredRequest(),
        maxTokens: 300,
      },
    };
    expect(() => commandCodeRequestWireAdditionalBytes(base as never)).toThrow(
      /command_code_policy_effort_required/,
    );
    expect(() => commandCodeRequestWireAdditionalBytes({
      ...base,
      fabricReasoning: { kind: "reasoning_effort", value: "high" },
    } as never)).toThrow(/command_code_reasoning_control_mismatch/);
    expect(commandCodeRequestWireAdditionalBytes({
      ...base,
      fabricReasoning: {
        kind: "command_code_reasoning_effort",
        value: COMMAND_CODE_POLICY.effort,
      },
    } as never)).toBeGreaterThan(0);
  });

  it("keeps generic completeChat route=thought fail-closed with no Thought contract", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const dispatch = stubCommandCode("{}");
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      await expect(withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "think" }],
        { attentionDb: db, route: "thought", purpose: "thought", logicalRole: "thought" } as never,
      ))).rejects.toMatchObject({
        code: "capability_mismatch",
        message: "command_code_thought_contract_required",
      });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("fails closed on malformed reflection output rather than inventing a proposal", () => {
    // A provider response is only ever turned into a proposal through the
    // existing strict parser. Anything outside the closed action set, and
    // anything that is not a JSON object, yields no proposal at all.
    expect(parseReflectionReviewResponse('{"action":"keep_open"}')).toMatchObject({
      action: "keep_open",
      reason: "reflection_model_keep_open",
      authorityClass: "NON_AUTHORITATIVE_ADVISORY_OUTPUT",
    });
    for (const bad of [
      "not json at all",
      "{}",
      '{"action":"delete_everything"}',
      '{"action":"keep_open","evidenceRefs":[{"type":"x"}]}',
      '{"action":"keep_open","evidenceRefs":"nope"}',
      "[]",
    ]) {
      const parsed = parseReflectionReviewResponse(bad);
      expect(parsed === null || parsed.action === "keep_open").toBe(true);
    }
    // The closed action set is exactly the five declared transitions. Case and
    // surrounding whitespace are normalized by the parser; nothing else is.
    for (const action of ["keep", "keep_open", "withdraw", "supersede", "resolve"]) {
      expect(parseReflectionReviewResponse(JSON.stringify({ action }))).not.toBeNull();
    }
    expect(parseReflectionReviewResponse('{"action":"  KEEP_OPEN  "}')).not.toBeNull();
    for (const action of ["delete", "escalate", "unknown", ""]) {
      expect(parseReflectionReviewResponse(JSON.stringify({ action }))).toBeNull();
    }
  });

  it("leaves the primary direct Thought seam unchanged", async () => {
    env.commandCodeApiKey = "test-command-code-key";
    const text = "{}";
    const dispatch = vi.fn(async (args: { modelId: string; options?: Record<string, unknown> }) => ({
      text,
      providerModel: args.modelId,
      providerRequestId: "direct-thought-1",
      providerHttpStatus: 200,
      providerRequestHash: "sha256:request",
      providerResponseHash: hashOf(text),
      usage: { promptTokens: 2, completionTokens: 1 },
      finishReason: "stop",
    }));
    vi.spyOn(commandCodeAdapterModule, "createCommandCodeAdapter").mockReturnValue({
      provider: "command_code",
      dispatch,
    } as never);
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const completion = await withOfflineAppGateDisabled(() => completeChat(
        [{ role: "user", content: "think" }],
        {
          attentionDb: db,
          purpose: "thought",
          route: "thought",
          directCommandCodeThought: true,
          structuredOutput: thoughtOutputStructuredRequest(),
          thoughtInvocationContext: {
            invocationId: "direct-thought",
            cycleId: "cycle:direct-thought",
            generation: 1,
            semanticPass: 1,
            structuralAttemptOrdinal: 0,
            authorityEpoch: 1,
            authorityVersionVector: { nuclear: 1 },
            triggerRef: "trigger:direct-thought",
            semanticProjectionHash: "sha256:semantic",
            dispatchMessagesHash: "sha256:messages",
            allowlistFingerprint: "sha256:allowlist",
            absoluteDeadlineAtMs: Date.now() + 30_000,
          },
        } as never,
      ));
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(completion.commandCodeEvidence).toMatchObject({
        backend: "command_code_api",
        providerModel: COMMAND_CODE_POLICY.modelId,
        reasoningEffort: COMMAND_CODE_POLICY.effort,
        providerAttempts: 1,
        alternateProviderAttempts: 0,
      });
    } finally {
      db.close();
    }
  });
});
