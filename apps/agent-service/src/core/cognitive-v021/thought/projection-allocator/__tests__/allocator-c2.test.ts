import { describe, expect, it } from "vitest";
import { appendOwnerUtterance } from "../../../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../../../test-support.js";
import { allocateThoughtProjection, thoughtMessagesForProjection } from "../allocator.js";
import { buildThoughtInput } from "../../input.js";
import { estimateRequestTokens } from "../budget.js";
import { buildAllocationCandidates } from "../sections.js";
import { projectThoughtInput } from "../../projection.js";

describe("MAT-II C2 allocator integration", () => {
  it("projects the orientation kernel and domain pointers through the existing allocator", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "c2-conversation",
        triggerKind: "owner_message",
        triggerRef: "c2-owner",
        nowMs: 1,
      });
      const owner = appendOwnerUtterance(db, {
        conversationId: "c2-conversation",
        text: "C2 projection",
        discordMessageIds: ["c2-message"],
        nowMs: 2,
      });
      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        triggerText: owner.text ?? "C2 projection",
        triggerEvidence: owner,
        constitution: { constitutional: ["truth first"], stableSelf: ["sharp"] },
        capabilityReality: {
          vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
          canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
          canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
          approvedProjectIds: [],
        },
        learnedSelfSlice: { dispositions: [], interests: [] },
      });

      expect(input.orientationKernel).toBeDefined();
      expect(input.orientationKernel?.staticOperatingContract).toBeTruthy();
      expect(input.domainPointers).toBeDefined();

      const allocated = allocateThoughtProjection({ thoughtInput: input, requestId: "c2-request" });
      expect(allocated.projected.orientationKernel).toBeDefined();
      expect(allocated.projected.domainPointers).toBeDefined();
      expect(allocated.receipt.decision.included.map((item) => item.section)).toEqual(
        expect.arrayContaining(["orientation_kernel", "domain_pointers"]),
      );
    } finally {
      db.close();
    }
  });

  it("serializes C2 canonical identity and capability truth once while retaining compatibility access", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        conversationId: "c2-uniqueness-conversation",
        triggerKind: "owner_message",
        triggerRef: "c2-uniqueness-owner",
        nowMs: 1,
      });
      const owner = appendOwnerUtterance(db, {
        conversationId: "c2-uniqueness-conversation",
        text: "C2 uniqueness",
        discordMessageIds: ["c2-uniqueness-message"],
        nowMs: 2,
      });
      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        triggerText: owner.text ?? "C2 uniqueness",
        triggerEvidence: owner,
        constitution: {
          constitutional: ["truth first"],
          stableSelf: ["sharp"],
          values: ["truth first"],
          boundaries: ["do not invent authority"],
        } as Parameters<typeof buildThoughtInput>[0]["constitution"],
        capabilityReality: {
          vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
          canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
          canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
          approvedProjectIds: [],
        },
        learnedSelfSlice: { dispositions: [], interests: [] },
      });

      const allocated = allocateThoughtProjection({
        thoughtInput: input,
        semanticBudgetTokens: 9_500,
        requestId: "c2-uniqueness-request",
      });
      const visible = JSON.parse(allocated.messages[1]?.content ?? "{}") as Record<string, unknown>;
      const visibleKernel = visible.orientationKernel as Record<string, unknown>;

      expect(visibleKernel.values).toEqual(["truth first"]);
      expect(visibleKernel.boundaries).toEqual(["do not invent authority"]);
      expect(visibleKernel.selectedStableSelf).toEqual(["sharp"]);
      expect(visibleKernel.staticOperatingContract)
        .toBe(input.orientationKernel?.staticOperatingContract);
      expect(visibleKernel.capabilityReality).toEqual(input.capabilityReality);
      expect(visible).not.toHaveProperty("staticOperatingContract");
      expect(visible.domainPointers).toBeDefined();
      expect(visible.orientationKernel).not.toHaveProperty("domainPointers");
      expect(visible).not.toHaveProperty("constitution");
      expect(visible).not.toHaveProperty("capabilityReality");
      expect(visibleKernel).not.toHaveProperty("stableSelf");
      expect(visibleKernel).not.toHaveProperty("stableSelfPointers");
      expect(buildAllocationCandidates(input, []).map((candidate) => candidate.section))
        .not.toEqual(expect.arrayContaining(["constitution", "capability"]));

      // Existing in-process callers retain the compatibility accessors.
      expect(allocated.projected.constitution.constitutional).toEqual(["truth first"]);
      expect(allocated.projected.capabilityReality).toEqual(input.capabilityReality);
      expect(input.orientationKernel?.stableSelf).toBe(input.orientationKernel?.selectedStableSelf);
      expect(input.orientationKernel?.stableSelfPointers).toBe(input.orientationKernel?.stableSelfRemainder);

      const directProjection = projectThoughtInput(input, []).projected;
      const directVisible = JSON.parse(JSON.stringify(directProjection)) as Record<string, unknown>;
      expect(directVisible).not.toHaveProperty("constitution");
      expect(directVisible).not.toHaveProperty("capabilityReality");
      expect(directProjection.constitution).toBe(input.constitution);
      expect(directProjection.capabilityReality).toBe(input.capabilityReality);
      expect(directProjection.concernSnapshots).toEqual({});
      expect(JSON.stringify(directProjection)).not.toContain("concernSnapshots");
      expect(JSON.stringify(allocated.projected)).not.toContain("concernSnapshots");

      const messages = thoughtMessagesForProjection(allocated.projected);
      expect(estimateRequestTokens(messages, { maxTokens: 4_096 }).estimatedInputTokens)
        .toBe(allocated.receipt.estimatedInputTokens);
    } finally {
      db.close();
    }
  });

  it("preserves the protected recent suffix before optional ordinary history", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "c2-budget-conversation";
      const cycle = admitTestCycle(db, {
        conversationId,
        triggerKind: "owner_message",
        triggerRef: "c2-budget-trigger",
        nowMs: 1,
      });
      Array.from({ length: 4 }, (_, index) => appendOwnerUtterance(db, {
        conversationId,
        text: `ordinary historical row ${index} `,
        discordMessageIds: [`c2-budget-message-${index}`],
        nowMs: index + 2,
      }));
      const current = appendOwnerUtterance(db, {
        conversationId,
        text: "current owner trigger ".repeat(5),
        discordMessageIds: ["c2-budget-current-message"],
        nowMs: 20,
      });
      const canonicalValues = ["truth first", "owner agency"];
      const canonicalBoundaries = ["do not invent authority", "do not claim unverified effects"];
      const constitution = {
        constitutional: ["truth first", "do not invent authority"],
        stableSelf: [
          "sharp and careful",
          "warm but bounded",
          "curious about systems",
          "direct about uncertainty",
          "protective of owner agency",
        ],
        values: canonicalValues,
        boundaries: canonicalBoundaries,
      } as Parameters<typeof buildThoughtInput>[0]["constitution"];
      const capabilityReality = {
        vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
        canOfferProjectInspection: true, canOfferWorkspace: true, canOfferVerification: true,
        canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferPatchExport: false,
        approvedProjectIds: Array.from({ length: 8 }, (_, index) => `approved-project-${index}`),
      };
      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        triggerText: current.text ?? "current owner trigger",
        triggerEvidence: current,
        lastNTurns: 100,
        constitution,
        capabilityReality,
        learnedSelfSlice: {
          dispositions: ["disciplined", "evidence-led"],
          interests: ["architecture", "token economy"],
        },
        occupancy: Array.from({ length: 3 }, (_, index) => ({
          conversationId,
          concernId: `concern-${index}`,
          status: "active" as const,
          priority: 10 - index,
          updatedCycle: cycle.cycleId,
          updatedGeneration: cycle.generation,
        })),
        observations: Array.from({ length: 4 }, (_, index) => ({
          observationId: `observation-${index}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          derived: false,
          replaySafe: true,
          modality: "text" as const,
          payload: {
            source: "owner-observation",
            text: `grounded observation payload ${index} `,
          },
          provenance: `conversation:${current.rowId}`,
          dataClassification: "ordinary" as const,
          secretOmitted: false,
        })),
        inFlight: Array.from({ length: 2 }, (_, index) => ({
          effectId: `effect-${index}`,
          cycleId: cycle.cycleId,
          generation: cycle.generation,
          wakeId: null,
          correlationId: `correlation-${index}`,
          idempotencyKey: `idempotency-${index}`,
          status: "in_flight" as const,
          dispatchedAtMs: index + 10,
          originJobId: null,
          originEventId: null,
          originAttemptId: null,
        })),
      });

      const requiredOnly = allocateThoughtProjection({
        thoughtInput: { ...input, rawConversation: [current] },
        // The current required C2 sections exceed the historical 9,500
        // fixture envelope; use the active 16,384 comparison envelope.
        semanticBudgetTokens: 16_384,
        requestId: "c2-required-prefix-request",
      });
      expect(requiredOnly.receipt.estimatedInputTokens).toBeLessThanOrEqual(16_384);
      expect(requiredOnly.receipt.decision.omitted.filter(
        (candidate) => candidate.section === "recent_raw",
      )).toHaveLength(0);
      expect(requiredOnly.receipt.decision.included).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `recent_raw:${current.rowId}`, required: true }),
      ]));

      const allocated = allocateThoughtProjection({
        thoughtInput: input,
        // This comparison envelope is intentionally below the restoration
        // target but large enough to retain the four-message protected suffix.
        semanticBudgetTokens: 16_384,
        requestId: "c2-budget-request",
      });
      expect(allocated.receipt.estimatedInputTokens).toBeLessThanOrEqual(16_384);
      expect(allocated.receipt.requiredOverflow).toBe(false);
      expect(allocated.projected.rawConversation.map((row) => row.rowId)).toContain(current.rowId);
      expect(allocated.receipt.decision.included).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "orientation_kernel", required: true }),
        expect.objectContaining({ id: `recent_raw:${current.rowId}`, required: true }),
        expect.objectContaining({ id: "learned_self", required: true }),
        expect.objectContaining({ id: "domain_pointers", required: true }),
      ]));
      expect(allocated.receipt.decision.included.filter(
        (candidate) => candidate.section === "recent_raw" && candidate.required,
      )).toHaveLength(5);
      expect(allocated.receipt.decision.omitted.filter(
        (candidate) => candidate.section === "recent_raw",
      )).toHaveLength(0);
      expect(allocated.projected.orientationKernel?.values).toEqual(canonicalValues);
      expect(allocated.projected.orientationKernel?.boundaries).toEqual(canonicalBoundaries);
      expect(allocated.projected.orientationKernel?.capabilityReality).toEqual(capabilityReality);
      expect(allocated.projected.domainPointers).toBeDefined();
    } finally {
      db.close();
    }
  });
});
