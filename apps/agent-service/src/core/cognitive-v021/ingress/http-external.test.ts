import express from "express";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  admitExternalBatch,
  admitExternalCapture,
  createExternalCaptureHandler,
  type ExternalCaptureBody,
} from "./http.js";
import { openNuclearDb } from "../../db.js";
import { openTestSidecar } from "../test-support.js";
import { upsertTrustedRoom } from "../../relationship/social-authority.js";
import { reconcileUnbatchedCaptures } from "../cycle/reconcile.js";
import { claimNextInboxEvent } from "../cycle/inbox-consumer.js";
import { createOutboxProjector } from "../delivery/outbox-projector.js";
import {
  listPendingCognitiveDeliveries,
  listPendingSocialNotifications,
} from "../delivery/pending.js";

const ownerId = "doc";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function roomEnvelope(messageId: string, authorId = "person-1"): ExternalCaptureBody["envelope"] {
  return {
    speakerPrincipalId: authorId,
    speakerKind: "external_human",
    location: { kind: "room", guildId: "guild-1", channelId: "room-1" },
    audienceAtCapture: "unknown",
    sentAtMs: nowMs,
    discordMessageId: messageId,
    mentionIds: [],
    attachmentRefs: [],
    provenance: { source: "discord", receivedAtMs: nowMs },
  };
}

