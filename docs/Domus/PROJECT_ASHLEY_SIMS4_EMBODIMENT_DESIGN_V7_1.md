# Project Ashley — Sims 4 Embodiment Design
## Master Embodiment Design V7.1
### Astra-Adjudicated Architectural Repair of V7

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_1.md

DOCUMENT_TYPE =
  MASTER EMBODIMENT DESIGN — ASTRA-ADJUDICATED REPAIR (NOT a new campaign)

PREDECESSOR_V7 =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7.md

V7_SHA256 =
  e38820e9b97fc188c005be298285636f5869bb6b26ee548fdbde430cd184791c
  (verified by hash before authoring)

NORMATIVE_PREDECESSOR_V6_1_1 =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V6_1_1.md

V6_1_1_SHA256 =
  3e57be00a0fca9e044fc368b2e45e6fe13e9009aba85e172dbeb38ce5b35583a
  (verified in the V7 task; V6.1.1 text re-read for this revision)

ASTRA_FIRST_PASS =
  V7 independent source-blind architectural review (HOLD_FOR_ARCHITECTURAL_REPAIR)
  received in-session 2026-09-28; V7 SHA confirmed inside it (e38820e9…);
  1354/1354 lines reviewed by Astra. Local file absent — no file hash to verify.

ASTRA_SECOND_PASS_SHA256 =
  5aa9eb50accb6170766f6831de9a75524d937356c88674adee9ce985ea364f01
  (task-stated; local file absent from disk after exhaustive search —
   hash UNVERIFIED against bytes; full second-pass text received in-session
   and applied correction-by-correction in §5)

SUPERSEDE_V7_AS_MASTER =
  YES, if Owner accepts it

V7_REMAINS_PROVENANCE = YES
V6_1_1_REMAINS_NORMATIVE_DEPENDENCY = YES (see §3 precedence rule)
V6_V5_JEVV2_REMAIN_PROVENANCE = YES

ASHLEY_SOURCE_SHA =
  60fec11742486b3d6e0fd8cd33912dd6d10d94c2
ASHLEY_SOURCE_TREE =
  123d744a17a248e6310e2fab2abb90610a6a7675
  (preserved from V7; NO new code archaeology performed in this revision)

SIMS_CLIENT = The Sims 4, Windows PC / Steam
SIMS_BUILD = PC 1.128.90.1030
PATCH_DATE = 2026-09-22
RESEARCH_CUTOFF = 2026-09-28 (preserved; no new research in this revision)

ARCHITECTURE_CHANGED_BY_V7_1 = YES (bounded; see §5 correction ledger)
  — topology: required-A0-bridge withdrawn, experimental/integrated split;
  — reuse language demoted from compatibility conclusions to gated contracts;
  — System One names S1-RANK/S1-MEMBERSHIP adopted (J- names legacy aliases);
  — patch/resource claims demoted to hypotheses + candidate surfaces.
  — No new cognition/memory/planner/world-adapter architecture. No phase reorder.
  — No frozen semantic law weakened. No live role granted to any model.

ONE_ASHLEY = PRESERVED
NEW_ASHLEY_ARCHITECTURE_PROVEN_NECESSARY = NO
```

**Date:** 2026-09-28 Europe/Istanbul

**NOT:** a new research campaign · V8 · implementation · code archaeology ·
wholesale source regrounding · Phase A authorization · blanket programme
authorization · a benchmark · a bridge implementation · A0 execution.

**What V7.1 is:** a precise architectural repair of V7. V7's direction
survived independent review; several of its claims were too strong and
several boundaries were placed too early. V7.1 preserves V7's regrounding,
repairs its normative packaging, and re-issues every over-strong claim with
its correct authority and evidentiary status. The goal is not to look more
complete — it is to be auditable.

**How to read references in V7.1:** `§N` means a section of THIS document
unless prefixed. `V6.1.1 §N` means the normative predecessor. `V7 §N` means
the superseded V7 (provenance only). Where V6.1.1 material is restated here,
this restatement is normative for embodiment scope; where this document is
silent, the hash-pinned V6.1.1 governs per the §3 precedence rule.

**Labels:** V6.1.1 §0 + V7 §0 labels preserved. V7.1 adds:

| Label | Meaning |
|---|---|
| **OWNER_DISCOVERY_CLOSED** | Source survey identified a likely generic owner; bounded to asserted survey, not independent verification |
| **DOMAIN_COMPATIBILITY_UNPROVEN** | Fitness of that owner for Sims-world semantics is not established |
| **REQUIRED_V7_CORRECTION** | Second-pass classification: must be fixed in V7.1 (not proof of runtime failure) |
| **OWNER_POLICY_RESOLVED** | Owner decision settles the policy question within stated scope |
| **RESOURCE_PLAUSIBLE + COEXISTENCE_UNQUALIFIED** | Paper fit without coexistence evidence (replaces V7's stronger wording) |
| **HYPOTHESIS_UNTIL_WITNESSED** | Patch-derived or survey-derived expectation awaiting Owner-client evidence |

---

## 1. Master status block (repaired readiness)

```text
ASTRA_SECOND_PASS = ACCEPT_DIRECTION_REPAIR_V7
MASTER_BLOCKERS_REMAINING_AFTER_CORRECTION = NONE
CODE_ARCHAEOLOGY_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
RECOMMENDED_NEXT_AUTHORIZATION = BOUNDED_A0_DISCOVERY_ONLY

DESIGN_READY_FOR_OWNER_DECISION = YES
V7_1_CAN_BECOME_MASTER_WITHOUT_CODE_ARCHAEOLOGY = YES
A0_DISCOVERY_READY_FOR_OWNER_AUTHORIZATION = YES
FULL_PHASE_A_EXECUTION_AUTHORIZED = NO
A1_EXECUTION_READY = NO
A2_EXECUTION_READY = NO
FULL_A0_TO_A9_PROGRAMME_DIRECTION_ACCEPTED = PENDING_OWNER_ACCEPTANCE_OF_V7_1
IMPLEMENTATION_READY = A0_ONLY_AFTER_SEPARATE_OWNER_AUTHORIZATION;
  NOT_GENERAL_EMBODIMENT_IMPLEMENTATION

CA01_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
CA01_REQUIRED_BEFORE_A0 = NO
CA01_REQUIRED_BEFORE_PHASE_A_AUTHORIZATION = NO
CA01_REQUIRED_BEFORE_FIRST_REMOTE_ACTUATION = YES

SYSTEM_ONE_REQUIRED_FOR_A0 = NO
SYSTEM_ONE_REQUIRED_FOR_A1 = NO
SYSTEM_ONE_REQUIRED_FOR_DETERMINISTIC_A2 = NO

TEST_WITNESSED = ZERO
LIVED_EXPERIMENTS_PERFORMED = ZERO
```

V7's `PHASE_A_READY_FOR_OWNER_DECISION = YES` (V7 §1/§27) is withdrawn as an
editorial constant and replaced by the distinctions above: the next
authorization is bounded A0 discovery, not blanket Phase A.

---

## 2. Adjudication record

First pass: `ASTRA_V7_SOURCE_BLIND_REVIEW: HOLD` — three structural problems
(unde monstrated A0-bridge necessity; boundary qualification placed at A5
after claims depend on it; reuse maps promoted into compatibility
conclusions) plus normative-package and reference defects (F1–F10), two
bounded archaeology questions (CA-01, CA-02), seven new failure modes
(30–37), and a C01–C12 regression check. The hold explicitly required
bounded corrections, not a new cognition architecture, and authorized
neither implementation nor Phase A.

Second pass: `ASTRA_V7_SECOND_PASS: ACCEPT_DIRECTION_REPAIR_V7` —
conditional acceptance of the correction direction. The second pass judged
the first review to have placed too much prerequisite weight on
compatibility evidence: that evidence is required before *relying on* the
mechanism, not before *adopting a design that requires its qualification*.
Classifications: nine REQUIRED_V7_CORRECTION (F1–F6, F8–F10), one
OWNER_POLICY_RESOLVED (F7). `NO unresolved MASTER_BLOCKER remains beyond
making these corrections accurately.` Phase decision: corrected V7 can
become master without code archaeology; Phase A authorizable as bounded A0
discovery only; full programme authorization not ready; implementation not
ready.

Owner policy supplied with the second pass (binding): bounded hosted Sims-
mechanical disclosure ACCEPTED with exclusions (§9); Gate A no longer a
Phase A blocker; Gate B path/model-specific, shadow-first, never automatic.

---

## 3. Normative package and precedence (F1 repair)

```text
NORMATIVE_PREDECESSOR = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V6_1_1.md
NORMATIVE_PREDECESSOR_SHA256 =
  3e57be00a0fca9e044fc368b2e45e6fe13e9009aba85e172dbeb38ce5b35583a

