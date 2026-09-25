import { describe, expect, it } from "vitest";
import {
  appendAshleyEvidence,
  appendExternalUtteranceInTransaction,
  appendOwnerUtterance,
} from "./conversation-log.js";
import { applyWorkingContextDelta, listWorkingContext } from "./working-context.js";
import { admitTestCycle, openTestSidecar } from "../test-support.js";
import type { WorkingContextDelta } from "../types.js";
import { parseThoughtSemanticOutput } from "../thought/parse.js";

function directive(id: string, support: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: "thread-envelope",
    type: "owner_teaching",
    text: "Until further notice.",
    concernId: null,
    sourceTurnIds: [],
    status: "active",
    supersedesId: null,
    interpretationEnvelope: {
      kind: "directive_interpretation",
      support,
      audience: { kind: "unknown" },
      applicability: {
        subject: "Ashley",
        target: "this conversation",
        conversationId: "thread-envelope",
        concernId: null,
      },
      boundaryBasis: { temporal: "inferred" },
      applicabilityInterval: { until: "unknown" },
      conditions: { text: "", unresolved: false },
      derivationParents: [],
      revisionOf: null,
      revisionEvidenceRefs: [],
      ...overrides,
    },
  } as unknown as WorkingContextDelta extends { op: "upsert"; item: infer I } ? I : never;
}

function addOwnerSource(db: ReturnType<typeof openTestSidecar>, text = "not yet") {
  return appendOwnerUtterance(db, {
    conversationId: "thread-envelope",
    text,
    nowMs: 10,
    audienceAtCapture: "owner_private",
  });
}

function addObservation(db: ReturnType<typeof openTestSidecar>, observationId: string) {
  admitTestCycle(db, {
    cycleId: "cycle-envelope",
    conversationId: "thread-envelope",
    triggerKind: "owner_message",
    triggerRef: "trigger-envelope",
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 10,
  });
  db.prepare(
    `INSERT INTO observations
       (observation_id, cycle_id, generation, derived, replay_safe, modality,
        payload_json, provenance, data_classification, secret_omitted, created_at_ms)
     VALUES (?, 'cycle-envelope', 1, 0, 1, 'text', '{}', 'test', 'ordinary', 0, 11)`,
  ).run(observationId);
}

