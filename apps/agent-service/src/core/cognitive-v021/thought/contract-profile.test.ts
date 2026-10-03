import { describe, expect, it } from "vitest";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { buildThoughtInput } from "./input.js";
import { allocateThoughtProjection } from "./projection-allocator/allocator.js";
import { estimateRequestTokens } from "./projection-allocator/budget.js";
import {
  AFTERGLOW_GUIDANCE,
  AWAKE_GUIDANCE,
  FULL_THOUGHT_CONTRACT_PROFILE,
  GROWTH_GUIDANCE,
  JOURNAL_READING_GUIDANCE,
  JOURNAL_SETTLE_GUIDANCE,
  MEMORY_FORMATION_GUIDANCE,
  NIGHT_GUIDANCE,
  OWNER_VISIBILITY_GUIDANCE,
  SOCIAL_VISIBILITY_GUIDANCE,
  SOCIAL_TRUST_GUIDANCE,
  constrainThoughtOutputSchema,
  thoughtContractProfile,
  thoughtContractProfileKey,
  thoughtOutputCompatibilityInstruction,
  type ThoughtContractProfileSource,
} from "./output-contract.js";
import type { OperationalEffectNamespace } from "../effect/effect-ref.js";
import type { CapabilityReality } from "../types.js";

const noCapabilities: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

const chat: ThoughtContractProfileSource = { trigger: { kind: "owner_message" }, capabilityReality: noCapabilities };
const pass = (kind: string): ThoughtContractProfileSource => ({ trigger: { kind: "idle_opportunity" }, innerPass: { kind } });
const INQUIRY_LAW = "A bounded inquiry pairs M3 workspace steps";

/**
 * I1 budget line for the chat prefix, in the allocator's own estimate. Before
 * profiles the single contract estimated about 11.3k tokens.
 */
// Explicit durableNominations guidance is on every chat prefix.
const CHAT_PREFIX_TOKEN_BUDGET = 8_800;

function settlementFields(profile: ReturnType<typeof thoughtContractProfile>): string[] {
  const namespace = { allowedOperationalEffectRefs: [], fingerprint: "sha256:test" } as unknown as OperationalEffectNamespace;
  const schema = constrainThoughtOutputSchema(namespace, profile).schema as { oneOf: Array<{ properties: Record<string, unknown> }> };
  return Object.keys(schema.oneOf[0]!.properties);
}