PRECEDENCE (highest first):
  V7.1 EXPLICIT DELTA
    > V7 EXPLICIT DELTA WHERE PRESERVED BY §5
    > V6.1.1 INHERITED OPERATIVE CONTRACT
```

V6.1.1 is not mere provenance: every operative contract below that V7.1
does not explicitly supersede remains normative. To make V7.1 self-
auditable without full duplication, the load-bearing inherited clauses are
restated here (§3.1–§3.7). These restatements are normative for embodiment
scope; any divergence between a restatement and hash-pinned V6.1.1 text is
resolved in favor of V6.1.1 unless §5 explicitly re-adjudicates it.

### 3.1 Frozen semantic laws (inherited from V6.1.1 §2.4; preserved)

```text
Permission != desire · Capability != intention · Record != feeling
Simulation state != Ashley meaning · Simulation autonomy != Ashley intention
Game result != Ashley judgment · Need fact != desire
EXPERIMENTAL REQUEST != ASHLEY INTENTION / ENDORSEMENT
EXPERIMENT_AUTHORITY_ORIGIN != THOUGHT_ENDORSED_ORIGIN
OWNER STOP != ASHLEY REFUSAL · HOST REFUSAL != ASHLEY CHANGED MIND
Owner/Sol revoke / cancel / stop != Ashley withdrew / refused / changed mind
Thought intention/endorsement/meaning unchanged unless Thought
  attributably changes them