function dmEnvelope(messageId: string, authorId: string): ExternalCaptureBody["envelope"] {
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

function captureInput(
  envelope: ExternalCaptureBody["envelope"],
  message = "hello",
  conversationKey?: string,
): ExternalCaptureBody {
  const key = conversationKey ?? (envelope.location.kind === "room"
    ? `room:${envelope.location.guildId}:${envelope.location.channelId}`
    : `dm:ashley-bot:${envelope.location.principalId}`);
  return {
    envelope,
    message,
    discordMessageId: envelope.discordMessageId,
    attachments: envelope.attachmentRefs,
    gateHint: "capture_quarantine",
    conversationKey: key,
  };
}

function seedRoom(nuclear: DatabaseSync): void {
  upsertTrustedRoom(nuclear, {
    ownerId,
    guildId: "guild-1",
    channelId: "room-1",
    mode: "trusted_social",
    provenance: "explicit_config",
    addedBy: ownerId,
    nowMs,
  });
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: unknown };
  return Number(row.count ?? 0);
}

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": payload.length,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = text;
        try {
          json = JSON.parse(text);
        } catch {
          /* keep raw text */
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("external social ingress (RA-P9)", () => {
  it("captures attributed evidence before any batch and deduplicates by Discord id", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = admitExternalCapture(
        sidecar,
        nuclear,
        captureInput(roomEnvelope("discord-1")),
        { nowMs },
      );
      const replay = admitExternalCapture(
        sidecar,
        nuclear,
        captureInput(roomEnvelope("discord-1"), "changed replay"),
        { nowMs: nowMs + 1 },
      );

      expect(first).toMatchObject({
        captureRef: expect.stringMatching(/^extcap:/),
        conversationKey: "room:guild-1:room-1",
        duplicate: false,
      });
      expect(replay).toEqual({ ...first, duplicate: true });
      expect(count(sidecar, "conversation_evidence_log")).toBe(1);
      expect(count(sidecar, "conversation_evidence_discord_ids")).toBe(1);
      expect(sidecar.prepare("SELECT role, speaker_principal_id, location_json FROM conversation_evidence_log").get())
        .toMatchObject({ role: "external_dialog", speaker_principal_id: "person-1" });
      expect(count(sidecar, "inbox_events")).toBe(1);
      expect(sidecar.prepare("SELECT kind, wake_id FROM inbox_events").get())
        .toMatchObject({ kind: "external_captured", wake_id: null });
      expect(claimNextInboxEvent(sidecar, { workerId: "p9-test", nowMs: nowMs + 1 })).toBeNull();
      expect(count(sidecar, "cycle_records")).toBe(0);
      expect(count(sidecar, "thought_steps")).toBe(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("rejects malformed envelopes with HTTP 400 and stores nothing", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const app = express();
    app.use(express.json());
    app.post("/chat/ingress-external/capture", createExternalCaptureHandler({
      sidecar,
      nuclearDb: nuclear,
      authorizeBotService: () => undefined,
      enabled: true,
      nowMs: () => nowMs,
    }));
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address_missing");
      const response = await postJson(address.port, "/chat/ingress-external/capture", {
        envelope: { ...roomEnvelope("malformed"), location: { kind: "room", guildId: "", channelId: "room-1" } },
        message: "not stored",
        discordMessageId: "malformed",
        attachments: [],
      });
      expect(response.status).toBe(400);
      expect(response.json).toMatchObject({ error: "external_envelope_invalid" });
      expect(count(sidecar, "conversation_evidence_log")).toBe(0);
      expect(count(sidecar, "inbox_events")).toBe(0);
      expect(count(sidecar, "cycle_records")).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      nuclear.close();
      sidecar.close();
    }
  });

  it("keeps the external capture route closed when the activation gate is off", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const app = express();
    app.use(express.json());
    app.post("/chat/ingress-external/capture", createExternalCaptureHandler({
      sidecar,
      nuclearDb: nuclear,
      authorizeBotService: () => undefined,
      enabled: false,
      nowMs: () => nowMs,
    }));
    const server = app.listen(0);
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address_missing");
      const response = await postJson(address.port, "/chat/ingress-external/capture", captureInput(roomEnvelope("closed-1")));
      expect(response.status).toBe(403);
      expect(response.json).toMatchObject({ error: "external_admission_closed" });
      expect(count(sidecar, "conversation_evidence_log")).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      nuclear.close();
      sidecar.close();
    }
  });

  it("keeps an eligible external batch pending without creating Thought or cycles", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedRoom(nuclear);
      const captured = admitExternalCapture(sidecar, nuclear, captureInput(roomEnvelope("eligible-1")), { nowMs });
      const result = admitExternalBatch(sidecar, nuclear, {
        captureRefs: [captured.captureRef],
        conversationKey: captured.conversationKey,
      }, { nowMs, roomSeedActive: true });

      expect(result.results).toEqual([{
        captureRef: captured.captureRef,
        disposition: "external_eligible_pending",
        notificationQueued: false,
      }]);
      expect(sidecar.prepare("SELECT kind, state, status, wake_id FROM inbox_events ORDER BY id").all())
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "external_captured", wake_id: null }),
          expect.objectContaining({ kind: "external_eligible_pending", state: "pending", status: "pending", wake_id: null }),
        ]));
      expect(count(sidecar, "thought_steps")).toBe(0);
      expect(count(sidecar, "cycle_records")).toBe(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("quarantines an unknown DM, queues one bounded Owner notice, and is idempotent", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const captured = admitExternalCapture(sidecar, nuclear, captureInput(dmEnvelope("unknown-1", "unknown-person")), { nowMs });
      const input = { captureRefs: [captured.captureRef], conversationKey: captured.conversationKey };
      const first = admitExternalBatch(sidecar, nuclear, input, { nowMs, ownerId });
      const replay = admitExternalBatch(sidecar, nuclear, input, { nowMs: nowMs + 1, ownerId });

      expect(first.results).toEqual([{
        captureRef: captured.captureRef,
        disposition: "quarantined_external",
        notificationQueued: true,
      }]);
      expect(replay.results).toEqual([{
        captureRef: captured.captureRef,
        disposition: "already_batched",
      }]);
      expect(count(sidecar, "system_notice_outbox")).toBe(1);
      expect(sidecar.prepare("SELECT kind, state, status, quarantine_reason, wake_id FROM inbox_events WHERE kind = 'quarantined_external'").get())
        .toMatchObject({ kind: "quarantined_external", state: "quarantined", status: "failed_terminal", wake_id: null });
      expect(count(sidecar, "thought_steps")).toBe(0);
      expect(count(sidecar, "cycle_records")).toBe(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("reconciles a captured-but-unbatched row at startup exactly once", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      seedRoom(nuclear);
      const captured = admitExternalCapture(sidecar, nuclear, captureInput(roomEnvelope("restart-1")), { nowMs: 1 });
      const batches: Array<{ refs: string[]; key: string }> = [];
      const batch = async (input: { captureRefs: string[]; conversationKey: string }) => {
        batches.push({ refs: input.captureRefs, key: input.conversationKey });
        return admitExternalBatch(sidecar, nuclear, input, { nowMs: nowMs + 20_000, roomSeedActive: true });
      };

      const first = await reconcileUnbatchedCaptures(sidecar, { nowMs: nowMs + 20_000, batch });
      const second = await reconcileUnbatchedCaptures(sidecar, { nowMs: nowMs + 20_000, batch });

      expect(first).toMatchObject({ discovered: 1, batched: 1, failures: 0 });
      expect(second).toMatchObject({ discovered: 0, batched: 0, failures: 0 });
      expect(batches).toEqual([{ refs: [captured.captureRef], key: "room:guild-1:room-1" }]);
      expect(count(sidecar, "inbox_events")).toBe(2);
      expect(count(sidecar, "thought_steps")).toBe(0);
      expect(count(sidecar, "cycle_records")).toBe(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("projects bounded quarantine notice into social_notify without cognitive delivery", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const captured = admitExternalCapture(
        sidecar,
        nuclear,
        captureInput(dmEnvelope("notify-1", "unknown-notify")),
        { nowMs },
      );
      const projector = createOutboxProjector(sidecar, nuclear);
      admitExternalBatch(sidecar, nuclear, {
        captureRefs: [captured.captureRef],
        conversationKey: captured.conversationKey,
      }, {
        nowMs,
        ownerId,
        projectSystemNotice: (noticeId) => projector.projectSystem(noticeId),
      });

      expect(listPendingSocialNotifications(nuclear, ownerId)).toHaveLength(1);
      expect(listPendingCognitiveDeliveries(nuclear, ownerId)).toEqual([]);
      expect(nuclear.prepare("SELECT delivery_lane FROM delivery_reservations").get())
        .toMatchObject({ delivery_lane: "social_notify" });
      expect(count(sidecar, "cycle_records")).toBe(0);
      expect(count(sidecar, "thought_steps")).toBe(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });
});
