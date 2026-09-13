import { describe, expect, it } from "vitest";
import {
  C3_ALLOWLISTED_TERMINAL_CLASSES,
  isC3AllowlistedTerminalClass,
} from "../c3-recorder.js";

describe("D7 C3 failure-class boundary", () => {
  it("allows only source-proven terminal reasons", () => {
    expect(C3_ALLOWLISTED_TERMINAL_CLASSES).toEqual(expect.arrayContaining([
      "unavailable",
      "malformed",
      "revision_exhausted",
      "authority_rejected",
      "context_allocation_required_overflow",
      "permanent_terminal",
      "age_exhausted",
      "attempts_exhausted",
      "capacity_wait_max_duration_exceeded",
      "delivery_aborted",
      "delivery_expired",
      "delivery_partially_delivered",
    ]));
    for (const excluded of [
      "capacity_wait",
      "compose_cancelled",
      "superseded",
      "outcome_unknown",
      "quarantined",
      "non_forward_scheduling_hint",
      "publication_failed",
      "cancelled",
      "stale",
      "retry_wait",
      "notice_only",
      "invariant_failure",
      "unknown",
      "temporary",
      "unpublished",
    ]) {
      expect(isC3AllowlistedTerminalClass(excluded)).toBe(false);
    }
  });
});
