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
import { putInFlight, recordEffectReceipt } from "../effect/in-flight.js";
import { persistOrVerifyObservation } from "../observation/persistence.js";
import { projectFileArtifactIdentity } from "../observation/view.js";
import { textArtifactRepresentationId } from "../observation/view.js";
import { validateSourceSupportRefs } from "./interpretation-envelope.js";

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

function addReceipt(
  db: ReturnType<typeof openTestSidecar>,
  receiptId: string,
  conversationId = "thread-envelope",
) {
  const cycleId = `cycle-${receiptId}`;
  const triggerRef = `trigger-${receiptId}`;
  const cycle = admitTestCycle(db, {
    cycleId,
    conversationId,
    triggerKind: "owner_message",
    triggerRef,
    occupantId: "doc",
    authorityEpoch: 1,
    nowMs: 10,
  });
  const effect = putInFlight(db, {
    effectId: `effect-${receiptId}`,
    cycleId,
    generation: cycle.generation,
    correlationId: `correlation-${receiptId}`,
    idempotencyKey: `idempotency-${receiptId}`,
    originEventId: triggerRef,
  });
  recordEffectReceipt(db, {
    receiptId,
    effectId: effect.effectId,
    idempotencyKey: effect.idempotencyKey,
    outcome: "succeeded",
    claims: { executionTruth: "effect_verified" },
    atMs: 11,
    dataClassification: "never_public",
    secretOmitted: true,
  });
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
    { kind: "document_page_region", artifactId: "a1", representationId: "r1", page: 1 },
    { kind: "image_region", artifactId: "a1", representationId: "r1" },
    { kind: "structured_path", artifactId: "a1", representationId: "r1", path: "/x" },
  ])("fails closed for an unresolved $kind support reference", (support) => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-unimplemented", [
          { kind: "conversation_text_span", evidenceRowId: source.rowId, start: 0, end: 7, quote: "not yet" },
          support,
        ]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow(
        support.kind === "structured_path" ? "support_ref_unresolved" : "support_ref_kind_unimplemented",
      );
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("resolves JSON and CSV structured support paths against retained observations", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-structured-support",
        conversationId: "thread-envelope",
        triggerKind: "owner_message",
        triggerRef: "trigger-structured-support",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 10,
      });
      const jsonArtifactId = "artifact:attachment-json";
      const jsonRepresentationId = textArtifactRepresentationId(jsonArtifactId);
      persistOrVerifyObservation(db, {
        observationId: "observation-structured-json",
        cycleId: "cycle-structured-support",
        generation: 1,
        derived: false,
        replaySafe: true,
        modality: "text",
        payload: {
          format: "json",
          artifactId: jsonArtifactId,
          representationId: jsonRepresentationId,
          contentHash: "a".repeat(64),
          value: { profile: { name: "Ashley" } },
        },
        provenance: "perception:attachment",
        dataClassification: "never_public",
        secretOmitted: false,
        view: {
          parentArtifactId: jsonArtifactId,
          representationId: jsonRepresentationId,
          derivation: "attachment_ingest",
          requestedSelector: { kind: "json_path", path: "", maxItems: 64, maxChars: 8_000 },
          returnedSelector: { kind: "json_path", path: "", maxItems: 64, maxChars: 8_000 },
          completeness: "complete",
          errors: [],
          inputTrust: "untrusted_evidence",
        },
      }, 11);

      const csvArtifactId = "artifact:attachment-csv";
      const csvRepresentationId = textArtifactRepresentationId(csvArtifactId);
      persistOrVerifyObservation(db, {
        observationId: "observation-structured-csv",
        cycleId: "cycle-structured-support",
        generation: 1,
        derived: false,
        replaySafe: true,
        modality: "text",
        payload: {
          format: "csv",
          artifactId: csvArtifactId,
          representationId: csvRepresentationId,
          contentHash: "b".repeat(64),
          rows: [["name", "count"], ["Ashley", "2"]],
        },
        provenance: "perception:attachment",
        dataClassification: "never_public",
        secretOmitted: false,
        view: {
          parentArtifactId: csvArtifactId,
          representationId: csvRepresentationId,
          derivation: "attachment_ingest",
          requestedSelector: { kind: "csv_range", startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
          returnedSelector: { kind: "csv_range", startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
          completeness: "complete",
          errors: [],
          inputTrust: "untrusted_evidence",
        },
      }, 12);

      expect(validateSourceSupportRefs(db, [{
        kind: "structured_path",
        artifactId: jsonArtifactId,
        representationId: jsonRepresentationId,
        path: "/profile/name",
      }], "thread-envelope")).toEqual([{
        principalKind: "observation",
        principalId: null,
        sourceTimeMs: 11,
      }]);
      expect(validateSourceSupportRefs(db, [{
        kind: "structured_path",
        artifactId: csvArtifactId,
        representationId: csvRepresentationId,
        path: { row: 1, column: 1 },
      }], "thread-envelope")).toEqual([{
        principalKind: "observation",
        principalId: null,
        sourceTimeMs: 12,
      }]);
      expect(() => validateSourceSupportRefs(db, [{
        kind: "structured_path",
        artifactId: jsonArtifactId,
        representationId: jsonRepresentationId,
        path: "/profile/missing",
      }], "thread-envelope")).toThrow("support_ref_unresolved");
    } finally {
      db.close();
    }
  });

  it("resolves an artifact_text_span against a retained text representation and checks the exact quote", () => {
    const db = openTestSidecar();
    try {
      admitTestCycle(db, {
        cycleId: "cycle-artifact-text",
        conversationId: "thread-envelope",
        triggerKind: "owner_message",
        triggerRef: "trigger-artifact-text",
        occupantId: "doc",
        authorityEpoch: 1,
        nowMs: 10,
      });
      const identity = projectFileArtifactIdentity({
        projectId: "project-ashley",
        path: "README.md",
        rawByteHash: "a".repeat(64),
        capturedAtMs: 11,
      });
      const ownerSource = addOwnerSource(db, "owner basis");
      persistOrVerifyObservation(db, {
        observationId: "observation-artifact-text",
        cycleId: "cycle-artifact-text",
        generation: 1,
        derived: false,
        replaySafe: true,
        modality: "tool",
        payload: {
          projectId: "project-ashley",
          operation: "project.read_file",
          path: "README.md",
          verified: true,
          truncated: false,
          executedAtMs: 11,
          contentUtf8: "alpha beta",
          bytes: 10,
          sha256: "a".repeat(64),
        },
        provenance: "sandbox-v2:project-inspection",
        dataClassification: "never_public",
        secretOmitted: false,
        view: {
          ...identity,
          requestedSelector: { kind: "whole_file" },
          returnedSelector: { kind: "whole_file" },
          completeness: "complete",
          omission: null,
          continuation: null,
          errors: [],
          contentHashBasis: "raw_bytes",
        },
      }, 11);

      const support = {
        kind: "artifact_text_span",
        artifactId: identity.parentArtifactId,
        representationId: identity.representationId,
        start: 0,
        end: 5,
        quote: "alpha",
      };
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-artifact-text", [
          { kind: "conversation_text_span", evidenceRowId: ownerSource.rowId, start: 0, end: 11, quote: "owner basis" },
          support,
        ]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).not.toThrow();
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-artifact-text-mismatch", [
          { kind: "conversation_text_span", evidenceRowId: ownerSource.rowId, start: 0, end: 11, quote: "owner basis" },
          { ...support, quote: "wrong" },
        ]),
      }, { cycleId: "cycle-publish", generation: 1, nowMs: 20 })).toThrow("support_ref_unresolvable");
    } finally {
      db.close();
    }
  });

  it("resolves a same-conversation receipt as effect evidence", () => {
    const db = openTestSidecar();
    try {
      addReceipt(db, "receipt-same-conversation");
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-receipt-support", [{ kind: "receipt_ref", receiptId: "receipt-same-conversation" }], {
          kind: "descriptive_belief",
        }),
      }, { cycleId: "cycle-publish", generation: 2, nowMs: 20 });

      expect(listWorkingContext(db, "thread-envelope")[0]?.interpretationEnvelope).toMatchObject({
        attribution: { principalKind: "receipt", principalId: null },
        support: [{ kind: "receipt_ref", receiptId: "receipt-same-conversation" }],
      });
    } finally {
      db.close();
    }
  });

  it("does not let a receipt reference satisfy a directive Owner-span requirement", () => {
    const db = openTestSidecar();
    try {
      addReceipt(db, "receipt-not-owner-span");
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-receipt-only-directive", [{ kind: "receipt_ref", receiptId: "receipt-not-owner-span" }]),
      }, { cycleId: "cycle-publish", generation: 2, nowMs: 20 })).toThrow("support_ref_principal_invalid");
      expect(listWorkingContext(db, "thread-envelope")).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("rejects a receipt outside the caller conversation", () => {
    const db = openTestSidecar();
    try {
      addReceipt(db, "receipt-other-conversation", "thread-other");
      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-cross-conversation-receipt", [{ kind: "receipt_ref", receiptId: "receipt-other-conversation" }], {
          kind: "descriptive_belief",
        }),
      }, { cycleId: "cycle-publish", generation: 2, nowMs: 20 })).toThrow("support_ref_unresolvable");
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

  it("requires new evidence when an interpretation revises an existing row", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db);
      const ref = {
        kind: "conversation_text_span" as const,
        evidenceRowId: source.rowId,
        start: 0,
        end: 7,
        quote: "not yet",
      };
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-revision-evidence-prior", [ref]),
      }, { cycleId: "cycle-prior", generation: 1, nowMs: 20 });
      const newSource = addOwnerSource(db, "updated boundary");
      const newRef = {
        kind: "conversation_text_span" as const,
        evidenceRowId: newSource.rowId,
        start: 0,
        end: "updated boundary".length,
        quote: "updated boundary",
      };

      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-revision-evidence-missing", [ref], {
          revisionOf: "wc-revision-evidence-prior",
        }),
      }, { cycleId: "cycle-revision", generation: 2, nowMs: 21 })).toThrow("interpretation_revision_evidence_required");

      expect(() => applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-revision-requires-supersede", [ref], {
          revisionOf: "wc-revision-evidence-prior",
          revisionEvidenceRefs: [newRef],
        }),
      }, { cycleId: "cycle-revision", generation: 2, nowMs: 21 }))
        .toThrow("interpretation_revision_requires_supersede");
    } finally {
      db.close();
    }
  });

  it("marks a current interpretation for review when its source becomes inaccessible", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db, "source that will disappear");
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-inaccessible-source", [{
          kind: "conversation_text_span",
          evidenceRowId: source.rowId,
          start: 0,
          end: "source that will disappear".length,
          quote: "source that will disappear",
        }]),
      }, { cycleId: "cycle-source", generation: 1, nowMs: 20 });
      db.prepare("DELETE FROM conversation_evidence_log WHERE row_id = ?").run(source.rowId);

      expect(listWorkingContext(db, "thread-envelope")).toMatchObject([{
        id: "wc-inaccessible-source",
        text: "Until further notice.",
        interpretationEnvelope: {
          supportAvailability: "unavailable",
          supportUnavailableReason: "source_inaccessible",
          applicabilityLifecycle: "needs_review",
        },
      }]);
    } finally {
      db.close();
    }
  });

  it("records a redacted source as unavailable without treating it as a withdrawal", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db, "redacted source text");
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-redacted-source", [{
          kind: "conversation_text_span",
          evidenceRowId: source.rowId,
          start: 0,
          end: "redacted source text".length,
          quote: "redacted source text",
        }]),
      }, { cycleId: "cycle-source", generation: 1, nowMs: 20 });
      db.prepare("UPDATE conversation_evidence_log SET text = NULL, source_status = 'redacted' WHERE row_id = ?")
        .run(source.rowId);

      expect(listWorkingContext(db, "thread-envelope")).toMatchObject([{
        id: "wc-redacted-source",
        status: "active",
        interpretationEnvelope: {
          supportAvailability: "unavailable",
          supportUnavailableReason: "source_redacted",
          applicabilityLifecycle: "needs_review",
        },
      }]);
    } finally {
      db.close();
    }
  });

  it("marks the prior revision superseded and dependent interpretations for review", () => {
    const db = openTestSidecar();
    try {
      const originalSource = addOwnerSource(db, "not yet");
      const replacementSource = addOwnerSource(db, "not anymore");
      const originalRef = {
        kind: "conversation_text_span" as const,
        evidenceRowId: originalSource.rowId,
        start: 0,
        end: 7,
        quote: "not yet",
      };
      const replacementRef = {
        kind: "conversation_text_span" as const,
        evidenceRowId: replacementSource.rowId,
        start: 0,
        end: "not anymore".length,
        quote: "not anymore",
      };
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-original", [originalRef]),
      }, { cycleId: "cycle-original", generation: 1, nowMs: 20 });
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-dependent", [originalRef], {
          kind: "descriptive_belief",
          derivationParents: ["wc-original"],
        }),
      }, { cycleId: "cycle-dependent", generation: 2, nowMs: 21 });

      expect(() => applyWorkingContextDelta(db, {
        op: "supersede",
        id: "wc-original",
        replacement: directive("wc-same-evidence", [originalRef], {
          revisionOf: "wc-original",
          revisionEvidenceRefs: [originalRef],
        }),
      }, { cycleId: "cycle-same-evidence", generation: 3, nowMs: 22 }))
        .toThrow("interpretation_revision_evidence_not_new");

      applyWorkingContextDelta(db, {
        op: "supersede",
        id: "wc-original",
        replacement: directive("wc-replacement", [replacementRef], {
          revisionOf: "wc-original",
          revisionEvidenceRefs: [replacementRef],
        }),
      }, { cycleId: "cycle-replacement", generation: 3, nowMs: 22 });

      const rows = listWorkingContext(db, "thread-envelope", { includeSuperseded: true });
      expect(listWorkingContext(db, "thread-envelope").some((row) => row.id === "wc-original")).toBe(false);
      expect(rows.find((row) => row.id === "wc-original")).toMatchObject({
        status: "superseded",
        interpretationEnvelope: { applicabilityLifecycle: "superseded" },
      });
      expect(rows.find((row) => row.id === "wc-replacement")).toMatchObject({
        status: "active",
        interpretationEnvelope: {
          revisionOf: "wc-original",
          revisionEvidenceRefs: [replacementRef],
          applicabilityLifecycle: "current",
        },
      });
      expect(rows.find((row) => row.id === "wc-dependent")).toMatchObject({
        interpretationEnvelope: {
          applicabilityLifecycle: "needs_review",
          supportAvailability: "intact",
        },
      });
    } finally {
      db.close();
    }
  });

  it("uses structured abandon as withdrawal without redacting its source", () => {
    const db = openTestSidecar();
    try {
      const source = addOwnerSource(db, "not yet");
      applyWorkingContextDelta(db, {
        op: "upsert",
        item: directive("wc-withdrawn", [{
          kind: "conversation_text_span",
          evidenceRowId: source.rowId,
          start: 0,
          end: 7,
          quote: "not yet",
        }]),
      }, { cycleId: "cycle-withdraw", generation: 1, nowMs: 20 });

      applyWorkingContextDelta(db, { op: "abandon", id: "wc-withdrawn" }, {
        cycleId: "cycle-withdraw", generation: 2, nowMs: 21,
      });

      expect(listWorkingContext(db, "thread-envelope", { includeSuperseded: true })[0]).toMatchObject({
        id: "wc-withdrawn",
        status: "abandoned",
        interpretationEnvelope: { applicabilityLifecycle: "withdrawn" },
      });
      expect(db.prepare("SELECT text, source_status FROM conversation_evidence_log WHERE row_id = ?").get(source.rowId))
        .toMatchObject({ text: "not yet", source_status: "received" });
    } finally {
      db.close();
    }
  });
});
