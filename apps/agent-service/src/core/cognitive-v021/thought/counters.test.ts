import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import {
  getThoughtAttemptCounters,
  seedThoughtAttemptCountersEffectRounds,
} from "./counters.js";

describe("completion-cycle effect round inheritance", () => {
  it("seeds a new completion once and never resets its persisted rounds on another wake", () => {
    const db = openTestSidecar();
    try {
      expect(seedThoughtAttemptCountersEffectRounds(db, "cycle-completion", 2, 2)).toBe(true);
      expect(getThoughtAttemptCounters(db, "cycle-completion", 2).effectRounds).toBe(2);

      expect(seedThoughtAttemptCountersEffectRounds(db, "cycle-completion", 2, 4)).toBe(false);
      expect(getThoughtAttemptCounters(db, "cycle-completion", 2).effectRounds).toBe(2);
    } finally {
      db.close();
    }
  });
});
