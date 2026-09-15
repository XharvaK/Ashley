import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import {
  admitExternalBatch,
  admitExternalCapture,
  type ExternalCaptureBody,
} from "../ingress/http.js";
import { insertOutboxPending } from "../speech/outbox.js";
import { createOutboxProjector } from "../delivery/outbox-projector.js";
import { readAuthorityBarrier } from "../authority/barrier.js";
import { issueLicense, upsertTrustedRoom } from "../../relationship/social-authority.js";
import {
  buildRoomAuthorityBinding,
  promoteEligibleRoomPending,
} from "./room-activation.js";

const ownerId = "doc";
const guildId = "guild-1";
const channelId = "room-1";
const roomId = `room:${guildId}:${channelId}`;
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function roomEnvelope(messageId: string, speakerPrincipalId = "bot-1"): ExternalCaptureBody["envelope"] {
  return {
    speakerPrincipalId,
    speakerKind: speakerPrincipalId.startsWith("bot-") ? "external_bot" : "external_human",
    location: { kind: "room", guildId, channelId },
    audienceAtCapture: "unknown",
    sentAtMs: nowMs,
    discordMessageId: messageId,
    mentionIds: [],
    attachmentRefs: [],
    provenance: { source: "discord", receivedAtMs: nowMs },
  };
}

function captureInput(messageId: string, speakerPrincipalId = "bot-1"): ExternalCaptureBody {
  return {
    envelope: roomEnvelope(messageId, speakerPrincipalId),
    message: `room message ${messageId}`,
    discordMessageId: messageId,
    attachments: [],
    gateHint: "allow_social",
    conversationKey: roomId,
  };
}

async function withEnvAsync<T>(
  values: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await callback(); } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function seedRoom(nuclear: DatabaseSync): void {
  upsertTrustedRoom(nuclear, {
    ownerId,
    guildId,
    channelId,
    mode: "trusted_social",
    provenance: "explicit_config",
    addedBy: ownerId,
    sourceSpan: { source: "room-activation-test" },
    nowMs,
  });
}

