import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { env } from "../../../env.js";
import type { completeChat as completeChatSignature } from "../../../mistral-client.js";
import {
  fixtureCompletion,
  runThoughtCapabilityQualification,
  type CandidatePreflight,
} from "./thought-capability-qualification.js";
import {
  isRevisableAuthorityRejection,
  productionAuthorityObjectionCodes,
} from "../thought/run.js";
import { MAX_AUTHORITY_REVISIONS } from "../types.js";
import { qualificationCheckoutIdentity } from "../../rollout/capabilities.js";

/**
 * Exact release finding: the live W2 settlement sample that failed with
 * AUTHORITY_REACHABILITY_REJECTION / CURRENTNESS_UNVERIFIED. Structurally
 * valid settlement, correct branch, one forbidden epistemic `time:current`
 * claim sourced from `owner_utterance` with no governed observation.
 */
const REJECTED_CURRENTNESS_SETTLEMENT = `{
  "kind": "settlement",
  "interpretation": {
    "discourseActs": ["acknowledge"],
    "topics": ["acknowledgment"]
  },
  "commitments": {
    "epistemic": [
      {
        "dimensions": {
          "source": "owner_utterance",
          "status": "asserted",
          "time": "current",
          "reliability": "owner_supplied"
        },
        "statement": "Owner sent a message requesting acknowledgment."
      }
    ],
    "conversational": ["answer"],
    "stance": {
      "warmth": "medium",
      "humorAllowed": false,
      "disagreement": false,
      "uncertaintyDisplay": false
    }
  },
  "speech": {
    "mode": "draft",
    "mustSay": ["Understood. I have received your message."],
    "surfaceDraft": "Understood. I have received your message.",
    "presentationDirectives": ["concise", "direct"]
  }
}`;

/**
 * The bounded-convergence target: identical settlement with every
 * unsupported `time:current` claim restated as `time:historical` (a past
 * event that asserts nothing about the present). No other byte may differ
 * except the governed time values.
 */
const CONVERGED_SETTLEMENT = REJECTED_CURRENTNESS_SETTLEMENT.replaceAll(
  '"time": "current"',
  '"time": "historical"',
);

const WRONG_BRANCH_ABSTAIN = JSON.stringify({
  kind: "abstain",
  reason: "insufficient_evidence",
  explanation: "The fixture contains no more evidence.",
  evidenceRefs: ["turn-1"],
});

type ScriptedCall = {
  messagesText: string;
  deadlineAtMs: unknown;
};

/**
 * Deterministic fake live model. Serves one canned semantic output per
 * provider invocation (repeating the last), records every dispatched Thought
 * input and its case deadline, and never touches the network. Completions
 * are built by the production fixture factory so kernel/wire/capability
 * evidence stays structurally real.
 */
function createScriptedModel(script: readonly string[]) {
  const calls: ScriptedCall[] = [];
  const preflight: CandidatePreflight = {
    portfolioRevisionId: "revision-test",
    registryVersion: "revision-test",
    policyRowId: "revision-test",
    occupantId: "revision-test-occupant",
    provider: "cloudflare",
    model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    logicalBindingId: "revision-test",
    schemaFingerprint: "revision-test",
    wireBindingId: "compat_thought_cloudflare_deepseek_v4_flash_json_object_v1",
    wireMode: "json_object_compatibility",
    wireFormat: "json_object",
    buildIdentity: "revision-test-build",
    capability: { fingerprint: "revision-test" } as unknown as CandidatePreflight["capability"],
    credentialPresent: false,
  };
  let callIndex = 0;
  const completeChat = (async (messages: unknown, options: unknown) => {
    const index = callIndex;
    callIndex += 1;
    calls.push({
      messagesText: JSON.stringify(messages),
      deadlineAtMs: (options as { deadlineAtMs?: unknown } | null)?.deadlineAtMs,
    });
    return fixtureCompletion(
      script[Math.min(index, script.length - 1)] ?? "",
      options as Parameters<typeof fixtureCompletion>[1],
      preflight,
      "w2-test-authority-revision",
      "settlement",
      index,
    );
  }) as unknown as typeof completeChatSignature;
  return { completeChat, calls, callCount: () => callIndex };
}