Receipt existence != claim truth · missing receipt != proof no effect
J-RANK approval != J-MEMBERSHIP authorization (now S1 names, §8.6)
Quiet body != CONTROL · CANDIDATE != ACCEPTED MECHANISM
Shadow accuracy != live actuation authority
```

V7 extensions preserved: `SYSTEM_ONE_OUTPUT != ASHLEY MEMORY`;
`SYSTEM_ONE_SELECTION != ASHLEY INTENTION`; `SYSTEM_ONE_MODEL owns NOTHING`;
`MODEL A QUALIFICATION != MODEL B QUALIFICATION`;
`LOCAL != AUTOMATICALLY AUTHORIZED TO INFLUENCE`;
`NO SYSTEM ONE INFERENCE — REMOTE OR LOCAL — MAY BLOCK THE SIMS
MUTATION THREAD`.

### 3.2 Origin authority (inherited from V6.1.1 §2.3; preserved)

`EXPERIMENT_AUTHORITY_ORIGIN` = Owner-authorized experimental request
carrying a semantic test class (NOT Ashley intention/endorsement; A2).
`THOUGHT_ENDORSED_ORIGIN` = Thought-selected desire/intention/endorsement
(first real embodied instance at A7). Recorded as orthogonal provenance
facts; no second intention manager.

### 3.3 Pipeline order (inherited from V6.1.1 §3 as corrected by C03; preserved)

origin → Host pre-inference deterministic → optional System One (middle
only) → Host post-inference (threshold, revalidate, FINAL admission) →
enqueue → start → completion → effect → attribution → EffectReceipt →
Thought/experiment verdict. Enqueue/lifecycle/receipts sit AFTER final
admission. Receipts are the sole effect witnesses; `OUTCOME_UNKNOWN`
remains legitimate; the ladder does not require every claim known.

### 3.4 Deterministic-first tree (inherited from V6.1.1 §4.1 incl. F02; preserved)

Code truth → owned authority (Thought endorsement OR Owner experimental
authorization OR explicit Host rule — never "Owner endorsement" of Ashley
intention) → receipt/oracle → narrow residual typed judgment (possible
shadow-first) → else escalate/refuse/leave OPEN. Mandatory facts (binding
failure, receipt/OUTCOME_UNKNOWN surfaces, attachment loss, Owner-required
telemetry) bypass inference entirely. Byte/id/timestamp equality is code
work; model questions must never complete unfinished deterministic
infrastructure.

### 3.5 Body binding core (inherited from V6.1.1 §5; preserved, see §12)

`PERSISTED_HOST_BODY_BINDING = {save_slot_guid, sim_id}` (decimal-string
`sim_id`); designation ≠ current resolution ≠ availability ≠ control
attachment ≠ permission; no silent substitute (active Sim, same name,
household, appearance, lookalike all forbidden as substitutes); Save-As
fork inequality `(G1,S42) != (G2,S42)`; observation-only qualification
interval before actuation; live probabilistic rescue REJECTED.

### 3.6 Action ladder honesty (inherited from V6.1.1 §7; preserved)

origin ≠ request ≠ admission ≠ enqueue ≠ start ≠ completion ≠ game outcome
≠ desired world effect ≠ save persistence ≠ causal attribution. Enqueue
never proves embodied success; matching post-state never proves this
request caused it; pre+lifecycle+post where possible else OUTCOME_UNKNOWN.

### 3.7 A3 five dimensions (inherited from V6.1.1 §12.3; explicitly restated
per F1 — V7 never enumerated them)

```text
1. CONTROL — no prohibited new consequential authorship occurs in the envelope
2. WORLD PROGRESS — the world does not advance outside declared continuation
3. BODILY PRESENTATION — the body presents as declared (never laundered into CONTROL)
4. RESPONSIVENESS / OBSERVABILITY — hold state is detectable and reportable
5. RELEASE / CLEANUP — the hold ends truthfully with residual effects accounted
```

First acceptance = DETECT/REPORT + permitted continuation + prevent
prohibited + truthful release. Social response is OUT of first acceptance
(ADJUDICATED). Hold requested ≠ established; maintained ≠ established;
ended ≠ release completed. Mechanism EXPERIMENTAL. No sixth dimension.

---

## 4. Reference repairs (F1 subsidiary)

V7's dangling references are corrected: `§20I`/`§20J` (nonexistent in V7)
become V7.1 §8-shortlist (shadow candidates, preserved from V7 §8I) and
§8.9/§16-qualification-tuple (path-tuple extension, preserved from V7-09).
Topology references to "§16 narrow bridge / §20" become §6 (three-topology
split + boundary contract). "§14F baselines" becomes §8.10. "§11 fallback
law" becomes §8.11. Inherited-vs-current ambiguity is resolved by the §3
prefix convention. All V7 section citations elsewhere in this document were
checked against the 1354-line V7 text during authoring.

"Live in `60fec11`" (V7 §6) is demoted throughout to revision-scoped
implementation-presence language: the cited files/symbols were present at
the pinned revision; presence is not deployment, activation, or runtime
proof.

---

## 5. V7 → V7.1 correction ledger

**V7.1-C01 — Normative package (Astra F1, REQUIRED_V7_CORRECTION).**
V7 text: V6.1.1 "remains provenance" while §§9–20 depend on its operative
contracts; `ASTRA_C01_C12 = PRESERVED` asserted without mapping; dangling
refs. Correction: §3 precedence + normative dependency; §§3.1–3.7 restated
clauses; §4 reference repairs; §15 full C01–C12 mapping. Why: reviewability.
ARCHITECTURE_CHANGED: NO. Phases: all (contracts auditable). Evidence
later: none (document verification against pinned V6.1.1, done here).
Owner decision: accept V7.1 as master.

**V7.1-C02 — Windows-local A0 permitted (Astra F2, REQUIRED_V7_CORRECTION).**
V7 text: Mint authority + Windows harness + required narrow bridge from A0
(V7-02). Correction: §6 three-topology split;
`SHOULD_FINAL_PRODUCTION_TOPOLOGY_BE_FROZEN_BEFORE_A0 = NO`;
`CAN_WINDOWS_LOCAL_A0_BEGIN_WITHOUT_MINT_BRIDGE = YES`;
`CAN_WINDOWS_LOCAL_A1/A2_YIELD_VALID_BOUNDED_RESULTS = ONLY_WITH_CONDITIONS`
(§6.1 four conditions). Why: production location does not deduce
experimental necessity. ARCH: YES (boundary placement demoted from
prerequisite to scoped choice). Phases: A0, A1, A2. Evidence later: A0
topology choice + bounded-scope records. Owner decision: choose
WINDOWS_LOCAL_FIRST or INCLUDE_EARLY_MINT_INTEGRATION (§18).

**V7.1-C03 — Boundary contract before dependent claims; A5 retained broader
(Astra F3, REQUIRED_V7_CORRECTION).** V7 text: bridge relied on from A0,
qualified at A5. Correction: §6.3 fifteen-point minimum remote-boundary
contract; no accepted remote-dependent claim before demonstration; A5 keeps
broader integration qualification and may NOT retroactively qualify earlier
remote evidence; controlled trials MAY exercise an unqualified boundary when
explicitly scoped as qualification trials (no circularity). Receiving-side
mechanical rejection = delegated-authority enforcement, not semantic policy
(§6.3). Why: Mint admission against a stale snapshot is a real failure
mode (Astra 31). ARCH: YES (gate insertion). Phases: A0–A6. Evidence later:
boundary demonstration inside programme; CA-01 before first remote
actuation. Owner decision: none (evidence question).

**V7.1-C04 — Discovery closed, compatibility gated (Astra F4,
REQUIRED_V7_CORRECTION).** V7 text: "CLOSED_BY_CURRENT_SOURCE", "direct
reuse", "new rows, never new tables", "every mechanism now has an owner".
Correction: §7 replaces verdicts with `OWNER_DISCOVERY_CLOSED /
DOMAIN_COMPATIBILITY_UNPROVEN` per owner family; storage-layout prohibitions
removed; minimal Sims-specific boundary representation permitted (world
lineage, executor session, control attachment, interaction identity, game
incarnation, residual execution, game chronology, causal evidence); hard
retentions kept (no second planner/cognition/memory/world-adapter/universal
ontology/parallel effect-truth). Why: record-type fit ≠ world-semantics
fit; exactly-once record ≠ exactly-once game execution. ARCH: YES
(negative scope widened honestly). Phases: A7/A8 prerequisites; CA-01 gate.
Evidence later: CA-01 + controlled trials. Owner decision: none.

**V7.1-C05 — CA-01 recorded as gate, not performed (Astra K).**
V7 text: reuse conclusions that assumed CA-01's answer. Correction: §7.1
records the narrow question (remote lifecycle across lost ack, executor/
Host restart, changed attachment, uncertain dispatch, late receipt,
residual execution; record-completion vs world-effect confusion; unsafe
redispatch) with timing `REQUIRED_BEFORE_FIRST_REMOTE_ACTUATION = YES`,
all earlier gates NO. No source inspected here. Why: withdraws the assumed
answer while keeping programme motion. ARCH: NO. Phases: A0 (if early
integration) / pre-A5 / pre-first-remote-use. Evidence later: transition
map + focused tests per Astra scope. Owner decision: none.

**V7.1-C06 — Patch observability demoted to hypothesis (Astra F5,
REQUIRED_V7_CORRECTION).** V7 text: `OBSERVABILITY_IMPROVED`,
release "witnessable", duplicate-suppression "strengthens honesty" (V7-05,
§7.1 D2/D3, §27). Correction: §10 adopts
`PATCH_CREATES_CANDIDATE_OBSERVATION_SURFACES = YES`,
`OBSERVABILITY_IMPROVED_AT_RUNTIME = UNPROVEN`, `CONTROL_GRANTED = NO`,
`RELEASE_MECHANISM_QUALIFIED = NO`; cancellation ≠ observed termination ≠
hold release; duplicate suppression may REMOVE attempted-push evidence
(attribution tests must account for it). Five-dimensional A3 untouched.
Why: mechanism ≠ surface ≠ release. ARCH: NO. Phases: A2/A3 experiment
design. Evidence later: SI1/SI2 + LE2/LE3 witnessing. Owner decision: none.

**V7.1-C07 — Inference-path contract completed (Astra F6,
REQUIRED_V7_CORRECTION).** V7 text: protected final admission, under-
specified envelope→candidate path (§16). Correction: §8 full contract —
independently authored semantic envelope (§8.1: Thought / Owner-
experimental / Host-rule; Host invents no semantic goals); deterministic-
first, bounded, versioned, auditable candidate construction in qualification
(§8.2; construction change can invalidate qualification); side-effect
distinctions with withhold-on-unknown (§8.3, no universal ontology);
first-class omission with faithful-realization-impossible detection (§8.4);
first-class abstention (§8.5; no-answer ≠ refusal/completion/revocation).
Why: practical control can accrue without formal authority. ARCH: YES
(contract scope). Phases: shadow→A7. Evidence later: per-path shadow +
independent oracle. Owner decision: Gate B per path (§18).

**V7.1-C08 — Provider-neutral names + semantics + calibration (Astra F6/§6,
REQUIRED_V7_CORRECTION).** V7 text: frozen `J-RANK`/`J-MEMBERSHIP`, universal
temperature-fitting requirement. Correction: §8.6 adopts `S1-RANK` /
`S1-MEMBERSHIP` with `J-RANK`/`J-MEMBERSHIP` as recorded legacy aliases
(per second-pass naming recommendation); S1-RANK lower-burden ONLY if all
candidates already admissible within authorized discretion; S1-MEMBERSHIP
higher-burden (false inclusion admits unauthorized realization; model
estimates, never defines/enlarges envelope); §8.7 provider output semantics
(Choice distribution vs independent membership scores vs Score) preserved
exactly through adapters — wire compatibility ≠ semantic equivalence;
§8.8 replaces universal temperature fitting with appropriate calibration
assessment + accepted decision rule + use-case shadow evidence. Why:
names follow the neutral design; technique follows evidence. ARCH: NO
(authority/burden unchanged). Phases: shadow corpus. Evidence later:
per-path calibration evidence. Owner decision: none.

**V7.1-C09 — Gate A resolved; CA-02 retired (Astra F7,
OWNER_POLICY_RESOLVED).** V7 text: Gate A Owner-policy-open (OP1), CA-02
implied pending. Correction: §9 records
`OWNER_GATE_A_DECISION = HOSTED_BOUNDED_SIMS_MECHANICAL_DISCLOSURE_ACCEPTED`
with allowed classes + binding exclusions; `GATE_A_PHASE_A_BLOCKER = NO`;
Gate B unchanged (path/model-specific, shadow-first, never automatic);
CA-02 retired as programme prerequisite; narrow pre-request hygiene remains
(build from permitted bounded representation; excluded data cannot enter).
Why: Owner decision settles policy; technical route ≠ policy. ARCH: NO.
Phases: any hosted send. Evidence later: none for policy; hygiene checked
per request. Owner decision: none now (re-ask only if scope exceeded).

**V7.1-C10 — Resource language repaired (Astra F8, REQUIRED_V7_CORRECTION).**
V7 text: SOURCE_FEASIBLE + CPU preference + categorical same-PC exclusions
(V7-12, §8D, §27). Correction: §11 adopts
`LOCAL_SYSTEM_ONE_RESOURCE_STATUS = RESOURCE_PLAUSIBLE +
COEXISTENCE_UNQUALIFIED + NEEDS_LOCAL_BENCHMARK`; CPU-vs-GPU left open
(measurement question); separate process strongly preferred (isolation ≠
contention cure — CPU, VRAM, scheduler, RAM, load/unload, latency, snapshot
expiry, game perturbation distinguished); benchmark OPTIONAL_PARALLEL_TO_A0,
not required for A0/A1/deterministic A2; shadow-during-trial interference
must be measured or explicitly conditioned; coexistence qualified before
any influence reliance. Why: placement solves different problems than
isolation; small counts ≠ context fit. ARCH: NO. Phases: A0-parallel LB1.
Evidence later: LB1 measurement. Owner decision: optionally authorize LB1.

**V7.1-C11 — Provenance law adopted (Astra F10, REQUIRED_V7_CORRECTION).**
V7 text: origin split at dispatch; survival through ingress/recovery/
summarization/adoption unestablished. Correction: §12 master law —
every adoptable embodied observation retains source, authority origin
(EXPERIMENT / THOUGHT_ENDORSED / OWNER_DIRECT / NATIVE_SIM_AUTONOMY /
UNKNOWN / future bounded kinds), world lineage/save context, executor/
attachment context, observation time, as-of currentness, uncertainty,
causal scope; source ≠ authority origin (game "directed" ≠ Ashley
authorship); "current" always as-of; rollback history ≠ current-world fact;
summarization must not launder experiment into intention; no Sims memory
subsystem (existing owners reused when compatibility established; no
memory archaeology required for V7.1 acceptance or isolated A0). Why:
context loss converts experiment into false autobiography (Astra 37).
ARCH: NO (fields-or-references, no new subsystem). Phases: A2/A7/A9.
Evidence later: compatibility check before adoption-path implementation.
Owner decision: OP4 consent remains Owner policy; adoption stays Thought-owned.

**V7.1-C12 — Ledger + readiness repaired (Astra F9 + phase decision,
REQUIRED_V7_CORRECTION).** V7 text: `TOTAL_OPEN_CONSEQUENTIAL_ITEMS = 13`
(exhaustive-implying), LB1 excluded, SS→SI mapping incomplete, blanket
Phase A readiness. Correction: §17 ledger with ID/TYPE/QUESTION/BLOCKS_WHAT/
EVIDENCE_CLASS/STATUS per item, full PP/LE/TS/SS/SI/OP/LB mapping,
COUNTED_ACTIVE_ITEMS with EXHAUSTIVE_TOTAL = NOT_ASSERTED; §1/§19 readiness
replaced by bounded-A0 distinctions; §18 owner decisions narrowed to genuine
policy choices. Why: subtotal ≠ inventory; readiness ≠ editorial constant.
ARCH: NO. Phases: programme gates. Evidence later: per-item classes.
Owner decision: §18 sequence.

---

## 6. Topology: experimental, integrated, production (F2/F3 repair)

Three topologies must never be collapsed:

- **A. EXPERIMENTAL TOPOLOGY** — the harness + game + authority arrangement
  sufficient for a *bounded claim*. Windows-local A0 (and conditional A1/A2)
  is a legitimate experimental topology when its results are explicitly
  limited to the exercised client/world/configuration/harness.
- **B. INTEGRATED ASHLEY TOPOLOGY** — Mint Thought/admission/receipts coupled
  to Windows execution across the remote boundary. Required for any claim
  that depends on remote correctness; its boundary properties (§6.3) must be
  demonstrated first.
- **C. EVENTUAL PRODUCTION TOPOLOGY** — the deployment the Owner actually
  wants to live with. Explicitly NOT frozen before A0.

### 6.1 Windows-local early path

```text
SHOULD_FINAL_PRODUCTION_TOPOLOGY_BE_FROZEN_BEFORE_A0 = NO
CAN_WINDOWS_LOCAL_A0_BEGIN_WITHOUT_MINT_BRIDGE = YES
CAN_WINDOWS_LOCAL_A1/A2_YIELD_VALID_BOUNDED_RESULTS = ONLY_WITH_CONDITIONS
```

Conditions: explicit Owner experimental authority; noncanonical test scope;
applicable local body binding/currentness/action/attribution contracts hold;
evidence bound to the exact exercised client, world, configuration, and
harness; no promotion of Windows-local evidence into remote-boundary
qualification. A Windows-local harness is a bounded experimental
realization surface — not "Windows Ashley." One Ashley is preserved because
no second semantic authority is created there.

### 6.2 Optional early integration

The Owner may include Mint integration in A0 scope. If so, controlled
qualification trials MAY exercise the as-yet-unqualified boundary *for the
purpose of qualifying it*, explicitly scoped as such. However:

```text
EVIDENCE FROM AN UNQUALIFIED BOUNDARY MUST NOT BE PROMOTED INTO AN
ACCEPTANCE CLAIM THAT DEPENDS ON BOUNDARY CORRECTNESS.
```

This breaks the circular rule without permitting it as a loophole: trial
evidence qualifies the boundary; it is not itself the qualified claim.

### 6.3 Minimum remote-boundary contract

Before ANY accepted claim depends on remote Mint→Windows actuation:

1. scoped command authority; 2. origin provenance; 3. designated
   body/world/session binding; 4. relevant snapshot/precondition identity;
5. receiving-side stale rejection; 6. receiving-side revoked-authority
   rejection; 7. mismatch rejection; 8. idempotency/duplicate handling;
9. command→enqueue→lifecycle→observation correlation; 10. disconnect
   semantics; 11. OUTCOME_UNKNOWN handling; 12. no unsafe replay after
   uncertainty; 13. stop requested ≠ stop received ≠ cancellation accepted
   ≠ observed stop; 14. game chronology distinguished from Host/network
   chronology; 15. currentness revalidation close to actuation.

Windows-side mechanical rejection of an invalid command is enforcement of
delegated authority — never independent semantic policy. A short round trip
does not establish currentness: the world can change inside the interval.
If the executor is untrusted for factual truth, lifecycle self-reports
cannot alone establish causal success; qualification needs an independent
observation route with stated scope.

### 6.4 A5 remains (broader boundary/integration qualification)

A5 decides whether the exercised boundary is sufficient, needs revision,
needs an additional helper, or needs different placement — covering
network, lifecycle, and operational qualification beyond §6.3. A5 may NOT
retroactively qualify evidence from earlier remote actuation. No phase
reorder (per second-pass: logical dependency fix, not a reorder).

---

## 7. Owner discovery vs domain compatibility (F4 repair)

For each Ashley owner family surveyed in V7 §5, V7.1 states two separate
verdicts:

| Owner family (V7 §5 survey) | Owner discovery | Domain compatibility |
|---|---|---|
| Cycle identity/generation/fencing | OWNER_DISCOVERY_CLOSED | DOMAIN_COMPATIBILITY_UNPROVEN (remote attachment/session binding untested) |
| EffectRef / in-flight / receipts / settlement | OWNER_DISCOVERY_CLOSED | DOMAIN_COMPATIBILITY_UNPROVEN (record vs world-effect gap; see CA-01) |
| Undertaking / detached / completion | OWNER_DISCOVERY_CLOSED | DOMAIN_COMPATIBILITY_UNPROVEN (CA-01 gate) |
| Bounded continuation / retry / OUTCOME_UNKNOWN | OWNER_DISCOVERY_CLOSED | DOMAIN_COMPATIBILITY_UNPROVEN (lease vs ongoing game interaction; Astra 34) |
| Continuity lineage / sessions / recovery order | OWNER_DISCOVERY_CLOSED | DOMAIN_COMPATIBILITY_UNPROVEN (three-continuity split, §12) |
| Ingress / inbox / wake triggers / projector | OWNER_DISCOVERY_CLOSED | DOMAIN_COMPATIBILITY_UNPROVEN (Sims modality + mandatory-fact delivery) |
| Privacy classification / disclosure gates | OWNER_DISCOVERY_CLOSED | Conditionally applicable: request hygiene required per send (§9); full-route reuse unproven and no longer required (CA-02 retired) |
| Perception substrate | OWNER_DISCOVERY_CLOSED | DOMAIN_COMPATIBILITY_UNPROVEN (Sims observation modality adaptation) |

"Closed" is bounded to the artifact's asserted survey (per second-pass: not
independent verification). Presumption retained: **reuse existing Ashley
owners where their invariants fit.** Permitted where needed: **minimal
Sims-specific boundary representation** for world lineage, executor
session, control attachment, interaction identity, current game incarnation,
residual execution, game chronology, causal evidence. Removed: "new rows,
never new tables", "direct reuse", "all mechanisms already have owners" as
architectural law. Retained hard: no second planner, no second cognition,
no second memory authority, no generic world adapter, no universal Sims
action ontology, no parallel effect-truth system — unless later evidence
proves one unavoidable.

### 7.1 CA-01 gate (recorded, not performed)

Narrow question: can the existing effect/detached-operation lifecycle
safely represent one remotely actuated Sims interaction across lost
acknowledgement, Windows executor restart, Host restart, changed game
attachment, uncertain dispatch, late receipt, and residual game execution —
without confusing operation-record completion with world-effect completion
or enabling unsafe redispatch? Timing: NO before master acceptance / A0 /
Phase A authorization; **YES before first remote actuation**. May run
during A0 (early-integration branch) or before A5/first remote use.
Source inspection then establishes reusable scope; controlled trials
establish runtime behavior. No source inspected in V7.1.

---

## 8. System One path contract (F6 repair; shortlist preserved from V7 §8)

V7's field map, candidate matrix, fitness notes, economics, and tiered
shadow shortlist (Laya-421M / Kev-0.8B Tier 1; Von Tier 2; Jev 1.13.0 hosted
reference; Nimble-9B Mint-side only; Tev1 baseline-grade; encoder/NLI/LLM
baselines) are preserved unchanged — this revision performs no new
research and replaces no candidate. What changes is the per-path contract.

### 8.1 Semantic envelope (independently authored)

Thought authors Thought-endorsed meaning/intention. Owner experimental
authority authors the experimental semantic test class. Host deterministic
rules author mechanical constraints. **The Host may not invent a semantic
goal merely because the model needs a prompt.**

### 8.2 Candidate construction

Deterministic where possible; bounded; versioned; auditable; included in
qualification. A candidate-construction change can invalidate path
qualification even when the model is unchanged. Construction, context
assembly, and filtering versions belong in the path tuple alongside model
revision, quantization, backend, and calibration revision.

### 8.3 Side-effect distinctions

Before ranking, represent distinctions consequential to the authorized
semantic class (e.g. sit vs nap vs cuddle sharing a posture with different
duration/interruptibility/social meaning). Unknown consequential
differences → withhold / abstain / escalate — never let the model choose.
No universal side-effect ontology required.

### 8.4 Omission is first-class

`OMITTED != REJECTED` — but omission may make faithful realization
impossible or materially bias selection. A path must detect when
truncation, provider option limits, context limits, or deterministic
filtering could remove the faithful candidate. Infrastructure limits must
not silently select Ashley's available world (Astra 33).

### 8.5 Abstention is first-class

No-answer is not Ashley refusal, not task completion, not experiment
revocation. Deterministic composition over a probabilistic answer (e.g. a
threshold) still makes execution depend on that answer — legitimate only
inside an authorized envelope with bounded variation, qualified use,
residual-fact estimation, and abstention that is never recorded as refusal.

### 8.6 S1-RANK vs S1-MEMBERSHIP (names adopted per second-pass recommendation)

```text
S1-RANK = ranking/ordering/salience among already-listed candidates
S1-MEMBERSHIP = whether a candidate belongs inside the authorized envelope
LEGACY_ALIAS: J-RANK = S1-RANK; J-MEMBERSHIP = S1-MEMBERSHIP
```

Names are continuity labels, not authority. S1-RANK is lower-burden ONLY
if every ranked candidate is already semantically admissible and
differences fall within authorized discretion — ranking materially
different outcomes is not mere ranking. S1-MEMBERSHIP is higher-burden:
false inclusion may admit an unauthorized realization; the model may
*estimate* membership against the envelope but may NOT define or enlarge
it; independent-oracle evidence must address false inclusion specifically.

### 8.7 Provider semantics preserved through adapters

Choice distributions, independent membership probabilities, and Score
levels are not interchangeable because they share typed fields. Adapters
must preserve the exact output semantics being qualified (exclusivity,
independence, ordinality, abstention behavior, candidate/context limits).
Wire compatibility ≠ semantic equivalence.

### 8.8 Calibration without frozen technique

Each path requires appropriate calibration assessment + accepted decision
rule + use-case-specific shadow evidence, with calibration/decision data
appropriately separated and thresholds never treated as semantic
permission. Temperature fitting is one technique among others — required
only when the path's evidence plan selects it.

### 8.9 Whole-path qualification tuple (V7-09 preserved; ref repaired)

Per-path local tuple (no global registry): path_id; path_kind
(S1-RANK/S1-MEMBERSHIP); semantic-envelope version; candidate-construction
version; question/state schema versions; provider_kind/runtime; model
family + exact revision + weight/alias resolution; quantization;
inference backend; calibration revision + decision rule; local-vs-hosted +
hardware/runtime class; ground-truth definition (independent oracle);
deterministic baseline; shadow metrics + coverage/abstention outcomes;
negative controls; Gate A/B status; enable flag; revoke switch;
admission/snapshot-currentness policy refs; supported Sims build +
DLC/mod scope. Material change to any element → scoped requalification of
that path. `QUALIFIED MODEL != QUALIFIED DECISION PATH.`

### 8.10 Shadow shortlist + baselines (preserved, non-committal)

Tier 1 local-light (Laya-421M, Kev-0.8B), Tier 2 (Von-1.1), hosted Jev
1.13.0 reference, Mint-side Nimble-9B, DIY Tev1, classical baselines — all
NEEDS_EXPERIMENT. The shortlist is experimental convenience, not
architecture commitment; kill criteria must be able to eliminate the
optional inference path entirely. No hosted reference call is a
prerequisite for deterministic A0/A1/A2.

### 8.11 Fallback (V7-10 preserved)

`MODEL A QUALIFICATION != MODEL B QUALIFICATION.` Optional-path failure
returns no-answer for that judgment (fail closed, scoped to the
unsupported action). Explicitly qualified fallback is a distinct path. A
separately authorized deterministic path may still operate independently.

---

## 9. Privacy / Gate A — Owner policy resolved (F7)

```text
OWNER_GATE_A_DECISION = HOSTED_BOUNDED_SIMS_MECHANICAL_DISCLOSURE_ACCEPTED
GATE_A_PHASE_A_BLOCKER = NO
GATE_B = PATH_SPECIFIC + MODEL_SPECIFIC + SHADOW_FIRST +
  NOT_AUTOMATICALLY_AUTHORIZED
