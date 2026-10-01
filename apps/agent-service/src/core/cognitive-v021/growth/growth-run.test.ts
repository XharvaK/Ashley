import { GROWTH_GUIDANCE } from "../thought/output-contract.js";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { openNuclearDb } from "../../db.js";
import { appendInboxEvent } from "../cycle/inbox.js";
import { appendOwnerUtterance } from "../evidence/conversation-log.js";
import { readIdentitySlice } from "../identity/constitution.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { recordMemoryFormation } from "../memory/strength.js";
import { admitTestCycle, makeSemanticSettlement, openTestSidecar } from "../test-support.js";
import type { CapabilityReality, KernelDeps } from "../types.js";
import { runCognitiveCycle } from "../thought/run.js";
import { readMood } from "./mood.js";
import { listOpenExpectations } from "./expectations.js";
import { listCurrentOpinions } from "./revisions.js";
import { tickNight } from "../initiative/night.js";
import { listRecentJournal } from "../initiative/journal.js";
import { recordInterestTouches } from "../memory/interests.js";
import { listIdentity } from "../../identity/store.js";
import { listDiary } from "./night.js";

const capabilityReality: CapabilityReality = {
  vision: false, attachmentText: false, conversationalRead: false, webSearch: false,
  canOfferProjectInspection: false, canOfferWorkspace: false, canOfferVerification: false,
  canOfferAuthorship: false, canOfferBoundedOperation: false, canOfferInquiry: false, canOfferPatchExport: false,
  approvedProjectIds: [],
};
const dimensions = { source: "ashley_interpretation" as const, status: "interpreted" as const, time: "current" as const, reliability: "inferred" as const };
const NOW = Date.UTC(2026, 9, 1, 12, 0);

function deps(nuclear: DatabaseSync, overrides: Partial<KernelDeps>): KernelDeps {
  return {
    nowMs: () => NOW,
    attentionDb: openTestSidecar(),
    completeChat: vi.fn(async () => ({ text: "{}", model: "fake", modelAlias: "fake", resolvedModelId: null })),
    runPerception: vi.fn(async () => []),
    executeObservation: vi.fn(),
    executeEffect: vi.fn(),
    checkAuthority: () => ({ ok: true }),
    loadAuthorityPacks: () => ({
      epistemic: { allowInferredWorldClaims: false }, currentness: { requireObservationForLatest: true },
      receipt: { receiptsByEffectId: {} }, capability: capabilityReality,
      operational: { sandboxAvailable: false }, relational: { withdrawalActive: false, neverMention: [] },
      stateEpoch: { authorityEpoch: 1 },
    }),
    expressionEnabled: false,
    projectOutbox: vi.fn(async () => undefined),
    constitution: { constitutional: [], stableSelf: [] },
    readConstitution: () => readIdentitySlice(nuclear, "doc"),
    identityOwnerId: "doc",
    capabilityReality,
    ...overrides,
  };
}

function ownerTurn(sidecar: DatabaseSync, conversationId: string, ref: string, text: string, nowMs: number) {
  const cycle = admitTestCycle(sidecar, { conversationId, triggerKind: "owner_message", triggerRef: ref, occupantId: "doc", authorityEpoch: 1, nowMs });
  const message = appendOwnerUtterance(sidecar, { conversationId, text, nowMs, audienceAtCapture: "owner_private" });
  return appendInboxEvent(sidecar, {
    wakeId: cycle.wakeId,
    conversationId,
    kind: "owner_utterance",
    payload: { cycleId: cycle.cycleId, evidenceRowId: message.rowId, ownerId: "doc", ownerMessage: message.text },
    createdAtMs: nowMs,
  });
}

