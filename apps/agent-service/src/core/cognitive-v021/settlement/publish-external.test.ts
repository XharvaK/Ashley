import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readAuthorityBarrier } from "../authority/barrier.js";
import { openNuclearDb } from "../../db.js";
import { resolveActiveThread } from "../../memory/threads.js";
import { absorbFreshMessages } from "../cycle/fence.js";
import { initializeAttemptInputBasis } from "../cycle/inbox.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import { insertOutboxPending } from "../speech/outbox.js";
import type {
  AttemptInputBasis,
  DepRef,
  HardDependencyBundle,
} from "../social/types.js";
import {
  admitExternalPublication,
  recheckExternalPublicationReservation,
  type ExternalPublicationCandidate,
  type ExternalPublicationDestination,
} from "./publish.js";
import {
  clearProhibition,
  grantPerson,
  issueLicense,
  prohibitPerson,
  revokePerson,
  revokeLicense,
} from "../../relationship/social-authority.js";

const ownerId = "owner-1";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function dbFixture(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function basis(): AttemptInputBasis {
  return {
    schemaVersion: 1,
    orderedRefs: ["evidence-1"],
    versions: { "evidence-1": 1 },
    speakerAttributionHash: "speaker-hash",
    replyEdges: [],
    attachmentCoverage: {},
    projectionVersion: "projection-1",
  };
}

function insertDraft(db: DatabaseSync, idSuffix: string): number {
  const result = db.prepare(
    `INSERT INTO delivery_reservations
       (owner_id, channel, thread_id, trigger, delivery_lane, state, draft_text, created_at)
     VALUES (?, 'discord', ?, 'reactive', 'social_notify', 'drafted', 'external draft', ?)`,
  ).run(ownerId, `external-${idSuffix}`, new Date(nowMs).toISOString());
  return Number(result.lastInsertRowid);
}

function dep(
  barrier: { epoch: number; revision: number },
  table: string,
  key: string,
  rowRevision: number | null,
): DepRef {
  return {
    table,
    key,
    rowRevision,
    barrier: { epoch: barrier.epoch, revision: barrier.revision },
    absentAsOfMs: nowMs,
  };
}

function bundleFor(
  db: DatabaseSync,
  permitEntityUuid: string | undefined,
  licenseEntityUuid: string,
  licenseVersion = 1,
): HardDependencyBundle {
  const barrier = readAuthorityBarrier(db);
  return {
    permit: dep(barrier, "social_permits", permitEntityUuid ?? "absent-permit", permitEntityUuid ? 1 : null),
    prohibitionAbsence: dep(barrier, "owner_prohibitions", "absent-prohibition", null),
    roomState: dep(barrier, "trusted_rooms", "absent-room", null),
    recipientRestrictionAbsence: dep(
      barrier,
      "recipient_restrictions",
      "absent-restriction",
      null,
    ),
    ashleyBoundaryAbsence: dep(barrier, "ashley_boundaries", "absent-boundary", null),
    licenses: [dep(barrier, "disclosure_licenses", licenseEntityUuid, licenseVersion)],
    capability: dep(barrier, "capability_authority", "capability:external_dm", null),
    destinationAccess: dep(barrier, "destination_access", "dm:person-1", null),
    barrier: { epoch: barrier.epoch, revision: barrier.revision },
  };
}

function candidateFor(
  db: DatabaseSync,
  reservationId: number,
  permitEntityUuid: string | undefined,
  licenseEntityUuid: string,
  destination: ExternalPublicationDestination,
  licenseVersion = 1,
  overrides: Partial<ExternalPublicationCandidate> = {},
): ExternalPublicationCandidate {
  return {
    ownerId,
    reservationId,
    attemptInputBasis: basis(),
    hardDependencyBundle: bundleFor(db, permitEntityUuid, licenseEntityUuid, licenseVersion),
    destination,
    interactionIntent: "continue",
    licenseRefs: [licenseEntityUuid],
    materialHash: "material-1",
    nowMs,
    ...overrides,
  };
}

function withPublicationEnabled<T>(callback: () => T): T {
  const previous = process.env.RA_DM_PUBLICATION;
  process.env.RA_DM_PUBLICATION = "true";
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.RA_DM_PUBLICATION;
    else process.env.RA_DM_PUBLICATION = previous;
  }
}

