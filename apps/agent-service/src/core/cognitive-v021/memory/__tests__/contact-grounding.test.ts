import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { admitTestCycle, makeThoughtDraft, openTestSidecar } from "../../test-support.js";
import { appendExternalUtteranceInTransaction } from "../../evidence/conversation-log.js";
import { publishSemanticTransaction } from "../../settlement/publish.js";
import { runGovernedAdmissionCatchup } from "../admission.js";
import { getMemoryAssertion } from "../assertions.js";
import { isGroundedForKind } from "../grounding.js";
import type { DurableNomination, MemoryKind, SourceSupportRef } from "../../types.js";

const CONTACT = "contact-mara";
const DM = `dm:${CONTACT}`;
const TEXT = "I'm moving to Lisbon next spring for a new job";

function fixture(): { db: DatabaseSync; rowId: string } {
  const db = openTestSidecar();
  const evidence = appendExternalUtteranceInTransaction(db, {
    conversationId: DM,
    text: TEXT,
    discordMessageIds: ["contact-msg-1"],
    speakerPrincipalId: CONTACT,
    speakerKind: "external_human",
    audienceAtCapture: "dm",
    location: { kind: "external_dm", principalId: CONTACT, channelId: "dm-channel-mara" },
    nowMs: 1,
  }).evidence;
  admitTestCycle(db, {
    cycleId: "cycle-contact",
    conversationId: DM,
    generation: 1,
    triggerKind: "external_message",
    triggerRef: evidence.rowId,
    occupantId: CONTACT,
    nowMs: 1,
  });
  return { db, rowId: evidence.rowId };
}

function span(rowId: string, quote: string): SourceSupportRef {
  const start = TEXT.indexOf(quote);
  return { kind: "conversation_text_span", evidenceRowId: rowId, start, end: start + quote.length, quote };
}

function nomination(kind: MemoryKind, rowId: string, owner: boolean): DurableNomination {
  return {
    nominationId: `nomination-contact-${kind}`,
    cycleId: "cycle-contact",
    generation: 1,
    assertionKey: `key:contact:${kind}`,
    statement: "Mara told me she is moving to Lisbon next spring.",
    memoryKind: kind,
    dimensions: owner
      ? { source: "owner_utterance", status: "asserted", time: "unknown_freshness", reliability: "owner_supplied" }
      // Her record of what the contact said; the source principal carries attribution.
      : { source: "ashley_interpretation", status: "interpreted", time: "historical", reliability: "inferred" },
    dataClassification: "ordinary",
    supersedesAssertionKey: null,
    concernId: null,
    sourceRefs: [],
    supportRefs: [span(rowId, "moving to Lisbon next spring")],
  } as DurableNomination;
}

function publish(db: DatabaseSync, values: DurableNomination[]): void {
  const draft = makeThoughtDraft({
    cycleId: "cycle-contact",
    generation: 1,
    speech: { mode: "none", mustSay: [], mustNot: [], surfaceDraft: null, acceptableRealizations: [], presentationDirectives: [] },
    operations: { ...makeThoughtDraft().operations, observationsConsumed: [] },
    durableNominations: values,
  });
  expect(publishSemanticTransaction(db, { ...draft, settlementId: "settlement-contact", speech: { ...draft.speech, finalLicensedText: null } }).published).toBe(true);
}

describe("A3/A9 contact memory", () => {
  it("remembers what a contact said, attributed to them and scoped to their DM", () => {
    const { db, rowId } = fixture();
    try {
      publish(db, [nomination("shared_episode", rowId, false)]);
      runGovernedAdmissionCatchup(db, { nowMs: 5 });
      const assertion = getMemoryAssertion(db, "key:contact:shared_episode");
      expect(assertion?.live).toBe(true);
      expect(assertion?.audienceScope).toEqual({ kind: "dm", principalId: CONTACT });
      expect(assertion?.sourcePrincipal).toBe(CONTACT);
    } finally {
      db.close();
    }
  });

  it("never lets a contact's words ground a memory about the Owner", () => {
    const { db, rowId } = fixture();
    try {
      publish(db, [nomination("owner_preference", rowId, true), nomination("owner_world_claim", rowId, false)]);
      runGovernedAdmissionCatchup(db, { nowMs: 5 });
      expect(getMemoryAssertion(db, "key:contact:owner_preference")?.live ?? false).toBe(false);
      expect(getMemoryAssertion(db, "key:contact:owner_world_claim")?.live ?? false).toBe(false);
    } finally {
      db.close();
    }
  });

  it("does not accept a contact quote outside a social conversation, nor web text for a memory about the Owner", () => {
    const quote: SourceSupportRef = { kind: "conversation_text_span", evidenceRowId: "r", start: 0, end: 1, quote: "x" };
    const contact = [{ principalKind: "external_human" }];
    expect(isGroundedForKind("shared_episode", [quote], contact, { socialConversation: true })).toBe(true);
    expect(isGroundedForKind("shared_episode", [quote], contact, { socialConversation: false })).toBe(false);
    const page = { kind: "observation_ref", observationId: "obs-page" } as unknown as SourceSupportRef;
    for (const kind of ["owner_preference", "owner_self_description", "owner_goal", "relational_boundary", "commitment"] as const) {
      expect(isGroundedForKind(kind, [page], [{ principalKind: "observation" }], { socialConversation: false })).toBe(false);
    }
  });
});
