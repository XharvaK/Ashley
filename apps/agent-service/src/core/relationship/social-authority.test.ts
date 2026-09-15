import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { readAuthorityBarrier } from "../cognitive-v021/authority/barrier.js";
import {
  clearProhibition,
  classifyEligibility,
  consumeLicenseOnce,
  grantPerson,
  issueLicense,
  listAvailableSocialDestinations,
  prohibitPerson,
  readEligibilityBundle,
  revokeLicense,
  revokePerson,
  setAshleyBoundary,
  upsertTrustedRoom,
} from "./social-authority.js";

const ownerId = "owner-1";
const nowMs = Date.parse("2026-09-15T12:00:00.000Z");

function dbFixture(): DatabaseSync {
  return openNuclearDb(new DatabaseSync(":memory:"));
}

function revision(db: DatabaseSync): number {
  return readAuthorityBarrier(db).revision;
}

describe("social authority accessors", () => {
  it("advances M1R exactly once for effective mutations and zero for no-ops", () => {
    const db = dbFixture();
    try {
      const initial = revision(db);
      const permit = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      expect(revision(db)).toBe(initial + 1);

      const same = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      expect(same.entityUuid).toBe(permit.entityUuid);
      expect(revision(db)).toBe(initial + 1);

      revokePerson(db, { entityUuid: permit.entityUuid, nowMs });
      expect(revision(db)).toBe(initial + 2);
      revokePerson(db, { entityUuid: permit.entityUuid, nowMs });
      expect(revision(db)).toBe(initial + 2);

      const regrant = grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test", revision: 2 },
        nowMs,
      });
      expect(regrant.entityUuid).not.toBe(permit.entityUuid);
      expect(revision(db)).toBe(initial + 3);
    } finally {
      db.close();
    }
  });

  it("keeps a prohibition distinct from granting and clearing it does not grant", () => {
    const db = dbFixture();
    try {
      const prohibition = prohibitPerson(db, {
        ownerId,
        targetPrincipalId: "person-2",
        scope: "no_contact",
        sourceSpan: { source: "test" },
        nowMs,
      });
      expect(readEligibilityBundle(db, { principalId: "person-2", nowMs }).permits).toHaveLength(0);
      expect(readEligibilityBundle(db, { principalId: "person-2", nowMs }).prohibitions).toHaveLength(1);
      clearProhibition(db, { entityUuid: prohibition.entityUuid, nowMs });
      const bundle = readEligibilityBundle(db, { principalId: "person-2", nowMs });
      expect(bundle.permits).toHaveLength(0);
      expect(bundle.prohibitions).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("versions licenses on issue, one-shot consume, and revoke", () => {
    const db = dbFixture();
    try {
      const license = issueLicense(db, {
        ownerId,
        materialHash: "material-hash",
        sourcePrincipal: "person-3",
        controlledProtections: { kind: "test" },
        granteeAudience: { kind: "dm", principalId: "person-3" },
        usesAllowed: 1,
        grantRef: "grant-1",
        nowMs,
      });
      expect(license.version).toBe(1);
      const beforeConsume = revision(db);

      const consumed = consumeLicenseOnce(db, {
        entityUuid: license.entityUuid,
        expectedVersion: 1,
        reservationId: "reservation-1",
        nowMs,
      });
      expect(consumed.version).toBe(2);
      expect(consumed.usesConsumed).toBe(1);
      expect(revision(db)).toBe(beforeConsume + 1);
      expect(() => consumeLicenseOnce(db, {
        entityUuid: license.entityUuid,
        expectedVersion: 2,
        reservationId: "reservation-2",
        nowMs,
      })).toThrow("license_consumed");
      expect(revision(db)).toBe(beforeConsume + 1);

      const revoked = revokeLicense(db, { entityUuid: license.entityUuid, nowMs });
      expect(revoked.version).toBe(3);
      const afterRevoke = revision(db);
      expect(revokeLicense(db, { entityUuid: license.entityUuid, nowMs }).version).toBe(3);
      expect(revision(db)).toBe(afterRevoke);
    } finally {
      db.close();
    }
  });

  it("evaluates expiry by clock without an expiry writer", () => {
    const db = dbFixture();
    try {
      const license = issueLicense(db, {
        ownerId,
        materialHash: "expired-material",
        sourcePrincipal: "person-4",
        controlledProtections: {},
        granteeAudience: { kind: "dm", principalId: "person-4" },
        usesAllowed: 1,
        grantRef: "grant-expired",
        expiresAt: new Date(nowMs - 1).toISOString(),
        nowMs,
      });
      const before = revision(db);
      expect(readEligibilityBundle(db, { principalId: "person-4", nowMs }).licenses).toHaveLength(0);
      expect(() => consumeLicenseOnce(db, {
        entityUuid: license.entityUuid,
        expectedVersion: 1,
        reservationId: "reservation-expired",
        nowMs,
      })).toThrow("license_expired");
      expect(revision(db)).toBe(before);
    } finally {
      db.close();
    }
  });

  it("does not let an Owner caller write an Ashley boundary", () => {
    const db = dbFixture();
    try {
      expect(() => setAshleyBoundary(db, {
        ownerId,
        targetPrincipalId: "person-5",
        scope: "no_contact",
        decisionRef: "owner-request",
        caller: "owner",
        nowMs,
      })).toThrow("boundary_authority_required");
    } finally {
      db.close();
    }
  });

  it("requires the configured Owner bot principal to have person-wide DM authority", () => {
    const db = dbFixture();
    try {
      grantPerson(db, {
        ownerId,
        principalId: "bot-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      const dmOnly = classifyEligibility(
        readEligibilityBundle(db, { principalId: "bot-1", nowMs }),
        "dm",
        { externalBot: true, botDmPrincipal: "bot-1" },
      );
      expect(dmOnly.verdict).toBe("capture_quarantine");

      grantPerson(db, {
        ownerId,
        principalId: "bot-1",
        scope: "person_wide",
        sourceSpan: { source: "test", grant: "bot" },
        nowMs,
      });
      expect(classifyEligibility(
        readEligibilityBundle(db, { principalId: "bot-1", nowMs }),
        "dm",
        { externalBot: true, botDmPrincipal: "bot-1" },
      ).verdict).toBe("allow_social");
      expect(classifyEligibility(
        readEligibilityBundle(db, { principalId: "bot-1", guildId: "guild-1", channelId: "channel-1", nowMs }),
        "room",
        { externalBot: true, botDmPrincipal: null, roomSeedActive: true },
      ).verdict).toBe("capture_quarantine");

      upsertTrustedRoom(db, {
        ownerId,
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "trusted_social",
        provenance: "explicit_config",
        addedBy: ownerId,
        nowMs,
      });
      expect(classifyEligibility(
        readEligibilityBundle(db, { principalId: "bot-1", guildId: "guild-1", channelId: "channel-1", nowMs }),
        "room",
        { externalBot: true, botDmPrincipal: null, roomSeedActive: true },
      ).verdict).toBe("allow_social");
    } finally {
      db.close();
    }
  });

  it("enumerates permitted destinations without treating room-only permits as DMs", () => {
    const db = dbFixture();
    try {
      grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "dm_only",
        sourceSpan: { source: "test" },
        nowMs,
      });
      grantPerson(db, {
        ownerId,
        principalId: "person-1",
        scope: "person_wide",
        sourceSpan: { source: "test", wider: true },
        nowMs,
      });
      grantPerson(db, {
        ownerId,
        principalId: "person-2",
        scope: "room_only",
        sourceSpan: { source: "test", room: true },
        nowMs,
      });
      upsertTrustedRoom(db, {
        ownerId,
        guildId: "guild-1",
        channelId: "channel-1",
        mode: "trusted_social",
        provenance: "explicit_config",
        addedBy: ownerId,
        nowMs,
      });
      expect(listAvailableSocialDestinations(db, { nowMs })).toEqual([
        {
          audience: { kind: "dm", principalId: "person-1" },
          source: "social_permit",
          permitScope: "person_wide",
        },
        {
          audience: { kind: "room", roomId: "room:guild-1:channel-1" },
          source: "trusted_room",
          permitScope: null,
        },
      ]);
    } finally {
      db.close();
    }
  });
});
