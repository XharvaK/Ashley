import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openNuclearDb } from "../../db.js";
import { listIdentity } from "../../identity/store.js";
import { openTestSidecar } from "../test-support.js";
import { upsertMemoryAssertion } from "../memory/assertions.js";
import { recordMemoryFormation } from "../memory/strength.js";
import { applyV021Forget, applyV021ForgetTargets, planV021Forget } from "../memory/forget.js";
import { MOOD_BASELINE, readMood, recordAppraisal } from "./mood.js";
import { checkExpectations, expireStaleExpectations, listOpenExpectations, recordExpectations } from "./expectations.js";
import {
  appliedEntryIdsForRevisions,
  evaluateRevisions,
  getRevision,
  listFoundationalReviews,
  proposeRevisions,
  recordOwnerRevisionDecision,
  recordRevisionPositions,
  removeOrganicIdentityEntry,
  revertRevision,
  revisableIdentityEntries,
  type RevisionProposal,
} from "./revisions.js";
import { growthForThought, recordGrowth } from "./growth.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 1, 12, 0);
const OWNER = "doc";
const dimensions = { source: "ashley_interpretation" as const, status: "interpreted" as const, time: "current" as const, reliability: "inferred" as const };

function selfEvidence(db: DatabaseSync, key: string, statement: string, atMs: number): string {
  upsertMemoryAssertion(db, {
    assertionKey: key, statement, memoryKind: "learned_self_evidence", dimensions,
    dataClassification: "ordinary", lineageParentKey: null, admittedGeneration: 1, live: true,
  });
  recordMemoryFormation(db, { assertionKey: key, salience: 0.6, nowMs: atMs });
  return key;
}

function withStores<T>(run: (sidecar: DatabaseSync, nuclear: DatabaseSync) => T): T {
  const sidecar = openTestSidecar();
  const nuclear = openNuclearDb(new DatabaseSync(":memory:"));
  try {
    return run(sidecar, nuclear);
  } finally {
    sidecar.close();
    nuclear.close();
  }
}

function propose(sidecar: DatabaseSync, nuclear: DatabaseSync | null, cycleId: string, proposal: RevisionProposal, nowMs: number) {
  return proposeRevisions(sidecar, {
    cycleId,
    proposals: [proposal],
    identity: nuclear ? revisableIdentityEntries(nuclear, OWNER) : null,
    nowMs,
  })[0];
}

describe("Growth V1 G4 mood", () => {
  it("rests at baseline before any appraisal", () => withStores((sidecar) => {
    expect(readMood(sidecar, T0)).toMatchObject({ ...MOOD_BASELINE, reason: null, settled: true });
  }));

  it("moves by at most 0.3 per appraisal, once per cycle, and keeps every dimension in range", () => withStores((sidecar) => {
    recordAppraisal(sidecar, { cycleId: "c1", appraisal: { note: "the debate energised me", valence: 1, energy: 0.9, tension: -1 }, dataClassification: "ordinary", nowMs: T0 });
    expect(readMood(sidecar, T0)).toMatchObject({ valence: 0.3, energy: 0.8, openness: 0.5, tension: 0, reason: "the debate energised me", settled: false });
    // A replayed settlement cannot move her twice.
    expect(recordAppraisal(sidecar, { cycleId: "c1", appraisal: { note: "again", valence: 1 }, dataClassification: "ordinary", nowMs: T0 }).applied).toBeNull();
    expect(readMood(sidecar, T0).valence).toBe(0.3);
    recordAppraisal(sidecar, { cycleId: "c2", appraisal: { note: "more", energy: 1 }, dataClassification: "ordinary", nowMs: T0 });
    expect(readMood(sidecar, T0).energy).toBe(1);
  }));

  it("decays toward baseline at x0.85 per hour and forgets why once settled", () => withStores((sidecar) => {
    recordAppraisal(sidecar, { cycleId: "c1", appraisal: { note: "that stung", valence: -0.3, tension: 0.3 }, dataClassification: "ordinary", nowMs: T0 });
    const hourLater = readMood(sidecar, T0 + HOUR);
    expect(hourLater.valence).toBeCloseTo(-0.255, 3);
    expect(hourLater.tension).toBeCloseTo(0.255, 3);
    expect(hourLater.reason).toBe("that stung");
    const dayLater = readMood(sidecar, T0 + DAY);
    expect(dayLater).toMatchObject({ settled: true, reason: null });
    expect(Math.abs(dayLater.valence)).toBeLessThan(0.05);
    // The next appraisal starts from the decayed mood, not the stored one.
    recordAppraisal(sidecar, { cycleId: "c2", appraisal: { note: "better", valence: 0.1 }, dataClassification: "ordinary", nowMs: T0 + DAY });
    expect(readMood(sidecar, T0 + DAY).valence).toBeCloseTo(0.1 + -0.3 * 0.85 ** 24, 3);
  }));
});