describe("RA-P16 trusted room activation", () => {
  it("keeps room captures non-cognitive until the staged room gate, then promotes once per capture", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedRoom(nuclear);
      const first = admitExternalCapture(sidecar, nuclear, captureInput("room-1"), { nowMs });
      const second = admitExternalCapture(sidecar, nuclear, captureInput("room-2", "human-1"), { nowMs: nowMs + 1 });
      const batch = admitExternalBatch(sidecar, nuclear, {
        captureRefs: [first.captureRef, second.captureRef],
        conversationKey: roomId,
      }, { nowMs, ownerId, roomSeedActive: true });
      expect(batch.results.every((item) => item.disposition === "external_eligible_pending")).toBe(true);

      expect(promoteEligibleRoomPending(sidecar, nuclear, {
        nowMs,
        ownerId,
        env: { RA_ROOM_SEED_ACTIVE: "true" },
      })).toMatchObject({ promoted: 0 });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM cycle_records").get()).toMatchObject({ count: 0 });

      const promoted = promoteEligibleRoomPending(sidecar, nuclear, {
        nowMs,
        ownerId,
        env: { RA_ROOM_SEED_ACTIVE: "true", RA_ROOM_PUBLICATION: channelId },
      });
      expect(promoted).toMatchObject({ promoted: 2, rejected: 0 });
      expect(new Set(promoted.cycleIds).size).toBe(1);
      expect(sidecar.prepare("SELECT trigger_kind FROM cycle_records").get()).toEqual({ trigger_kind: "external_message" });
      const freshness = sidecar.prepare("SELECT attempt_input_basis_json FROM cycle_records").get() as { attempt_input_basis_json: string };
      expect(JSON.parse(freshness.attempt_input_basis_json).orderedRefs).toHaveLength(2);

      const replay = promoteEligibleRoomPending(sidecar, nuclear, {
        nowMs: nowMs + 2,
        ownerId,
        env: { RA_ROOM_SEED_ACTIVE: "true", RA_ROOM_PUBLICATION: channelId },
      });
      expect(replay).toMatchObject({ promoted: 0, waiting: 0, rejected: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("permits a room bot without a person grant and rejects exact-principal disclosure to the room", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedRoom(nuclear);
      const license = issueLicense(nuclear, {
        ownerId,
        materialHash: "room-material",
        sourcePrincipal: "bot-1",
        controlledProtections: { kind: "room-test" },
        granteeAudience: { kind: "room", roomId },
        usesAllowed: 1,
        grantRef: "room-grant",
        nowMs,
      });
      const binding = buildRoomAuthorityBinding(nuclear, {
        ownerId,
        roomId,
        guildId,
        channelId,
        nowMs,
      });
      expect(binding.licenseRefs).toEqual([license.entityUuid]);

      const captured = admitExternalCapture(sidecar, nuclear, captureInput("room-publish"), { nowMs });
      const batched = admitExternalBatch(sidecar, nuclear, {
        captureRefs: [captured.captureRef],
        conversationKey: roomId,
      }, { nowMs, ownerId, roomSeedActive: true });
      expect(batched.results[0]?.disposition).toBe("external_eligible_pending");
      expect(promoteEligibleRoomPending(sidecar, nuclear, {
        nowMs,
        ownerId,
        env: { RA_ROOM_SEED_ACTIVE: "true", RA_ROOM_PUBLICATION: channelId },
      }).promoted).toBe(1);

      await withEnvAsync({ RA_ROOM_SEED_ACTIVE: "true", RA_ROOM_PUBLICATION: channelId }, async () => {
        const intent = {
          ownerId,
          channel: "discord",
          threadId: roomId,
          conversationId: roomId,
          trigger: "external_message" as const,
          deliveryLane: "reactive" as const,
          purpose: "licensed_speech" as const,
          destination: { kind: "room" as const, roomId, guildId, channelId },
          externalPublication: {
            destination: { kind: "room" as const, roomId, guildId, channelId },
            attemptInputBasis: {
              schemaVersion: 1 as const,
              orderedRefs: ["evidence-1"],
              versions: { "evidence-1": 1 },
              speakerAttributionHash: "speaker",
              replyEdges: [],
              attachmentCoverage: {},
              projectionVersion: "room-test",
            },
            hardDependencyBundle: binding.bundle,
            interactionIntent: "continue" as const,
            licenseRefs: [license.entityUuid],
            materialHash: "room-material",
          },
        };
        const outbox = insertOutboxPending(sidecar, {
          settlementId: "room-settlement",
          cycleId: "room-cycle",
          generation: 1,
          conversationId: roomId,
          licensedText: "room reply",
          deliveryIntent: intent,
        });
        await createOutboxProjector(sidecar, nuclear, { nowMs: () => nowMs }).project(outbox.outboxId);
      });

      expect(nuclear.prepare("SELECT state FROM delivery_reservations").get()).toEqual({ state: "reserved" });
      const exactPrincipal = issueLicense(nuclear, {
        ownerId,
        materialHash: "exact-principal",
        sourcePrincipal: "bot-1",
        controlledProtections: {},
        granteeAudience: { kind: "exact_principal", principalId: "bot-1" },
        usesAllowed: 1,
        grantRef: "exact-principal-grant",
        nowMs: nowMs + 1,
      });
      expect(exactPrincipal.entityUuid).toBeTruthy();
      const exactBase = buildRoomAuthorityBinding(nuclear, {
        ownerId,
        roomId,
        guildId,
        channelId,
        nowMs: nowMs + 1,
      });
      const barrier = readAuthorityBarrier(nuclear);
      const rebind = <T extends { barrier: { epoch: number; revision: number } }>(dep: T): T => ({
        ...dep,
        barrier: { epoch: barrier.epoch, revision: barrier.revision },
      });
      const exactBundle = {
        ...exactBase.bundle,
        permit: rebind(exactBase.bundle.permit),
        prohibitionAbsence: rebind(exactBase.bundle.prohibitionAbsence),
        roomState: rebind(exactBase.bundle.roomState),
        recipientRestrictionAbsence: rebind(exactBase.bundle.recipientRestrictionAbsence),
        ashleyBoundaryAbsence: rebind(exactBase.bundle.ashleyBoundaryAbsence),
        capability: rebind(exactBase.bundle.capability),
        destinationAccess: rebind(exactBase.bundle.destinationAccess),
        licenses: [{
          table: "disclosure_licenses",
          key: exactPrincipal.entityUuid,
          rowRevision: 1,
          barrier: { epoch: barrier.epoch, revision: barrier.revision },
          absentAsOfMs: nowMs + 1,
        }],
        barrier: { epoch: barrier.epoch, revision: barrier.revision },
      };
      const blockedIntent = {
        ownerId,
        channel: "discord",
        threadId: roomId,
        conversationId: roomId,
        trigger: "external_message" as const,
        deliveryLane: "reactive" as const,
        purpose: "licensed_speech" as const,
        destination: { kind: "room" as const, roomId, guildId, channelId },
        externalPublication: {
          destination: { kind: "room" as const, roomId, guildId, channelId },
          attemptInputBasis: {
            schemaVersion: 1 as const,
            orderedRefs: ["evidence-exact"],
            versions: { "evidence-exact": 1 },
            speakerAttributionHash: "speaker-exact",
            replyEdges: [],
            attachmentCoverage: {},
            projectionVersion: "room-exact-test",
          },
          hardDependencyBundle: exactBundle,
          interactionIntent: "continue" as const,
          licenseRefs: [exactPrincipal.entityUuid],
        },
      };
      const blocked = insertOutboxPending(sidecar, {
        settlementId: "room-exact-settlement",
        cycleId: "room-exact-cycle",
        generation: 1,
        conversationId: roomId,
        licensedText: "must not disclose to exact principal license",
        deliveryIntent: blockedIntent,
      });
      await withEnvAsync({ RA_ROOM_SEED_ACTIVE: "true", RA_ROOM_PUBLICATION: channelId }, async () => {
        await createOutboxProjector(sidecar, nuclear, { nowMs: () => nowMs + 1 }).project(blocked.outboxId);
      });
      expect(nuclear.prepare("SELECT state FROM delivery_reservations ORDER BY id DESC LIMIT 1").get())
        .toEqual({ state: "aborted" });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