function withPublicationDisabled<T>(callback: () => T): T {
  const previous = process.env.RA_DM_PUBLICATION;
  delete process.env.RA_DM_PUBLICATION;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.RA_DM_PUBLICATION;
    else process.env.RA_DM_PUBLICATION = previous;
  }
}

describe("external publication admission", () => {
  it("consumes a one-shot for its reservation and rechecks the post-consumption binding", () => {
    const db = dbFixture();
    try {
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: { kind: "test" },
        granteeAudience: { kind: "dm", principalId: "person-1" },
        usesAllowed: 1,
        grantRef: "grant-1",
        nowMs,
      });
      const reservationId = insertDraft(db, "one-shot");
      const before = readAuthorityBarrier(db);
      const result = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          reservationId,
          permit.entityUuid,
          license.entityUuid,
          { kind: "external_dm", principalId: "person-1", channelId: "dm-1" },
        ),
      ));

      expect(result).toMatchObject({ admitted: true, quarantined: false, reservationId });
      expect(readAuthorityBarrier(db).revision).toBe(before.revision + 1);
      expect(db.prepare(
        "SELECT state, destination_json, attempt_input_basis_json, hard_dependency_bundle_json, license_refs_json FROM delivery_reservations WHERE id = ?",
      ).get(reservationId)).toMatchObject({ state: "reserved" });
      expect(db.prepare(
        "SELECT uses_consumed, version FROM disclosure_licenses WHERE entity_uuid = ?",
      ).get(license.entityUuid)).toEqual({ uses_consumed: 1, version: 2 });

      const storedBundle = JSON.parse(String((db.prepare(
        "SELECT hard_dependency_bundle_json FROM delivery_reservations WHERE id = ?",
      ).get(reservationId) as { hard_dependency_bundle_json: string }).hard_dependency_bundle_json)) as HardDependencyBundle;
      expect(storedBundle.barrier).toEqual(result.postConsumptionBarrier);
      expect(storedBundle.licenses[0]?.rowRevision).toBe(2);
      expect(JSON.parse(String((db.prepare(
        "SELECT license_refs_json FROM delivery_reservations WHERE id = ?",
      ).get(reservationId) as { license_refs_json: string }).license_refs_json))).toMatchObject([
        {
          licenseEntityUuid: license.entityUuid,
          useNo: 1,
          consumedByReservationId: reservationId,
          materialHash: "material-1",
        },
      ]);

      expect(withPublicationEnabled(() => recheckExternalPublicationReservation(
        db,
        reservationId,
        nowMs,
      ))).toEqual({ ok: true });

      issueLicense(db, {
        ownerId,
        materialHash: "unrelated-material",
        sourcePrincipal: "person-9",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-9" },
        usesAllowed: 1,
        grantRef: "unrelated-hard-policy-mutation",
        nowMs,
      });
      expect(withPublicationEnabled(() => recheckExternalPublicationReservation(
        db,
        reservationId,
        nowMs,
      ))).toEqual({ ok: false, reason: "authority_vector_stale" });

      const secondReservationId = insertDraft(db, "one-shot-second");
      const second = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          secondReservationId,
          permit.entityUuid,
          license.entityUuid,
          { kind: "external_dm", principalId: "person-1", channelId: "dm-1" },
          2,
        ),
      ));
      expect(second).toMatchObject({
        admitted: false,
        quarantined: true,
        reason: "license_consumed",
      });
      expect(db.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(secondReservationId))
        .toEqual({ state: "drafted" });
    } finally {
      db.close();
    }
  });

  it("is closed by default and does not mutate a drafted reservation", () => {
    const db = dbFixture();
    try {
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-1" },
        usesAllowed: 1,
        grantRef: "grant-closed",
        nowMs,
      });
      const reservationId = insertDraft(db, "closed");
      const result = withPublicationDisabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          reservationId,
          permit.entityUuid,
          license.entityUuid,
          { kind: "external_dm", principalId: "person-1" },
        ),
      ));
      expect(result).toMatchObject({
        admitted: false,
        quarantined: true,
        reason: "external_publication_disabled",
      });
      expect(db.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(reservationId))
        .toEqual({ state: "drafted" });
    } finally {
      db.close();
    }
  });

  it("rejects audience mismatches before a room or exact-principal destination can bind", () => {
    const db = dbFixture();
    try {
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "person_wide",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const roomLicense = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "room", roomId: "room-1" },
        usesAllowed: 1,
        grantRef: "grant-room",
        nowMs,
      });
      const dmReservationId = insertDraft(db, "room-license-dm");
      const dmResult = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          dmReservationId,
          permit.entityUuid,
          roomLicense.entityUuid,
          { kind: "external_dm", principalId: "person-1" },
        ),
      ));
      expect(dmResult).toMatchObject({ admitted: false, reason: "audience_mismatch" });

      const exactLicense = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "exact_principal", principalId: "person-1" },
        usesAllowed: 1,
        grantRef: "grant-exact",
        nowMs,
      });
      const roomReservationId = insertDraft(db, "exact-license-room");
      const roomResult = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          roomReservationId,
          permit.entityUuid,
          exactLicense.entityUuid,
          { kind: "room", roomId: "room-1", guildId: "guild-1", channelId: "channel-1" },
        ),
      ));
      expect(roomResult).toMatchObject({ admitted: false, reason: "audience_mismatch" });
    } finally {
      db.close();
    }
  });

  it("admits an Owner-DM destination only with an Owner-scoped disclosure license", () => {
    const db = dbFixture();
    try {
      const threadId = resolveActiveThread(db, ownerId, "discord");
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: ownerId,
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: ownerId },
        usesAllowed: 1,
        grantRef: "grant-owner-dm",
        nowMs,
      });
      const reservationId = insertDraft(db, "owner-dm");
      const result = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          reservationId,
          undefined,
          license.entityUuid,
          { kind: "owner_dm", threadId },
        ),
      ));
      expect(result).toMatchObject({ admitted: true, quarantined: false, reservationId });

      const otherThreadId = resolveActiveThread(db, "owner-2", "discord");
      const otherReservationId = insertDraft(db, "owner-dm-wrong-owner");
      const other = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          otherReservationId,
          undefined,
          license.entityUuid,
          { kind: "owner_dm", threadId: otherThreadId },
          2,
        ),
      ));
      expect(other).toMatchObject({ admitted: false, reason: "owner_dm_identity_unresolved" });
    } finally {
      db.close();
    }
  });

  it("allows only a bounded closure and lets hard-stop or capability state suppress it", () => {
    const db = dbFixture();
    try {
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-1" },
        usesAllowed: 2,
        grantRef: "grant-closure",
        nowMs,
      });
      const destination = { kind: "external_dm", principalId: "person-1" } as const;
      const closureReservationId = insertDraft(db, "closure");
      const closure = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(db, closureReservationId, undefined, license.entityUuid, destination, 1, {
          closure: { allowed: true },
        }),
      ));
      expect(closure).toMatchObject({ admitted: true, quarantined: false });

      const hardStopReservationId = insertDraft(db, "closure-hard-stop");
      const hardStop = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(db, hardStopReservationId, undefined, license.entityUuid, destination, 2, {
          closure: { allowed: true, hardStop: true },
        }),
      ));
      expect(hardStop).toMatchObject({ admitted: false, reason: "hard_stop" });

      const capabilityReservationId = insertDraft(db, "closure-capability");
      const capability = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(db, capabilityReservationId, undefined, license.entityUuid, destination, 2, {
          closure: { allowed: true },
          capabilityRefs: ["capability:external_dm"],
        }),
      ));
      expect(capability).toMatchObject({ admitted: false, reason: "dm_requires_person_permit" });
    } finally {
      db.close();
    }
  });

  it("invalidates candidates across revoke-regrant and set-clear barrier round trips", () => {
    const db = dbFixture();
    try {
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-1" },
        usesAllowed: 2,
        grantRef: "grant-round-trip",
        nowMs,
      });
      const revokeReservationId = insertDraft(db, "regrant-stale");
      const revokeCandidate = candidateFor(
        db,
        revokeReservationId,
        permit.entityUuid,
        license.entityUuid,
        { kind: "external_dm", principalId: "person-1" },
      );
      revokePerson(db, { entityUuid: permit.entityUuid, nowMs });
      grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "regrant" },
        nowMs,
      });
      const regrantResult = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        revokeCandidate,
      ));
      expect(regrantResult).toMatchObject({ admitted: false, reason: "authority_vector_stale" });

      const clearReservationId = insertDraft(db, "clear-stale");
      const clearCandidate = candidateFor(
        db,
        clearReservationId,
        permit.entityUuid,
        license.entityUuid,
        { kind: "external_dm", principalId: "person-1" },
      );
      const prohibition = prohibitPerson(db, {
        ownerId,
        targetPrincipalId: "person-1",
        scope: "no_contact",
        hardStop: true,
        sourceSpan: { source: "test-prohibition" },
        nowMs,
      });
      clearProhibition(db, { entityUuid: prohibition.entityUuid, nowMs });
      const clearResult = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        clearCandidate,
      ));
      expect(clearResult).toMatchObject({ admitted: false, reason: "authority_vector_stale" });
    } finally {
      db.close();
    }
  });

  it("refuses an external reservation whose basis was superseded before dispatch", () => {
    const sidecar = openTestSidecar();
    const db = dbFixture();
    try {
      const conversationId = "dm:dispatch-freshness";
      const cycle = admitTestCycle(sidecar, {
        cycleId: "cycle-dispatch-freshness",
        conversationId,
        triggerKind: "owner_message",
        triggerRef: "dispatch-freshness",
        occupantId: ownerId,
        nowMs: 1,
      });
      initializeAttemptInputBasis(sidecar, {
        cycleId: cycle.cycleId,
        basis: basis(),
        nowMs: 2,
      });
      const speech = insertOutboxPending(sidecar, {
        settlementId: "settlement-dispatch-freshness",
        cycleId: cycle.cycleId,
        generation: cycle.generation,
        conversationId,
        licensedText: "external draft",
      });

      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-1" },
        usesAllowed: 1,
        grantRef: "grant-dispatch-freshness",
        nowMs,
      });
      const reservationId = insertDraft(db, "dispatch-freshness");
      db.prepare(
        "UPDATE delivery_reservations SET cognitive_v021_projection_key = ? WHERE id = ?",
      ).run(speech.projectionKey, reservationId);
      const admission = withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          reservationId,
          permit.entityUuid,
          license.entityUuid,
          { kind: "external_dm", principalId: "person-1" },
        ),
      ));
      expect(admission).toMatchObject({ admitted: true, reservationId });

      const superseded = absorbFreshMessages(sidecar, cycle.cycleId, ["evidence-2"], { nowMs: 3 });
      expect(superseded.kind).toBe("superseded");
      expect(withPublicationEnabled(() => recheckExternalPublicationReservation(
        db,
        reservationId,
        nowMs,
        { cognitiveSidecar: sidecar },
      ))).toEqual({ ok: false, reason: "stale_basis" });
      expect(db.prepare("SELECT state FROM delivery_reservations WHERE id = ?").get(reservationId))
        .toEqual({ state: "reserved" });
    } finally {
      db.close();
      sidecar.close();
    }
  });

  it("refuses dispatch when the current license grantee no longer equals the recipient", () => {
    const db = dbFixture();
    try {
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-1" },
        usesAllowed: 1,
        grantRef: "grant-dispatch-grantee",
        nowMs,
      });
      const reservationId = insertDraft(db, "dispatch-grantee");
      expect(withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          reservationId,
          permit.entityUuid,
          license.entityUuid,
          { kind: "external_dm", principalId: "person-1" },
        ),
      ))).toMatchObject({ admitted: true, reservationId });

      db.prepare(
        "UPDATE disclosure_licenses SET grantee_audience_json = ? WHERE entity_uuid = ?",
      ).run(JSON.stringify({ kind: "dm", principalId: "person-2" }), license.entityUuid);
      expect(withPublicationEnabled(() => recheckExternalPublicationReservation(
        db,
        reservationId,
        nowMs,
      ))).toEqual({ ok: false, reason: "audience_mismatch" });
    } finally {
      db.close();
    }
  });

  it("re-resolves a revoked license before external dispatch", () => {
    const db = dbFixture();
    try {
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-1",
        sourcePrincipal: "person-1",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-1" },
        usesAllowed: 1,
        grantRef: "grant-dispatch-revoke",
        nowMs,
      });
      const reservationId = insertDraft(db, "dispatch-revoke");
      expect(withPublicationEnabled(() => admitExternalPublication(
        db,
        undefined,
        candidateFor(
          db,
          reservationId,
          permit.entityUuid,
          license.entityUuid,
          { kind: "external_dm", principalId: "person-1" },
        ),
      ))).toMatchObject({ admitted: true, reservationId });

      revokeLicense(db, { entityUuid: license.entityUuid, nowMs });
      expect(withPublicationEnabled(() => recheckExternalPublicationReservation(
        db,
        reservationId,
        nowMs,
      ))).toEqual({ ok: false, reason: "license_revoked" });
    } finally {
      db.close();
    }
  });
});
