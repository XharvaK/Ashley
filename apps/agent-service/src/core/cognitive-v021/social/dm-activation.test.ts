import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import {
  admitExternalBatch,
  admitExternalCapture,
  type ExternalCaptureBody,
} from "../ingress/http.js";
import { createOutboxProjector } from "../delivery/outbox-projector.js";
import { insertOutboxPending } from "../speech/outbox.js";
import { revokePerson, grantPerson, issueLicense } from "../../relationship/social-authority.js";
import {
  buildExternalDmAuthorityBinding,
  promoteEligiblePending,
} from "./dm-activation.js";
import type { AttemptInputBasis } from "./types.js";

const ownerId = "doc";
const principalId = "person-1";
const channelId = "dm-person-1";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function dmEnvelope(messageId: string, authorId = principalId): ExternalCaptureBody["envelope"] {
  return {
    speakerPrincipalId: authorId,
    speakerKind: "external_human",
    location: { kind: "external_dm", principalId: authorId, channelId: `dm-${authorId}` },
    audienceAtCapture: "unknown",
    sentAtMs: nowMs,
    discordMessageId: messageId,
    mentionIds: [],
    attachmentRefs: [],
    provenance: { source: "discord", receivedAtMs: nowMs },
  };
}

function captureInput(messageId: string, authorId = principalId): ExternalCaptureBody {
  return {
    envelope: dmEnvelope(messageId, authorId),
    message: "hello from the external principal",
    discordMessageId: messageId,
    attachments: [],
    gateHint: "capture_quarantine",
    conversationKey: `dm:ashley-bot:${authorId}`,
  };
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: unknown };
  return Number(row.count ?? 0);
}

function basis(): AttemptInputBasis {
  return {
    schemaVersion: 1,
    orderedRefs: ["evidence-1"],
    versions: { "evidence-1": 1 },
    speakerAttributionHash: "speaker-hash",
    replyEdges: [],
    attachmentCoverage: {},
    projectionVersion: "ra-p15-test-v1",
  };
}