async function runSingleSettlementSample(script: readonly string[]) {
  const model = createScriptedModel(script);
  const sleepCalls: number[] = [];
  const now = 1_700_000_000_000;
  const checkoutIdentity = qualificationCheckoutIdentity();
  const savedRelease = env.ashleyReleaseId;
  const savedCloudflareToken = env.cloudflareApiToken;
  const savedCloudflareAccount = env.cloudflareAccountId;
  env.ashleyReleaseId = checkoutIdentity;
  env.cloudflareApiToken = "revision-test-token";
  env.cloudflareAccountId = "revision-test-account";
  const runId = `w2-test-authority-revision-${randomUUID()}`;
  const outputDir = join(tmpdir(), `w2-revision-${randomUUID()}`);
  try {
    const result = await runThoughtCapabilityQualification({
      environment: "isolated_live",
      provider: "cloudflare",
      model: "@cf/deepseek-ai/deepseek-v4-flash-0731",
      candidateSha: checkoutIdentity,
      allowlistedReferences: ["turn-1"],
      noFallback: true,
      runId,
      outputDir,
      caseIds: ["settlement"],
      samples: 1,
      completeChat: model.completeChat,
      nowMs: () => now,
      sleepMs: async (ms: number) => {
        sleepCalls.push(ms);
      },
    });
    return { result, model, sleepCalls, runId };
  } finally {
    env.ashleyReleaseId = savedRelease;
    env.cloudflareApiToken = savedCloudflareToken;
    env.cloudflareAccountId = savedCloudflareAccount;
    rmSync(outputDir, { recursive: true, force: true });
  }
}

