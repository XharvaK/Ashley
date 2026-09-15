import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import {
  createForgetPreview,
  confirmPreviewToTombstone,
} from "../../continuity/forget-preview.js";
import { openContinuityDb } from "../../continuity/db.js";
import {
  grantPerson,
  setRecipientRestriction,
} from "../../relationship/social-authority.js";
import { buildThoughtInput } from "../thought/input.js";
import {
  admitExternalBatch,
  admitExternalCapture,
  type ExternalCaptureBody,
} from "../ingress/http.js";
import { markIntentionalSilenceInTransaction } from "../cycle/inbox.js";
import {
  admitTestCycle,
  openTestSidecar,
} from "../test-support.js";
import {
  getMemoryAssertion,
  listMemoryAssertions,
} from "../memory/assertions.js";
import { buildLearnedSelfSlice } from "../identity/learned-self.js";
import { reconcileStartupOwnership } from "../cycle/reconcile.js";
import { promoteEligiblePending } from "./dm-activation.js";
import {
  admitExternalSocialRevision,
  buildExternalBacklogManifest,
  captureExternalDeletionRequest,
  listUnresolvedDeferredExternal,
  recoverInitialContactEligibility,
  surfaceExternalBacklogForThought,
} from "./continuity-memory.js";

const ownerId = "doc";
const principalId = "person-1";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");
const dmConversationId = `dm:ashley-bot:${principalId}`;

function dmCapture(
  messageId: string,
  message: string,
  authorId = principalId,
): ExternalCaptureBody {
  return {
    envelope: {
      speakerPrincipalId: authorId,
      speakerKind: "external_human",
      location: { kind: "external_dm", principalId: authorId, channelId: `dm-${authorId}` },
      audienceAtCapture: "unknown",
      sentAtMs: nowMs,
      discordMessageId: messageId,
      mentionIds: [],
      attachmentRefs: [],
      provenance: { source: "discord", receivedAtMs: nowMs },
    },
    message,
    discordMessageId: messageId,
    attachments: [],
    gateHint: "capture_quarantine",
    conversationKey: `dm:ashley-bot:${authorId}`,
  };
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: unknown };
  return Number(row.count ?? 0);
}

function capture(
  sidecar: DatabaseSync,
  nuclear: DatabaseSync,
  messageId: string,
  message: string,
): ReturnType<typeof admitExternalCapture> {
  return admitExternalCapture(sidecar, nuclear, dmCapture(messageId, message), { nowMs });
}

function socialDimensions() {
  return {
    source: "ashley_interpretation" as const,
    status: "interpreted" as const,
    time: "historical" as const,
    reliability: "inferred" as const,
  };
}

function capabilityReality() {
  return {
    vision: false,
    attachmentText: false,
    conversationalRead: false,
    webSearch: false,
    canOfferProjectInspection: false,
    canOfferWorkspace: false,
    canOfferVerification: false,
    canOfferAuthorship: false,
    canOfferBoundedOperation: false,
    canOfferPatchExport: false,
    approvedProjectIds: [],
  };
}

