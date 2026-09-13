import { describe, expect, it } from "vitest";
import {
  fieldDayForInstant,
  fieldDayWindow,
  OBSERVATION_BOUNDARY,
  OBSERVATION_TIMEZONE,
} from "./field-day.js";

describe("Ashley field-day boundaries", () => {
  it("uses the explicit Europe/Istanbul 04:00 half-open window", () => {
    const window = fieldDayWindow("2026-08-26");
    expect(window.fieldDay).toBe("2026-08-26");
    expect(window.timezone).toBe(OBSERVATION_TIMEZONE);
    expect(window.boundary).toBe(OBSERVATION_BOUNDARY);
    expect(window.start.toISOString()).toBe("2026-08-26T01:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-08-27T01:00:00.000Z");
  });

  it("assigns immediately-before, exact, and immediately-after instants", () => {
    expect(fieldDayForInstant("2026-08-26T00:59:59.999Z")).toBe("2026-08-25");
    expect(fieldDayForInstant("2026-08-26T01:00:00.000Z")).toBe("2026-08-26");
    expect(fieldDayForInstant("2026-08-26T01:00:00.001Z")).toBe("2026-08-26");
  });

  it("rejects malformed field days and preserves explicit determinism", () => {
    expect(() => fieldDayWindow("2026-8-26")).toThrow(/field_day_invalid/);
    const first = fieldDayWindow("2026-12-31");
    const second = fieldDayWindow("2026-12-31");
    expect(second.start.getTime()).toBe(first.start.getTime());
    expect(second.end.getTime()).toBe(first.end.getTime());
  });
});
