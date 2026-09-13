import { describe, expect, it } from "vitest";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import {
  classifyThoughtFailureCode,
  classifyThoughtTerminal,
  emitInfrastructureNotice,
  formatThoughtFailureNotice,
  getSystemNotice,
  listSystemNotices,
  makeThoughtTerminal,
  THOUGHT_UNAVAILABLE_NOTICE,
} from "./infrastructure-notice.js";

describe("v0.2.1 Thought outage notices", () => {
  it.each([
    ["rate_limited", "RATE_LIMITED"],
    ["provider_unavailable", "PROVIDER_UNAVAILABLE"],
    ["structured_output_untrusted", "STRUCTURED_OUTPUT_INVALID"],
  ])("projects %s into the bounded user-facing code %s", (failureCode, expectedCode) => {
    expect(formatThoughtFailureNotice({ reason: "unavailable", failureCode }))
      .toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: ${expectedCode}`);
  });

  it("projects deadline and unknown causes without parsing prose or status-looking text", () => {
    expect(formatThoughtFailureNotice({ reason: "thought_deadline" }))
      .toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_DEADLINE_EXCEEDED`);
    expect(formatThoughtFailureNotice({ reason: "unavailable", failureCode: "provider prose 503 sk-live-secret" }))
      .toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN`);
  });

  it("projects an existing provider failure class into a bounded user-facing code", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-provider-unavailable", conversationId: "thread-provider-unavailable", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const notice = emitInfrastructureNotice(db, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-provider-unavailable",
        conversationId: "thread-provider-unavailable",
        cycleId: "cycle-provider-unavailable",
        generation: 1,
        reason: "unavailable",
        failureCode: "provider_unavailable",
      });
      expect(notice.noticeText).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: PROVIDER_UNAVAILABLE`);
    } finally {
      db.close();
    }
  });

  it("persists routing, ledger unavailability, and one notice per failure key", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-notice", conversationId: "thread-notice", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const first = emitInfrastructureNotice(db, { ownerId: "doc", channel: "discord", threadId: "thread-notice", conversationId: "thread-notice", cycleId: "cycle-notice", generation: 1, reason: "unavailable" });
      const second = emitInfrastructureNotice(db, { ownerId: "doc", channel: "discord", threadId: "thread-notice", conversationId: "thread-notice", cycleId: "cycle-notice", generation: 1, reason: "unavailable" });
      expect(second.noticeId).toBe(first.noticeId);
      expect(first.noticeText).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN`);
      expect(first.deliveryIntent).toMatchObject({ ownerId: "doc", channel: "discord", threadId: "thread-notice", purpose: "system_notice" });
      expect(listSystemNotices(db)).toHaveLength(1);
      expect(getSystemNotice(db, first.noticeId)?.noticeText).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: UNKNOWN`);
      expect(db.prepare("SELECT thought_unavailable FROM causal_ledger WHERE cycle_id = ? AND generation = ?").get("cycle-notice", 1)).toMatchObject({ thought_unavailable: 1 });
    } finally {
      db.close();
    }
  });

  it("marks an existing ledger unavailable without erasing causal fields", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-ledger", conversationId: "thread-ledger", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      db.prepare("INSERT INTO causal_ledger (cycle_id, generation, payload_json, thought_unavailable) VALUES (?, ?, ?, 0)")
        .run("cycle-ledger", 1, JSON.stringify({ settlementId: "settlement-existing", authorityCodes: ["authority_kept"] }));
      emitInfrastructureNotice(db, { ownerId: "doc", channel: "discord", threadId: "thread-ledger", conversationId: "thread-ledger", cycleId: "cycle-ledger", generation: 1, reason: "unavailable" });
      const row = db.prepare("SELECT payload_json, thought_unavailable FROM causal_ledger WHERE cycle_id = ? AND generation = ?").get("cycle-ledger", 1) as { payload_json: string; thought_unavailable: number };
      expect(JSON.parse(row.payload_json)).toMatchObject({ settlementId: "settlement-existing", authorityCodes: ["authority_kept"], thoughtUnavailable: true });
      expect(row.thought_unavailable).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("FAILURE-TRUTH-COMPLETENESS-01 terminal classification", () => {
  it.each([
    ["UNWITNESSED_HIGH_RISK_CLAIM", "SPEECH_FIDELITY_REJECTED"],
    ["DRAFT_COMMITMENT_CONFLICT", "SPEECH_FIDELITY_REJECTED"],
    ["DRAFT_REQUIRED", "SPEECH_FIDELITY_REJECTED"],
    ["NONE_SURFACE_FORBIDDEN", "SPEECH_FIDELITY_REJECTED"],
    ["MUST_SAY_MISSING", "SPEECH_FIDELITY_REJECTED"],
    ["MUST_NOT_PRESENT", "SPEECH_FIDELITY_REJECTED"],
    ["EMPTY_COMMITMENTS_WITH_DRAFT", "SPEECH_FIDELITY_REJECTED"],
    ["pass_exhausted", "THOUGHT_BUDGET_EXHAUSTED"],
    ["revision_exhausted", "THOUGHT_BUDGET_EXHAUSTED"],
    ["observation_unavailable", "OPERATION_DISPATCH_FAILED"],
    ["effect_unavailable", "OPERATION_DISPATCH_FAILED"],
    ["authority_rejected", "AUTHORITY_REJECTED"],
    ["effect_not_authorized", "AUTHORITY_REJECTED"],
    ["publication_rejected_diagnostic_persistence_failed", "PUBLICATION_PERSISTENCE_FAILED"],
    ["structural_correction_scope_violation", "STRUCTURED_OUTPUT_INVALID"],
  ])("legacy reason %s maps to %s (never silent UNKNOWN)", (reason, expected) => {
    expect(classifyThoughtFailureCode({ reason })).toBe(expected);
    expect(formatThoughtFailureNotice({ reason }))
      .toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: ${expected}`);
  });

  it("maps single malformed without proven exhaustion to invalid, not retry-exhausted", () => {
    expect(classifyThoughtFailureCode({ reason: "malformed" })).toBe("STRUCTURED_OUTPUT_INVALID");
  });

  it("maps proven structural exhaustion via the typed family to retry-exhausted", () => {
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("structural_exhausted", { codes: ["malformed", "alias_duplicate"], stage: "parser" }),
    )).toBe("STRUCTURAL_RETRY_EXHAUSTED");
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("structural_invalid", { codes: ["malformed"], stage: "settlement_validation" }),
    )).toBe("STRUCTURED_OUTPUT_INVALID");
  });

  it("gives the proven local deadline precedence over incidental provider detail", () => {
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("thought_deadline", {
        codes: ["thought_deadline"],
        stage: "provider_dispatch",
        providerFailureClass: "provider_unavailable",
      }),
    )).toBe("THOUGHT_DEADLINE_EXCEEDED");
    expect(classifyThoughtFailureCode({ reason: "thought_deadline", failureCode: "provider_unavailable" }))
      .toBe("THOUGHT_DEADLINE_EXCEEDED");
  });

  it("keeps genuine provider unavailable distinct from the local deadline", () => {
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("provider", {
        codes: ["provider_unavailable"],
        stage: "provider_dispatch",
        providerFailureClass: "provider_unavailable",
      }),
    )).toBe("PROVIDER_UNAVAILABLE");
  });

  it("maps multi-code authority joins to authority without comma-permutation dependence", () => {
    const forward = classifyThoughtFailureCode({ reason: "RECEIPT_REQUIRED,IN_FLIGHT_UNKNOWN" });
    const reversed = classifyThoughtFailureCode({ reason: "IN_FLIGHT_UNKNOWN,RECEIPT_REQUIRED" });
    expect(forward).toBe("AUTHORITY_REJECTED");
    expect(reversed).toBe("AUTHORITY_REJECTED");
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("authority", { codes: ["RECEIPT_REQUIRED", "IN_FLIGHT_UNKNOWN"], stage: "authority_proposal" }),
    )).toBe("AUTHORITY_REJECTED");
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("authority", { codes: ["IN_FLIGHT_UNKNOWN", "RECEIPT_REQUIRED"], stage: "authority_proposal" }),
    )).toBe("AUTHORITY_REJECTED");
  });

  it("keeps a known authority family known with an unfamiliar child retained", () => {
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("authority", {
        codes: ["RECEIPT_REQUIRED", "FUTURE_CODE_WE_HAVE_NEVER_SEEN"],
        stage: "authority_settlement",
      }),
    )).toBe("AUTHORITY_REJECTED");
  });

  it("maps empty child lists with a proven parent family to the parent code", () => {
    expect(classifyThoughtTerminal(makeThoughtTerminal("authority", { stage: "authority_proposal" })))
      .toBe("AUTHORITY_REJECTED");
    expect(classifyThoughtTerminal(makeThoughtTerminal("budget_exhausted", { stage: "cycle_budget" })))
      .toBe("THOUGHT_BUDGET_EXHAUSTED");
  });

  it("reserves UNKNOWN for foreign failures and missing causes", () => {
    expect(classifyThoughtFailureCode({ reason: "some_future_weird_failure_xyz" })).toBe("UNKNOWN");
    expect(classifyThoughtFailureCode({ reason: "unavailable" })).toBe("UNKNOWN");
    expect(classifyThoughtTerminal(makeThoughtTerminal("foreign", { codes: ["weird"], stage: "unknown" })))
      .toBe("UNKNOWN");
    expect(classifyThoughtTerminal(
      makeThoughtTerminal("provider", { stage: "provider_dispatch" }),
    )).toBe("UNKNOWN");
  });

  it("does not parse foreign provider prose into trusted classification", () => {
    expect(classifyThoughtFailureCode({ reason: "unavailable", failureCode: "provider prose 503 sk-live-secret" }))
      .toBe("UNKNOWN");
  });

  it("keeps notice identity independent of typed diagnostic child codes", () => {
    // Same conversation/cycle/generation/reason but meaningfully different
    // child-code sets (and stages) must deduplicate to the SAME notice.
    // Typed diagnostic detail classifies presentation only and must never
    // split one logical notice into multiple notices.
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-dedup", conversationId: "thread-dedup", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const base = {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-dedup",
        conversationId: "thread-dedup",
        cycleId: "cycle-dedup",
        generation: 1,
        reason: "authority_rejected",
      } as const;
      const first = emitInfrastructureNotice(db, {
        ...base,
        terminal: makeThoughtTerminal("authority", {
          codes: ["RECEIPT_REQUIRED"],
          stage: "authority_proposal",
        }),
      });
      const second = emitInfrastructureNotice(db, {
        ...base,
        terminal: makeThoughtTerminal("authority", {
          codes: ["EFFECT_NOT_AUTHORIZED", "FUTURE_CODE_WE_HAVE_NEVER_SEEN"],
          stage: "authority_settlement",
        }),
      });
      expect(first.noticeKey).toBe("thought_failure:thread-dedup:cycle-dedup:1:authority_rejected");
      expect(second.noticeId).toBe(first.noticeId);
      expect(second.noticeKey).toBe(first.noticeKey);
      expect(first.noticeText).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: AUTHORITY_REJECTED`);
      expect(second.noticeText).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: AUTHORITY_REJECTED`);
      expect(listSystemNotices(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("mirrors the bounded typed terminal diagnostic in the causal ledger without touching notice identity", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-diagnostic", conversationId: "thread-diagnostic", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      const notice = emitInfrastructureNotice(db, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-diagnostic",
        conversationId: "thread-diagnostic",
        cycleId: "cycle-diagnostic",
        generation: 1,
        reason: "thought_deadline",
        terminal: makeThoughtTerminal("thought_deadline", {
          codes: ["thought_deadline"],
          stage: "provider_dispatch",
          providerFailureClass: "provider_unavailable",
        }),
      });
      expect(notice.noticeKey).toBe("thought_failure:thread-diagnostic:cycle-diagnostic:1:thought_deadline");
      expect(notice.noticeText).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: THOUGHT_DEADLINE_EXCEEDED`);
      const payload = JSON.parse(
        (db.prepare("SELECT payload_json FROM causal_ledger WHERE cycle_id = ? AND generation = ?").get("cycle-diagnostic", 1) as { payload_json: string }).payload_json,
      ) as Record<string, unknown>;
      expect(payload).toMatchObject({
        thoughtUnavailable: true,
        thoughtTerminal: {
          family: "thought_deadline",
          codes: ["thought_deadline"],
          stage: "provider_dispatch",
          providerFailureClass: "provider_unavailable",
        },
      });
      // A repeat for the same key deduplicates to the same notice.
      const again = emitInfrastructureNotice(db, {
        ownerId: "doc",
        channel: "discord",
        threadId: "thread-diagnostic",
        conversationId: "thread-diagnostic",
        cycleId: "cycle-diagnostic",
        generation: 1,
        reason: "thought_deadline",
      });
      expect(again.noticeId).toBe(notice.noticeId);
      expect(listSystemNotices(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("emits fidelity terminals under the single public umbrella", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, { cycleId: "cycle-fidelity", conversationId: "thread-fidelity", triggerKind: "owner_message", occupantId: "doc", nowMs: 1 });
      for (const code of ["UNWITNESSED_HIGH_RISK_CLAIM", "DRAFT_COMMITMENT_CONFLICT"] as const) {
        const notice = emitInfrastructureNotice(db, {
          ownerId: "doc",
          channel: "discord",
          threadId: "thread-fidelity",
          conversationId: "thread-fidelity",
          cycleId: `cycle-fidelity-${code}`,
          generation: 1,
          reason: code,
          terminal: makeThoughtTerminal("fidelity", { codes: [code], stage: "fidelity" }),
        });
        expect(notice.noticeText).toBe(`${THOUGHT_UNAVAILABLE_NOTICE} Error code: SPEECH_FIDELITY_REJECTED`);
      }
    } finally {
      db.close();
    }
  });
});
