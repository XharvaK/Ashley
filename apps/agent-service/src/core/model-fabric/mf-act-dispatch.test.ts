import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { env } from "../../env.js";
import { AppError } from "../../errors.js";
import { openNuclearDb } from "../db.js";
import { completeChat, resetAdapterCache } from "../../mistral-client.js";
import { withOfflineAppGateDisabled } from "../qualification/offline-test-helpers.js";
import * as groqAdapterModule from "../model-routing/adapters/groq-adapter.js";
import * as nimAdapterModule from "../model-routing/adapters/nim-adapter.js";
import * as mistralAdapterModule from "../model-routing/adapters/mistral-adapter.js";
import * as cloudflareAdapterModule from "../model-routing/adapters/cloudflare-adapter.js";
import { metadataFromError } from "./receipts.js";
import { attachProviderHttpStatusBoundary } from "../model-routing/types.js";
import { currentPortfolio } from "./portfolio.js";
import {
  createCouplingPreflight,
  resolveDispatchPolicy,
  writeActivePointerAtomic,
  writeImmutableArtifact,
  writeOwnerActivation,
  writeOwnerArtifact,
  type ActivationRef,
  type ActivePointer,
  type OwnerApprovalRef,
  type StewardshipConsultationRecord,
} from "./activation.js";
import { loadTargetPortfolio } from "./catalog.js";
import { capabilityProfileFor } from "./profiles.js";
import { buildThoughtCapabilityIdentity, thoughtResourcePolicyIdentity } from "./capability-identity.js";
import { THOUGHT_KERNEL_ENVELOPE_VERSION } from "../cognitive-v021/thought/kernel-envelope.js";
import { THOUGHT_SEMANTIC_PARSER_ID } from "../cognitive-v021/thought/parse.js";
import { THOUGHT_OUTPUT_SCHEMA_FINGERPRINT } from "../cognitive-v021/thought/output-contract.js";
import { sha256Text } from "./hash.js";

const targetPortfolio = loadTargetPortfolio();
const targetRow = targetPortfolio.rows.find(
  (row) => row.policyRowId === "mfr_thought_interactive_target_v1",
)!;
const targetOccupant = targetRow.occupants[0]!;
const profile = capabilityProfileFor(
  targetOccupant.provider,
  targetOccupant.configuredModelId,
);
const inferenceFingerprint = `sha256:${"a".repeat(64)}`;
const fixtureCapability = buildThoughtCapabilityIdentity({
  executableBuildIdentity: "build:fixture",
  semanticContractFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
  kernelEnvelopeContractVersion: THOUGHT_KERNEL_ENVELOPE_VERSION,
  parserValidatorFingerprint: `sha256:${sha256Text(THOUGHT_SEMANTIC_PARSER_ID)}`,
  provider: targetOccupant.provider,
  configuredModelId: targetOccupant.configuredModelId,
  occupantId: targetOccupant.occupantId,
  logicalBindingId: "ashley.thought.semantic.v1",
  wireBindingId: "wire:fixture",
  schemaEnforcementMode: "json_object_compatibility",
  resourcePolicyFingerprint: thoughtResourcePolicyIdentity().fingerprint,
  adapterCompatibilityFingerprint: `sha256:${"d".repeat(64)}`,
});
const roots: string[] = [];
const saved = {
  mistral: env.mistralApiKey,
  mistralSecondary: env.mistralApiKeySecondary,
  groq: env.groqApiKey,
  nim: env.nimApiKey,
  cloudflareToken: env.cloudflareApiToken,
  cloudflareAccount: env.cloudflareAccountId,
};