```

Allowed in principle: interaction/affordance labels; opaque object refs;
bounded candidate lists; queue state; interaction state; body mechanical
state; motives/needs; bounded world state; experiment metadata; other
narrowly scoped Sims mechanical evidence a path needs. Still excluded:
credentials; API keys; secrets; raw private Thought; unrelated Owner
conversations; unrelated private/autobiographical material. No further
privacy optimization; no ZDR prerequisite; CA-02 retired as programme
prerequisite. Narrow technical hygiene remains before each actual provider
request: construct from the permitted bounded representation; verify
excluded classes cannot enter. Deterministic local Phase A with no hosted
send requires no hosted posture at all.

---

## 10. Patch status repair (F5)

```text
PATCH_CREATES_CANDIDATE_OBSERVATION_SURFACES = YES
OBSERVABILITY_IMPROVED_AT_RUNTIME = UNPROVEN
CONTROL_GRANTED = NO
RELEASE_MECHANISM_QUALIFIED = NO
```

The 1.128.90.1030 delta (V7 §7 D1–D8) is preserved as research input:
preference-gated autonomy, duplicate-push suppression, the
`cancel_on_user_directed_action` field, directed/autonomous instance
splits, stand-slot fixes, save-conditional fixes. But a cancellation
mechanism does not prove observable cancellation; cancellation does not
prove hold release; duplicate suppression may remove attempted-push
evidence; patch facts design experiments — Owner-client behavior must
still be witnessed. Cancellation, acknowledgement, observed lifecycle
termination, and hold release are four separate facts.

---

## 11. Resource status repair (F8)

```text
LOCAL_SYSTEM_ONE_RESOURCE_STATUS =
  RESOURCE_PLAUSIBLE + COEXISTENCE_UNQUALIFIED + NEEDS_LOCAL_BENCHMARK