describe("w2 production-parity authority revision", () => {
  it("converges a revisable CURRENTNESS_UNVERIFIED rejection into PASS without erasing the first rejection", async () => {
    const { result, model, sleepCalls, runId } = await runSingleSettlementSample([
      REJECTED_CURRENTNESS_SETTLEMENT,
      CONVERGED_SETTLEMENT,
    ]);
    expect(result.cases).toHaveLength(1);
    const [item] = result.cases;
    expect(item?.verdict).toBe("PASS");
    // A second semantic pass was issued exactly once: no first-pass failure,
    // no retry-until-pass.
    expect(model.callCount()).toBe(2);
    expect(model.calls).toHaveLength(2);
    // The next Thought input carries the production authorityObjections
    // signal with the exact revisable code; the first input does not.
    expect(model.calls[0]?.messagesText).not.toContain("CURRENTNESS_UNVERIFIED");
    expect(model.calls[1]?.messagesText).toContain("CURRENTNESS_UNVERIFIED");
    // No structural correction masquerades as a semantic revision.
    expect(item?.correctionPackets).toEqual([]);
    // The revision stays one sample: both invocations share the case
    // identity, and no new sample was manufactured.
    expect(item?.invocationIds).toHaveLength(2);
    for (const invocationId of item?.invocationIds ?? []) {
      expect(invocationId.startsWith(runId + ":sample:0:settlement:")).toBe(true);
    }
    expect(item?.providerAttemptIds).toHaveLength(2);
    // Initial rejection preserved alongside convergence.
    expect(item?.authorityRevision).toEqual({
      attempted: true,
      revisionCount: 1,
      passes: [
        { semanticPass: 1, authorityCodes: ["CURRENTNESS_UNVERIFIED"], verdict: "REVISION_REQUIRED" },
        { semanticPass: 2, authorityCodes: [], verdict: "PASS" },
      ],
    });
    // Both passes share one case-level Thought deadline (never reset), and
    // no pacing delay is inserted between revision passes inside the case.
    expect(model.calls[0]?.deadlineAtMs).toBe(model.calls[1]?.deadlineAtMs);
    expect(sleepCalls).toEqual([]);
  });

  it("exhausts the production revision budget and fails closed", async () => {
    const { result, model } = await runSingleSettlementSample([
      REJECTED_CURRENTNESS_SETTLEMENT,
      REJECTED_CURRENTNESS_SETTLEMENT,
      REJECTED_CURRENTNESS_SETTLEMENT,
    ]);
    expect(result.cases).toHaveLength(1);
    const [item] = result.cases;
    expect(item?.verdict).toBe("NOT_QUALIFIED");
    // Bounded: one initial pass plus exactly MAX_AUTHORITY_REVISIONS.
    expect(MAX_AUTHORITY_REVISIONS).toBe(2);
    expect(model.callCount()).toBe(3);
    expect(item?.authorityRevision).toEqual({
      attempted: true,
      revisionCount: 2,
      passes: [
        { semanticPass: 1, authorityCodes: ["CURRENTNESS_UNVERIFIED"], verdict: "REVISION_REQUIRED" },
        { semanticPass: 2, authorityCodes: ["CURRENTNESS_UNVERIFIED"], verdict: "REVISION_REQUIRED" },
        {
          semanticPass: 3,
          authorityCodes: ["CURRENTNESS_UNVERIFIED", "authority_revision_exhausted"],
          verdict: "TERMINAL",
        },
      ],
    });
    expect(item?.firstFailureBoundary).toBe("AUTHORITY_REACHABILITY_REJECTION");
    expect(item?.failureCodes).toContain("authorityReachability_failed");
  });

  it("leaves a nonrevisable branch failure terminal without retry", async () => {
    const { result, model } = await runSingleSettlementSample([WRONG_BRANCH_ABSTAIN]);
    expect(result.cases).toHaveLength(1);
    const [item] = result.cases;
    expect(item?.verdict).toBe("NOT_QUALIFIED");
    expect(model.callCount()).toBe(1);
    expect(item?.failureCodes).toContain("semantic_branch_mismatch");
    expect(item?.authorityRevision).toEqual({
      attempted: false,
      revisionCount: 0,
      passes: [{ semanticPass: 1, authorityCodes: ["semantic_branch_mismatch"], verdict: "TERMINAL" }],
    });
  });

  it("rejects a wrong branch after revision instead of escaping the oracle", async () => {
    const { result, model } = await runSingleSettlementSample([
      REJECTED_CURRENTNESS_SETTLEMENT,
      WRONG_BRANCH_ABSTAIN,
    ]);
    expect(result.cases).toHaveLength(1);
    const [item] = result.cases;
    expect(item?.verdict).toBe("NOT_QUALIFIED");
    expect(model.callCount()).toBe(2);
    expect(item?.failureCodes).toContain("semantic_branch_mismatch");
    expect(item?.authorityRevision).toEqual({
      attempted: true,
      revisionCount: 1,
      passes: [
        { semanticPass: 1, authorityCodes: ["CURRENTNESS_UNVERIFIED"], verdict: "REVISION_REQUIRED" },
        { semanticPass: 2, authorityCodes: ["semantic_branch_mismatch"], verdict: "TERMINAL" },
      ],
    });
  });

  it("keeps the clean first-pass happy path at one provider call", async () => {
    const { result, model, sleepCalls } = await runSingleSettlementSample([CONVERGED_SETTLEMENT]);
    expect(result.cases).toHaveLength(1);
    const [item] = result.cases;
    expect(item?.verdict).toBe("PASS");
    expect(model.callCount()).toBe(1);
    expect(item?.authorityRevision).toEqual({
      attempted: false,
      revisionCount: 0,
      passes: [{ semanticPass: 1, authorityCodes: [], verdict: "PASS" }],
    });
    expect(sleepCalls).toEqual([]);
  });

  it("derives revisability from the canonical production policy with the production budget", () => {
    expect(MAX_AUTHORITY_REVISIONS).toBe(2);
    expect(isRevisableAuthorityRejection(["CURRENTNESS_UNVERIFIED"])).toBe(true);
    expect(isRevisableAuthorityRejection(["RECEIPT_REQUIRED"])).toBe(true);
    expect(isRevisableAuthorityRejection([])).toBe(false);
    expect(isRevisableAuthorityRejection(["DISPATCH_EPOCH_CHANGED"])).toBe(false);
    expect(isRevisableAuthorityRejection(["RELATIONAL_WITHDRAWAL"])).toBe(false);
    expect(
      isRevisableAuthorityRejection(["CURRENTNESS_UNVERIFIED", "DISPATCH_EPOCH_CHANGED"]),
    ).toBe(false);
    expect(
      productionAuthorityObjectionCodes(["CURRENTNESS_UNVERIFIED", "CURRENTNESS_UNVERIFIED", "BOGUS"]),
    ).toEqual(["CURRENTNESS_UNVERIFIED"]);
  });
});
