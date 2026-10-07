import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar, setTestSidecarVersion } from "../test-support.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { openCognitiveSidecarDb } from "../sidecar/db.js";
import { buildThoughtInput } from "../thought/input.js";
import type { CapabilityReality, IdentitySlice } from "../types.js";
import {
  QUIET_DEFAULT_MS,
  endQuietOnOwnerMessage,
  holdQuietDraft,
  nextLocalEightMs,
  noteQuietSilentSent,
  openOwnerQuiet,
  quietFactsForPass,
  quietPublicationFor,
  quietUntilMs,
  readOpenQuietWindow,
  recordOwnerPresence,
  recordQuietRefusal,
  setOwnerDnd,
} from "./window.js";

const ZONE = "Etc/GMT-3";
const MORNING = Date.UTC(2026, 9, 7, 4, 0, 0);
const EVENING = Date.UTC(2026, 9, 7, 15, 0, 0);

const identity: IdentitySlice = { constitutional: ["truth first"], stableSelf: ["curious"] };
const capability: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: true, webSearch: false,
  canOfferProjectInspection: true, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: true, canOfferPatchExport: false,
  approvedProjectIds: ["project-ashley"],
};

function publication(db: ReturnType<typeof openTestSidecar>, triggerKind: string, nowMs = EVENING) {
  return quietPublicationFor(db, {
    nowMs,
    external: false,
    ownerPrivate: true,
    speechMode: "draft",
    triggerKind,
    interactionIntent: triggerKind === "idle_opportunity" ? "initiate" : null,
    draftText: "A note she wanted to send.",
  });
}