```

Paper footprints (V7 §8D) are plausibility only. CPU-vs-GPU placement is
an open measurement question; separate process stays strongly preferred
for isolation/termination while solving none of contention by itself.
Distinguish CPU contention, GPU VRAM contention, GPU scheduler
contention, system RAM, load/unload cost, inference latency, snapshot
expiry, game timing perturbation. LB1 benchmark is OPTIONAL_PARALLEL_TO_A0
— not required for A0, A1, or deterministic A2; coexistence must be
qualified before any influence reliance; shadow-during-trial interference
must be measured or the run's claims must condition on it. The success
measure is complete answers arriving inside snapshot validity without
unacceptable game interference — not inference speed alone.

---

## 12. Experiment / world provenance law (F10)

Any embodied observation/event capable of later semantic adoption must
retain recoverable provenance:

```text
OBSERVATION_SOURCE (!= authority origin)
OBSERVED_ACTION_AUTHORITY_ORIGIN ∈ { EXPERIMENT, THOUGHT_ENDORSED,
  OWNER_DIRECT, NATIVE_SIM_AUTONOMY, UNKNOWN, future bounded kinds }
WORLD_LINEAGE / SAVE CONTEXT
EXECUTOR / ATTACHMENT CONTEXT (where relevant)
OBSERVATION_TIME
AS_OF_CURRENTNESS ∈ { current, historical, unknown, superseded, …bounded }
UNCERTAINTY / OUTCOME_UNKNOWN
CAUSAL_ATTRIBUTION_SCOPE
```

A game "user directed" marker distinguishes directed execution from native
autonomy where supported — it does NOT establish Owner-experimental vs
Thought-endorsed vs Owner-manual authorship; V7.1's own attributable
command correlation is still required (Astra 36). Summarization/memory/
adoption must never erase provenance so "an experiment happened" becomes
"Ashley chose this", or pre-rollback truth becomes current-world fact.
"Current" is always an as-of claim; a retained label must not freeze an
old observation permanently current. Obligations may ride retained fields
or reliable evidence references. No Sims memory subsystem; existing
memory/adoption owners reused when compatibility established; no memory
archaeology required for V7.1 acceptance or isolated A0. Owner consent
(OP4) governs entering experimental contexts; it cannot substitute
Thought's semantic adoption. Rollback need not erase truthful experience:
"occurred in earlier history" vs "true of current world" stays distinct.
Thought may express anticipation/prospective preference identified as such
— the firewall bans Host-authored biography, not Thought's own voice.

---

## 13. Body / world continuity clarification

`PERSISTED_HOST_BODY_BINDING = {save_slot_guid, sim_id}` preserved; no
stronger token invented. Three continuities distinguished (never
interchanged): (1) Ashley cognitive lineage; (2) Sims world/save history;
(3) current executor/control attachment. Hence: Save-As may fork lineage
(silent continuation forbidden); rollback retains designation while
history moves backward (Astra 35); travel/reconnect re-establishes
attachment; deletion/resurrection ≠ uninterrupted chronology; CAS changes
prove neither identity nor loss; unavailable body withholds actuation
without substitution; active-Sim UI selection is not binding authority.
CA-01/Phase A determine exact remote-world compatibility.

---

## 14. A0–A9 programme — order preserved, gates repaired

Order frozen A0→A9. V6.1.1 per-phase QUESTION/PREREQUISITES/ACCEPTANCE/
EXCLUSIONS incorporated by reference (§3) with these V7.1 gate repairs:

**A0 — bounded discovery/instrumentation (immediate authorization target).**
Learning floor: instrumentation, client/source/interface discovery (SI1),
evidence-floor construction, local deterministic harness, noncanonical
test environment. Topology per Owner choice (§6.1 or §6.2). Must not
require final production topology. May include A0-scoped implementation
once separately authorized. Acceptance: bounded scope executed, surfaces
logged, no claim beyond exercised topology.

**A1 — body designation/currentness.** System One irrelevant to identity.
Windows-local evidence valid only for the exercised bounded
topology/configuration.

**A2 — SIT_ON_EXACT_SOFA_A preferred** (unless current evidence
invalidates); EXPERIMENT_AUTHORITY_ORIGIN; System One optional; shadow
never counts toward acceptance.

**A3 — five-dimensional envelope (§3.7).** Patch cancellation surfaces are
experiment candidates only (§10). Mechanism EXPERIMENTAL.

**A4 — measured/predicted/hard-constraint/unknown timing + need-as-body-
fact semantics preserved;** surfaces re-identified on 1.128 (SI1/SS5).

**A5 — broader boundary/integration qualification** (§6.4). No retroactive
qualification. HELPER NOT NEEDED remains valid for beyond-bridge scope.

**A6 — realistic upstream perception/invalidation/omission/coalescing/
freshness.** Meaningful even if command-currentness began earlier; not the
first enforcement point for it.

**A7 — first real Thought-endorsed embodied action stays here.** No
consequential evidence moves it earlier; a narrower earlier action would
still owe A2–A6 applicable properties. Insufficient evidence to advance.

**A8 — current bounded pursuit may reduce infrastructure needs** but proves
neither prospective world validity nor multi-step/remote semantics. No
Sims planner.

**A9 — optional joint participation/interpretation;** never the first
moment Ashley may discuss or interpret embodied experience.

---

## 15. Astra C01–C12 — complete mapping (F1 repair)

For each: original finding → Owner/Sol adjudication (V6.1.1 §27) →
V6.1.1 disposition → V7.1 status + section. (Second-pass regression
positions incorporated where given; remaining entries assessed against the
now-supplied mapping — statuses used only where supported.)

| ID | Original finding → adjudication | V6.1.1 | V7.1 status → section |
|---|---|---|---|
| C01 | Inspection ≠ runtime qualification; Sept22 list over-claimed runtime → reword to identify/formulate; drop runtime A2-witness + latency prerequisites | ABSORBED | MODIFIED_BY_V7_1 → §§7,10: discipline extended to reuse closures, "live" wording, patch observability |
| C02 | A2/A7 contradiction; Sofa A fabricated endorsement → A2 = EXPERIMENTAL_REQUEST SIT_ON_EXACT_SOFA_A; A7 = first Thought-selected; self-contained phase contracts | MODIFIED | PRESERVED → §§3.2,12,14 |
| C03 | Pipeline misordered enqueue/lifecycle/receipt before inference → correct order; receipts after final admission | ABSORBED | PRESERVED → §3.3 |
| C04 | Owner stop / Host refusal collapsed into Ashley mental state → independent intervention records | ABSORBED | MODIFIED_BY_V7_1 → §§6.3,12: + remote stop-scope quadripartition; provenance law |
| C05 | Rank vs membership collapsed; earning/kill unclear → split S1-RANK/S1-MEMBERSHIP; higher membership burden | MODIFIED | MODIFIED_BY_V7_1 → §8.6/§8.9: provider-neutral names + full path contract |
| C06 | Currentness underspecified through queue → revalidate at observable boundaries; relevant-change invalidation | ABSORBED | MODIFIED_BY_V7_1 → §6.3: boundary contract makes revalidation placement explicit pre-claim |
| C07 | A3 sixth-dimension/social-first/quiet=CONTROL risk → five dims; social out; stages separate | MODIFIED | PRESERVED → §3.7 (dims enumerated for the first time in V7-lineage) |
| C08 | A4 measurement underspecified → MEASURED/PREDICTED/HARD CONSTRAINT/UNKNOWN + requalify triggers | ABSORBED | PRESERVED → §14 A4 |
| C09 | Mandatory reporting thin; one-call-per-event risk → expanded classes; retain+route/coalesce; no new subsystem | ABSORBED | PRESERVED → V7 §18 substance retained; delivery conditional on §7 compatibility note |
| C10 | Qualification tuple incomplete; weak membership oracle → whole-path tuple; independent oracle; code-compose | ABSORBED | MODIFIED_BY_V7_1 → §8.9: tuple extended (provider/runtime/calibration/construction); §16 operative floor |
| C11 | Remote wait blocking mutation thread → absolute nonblocking | ABSORBED | PRESERVED → broadened V7 law accepted by Astra; §8.5/§11 placement orthogonal |
| C12 | Zero-count theater → falsification floor; separate truthfulness/function/evidence | ABSORBED | PRESERVED → §16 operative restoration |

Second-pass "UNASSESSABLE_FROM_TARGET" entries (C05, C07–C12) are resolved
by this mapping; no regression is asserted beyond the MODIFIED_BY_V7_1
strengthenings above, each tied to its correction entry (§5).

---

## 16. Qualification / falsification floor (operative)

```text
define → instrument → shadow where applicable → compare against
independent/use-case ground truth → falsification opportunities →
separate truthfulness / function / evidence verdicts →
Owner Gate B where influence proposed → bounded live use → revoke switch
```

Apparent passes explicitly closed (coverage + abstention beside accuracy;
oracles independent of the disputed mapping; shadow judged separately from
A2 success; posture ≠ attribution; stale tests must mutate state mid-
inference/transit/enqueue; bridge trials must cover duplicate/loss/delay/
old-session cases; aggregate calibration must survive consequential false-
inclusion analysis; quiet scenes must offer prohibited behavior real
opportunity — per claimed A3 dimension):

NEVER: confidence ≥ 0.9 ⇒ safe to actuate; noul-high ⇒ Ashley wants it;
calibrated ⇒ authorized; model agreement ⇒ ground truth; zero-count
theater ⇒ success. Noul mid-band is first-class uncertainty. Independent
oracle requirements stay use-case specific (A2 experiment: curated
interaction-class evidence vs semantic test class; A7+: vs Thought-endorsed
class; S1-RANK: required-vs-optional labels + leakage audit; S1-MEMBERSHIP:
independent envelope oracle + mandatory deterministic baseline). Threshold
selection is not semantic permission. Calibration/decision evidence
appropriately separated. Hardware/runtime changes invalidate semantic
results only through stated evidence dependencies (§8.9).

---

## 17. Residual self-deception risks (29 preserved + 30–37 absorbed)

V7 §24 items 1–29 preserved (with 26 repaired per §10: patch improvement ≠
control; observability unproven). Absorbed from Astra J (merged where
overlapping, substance kept):

30. Generic ownership mistaken for domain compatibility (§7).
31. Correct remote admission followed by stale local execution (§6.3).
32. Shadow inference changes the experiment through resource contention (§11).
33. Provider/context limits silently select the available world (§8.4).
34. Host/effect lease expiry conceals ongoing Sims interaction (§7.1 CA-01).
35. Same body designation hides different world history (§§12–13).
36. Game "directed" provenance mistaken for Ashley authorship (§12).
37. Experimental provenance disappears during summarization/adoption (§12).

---

## 18. Open-item ledger (repaired; F9)

Conventions: EVIDENCE_CLASS ∈ {DOCUMENT_CHECK, READONLY_INSPECTION,
LIVED_TRIAL, OWNER_CHOICE, MEASUREMENT}. Technical evidence ≠ Owner policy;
Owner preference ≠ architecture fact. SS obligations merge into SI/LE
entries explicitly (no orphan SS). DEFERRED marks parked branches.

| ID | TYPE | QUESTION | BLOCKS_WHAT | EVIDENCE_CLASS | STATUS |
|---|---|---|---|---|---|
| PP1 | patch-note research | Exact build + delta reconciliation? | Design grounding | DOCUMENT_CHECK | CLOSED (V7 D-matrix; research-only) |
| PP2 | patch-note research | Binding least-wrong post-patch? | Hypothesis retention | DOCUMENT_CHECK | CLOSED as research; verification moved to LE1/SI1 |
| PP3 | patch-note research | Sofa A still preferred? | Experiment preference | DOCUMENT_CHECK | CLOSED as research; mapping unwitnessed (LE2) |
| PP4 | patch-note research | Autonomy/queue/sleep impact? | Experiment design inputs | DOCUMENT_CHECK | CLOSED as research; runtime impact unwitnessed (LE2/LE3/SI1) |
| LE1 | lived | Binding durability: Save-As/rollback/CAS/travel/deletion + save-conditional cases? | A1 acceptance | LIVED_TRIAL | ACTIVE |
| LE2 | lived | A2 ladder honesty on Owner client (incl. duplicate-suppression accounting)? | A2 acceptance | LIVED_TRIAL | ACTIVE |
| LE3 | lived | A3 five-dim coexistence in finite envelope? | A3 acceptance | LIVED_TRIAL | ACTIVE |
| LE4 | lived | A4 MEASURED timing/need couplings + requalify triggers? | A4 acceptance | LIVED_TRIAL | ACTIVE |
| LE5 | lived | Affordance-label noise: residual matcher earned (any candidate + baselines)? | S1-path qualification | LIVED_TRIAL | ACTIVE |
| LE6 | lived/boundary | Narrow-boundary behavior under real conditions (only if integrated route)? | Remote-dependent claims; A5 | LIVED_TRIAL | ACTIVE (conditional branch) |
| TS1–TS5 | owner discovery | Generic Ashley owners for identity/recovery/ingress/guarantees/privacy? | Reuse candidacy | DOCUMENT_CHECK (done) | CLOSED as discovery; compatibility → CA-01/SI/LE |
| SS1 | observation wiring | Mandatory-reporting retention/route surfaces? | Invalidating-fact delivery | READONLY_INSPECTION + LIVED_TRIAL | MERGED → SI1 (identify) + LE2/LE3 (prove delivery) |
| SS2 | observation wiring | A2 lifecycle/effect/attribution surfaces? | A2 claims | READONLY_INSPECTION + LIVED_TRIAL | MERGED → SI1 (identify; symbol vs behavior split) + LE2 |
| SS3 | observation wiring | Stop/cancel/attachment boundaries? | Currentness-through-queue; §6.3 items 5–13 | READONLY_INSPECTION + LIVED_TRIAL | MERGED → SI1 + boundary demonstration + LE2 |
| SS4 | observation wiring | A3 envelope detect/report/release fields? | A3 acceptance | READONLY_INSPECTION + LIVED_TRIAL | MERGED → SI1 + LE3 |
| SS5 | observation wiring | A4 dual-report timing/need surfaces? | A4 measurement | READONLY_INSPECTION + LIVED_TRIAL | MERGED → SI1 + LE4 |
| SI1-sym | targeted source | Which script/tuning symbols exist on 1.128? | Investigation completeness | READONLY_INSPECTION | ACTIVE (may run in A0) |
| SI1-beh | targeted source | Do those symbols behave as needed? | Action/attribution claims | LIVED_TRIAL | ACTIVE (blocks dependent claims, not A0) |
| SI2 | targeted source | Directed-vs-autonomous coverage per interaction? | Any attribution using that field | READONLY_INSPECTION + LIVED_TRIAL | ACTIVE |
| SI3 | targeted source | Residence/inventory/property representations? | Future house/items use | READONLY_INSPECTION | ACTIVE but DEFERRABLE (blocks nothing before A2) |
| OP1 | owner policy | Bounded hosted disclosure posture? | Hosted sends | OWNER_CHOICE | RESOLVED (§9 bounded scope; re-ask only if exceeded) |
| OP2 | owner policy | Deployment/placement preference (incl. early-integration choice)? | A0 topology branch | OWNER_CHOICE | ACTIVE (Owner decision §19) |
| OP3 | owner policy | S4CL value vs brittleness? | Helper-shape option | OWNER_CHOICE after engineering inputs | ACTIVE (engineering question first) |
| OP4 | owner policy | Participation/memory-adoption consent? | A9 + adoption contexts | OWNER_CHOICE | ACTIVE (consent only; adoption stays Thought-owned) |
| LB1 | benchmark | Local coexistence measurement? | Influence reliance on local config | MEASUREMENT | ACTIVE OPTIONAL (parallel to A0; not on critical path) |
| CA-01 | compatibility gate | Remote lifecycle fit? | First remote actuation | READONLY_INSPECTION + LIVED_TRIAL | GATE (timing §1; not an "open count" entry) |

```text
COUNTED_ACTIVE_ITEMS = 14 (LE1–LE6: 6; SI1-sym/SI1-beh/SI2/SI3: 4;
  OP2/OP3/OP4: 3; LB1: 1)
