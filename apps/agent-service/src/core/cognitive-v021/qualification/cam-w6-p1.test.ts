import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import {
  grantSocialOperationDelegation,
  recheckSocialOperationDelegation,
  revokeSocialOperationDelegation,
  socialOperationClassForOperation,
} from "../../relationship/social-authority.js";
import { claimConversationCognition } from "../cycle/cognition-claim.js";
import { superviseEffectExecution } from "../dispatch/effect-supervision.js";
import {
  getInFlightByIdempotencyKey,
  putInFlight,
} from "../effect/in-flight.js";
import { createEffectProposal, dispatchEffect } from "../effect/proposal.js";
import { recoverInFlight } from "../effect/recovery.js";
import { buildThoughtInput } from "../thought/input.js";
import type { CapabilityReality, IdentitySlice } from "../types.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { startDurableAttempt } from "../retry/ledger.js";

const BASE = 1_800_000_000_000;
const OWNER_ID = "owner-w6";
const PRINCIPAL_ID = "participant-w6";
const CONVERSATION_ID = "conversation-w6";
const capabilityReality: CapabilityReality = {
  vision: false,
  attachmentText: false,
  conversationalRead: false,
  webSearch: false,
  canOfferProjectInspection: false,
  canOfferWorkspace: false,
  canOfferVerification: false,
  canOfferAuthorship: false,
  canOfferBoundedOperation: false,
  canOfferInquiry: false,
  canOfferPatchExport: false,
  approvedProjectIds: [],
};
const constitution: IdentitySlice = {
  constitutional: ["truth first"],
  stableSelf: [],
};

