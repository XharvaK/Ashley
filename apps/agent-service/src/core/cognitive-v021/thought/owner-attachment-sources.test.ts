import { describe, expect, it } from "vitest";
import { appendInboxEvent } from "../cycle/inbox.js";
import { openTestSidecar } from "../test-support.js";
import { ownerAttachmentSources } from "./run.js";

const image = (id: string) => ({
  discordAttachmentId: id,
  declaredMime: "image/webp",
  fileName: "image.png",
  sourceUrl: `https://cdn.discordapp.com/attachments/1/${id}/image.png`,
  sourceClass: "supplied_image",
});

function append(
  sidecar: ReturnType<typeof openTestSidecar>,
  input: { id: string; cycleId: string; evidenceRowId: string; attachments?: unknown[]; kind?: string; createdAtMs: number },
) {
  return appendInboxEvent(sidecar, {
    id: input.id,
    conversationId: "thread-owner" as never,
    kind: input.kind ?? "owner_utterance",
    payload: {
      cycleId: input.cycleId,
      evidenceRowId: input.evidenceRowId,
      ownerId: "doc",
      channel: "discord",
      attachments: input.attachments ?? [],
    },
    createdAtMs: input.createdAtMs,
  });
}

describe("owner attachment sources for a cycle", () => {
  // Regression: 2026-09-29 a caption and a screenshot sent 2 s apart were
  // folded into one cycle; perception read only the caption's event, so the
  // screenshot was never fetched or described.
  it("includes attachments from fragments absorbed into the triggering cycle", () => {
    const sidecar = openTestSidecar();
    const trigger = append(sidecar, { id: "ev-caption", cycleId: "cycle:a", evidenceRowId: "row-caption", createdAtMs: 1 });
    append(sidecar, { id: "ev-image", cycleId: "cycle:a", evidenceRowId: "row-image", attachments: [image("att-1")], createdAtMs: 2 });

    const sources = ownerAttachmentSources(sidecar, trigger, trigger.payload as Record<string, unknown>, {
      cycleId: "cycle:a",
      conversationId: "thread-owner",
    });

    expect(sources).toEqual([{ sourceMessageEntityUuid: "row-image", attachments: [image("att-1")] }]);
  });

  it("keeps the trigger first, and excludes other cycles and non-owner events", () => {
    const sidecar = openTestSidecar();
    const trigger = append(sidecar, { id: "ev-1", cycleId: "cycle:a", evidenceRowId: "row-1", attachments: [image("att-1")], createdAtMs: 1 });
    append(sidecar, { id: "ev-other-cycle", cycleId: "cycle:b", evidenceRowId: "row-b", attachments: [image("att-b")], createdAtMs: 2 });
    append(sidecar, { id: "ev-not-owner", cycleId: "cycle:a", evidenceRowId: "row-x", attachments: [image("att-x")], kind: "idle_tick", createdAtMs: 3 });
    append(sidecar, { id: "ev-2", cycleId: "cycle:a", evidenceRowId: "row-2", attachments: [image("att-2")], createdAtMs: 4 });

    const sources = ownerAttachmentSources(sidecar, trigger, trigger.payload as Record<string, unknown>, {
      cycleId: "cycle:a",
      conversationId: "thread-owner",
    });

    expect(sources.map((source) => source.sourceMessageEntityUuid)).toEqual(["row-1", "row-2"]);
  });

  it("returns nothing when no utterance in the cycle carries attachments", () => {
    const sidecar = openTestSidecar();
    const trigger = append(sidecar, { id: "ev-1", cycleId: "cycle:a", evidenceRowId: "row-1", createdAtMs: 1 });
    expect(ownerAttachmentSources(sidecar, trigger, trigger.payload as Record<string, unknown>, {
      cycleId: "cycle:a",
      conversationId: "thread-owner",
    })).toEqual([]);
  });
});
