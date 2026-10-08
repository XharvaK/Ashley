import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Client, DMChannel } from "discord.js";
import type { DomusSnapshot, DomusSnapshotResult } from "../agent-client.js";
import { config } from "../config.js";
import { ownerDmOf, runSnapshots, type SnapshotDeps } from "./snapshot-pump.js";

type Sent = { content: string; files: Array<{ attachment: Buffer; name: string }> };
type Report = [string, DomusSnapshotResult];

const PICTURE = Buffer.from("invented picture bytes");

function snap(snapshotId: string, caption: string): DomusSnapshot {
  return { snapshotId, caption, pngBase64: PICTURE.toString("base64") };
}

/** A fake Owner DM: the Nth send (1-based) fails when failOn is set; the rest are recorded. */
function fakeDm(failOn?: number) {
  const sent: Sent[] = [];
  let attempts = 0;
  const dm = {
    id: "dm-1",
    send: async (payload: Sent) => {
      attempts += 1;
      if (attempts === failOn) throw new Error("Cannot send messages to this user");
      sent.push(payload);
      return { id: `msg-${sent.length}` };
    },
  };
  return { dm: dm as unknown as DMChannel, sent };
}

function deps(snapshots: DomusSnapshot[], dm: DMChannel, reports: Report[]): SnapshotDeps {
  return {
    ownerDm: async () => dm,
    claim: async () => ({ snapshots }),
    report: async (snapshotId, result) => {
      reports.push([snapshotId, result]);
    },
  };
}

describe("Snapshot pump: her pictures in the Owner's DM", () => {
  it("sends the caption with one house.png and reports sent with the message id", async () => {
    const { dm, sent } = fakeDm();
    const reports: Report[] = [];
    assert.equal(await runSnapshots(deps([snap("snap-1", "The kitchen looks warm tonight.")], dm, reports)), 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.content, "The kitchen looks warm tonight.");
    assert.equal(sent[0]!.files.length, 1);
    assert.equal(sent[0]!.files[0]!.name, "house.png");
    assert.ok(Buffer.isBuffer(sent[0]!.files[0]!.attachment));
    assert.deepEqual(sent[0]!.files[0]!.attachment, PICTURE);
    assert.deepEqual(reports, [["snap-1", { status: "sent", discordMessageId: "msg-1" }]]);
  });

  it("a Discord error reports failed with discord_error, and the next picture still goes", async () => {
    const { dm, sent } = fakeDm(1);
    const reports: Report[] = [];
    assert.equal(await runSnapshots(deps([snap("snap-1", "First."), snap("snap-2", "Second.")], dm, reports)), 2);
    assert.deepEqual(reports, [
      ["snap-1", { status: "failed", reason: "discord_error" }],
      ["snap-2", { status: "sent", discordMessageId: "msg-1" }],
    ]);
    assert.deepEqual(sent.map((message) => message.content), ["Second."]);
  });

  it("an empty claim sends nothing and reports nothing", async () => {
    const { dm, sent } = fakeDm();
    const reports: Report[] = [];
    let opened = 0;
    const base = deps([], dm, reports);
    assert.equal(await runSnapshots({ ...base, ownerDm: async () => { opened += 1; return dm; } }), 0);
    assert.equal(sent.length, 0);
    assert.equal(reports.length, 0);
    assert.equal(opened, 0);
  });

  it("a failed report does not stop the next picture", async () => {
    const { dm, sent } = fakeDm();
    const reports: Report[] = [];
    const base = deps([snap("snap-1", "One."), snap("snap-2", "Two.")], dm, reports);
    const flaky: SnapshotDeps = {
      ...base,
      report: async (snapshotId, result) => {
        if (snapshotId === "snap-1") throw new Error("agent unavailable");
        reports.push([snapshotId, result]);
      },
    };
    assert.equal(await runSnapshots(flaky), 2);
    assert.deepEqual(sent.map((message) => message.content), ["One.", "Two."]);
    assert.deepEqual(reports, [["snap-2", { status: "sent", discordMessageId: "msg-2" }]]);
  });

  it("the Owner's DM is the only destination, opened once and reused", async () => {
    const fetched: string[] = [];
    const created: Array<{ id: string }> = [];
    const client = {
      users: {
        fetch: async (id: string) => {
          fetched.push(id);
          return { createDM: async () => { const dm = { id: "dm-owner" }; created.push(dm); return dm; } };
        },
      },
    } as unknown as Client;
    const dmOf = ownerDmOf(client);
    assert.equal((await dmOf() as unknown as { id: string }).id, "dm-owner");
    await dmOf();
    assert.deepEqual(fetched, [config.ownerId]);
    assert.equal(created.length, 1);
  });
});
