import { afterEach, describe, expect, it } from "vitest";
import {
  beginCurrentActivity,
  clearCurrentActivity,
  endCurrentActivity,
  getCurrentActivity,
} from "./current-activity.js";

afterEach(() => {
  clearCurrentActivity();
});

describe("current activity lifecycle", () => {
  it("starts as none and only an explicit begin is current", () => {
    expect(getCurrentActivity()).toEqual({ state: "none" });
    beginCurrentActivity({
      state: "active",
      kind: "reading",
      id: "read:1",
      title: "The Left Hand of Darkness",
      startedAt: "2026-08-26T00:00:00.000Z",
    });
    expect(getCurrentActivity()).toMatchObject({
      state: "active",
      kind: "reading",
      id: "read:1",
      title: "The Left Hand of Darkness",
    });
  });

  it("clears on matching completion and ignores a stale older completion", () => {
    beginCurrentActivity({
      state: "active",
      kind: "reading",
      id: "read:1",
      title: "Old",
      startedAt: "2026-08-26T00:00:00.000Z",
    });
    beginCurrentActivity({
      state: "active",
      kind: "reading",
      id: "read:2",
      title: "New",
      startedAt: "2026-08-26T00:01:00.000Z",
    });
    endCurrentActivity("read:1");
    expect(getCurrentActivity()).toMatchObject({
      state: "active",
      id: "read:2",
      title: "New",
    });
    endCurrentActivity("read:2");
    expect(getCurrentActivity()).toEqual({ state: "none" });
  });

  it("restart-style clear drops in-flight activity without persistence", () => {
    beginCurrentActivity({
      state: "active",
      kind: "reading",
      id: "read:9",
      title: "Should not survive restart",
      startedAt: "2026-08-26T00:00:00.000Z",
    });
    clearCurrentActivity();
    expect(getCurrentActivity()).toEqual({ state: "none" });
  });
});