describe("quiet window", () => {
  it("migrates an older sidecar forward and adds the quiet tables", () => {
    const db = openTestSidecar();
    try {
      db.exec("DROP TABLE quiet_windows; DROP TABLE quiet_held_notes; DROP TABLE quiet_held_state; DROP TABLE quiet_refusals; DROP TABLE owner_presence_facts;");
      setTestSidecarVersion(db, 68);
      openCognitiveSidecarDb(db, { dataPlane: { kind: "isolated" } });
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 69 });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'quiet_windows'").get()).toEqual({ name: "quiet_windows" });
    } finally {
      db.close();
    }
  });

  it("defaults to two hours and never runs past the next local 08:00", () => {
    expect(nextLocalEightMs(MORNING, ZONE)).toBe(Date.UTC(2026, 9, 7, 5, 0, 0));
    expect(quietUntilMs(MORNING, undefined, ZONE)).toBe(Date.UTC(2026, 9, 7, 5, 0, 0));
    expect(quietUntilMs(EVENING, undefined, ZONE)).toBe(EVENING + QUIET_DEFAULT_MS);
    expect(quietUntilMs(EVENING, 30 * 60 * 1000, ZONE)).toBe(EVENING + 30 * 60 * 1000);
    expect(() => quietUntilMs(EVENING, QUIET_DEFAULT_MS * 7, ZONE)).toThrow("quiet_duration_invalid");

    const db = openTestSidecar();
    try {
      const opened = openOwnerQuiet(db, { nowMs: EVENING, timeZone: ZONE });
      expect(opened).toMatchObject({ source: "owner_command", untilMs: EVENING + QUIET_DEFAULT_MS, silentNotesSent: 0 });
      expect(readOpenQuietWindow(db, opened.untilMs)).toBeNull();
      expect(readOpenQuietWindow(db, opened.untilMs - 1)?.source).toBe("owner_command");
    } finally {
      db.close();
    }
  });

  it("ends on any admitted Owner message and does not renew an open DND window", () => {
    const db = openTestSidecar();
    try {
      openOwnerQuiet(db, { nowMs: EVENING, timeZone: ZONE });
      appendInboxEvent(db, {
        conversationId: "thread-1",
        kind: "owner_utterance",
        payload: { evidenceRowId: "evidence-1" },
        id: "inbox-quiet",
        createdAtMs: EVENING + 1000,
      });
      expect(readOpenQuietWindow(db, EVENING + 1000)).toBeNull();

      const dnd = setOwnerDnd(db, true, EVENING, ZONE);
      const again = setOwnerDnd(db, true, EVENING + 60_000, ZONE);
      expect(again).toEqual(dnd);
      openOwnerQuiet(db, { nowMs: EVENING, durationMs: 30 * 60 * 1000, timeZone: ZONE });
      expect(setOwnerDnd(db, false, EVENING + 1000, ZONE)?.source).toBe("owner_command");
      endQuietOnOwnerMessage(db);
      const onlyDnd = setOwnerDnd(db, true, EVENING, ZONE);
      expect(onlyDnd?.source).toBe("owner_dnd");
      expect(setOwnerDnd(db, false, EVENING + 1000, ZONE)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("sends two silent notes, then holds the next with a refusal the following pass sees", () => {
    const db = openTestSidecar();
    try {
      openOwnerQuiet(db, { nowMs: EVENING, timeZone: ZONE });
      expect(publication(db, "owner_message").kind).toBe("allow");
      expect(publication(db, "idle_opportunity").kind).toBe("silent");
      noteQuietSilentSent(db, EVENING);
      expect(publication(db, "future_trigger_due").kind).toBe("silent");
      noteQuietSilentSent(db, EVENING);
      const held = publication(db, "subscription_item");
      expect(held.kind).toBe("hold");
      if (held.kind !== "hold") return;
      holdQuietDraft(db, held.text, EVENING);
      recordQuietRefusal(db, EVENING);
      const first = quietFactsForPass(db, "cycle-next", EVENING);
      expect(first.quietRefusal).toEqual({ code: "quiet_held", atMs: EVENING });
      expect(quietFactsForPass(db, "cycle-next", EVENING).quietRefusal?.code).toBe("quiet_held");
      expect(quietFactsForPass(db, "cycle-later", EVENING).quietRefusal).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("shows the held pile once after expiry, newest first, with the dropped count", () => {
    const db = openTestSidecar();
    try {
      openOwnerQuiet(db, { nowMs: EVENING, timeZone: ZONE });
      for (let i = 0; i < 12; i += 1) holdQuietDraft(db, `note ${i} ${"x".repeat(400)}`, EVENING + i);
      db.prepare("UPDATE quiet_windows SET until_ms = ? WHERE id = 1").run(EVENING);
      const shown = quietFactsForPass(db, "cycle-after", EVENING + 20);
      expect(shown.heldWhileQuiet).toMatchObject({ count: 10, droppedCount: 2 });
      expect(shown.heldWhileQuiet?.items).toHaveLength(3);
      expect(shown.heldWhileQuiet?.items[0]?.startsWith("note 11")).toBe(true);
      expect(shown.heldWhileQuiet?.items[0]?.length).toBe(300);
      expect(quietFactsForPass(db, "cycle-after", EVENING + 20).heldWhileQuiet?.count).toBe(10);
      expect(quietFactsForPass(db, "cycle-once", EVENING + 20).heldWhileQuiet).toBeUndefined();

      const cycle = admitTestCycle(db, {
        conversationId: "thread-quiet",
        triggerKind: "idle_opportunity",
        triggerRef: "quiet-pile",
        occupantId: "doc",
        nowMs: EVENING,
      });
      holdQuietDraft(db, "one more after the show", EVENING + 30);
      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        triggerText: "",
        constitution: identity,
        capabilityReality: capability,
        workingContext: [],
        occupancy: [],
        learnedSelfSlice: { dispositions: [], interests: [] },
        clock: { nowMs: EVENING + 40 },
      });
      expect(input.heldWhileQuiet?.items[0]).toBe("one more after the show");
      expect(input.heldWhileQuiet?.droppedCount).toBe(3);
    } finally {
      db.close();
    }
  });

  it("stores an owner presence fact only when the opt-in is on", () => {
    const db = openTestSidecar();
    try {
      expect(recordOwnerPresence(db, { status: "online", sinceMs: EVENING }, false)).toBe(false);
      expect(quietFactsForPass(db, "cycle-presence", EVENING).ownerPresence).toBeUndefined();
      expect(recordOwnerPresence(db, { status: "online", sinceMs: EVENING }, true)).toBe(true);
      expect(recordOwnerPresence(db, { status: "dnd", sinceMs: EVENING }, true)).toBe(false);
      expect(quietFactsForPass(db, "cycle-presence", EVENING).ownerPresence).toEqual({ status: "online", sinceMs: EVENING });
    } finally {
      db.close();
    }
  });
});
