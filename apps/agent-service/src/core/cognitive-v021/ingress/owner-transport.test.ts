import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { admitCognitiveIngress } from "./http.js";
import { openNuclearDb } from "../../db.js";
import {
  captureOwnerTransport,
  ensureOwnerTransportCursor,
  listPendingOwnerTransport,
  markOwnerTransportAdmitted,
  recordOwnerTransportHistoryPage,
} from "./owner-transport.js";

function capture(id: string, sentAtMs: number) {
  return {
    ownerId: "owner-1",
    channelId: "dm-channel-1",
    discordMessageId: id,
    text: id,
    attachments: [],
    sentAtMs,
    capturedAtMs: sentAtMs + 1,
  };
}

describe("Owner Discord transport continuity", () => {
  it("captures live transport facts idempotently and marks them admitted separately", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));

    const first = captureOwnerTransport(sidecar, nuclear, capture("100", 1_700_000_000_000), {
      nowMs: 1_700_000_000_010,
    });
    const duplicate = captureOwnerTransport(sidecar, nuclear, capture("100", 1_700_000_000_000), {
      nowMs: 1_700_000_000_020,
    });

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(listPendingOwnerTransport(sidecar, "owner-1")).toHaveLength(1);

    expect(markOwnerTransportAdmitted(sidecar, "owner-1", ["100"], {
      nowMs: 1_700_000_000_030,
    })).toEqual({ marked: 1, alreadyAdmitted: 0 });
    expect(markOwnerTransportAdmitted(sidecar, "owner-1", ["100"], {
      nowMs: 1_700_000_000_040,
    })).toEqual({ marked: 0, alreadyAdmitted: 1 });
    expect(listPendingOwnerTransport(sidecar, "owner-1")).toHaveLength(0);
  });

  it("reconciles a crash after canonical ingress before transport marking", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    captureOwnerTransport(sidecar, nuclear, capture("200", 1_700_000_001_000));
    admitCognitiveIngress(sidecar, nuclear, {
      userId: "owner-1",
      message: "canonical already exists",
      channel: "discord",
      inboundDiscordMessageIds: ["200"],
      finalFragmentReceivedAtMs: 1_700_000_001_100,
    }, { nowMs: 1_700_000_001_100 });

    expect(listPendingOwnerTransport(sidecar, "owner-1")).toHaveLength(0);
    expect(sidecar.prepare(
      "SELECT admitted_at_ms FROM owner_discord_transport_captures WHERE discord_message_id = ?",
    ).get("200")).toMatchObject({ admitted_at_ms: expect.any(Number) });
  });

  it("initializes history from a valid Discord boundary, ignoring non-transport evidence IDs", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    admitCognitiveIngress(sidecar, nuclear, {
      userId: "owner-1",
      message: "existing canonical evidence",
      channel: "discord",
      inboundDiscordMessageIds: [
        "phase-c-final-vision-valid-thread-20260928",
        "123456789012345678",
      ],
      finalFragmentReceivedAtMs: 1_700_000_002_000,
    }, { nowMs: 1_700_000_002_000 });

    expect(ensureOwnerTransportCursor(sidecar, nuclear, {
      ownerId: "owner-1",
      channelId: "dm-channel-1",
    }, { nowMs: 1_700_000_002_100 })).toMatchObject({
      initialized: true,
      afterMessageId: "123456789012345678",
    });
  });

  it("commits history captures and cursor movement as one transaction", () => {
    const sidecar = openTestSidecar();
    const nuclear = new DatabaseSync(":memory:");
    sidecar.prepare(
      `INSERT INTO owner_discord_transport_cursors
         (surface_key, owner_id, channel_id, guild_id, after_message_id, updated_at_ms)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run("owner-dm:owner-1:dm-channel-1", "owner-1", "dm-channel-1", "100", 1_700_000_000_000);

    const result = recordOwnerTransportHistoryPage(sidecar, nuclear, {
      surface: { ownerId: "owner-1", channelId: "dm-channel-1" },
      afterMessageId: "100",
      nextAfterMessageId: "102",
      captures: [capture("101", 1_700_000_000_100)],
    }, { nowMs: 1_700_000_000_200 });

    expect(result).toMatchObject({ afterMessageId: "102", newlyCaptured: 1, duplicates: 0 });
    expect((sidecar.prepare(
      "SELECT after_message_id FROM owner_discord_transport_cursors WHERE surface_key = ?",
    ).get("owner-dm:owner-1:dm-channel-1") as { after_message_id: string }).after_message_id).toBe("102");
    expect(listPendingOwnerTransport(sidecar, "owner-1")).toHaveLength(1);

    expect(() => recordOwnerTransportHistoryPage(sidecar, nuclear, {
      surface: { ownerId: "owner-1", channelId: "dm-channel-1" },
      afterMessageId: "100",
      nextAfterMessageId: "103",
      captures: [capture("103", 1_700_000_000_300)],
    }, { nowMs: 1_700_000_000_400 })).toThrow("owner_transport_cursor_conflict");
    expect(sidecar.prepare(
      "SELECT 1 FROM owner_discord_transport_captures WHERE discord_message_id = ?",
    ).get("103")).toBeUndefined();
  });
});
