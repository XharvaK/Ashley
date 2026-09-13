import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../db.js";
import { insertMessage, resolveActiveThread } from "../memory/threads.js";
import { createEpisode } from "../memory/episodes.js";
import { C4_OWNER, C4_TIME_1, c4Prediction, deliveredReservation } from "./test-fixtures.js";
import {
  createLivedExperienceLink,
  listLivedExperienceLinks,
  operationalReferenceResolves,
  refreshLivedExperienceLinkValidity,
} from "./experience-links.js";

describe("C4 lived-experience links", () => {
  it("requires a durable operational receipt and preserves the source boundaries", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const threadId = resolveActiveThread(db, C4_OWNER, "test");
      const messageId = insertMessage(db, {
        threadId,
        ownerId: C4_OWNER,
        role: "user",
        text: "A grounded fixture activity happened.",
      });
      const episode = createEpisode(db, {
        ownerId: C4_OWNER,
        threadId,
        summary: "A grounded fixture activity happened.",
        messageIds: [messageId],
        provenance: "live",
      });
      const reservationId = deliveredReservation(db);
      expect(operationalReferenceResolves(
        db,
        C4_OWNER,
        "delivery_reservation:" + reservationId,
      )).toBe(true);
      const link = createLivedExperienceLink(db, {
        ownerId: C4_OWNER,
        episodeId: episode?.id,
        operationalRef: "delivery_reservation:" + reservationId,
        capabilityMode: "dark_apply",
      });
      expect(link).toMatchObject({
        ownerId: C4_OWNER,
        episodeId: episode?.id,
        operationalRef: "delivery_reservation:" + reservationId,
        provenance: "live",
        validityState: "active",
      });
      expect(listLivedExperienceLinks(db, C4_OWNER)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("refuses drafts, pending jobs, unsupported refs, and fabricated own-time experience", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      expect(() => createLivedExperienceLink(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        operationalRef: "delivery_reservation:999999",
      })).toThrow("cognitive_graduation_operational_ref_unresolved");
      expect(() => createLivedExperienceLink(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        operationalRef: "own_time_session:fixture",
      })).toThrow("cognitive_graduation_operational_ref_unresolved");
      expect(operationalReferenceResolves(
        db,
        C4_OWNER,
        "operational_job:pending",
      )).toBe(false);
    } finally {
      db.close();
    }
  });

  it("invalidates a link when its operational evidence no longer resolves, without deleting history", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      const prediction = c4Prediction(db);
      const reservationId = deliveredReservation(db);
      const link = createLivedExperienceLink(db, {
        ownerId: C4_OWNER,
        predictionId: prediction.id,
        operationalRef: "delivery_reservation:" + reservationId,
        capabilityMode: "dark_apply",
      });
      db.prepare(
        "UPDATE delivery_bubbles SET discord_message_id = NULL, sent_at = NULL WHERE reservation_id = ?",
      ).run(reservationId);
      expect(refreshLivedExperienceLinkValidity(db, link.id, C4_TIME_1)).toBe(1);
      expect(listLivedExperienceLinks(db, C4_OWNER)[0]).toMatchObject({
        id: link.id,
        validityState: "invalidated",
        invalidatedAt: C4_TIME_1,
      });
      expect(db.prepare(
        "SELECT COUNT(*) AS count FROM lived_experience_links WHERE id = ?",
      ).get(link.id)).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});
