import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../../db.js";
import {
  adaptOwnTimeSession,
  type OwnTimeSessionCandidate,
} from "../own-time-adapter.js";

function insertSession(
  db: DatabaseSync,
  input: {
    ownerId: string;
    startedAt: string;
    endedAt?: string | null;
    startMessageId?: number | null;
    endMessageId?: number | null;
  },
): number {
  const result = db.prepare(
    "INSERT INTO own_time_sessions (owner_id, started_at, ended_at, start_message_id, end_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    input.ownerId,
    input.startedAt,
    input.endedAt ?? null,
    input.startMessageId ?? null,
    input.endMessageId ?? null,
    input.startedAt,
  );
  return Number(result.lastInsertRowid);
}

function close(db: DatabaseSync): void {
  db.close();
}

describe("MAT-II own-time C2 adapter", () => {
  it("projects the latest explicit open session as a compact pointer", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      insertSession(db, {
        ownerId: "doc",
        startedAt: "2026-09-04T08:00:00.000Z",
        endedAt: "2026-09-04T09:00:00.000Z",
        startMessageId: 10,
        endMessageId: 11,
      });
      const openId = insertSession(db, {
        ownerId: "doc",
        startedAt: "2026-09-04T10:00:00.000Z",
        startMessageId: 12,
      });

      const candidate = adaptOwnTimeSession(db, "doc");

      expect(candidate).toMatchObject<Partial<OwnTimeSessionCandidate>>({
        domain: "own_time",
        canonicalStore: "nuclear.db:own_time_sessions",
        entityIds: [String(openId)],
        status: "open",
        disposition: "POINTER_ONLY",
        pointerOnly: true,
        sessionId: openId,
        startedAt: "2026-09-04T10:00:00.000Z",
        endedAt: null,
        startMessageId: 12,
        endMessageId: null,
      });
      expect(candidate.updatedAtMs).toBe(Date.parse("2026-09-04T10:00:00.000Z"));
      expect(candidate).not.toHaveProperty("durationMs");
    } finally {
      close(db);
    }
  });

  it("uses the latest completed boundary and does not infer activity from time alone", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      insertSession(db, {
        ownerId: "doc",
        startedAt: "2026-09-01T08:00:00.000Z",
        endedAt: "2026-09-01T09:00:00.000Z",
      });
      const latestId = insertSession(db, {
        ownerId: "doc",
        startedAt: "2026-09-03T08:00:00.000Z",
        endedAt: "2026-09-03T12:00:00.000Z",
      });

      expect(adaptOwnTimeSession(db, "doc")).toMatchObject({
        entityIds: [String(latestId)],
        status: "completed",
        disposition: "POINTER_ONLY",
        sessionId: latestId,
        startedAt: "2026-09-03T08:00:00.000Z",
        endedAt: "2026-09-03T12:00:00.000Z",
      });
      expect(adaptOwnTimeSession(db, "another-owner")).toMatchObject({
        entityIds: [],
        status: "empty",
        disposition: "EMPTY",
        pointerOnly: false,
        sessionId: null,
        startedAt: null,
        endedAt: null,
        updatedAtMs: null,
      });
    } finally {
      close(db);
    }
  });

  it("reports an own-time store failure as UNREACHABLE without throwing", () => {
    const db = openNuclearDb(new DatabaseSync(":memory:"));
    try {
      db.exec("DROP TABLE own_time_sessions");

      expect(adaptOwnTimeSession(db, "doc")).toMatchObject({
        domain: "own_time",
        canonicalStore: "nuclear.db:own_time_sessions",
        entityIds: [],
        status: "unreachable",
        disposition: "UNREACHABLE",
        pointerOnly: false,
        sessionId: null,
        startedAt: null,
        endedAt: null,
      });
    } finally {
      close(db);
    }
  });
});
