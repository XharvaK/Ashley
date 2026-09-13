import { describe, expect, it } from "vitest";
import { OccupantCalibrationStore } from "./occupant.js";

describe("v0.2.1 occupant calibration", () => {
  it("clears occupant notes on swap without representing identity", () => {
    const store = new OccupantCalibrationStore("doc");
    store.addNote("keep answers compact");
    expect(store.get()).toEqual({ occupantId: "doc", notes: ["keep answers compact"] });
    expect(store.swap("other")).toEqual({ occupantId: "other", notes: [] });
    store.addNote("use more detail");
    expect(store.swap("doc")).toEqual({ occupantId: "doc", notes: [] });
  });
});