DEFERRED_ITEMS = SI3 (deferrable), house/items semantics, Nimble Mint-side
  path, Tev1 development, full-production-topology freeze
EXHAUSTIVE_TOTAL = NOT_ASSERTED
ADJUDICATED_NOT_OPEN = S1 split + legacy aliases; A3 five dims w/o social;
  A2 ≠ endorsement; A7 first Thought-endorsed; Gate A resolved scope
```

---

## 19. Owner decisions (genuine policy choices only)

1. Accept or decline V7.1 as master.
2. Authorize or decline BOUNDED_A0_DISCOVERY_AND_INSTRUMENTATION (scope +
   noncanonical world it may inspect).
3. Choose A0 topology: WINDOWS_LOCAL_FIRST or INCLUDE_EARLY_MINT_INTEGRATION.
4. Optionally authorize LOCAL_SYSTEM_ONE_COEXISTENCE_BENCHMARK (LB1).
5. Later: enable/decline each individually qualified influence path (Gate B);
   enter/decline optional shared participation (A9 consent).

Never ask the Owner to decide bridge correctness, lifecycle compatibility,
attribution adequacy, model calibration, or patch-interface survival —
those are evidence questions. OP1 is resolved; re-ask only on material
scope exceedance. Thought endorsement is never the Owner's to substitute.

---

## 20. Readiness model (replaces V7 status)

Semantics preserved from second-pass §5: the A0–A9 programme may be
accepted now as governing direction; that grants no blanket execution
permission; later phases keep evidence + authority gates. A0 may include
its separately authorized implementation scope; `IMPLEMENTATION_READY = NO`
means the whole embodiment cannot execute from this document alone.
Sequence: accept V7.1 → authorize bounded A0 → gather interface evidence
→ resolve remote compatibility only if integrated → adjudicate A1/A2
readiness. (See §1 block for the machine-readable values.)

```text
SYSTEM_ONE_REQUIRED_FOR_A0 / A1 / DETERMINISTIC_A2 = NO (all three)
```

---

## 21. Lineage / status (§21 of task)

```text
SUPERSEDE_V7_AS_MASTER = YES, if Owner accepts it
V7 REMAINS PROVENANCE = YES
V6.1.1 REMAINS NORMATIVE DEPENDENCY = YES (§3 precedence)
SOURCE ANCHORS UNCHANGED = Ashley 60fec11/123d744a; Sims 1.128.90.1030
RESEARCH CUTOFF UNCHANGED = 2026-09-28 (no new research performed)
```

---

## 22. Final master block

```text
DOCUMENT = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_1.md
DOCUMENT_TYPE = MASTER EMBODIMENT DESIGN — ASTRA-ADJUDICATED REPAIR