function effectFixture() {
  const db = openTestSidecar();
  const cycle = admitTestCycle(db, {
    cycleId: "cycle-w6-supervision",
    conversationId: "conversation-w6-supervision",
    triggerKind: "owner_message",
    triggerRef: "event-w6-supervision",
    occupantId: "doc",
    nowMs: BASE,
  });
  const attempt = startDurableAttempt(db, {
    eventId: "event-w6-supervision",
    workerId: "worker-w6-supervision",
    nowMs: BASE,
  });
  const wakeId = cycle.wakeId ?? attempt.wakeId;
  if (!wakeId) throw new Error("w6_wake_missing");
  const cognition = claimConversationCognition(db, {
    conversationId: cycle.conversationId,
    eventId: attempt.eventId,
    wakeId,
    cycleId: cycle.cycleId,
    generation: cycle.generation,
    nowMs: BASE,
  });
  if (!cognition.ok) throw new Error("w6_cognition_claim_failed");
  return {
    db,
    cycle,
    attempt,
    ownership: {
      eventId: attempt.eventId,
      conversationId: cycle.conversationId,
      wakeId,
      cycleId: cycle.cycleId,
      generation: cycle.generation,
      workerId: attempt.workerId,
      claimToken: attempt.claimToken,
      attemptId: attempt.attemptId,
      cognitionClaimToken: cognition.claimToken,
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("CAM-W6-P1 controlled autonomy witnesses", () => {
  it("cancellation fences an effect before execution and publishes no success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = effectFixture();
    try {
      const controller = new AbortController();
      const execute = vi.fn(async () => "must-not-run");
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 60_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute,
      });

      controller.abort("owner_cancelled");
      await expect(supervised).rejects.toMatchObject({
        name: "EffectOwnershipLostError",
      });
      expect(execute).not.toHaveBeenCalled();
      expect(controller.signal.aborted).toBe(true);
    } finally {
      fixture.db.close();
    }
  });

  it("fencing after admission stops the in-flight effect without a second execution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = effectFixture();
    try {
      let current = true;
      const controller = new AbortController();
      const execution = new Promise<string>(() => undefined);
      const execute = vi.fn(() => execution);
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 120_000,
        nowMs: () => Date.now(),
        isCurrent: () => current,
        isAuthorized: () => true,
        execute,
      });
      const outcome = supervised.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      current = false;
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(outcome).resolves.toMatchObject({
        ok: false,
        error: { name: "EffectOwnershipLostError" },
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(controller.signal.aborted).toBe(true);
    } finally {
      fixture.db.close();
    }
  });

  it("renews ownership without extending the original deadline horizon", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = effectFixture();
    try {
      let finish!: (value: string) => void;
      const execution = new Promise<string>((resolve) => { finish = resolve; });
      const summaries: Array<Record<string, unknown>> = [];
      const deadlineAtMs = BASE + 120_000;
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller: new AbortController(),
        deadlineAtMs,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => execution,
        onSummary: (summary) => { summaries.push(summary as unknown as Record<string, unknown>); },
      });

      await vi.advanceTimersByTimeAsync(90_000);
      finish("receipt");
      await expect(supervised).resolves.toBe("receipt");
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        initialDeadlineAtMs: deadlineAtMs,
        renewalCount: 3,
        firstSuccessfulRenewalAtMs: BASE + 30_000,
        lastSuccessfulRenewalAtMs: BASE + 90_000,
        fenceOrAbortReason: null,
      });
      expect((summaries[0]?.lastSuccessfulRenewalAtMs as number)).toBeLessThan(deadlineAtMs);
    } finally {
      fixture.db.close();
    }
  });

  it("lease loss aborts supervision and does not extend any member of the ownership set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = effectFixture();
    try {
      const controller = new AbortController();
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 120_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => new Promise<string>(() => undefined),
      });
      const outcome = supervised.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const before = {
        wake: (fixture.db.prepare("SELECT lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.ownership.wakeId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
        inbox: (fixture.db.prepare("SELECT lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.ownership.eventId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
        cognition: (fixture.db.prepare("SELECT lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.ownership.conversationId) as { lease_expires_at_ms: number }).lease_expires_at_ms,
      };
      fixture.db.prepare("UPDATE wakes SET lease_expires_at_ms = ? WHERE wake_id = ?")
        .run(BASE + 30_000, fixture.ownership.wakeId);

      await vi.advanceTimersByTimeAsync(30_000);
      await expect(outcome).resolves.toMatchObject({
        ok: false,
        error: { name: "EffectOwnershipLostError" },
      });
      expect(controller.signal.aborted).toBe(true);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM wakes WHERE wake_id = ?").get(fixture.ownership.wakeId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(BASE + 30_000);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM inbox_events WHERE id = ?").get(fixture.ownership.eventId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(before.inbox);
      expect((fixture.db.prepare("SELECT lease_expires_at_ms FROM cognition_claims WHERE conversation_id = ?").get(fixture.ownership.conversationId) as { lease_expires_at_ms: number }).lease_expires_at_ms).toBe(before.cognition);
      expect(before.wake).toBeGreaterThan(BASE + 30_000);
    } finally {
      fixture.db.close();
    }
  });

  it("deadline expiry aborts at the fixed horizon and does not spawn later work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const fixture = effectFixture();
    try {
      const controller = new AbortController();
      const supervised = superviseEffectExecution({
        db: fixture.db,
        ownership: fixture.ownership,
        controller,
        deadlineAtMs: BASE + 60_000,
        nowMs: () => Date.now(),
        isCurrent: () => true,
        isAuthorized: () => true,
        execute: () => new Promise<string>(() => undefined),
      });
      const outcome = supervised.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(controller.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(outcome).resolves.toMatchObject({
        ok: false,
        error: { name: "EffectOwnershipLostError" },
      });
    } finally {
      fixture.db.close();
    }
  });

  it("duplicate dispatch reuses one idempotency record and invokes the executor once", async () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-w6-duplicate",
        conversationId: "conversation-w6-duplicate",
        triggerKind: "owner_message",
        triggerRef: "event-w6-duplicate",
        nowMs: BASE,
      });
      const first = createEffectProposal({
        cycleId: "cycle-w6-duplicate",
        generation: 1,
        authorityEpoch: 1,
        idempotencyKey: "w6-duplicate-key",
        kind: "workspace.read_file",
        request: { path: "README.md" },
        originEventId: "event-w6-duplicate",
      });
      const second = createEffectProposal({
        ...first,
        effectId: "effect-w6-duplicate-replay",
      });
      let executions = 0;
      const execute = async () => {
        executions += 1;
        return { ok: true };
      };

      const firstResult = await dispatchEffect(db, first, { authorityEpoch: 1, generation: 1 }, execute);
      const secondResult = await dispatchEffect(db, second, { authorityEpoch: 1, generation: 1 }, execute);
      expect(firstResult).toMatchObject({ dispatched: true, replayed: false });
      expect(secondResult).toMatchObject({ dispatched: true, replayed: true });
      expect(executions).toBe(1);
      expect(getInFlightByIdempotencyKey(db, first.idempotencyKey)).toMatchObject({
        effectId: first.effectId,
        status: "receipted",
      });
    } finally {
      db.close();
    }
  });

  it("restart recovery marks a started row unknown and refuses a replacement mutation", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-w6-restart",
        conversationId: "conversation-w6-restart",
        triggerKind: "owner_message",
        triggerRef: "event-w6-restart",
        nowMs: BASE,
      });
      const started = putInFlight(db, {
        effectId: "effect-w6-restart",
        cycleId: "cycle-w6-restart",
        generation: 1,
        correlationId: "correlation-w6-restart",
        idempotencyKey: "w6-restart-key",
        dispatchedAtMs: BASE,
        originEventId: "event-w6-restart",
      });
      expect(recoverInFlight(db, BASE + 1)).toMatchObject([{
        effectId: started.effectId,
        status: "unknown",
      }]);
      const replacement = putInFlight(db, {
        effectId: "effect-w6-replacement",
        cycleId: "cycle-w6-restart",
        generation: 1,
        correlationId: "correlation-w6-replacement",
        idempotencyKey: "w6-restart-key",
        dispatchedAtMs: BASE + 2,
        originEventId: "event-w6-restart",
      });
      expect(replacement.effectId).toBe(started.effectId);
      expect(replacement.status).toBe("unknown");
    } finally {
      db.close();
    }
  });

  it("Thought input receives an unknown-effect flag after restart reconciliation", () => {
    const db = openTestSidecar();
    try {
      const cycle = admitTestCycle(db, {
        cycleId: "cycle-w6-thought-unknown",
        conversationId: "conversation-w6-thought-unknown",
        triggerKind: "owner_message",
        triggerRef: "event-w6-thought-unknown",
        nowMs: BASE,
      });
      putInFlight(db, {
        effectId: "effect-w6-thought-unknown",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        correlationId: "correlation-w6-thought-unknown",
        idempotencyKey: "w6-thought-unknown-key",
        dispatchedAtMs: BASE,
        originEventId: cycle.triggerRef,
        operationKind: "workspace.write_file",
        payload: { path: "README.md" },
      });
      recoverInFlight(db, BASE + 1);

      const input = buildThoughtInput({
        sidecar: db,
        cycle,
        constitution,
        capabilityReality,
        learnedSelfSlice: { dispositions: [], interests: [] },
      });
      expect(input.inFlight).toMatchObject([{
        effectId: "effect-w6-thought-unknown",
        status: "unknown",
        operationKind: "workspace.write_file",
      }]);
    } finally {
      db.close();
    }
  });

  it("delegation grant writes one exact class without copying social permit authority", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const permitCountBefore = Number((db.prepare("SELECT COUNT(*) AS count FROM social_permits").get() as { count: number }).count);
      const delegation = grantSocialOperationDelegation(db, {
        ownerId: OWNER_ID,
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "public_search",
        sourceSpan: { source: "cam-w6-p1" },
        nowMs: BASE,
      });
      const permitCountAfter = Number((db.prepare("SELECT COUNT(*) AS count FROM social_permits").get() as { count: number }).count);
      expect(delegation).toMatchObject({
        ownerId: OWNER_ID,
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "public_search",
        version: 1,
        revokedAt: null,
      });
      expect(permitCountAfter).toBe(permitCountBefore);
      expect(Number((db.prepare("SELECT COUNT(*) AS count FROM social_operation_delegations").get() as { count: number }).count)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("delegation denial and expiry make no provider call and never rewrite the permit table", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const provider = vi.fn();
      const denied = recheckSocialOperationDelegation(db, {
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "public_search",
        nowMs: BASE,
      });
      if (denied.ok) provider();
      expect(denied).toMatchObject({ ok: false, reason: "no_active_delegation" });
      expect(provider).not.toHaveBeenCalled();

      const delegation = grantSocialOperationDelegation(db, {
        ownerId: OWNER_ID,
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "public_search",
        sourceSpan: { source: "cam-w6-p1" },
        expiresAt: new Date(BASE + 1_000).toISOString(),
        nowMs: BASE,
      });
      const expired = recheckSocialOperationDelegation(db, {
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "public_search",
        delegationRef: delegation.entityUuid,
        nowMs: BASE + 1_000,
      });
      if (expired.ok) provider();
      expect(expired).toMatchObject({ ok: false, reason: "delegation_expired" });
      expect(provider).not.toHaveBeenCalled();
      expect(delegation.version).toBe(1);
      expect((db.prepare("SELECT version FROM social_operation_delegations WHERE entity_uuid = ?").get(delegation.entityUuid) as { version: number }).version).toBe(1);
    } finally {
      db.close();
    }
  });

  it("delegation recheck binds principal and conversation, then revoke blocks the next dispatch idempotently", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const delegation = grantSocialOperationDelegation(db, {
        ownerId: OWNER_ID,
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "bounded_followup",
        sourceSpan: { source: "cam-w6-p1" },
        nowMs: BASE,
      });
      expect(recheckSocialOperationDelegation(db, {
        principalId: "other-principal",
        conversationId: CONVERSATION_ID,
        operationClass: "bounded_followup",
        delegationRef: delegation.entityUuid,
        nowMs: BASE,
      })).toMatchObject({ ok: false, reason: "principal_mismatch" });
      expect(recheckSocialOperationDelegation(db, {
        principalId: PRINCIPAL_ID,
        conversationId: "other-conversation",
        operationClass: "bounded_followup",
        delegationRef: delegation.entityUuid,
        nowMs: BASE,
      })).toMatchObject({ ok: false, reason: "conversation_mismatch" });
      expect(recheckSocialOperationDelegation(db, {
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "bounded_followup",
        delegationRef: delegation.entityUuid,
        nowMs: BASE,
      })).toMatchObject({ ok: true, delegation: { version: 1 } });

      const revoked = revokeSocialOperationDelegation(db, {
        entityUuid: delegation.entityUuid,
        expectedVersion: 1,
        nowMs: BASE + 1,
      });
      const provider = vi.fn();
      const afterRevoke = recheckSocialOperationDelegation(db, {
        principalId: PRINCIPAL_ID,
        conversationId: CONVERSATION_ID,
        operationClass: "bounded_followup",
        delegationRef: delegation.entityUuid,
        nowMs: BASE + 2,
      });
      if (afterRevoke.ok) provider();
      expect(revoked.version).toBe(2);
      expect(afterRevoke).toMatchObject({ ok: false, reason: "delegation_revoked" });
      expect(provider).not.toHaveBeenCalled();
      expect(revokeSocialOperationDelegation(db, {
        entityUuid: delegation.entityUuid,
        expectedVersion: 1,
        nowMs: BASE + 3,
      }).version).toBe(2);
    } finally {
      db.close();
    }
  });

  it("private project and candidate operations have no social delegation class", () => {
    expect(socialOperationClassForOperation("project.inspect")).toBeNull();
    expect(socialOperationClassForOperation("candidate.develop")).toBeNull();
    expect(socialOperationClassForOperation("web.search")).toBe("public_search");
    expect(socialOperationClassForOperation("web.fetch")).toBe("public_fetch");
    expect(socialOperationClassForOperation("evidence.read", "attachment")).toBe("supplied_attachment");
  });
});
