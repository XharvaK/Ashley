import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import {
  recordEffectDiagnostic,
  resolveEffectDiagnosticRef,
  updateEffectDiagnosticSupervision,
} from "./diagnostics.js";

describe("effect diagnostics", () => {
  it("binds reads to the exact conversation and audience and updates supervision in place", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-effect-diagnostic-scope",
        conversationId: "conversation-effect-diagnostic-scope",
        triggerKind: "owner_message",
        triggerRef: "owner-effect-diagnostic-scope",
        nowMs: 100,
      });
      const row = recordEffectDiagnostic(db, {
        effectId: "effect-diagnostic-scope",
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        audienceScope: { kind: "owner_private" },
        dataClassification: "never_public",
        secretOmitted: true,
        diagnostic: { completionBindingId: "effect-diagnostic-scope" },
        atMs: 101,
      });

      expect(resolveEffectDiagnosticRef(db, row.diagnosticId, cycle.conversationId, { kind: "owner_private" }))
        .toMatchObject({ diagnosticId: row.diagnosticId });
      expect(resolveEffectDiagnosticRef(db, row.diagnosticId, "another-conversation", { kind: "owner_private" })).toBeNull();
      expect(resolveEffectDiagnosticRef(db, row.diagnosticId, cycle.conversationId, { kind: "room", roomId: "room-1" })).toBeNull();
      expect(resolveEffectDiagnosticRef(db, row.diagnosticId, cycle.conversationId, null)).toBeNull();
      expect(() => recordEffectDiagnostic(db, {
        effectId: row.effectId,
        conversationId: "another-conversation",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        audienceScope: { kind: "owner_private" },
        dataClassification: "never_public",
        secretOmitted: true,
        diagnostic: { marker: "must not rebind" },
        atMs: 102,
      })).toThrow("effect_diagnostic_binding_conflict");

      expect(updateEffectDiagnosticSupervision(db, row.effectId, {
        initialDeadlineAtMs: 10_000,
        renewalCount: 720,
        firstSuccessfulRenewalAtMs: 130,
        lastSuccessfulRenewalAtMs: 21_700,
        maxObservedGapMs: 30_000,
        fenceOrAbortReason: null,
      })).toBe(true);
      const stored = db.prepare("SELECT diagnostic_json FROM effect_diagnostics WHERE effect_id = ?")
        .get(row.effectId) as { diagnostic_json: string };
      expect(JSON.parse(stored.diagnostic_json)).toMatchObject({
        supervision: { renewalCount: 720, maxObservedGapMs: 30_000 },
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM effect_diagnostics WHERE effect_id = ?")
        .get(row.effectId)).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("does not resolve secret-classified rows", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-effect-diagnostic-secret",
        conversationId: "conversation-effect-diagnostic-secret",
        triggerKind: "owner_message",
        triggerRef: "owner-effect-diagnostic-secret",
        nowMs: 200,
      });
      const row = recordEffectDiagnostic(db, {
        effectId: "effect-diagnostic-secret",
        conversationId: cycle.conversationId,
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        audienceScope: { kind: "owner_private" },
        dataClassification: "secret",
        secretOmitted: false,
        diagnostic: { marker: "secret" },
        atMs: 201,
      });

      expect(resolveEffectDiagnosticRef(db, row.diagnosticId, cycle.conversationId, { kind: "owner_private" })).toBeNull();
    } finally {
      db.close();
    }
  });
});
