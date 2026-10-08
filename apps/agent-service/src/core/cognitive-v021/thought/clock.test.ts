import { describe, expect, it } from "vitest";
import { buildThoughtClock, humanDuration } from "./clock.js";
import type { ConversationEvidenceRecord } from "../types.js";

// 2026-09-29T14:52:00Z is 17:52 on a Tuesday at UTC+3.
const NOW = Date.UTC(2026, 8, 29, 14, 52);

function row(rowId: string, role: "owner" | "ashley", createdAtMs: number): ConversationEvidenceRecord {
  return { rowId, role, createdAtMs } as ConversationEvidenceRecord;
}

describe("Thought clock", () => {
  it("gives local wall time, weekday, and zone in UTC+3 by default", () => {
    const clock = buildThoughtClock({ nowMs: NOW, rows: [] });
    expect(clock.now).toBe("Tuesday 29 September 2026, 17:52");
    expect(clock.timeZone).toBe("UTC+03:00");
    expect(clock.partOfDay).toBe("afternoon");
    expect(clock.ownerPreviousMessage).toBeUndefined();
  });

  it("measures since the Owner's previous message, not the one being answered", () => {
    const clock = buildThoughtClock({
      nowMs: NOW,
      rows: [
        row("owner-yesterday", "owner", NOW - 26 * 3_600_000),
        row("ashley-yesterday", "ashley", NOW - 25 * 3_600_000 - 30 * 60_000),
        row("owner-now", "owner", NOW - 2_000),
      ],
      currentRowIds: new Set(["owner-now"]),
    });
    expect(clock.ownerPreviousMessage).toEqual({ at: "Monday 28 September 2026, 15:52", ago: "1 day 2 hours" });
    expect(clock.ashleyLastMessage?.ago).toBe("1 day 1 hour");
  });

  it("honours a configured IANA zone", () => {
    const clock = buildThoughtClock({ nowMs: NOW, timeZone: "UTC", rows: [] });
    expect(clock.now).toBe("Tuesday 29 September 2026, 14:52");
    expect(clock.timeZone).toBe("UTC+00:00");
  });

  it("speaks durations coarsely", () => {
    expect(humanDuration(30_000)).toBe("less than a minute");
    expect(humanDuration(61_000)).toBe("1 minute");
    expect(humanDuration(3 * 86_400_000 + 5 * 3_600_000 + 7 * 60_000)).toBe("3 days 5 hours");
  });

  it("gives a room only part of day and elapsed time, with no wall time, zone or offset", () => {
    const clock = buildThoughtClock({
      nowMs: NOW,
      timeZone: "Etc/GMT-3",
      rows: [row("o1", "owner", NOW - 3_600_000), row("a1", "ashley", NOW - 7_200_000)],
      coarse: true,
    });
    expect(clock.partOfDay).toBe("afternoon");
    expect(clock.now).toBeUndefined();
    expect(clock.timeZone).toBeUndefined();
    expect(clock.ownerPreviousMessage).toEqual({ ago: "1 hour" });
    expect(clock.ashleyLastMessage).toEqual({ ago: "2 hours" });
    expect(JSON.stringify(clock)).not.toMatch(/UTC|17:52|Tuesday/);
  });
});