describe("Growth V1 G4 expectations", () => {
  it("records, checks in a later cycle, and expires after two weeks", () => withStores((sidecar) => {
    const [first, second] = recordExpectations(sidecar, { cycleId: "c1", statements: ["Alex will like the long take", "Alex will reply tonight"], dataClassification: "ordinary", nowMs: T0 });
    // Not in the cycle that made it: nothing has happened yet.
    expect(checkExpectations(sidecar, { cycleId: "c1", checks: [{ expectationId: first!, outcome: "missed", lesson: "x" }], nowMs: T0 })).toEqual([]);
    expect(checkExpectations(sidecar, { cycleId: "c2", checks: [{ expectationId: first!, outcome: "missed", lesson: "I overestimate how much he likes long takes" }], nowMs: T0 + HOUR }))
      .toEqual([first]);
    expect(listOpenExpectations(sidecar, T0 + HOUR).map((item) => item.expectationId)).toEqual([second]);
    expect(expireStaleExpectations(sidecar, T0 + 15 * DAY)).toBe(1);
    expect(listOpenExpectations(sidecar, T0 + 15 * DAY)).toEqual([]);
  }));
});

describe("Growth V1 G4 revision engine", () => {
  it("applies an opinion at two pieces of live evidence, not one", () => withStores((sidecar) => {
    const a = selfEvidence(sidecar, "self:a", "Dub techno hit hardest at 3am.", T0);
    const b = selfEvidence(sidecar, "self:b", "Again, the 3am listen was the best one.", T0 + HOUR);
    const first = propose(sidecar, null, "c1", { layer: "opinion", topic: "dub techno at night", text: "Dub techno is best at 3am.", rationale: "it keeps landing then", evidenceRefs: [a] }, T0);
    expect(first).toMatchObject({ outcome: "proposed" });
    expect(evaluateRevisions(sidecar, null, T0).applied).toEqual([]);
    const second = propose(sidecar, null, "c2", { layer: "opinion", topic: "Dub techno at night", text: "Dub techno is best at 3am, on headphones.", rationale: "again", evidenceRefs: [b] }, T0 + HOUR);
    expect(second).toEqual({ outcome: "reinforced", revisionId: (first as { revisionId: number }).revisionId });
    expect(evaluateRevisions(sidecar, null, T0 + HOUR).applied).toEqual([second && "revisionId" in second ? second.revisionId : -1]);
    expect(growthForThought(sidecar, null, T0 + HOUR).opinions).toEqual([
      expect.objectContaining({ topic: "dub techno at night", stance: "Dub techno is best at 3am, on headphones." }),
    ]);
  }));

  it("records nothing without evidence that resolves, and never lets a taste rewrite a boundary", () => withStores((sidecar, nuclear) => {
    expect(propose(sidecar, nuclear, "c1", { layer: "opinion", topic: "x", text: "y", rationale: "z", evidenceRefs: ["self:missing"] }, T0))
      .toEqual({ outcome: "no_evidence" });
    const evidence = selfEvidence(sidecar, "self:e", "I liked it.", T0);
    const boundary = revisableIdentityEntries(nuclear, OWNER).find((entry) => entry.kind === "boundary")!;
    expect(propose(sidecar, nuclear, "c1", { layer: "taste", revisesEntryId: boundary.entryId, text: "anything", rationale: "r", evidenceRefs: [evidence] }, T0))
      .toEqual({ outcome: "bad_target" });
    expect(propose(sidecar, null, "c1", { layer: "taste", revisesEntryId: boundary.entryId, text: "anything", rationale: "r", evidenceRefs: [evidence] }, T0))
      .toEqual({ outcome: "identity_unavailable" });
  }));

  it("revises a seeded taste only with evidence spanning two days, then appends a revertible identity entry", () => withStores((sidecar, nuclear) => {
    const store = { nuclear, ownerId: OWNER };
    const taste = revisableIdentityEntries(nuclear, OWNER).find((entry) => entry.kind === "taste" && entry.text.includes("dub techno"))!;
    const a = selfEvidence(sidecar, "self:t1", "Essays that argue keep pulling me in.", T0);
    const b = selfEvidence(sidecar, "self:t2", "Another essay night; I chose it over music.", T0 + HOUR);
    const proposal = { layer: "taste" as const, revisesEntryId: taste.entryId, text: "essays that argue, dub techno, and cognitive biases", rationale: "what I actually reach for", evidenceRefs: [a, b] };
    const result = propose(sidecar, nuclear, "c1", proposal, T0 + HOUR) as { revisionId: number };
    expect(evaluateRevisions(sidecar, store, T0 + HOUR).applied).toEqual([]);
    const c = selfEvidence(sidecar, "self:t3", "Third evening of essays.", T0 + 2 * DAY + HOUR);
    propose(sidecar, nuclear, "c2", { ...proposal, evidenceRefs: [c] }, T0 + 2 * DAY + HOUR);
    expect(evaluateRevisions(sidecar, store, T0 + 2 * DAY + HOUR).applied).toEqual([result.revisionId]);

    const revision = getRevision(sidecar, result.revisionId)!;
    expect(revision).toMatchObject({ status: "applied", previousText: taste.text });
    const tastes = listIdentity(nuclear, OWNER, { layer: "stable" }).filter((entry) => entry.kind === "taste").map((entry) => entry.text);
    expect(tastes).toContain("essays that argue, dub techno, and cognitive biases");
    expect(tastes).not.toContain(taste.text);

    expect(revertRevision(sidecar, store, result.revisionId, T0 + 3 * DAY)).toBe(true);
    const reverted = listIdentity(nuclear, OWNER, { layer: "stable" }).filter((entry) => entry.kind === "taste").map((entry) => entry.text);
    expect(reverted).toContain(taste.text);
    expect(reverted).not.toContain("essays that argue, dub techno, and cognitive biases");
  }));

  it("ripens a trait proposed in three passes over fourteen days, waits 72 hours, and starts over if evidence is forgotten", () => withStores((sidecar, nuclear) => {
    const store = { nuclear, ownerId: OWNER };
    const trait = { layer: "trait" as const, topic: "patience", text: "patient with messy problems", rationale: "it keeps happening" };
    const { revisionId } = propose(sidecar, nuclear, "c1", { ...trait, evidenceRefs: [selfEvidence(sidecar, "self:p1", "I stayed with the messy bug for hours.", T0)] }, T0) as { revisionId: number };
    propose(sidecar, nuclear, "c2", { ...trait, evidenceRefs: [selfEvidence(sidecar, "self:p2", "Patient again with the migration.", T0 + 7 * DAY)] }, T0 + 7 * DAY);
    expect(evaluateRevisions(sidecar, store, T0 + 7 * DAY).ripened).toEqual([]);
    propose(sidecar, nuclear, "c3", { ...trait, evidenceRefs: [selfEvidence(sidecar, "self:p3", "Still patient with a hard problem.", T0 + 14 * DAY)] }, T0 + 14 * DAY);
    expect(evaluateRevisions(sidecar, store, T0 + 14 * DAY)).toMatchObject({ applied: [], ripened: [revisionId] });
    expect(evaluateRevisions(sidecar, store, T0 + 14 * DAY + 71 * HOUR).applied).toEqual([]);

    // A forget removes one piece: the revision drops back and the wait restarts.
    applyV021Forget(sidecar, { topic: "migration", nowMs: T0 + 15 * DAY });
    evaluateRevisions(sidecar, store, T0 + 15 * DAY);
    expect(getRevision(sidecar, revisionId)).toMatchObject({ status: "proposed", ripeAtMs: null });

    const replacement = selfEvidence(sidecar, "self:p4", "Patient through a long outage.", T0 + 16 * DAY);
    propose(sidecar, nuclear, "c4", { ...trait, evidenceRefs: [replacement] }, T0 + 16 * DAY);
    expect(evaluateRevisions(sidecar, store, T0 + 16 * DAY).ripened).toEqual([revisionId]);
    expect(evaluateRevisions(sidecar, store, T0 + 16 * DAY + 72 * HOUR).applied).toEqual([revisionId]);
    expect(listIdentity(nuclear, OWNER, { layer: "stable" }).some((entry) => entry.kind === "trait" && entry.text === "patient with messy problems"))
      .toBe(true);
  }));

  it("applies a value only when Ashley affirms in a later pass and the Owner approves the same wording", () => withStores((sidecar, nuclear) => {
    const store = { nuclear, ownerId: OWNER };
    const value = revisableIdentityEntries(nuclear, OWNER).find((entry) => entry.text === "comfortable with uncertainty")!;
    const evidence = selfEvidence(sidecar, "self:v1", "Saying I don't know plainly went well.", T0);
    const proposal = { layer: "value" as const, revisesEntryId: value.entryId, text: "comfortable with uncertainty, and says so plainly", rationale: "it keeps working", evidenceRefs: [evidence] };
    const { revisionId } = propose(sidecar, nuclear, "c1", proposal, T0) as { revisionId: number };

    // Affirming in the proposing pass is refused: it must be a second act.
    expect(recordRevisionPositions(sidecar, { cycleId: "c1", positions: [{ revisionId, position: "affirm", rationale: "yes" }], nowMs: T0 })).toEqual([]);
    expect(recordOwnerRevisionDecision(sidecar, { revisionId, decision: "approve", nowMs: T0 + HOUR })).toBe(true);
    expect(evaluateRevisions(sidecar, store, T0 + HOUR).applied).toEqual([]);

    // A new wording clears the approval: nobody approves one text and gets another.
    propose(sidecar, nuclear, "c2", { ...proposal, text: "comfortable with uncertainty; says so plainly" }, T0 + 2 * HOUR);
    expect(getRevision(sidecar, revisionId)).toMatchObject({ ownerDecision: null, ashleyPosition: null, proposedCycleId: "c2" });

    expect(recordRevisionPositions(sidecar, { cycleId: "c3", positions: [{ revisionId, position: "affirm", rationale: "this is who I am" }], nowMs: T0 + 3 * HOUR })).toEqual([revisionId]);
    expect(evaluateRevisions(sidecar, store, T0 + 3 * HOUR).applied).toEqual([]);
    expect(listFoundationalReviews(sidecar)[0]).toMatchObject({ id: revisionId, targetKind: "value", ashleyPosition: "affirm", docDecision: null, evidenceCount: 1 });
    recordOwnerRevisionDecision(sidecar, { revisionId, decision: "approve", nowMs: T0 + 4 * HOUR });
    expect(evaluateRevisions(sidecar, store, T0 + 4 * HOUR).applied).toEqual([revisionId]);
    const values = listIdentity(nuclear, OWNER, { layer: "stable" }).filter((entry) => entry.kind === "value").map((entry) => entry.text);
    expect(values).toContain("comfortable with uncertainty; says so plainly");
    expect(values).not.toContain("comfortable with uncertainty");
  }));

  it("closes a foundational revision the Owner rejects", () => withStores((sidecar, nuclear) => {
    const boundary = revisableIdentityEntries(nuclear, OWNER).find((entry) => entry.kind === "boundary")!;
    const evidence = selfEvidence(sidecar, "self:b1", "I held a line today.", T0);
    const { revisionId } = propose(sidecar, nuclear, "c1", { layer: "boundary", revisesEntryId: boundary.entryId, text: "new boundary", rationale: "r", evidenceRefs: [evidence] }, T0) as { revisionId: number };
    expect(recordOwnerRevisionDecision(sidecar, { revisionId, decision: "reject", rationale: "not yet", nowMs: T0 })).toBe(true);
    expect(getRevision(sidecar, revisionId)?.status).toBe("rejected");
    expect(recordRevisionPositions(sidecar, { cycleId: "c2", positions: [{ revisionId, position: "affirm", rationale: "yes" }], nowMs: T0 })).toEqual([]);
  }));

  it("counts a checked expectation as self-evidence", () => withStores((sidecar) => {
    const [id] = recordExpectations(sidecar, { cycleId: "c1", statements: ["Alex will enjoy the Basic Channel piece"], dataClassification: "ordinary", nowMs: T0 });
    const self = selfEvidence(sidecar, "self:x", "I get excited sharing music history.", T0);
    const proposal = { layer: "opinion" as const, topic: "sharing music history", text: "Alex likes music history", rationale: "r", evidenceRefs: [id!, self] };
    const open = propose(sidecar, null, "c2", proposal, T0) as { revisionId: number };
    // An unchecked expectation proves nothing yet: only the self-evidence counts.
    expect(evaluateRevisions(sidecar, null, T0).applied).toEqual([]);
    checkExpectations(sidecar, { cycleId: "c3", checks: [{ expectationId: id!, outcome: "met", lesson: "He loved it." }], nowMs: T0 + HOUR });
    propose(sidecar, null, "c3", { ...proposal, evidenceRefs: [id!] }, T0 + HOUR);
    expect(evaluateRevisions(sidecar, null, T0 + HOUR).applied).toEqual([open.revisionId]);
  }));
});