PREDECESSOR_V7 = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7.md
V7_SHA256 = e38820e9b97fc188c005be298285636f5869bb6b26ee548fdbde430cd184791c

NORMATIVE_PREDECESSOR_V6_1_1 =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V6_1_1.md
V6_1_1_SHA256 = 3e57be00a0fca9e044fc368b2e45e6fe13e9009aba85e172dbeb38ce5b35583a

ASTRA_SECOND_PASS_SHA256 =
  5aa9eb50accb6170766f6831de9a75524d937356c88674adee9ce985ea364f01
  (task-stated; local file absent — UNVERIFIED against bytes;
   full text applied correction-by-correction)

ASHLEY_SOURCE_SHA = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
ASHLEY_SOURCE_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675

SIMS_BUILD = PC 1.128.90.1030
PATCH_DATE = 2026-09-22

ONE_ASHLEY = PRESERVED
NEW_ASHLEY_ARCHITECTURE_PROVEN_NECESSARY = NO

OWNER_GATE_A_DECISION = HOSTED_BOUNDED_SIMS_MECHANICAL_DISCLOSURE_ACCEPTED
GATE_A_PHASE_A_BLOCKER = NO
GATE_B = PATH_SPECIFIC + MODEL_SPECIFIC + SHADOW_FIRST +
  NOT_AUTOMATICALLY_AUTHORIZED