afterEach(() => {
  env.mistralApiKey = saved.mistral;
  env.mistralApiKeySecondary = saved.mistralSecondary;
  env.groqApiKey = saved.groq;
  env.nimApiKey = saved.nim;
  env.cloudflareApiToken = saved.cloudflareToken;
  env.cloudflareAccountId = saved.cloudflareAccount;
  resetAdapterCache();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function controlRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ashley-mf-act-dispatch-"));
  roots.push(root);
  return root;
}

function db(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function qualification(overrides: Record<string, unknown> = {}) {
  return {
    schema: "ashley.evaluation.qualification_result.v2" as const,
    qualificationResultId: "qres_target_thought_interactive_fixture",
    status: "PASS" as const,
    policyRowId: targetRow.policyRowId,
    occupantId: targetOccupant.occupantId,
    subject: {
      logicalRole: targetRow.logicalRole,
      seat: targetRow.seat,
      materialInferenceFingerprint: inferenceFingerprint,
    },
    profileBinding: {
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      profileFingerprint: profile.profileFingerprint,
      provider: profile.provider,
      configuredModelId: profile.configuredModelId,
    },
    identityContinuityEpoch: null,
    recommendation: "owner_review",
    limitations: [],
    invalidated: false,
    invalidatedBy: null,
    capability: fixtureCapability,
    logicalEvidence: {
      contractId: fixtureCapability.components.logicalBindingId,
      schemaFingerprint: THOUGHT_OUTPUT_SCHEMA_FINGERPRINT,
      bindingId: fixtureCapability.components.logicalBindingId,
    },
    wireEvidence: {
      adapterId: "ashley.adapter.groq.v1",
      wireFormat: "json_object",
      sanitizedBodyDigest: `sha256:${"f".repeat(64)}`,
      emittedEnforcementMode: fixtureCapability.components.schemaEnforcementMode,
      providerDeclaredEnforcement: "unavailable",
      bindingId: fixtureCapability.components.wireBindingId,
    },
    resourceEvidence: {
      deadlineMs: 180_000,
      maxOutputTokens: 8_192,
      attempts: 1,
    },
    ...overrides,
  };
}

function consultation(): StewardshipConsultationRecord {
  return {
    schema: "ashley.stewardship.consultation.v1",
    consultationId: "scc_target_family_fixture",
    clause: "SC-CON-04",
    matterClass: "model_family_activation",
    subject: "fixture thought activation",
    doesNotActivate: true,
    ashleyPositionStatus: "recorded",
    ashleyPosition: "affirm",
    ashleyRationale: "fixture only",
    ashleyDecidedAt: "2026-08-25T00:00:00.000Z",
    docDecision: "approve",
    docRationale: "fixture only",
    docDecidedAt: "2026-08-25T00:00:00.000Z",
  };
}

function approval(
  overrides: Partial<OwnerApprovalRef> = {},
): OwnerApprovalRef {
  return {
    schema: "ashley.model_fabric.owner_approval_ref.v1",
    ownerApprovalRefId: "oap_target_thought_interactive_fixture",
    decision: "approve",
    qualificationResultId: "qres_target_thought_interactive_fixture",
    logicalRole: targetRow.logicalRole,
    seat: targetRow.seat,
    policyRowId: targetRow.policyRowId,
    occupantId: targetOccupant.occupantId,
    portfolioRevisionId: targetPortfolio.portfolioRevisionId,
    consultationId: consultation().consultationId,
    createdBy: "owner",
    createdAt: "2026-08-25T00:00:00.000Z",
    revokesOwnerApprovalRefId: null,
    artifactKind: "fixture",
    ...overrides,
  };
}

function preflight() {
  return createCouplingPreflight({
    couplingPreflightId: "cpf_target_thought_fixture",
    policyRow: targetRow,
    activeRows: currentPortfolio().rows,
    ownerAcknowledged: false,
  });
}

function activation(
  overrides: Partial<ActivationRef> = {},
): ActivationRef {
  return {
    schema: "ashley.model_fabric.activation_ref.v1",
    activationRefId: "act_target_thought_interactive_fixture",
    kind: "activate",
    policyRowId: targetRow.policyRowId,
    portfolioRevisionId: targetPortfolio.portfolioRevisionId,
    ownerApprovalRefIds: [approval().ownerApprovalRefId],
    occupantsActivated: [targetOccupant.occupantId],
    couplingPreflightId: "cpf_target_thought_fixture",
    rollbackOfActivationRefId: null,
    createdBy: "owner",
    createdAt: "2026-08-25T00:00:00.000Z",
    revokesActivationRefId: null,
    artifactKind: "fixture",
    ...overrides,
  };
}

function pointer(activationRefId = activation().activationRefId): ActivePointer {
  return {
    schema: "ashley.model_fabric.active_pointer.v1",
    pointerGeneration: 1,
    replacedPointerGeneration: 0,
    rows: { thought: { interactive: activationRefId } },
    artifactKind: "fixture",
  };
}

function writeValidActivation(root: string): void {
  writeImmutableArtifact({
    controlDir: root,
    directory: "qualifications",
    id: qualification().qualificationResultId,
    artifact: qualification(),
    controlRootMode: "fixture",
  });
  writeImmutableArtifact({
    controlDir: root,
    directory: "consultations",
    id: consultation().consultationId,
    artifact: consultation(),
    controlRootMode: "fixture",
  });
  writeImmutableArtifact({
    controlDir: root,
    directory: "preflights",
    id: "cpf_target_thought_fixture",
    artifact: preflight(),
    controlRootMode: "fixture",
  });
  writeOwnerArtifact({
    controlDir: root,
    artifact: approval(),
    authorization: { ownerAuthenticated: true, controlRootMode: "fixture" },
  });
  writeOwnerActivation({
    controlDir: root,
    activation: activation(),
    pointer: pointer(),
    targetPortfolio,
    qualifications: [qualification()],
    approvals: [approval()],
    consultations: [consultation()],
    preflights: [preflight()],
    authorization: { ownerAuthenticated: true, controlRootMode: "fixture" },
  });
}

describe("MF-ACT dispatch authority", () => {
  it("A: no active pointer resolves CURRENT thought interactive", () => {
    const root = controlRoot();
    const resolved = resolveDispatchPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
      controlDir: root,
      controlRootMode: "fixture",
    });
    expect(resolved.source).toBe("current_compatibility");
    expect(resolved.policyRow.policyRowId).toBe(
      "mfr_thought_interactive_compat_v1",
    );
    expect(resolved.occupant.configuredModelId).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
    expect(resolved.occupant.provider).toBe("cloudflare");
    expect(resolved.occupant.effectiveReasoning).toBe("high");
    expect(resolved.activationRefId).toBeNull();
  });

  it("B: valid fixture activation selects the activated thought occupant", () => {
    const root = controlRoot();
    writeValidActivation(root);
    const resolved = resolveDispatchPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
      controlDir: root,
      controlRootMode: "fixture",
    });
    expect(resolved.source).toBe("activated");
    expect(resolved.policyRow.policyRowId).toBe(targetRow.policyRowId);
    expect(resolved.occupant.configuredModelId).toBe("openai/gpt-oss-120b");
    expect(resolved.occupant.provider).toBe("groq");
    expect(resolved.occupant.effectiveReasoning).toBe("high");
    expect(resolved.activationRefId).toBe(activation().activationRefId);
  });

  it("C: thought activation leaves expression on CURRENT", () => {
    const root = controlRoot();
    writeValidActivation(root);
    const expression = resolveDispatchPolicy({
      logicalRole: "expression",
      purpose: "expression",
      controlDir: root,
      controlRootMode: "fixture",
    });
    expect(expression.source).toBe("current_compatibility");
    expect(expression.policyRow.policyRowId).toBe("mfr_expression_compat_v1");
    expect(expression.occupant.configuredModelId).toBe(
      "nvidia/nemotron-3.5-lightning-30b-a3b",
    );
  });

  it("D: stale pointer falls back to CURRENT compatibility", () => {
    const root = controlRoot();
    writeActivePointerAtomic({
      controlDir: root,
      pointer: pointer("act_missing_fixture"),
      authorization: { ownerAuthenticated: true, controlRootMode: "fixture" },
    });
    const resolved = resolveDispatchPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
      controlDir: root,
      controlRootMode: "fixture",
    });
    expect(resolved.source).toBe("current_compatibility");
    expect(resolved.policyRow.policyRowId).toBe(
      "mfr_thought_interactive_compat_v1",
    );
  });

  it("H: production control mode cannot select fixture TARGET activation", () => {
    const root = controlRoot();
    writeValidActivation(root);
    const resolved = resolveDispatchPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
      controlDir: root,
      controlRootMode: "production",
    });
    expect(resolved.source).toBe("current_compatibility");
    expect(resolved.occupant.configuredModelId).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
  });

  it("E/F: caller model and reasoning pins lose to an activated occupant", async () => {
    const root = controlRoot();
    writeValidActivation(root);
    env.groqApiKey = "test";
    env.nimApiKey = "test";
    const groqDispatch = vi.fn(async (args: { modelId: string; options: { reasoningEffort?: string } }) => {
      expect(args.modelId).toBe("openai/gpt-oss-120b");
      expect(args.options.reasoningEffort).toBe("high");
      return {
        text: "{\"kind\":\"speak\"}",
        providerModel: "openai/gpt-oss-120b",
        usage: { promptTokens: 1, completionTokens: 1 },
        finishReason: "stop",
      };
    });
    const nimDispatch = vi.fn();
    vi.spyOn(groqAdapterModule, "createGroqAdapter").mockReturnValue({
      provider: "groq",
      dispatch: groqDispatch,
    });
    vi.spyOn(nimAdapterModule, "createNimAdapter").mockReturnValue({
      provider: "nim",
      dispatch: nimDispatch,
    });
    const database = db();
    const result = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: database,
      purpose: "thought",
      logicalRole: "thought",
      lane: "interactive",
      route: "thought",
      model: "mistral-medium-latest",
      reasoningEffort: "low",
      responseFormat: "json_object",
      modelFabricControlDir: root,
      modelFabricControlRootMode: "fixture",
    }));
    expect(groqDispatch).toHaveBeenCalledTimes(1);
    expect(nimDispatch).not.toHaveBeenCalled();
    expect(result.modelAlias).toBe("openai/gpt-oss-120b");
    expect(result.modelFabric?.resolvedRoute).toMatchObject({
      policyRowId: targetRow.policyRowId,
      occupantId: targetOccupant.occupantId,
      provider: "groq",
      configuredModelId: "openai/gpt-oss-120b",
      effectiveReasoning: "high",
    });
    database.close();
  });

  it("G: no activation keeps CURRENT Cloudflare Thought and Expression fallback pins", async () => {
    const root = controlRoot();
    env.cloudflareApiToken = "test-cloudflare-token";
    env.cloudflareAccountId = "test-account";
    env.nimApiKey = "test";
    const cloudflareDispatch = vi.fn(async (args: {
      modelId: string;
      fabricReasoning?: unknown;
    }) => {
      if (args.modelId === "@cf/deepseek-ai/deepseek-v4-flash-0731") {
        expect(args.fabricReasoning).toEqual({
          kind: "reasoning_effort",
          value: "high",
        });
        return {
          text: "{\"kind\":\"speak\"}",
          providerModel: "@cf/deepseek-ai/deepseek-v4-flash-0731",
          usage: { promptTokens: 1, completionTokens: 1 },
          finishReason: "stop",
        };
      }
      throw new Error(`unexpected Cloudflare model ${args.modelId}`);
    });
    const nimDispatch = vi.fn(async (args: { modelId: string }) => {
      expect(args.modelId).toBe("nvidia/nemotron-3.5-lightning-30b-a3b");
      return {
        text: "hi",
        providerModel: "nvidia/nemotron-3.5-lightning-30b-a3b",
        usage: { promptTokens: 1, completionTokens: 1 },
        finishReason: "stop",
      };
    });
    vi.spyOn(cloudflareAdapterModule, "createCloudflareAdapter").mockReturnValue({
      provider: "cloudflare",
      dispatch: cloudflareDispatch,
    });
    vi.spyOn(nimAdapterModule, "createNimAdapter").mockReturnValue({
      provider: "nim",
      dispatch: nimDispatch,
    });
    const thoughtDb = db();
    const thought = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
      attentionDb: thoughtDb,
      purpose: "thought",
      logicalRole: "thought",
      lane: "interactive",
      route: "thought",
      modelFabricControlDir: root,
      modelFabricControlRootMode: "fixture",
    }));
    expect(thought.modelAlias).toBe("@cf/deepseek-ai/deepseek-v4-flash-0731");
    expect(thought.modelFabric?.resolvedRoute).toMatchObject({
      policyRowId: "mfr_thought_interactive_compat_v1",
      occupantId: "mfo_cloudflare_deepseek_v4_flash_high",
      provider: "cloudflare",
      effectiveReasoning: "reasoning_effort=high",
    });
    thoughtDb.close();
    const expressionDb = db();
    const expression = await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "hi" }], {
      attentionDb: expressionDb,
      purpose: "expression",
      logicalRole: "expression",
      route: "ashley_expression",
      modelFabricControlDir: root,
      modelFabricControlRootMode: "fixture",
    }));
    expect(expression.modelAlias).toBe(
      "nvidia/nemotron-3.5-lightning-30b-a3b",
    );
    expect(expression.modelFabric?.resolvedRoute).toMatchObject({
      policyRowId: "mfr_expression_compat_v1",
      occupantId: "mfo_nim_nemotron_3_5_lightning",
      provider: "nim",
    });
    expressionDb.close();
  });

  it("does not treat a stray active.json.tmp as an activation", () => {
    const root = controlRoot();
    writeFileSync(
      join(root, "active.json.tmp"),
      JSON.stringify(pointer()),
    );
    const resolved = resolveDispatchPolicy({
      logicalRole: "thought",
      purpose: "thought",
      lane: "interactive",
      controlDir: root,
      controlRootMode: "fixture",
    });
    expect(resolved.source).toBe("current_compatibility");
  });

  it("dispatches identical ChatMessage[] and resolves the same Mistral contract on credential failover", async () => {
    const root = controlRoot();
    env.mistralApiKey = "test-primary";
    env.mistralApiKeySecondary = "test-secondary";
    const thoughtDb = db();

    let primaryMessages: unknown = null;
    let secondaryMessages: unknown = null;
    let primaryContract: unknown = null;
    let secondaryContract: unknown = null;

    const mistralDispatch = vi.fn(async (args: {
      messages: unknown[];
      credentialSeat?: string;
      fabricStructuredOutput?: unknown;
      fabricReasoning?: unknown;
    }) => {
      primaryMessages = args.messages;
      primaryContract = {
        structured: args.fabricStructuredOutput,
        reasoning: args.fabricReasoning,
      };
      if (args.credentialSeat === "mistral_primary") {
        const error = new AppError(
          "rate_limited",
          "Mistral account rate limited",
          429,
          undefined,
          "account",
        );
        attachProviderHttpStatusBoundary(error, 429);
        throw error;
      }
      secondaryMessages = args.messages;
      secondaryContract = {
        structured: args.fabricStructuredOutput,
        reasoning: args.fabricReasoning,
      };
      return {
        text: '{"draft":"ok"}',
        providerModel: "mistral-small-2603",
        usage: { promptTokens: 100, completionTokens: 50 },
        finishReason: "stop",
      };
    });

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch: mistralDispatch,
    });

    const testMessages = [
      { role: "system" as const, content: "You are Thought layer." },
      { role: "user" as const, content: '{"cycleId":"cycle-1","generation":1}' },
    ];

    const result = await withOfflineAppGateDisabled(() => completeChat(testMessages, {
      attentionDb: thoughtDb,
      purpose: "thought_observation",
      logicalRole: "thought_observation",
      lane: "interactive",
      route: "thought",
      model: "mistral-small-2603",
      maxTokens: 400,
      modelFabricControlDir: root,
      modelFabricControlRootMode: "fixture",
    }));

    expect(mistralDispatch).toHaveBeenCalledTimes(2);
    expect(primaryMessages).toEqual(secondaryMessages);
    expect(primaryContract).toEqual(secondaryContract);
    expect(result.text).toBe('{"draft":"ok"}');
    const receipt = result.modelFabric?.receipt;
    expect(receipt && receipt.receiptStage === "resolved" ? receipt.fallbackClass : null).toBe("credential_failover");

    thoughtDb.close();
  });

  it("suppresses credential failover when no secondary Mistral credential is configured", async () => {
    const root = controlRoot();
    env.mistralApiKey = "test-primary";
    env.mistralApiKeySecondary = "";
    const thoughtDb = db();

    const mistralDispatch = vi.fn(async () => {
      const error = new AppError(
        "credential_invalid",
        "Mistral credential rejected",
        401,
        undefined,
        "account",
      );
      attachProviderHttpStatusBoundary(error, 401);
      throw error;
    });

    vi.spyOn(mistralAdapterModule, "createMistralAdapter").mockReturnValue({
      provider: "mistral",
      dispatch: mistralDispatch,
    });

    let caughtError: unknown = null;
    try {
      await withOfflineAppGateDisabled(() => completeChat([{ role: "user", content: "think" }], {
        attentionDb: thoughtDb,
        purpose: "thought_observation",
        logicalRole: "thought_observation",
        lane: "interactive",
        route: "thought",
        model: "mistral-small-2603",
        maxTokens: 400,
        modelFabricControlDir: root,
        modelFabricControlRootMode: "fixture",
      }));
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain("Mistral credential rejected");
    expect(mistralDispatch).toHaveBeenCalledTimes(1);

    const mfMeta = metadataFromError(caughtError);
    expect(mfMeta).not.toBeNull();
    expect(mfMeta?.failoverSuppressed).toBe("mistral_secondary_credential_unavailable");
    expect(mfMeta?.suppressedProvider).toBe("mistral");
    expect(mfMeta?.suppressedBucket).toBe("mistral:mistral-small-2603");
    expect(mfMeta?.receipt.receiptStage).toBe("resolved");
    if (mfMeta?.receipt.receiptStage === "resolved") {
      expect(mfMeta.receipt.attempts.length).toBe(1);
      expect(mfMeta.receipt.attempts[0].provider).toBe("mistral");
      expect(mfMeta.receipt.attempts[0].dispatchTruth).toBe("response_received");
    }

    thoughtDb.close();
  });
});