describe("RA-P17 continuity and social memory", () => {
  it("reopens the original initial-contact knock after a later grant without a re-knock", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const captured = capture(sidecar, nuclear, "knock-1", "initial contact");
      const batched = admitExternalBatch(sidecar, nuclear, {
        captureRefs: [captured.captureRef],
        conversationKey: dmConversationId,
      }, { nowMs, ownerId });
      expect(batched.results[0]).toMatchObject({ disposition: "quarantined_external" });
      expect(sidecar.prepare(
        "SELECT quarantine_reason FROM inbox_events WHERE id = ?",
      ).get(`external:quarantine:${captured.captureRef.slice("extcap:".length)}`)).toEqual({
        quarantine_reason: "initial_contact_pending",
      });
      expect(count(sidecar, "cycle_records")).toBe(0);

      grantPerson(nuclear, {
        ownerId,
        principalId,
        scope: "dm_only",
        sourceSpan: { source: "p17-test" },
        nowMs: nowMs + 1,
      });
      expect(recoverInitialContactEligibility(sidecar, nuclear, { nowMs: nowMs + 2 })).toMatchObject({
        scanned: 1,
        reopened: 1,
        failures: 0,
      });
      expect(sidecar.prepare(
        "SELECT state, status, wake_id FROM inbox_events WHERE id = ?",
      ).get(`external:eligible:${captured.captureRef.slice("extcap:".length)}`)).toEqual({
        state: "pending",
        status: "pending",
        wake_id: null,
      });
      expect(sidecar.prepare(
        "SELECT quarantine_reason FROM inbox_events WHERE id = ?",
      ).get(`external:quarantine:${captured.captureRef.slice("extcap:".length)}`)).toEqual({
        quarantine_reason: "initial_contact_reopened",
      });

      const promoted = promoteEligiblePending(
        sidecar,
        nuclear,
        {
          nowMs: nowMs + 3,
          ownerId,
          env: { RA_DM_PRINCIPAL: principalId, RA_DM_COGNITION: "true" },
        },
      );
      expect(promoted).toMatchObject({ promoted: 1, rejected: 0 });
      expect(count(sidecar, "cycle_records")).toBe(1);
      expect(promoteEligiblePending(
        sidecar,
        nuclear,
        {
          nowMs: nowMs + 4,
          ownerId,
          env: { RA_DM_PRINCIPAL: principalId, RA_DM_COGNITION: "true" },
        },
      )).toMatchObject({ promoted: 0, waiting: 0, rejected: 0 });
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("surfaces blocked backlog as a bounded manifest and never answers it mechanically", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      setRecipientRestriction(nuclear, {
        authenticatedSender: true,
        ownerId,
        principalId,
        kind: "no_dm",
        sourceMessageRef: "restriction-1",
        nowMs,
      });
      const captured = capture(sidecar, nuclear, "blocked-1", "blocked content should never become a host answer");
      const batch = admitExternalBatch(sidecar, nuclear, {
        captureRefs: [captured.captureRef],
        conversationKey: dmConversationId,
      }, { nowMs, ownerId });
      expect(batch.results[0]?.disposition).toBe("quarantined_external");

      const manifest = buildExternalBacklogManifest(sidecar, {
        conversationId: dmConversationId,
        nowMs: nowMs + 1,
      });
      expect(manifest.entries).toHaveLength(1);
      expect(manifest.entries[0]).toMatchObject({
        evidenceRowId: captured.captureRef.slice("extcap:".length),
        availability: "quarantined",
        contentAvailable: true,
        provenance: { source: "discord", receivedAtMs: nowMs },
      });
      expect(JSON.stringify(manifest.entries)).not.toContain("blocked content should never become a host answer");
      expect(surfaceExternalBacklogForThought(manifest)).toMatchObject({
        status: "ready",
        requiresThought: true,
        replayed: false,
        restoredDrafts: false,
        reusedOldAuthoritySnapshot: false,
        answer: null,
      });
      expect(count(sidecar, "thought_steps")).toBe(0);
      expect(count(sidecar, "cycle_records")).toBe(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("retains orphaned external input as unresolved_deferred and excludes intentional silence", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const captured = capture(sidecar, nuclear, "orphan-1", "orphaned input");
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-orphan-social",
        conversationId: dmConversationId,
        triggerKind: "external_message",
        triggerRef: "orphan-trigger",
        occupantId: ownerId,
        nowMs,
      });
      sidecar.prepare(
        "UPDATE cycle_records SET state = 'thinking', compose_log_ids_json = ? WHERE cycle_id = ?",
      ).run(JSON.stringify([captured.captureRef.slice("extcap:".length)]), cycle.cycleId);
      sidecar.prepare(
        "UPDATE wakes SET state = 'terminal', terminal_reason = 'cancelled' WHERE wake_id = ?",
      ).run(cycle.wakeId);

      const reconciled = reconcileStartupOwnership(sidecar, { nowMs: nowMs + 1 });
      expect(reconciled.unresolvedDeferredCycleIds).toContain(cycle.cycleId);
      expect(sidecar.prepare("SELECT state, disposition FROM cycle_records WHERE cycle_id = ?").get(cycle.cycleId))
        .toEqual({ state: "silent", disposition: "unresolved_deferred" });
      expect(listUnresolvedDeferredExternal(sidecar, { conversationId: dmConversationId })).toMatchObject([
        { evidenceRowId: captured.captureRef.slice("extcap:".length), availability: "unresolved_deferred", cycleId: cycle.cycleId },
      ]);

      sidecar.exec("BEGIN IMMEDIATE");
      try {
        markIntentionalSilenceInTransaction(sidecar, cycle.cycleId, nowMs + 2);
        sidecar.exec("COMMIT");
      } catch (error) {
        try { sidecar.exec("ROLLBACK"); } catch { /* preserve the test failure */ }
        throw error;
      }
      expect(listUnresolvedDeferredExternal(sidecar, { conversationId: dmConversationId })).toEqual([]);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("admits tier-1/2 revisions with source facets, preserves the chain, and withholds tier-2 in a room", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const first = capture(sidecar, nuclear, "memory-1", "first external observation");
      const second = admitExternalCapture(sidecar, nuclear, dmCapture("memory-2", "second external observation"), { nowMs: nowMs + 1 });
      const beforeCycles = count(sidecar, "cycle_records");
      const firstRevision = admitExternalSocialRevision(sidecar, {
        assertionKey: "social:self:1",
        statement: "Disposition: I slow down and listen carefully here.",
        memoryKind: "learned_self_evidence",
        dimensions: socialDimensions(),
        dataClassification: "never_public",
        evidenceRefs: [first.captureRef.slice("extcap:".length), second.captureRef.slice("extcap:".length)],
        audience: { kind: "dm", principalId },
        sourcePrincipal: principalId,
        subject: [principalId],
        protectionBasisRefs: [first.captureRef.slice("extcap:".length), second.captureRef.slice("extcap:".length)],
        protectionStatus: "admitted",
        licenseRefs: [],
        thoughtInterpretationRef: "thought-interpretation-1",
        lineageParentKey: null,
        admittedGeneration: 1,
        nowMs: nowMs + 2,
      });
      expect(firstRevision).toMatchObject({ status: "admitted", assertion: { audienceScope: { kind: "dm", principalId }, protectionStatus: "admitted" } });
      expect(count(sidecar, "cycle_records")).toBe(beforeCycles);
      expect(count(sidecar, "thought_steps")).toBe(0);

      const secondRevision = admitExternalSocialRevision(sidecar, {
        assertionKey: "social:self:2",
        statement: "Disposition: I now listen carefully before offering a conclusion.",
        memoryKind: "learned_self_evidence",
        dimensions: socialDimensions(),
        dataClassification: "never_public",
        evidenceRefs: [first.captureRef.slice("extcap:".length), second.captureRef.slice("extcap:".length)],
        audience: { kind: "dm", principalId },
        sourcePrincipal: principalId,
        subject: [principalId],
        protectionBasisRefs: [first.captureRef.slice("extcap:".length), second.captureRef.slice("extcap:".length)],
        protectionStatus: "admitted",
        licenseRefs: [],
        thoughtInterpretationRef: "thought-interpretation-2",
        lineageParentKey: "social:self:1",
        admittedGeneration: 2,
        nowMs: nowMs + 3,
      });
      expect(secondRevision.status).toBe("admitted");
      expect(getMemoryAssertion(sidecar, "social:self:1")?.live).toBe(false);
      expect(getMemoryAssertion(sidecar, "social:self:2")?.live).toBe(true);

      const unresolved = admitExternalSocialRevision(sidecar, {
        assertionKey: "social:self:unresolved",
        statement: "Disposition: this must not be admitted from one observation.",
        memoryKind: "learned_self_evidence",
        dimensions: socialDimensions(),
        dataClassification: "never_public",
        evidenceRefs: [first.captureRef.slice("extcap:".length)],
        audience: { kind: "dm", principalId },
        sourcePrincipal: principalId,
        subject: [principalId],
        protectionBasisRefs: [first.captureRef.slice("extcap:".length)],
        protectionStatus: "admitted",
        licenseRefs: [],
        thoughtInterpretationRef: "thought-interpretation-bad",
        lineageParentKey: null,
        admittedGeneration: 3,
        nowMs: nowMs + 4,
      });
      expect(unresolved).toMatchObject({ status: "unresolved", reason: "social_revision_tier2_evidence_minimum", assertion: null });
      expect(getMemoryAssertion(sidecar, "social:self:unresolved")).toBeNull();
      expect(listMemoryAssertions(sidecar, { live: true, memoryKinds: ["learned_self_evidence"] }))
        .toHaveLength(1);

      const learnedSelf = buildLearnedSelfSlice(sidecar);
      const roomCycle = admitTestCycle(sidecar, {
        cycleId: "cycle-room-memory",
        conversationId: "room:guild-1:channel-1",
        triggerKind: "external_message",
        triggerRef: "room-memory-trigger",
        occupantId: ownerId,
        nowMs: nowMs + 5,
      });
      const roomInput = buildThoughtInput({
        sidecar,
        cycle: roomCycle,
        triggerText: "room context",
        rawConversation: [],
        workingContext: [],
        occupancy: [],
        constitution: { constitutional: ["truth before performance"], stableSelf: ["curious"] },
        learnedSelfSlice: learnedSelf,
        capabilityReality: capabilityReality(),
        observations: [],
        inFlight: [],
        audience: { kind: "room", roomId: "room:guild-1:channel-1" },
      });
      expect(roomInput.learnedSelfSlice.personLinked ?? []).toEqual([]);
      expect(roomInput.learnedSelfSlice.dispositions).toEqual([]);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("captures external deletion requests for Owner review without applying deletion", () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const captured = capture(sidecar, nuclear, "delete-1", "please remove this");
      const evidenceRowId = captured.captureRef.slice("extcap:".length);
      expect(captureExternalDeletionRequest(sidecar, {
        ownerId,
        requestId: "request-1",
        evidenceRowId,
        requesterPrincipalId: principalId,
        nowMs: nowMs + 1,
      })).toEqual({
        captured: true,
        duplicate: false,
        notificationQueued: true,
        mechanicalEffect: false,
      });
      expect(captureExternalDeletionRequest(sidecar, {
        ownerId,
        requestId: "request-1",
        evidenceRowId,
        requesterPrincipalId: principalId,
        nowMs: nowMs + 2,
      })).toMatchObject({ captured: true, duplicate: true, mechanicalEffect: false });
      expect(sidecar.prepare("SELECT kind, wake_id FROM inbox_events WHERE id = ?").get("external:deletion-request:request-1"))
        .toEqual({ kind: "external_deletion_request", wake_id: null });
      expect(sidecar.prepare("SELECT COUNT(*) AS count FROM system_notice_outbox WHERE notice_key = ?").get("external_deletion_request:doc:request-1"))
        .toEqual({ count: 1 });
      expect(count(sidecar, "cycle_records")).toBe(0);
      expect(count(sidecar, "thought_steps")).toBe(0);
    } finally {
      nuclear.close();
      sidecar.close();
    }
  });

  it("preserves Owner-only forgetting and introduces no relationship-trust engine", () => {
    const continuity = openContinuityDb(new DatabaseSync(":memory:"));
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"), { continuity });
    try {
      const preview = createForgetPreview(continuity, {
        ownerId,
        targets: [],
        categoryCounts: {},
      });
      expect(() => confirmPreviewToTombstone(continuity, {
        previewId: preview.previewId,
        ownerId: "not-owner",
      })).toThrow("forget_preview_owner_mismatch");
      expect(confirmPreviewToTombstone(continuity, {
        previewId: preview.previewId,
        ownerId,
      }).tombstoneId).toBeTruthy();
    } finally {
      nuclear.close();
      continuity.close();
    }

    const source = readFileSync(new URL("./continuity-memory.ts", import.meta.url), "utf8");
    for (const forbidden of ["relationshipScore", "trustScore", "relationshipTrust", "trustEngine", "socialScore"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
