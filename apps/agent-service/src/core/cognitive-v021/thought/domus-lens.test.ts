import { describe, expect, it } from "vitest";
import { appendAshleyEvidence, appendOwnerUtterance } from "../evidence/conversation-log.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, IdentitySlice } from "../types.js";
import { DOMUS_LAST_N_TURNS, buildThoughtInput } from "./input.js";
import { thoughtContractProfile, thoughtContractProfileKey } from "./output-contract.js";

const constitution: IdentitySlice = { constitutional: ["truth before performance"], stableSelf: ["curious"] };
const engineering: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: true, canOfferWorkspace: true, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};

describe("H0.3 game lens", () => {
  it("a Domus pass carries a short conversation tail and no engineering", () => {
    const db = openTestSidecar();
    try {
      for (let i = 0; i < 20; i += 1) {
        appendOwnerUtterance(db, { conversationId: "thread-1", text: `message ${i}`, discordMessageIds: [`m-${i}`], nowMs: 10 + i });
      }
      appendAshleyEvidence(db, { conversationId: "thread-1", text: "her reply", discordMessageIds: ["r-1"], nowMs: 40 });
      const input = (triggerKind: "domus_notification" | "owner_message", cycleId: string) => buildThoughtInput({
        sidecar: db,
        cycle: admitTestCycle(db, { cycleId, conversationId: "thread-1", triggerKind, triggerRef: `${cycleId}-ref`, occupantId: "doc", nowMs: 100 }),
        constitution, capabilityReality: engineering, learnedSelfSlice: { dispositions: [], interests: [] },
      });
      const domus = input("domus_notification", "cycle-domus");
      expect(domus.rawConversation.length).toBeLessThanOrEqual(DOMUS_LAST_N_TURNS);
      expect(domus.rawConversation.at(-1)?.text).toBe("her reply");
      expect(domus.domainPointers.pointers).toEqual([]);
      expect(thoughtContractProfileKey(thoughtContractProfile(domus))).not.toContain("engineering");
      const chat = input("owner_message", "cycle-chat");
      expect(chat.rawConversation.length).toBe(21);
      expect(thoughtContractProfileKey(thoughtContractProfile(chat))).toContain("engineering");
    } finally {
      db.close();
    }
  });
});
