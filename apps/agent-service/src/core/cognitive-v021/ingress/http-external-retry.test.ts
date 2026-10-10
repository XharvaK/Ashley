import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { admitExternalBatch, admitExternalCapture, type ExternalCaptureBody } from "./http.js";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import { upsertTrustedRoom } from "../../relationship/social-authority.js";

const ownerId = "doc";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function roomCapture(messageId: string): ExternalCaptureBody {
  return {
    envelope: {
      speakerPrincipalId: "person-1",
      speakerKind: "external_human",
      location: { kind: "room", guildId: "guild-1", channelId: "room-1" },
      audienceAtCapture: "unknown",
      sentAtMs: nowMs,
      discordMessageId: messageId,
      mentionIds: [],
      attachmentRefs: [],
      provenance: { source: "discord", receivedAtMs: nowMs },
    },
    message: "hello",
    discordMessageId: messageId,
    attachments: [],
    gateHint: "capture_quarantine",
    conversationKey: "room:guild-1:room-1",
  };
}

function seededNuclear(): DatabaseSync {
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  upsertTrustedRoom(nuclear, {
    ownerId,
    guildId: "guild-1",
    channelId: "room-1",
    mode: "trusted_social",
    provenance: "explicit_config",
    addedBy: ownerId,
    nowMs,
  });
  return nuclear;
}

describe("external batch eligibility read errors (A6-11)", () => {
  it("leaves a capture retryable when the eligibility read fails, with no quarantine", () => {
    const sidecar = openTestSidecar();
    const failing = seededNuclear();
    const captured = admitExternalCapture(sidecar, failing, roomCapture("retry-1"), { nowMs });
    failing.close();

    const failed = admitExternalBatch(sidecar, failing, {
      captureRefs: [captured.captureRef],
      conversationKey: captured.conversationKey,
    }, { nowMs, roomSeedActive: true });

    expect(failed.results).toEqual([{
      captureRef: captured.captureRef,
      disposition: "capture_retryable",
      reason: "db_error",
    }]);
    expect(sidecar.prepare("SELECT COUNT(*) AS count FROM inbox_events WHERE kind = 'quarantined_external' OR id LIKE 'external:quarantine:%'").get())
      .toMatchObject({ count: 0 });
    expect(sidecar.prepare("SELECT state, status FROM inbox_events WHERE kind = 'external_captured'").get())
      .toMatchObject({ state: "pending", status: "pending" });

    const healthy = seededNuclear();
    const retried = admitExternalBatch(sidecar, healthy, {
      captureRefs: [captured.captureRef],
      conversationKey: captured.conversationKey,
    }, { nowMs: nowMs + 1, roomSeedActive: true });
    expect(retried.results[0]?.disposition).toBe("external_eligible_pending");
    healthy.close();
    sidecar.close();
  });
});
