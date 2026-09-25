import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { applyConcernDelta, getConcern } from "./lineage.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { appendExternalUtteranceInTransaction } from "../evidence/conversation-log.js";
import { applyV021Forget } from "../memory/forget.js";

describe("v0.2.1 concern lineage", () => {
  it("keeps one concern statement and updates its snapshot", () => {
    const db = openTestSidecar();
    try {
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern-1", conversationId: "thread-1", statement: "What is HY3?",
          sourceTurnIds: ["turn-1"], dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
          assertionKey: "hy3", status: "active",
        },
      }, { cycleId: "cycle-1", generation: 1 });
      const first = getConcern(db, "concern-1");
      expect(first?.statement).toBe("What is HY3?");
      applyConcernDelta(db, { op: "resolve", concernId: "concern-1" }, { cycleId: "cycle-2", generation: 2 });
      expect(getConcern(db, "concern-1")?.status).toBe("resolved");
      expect(db.prepare("SELECT COUNT(*) AS count FROM concerns WHERE concern_id = 'concern-1'").get()).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("stores typed support separately while preserving legacy source turn ids", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread:concern-support";
      const source = "I am tracking the release date.";
      const evidence = appendOwnerUtterance(db, { conversationId, text: source, nowMs: 1 });
      const supportRef = {
        kind: "conversation_text_span" as const,
        evidenceRowId: evidence.rowId,
        start: 0,
        end: source.length,
        quote: source,
      };
      applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern:supported",
          conversationId,
          statement: "Track the release date.",
          sourceTurnIds: ["legacy-turn:release"],
          supportRefs: [supportRef],
          dimensions: { source: "owner_utterance", status: "asserted", time: "current", reliability: "owner_supplied" },
          assertionKey: "assertion:release",
          status: "active",
        },
      }, { cycleId: "cycle:supported", generation: 1 });

      expect(getConcern(db, "concern:supported")).toMatchObject({
        sourceTurnIds: ["legacy-turn:release"],
        supportRefs: [supportRef],
      });

      applyV021Forget(db, { topic: "tracking the release date", nowMs: 2 });
      expect(getConcern(db, "concern:supported")).toMatchObject({
        status: "active",
        sourceTurnIds: ["legacy-turn:release"],
        supportRefs: [{ ...supportRef, quote: "[redacted]" }],
      });
      expect(db.prepare("SELECT forgotten, cognitive_status FROM concerns WHERE concern_id = 'concern:supported'").get())
        .toEqual({ forgotten: 0, cognitive_status: "active" });
    } finally {
      db.close();
    }
  });

  it("rejects an external speaker as support for an Owner-attributed concern", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread:external-concern-support";
      const source = "An external person supplied this claim.";
      const evidence = appendExternalUtteranceInTransaction(db, {
        conversationId,
        text: source,
        speakerKind: "external_human",
        speakerPrincipalId: "person:external",
        nowMs: 1,
      }).evidence;
      expect(() => applyConcernDelta(db, {
        op: "upsert",
        record: {
          concernId: "concern:external-owner-attribution",
          conversationId,
          statement: "An Owner-attributed claim.",
          sourceTurnIds: [],
          supportRefs: [{
            kind: "conversation_text_span",
            evidenceRowId: evidence.rowId,
            start: 0,
            end: source.length,
            quote: source,
          }],
          dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
          assertionKey: null,
          status: "active",
        },
      }, { cycleId: "cycle:external-concern", generation: 1 })).toThrow("support_ref_owner_attribution_external");
    } finally {
      db.close();
    }
  });
});