describe("I1 profile-scoped Thought contract", () => {
  it("derives the profile from the turn", () => {
    expect(thoughtContractProfileKey(thoughtContractProfile(chat))).toBe("chat+owner");
    expect(thoughtContractProfile(pass("afterglow")).pass).toBe("afterglow");
    expect(thoughtContractProfile(pass("awake")).pass).toBe("awake");
    expect(thoughtContractProfile(pass("night")).pass).toBe("night");
    expect(thoughtContractProfile({ trigger: { kind: "future_trigger_due" } }).pass).toBe("private");
    expect(thoughtContractProfile({ ...chat, audience: { kind: "room" } }).ownerPrivate).toBe(false);
    expect(thoughtContractProfile({ ...chat, capabilityReality: { ...noCapabilities, canOfferProjectInspection: true } }).engineering).toBe(true);
    expect(thoughtContractProfile({
      ...chat,
      capabilityReality: { ...noCapabilities, semanticObservations: [{ operationKind: "project.inspect", semanticClass: "observation", readOnly: true, available: true }] },
    }).engineering).toBe(true);
    expect(thoughtContractProfile({
      ...chat,
      capabilityReality: { ...noCapabilities, semanticObservations: [{ operationKind: "memory.lookup", semanticClass: "observation", readOnly: true, available: true }] },
    }).engineering).toBe(false);
  });

  it("gives a chat turn memory and growth, and no pass or engineering law", () => {
    const text = thoughtOutputCompatibilityInstruction(thoughtContractProfile(chat));
    for (const paragraph of MEMORY_FORMATION_GUIDANCE) expect(text).toContain(paragraph);
    expect(text).toContain(GROWTH_GUIDANCE);
    expect(text).toContain(JOURNAL_READING_GUIDANCE);
    for (const absent of [AFTERGLOW_GUIDANCE, AWAKE_GUIDANCE, NIGHT_GUIDANCE, JOURNAL_SETTLE_GUIDANCE, INQUIRY_LAW, "initiativePreference", "During an autonomous idle opportunity only"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("gives each pass only its own guidance", () => {
    const awake = thoughtOutputCompatibilityInstruction(thoughtContractProfile(pass("awake")));
    for (const phrase of ["starting a conversation is a normal part of it", "restStreak", "sinceOwnerMs", "Mind the Owner's local time"]) {
      expect(awake).toContain(phrase);
    }
    expect(awake).not.toContain("genuinely earns it");
    const afterglow = thoughtOutputCompatibilityInstruction(thoughtContractProfile(pass("afterglow")));
    expect(afterglow).toContain(AFTERGLOW_GUIDANCE);
    expect(afterglow).toContain(JOURNAL_SETTLE_GUIDANCE);
    expect(afterglow).not.toContain(AWAKE_GUIDANCE);
    expect(afterglow).not.toContain("starting a conversation is a normal part of it");
    expect(afterglow).not.toContain(NIGHT_GUIDANCE);
    const night = thoughtOutputCompatibilityInstruction(thoughtContractProfile(pass("night")));
    expect(night).toContain(NIGHT_GUIDANCE);
    expect(night).not.toContain(AFTERGLOW_GUIDANCE);
    const engineering = thoughtOutputCompatibilityInstruction(thoughtContractProfile({
      ...chat, capabilityReality: { ...noCapabilities, canOfferInquiry: true },
    }));
    expect(engineering).toContain(INQUIRY_LAW);
    const room = thoughtOutputCompatibilityInstruction(thoughtContractProfile({ ...chat, audience: { kind: "room" } }));
    expect(room).not.toContain(GROWTH_GUIDANCE);
    expect(room).not.toContain(JOURNAL_READING_GUIDANCE);
  });

  it("tells her truthfully who can read what she keeps (A4)", () => {
    for (const source of [chat, pass("afterglow"), pass("awake"), pass("night")]) {
      const text = thoughtOutputCompatibilityInstruction(thoughtContractProfile(source));
      expect(text).toContain(OWNER_VISIBILITY_GUIDANCE);
      expect(text).not.toContain(SOCIAL_VISIBILITY_GUIDANCE);
    }
    const room = thoughtOutputCompatibilityInstruction(thoughtContractProfile({ ...chat, audience: { kind: "room" } }));
    expect(room).toContain(SOCIAL_VISIBILITY_GUIDANCE);
    expect(room).not.toContain(OWNER_VISIBILITY_GUIDANCE);
    expect(OWNER_VISIBILITY_GUIDANCE).toMatch(/diary/);
    expect(SOCIAL_VISIBILITY_GUIDANCE).toMatch(/never promise/i);
    // A9: calibrated trust is social-turn guidance; the chat prefix stays lean.
    expect(room).toContain(SOCIAL_TRUST_GUIDANCE);
    expect(thoughtOutputCompatibilityInstruction(thoughtContractProfile(chat))).not.toContain(SOCIAL_TRUST_GUIDANCE);
    expect(SOCIAL_TRUST_GUIDANCE).toMatch(/authority on their own/);
  });

  it("keeps every module in the full contract", () => {
    const full = thoughtOutputCompatibilityInstruction();
    expect(full).toBe(thoughtOutputCompatibilityInstruction(FULL_THOUGHT_CONTRACT_PROFILE));
    for (const guidance of [AFTERGLOW_GUIDANCE, AWAKE_GUIDANCE, NIGHT_GUIDANCE, JOURNAL_SETTLE_GUIDANCE, JOURNAL_READING_GUIDANCE, INQUIRY_LAW]) {
      expect(full).toContain(guidance);
    }
  });

  it("offers self-change engineering instructions only with advertised engineering capability", () => {
    const plain = thoughtOutputCompatibilityInstruction(thoughtContractProfile(chat));
    const engineering = thoughtOutputCompatibilityInstruction(thoughtContractProfile({ ...chat, capabilityReality: { canOfferWorkspace: true } }));
    expect(plain).not.toContain("payload.budgetPolicyId=ashley.self_change.v1");
    expect(engineering).toContain("payload.budgetPolicyId=ashley.self_change.v1");
    expect(thoughtOutputCompatibilityInstruction()).toContain("payload.budgetPolicyId=ashley.self_change.v1");
    expect(plain).toContain(GROWTH_GUIDANCE);
  });

  it("holds the chat prefix under its budget and every profile below the full contract", () => {
    const tokens = (text: string) => estimateRequestTokens([{ role: "system", content: text }]).estimatedInputTokens;
    const full = tokens(thoughtOutputCompatibilityInstruction());
    const chatTokens = tokens(thoughtOutputCompatibilityInstruction(thoughtContractProfile(chat)));
    expect(chatTokens).toBeLessThanOrEqual(CHAT_PREFIX_TOKEN_BUDGET);
    expect(chatTokens).toBeLessThan(full * 0.8);
    for (const kind of ["afterglow", "awake", "night"]) {
      expect(tokens(thoughtOutputCompatibilityInstruction(thoughtContractProfile(pass(kind))))).toBeLessThan(full);
    }
  });

  it("offers each turn only the settlement fields it can use", () => {
    const chatFields = settlementFields(thoughtContractProfile(chat));
    for (const field of ["reflection", "night", "journal", "initiativePreference"]) expect(chatFields).not.toContain(field);
    expect(chatFields).toEqual(expect.arrayContaining(["speech", "durableNominations", "growth", "interests"]));
    expect(settlementFields(thoughtContractProfile(pass("afterglow")))).toEqual(expect.arrayContaining(["reflection", "journal"]));
    expect(settlementFields(thoughtContractProfile(pass("night")))).toEqual(expect.arrayContaining(["night", "journal"]));
    expect(settlementFields(thoughtContractProfile(pass("night")))).not.toContain("reflection");
    expect(settlementFields(thoughtContractProfile({ ...chat, audience: { kind: "room" } }))).not.toContain("growth");
  });
});

describe("the chat dispatch", () => {
  function allocateChat(withMemory: boolean) {
    const db = openTestSidecar();
    const cycle = admitTestCycle(db, { conversationId: "dm:owner", triggerKind: "owner_message", triggerRef: "owner-1", nowMs: 1 });
    const owner = appendOwnerUtterance(db, { conversationId: "dm:owner", text: "hey, what's up?", discordMessageIds: ["m-1"], nowMs: 2 });
    if (withMemory) {
      upsertMemoryAssertion(db, {
        assertionKey: "owner:tea",
        statement: "Alex drinks green tea every morning.",
        memoryKind: "owner_preference",
        dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        dataClassification: "never_public",
        lineageParentKey: null,
        admittedGeneration: 1,
        live: true,
      });
    }
    const input = buildThoughtInput({
      sidecar: db,
      cycle,
      triggerText: owner.text ?? "",
      triggerEvidence: owner,
      constitution: { constitutional: ["truth first"], stableSelf: ["sharp"] },
      capabilityReality: noCapabilities,
      learnedSelfSlice: { dispositions: [], interests: [] },
    });
    try {
      return allocateThoughtProjection({ thoughtInput: input, requestId: "chat-request" });
    } finally {
      db.close();
    }
  }

  it("records its profile, stays byte-stable, and puts her identity before the conversation (I0)", () => {
    const first = allocateChat(false);
    const second = allocateChat(false);
    expect(first.receipt.diagnostics?.thought_contract_profile).toBe("chat+owner");
    expect(first.messages[0]!.content).toBe(second.messages[0]!.content);
    expect(first.messages[0]!.content).not.toContain(AFTERGLOW_GUIDANCE);
    const keys = Object.keys(JSON.parse(String(first.messages[1]!.content)));
    expect(keys[0]).toBe("orientationKernel");
    expect(keys.indexOf("orientationKernel")).toBeLessThan(keys.indexOf("rawConversation"));
  });

  it("R8: with a memory in coreProfile and nothing recalled, her prompt counts coreProfile as memory", () => {
    const allocated = allocateChat(true);
    const user = JSON.parse(String(allocated.messages[1]!.content)) as {
      coreProfile?: { owner: Array<{ statement: string }> };
      retrieval: { hits: unknown[] };
      orientationKernel: { staticOperatingContract: string };
    };
    expect(user.coreProfile?.owner.map((entry) => entry.statement)).toContain("Alex drinks green tea every morning.");
    expect(user.retrieval.hits).toEqual([]);
    const prompt = user.orientationKernel.staticOperatingContract;
    expect(prompt).toContain("`coreProfile` holds what matters most");
    expect(prompt).toMatch(/If none of them holds anything about Alex, I say I don't remember yet/);
    for (const retired of ["hot messages", "Memory context", "Reading claim license note"]) expect(prompt).not.toContain(retired);
  });
});
