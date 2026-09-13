import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { getState, patchState } from "./store.js";
import {
  applyOwnTimeTransitionForReactiveTurn,
  closeOwnTimeSession,
  getOpenOwnTimeSession,
  openOwnTimeSession,
} from "./own-time.js";

describe("own-time sessions", () => {
  it("opens at most one session and sets quiet/own_time atomically", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    const first = openOwnTimeSession(db, "doc", 1);
    const second = openOwnTimeSession(db, "doc", 2);
    expect(second.id).toBe(first.id);
    expect(
      db.prepare(
        "SELECT COUNT(*) AS c FROM own_time_sessions WHERE owner_id = ? AND ended_at IS NULL",
      ).get("doc"),
    ).toEqual({ c: 1 });
    expect(getState(db, "doc")).toMatchObject({
      availability: "quiet",
      focus: "own_time",
    });
    db.close();
  });

  it("closes session and clears focus before any caller Thought work", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    openOwnTimeSession(db, "doc", 1);
    const closed = closeOwnTimeSession(db, "doc", 9);
    expect(closed?.endedAt).toBeTruthy();
    expect(closed?.endMessageId).toBe(9);
    expect(getOpenOwnTimeSession(db, "doc")).toBeNull();
    expect(getState(db, "doc")).toMatchObject({
      availability: "available",
      focus: null,
    });
    db.close();
  });

  it("clears legacy sticky focus without fabricating a session interval", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    patchState(db, "doc", { availability: "available", focus: "own_time" });
    applyOwnTimeTransitionForReactiveTurn(db, "doc", {
      departureSignal: false,
      userMessageId: 3,
    });
    expect(getOpenOwnTimeSession(db, "doc")).toBeNull();
    expect(
      db.prepare("SELECT COUNT(*) AS c FROM own_time_sessions").get(),
    ).toEqual({ c: 0 });
    expect(getState(db, "doc")).toMatchObject({
      availability: "available",
      focus: null,
    });
    db.close();
  });

  it("opens an inferred session for legacy quiet+own_time on departure", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    patchState(db, "doc", { availability: "quiet", focus: "own_time" });
    applyOwnTimeTransitionForReactiveTurn(db, "doc", {
      departureSignal: true,
      userMessageId: 4,
    });
    const open = getOpenOwnTimeSession(db, "doc");
    expect(open).not.toBeNull();
    expect(open?.startMessageId).toBe(4);
    expect(getState(db, "doc")).toMatchObject({
      availability: "quiet",
      focus: "own_time",
    });
    db.close();
  });
});