describe("R10 independent, recurring evidence", () => {
  function nominatedIn(sidecar: DatabaseSync, key: string, cycleId: string) {
    sidecar.prepare(
      `INSERT INTO durable_nominations
         (nomination_id, cycle_id, generation, assertion_key, statement, memory_kind, dimensions_json, data_classification, admitted)
       VALUES (?, ?, 1, ?, 'x', 'learned_self_evidence', ?, 'ordinary', 1)`,
    ).run(`nom:${key}`, cycleId, key, JSON.stringify(dimensions));
  }

  function journalOf(sidecar: DatabaseSync, cycleId: string, atMs: number, reads: string[] = []): string {
    const entryId = `journal:${cycleId}`;
    sidecar.prepare(
      `INSERT INTO activity_journal (entry_id, conversation_id, cycle_id, pass_kind, activity, entry, read_refs_json, data_classification, created_at_ms)
       VALUES (?, 'thread', ?, 'afterglow', 'reflect', 'I noticed it again.', ?, 'ordinary', ?)`,
    ).run(entryId, cycleId, JSON.stringify(reads.map((observationId) => ({ observationId, modality: "page" }))), atMs);
    return entryId;
  }

  function webRead(sidecar: DatabaseSync, observationId: string, cycleId: string, url: string) {
    sidecar.prepare(
      `INSERT INTO observations (observation_id, cycle_id, generation, derived, replay_safe, modality, payload_json, provenance, data_classification, secret_omitted, created_at_ms)
       VALUES (?, ?, 1, 0, 1, 'page', ?, 'tool:web', 'ordinary', 0, 0)`,
    ).run(observationId, cycleId, JSON.stringify({ url }));
  }

  it("counts a memory and the journal entry from the same pass as one origin", () => withStores((sidecar) => {
    const memory = selfEvidence(sidecar, "self:one", "That set moved me.", T0);
    nominatedIn(sidecar, memory, "pass-1");
    const journal = journalOf(sidecar, "pass-1", T0);
    const { revisionId } = propose(sidecar, null, "c1", { layer: "opinion", topic: "that set", text: "That set is great.", rationale: "r", evidenceRefs: [memory, journal] }, T0) as { revisionId: number };
    expect(evaluateRevisions(sidecar, null, T0).applied).toEqual([]);
    expect(growthForThought(sidecar, null, T0).revisions?.[0]).toMatchObject({ revisionId, evidence: 1 });
  }));

  it("refuses a taste proposed in one pass, however much evidence it cites", () => withStores((sidecar, nuclear) => {
    const store = { nuclear, ownerId: OWNER };
    const refs = [
      selfEvidence(sidecar, "self:a1", "Essays again.", T0),
      selfEvidence(sidecar, "self:a2", "More essays.", T0 + 3 * DAY),
    ];
    const { revisionId } = propose(sidecar, nuclear, "c1", { layer: "taste", topic: "essays", text: "essays that argue", rationale: "r", evidenceRefs: refs }, T0 + 3 * DAY) as { revisionId: number };
    expect(evaluateRevisions(sidecar, store, T0 + 3 * DAY).applied).toEqual([]);
    // Re-citing the same evidence later is not a new pass.
    propose(sidecar, nuclear, "c2", { layer: "taste", topic: "essays", text: "essays that argue", rationale: "r", evidenceRefs: refs }, T0 + 6 * DAY);
    expect(evaluateRevisions(sidecar, store, T0 + 6 * DAY).applied).toEqual([]);
    expect(getRevision(sidecar, revisionId)?.status).toBe("proposed");
  }));

  it("counts one website once and never lets the web alone change her", () => withStores((sidecar) => {
    webRead(sidecar, "obs-1", "pass-1", "https://example.org/a");
    webRead(sidecar, "obs-2", "pass-2", "https://example.org/b");
    webRead(sidecar, "obs-3", "pass-3", "https://other.net/c");
    const first = journalOf(sidecar, "pass-1", T0, ["obs-1"]);
    const sameSite = journalOf(sidecar, "pass-2", T0 + HOUR, ["obs-2"]);
    const { revisionId } = propose(sidecar, null, "c1", { layer: "opinion", topic: "priors", text: "Priors matter.", rationale: "r", evidenceRefs: [first, sameSite] }, T0 + HOUR) as { revisionId: number };
    expect(evaluateRevisions(sidecar, null, T0 + HOUR).applied).toEqual([]);
    expect(growthForThought(sidecar, null, T0 + HOUR).revisions?.[0]).toMatchObject({ revisionId, evidence: 1 });

    const otherSite = journalOf(sidecar, "pass-3", T0 + 2 * HOUR, ["obs-3"]);
    propose(sidecar, null, "c2", { layer: "opinion", topic: "priors", text: "Priors matter.", rationale: "r", evidenceRefs: [otherSite] }, T0 + 2 * HOUR);
    // Two sites are two origins, but both are the web.
    expect(evaluateRevisions(sidecar, null, T0 + 2 * HOUR).applied).toEqual([]);

    const own = selfEvidence(sidecar, "self:priors", "I keep reasoning from priors myself.", T0 + 3 * HOUR);
    propose(sidecar, null, "c3", { layer: "opinion", topic: "priors", text: "Priors matter.", rationale: "r", evidenceRefs: [own] }, T0 + 3 * HOUR);
    expect(evaluateRevisions(sidecar, null, T0 + 3 * HOUR).applied).toEqual([revisionId]);
  }));
});