describe("Working Context interpretation envelope", () => {
  it("accepts the typed semantic envelope and rejects Host authority fields", () => {
    const envelope = {
      kind: "directive_interpretation",
      support: [{ kind: "conversation_text_span", evidenceRowId: "turn-1", start: 0, end: 7, quote: "not yet" }],
      audience: { kind: "unknown" },
      applicability: { subject: "Ashley", target: "this conversation", conversationId: "thread-envelope", concernId: null },
      boundaryBasis: { temporal: "inferred" },
      applicabilityInterval: { until: "unknown" },
      conditions: { text: "", unresolved: false },
      derivationParents: [],
      revisionOf: null,
      revisionEvidenceRefs: [],
    };
    const item = {
      identity: { kind: "local", alias: "directive-1" },
      type: "owner_teaching",
      text: "Until further notice.",
      concernRef: null,
      sourceTurnRefs: ["turn-1"],
      status: "active",
      supersedesRef: null,
      interpretationEnvelope: envelope,
    };
    const base = { kind: "settlement", speech: { mode: "draft", surfaceDraft: "Understood." } };
    expect(parseThoughtSemanticOutput({ ...base, workingContextDeltas: [{ op: "upsert", item }] }, new Set(["turn-1"])))
      .toMatchObject({ ok: true });
    expect(parseThoughtSemanticOutput({
      ...base,
      workingContextDeltas: [{ op: "upsert", item: {
        ...item,
        interpretationEnvelope: { ...envelope, hostGrant: true },
      } }],
    }, new Set(["turn-1"]))).toMatchObject({ ok: false, field: "workingContextDeltas" });
    expect(parseThoughtSemanticOutput({
      ...base,
      workingContextDeltas: [{ op: "upsert", item: {
        ...item,
        interpretationEnvelope: { ...envelope, support: [{ kind: "observation_ref", observationId: "obs-1", quote: "forged" }] },
      } }],
    }, new Set(["turn-1"]))).toMatchObject({ ok: false, field: "workingContextDeltas" });
  });

  it("publishes an exact Owner span with Host-resolved attribution and publication metadata", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-directive", [{
          kind: "conversation_text_span",
          evidenceRowId: source.rowId,
          start: 0,
          end: 7,
          quote: "not yet",
        }]),
      }, { cycleId: "cycle-publish", generation: 4, nowMs: 20 });

      const item = listWorkingContext(db, "thread-envelope")[0]!;
      expect(item).toMatchObject({
        id: "wc-directive",
        text: "Until further notice.",
        interpretationEnvelope: {
          owningRecordId: "wc-directive",
          revision: 4,
          authoringCycleId: "cycle-publish",
          kind: "directive_interpretation",
          supportAvailability: "intact",
          attribution: { principalKind: "owner" },
          audience: { kind: "unknown" },
          sourceTimeMs: 10,
          interpretationTimeMs: 20,
          applicabilityInterval: { until: "unknown" },
        },
      });
      expect(db.prepare(
        "SELECT applicability_lifecycle, audience_state, legacy_scope FROM working_context_items WHERE id = ?",
      ).get("wc-directive")).toEqual({
        applicability_lifecycle: "current",
        audience_state: "unknown",
        legacy_scope: null,
      });
    } finally {
      db.close();
    }
  });

  it("rejects a quote that is not an exact source substring before persisting", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-bad-quote", [{
          kind: "conversation_text_span",
          evidenceRowId: source.rowId,
          start: 0,
          end: 7,
          quote: "not yet, really",
        }]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow("support_ref_quote_mismatch");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("requires an owner span instead of accepting sourceTurnIds as proof", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      const item = directive("wc-turn-id-only", [], { kind: "directive_interpretation" }) as any;
      item.sourceTurnIds = [source.rowId];
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item,
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow("support_ref_principal_invalid");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects a citation whose evidence row is no longer current", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      appendOwnerUtterance(db, {
        conversationId: "thread-envelope",
        text: "not yet, but changed",
        editOfRowId: source.rowId,
        nowMs: 11,
        audienceAtCapture: "owner_private",
      });
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-stale-source", [{
          kind: "conversation_text_span",
          evidenceRowId: source.rowId,
          start: 0,
          end: 7,
          quote: "not yet",
        }]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow("support_ref_not_current");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects Ashley and external speaker rows as directive Owner spans", () => {
    const db = openTestSidecar();
    try {
      const ashley = appendAshleyEvidence(db, {
        conversationId: "thread-envelope",
        text: "I will do that.",
        nowMs: 12,
      });
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-ashley-source", [{
          kind: "conversation_text_span",
          evidenceRowId: ashley.rowId,
          start: 0,
          end: 15,
          quote: "I will do that.",
        }]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow("support_ref_principal_invalid");
      db.exec("BEGIN");
      const external = appendExternalUtteranceInTransaction(db, {
        conversationId: "thread-envelope",
        text: "Do this externally.",
        nowMs: 13,
        speakerKind: "external_human",
      }).evidence;
      db.exec("COMMIT");
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-external-source", [{
          kind: "conversation_text_span",
          evidenceRowId: external.rowId,
          start: 0,
          end: 19,
          quote: "Do this externally.",
        }]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow("support_ref_principal_invalid");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it.each([
    { kind: "artifact_text_span", artifactId: "a1", representationId: "r1", start: 0, end: 1, quote: "x" },
    { kind: "document_page_region", artifactId: "a1", representationId: "r1", page: 1 },
    { kind: "image_region", artifactId: "a1", representationId: "r1" },
    { kind: "structured_path", artifactId: "a1", representationId: "r1", path: "/x" },
    { kind: "receipt_ref", receiptId: "receipt-1" },
  ])("fails closed for the unimplemented $kind support reference", (support) => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-unimplemented", [
          { kind: "conversation_text_span", evidenceRowId: source.rowId, start: 0, end: 7, quote: "not yet" },
          support,
        ]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow("support_ref_kind_unimplemented");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects a bare selector and a quote attached to a non-textual support", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      for (const invalidSupport of [
        { selector: { table: "observations", id: "x" } },
        { kind: "observation_ref", observationId: "obs-1", quote: "forged" },
      ]) {
        expect(() => applyWorkingContextDelta(db, {
          op: "upsert",
          item: directive("wc-invalid-support", [
            { kind: "conversation_text_span", evidenceRowId: source.rowId, start: 0, end: 7, quote: "not yet" },
            invalidSupport,
          ]),
        }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow();
      }
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("accepts a visible same-conversation observation as support without attributing it as an Owner span", () => {
    const db = openTestSidecar();
    try {
      addObservation(db, "obs-same-audience");
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-observation-support", [{ kind: "observation_ref", observationId: "obs-same-audience" }], {
          kind: "descriptive_belief",
          applicabilityInterval: { until: "unknown" },
        }),
      }, { cycleId: "cycle-publish", generation: 2, nowMs: 20 });
      expect(listWorkingContext(db, "thread-envelope")[0]?.interpretationEnvelope).toMatchObject({
        attribution: { principalKind: "observation", principalId: null },
        support: [{ kind: "observation_ref", observationId: "obs-same-audience" }],
      });
    } finally {
      db.close();
    }
  });

  it("rejects a missing observation reference", () => {
    const db = openTestSidecar();
    try {
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-missing-observation", [{ kind: "observation_ref", observationId: "missing" }], {
          kind: "descriptive_belief",
        }),
      }, { cycleId: "cycle-publish", generation: 2, nowMs: 20 })).toThrow("support_ref_unresolvable");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects an unresolved revision target", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-invalid-revision", [{
          kind: "conversation_text_span",
          evidenceRowId: source.rowId,
          start: 0,
          end: 7,
          quote: "not yet",
        }], { revisionOf: "missing-working-context-row" }),
      }, { cycleId: "cycle-publish", generation: 2, nowMs: 20 })).toThrow("interpretation_revision_unresolvable");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });
});
