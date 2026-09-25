import { describe, expect, it } from "vitest";
import { openTestSidecar } from "../test-support.js";
import { appendMemorySupport, listMemorySupports } from "./supports.js";
import { appendExternalUtteranceInTransaction, appendOwnerUtterance } from "../evidence/conversation-log.js";

describe("v0.2.1 Memory support lineage", () => {
  it("accumulates support rows without overwriting epistemic provenance", () => {
    const db = openTestSidecar();
    try {
      const base = {
        assertionKey: "owner:model",
        source: "owner_utterance" as const,
        provenance: "native" as const,
        sourceArchitectureEpoch: "v0.2.1" as const,
        sourceRef: "evidence-1",
        settlementId: "settlement-1",
        evidenceLineageId: "lineage-1",
        observationId: null,
        receiptId: null,
        dimensions: { source: "owner_utterance" as const, status: "asserted" as const, time: "current" as const, reliability: "owner_supplied" as const },
        dataClassification: "never_public" as const,
      };
      appendMemorySupport(db, { ...base, supportId: "support-1", createdAtMs: 1 });
      appendMemorySupport(db, { ...base, supportId: "support-2", source: "tool", sourceRef: "observation-1", observationId: "observation-1", dimensions: { ...base.dimensions, source: "tool", reliability: "fallible_observation" }, createdAtMs: 2 });
      expect(listMemorySupports(db, "owner:model")).toHaveLength(2);
      expect(listMemorySupports(db, "owner:model")[1]).toMatchObject({ source: "tool", observationId: "observation-1" });
    } finally {
      db.close();
    }
  });

  it("stores validated typed support beside the legacy source ref and rejects unsupported or misattributed refs", () => {
    const db = openTestSidecar();
    try {
      const conversationId = "thread:typed-support";
      const source = "I prefer careful explanations.";
      const evidence = appendOwnerUtterance(db, { conversationId, text: source, nowMs: 1 });
      const supportRef = {
        kind: "conversation_text_span" as const,
        evidenceRowId: evidence.rowId,
        start: 0,
        end: source.length,
        quote: source,
      };
      const support = appendMemorySupport(db, {
        supportId: "support:typed-owner",
        assertionKey: "assertion:typed-owner",
        source: "owner_utterance",
        provenance: "native",
        sourceArchitectureEpoch: "v0.2.1",
        sourceRef: "legacy-turn:one",
        settlementId: null,
        evidenceLineageId: evidence.lineageId,
        observationId: null,
        receiptId: null,
        dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        dataClassification: "never_public",
        supportRef,
        conversationId,
      });

      expect(support).toMatchObject({ sourceRef: "legacy-turn:one", supportRef });
      expect(db.prepare("SELECT support_ref_json FROM sidecar_memory_supports WHERE support_id = ?")
        .get("support:typed-owner")).toEqual({ support_ref_json: JSON.stringify(supportRef) });

      expect(() => appendMemorySupport(db, {
        supportId: "support:unsupported",
        assertionKey: "assertion:typed-owner",
        source: "owner_utterance",
        provenance: "native",
        sourceArchitectureEpoch: "v0.2.1",
        sourceRef: null,
        settlementId: null,
        evidenceLineageId: null,
        observationId: null,
        receiptId: null,
        dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        dataClassification: "never_public",
        supportRef: { kind: "artifact_text_span", artifactId: "artifact:later", representationId: "text:later", start: 0, end: 5, quote: "later" },
        conversationId,
      })).toThrow("support_ref_kind_unimplemented");

      const external = appendExternalUtteranceInTransaction(db, {
        conversationId,
        text: "An external speaker said this.",
        speakerKind: "external_human",
        speakerPrincipalId: "person:external",
        nowMs: 2,
      }).evidence;
      expect(() => appendMemorySupport(db, {
        supportId: "support:external-owner",
        assertionKey: "assertion:typed-owner",
        source: "owner_utterance",
        provenance: "native",
        sourceArchitectureEpoch: "v0.2.1",
        sourceRef: null,
        settlementId: null,
        evidenceLineageId: external.lineageId,
        observationId: null,
        receiptId: null,
        dimensions: { source: "owner_utterance", status: "asserted", time: "historical", reliability: "owner_supplied" },
        dataClassification: "never_public",
        supportRef: { kind: "conversation_text_span", evidenceRowId: external.rowId, start: 0, end: external.text!.length, quote: external.text! },
        conversationId,
      })).toThrow("memory_support_owner_attribution_external");
    } finally {
      db.close();
    }
  });
});