describe("R14 applying an identity revision after a crash", () => {
  it("adopts the entry a crashed apply already wrote instead of appending a duplicate", () => withStores((sidecar, nuclear) => {
    const store = { nuclear, ownerId: OWNER };
    const taste = revisableIdentityEntries(nuclear, OWNER).find((entry) => entry.kind === "taste" && entry.text.includes("dub techno"))!;
    const proposal = { layer: "taste" as const, revisesEntryId: taste.entryId, text: "essays that argue, and dub techno", rationale: "r" };
    const { revisionId } = propose(sidecar, nuclear, "c1", { ...proposal, evidenceRefs: [selfEvidence(sidecar, "self:k1", "Essays.", T0)] }, T0) as { revisionId: number };
    propose(sidecar, nuclear, "c2", { ...proposal, evidenceRefs: [selfEvidence(sidecar, "self:k2", "More essays.", T0 + 2 * DAY)] }, T0 + 2 * DAY);
    expect(evaluateRevisions(sidecar, store, T0 + 2 * DAY).applied).toEqual([revisionId]);
    const entryId = getRevision(sidecar, revisionId)!.appliedEntryId;

    // Simulate the crash: the nuclear entry exists, the sidecar never recorded it.
    sidecar.prepare("UPDATE growth_revisions SET status = 'proposed', applied_at_ms = NULL, applied_entry_id = NULL WHERE revision_id = ?").run(revisionId);
    expect(evaluateRevisions(sidecar, store, T0 + 2 * DAY + HOUR).applied).toEqual([revisionId]);
    expect(getRevision(sidecar, revisionId)).toMatchObject({ status: "applied", appliedEntryId: entryId, previousText: taste.text });
    const tastes = listIdentity(nuclear, OWNER, { layer: "stable" }).filter((entry) => entry.text === proposal.text);
    expect(tastes).toHaveLength(1);
    expect(nuclear.prepare("SELECT COUNT(*) AS n FROM identity_entries WHERE text = ?").get(proposal.text)).toEqual({ n: 1 });
  }));
});

