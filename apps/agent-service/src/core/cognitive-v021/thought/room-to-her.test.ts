import { describe, expect, it } from "vitest";
import { markRoomRowsToHer } from "./input.js";
import { observeGatewayUserId } from "../thalamus/scheduler.js";
import type { ConversationEvidenceRecord } from "../types.js";

const self = "1234567890123456";
const row = (rowId: string, role: ConversationEvidenceRecord["role"], extra: Partial<ConversationEvidenceRecord> = {}) =>
  ({ rowId, role, text: rowId, discordMessageIds: [], mentionIds: [], replyToMessageId: null, ...extra }) as ConversationEvidenceRecord;

describe("room rows meant for her", () => {
  it("marks contact rows that @mention her or reply to her, only in a room", () => {
    observeGatewayUserId(self);
    const rows = [
      row("hers", "ashley", { discordMessageIds: ["d-hers"] }),
      row("mention", "external_dialog", { mentionIds: [self] }),
      row("reply", "external_dialog", { replyToMessageId: "d-hers" }),
      row("other", "external_dialog", { mentionIds: ["9999999999999999"], replyToMessageId: "d-else" }),
    ];
    const marked = markRoomRowsToHer(rows, { kind: "room", roomId: "room:g:c" } as never);
    expect(marked.map((r) => r.toHer ?? null)).toEqual([null, ["mention"], ["reply"], null]);
    expect(markRoomRowsToHer(rows, { kind: "owner_private" } as never)).toBe(rows);
  });
});
