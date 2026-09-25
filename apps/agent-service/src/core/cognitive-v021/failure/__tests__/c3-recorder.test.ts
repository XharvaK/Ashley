import { describe, expect, it, vi } from "vitest";
import { openTestSidecar } from "../../test-support.js";
import {
  buildRetryC3TerminalFailure,
  listC3TerminalExperiences,
  recordC3TerminalExperience,
  safeRecordC3TerminalExperience,
} from "../c3-recorder.js";
import type { C3TerminalExperienceRecord } from "../types.js";

function experience(overrides: Partial<C3TerminalExperienceRecord> = {}): C3TerminalExperienceRecord {
  return {
    experienceId: "c3:thought:notice:1",
    obligationFrontierId: null,
    cycleId: "cycle:1",
    generation: 1,
    attemptId: null,
    attemptLineageJson: null,
    terminalPhase: "thought",
    failureClass: "unavailable",
    terminalDisposition: "terminal",
    publicationState: "published",
    externalEffectTruth: "not_attempted",
    receiptRef: null,
    unresolvedState: 0,
    rawEvidenceRefsJson: JSON.stringify([
      { kind: "system_notice_outbox", id: "1" },
      { kind: "cycle_records", id: "cycle:1" },
    ]),
    noticeId: "1",
    occurredAtMs: 100,
    sourceDomainOwner: "thought",
    sourceCurrentnessRef: "cycle:1:1",
    redacted: 0,
    ...overrides,
  };
}

describe("C3 terminal experience recorder", () => {
  it("stores structured mechanical fields without notice prose or subjective fields", () => {
    const db = openTestSidecar();
    try {
      const stored = recordC3TerminalExperience(db, experience());
      expect(stored).toMatchObject({
        experienceId: "c3:thought:notice:1",
        failureClass: "unavailable",
        terminalDisposition: "terminal",
        externalEffectTruth: "not_attempted",
      });
      expect(listC3TerminalExperiences(db)).toHaveLength(1);
      const columns = (db.prepare("PRAGMA table_info(c3_terminal_experiences)").all() as Array<{ name: string }>).map((column) => column.name);
      expect(columns).not.toContain("notice_text");
      expect(columns).not.toContain("felt_meaning");
    } finally {
      db.close();
    }
  });

  it("is INSERT OR IGNORE idempotent and rejects excluded terminal classes", () => {
    const db = openTestSidecar();
    try {
      const first = recordC3TerminalExperience(db, experience());
      const second = recordC3TerminalExperience(db, experience());
      expect(first).toEqual(second);
      expect(db.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 1 });
      expect(recordC3TerminalExperience(db, experience({
        experienceId: "c3:unknown",
        failureClass: "outcome_unknown",
      }))).toBeNull();
      expect(recordC3TerminalExperience(db, experience({
        experienceId: "c3:cancelled",
        failureClass: "cancelled",
      }))).toBeNull();
      expect(db.prepare("SELECT COUNT(*) AS count FROM c3_terminal_experiences").get()).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("writes effect_unknown for ambiguous dispatch and keeps the legacy alias readable", () => {
    const retry = buildRetryC3TerminalFailure({
      eventId: "event-unknown-effect",
      attemptId: "attempt-unknown-effect",
      wakeId: "wake-unknown-effect",
      cycleId: "cycle-unknown-effect",
      generation: 1,
      ordinal: 2,
      dispatchTruth: "dispatch_started",
      failureClass: "age_exhausted",
      errorCode: null,
      occurredAtMs: 200,
    });
    expect(retry?.externalEffectTruth).toBe("effect_unknown");

    const db = openTestSidecar();
    try {
      const legacy = recordC3TerminalExperience(db, experience({
        experienceId: "c3:legacy-effect-truth",
        externalEffectTruth: "effect_indeterminate",
      }));
      expect(legacy?.externalEffectTruth).toBe("effect_indeterminate");
    } finally {
      db.close();
    }
  });

  it("fails soft when the derived write is unavailable", () => {
    const db = openTestSidecar();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      db.exec(
        `CREATE TRIGGER c3_write_failure
           BEFORE INSERT ON c3_terminal_experiences
           BEGIN SELECT RAISE(ABORT, 'c3_write_failure'); END`,
      );
      expect(safeRecordC3TerminalExperience(db, experience())).toBeNull();
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("c3_write_deferred_for_forward_repair"),
        expect.anything(),
      );
    } finally {
      warning.mockRestore();
      db.close();
    }
  });
});