SYSTEM_ONE_REQUIRED = NO (A0/A1/deterministic-A2)
SYSTEM_ONE_NAMES = S1-RANK / S1-MEMBERSHIP
  (LEGACY_ALIAS: J-RANK = S1-RANK; J-MEMBERSHIP = S1-MEMBERSHIP)
SYSTEM_ONE_PROVIDER_LOCKED = NO

BODY_BINDING_DISPOSITION = PRESERVED ({save_slot_guid, sim_id})

WINDOWS_LOCAL_A0_ALLOWED = YES
EARLY_MINT_INTEGRATION_REQUIRED = NO (Owner choice)
FINAL_PRODUCTION_TOPOLOGY_FROZEN = NO

DOMAIN_COMPATIBILITY_PROVEN = NO (owner discovery closed; gates pending)

CA01_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
CA01_REQUIRED_BEFORE_A0 = NO
CA01_REQUIRED_BEFORE_FIRST_REMOTE_ACTUATION = YES

PATCH_CREATES_CANDIDATE_OBSERVATION_SURFACES = YES
OBSERVABILITY_IMPROVED_AT_RUNTIME = UNPROVEN
CONTROL_GRANTED = NO
RELEASE_MECHANISM_QUALIFIED = NO

LOCAL_SYSTEM_ONE_RESOURCE_STATUS =
  RESOURCE_PLAUSIBLE + COEXISTENCE_UNQUALIFIED + NEEDS_LOCAL_BENCHMARK

DESIGN_READY_FOR_OWNER_DECISION = YES
A0_DISCOVERY_READY_FOR_OWNER_AUTHORIZATION = YES
FULL_PHASE_A_EXECUTION_AUTHORIZED = NO

A1_EXECUTION_READY = NO
A2_EXECUTION_READY = NO

IMPLEMENTATION_READY = A0_ONLY_AFTER_SEPARATE_OWNER_AUTHORIZATION

NEXT_OWNER_DECISION = accept-V7.1 → authorize-bounded-A0 →
  choose-A0-topology → optionally-LB1 → later-per-path-Gate-B
```

---

## Appendix Q. Pre-return quality attestation (§24 items)

| # | Check | Result |
|---|---|---|
| 1 | Every V7 section reference checked | PASS (§20I/J → §8/§8.9; topology → §6; baselines → §8.10; fallback → §8.11) |
| 2 | Every inherited V6.1.1 reference checked | PASS (§3 prefix convention; §§3.1–3.7 restatements) |
| 3 | C01–C12 mapping complete | PASS (§15, 12/12 with supported statuses) |
| 4 | All F1–F10 represented | PASS (§5 C01–C12 ledger covers F1–F10; F7→C09) |
| 5 | CA-01 not closed | PASS (§7.1 gate; timing §1) |
| 6 | CA-02 retired | PASS (§9) |
| 7 | Gate A recorded | PASS (§9 + master block) |
| 8 | Gate B separate | PASS (§9; never automatic) |
| 9 | Windows-local A0 permitted | PASS (§6.1) |
| 10 | Mint integration not mandatory at A0 | PASS (§§6.1–6.2, master block) |
| 11 | No remote-dependent acceptance before boundary qualification | PASS (§6.3 gate + A5 non-retroactivity) |
| 12 | Reuse candidate ≠ compatibility | PASS (§7 table) |
| 13 | Patch fact ≠ runtime witness | PASS (§10) |
| 14 | Plausibility ≠ coexistence qualification | PASS (§11) |
| 15 | Experiment provenance ≠ Ashley intention | PASS (§12) |
| 16 | Rollback/history ≠ current-world fact | PASS (§§12–13) |
| 17 | A7 first Thought-endorsed action | PASS (§14) |
| 18 | No model as semantic authority | PASS (§§8.1, 8.6; §3.1 laws) |
| 19 | No new memory/cognition/adapter architecture | PASS (§§7, 12) |
| 20 | Next authorization is bounded A0, not blanket Phase A | PASS (§§1, 18–20) |

---

*End of V7.1. Direction preserved from V7; twelve corrections adjudicated;
normative package auditable; topology scoped; compatibility gated, not
claimed; Gate A resolved; names neutralized with legacy aliases; ledger
honest about non-exhaustiveness. No Phase A. No implementation. No runtime
proof. No message to Owner.*