describe("Growth V1 G4 recordGrowth and the forget cascade", () => {
  it("records one settlement's growth claim and shows it back to Thought", () => withStores((sidecar, nuclear) => {
    const store = { nuclear, ownerId: OWNER };
    const result = recordGrowth(sidecar, {
      cycleId: "c1",
      claim: {
        appraisal: { note: "Alex's news about the interview made me glad", valence: 0.4, energy: 0.2 },
        expectations: ["Alex will tell me how the interview went on Friday"],
      },
      identityStore: store,
      dataClassification: "ordinary",
      nowMs: T0,
    });
    expect(result).toMatchObject({ appraised: true, expectations: [expect.stringMatching(/^expectation:/)] });
    const growth = growthForThought(sidecar, store, T0);
    expect(growth.mood).toMatchObject({ valence: 0.3, energy: 0.7, reason: "Alex's news about the interview made me glad" });
    expect(growth.expectations).toEqual([expect.objectContaining({ statement: "Alex will tell me how the interview went on Friday" })]);
    expect(growth.self?.map((entry) => entry.kind).sort()).toEqual(["boundary", "boundary", "taste", "taste", "trait", "value", "value", "value"]);
  }));

  it("joins all three forget paths and removes an identity entry a forgotten revision applied", () => withStores((sidecar, nuclear) => {
    const store = { nuclear, ownerId: OWNER };
    const a = selfEvidence(sidecar, "self:k1", "Kyoto planning made me happy.", T0);
    const b = selfEvidence(sidecar, "self:k2", "Still happy about the trip.", T0 + HOUR);
    const { revisionId } = propose(sidecar, nuclear, "c1", { layer: "trait", topic: "travel", text: "loves planning trips to Kyoto", rationale: "Kyoto again", evidenceRefs: [a, b] }, T0) as { revisionId: number };
    recordAppraisal(sidecar, { cycleId: "c1", appraisal: { note: "Kyoto!", valence: 0.2 }, dataClassification: "ordinary", nowMs: T0 });
    recordExpectations(sidecar, { cycleId: "c1", statements: ["Alex will book Kyoto"], dataClassification: "ordinary", nowMs: T0 });

    // Pretend the revision applied, then check the identity cleanup the confirm path runs.
    sidecar.prepare("UPDATE growth_revisions SET status = 'applied' WHERE revision_id = ?").run(revisionId);
    const at = new Date(T0).toISOString();
    const entryId = Number(nuclear.prepare(
      "INSERT INTO identity_entries (owner_id, layer, kind, text, source, revised_from, created_at, updated_at) VALUES (?, 'stable', 'trait', 'loves planning trips to Kyoto', 'organic', NULL, ?, ?)",
    ).run(OWNER, at, at).lastInsertRowid);
    sidecar.prepare("UPDATE growth_revisions SET applied_entry_id = ? WHERE revision_id = ?").run(entryId, revisionId);

    const plan = planV021Forget(sidecar, { topic: "kyoto" });
    expect(plan.categoryCounts).toMatchObject({ v021_growth_revision: 1, v021_mood_event: 1, v021_expectation: 1 });
    applyV021ForgetTargets(sidecar, plan.targets, { nowMs: T0 + HOUR });
    expect(getRevision(sidecar, revisionId)).toMatchObject({ status: "forgotten", topic: null, proposedText: "[redacted]" });
    expect(readMood(sidecar, T0 + HOUR).reason).toBeNull();
    expect(listOpenExpectations(sidecar, T0 + HOUR)).toEqual([]);
    expect(evaluateRevisions(sidecar, store, T0 + 30 * DAY).applied).toEqual([]);

    const entries = appliedEntryIdsForRevisions(sidecar, [String(revisionId)]);
    expect(entries).toEqual([entryId]);
    expect(removeOrganicIdentityEntry(nuclear, OWNER, entryId)).toBe(true);
    expect(listIdentity(nuclear, OWNER, { layer: "stable" }).some((entry) => entry.text.includes("Kyoto"))).toBe(false);

    // The direct topic path covers the same stores.
    recordAppraisal(sidecar, { cycleId: "c9", appraisal: { note: "sushi night was fun" }, dataClassification: "ordinary", nowMs: T0 + 2 * HOUR });
    const direct = applyV021Forget(sidecar, { topic: "sushi", nowMs: T0 + 3 * HOUR });
    expect(direct.targets.map((target) => target.entityType)).toContain("v021_mood_event");
  }));

  it("never removes a seeded identity entry", () => withStores((_sidecar, nuclear) => {
    const seeded = listIdentity(nuclear, OWNER, { layer: "stable" })[0]!;
    expect(removeOrganicIdentityEntry(nuclear, OWNER, seeded.id)).toBe(false);
  }));
});