describe("Growth V1 G4 through the kernel", () => {
  it("shows Ashley her growth, records what she authors, and applies an earned opinion", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-growth-run";
    for (const [key, statement] of [["self:g1", "I light up talking about Basic Channel."], ["self:g2", "Music history threads are my favourite."]] as const) {
      upsertMemoryAssertion(sidecar, { assertionKey: key, statement, memoryKind: "learned_self_evidence", dimensions, dataClassification: "ordinary", lineageParentKey: null, admittedGeneration: 1, live: true });
      recordMemoryFormation(sidecar, { assertionKey: key, salience: 0.7, nowMs: NOW - 60_000 });
    }
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify(makeSemanticSettlement({
        speech: { mode: "draft", surfaceDraft: "Good luck with the interview." },
        commitments: { conversational: ["acknowledge"] },
        growth: {
          appraisal: { note: "Alex trusting me with the interview nerves moved me.", valence: 0.5, openness: 0.2 },
          expectations: ["Alex will tell me how the interview went on Friday."],
          revisions: [{ layer: "opinion", topic: "music history", text: "Music history is the best way into a genre.", rationale: "It keeps being what I reach for.", evidenceRefs: ["self:g1", "self:g2"] }],
        },
      })),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      const run = await runCognitiveCycle(sidecar, nuclear, ownerTurn(sidecar, conversationId, "m1", "interview on Friday, nervous", NOW), deps(nuclear, { completeChat }));
      expect(run.outboxId).not.toBeNull();

      const request = JSON.stringify(completeChat.mock.calls[0]?.[0]);
      expect(request).toContain(JSON.stringify(GROWTH_GUIDANCE).slice(1, -1));
      expect(request).toContain('\\"growth\\"');
      // She sees her revisable identity by entry id, from the live nuclear store.
      expect(request).toContain("comfortable with uncertainty");

      expect(readMood(sidecar, NOW)).toMatchObject({ valence: 0.3, openness: 0.7, reason: "Alex trusting me with the interview nerves moved me." });
      expect(listOpenExpectations(sidecar, NOW).map((item) => item.statement)).toEqual(["Alex will tell me how the interview went on Friday."]);
      expect(listCurrentOpinions(sidecar).map((item) => item.proposedText)).toEqual(["Music history is the best way into a genre."]);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("reads identity fresh for each cycle, so an applied revision reaches the next Thought", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-growth-identity";
    const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
      text: JSON.stringify(makeSemanticSettlement({ speech: { mode: "draft", surfaceDraft: "Hi." }, commitments: { conversational: ["acknowledge"] } })),
      model: "fake", modelAlias: "thought", resolvedModelId: null,
    }));
    try {
      readIdentitySlice(nuclear, "doc");
      await runCognitiveCycle(sidecar, nuclear, ownerTurn(sidecar, conversationId, "m1", "hello", NOW), deps(nuclear, { completeChat }));
      const trait = nuclear.prepare("SELECT id FROM identity_entries WHERE kind = 'trait'").get() as { id: number };
      const at = new Date(NOW).toISOString();
      nuclear.prepare(
        "INSERT INTO identity_entries (owner_id, layer, kind, text, source, revised_from, created_at, updated_at) VALUES ('doc', 'stable', 'trait', 'patient with messy problems', 'organic', ?, ?, ?)",
      ).run(trait.id, at, at);
      await runCognitiveCycle(sidecar, nuclear, ownerTurn(sidecar, conversationId, "m2", "hello again", NOW + 60_000), deps(nuclear, { completeChat, nowMs: () => NOW + 60_000 }));
      expect(JSON.stringify(completeChat.mock.calls[0]?.[0])).not.toContain("patient with messy problems");
      expect(JSON.stringify(completeChat.mock.calls.at(-1)?.[0])).toContain("patient with messy problems");
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });

  it("runs a NIGHT pass: a diary for the day, and a taste line regenerated from the branches she lived over two nights", async () => {
    const sidecar = openTestSidecar();
    const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
    const conversationId = "thread-night-run";
    const DAY = 24 * 60 * 60_000;
    const FOUR_AM = Date.UTC(2026, 9, 1, 1, 0); // 04:00 at the default UTC+3
    try {
      readIdentitySlice(nuclear, "doc");
      const taste = listIdentity(nuclear, "doc", { layer: "stable" }).find((entry) => entry.kind === "taste" && entry.text.includes("dub techno"))!;
      recordInterestTouches(sidecar, [{ root: "Cognitive biases", branch: "base-rate neglect", note: "kept coming back" }], FOUR_AM - 3 * DAY);
      recordInterestTouches(sidecar, [{ root: "Books & essays", branch: "essays that argue", note: "a great one on priors" }], FOUR_AM - DAY);
      const newTaste = "essays that argue, base-rate neglect and other cognitive biases, dub techno, and systems-heavy games";
      const completeChat = vi.fn<KernelDeps["completeChat"]>(async () => ({
        text: JSON.stringify(makeSemanticSettlement({
          speech: { mode: "none" },
          commitments: {},
          journal: { activity: "reflect", entry: "Closed the day and looked at what I actually reach for." },
          night: { diary: "A quiet day. Two essays on priors; I noticed I reach for biases more than psychopharmacology now." },
          growth: {
            revisions: [{
              layer: "taste",
              revisesEntryId: taste.id,
              text: newTaste,
              rationale: "the branches I live have moved",
              // The third branch is lived only after the first night; until then it resolves to nothing.
              evidenceRefs: ["interest:cognitive-biases/base-rate-neglect", "interest:books-essays/essays-that-argue", "interest:cognitive-biases/anchoring"],
            }],
          },
        })),
        model: "fake", modelAlias: "thought", resolvedModelId: null,
      }));
      let clock = FOUR_AM;
      const thought = async (input: { event: import("../types.js").InboxEvent | null }) =>
        runCognitiveCycle(sidecar, nuclear, input.event!, deps(nuclear, { completeChat, nowMs: () => clock }));
      const options = { conversationId, occupantId: "doc", authorityEpoch: 1, timeZone: "Etc/GMT-3", thought };
      expect(await tickNight(sidecar, { ...options, nowMs: FOUR_AM - 60_000 })).toMatchObject({ outcome: "scheduled", nextNightAtMs: FOUR_AM });
      const ran = await tickNight(sidecar, { ...options, nowMs: FOUR_AM });
      expect(ran).toMatchObject({ outcome: "ran", slot: 1 });
      expect(ran.thought?.reason).toBeNull();

      const request = JSON.stringify(completeChat.mock.calls[0]?.[0]);
      expect(request).toContain("When innerPass.kind is night");
      expect(request).toContain("base-rate neglect");
      expect(listDiary(sidecar)).toEqual([expect.objectContaining({ day: "2026-09-30" })]);
      expect(listRecentJournal(sidecar, { limit: 1 })[0]).toMatchObject({ passKind: "night", activity: "reflect" });
      const tastesOf = () => listIdentity(nuclear, "doc", { layer: "stable" }).filter((entry) => entry.kind === "taste").map((entry) => entry.text);
      // One night is one pass: a taste needs its proposal in two passes, two days apart.
      expect(tastesOf()).not.toContain(newTaste);

      recordInterestTouches(sidecar, [{ root: "Cognitive biases", branch: "anchoring", note: "an essay on first numbers" }], FOUR_AM + DAY);
      // The consumer closes a finished night's event; this test drives the kernel directly.
      sidecar.prepare("UPDATE inbox_events SET status = 'consumed' WHERE id LIKE 'night:%' AND status IN ('pending', 'claimed')").run();
      clock = FOUR_AM + 2 * DAY;
      expect(await tickNight(sidecar, { ...options, nowMs: clock })).toMatchObject({ outcome: "ran" });
      expect(tastesOf()).toContain(newTaste);
      expect(tastesOf()).not.toContain(taste.text);
    } finally {
      sidecar.close();
      nuclear.close();
    }
  });
});