function withEnv<T>(values: Record<string, string | undefined>, callback: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function seedPermitAndLicense(nuclear: DatabaseSync) {
  const permit = grantPerson(nuclear, {
    ownerId,
    principalId,
    scope: "dm_only",
    sourceSpan: { source: "dm-activation-test" },
    nowMs,
  });
  const license = issueLicense(nuclear, {
    ownerId,
    materialHash: "material-1",
    sourcePrincipal: principalId,
    controlledProtections: { kind: "dm-activation-test" },
    granteeAudience: { kind: "dm", principalId },
    usesAllowed: 1,
    grantRef: "dm-activation-test-grant",
    nowMs,
  });
  return { permit, license };
}

describe("RA-P15 external DM activation", () => {
  it("keeps an eligible knock pending without cognition and promotes it once for the exact principal", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedPermitAndLicense(nuclear);
      const captured = admitExternalCapture(sidecar, nuclear, captureInput("dm-pending-1"), { nowMs });
      admitExternalBatch(sidecar, nuclear, {
        captureRefs: [captured.captureRef],
        conversationKey: captured.conversationKey,
      }, { nowMs, ownerId });

      expect(withEnv({ RA_DM_PRINCIPAL: principalId, RA_DM_COGNITION: undefined }, () =>
        promoteEligiblePending(sidecar, nuclear, { nowMs, ownerId }))).toMatchObject({
        promoted: 0,
        waiting: 0,
      });
      expect(count(sidecar, "cycle_records")).toBe(0);

      const promoted = withEnv({ RA_DM_PRINCIPAL: principalId, RA_DM_COGNITION: "true" }, () =>
        promoteEligiblePending(sidecar, nuclear, { nowMs, ownerId }));
      expect(promoted).toMatchObject({ promoted: 1, rejected: 0 });
      expect(sidecar.prepare("SELECT kind, state, status FROM inbox_events WHERE kind = 'external_utterance'").get())
        .toMatchObject({ kind: "external_utterance", state: "pending", status: "pending" });
      expect(sidecar.prepare("SELECT trigger_kind, attempt_id, attempt_input_basis_json FROM cycle_records").get())
        .toMatchObject({ trigger_kind: "external_message", attempt_id: expect.any(String), attempt_input_basis_json: expect.any(String) });

      const replay = withEnv({ RA_DM_PRINCIPAL: principalId, RA_DM_COGNITION: "true" }, () =>
        promoteEligiblePending(sidecar, nuclear, { nowMs: nowMs + 1, ownerId }));
      expect(replay).toMatchObject({ promoted: 0, waiting: 0, rejected: 0 });
      expect(count(sidecar, "cycle_records")).toBe(1);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("does not promote a pending knock for a different configured principal", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedPermitAndLicense(nuclear);
      const captured = admitExternalCapture(sidecar, nuclear, captureInput("dm-wrong-1"), { nowMs });
      admitExternalBatch(sidecar, nuclear, {
        captureRefs: [captured.captureRef],
        conversationKey: captured.conversationKey,
      }, { nowMs, ownerId });
      const result = withEnv({ RA_DM_PRINCIPAL: "person-2", RA_DM_COGNITION: "true" }, () =>
        promoteEligiblePending(sidecar, nuclear, { nowMs, ownerId }));
      expect(result).toMatchObject({ promoted: 0, waiting: 1 });
      expect(count(sidecar, "cycle_records")).toBe(0);
      expect(sidecar.prepare("SELECT state, status, wake_id FROM inbox_events WHERE kind = 'external_eligible_pending'").get())
        .toMatchObject({ state: "pending", status: "pending", wake_id: null });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("admits one S5-bound DM reservation and blocks publication when the publication flag is absent", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const { license } = seedPermitAndLicense(nuclear);
      const binding = buildExternalDmAuthorityBinding(nuclear, { principalId, channelId, nowMs });
      const intent = {
        ownerId,
        channel: "discord",
        threadId: `dm:ashley-bot:${principalId}`,
        conversationId: `dm:ashley-bot:${principalId}`,
        trigger: "external_message" as const,
        deliveryLane: "reactive" as const,
        purpose: "licensed_speech" as const,
        destination: { kind: "external_dm" as const, principalId, channelId },
        externalPublication: {
          destination: { kind: "external_dm" as const, principalId, channelId },
          attemptInputBasis: basis(),
          hardDependencyBundle: binding.bundle,
          interactionIntent: "continue" as const,
          licenseRefs: [license.entityUuid],
          materialHash: "material-1",
        },
      };

      const enabledOutbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-dm-enabled",
        cycleId: "cycle-dm-enabled",
        generation: 1,
        conversationId: intent.conversationId,
        licensedText: "permitted external reply",
        deliveryIntent: intent,
      });
      await withEnv({ RA_DM_PRINCIPAL: principalId, RA_DM_PUBLICATION: "true" }, async () => {
        await createOutboxProjector(sidecar, nuclear, { nowMs: () => nowMs }).project(enabledOutbox.outboxId);
      });
      const admitted = nuclear.prepare("SELECT state, destination_json, license_refs_json FROM delivery_reservations").get() as Record<string, unknown>;
      expect(admitted).toMatchObject({ state: "reserved" });
      expect(JSON.parse(String(admitted.destination_json))).toMatchObject({ kind: "external_dm", principalId });
      expect(JSON.parse(String(admitted.license_refs_json))).toEqual(expect.arrayContaining([
        expect.objectContaining({ licenseEntityUuid: license.entityUuid, consumedByReservationId: expect.any(Number) }),
      ]));

      const blockedOutbox = insertOutboxPending(sidecar, {
        settlementId: "settlement-dm-blocked",
        cycleId: "cycle-dm-blocked",
        generation: 1,
        conversationId: intent.conversationId,
        licensedText: "blocked external reply",
        deliveryIntent: { ...intent, externalPublication: { ...intent.externalPublication, licenseRefs: [license.entityUuid] } },
      });
      await withEnv({ RA_DM_PRINCIPAL: principalId, RA_DM_PUBLICATION: undefined }, async () => {
        await createOutboxProjector(sidecar, nuclear, { nowMs: () => nowMs + 1 }).project(blockedOutbox.outboxId);
      });
      expect(sidecar.prepare("SELECT send_status FROM speech_outbox WHERE outbox_id = ?").get(blockedOutbox.outboxId))
        .toMatchObject({ send_status: "suppressed" });
      expect(nuclear.prepare("SELECT state FROM delivery_reservations ORDER BY id DESC LIMIT 1").get())
        .toMatchObject({ state: "aborted" });

      const revoked = revokePerson(nuclear, { entityUuid: seedPermitAndLicense(nuclear).permit.entityUuid, nowMs: nowMs + 2 });
      expect(revoked).toBeDefined();
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
