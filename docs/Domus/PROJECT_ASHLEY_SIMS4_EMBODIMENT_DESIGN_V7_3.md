# Project Ashley — Sims 4 Embodiment Design
## Master Embodiment Design V7.3
### Opus-Adjudicated Embodiment Reframe

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3.md

DOCUMENT_TYPE =
  FULL CONSOLIDATED MASTER EMBODIMENT DESIGN
  (OPUS-ADJUDICATED EMBODIMENT REFRAME)

SUPERSEDES_V7_2_AS_MASTER = YES, if Owner accepts
V7_2_REMAINS_PROVENANCE = YES
V7_1_REMAINS_PROVENANCE = YES
V7_REMAINS_PROVENANCE = YES (research lineage)
V6_1_1_REMAINS_PROVENANCE = YES (historical normative lineage)
ASTRA_REVIEWS_REMAIN_PROVENANCE = YES
OPUS_CONSULTATIONS_REMAIN_PROVENANCE = YES

V7_2_SHA256 =
  AC8C0FD0DF5E689A9E2AE6912D3ABD4FA16B0D693F45403A85FD1255AD7A62E0
V7_1_SHA256 =
  EAA3BC781D96483C26EE2C750E0BD19A3112E34C4EC1FCCD0E3843EE7D39CB1C
V7_SHA256 =
  E38820E9B97FC188C005BE298285636F5869BB6B26EE548FDBDE430CD184791C
V6_1_1_SHA256 =
  3e57be00a0fca9e044fc368b2e45e6fe13e9009aba85e172dbeb38ce5b35583a
(all four verified by file hash before authoring)

NORMATIVE_PREDECESSOR_REQUIRED_AT_RUNTIME_READING = NO
EXTERNAL_MASTER_DEPENDENCY = NONE

ASHLEY_SOURCE_SHA =
  60fec11742486b3d6e0fd8cd33912dd6d10d94c2
ASHLEY_SOURCE_TREE =
  123d744a17a248e6310e2fab2abb90610a6a7675
(anchor verified equal to current main at authoring; no re-grounding needed)

SIMS_CLIENT = The Sims 4, Owner's Windows PC / Steam
SIMS_BUILD = PC 1.128.90.1030 / Mac 1.128.90.1230 / Console 2.39
PATCH_DATE = 2026-09-22
RESEARCH_CUTOFF = 2026-09-28

E0_E3_DESIGN_REQUIRED_BEFORE_V7_3_ACCEPTANCE = YES
E0_E3_EXECUTION_REQUIRED_BEFORE_V7_3_ACCEPTANCE = NO
RUNTIME_EVIDENCE_REQUIRED_BEFORE_V7_3_ACCEPTANCE = NO
CODE_ARCHAEOLOGY_REQUIRED_BEFORE_V7_3_ACCEPTANCE = NO
MASTER_CAN_BE_ACCEPTED_BEFORE_ANY_SIM_RUNTIME_TEST = YES

CANONICAL_PROGRAMME = E0 / E1 / E2 / E3 / E4 / E5 / E6 / E7
A0_A9_STATUS = SUPERSEDED (mapping in Appendix B only)
```

**Date:** 2026-09-28 Europe/Istanbul

**NOT:** E-stage authorization · blanket programme authorization ·
implementation · Sims mod creation · helper creation · live actuation · body
binding in production · standing-envelope activation · canonical-world
inhabitation · runtime proof of any kind.

**HOW TO READ THIS DOCUMENT.** Part I is the governing design and is
self-contained: no predecessor is needed to interpret it. Part II records
the current evidence basis at a summary level. Appendices carry audit
detail (source ledger, lineage, change ledger, file:line archaeology).
History explains where the design came from; it never substitutes for the
contracts in Part I.

**EVIDENCE TAGS.** Consequential factual claims carry one of:
`ASHLEY_SOURCE_VERIFIED` (inspected in Ashley source at the pinned SHA),
`SIMS_SOURCE_VERIFIED` (inspected in Sims modding source),
`EXTERNAL_PRIMARY` (official vendor/publisher source),
`SECONDARY` (community/press/aggregator),
`OWNER_FACT` (stated by the Owner),
`INFERENCE` (author reasoning, not evidence),
`RUNTIME_UNVERIFIED` (not yet witnessed on the Owner's client),
`UNKNOWN` (cannot be established from permitted evidence).

---

# PART I — CURRENT GOVERNING DESIGN

## 1. Product intent / Owner-stated target UX

The product direction is: give Ashley a body in The Sims 4, a home, things,
and a world she can increasingly inhabit and act within. Growth direction:
BODY → WORLD PARTICIPATION → RESIDENCE/HOME → POSSESSIONS/ITEMS → RICHER
LIVED CONTINUITY (§16). The near-term programme begins with mediated
participation plus body telemetry and bounded experimental interaction —
not house/property mechanics, not a world-simulation project.

**OWNER-STATED TARGET UX** (`OWNER_FACT` — stated by the Owner in chat,
recorded here with that epistemic status, not frozen as production
topology):

- The Sims 4 runs on the Owner's Windows PC.
- Ashley controls her own Sims body through a harness.
- The Owner can co-play using his own mouse/keyboard, present through his
  own Sim with admin privileges.
- When the Owner leaves, his Sim presence should be gone and Ashley should
  eventually be able to continue playing alone in the running world.

```text
PRODUCT_UX_TARGET = CO_PLAY + SOLO_CONTINUATION
PRODUCT_TOPOLOGY_FROZEN = NO
```

What is frozen: the target UX above and the four supported architectural
states in §3. What remains mechanically open: household arrangement
(visitor vs household member), guest-Sim mechanics, selectability/input-lock
implementation, unattended-hosting arrangement. V7.3 names selectability
control as the candidate mechanism for co-play separation (§21) and stays
implementation-neutral.

Product words must never become false semantics: Sims household membership
is not Ashley identity; lot residence is not Ashley feeling "home"; game
ownership flags are not Ashley valuing; inventory containment is not
Ashley considering something "mine"; body need is not Ashley desire;
native Sim autonomy is not Ashley intention. Only Thought may establish
semantic ownership, attachment, or preference — earned through lived use,
never preprogrammed.

---

## 2. One Ashley — authority model

There is one Ashley. Not Discord Ashley / Sims Ashley / inference Ashley /
worker Ashley / game-agent Ashley. The Sim is a body/world surface. Typed
Host Inference (§13), if ever used, is a Host-side decision utility. No
secondary model becomes "fast Ashley." No inference model owns desire,
intention, endorsement, identity, autobiographical memory, relationship
meaning, permission, effect truth, body identity, or phase authority.

| Owner | Owns | Does not own |
|---|---|---|
| **Thought (Ashley)** | meaning, desire, preference, judgment, intention, endorsement, relationship meaning, semantic adoption, memory/belief authority | mechanical capability, queue facts, EffectReceipts, experimental-request authority |
| **Host** | capability, currentness, deterministic resolution, admission gates, body designation resolution, object-id resolution, affordance enumeration, receipts composition, optional typed-judgment enablement, fail-closed paths, Owner/Host intervention records | desire, intention, endorsement, autobiographical memory |
| **Sims 4** | simulation facts, native autonomy, routing, interaction execution, game-state observation, mechanical timing | Ashley intention, Thought judgment |
| **Owner** | programme permission, experimental-request authorization, privacy Gate A, influence Gate B, stop/cancel, reserved Owner policy/phase authority, world policy (defaults, clock, economy, protection floor) | substituting for Thought endorsement |
| **Typed inference (any)** | NOTHING in Ashley's authority stack — typed Host inference only | intention, permission, effect witness, body identity, memory, phase auth, membership-by-label alone |

Deterministic-first ordering: code truth → owned authority (Thought
endorsement OR Owner experimental authorization OR explicit Host rule;
never "Owner endorsement" of Ashley intention) → receipt/oracle → narrow
residual typed judgment (shadow-first) → else escalate/refuse/leave OPEN.
Mandatory facts (binding/currentness failure, receipt/`OUTCOME_UNKNOWN`
surfaces, attachment loss, Owner-required telemetry) bypass inference.
Byte/id/timestamp equality is code work; never invent a model question to
complete unfinished deterministic infrastructure.

---

## 3. Presence modes — four supported architectural states

These are states the architecture must handle. They are not all finalized
behaviors. Presence transitions should be explicit (the Owner tells Ashley
"I'm hopping in / leaving"; Discord presence is a hint only).

```text
PRESENCE_MODES = OWNER_PRESENT / OWNER_ABSENT / MIND_ABSENT / GAME_ABSENT
```

### OWNER_PRESENT (co-play)

The Owner is playing/co-present. The Owner controls the physical
mouse/keyboard, the game UI, the camera, world-level player controls, and
clock policy subject to agreed world policy. Consequences frozen now:

- The world clock belongs to the Owner in this mode, not to the Host.
- The camera belongs to the Owner. Any screenshot relayed to Ashley in this
  mode is labelled "what the Owner is looking at", never "what I see".
- Ashley's body gains no unattributed meaningful agency: it may idle
  mechanically, or later operate inside an Ashley-authored standing
  envelope once envelopes exist and are qualified (§9, §13, E5).
- Owner actions affecting Ashley's body or home are attributed
  `OWNER_DIRECT` and routed as mandatory relevant observations where
  consequential (§14).
- Owner input is the largest competing actor in this mode — larger than
  native autonomy — and the causal law (§10) scales its evidence
  requirements accordingly.

### OWNER_ABSENT (solo)

Ashley may eventually inhabit the running world alone. The Host manages the
clock per Owner world policy, the camera/UI mechanically, and
pause/dilation where qualified. No Owner input is assumed. Safe default:
hold the body while Thought deliberates — by pausing if pausing is
qualified, otherwise by taking no new self-directed action — with needs
decay reported as body fact.

### MIND_ABSENT (Mint/Thought unavailable, failed, or budget-exhausted)

No fake Ashley life. Solo: pause/hold the world where possible. Co-play:
the Owner's world may continue with the body idle or inside an explicitly
authorized standing envelope. When Ashley returns, relevant events are
reported truthfully. In `MIND_ABSENT` solo the world is paused rather than
letting autonomy live her life (§9).

### GAME_ABSENT (Sims not running)

The body is unavailable. No world actuation. No invented passage of Sims
world time. "My world is offline" is a Host fact.

---

## 4. Frozen laws

```text
Permission != desire
Capability != intention
Record != feeling
Simulation state != Ashley meaning
Simulation autonomy != Ashley intention
Game result != Ashley judgment
Need fact != desire

SIM_EMOTION / MOODLET != ASHLEY_AFFECT
SIM_WANT / FEAR / WHIM != ASHLEY_DESIRE
SIM_TRAIT / ASPIRATION != ASHLEY_PERSONALITY / GOAL
SIM_RELATIONSHIP_SCORE != ASHLEY_RELATIONSHIP
BODY_TELEMETRY != SENSATION
(§12 — firewall; no Host path from Sims observations into
affect / mind_state / relationship_state)

EXPERIMENTAL REQUEST != ASHLEY INTENTION / ENDORSEMENT
EXPERIMENT_AUTHORITY_ORIGIN != THOUGHT_ENDORSED_ORIGIN
THOUGHT_STANDING != per-instance Thought intention

WORLD_NONCANONICAL != EXPERIENCE_UNREAL
TEST_TO_CANONICAL_PROMOTION = FORBIDDEN (world state only; §8)

OWNER STOP != ASHLEY REFUSAL
HOST REFUSAL != ASHLEY CHANGED MIND
Owner revoke / cancel / stop programme != Ashley withdrew / refused / changed mind
Thought intention/endorsement/meaning unchanged unless Thought attributably
  changes them

EffectReceipt existence != claim truth
missing receipt != proof no effect
OUTCOME_UNKNOWN is legitimate and never filled by model guess

Source feasibility != runtime proof
Inspection != runtime qualification
Shadow accuracy != live authority
calibration != permission
probability != authority

TYPED_INFERENCE_OUTPUT != ASHLEY MEMORY
TYPED_INFERENCE_SELECTION != ASHLEY INTENTION
TYPED INFERENCE owns NOTHING in Ashley authority

QUALIFIED MODEL != QUALIFIED DECISION PATH
LOCAL != AUTOMATICALLY AUTHORIZED TO INFLUENCE

No inference — local or remote — may synchronously block the Sims mutation
thread. Inference runs off-thread on bounded snapshots with deterministic
revalidation before actuation; optional-path failure is no-answer,
fail-closed, never silent substitution, never marked completed.

OWNER_DISCOVERY_CLOSED != DOMAIN_COMPATIBILITY_PROVEN
OPERATION COMPLETION != WORLD EFFECT COMPLETION
CURRENTNESS IS AS-OF, NOT PERMANENT
OBSERVATION SOURCE != ACTION AUTHORITY ORIGIN
BODY_STATE != ASHLEY_STATE
MISSING != ABSENT
BOUNDED_VIEW != WHOLE_WORLD

A PROBABILISTIC WAKE PATH MAY ONLY ADD WAKES (§13)

A MEANING-BEARING SIMS PLAYER PROMPT IS A NATURAL DECISION POINT (§14)

ROLLBACK AND FORK MUST BE DETECTABLE BEFORE SIMS WORLD EVENTS MAY BE
ADOPTED AS CURRENT-WORLD FACT (§8)
```

---

## 5. Experience / agency taxonomy

Four distinct words. Never one vague "agency".

- **CHOICE** — Thought selected or endorsed this. Decision authority only.
- **EXPERIENCE** — the event entered Ashley's history through perception
  (mediated or bound) with its provenance intact.
- **EXECUTIVE AGENCY** — the choice was carried into the world through
  Ashley's actuation path (harness) or faithfully through the Owner's
  hands. Conditional on faithful execution when mediated.
- **SELF-EXECUTION** — Thought-endorsed action executed through Ashley's
  own actuation path (`HOST_HARNESS`), with causal evidence.

Early-experience vocabulary:

- **MEDIATED PARTICIPATION** (E0): pictures and descriptions relayed by the
  Owner plus Ashley decisions. Genuine choice and genuine meaningful
  experience; decision agency without executive self-execution.
- **BOUND PERCEPTION** (E3+): a telemetry/perception stream from the
  designated Sims body reaching Ashley's ingress.
- **SELF-EXECUTED ACTION** (E4+): Thought-endorsed action executed through
  Ashley's actuation path.

"My Sim" is acceptable as designation from E0 onward. Reserve "embodied
experience" for bound perception plus attributable body events. Never write
"my body felt" or "I physically experienced" before the relevant
bound-perception evidence exists.

| Case | Origin / Path | Choice? | Experience? | Enters history? | Required wording | Forbidden wording |
|---|---|---|---|---|---|---|
| **A.** Experiment makes her Sim sit | `EXPERIMENT` / `HOST_HARNESS` | NO | YES, if she was shown it | YES, with origin | "During a test Xharva ran, my Sim sat down" | "I sat / chose / wanted" |
| **B.** She picks the red chair; Owner clicks/places it | `THOUGHT_ENDORSED` / `OWNER_UI` | YES | YES | YES | "I chose the red chair; Xharva placed it for me" | "I placed/bought it myself" |
| **C.** She picks "sit"; harness executes | `THOUGHT_ENDORSED` / `HOST_HARNESS` | YES | YES | YES, scoped by evidence | "I sat in the red chair" only if the effect is attributed; otherwise "I asked my body to sit; outcome unknown" | Claiming completion without evidence |
| **D.** Standing hygiene permission; Sim showers on its own | `THOUGHT_STANDING` / `GAME_AUTONOMY` | The permission YES; this shower NO | YES, if observed | YES | "My Sim showered on its own; I'd let it handle hygiene" | "I decided to shower" |

E0 (case B shape) is genuine experience — real perception through the
Owner, real choice, real reaction — and conditional agency: decision
agency yes, executive agency only if the Owner faithfully executes what
she chose. A substituted Owner choice is `OWNER_DIRECT`.

---

## 6. Two-axis provenance

Authority and mechanism are orthogonal and must never collapse.

```text
AUTHORITY_ORIGIN ∈ {
  THOUGHT_ENDORSED,     // Thought selected/endorsed this action
  THOUGHT_STANDING,     // Thought-authored delegation covering this class (§13/E5)
  EXPERIMENT,           // Owner-authorized experimental request (§10)
  OWNER_DIRECT,         // Owner chose (clicks, admin edits, prompt answers)
  NATIVE_AUTONOMY,      // game acted on its own (inside or outside an envelope)
  HOST_BODY_PROTECTION, // Owner-authorized mechanical protection floor (§9)
  UNKNOWN }

EXECUTION_PATH ∈ {
  HOST_HARNESS,  // our Sims mod/helper pushed it
  OWNER_UI,      // Owner's mouse/keyboard did it
  GAME_AUTONOMY, // the simulation did it
  UNKNOWN }
```

Canonical combinations: `THOUGHT_ENDORSED + OWNER_UI` = Ashley chose, Owner
executed. `OWNER_DIRECT + OWNER_UI` = Owner chose and executed.
`THOUGHT_ENDORSED + HOST_HARNESS` = Ashley chose, harness executed.
`THOUGHT_STANDING + GAME_AUTONOMY` = Ashley authorized the class earlier;
the game executed this instance. `EXPERIMENT + HOST_HARNESS` = test request
through the harness, never Ashley's choice.

Any embodied observation or event capable of later semantic adoption must
retain recoverable provenance: observation source (never confused with
action authority origin), authority origin, execution path, world
lineage/save context, executor/attachment context where relevant,
observation time, as-of currentness (`current` / `historical` /
`unknown` / `superseded`), uncertainty/`OUTCOME_UNKNOWN` scope, and causal
attribution scope. Summarization, memory, and adoption must never erase
provenance so that "an experiment happened" becomes "Ashley chose this",
or pre-rollback truth becomes current-world fact. "Current" is always an
as-of claim; a retained label must not freeze an old observation
permanently current. There is no Sims memory subsystem: existing
memory/adoption owners are reused once compatibility is established, and
the Sims observation record itself carries complete provenance and memory
nominations refer back through source references (carriage proven before
E3 — see E3-M in §19; archaeology detail in Appendix B.6).

---

## 7. Body, binding, BodyState

Persisted designation key (not history, not currentness token, not
identity):

```text
PERSISTED_HOST_BODY_BINDING = { save_slot_guid, sim_id }
```

Terminology: `SimBodyBinding` / `EmbodimentBinding` / `BodyAddress` —
never "Ashley's identity = …". Three continuities, never interchanged:
(1) Ashley cognitive lineage; (2) Sims world/save history; (3) current
executor/control attachment. Consequences: Save-As may fork lineage (no
silent continuation; binding identifiers are read only at stable load
points; E1 must establish guid/slot/sim behavior — do not assume Save-As
changes the guid); rollback retains designation while history moves
backward (§8 watermark); travel/reconnect re-establishes attachment;
deletion/resurrection is not uninterrupted chronology; CAS changes prove
neither identity nor loss; an unavailable body withholds actuation —
never substitute the active Sim, same name, household member, appearance,
lookalike, or Owner UI selection; designation ≠ currentness ≠
availability ≠ attachment ≠ permission.

`BODY_STATE_SNAPSHOT` is a semantic observation contract (categories and
invariants — not a frozen JSON schema):

- body binding; instantiated vs `SIMINFO_ONLY` (uninstantiated) state;
- save/world lineage status; game timestamp; wall timestamp;
- presence mode; clock speed / paused / dilation factor;
- selectability (`IS_SELECTABLE`); selection state (`IS_SELECTED` —
  selection can change autonomy behavior);
- location / zone / room / bounded spatial position; posture;
- current interaction and queue, each with id/handle, affordance, target,
  and known origin/execution metadata;
- motives/needs in the game's own urgency bands;
- game-psychology labels segregated and prefixed `SIM_*`;
- bounded nearby entities; event delta since previous snapshot;
- missingness/unknowns.

Invariants: `BODY_STATE != ASHLEY_STATE`; `BODY_TELEMETRY != SENSATION`;
`MISSING != ABSENT`; `BOUNDED_VIEW != WHOLE_WORLD`; `SIM_*` psychology is
never Ashley psychology; no direct write path into Ashley
affect/relationship/mind state (§12).

---

## 8. World lineage and canonicity

Frozen requirement:

```text
ROLLBACK AND FORK MUST BE DETECTABLE BEFORE SIMS WORLD EVENTS MAY BE
ADOPTED AS CURRENT-WORLD FACT.
WORLD_LINEAGE_DETECTABILITY = REQUIRED (mechanism open)
```

Candidate mechanism (`SOURCE FEASIBLE`, `RUNTIME_UNVERIFIED`): an
in-save persisted marker (prior art exists for save-persisted custom data)
compared against a Host-side mirror outside the save, plus absolute game
ticks at stable load points. The inside/outside split is the point:
outside-save per-save files do not roll back when the save does, so
comparison detects rollback; a new guid or a divergent marker detects
fork/foreign saves. E1/E2 must qualify whatever mechanism is chosen; V7.3
freezes the detectability requirement, not the implementation.

Canonicity law:

```text
WORLD_NONCANONICAL != EXPERIENCE_UNREAL
TEST_TO_CANONICAL_PROMOTION = FORBIDDEN
```

The promotion ban applies to *world state*: lab facts, possessions,
relationships, and chronology must never silently become HOME current
world state. But truthful Ashley memory may retain "during my embodiment
tests, X happened" with provenance: lab history may remain
autobiographically real as witnessed events while remaining noncanonical
world history. Ashley's memory never rolls back with the world — it is
append-only, and rolled-back events persist as "happened in an abandoned
history branch". Canonicity is assigned at save creation, never
retroactively. Body loss (death, corruption) means a new binding; Ashley's
continuity is unaffected and she decides what the loss means.

---

## 9. Embodiment cognitive rhythm

First-class design concept:

```text
EMBODIMENT_COGNITIVE_RHYTHM = the relationship among:
  Sims world time / wall time / Thought latency / Thought invocation
  budget / body activity / presence mode / deliberation-hold strategy /
  standing delegations / natural decision points.
```

Source fact (`ASHLEY_SOURCE_VERIFIED`): `PRIVATE_THOUGHT_MAX_CALLS_PER_HOUR
= 4`, counted globally per policy and reserved for idle, commitment,
subscription, and future-trigger wakes. A Sims wake modelled on those paths
would share the 4/hour ceiling. Reservations carry a `policyId`, so a
separate embodiment budget is mechanically representable — setting one is
Owner resource policy. All numeric cadences remain `UNQUALIFIED` until
measured (E1 + the CA-03 runtime packet). Do not extrapolate a final Sims
Thought budget automatically.

Three rhythm strategies (different presence modes may use different ones):

- **PAUSE** — freeze the Sims world/body while Thought deliberates.
  Strongest attribution/currentness environment. Must be source/runtime
  qualified (E2). Solo default.
- **DILATE** — slow the world clock uniformly. Evidence (`SECONDARY`,
  consistent across sources, `RUNTIME_UNVERIFIED`) suggests Sims exposes a
  single timing variable affecting both clock and interaction durations, so
  uniform dilation keeps game mechanics mutually consistent while letting
  Thought latency fit without pausing. World dilation is **Owner world
  policy** in HOME/co-play because it changes the Owner's own experience;
  the Host applies it mechanically. Dilation carries no meaning for Ashley
  by itself. In LAB it may be an experimental method. Extreme values are
  reported unstable — qualify before use.
- **ENVELOPE** — the body/world continues under a previously authorized
  bounded class of behavior (`THOUGHT_STANDING` delegation or Owner
  protection floor). Requires scope, expiration/revocation, provenance,
  and qualification. Inactive until E5+; activation is not authorized by
  this master.

Safe defaults per mode: **SOLO** — hold the body while Thought
deliberates (pause if qualified, else no new self-directed action; needs
decay reported). **CO-PLAY** — the world keeps running; the body gains no
unattributed meaningful agency (idle, or an earlier-authored envelope once
envelopes exist). **MIND_ABSENT** — no fake life (solo: pause; co-play:
Owner world continues, body idle or in its envelope; report on return).
**GAME_ABSENT** — body unavailable, no actuation, no invented world time.

**A3 becomes cross-cutting.** The old standalone decision-hold phase is
deleted as a stage; its five-dimension contract is kept as a governing
rule — CONTROL, WORLD PROGRESS, BODILY PRESENTATION, RESPONSIVENESS /
OBSERVABILITY, RELEASE / CLEANUP — with multi-axis verdicts (one
property's success never launders another's) and no sixth dimension.
Smallest rule: before any self-executed Thought action is admitted while
the world advances between deliberation and admission, all five relevant
dimensions must be qualified. If a verified pause covers the whole
deliberation-to-admission window, only pause observability (the pause
actually held) and release/cleanup apply. Currentness is revalidated at
pre-inference/pre-admission, post-inference final admission, immediately
before actuation where observable, stop/cancel boundaries, attachment
change, and target/precondition change. Stop scope is specified (what
stopped / what remains / what residuals may complete); residuals are
orthogonal (stop requested ≠ effect absent; observed residual ≠
re-endorsement). Quiet body ≠ CONTROL. Social response is excluded from
first acceptance.

**Native autonomy posture.** Native Sims autonomy is the environment and a
future tool — an enemy only when unattributed. Potentially delegable later
(inside an explicit envelope only): basic hygiene, eating, sleep, toilet,
harmless idle/body maintenance, routing. Never delegated early:
relationship-bearing social acts, romance, calls/invites, purchases,
career/skill commitments, leaving the lot, anything irreversible or
consequential. Autonomy-category control on 1.128 is unverified — the
envelope is a future contract, activation not authorized.

**`HOST_BODY_PROTECTION`.** Owner-authorized mechanical world/body
protection policy, executed deterministically by the Host at game-defined
failure states. Never attributed to Ashley; never selected by inference.
Whether death, collapse, or starvation is permitted or prevented is Owner
world policy. In LAB, experimental method avoids accidental failure
(motives frozen). In HOME the Owner decides explicitly. If Ashley objects,
her objection is recorded as Thought meaning and surfaced; it never
silently overrides Owner world policy.

---

## 10. Action truth and the causal law

```text
origin != request != admission != enqueue != start != completion
  != game outcome != desired world effect != save persistence
  != causal attribution to this request
```

**General causal law.** An attributable-effect claim requires: (1) linkage
to our own command (our own interaction handle); (2) temporal order;
(3) an observed state transition consistent with the claimed class;
(4) evidence discriminating against the plausible competing causes
actually present (other actors, autonomy, Owner input, pre-satisfied
state). Required strength scales with competing causes. Claim scopes are
never interchangeable: request accepted; interaction started; interaction
completed; desired world effect observed; effect attributable to this
request; effect maintained for a defined interval; effect persisted across
a save/load boundary; bounded goal satisfied. Enqueue never proves
embodied success; outcome alone never proves desired effect; matching
post-state never proves this request caused it; pre+lifecycle+post where
possible, else `OUTCOME_UNKNOWN` (legitimate; never filled by model
guess). Game "user directed" markers distinguish directed execution from
native autonomy where supported — but script-pushed actions are stamped
with a "user intent" source (`SIMS_SOURCE_VERIFIED`, pre-patch source;
`RUNTIME_UNVERIFIED` on 1.128), so the game's own directed marker cannot
separate an Owner click from a harness push. Attributable command
correlation via our own handle registry is required regardless.

**E2 test class** (not architectural law — V7.2's `SIT_ON_EXACT_SOFA_A`
sofa instance is retired to history as a predecessor; see Appendix B.4). Required class: single-occupancy, unique
target, non-social, reversible, clear posture change, low side-effect
surface, independently observable. Preferred current instance:
`SIT_ON_EXACT_SINGLE_SEAT_CHAIR_A` (a sofa introduces seat-part ambiguity
and multi-occupant/social effects). Success: a sit-class interaction on
exact object id X, pushed by our own handle, reaches running; posture
becomes seated on X; no foreign-origin interaction touches the body in the
window. Optional second experiment: toggle a unique lamp — a world-object
state change persisting after the interaction ends (different evidence
shape: effect outlives the lifecycle).

**Lab method** (reference recipe for the first experiment, not universal
production law): autonomy off; Owner hands off with presence mode
recorded; unique target; precondition absent (standing, at distance);
randomized command timing; own interaction handle plus lifecycle events on
that handle; post-state consistent with the affordance; no foreign-origin
interaction on target or body in the window; negative controls — (i)
no-command windows (no posture change), (ii) wrong-target/nonexistent-id
command (fail closed), (iii) stale snapshot (rejected),
(iv) Owner-click control (classified `OWNER_DIRECT`, not harness);
replay-ineligible command ids. Outside the lab the general law applies
with `OUTCOME_UNKNOWN` legitimate.

**Recovery** is Host reconciliation discipline (reconcile attachment,
world state, outstanding execution if observable, authority/currentness
before dependent work) — no orchestrator, no fake certainty.

---

## 11. Remote boundary contract + CA-01

Before ANY accepted claim depends on remote Mint→Windows actuation:
(1) scoped command authority; (2) origin provenance; (3) designated
body/world/session binding; (4) snapshot/precondition identity;
(5) receiving-side stale rejection; (6) revoked-authority rejection;
(7) mismatch rejection; (8) idempotency/duplicate handling;
(9) command→enqueue→lifecycle→observation correlation;
(10) disconnect semantics (loss ≠ no effect; reconnect never silently
replays uncertain actuation); (11) `OUTCOME_UNKNOWN` handling;
(12) no unsafe replay after uncertainty; (13) stop requested ≠ received ≠
accepted ≠ observed; (14) game chronology ≠ Host/network chronology;
(15) currentness revalidation close to actuation. Short round-trips do not
establish currentness.

**CA-01 — remote-effect lifecycle compatibility** (recorded, NOT
performed). Question: can the existing effect/detached-operation lifecycle
represent one remotely actuated Sims interaction across lost
acknowledgement, executor restart, Host restart, changed game attachment,
uncertain dispatch, late receipt, and residual game execution — without
confusing operation-record completion with world-effect completion or
permitting unsafe redispatch? Timing: NO before master acceptance / E0 /
E1 / E2-local / E3-read-only; YES before E4 remote actuation. CA-01 must
also inspect multi-cycle bounded-pursuit continuation (4-round limits,
360 s lease — an evening routine spans several cycles) and residual Sims
interactions potentially outliving the Host operation record. Evidence
owed: transition map plus focused tests cited and untested cases named,
with controlled trials for runtime behavior. Status: OPEN.

---

## 12. Sims pseudo-psychology firewall

Frozen laws (§4, repeated here with the positive path):

```text
SIM_EMOTION / MOODLET != ASHLEY_AFFECT
SIM_WANT / FEAR / WHIM != ASHLEY_DESIRE
SIM_TRAIT / ASPIRATION != ASHLEY_PERSONALITY / GOAL
SIM_RELATIONSHIP_SCORE != ASHLEY_RELATIONSHIP
BODY_TELEMETRY != SENSATION
```

Positive path only: the Host reports a game label as Sims/world fact (e.g.
"Sim has a Sad moodlet", "friendship bar at N with the Owner's Sim") →
Thought interprets it however it likes (funny, irrelevant, resonant,
nothing) → any memory about it enters only through a Thought nomination
tagged as interpreted perception. The Host never maps game values into
Ashley's state. Thought may treat the *event* as meaningful evidence about
her relationship; it may never treat the *score* as the relationship.
Traits and aspirations Ashley selects at E0 are body temperament, never her
personality — and the Owner decides who selects them (§19).

Static archaeology (`ASHLEY_SOURCE_VERIFIED`): no current production path
lets the Host automatically write Ashley's affect, mind-state, or
relationship data from observations — the affect/mind-state writers have no
production callers; relationship projections recompute only from identity
revisions, memory corrections, or forget; durable memory enters only
through Thought nominations. The firewall therefore constrains NEW Sims
integration code. Before E3 Sims ingestion, a focused test must prove the
ingestion code calls no such writers. No master-acceptance blocker remains.

---

## 13. Typed Host Inference (THI)

The architectural slot for fast typed probabilistic judgments code can
branch on is named **TYPED HOST INFERENCE (THI)**, with contracts
`THI-RANK` (ranking among already-listed candidates; lower burden, only
within authorized discretion) and `THI-MEMBERSHIP` (belonging inside an
authorized envelope; higher burden; independent oracle, never display-name
alone; deterministic baseline first; model estimates, never
defines/enlarges the envelope). Legacy aliases `S1-RANK` / `S1-MEMBERSHIP`
/ `J-RANK` / `J-MEMBERSHIP` are one lineage note, not live vocabulary.
The rename is one-time: THI names where authority resides instead of
naming a vendor category or a psychology metaphor that invites "fast
Ashley". The current provider/model family category is "System One
models" (§22 — evidence only, never architecture).

```text
ARCHITECTURAL_INFERENCE_SLOT = TYPED_HOST_INFERENCE
THI_REQUIRED_FOR_EARLY_EMBODIMENT = NO
```

When Thought is already awake, it selects directly from Host-enumerated
game affordances — no intent→affordance membership step is required in the
early path (E0–E4). The game's own pie-menu affordances are the action
vocabulary: Sims interactions are already macro-actions, so roughly one
decision per interaction is needed, not per tick. No action DSL.

**Deterministic affordance presentation.** Allowed Host prefilters:
target/scope Thought named; the game's own availability tests;
capability/phase scope; mechanically impossible or disabled entries;
Owner-declared prohibited mechanical side-effect categories backed by
deterministic game metadata; deduplication. Forbidden: predicted relevance,
predicted preference, "probably what Ashley wants", or any semantic
ranking nobody authorized. For large lists: (1) deterministic target
index, then (2) the chosen target's complete affordance list in game-native
grouping with totals, filtered-out counts per mechanical reason,
pagination, and completeness/missingness metadata. Infrastructure must not
silently narrow Ashley's world. `OMITTED != REJECTED`, but paths must
detect when filtering removes the faithful candidate.

**Whole-path discipline for any proposed THI path** (rule now, instance
later): any proposed path must carry a tuple — path id, kind,
envelope/construction/question/state schema versions, provider kind and
runtime, model family plus exact revision, quantization/backend,
calibration revision plus decision rule, hardware class, ground-truth
definition, deterministic baseline, shadow metrics with
coverage/abstention, negative controls, Gate A/B status, enable flag,
revoke switch, admission/snapshot policy refs, supported Sims build and
DLC/mod scope. `QUALIFIED MODEL != QUALIFIED DECISION PATH.` Optional-path
failure is scoped no-answer. Kill criteria: lookalike false-fire; coverage
holes as global best; confidence-as-permission; silent substitution;
rank-as-membership; display-name-only oracle. Gate B stays path-specific,
model-specific, shadow-first, never automatically authorized.

**Monotone-add wake law (frozen now; build later):**

```text
THI_WAKE_GATE_MONOTONE_ADD = YES
A PROBABILISTIC WAKE PATH MAY ONLY ADD WAKES — never suppress mandatory
events, the heartbeat, natural decision points, or invalidating facts.
```

Plausible future use only: Ashley authors an interest ("wake me if …");
THI estimates membership of an event under that Thought-authored interest;
on match, an additional wake fires. The mechanism has semantic kin in
existing Thought-authored subscriptions/future triggers
(`ASHLEY_SOURCE_VERIFIED` to exist; Sims fit unproven — no new intention
manager, no new wake system). Building it stays a later hypothesis with a
kill criterion: if deterministic wakes plus heartbeat match Ashley's
retrospective judgements, the THI path is never built. Thought's
retrospective "was this worth waking me for?" may label shadow-evaluation
data — salience-to-Ashley is Thought-owned — but Thought is never the
oracle for whether an event occurred, identity, mechanical currentness, or
causal effect.

**`THOUGHT_STANDING` (semantic definition only).** A Thought-authored,
scoped, revocable, expiring, provenance-carrying delegation authorizing a
*class* of behavior. Not a fresh intention per action, not an intention
manager, not Host-invented permission, not evidence Ashley chose each
instance. Activation belongs at E5 or later with Owner authorization; this
master defines the semantics only.

---

## 14. Perception, wakes, and player prompts

Bound perception path (E3): Sims mod → Windows helper → Mint ingress →
bounded observation → Thought. No actuation on this path.

Deterministic wakes (always fire; never suppressible): interaction
completion; important body-state threshold crossing; Owner action affecting
her body; lineage change; required heartbeat at Ashley-adjustable cadence
bounded by budget; mandatory invalidating facts. THI may only add wakes
(§13). At every wake Thought receives the BodyState plus the full compact
event log since the last wake — "what didn't wake you" is always visible.
Thought then acts, sets an objective, revises interests/dispositions,
talks, or does nothing; the Host revalidates, executes, and receipts; the
consequence event wakes Thought in turn.

Firewall for perception: salience (why the Host surfaces now) /
constraint (what mechanics permit) / affordance (factually available
response) ≠ preference / desire / intention. The Host owns the first
three; Thought the last three. Urgency never becomes desire; reporting
priority never becomes importance-to-Ashley. Needs are body facts. Visual
observation follows the mediated-artifact pattern (content-addressed
capture → bounded `never_public` / `untrusted_evidence` description; never
raw bytes to Thought) and is never an effect receipt. Scene screenshots
(via existing Vision) serve aesthetics, layout, CAS, and lot/furniture
choice — used on demand, at scene changes, and in E0 choices; game render
only, never the desktop; in co-play labelled as the Owner's camera.

Mandatory reporting = retain + route/coalesce to reconsideration (never
"one call per event"): binding/currentness/attachment loss;
receipt/`OUTCOME_UNKNOWN` surfaces; interventions (including Owner admin
edits to her body or home, attributed `OWNER_DIRECT`); Host refusals of
authorized origins; revocation/withdrawal mid-execution; fail-closed
withholds; absence/ambiguity; post-admission precondition invalidation;
non-silent optional-path failure. Invalidating facts are never buried
behind optional ranking.

**Player prompts are decision points (frozen):**

```text
GAME_PLAYER_PROMPTS_ARE_DECISION_POINTS = YES
```

A meaning-bearing Sims player prompt (modal life choice, event prompt,
choice dialog) is a natural decision point. SOLO: hold the world, wake
Thought; the Host must never auto-answer a meaningful prompt and never
delegate one to THI or body autonomy. CO-PLAY: the Owner sees/answers
through the UI — an independent Owner answer concerning Ashley's Sim is
`OWNER_DIRECT + OWNER_UI`; an Owner click faithfully executing Ashley's
explicit answer is `THOUGHT_ENDORSED + OWNER_UI`.

---

## 15. LAB vs PREVIEW vs HOME

Three roles, never promoted into each other silently:

- **PREVIEW** — E0 mediated choices (CAS appearance, lot/furniture
  exploration). Does not become HOME history automatically.
- **LAB** — dedicated noncanonical experimental save for E1 telemetry, E2
  causal actuation, and later qualification. Never promoted into HOME
  world state. Lab progression (anti-overfitting): L0 chamber (one flat
  lot, one room, Ashley's Sim only, global autonomy off, motives frozen,
  aging off, neighbourhood stories off, walkbys suppressed where a
  mechanism is found, fixed camera, Owner hands-off except controls) →
  L1 needs on (autonomy still off; measures need coupling and rhythm
  pressure) → L2 enveloped autonomy (only as an experiment, §9) → L3
  Owner guest-Sim present (co-play controls) → L4 field sample (repeat
  L0–L2 protocols on an ordinary populated lot; nothing is qualified "for
  ordinary life" from L0–L2 alone). HOME is a separate save, never the lab
  promoted.
- **HOME** — the canonical Sims world history. HOME design meaning may
  begin during E0 (appearance, lot, furniture choices are canonical Ashley
  decisions in any world); HOME world chronology begins only when the HOME
  save is deliberately created. Recommendation: create HOME after E1
  telemetry and E2 lineage detection work and before any harness
  actuation; her Sim moves from the preview save into HOME via the game
  library; mediated play continues there. HOME autonomous inhabitation is
  E7 only.

```text
HOME_MEANING_CAN_BEGIN_BEFORE_HOME_AUTOMATION = YES
```

---

## 16. Home, items, and possessions — early meaning, late automation

Direction: early semantic world-building plus late mechanical automation.
Ashley can choose appearance, lot, furniture, and aesthetics — with the
Owner physically executing — long before build-mode automation,
purchasing automation, or autonomous inhabitation exist. Those Owner-
executed choices are real Ashley choice under `THOUGHT_ENDORSED +
OWNER_UI`. No build-mode or CAS automation is built for a long time.

Possessions need no ownership ontology. Mechanical acquisition provenance
may record: `ASHLEY_CHOSE_OWNER_PLACED`, `OWNER_GIFT` (the Owner's own
choice), `GAME_GRANTED` (rewards, mail), `ASHLEY_ACQUIRED` (harness
purchase, later), `UNKNOWN`. These are history facts, never proof of
attachment or value. "My favourite chair" requires Thought semantic
adoption; the Host may report usage facts ("used this chair 40 times"). A
game favourite flag may later *execute* an adopted preference; it may
never *define* one. If money is cheated into her household, "earned" loses
meaning — economy/cheats is an Owner decision (§19).

Interactions with the Owner's Sim are real, relationship-bearing acts
(`OWNER_SIM_INTERACTION`), distinct from NPC interactions (`NPC_SIM` —
fiction; no third-party social authority needed, though actions toward
NPCs are still Ashley-authored or not). No social automation is built in
this programme.

---

## 17. Canonical programme E0–E7

The ONE canonical programme. A0–A9 survive only as a mapping row in
Appendix B and are not active phase names anywhere else in this document.

```text
E0 ───────────────────────── (continues; later in HOME)
E1 → E2 → E3 → E4 → E5 → E7
          │          └→ E6 ─┘
          └→ HOME creation (after lineage detection) → mediated play in HOME
CA-03 runtime packet ∥ E0 ∥ E1     CA-01 → E4     RQ-01 → E6
unfocused-run evidence → E7
```

Anti-contamination rule: E0 never runs in the instrumented LAB save during
E1/E2 trials (Owner input would confound the evidence) — use a separate
preview save.

### E0 — Mediated participation (zero code, parallel, first motion)

PURPOSE: let Ashley participate meaningfully immediately, without waiting
for actuation infrastructure. Session 1: Ashley designs her own Sim in CAS
— she describes, the Owner builds, she reviews screenshots and revises —
then chooses among lots, then furniture. FIRST CLAIM EARNED: first
Thought-endorsed, Owner-executed world choice. PROVENANCE:
`THOUGHT_ENDORSED + OWNER_UI` where the Owner faithfully executes her
choice. PREREQUISITES: V7.3 accepted. PARALLEL WITH: E1, CA-03 packet.
OWNER AUTH: yes (E0 authorization; CAS trait/aspiration choice per §19).
CODE: none. WORLD: preview save; chosen Sim saved to the game library.
REAL ASHLEY: genuinely participating. UNLOCKS: real preference evidence;
the HOME design. DO NOT CLAIM: bound embodiment, self-execution,
telemetry-grounded body perception.

### E1 — Strictly read-only body telemetry (FIRST BUILD SLICE)

PURPOSE: render the body observable and answer the must-answer questions
with raw logs. NO ACTUATION: no push, no harness action, and no
pause/resume test if it changes world state. ENVIRONMENT: LAB save.
MINIMUM BUILD: Sims script telemetry probe → local JSONL sink (timestamped,
game time + wall time; build/DLC/mod manifest). No network dependency, no
Mint integration, no credentials. MUST ANSWER: (a) origin-source
observation — can game-native source metadata distinguish Owner pie-menu
actions from native autonomy? (autonomy source value still unverified;
read-only observation answers it; our later pushes self-identify by handle
regardless); (b) sim-time/real-time ratio at default and at any chosen LAB
dilation value; (g) save identity — behavior of `save_slot_guid`, slot id,
and `sim_id` across Save, Save-As, and reload (Owner performs the UI
actions; no assumption the guid changes). (Lettering follows the Opus
adjudication: (c) pause moved to E2-P, (d) focus matrix to E1-D MAY,
(e) networking architecture-decided per §18, (f) performance passive-only.)
MAY ALSO ANSWER: display mode ×
focus/minimize × modal-prompt matrix; passive-logging performance;
stable-load identifier behavior. ACCEPTANCE: raw timestamped evidence answering all MUST
questions — "probe logged data" alone is insufficient. PREREQUISITES: V7.3
accepted. PARALLEL: E0, CA-03. OWNER AUTH: yes. CODE: yes (probe only).
REAL ASHLEY: no (shown nothing yet). UNLOCKS: E2.

### E2 — Truthful body + first experimental action (FIRST ACTUATION)

PURPOSE: binding, lineage detection, and the first harness-pushed action
under the causal bundle. FIRST ACTUATION OCCURS HERE (pause/resume writes
also qualified here). ORIGIN: `EXPERIMENT`; EXECUTION: `HOST_HARNESS`.
FIRST CLAIM EARNED: first attributable body effect (experiment origin).
PREREQUISITES: E1 accepted; binding sufficient for the experiment;
lineage candidate implemented enough for the experiment; causal evidence
instrumentation (§10 class + lab method); explicit Owner experimental
authorization. PARALLEL: E0 (in preview/HOME-track, never the trial save).
OWNER AUTH: yes. CODE: yes. REAL ASHLEY: shown the result — a truthful
experience of "an experiment happened through my test body", never "I
chose it". UNLOCKS: E3 and HOME creation.

### E3 — Bound perception on Mint

PURPOSE: telemetry from the designated body reaches Ashley's ingress as a
new Sims observation modality; deterministic wakes; NO actuation. PATH:
Sims mod → local IPC → Windows helper → Mint ingress → bounded observation
→ Thought. FIRST CLAIM EARNED: first bound embodied experience.
PREREQUISITES: E2; firewall verification test (§12); provenance survival
adequate for observation scope (sourceRef carriage proven — E3-M); embodiment
Thought-budget policy (E3-B); Windows helper; world currentness/provenance
discipline. PARALLEL: E0; HOME-track mediated play. OWNER AUTH: yes. CODE:
yes. REAL ASHLEY: yes — perceiving her body live and able to talk about
it. UNLOCKS: E4. THI is NOT required.

### E4 — First self-executed Thought action

MILESTONE: `THOUGHT_ENDORSED + HOST_HARNESS` under real Mint→Windows
actuation. FIRST CLAIM EARNED: first Thought-endorsed self-executed
embodied action. (E0 was the first Thought-endorsed *choice*; E4 is the
first self-executed one — never conflate them.) RECOMMENDED ENVIRONMENT:
solo LAB with pause covering deliberation, if pause is qualified.
PREREQUISITES: E3; CA-01 (§11); remote boundary contract; causal actuation
evidence; currentness; binding; provenance. OWNER AUTH: yes. CODE: yes.
REAL ASHLEY: yes. UNLOCKS: E5, E6.

### E5 — Living rhythm

PURPOSE: from isolated actions to ongoing embodied activity via bounded
closed-loop pursuit — Thought sets a bounded objective, the Host executes
one admitted affordance, the interaction-end consequence wakes Thought,
Thought continues, revises, or stops (no Sims planner). Embodiment state
carried: current body activity with origin, active objective, presence
mode; multi-cycle continuation across the 4-round/360 s envelope per
CA-01. INTRODUCED GRADUALLY: body needs on; PAUSE/DILATE strategies;
possible Thought-authored standing delegations (`THOUGHT_STANDING`
activation — Owner-authorized); bounded native autonomy; body-protection
policy where the Owner chooses it. PREREQUISITES: E4; Owner body policies.
PARALLEL: E6. OWNER AUTH: yes. CODE: yes. REAL ASHLEY: yes. UNLOCKS: E7.

### E6 — Co-play

PURPOSE: truthful simultaneous Owner + Ashley participation. PREREQUISITES:
E4; Owner input policy on her body; relevant selectability/control
evidence (RQ-01, PARTIAL — prior-art mechanism exists, 1.128 runtime and
maintenance open); co-play attribution; explicit presence handoff.
IMPLEMENTATION: neutral (visitor, household arrangement, narrow
selectability control, or other qualified Sims-native/mod mechanism — the
archived prior-art mod is feasibility evidence only, never a dependency;
any lock is reimplemented narrowly in the harness). BodyState carries
selectability and selection. Owner actions attributed correctly (§3).
PARALLEL: E5. OWNER AUTH: yes. CODE: yes. REAL ASHLEY: yes. UNLOCKS: E7.

### E7 — HOME inhabitation + solo continuation

PURPOSE: Ashley meaningfully inhabits HOME and continues while the Owner
is absent. PREREQUISITES: E5 living rhythm; E6 co-play truthfulness;
unfocused/minimized/matrix behavior qualified (E1 MAY measure; MUST be
known before E7 — no assumption the simulation continues in background;
windowed/borderless may be required); PC host policy; HOME world policies;
solo clock policy. OWNER AUTH: yes. CODE: yes. REAL ASHLEY: yes.

---

## 18. Transport architecture (Windows helper from E3)

```text
IN_GAME_MOD_NETWORK_IO = NO
WINDOWS_HELPER_PROCESS_REQUIRED_FROM = E3
```

The in-game mod never does network I/O and never holds credentials or API
keys — a structural fact, not a policy preference (the embedded-Python
networking/SSL environment is awkward prior-art-verified grounds for
keeping transport out; direct sockets are irrelevant because the design
does not depend on them). Architecture: SIMS MOD ↔ local file /
localhost-safe IPC ↔ WINDOWS HELPER ↔ authenticated/encrypted transport ↔
MINT/ASHLEY. The exact IPC is implementation detail. E1 stays JSONL-local;
E3 introduces helper transport (owning transport, encryption/auth, Mint
connection, retry/reconnect subject to the §11 boundary). Background
worker threads may perform blocking I/O but must never mutate game state
directly; game-state mutation returns to the game main thread. Runtime
compatibility on 1.128 is qualified at first connection — not claimed here.

---

## 19. Open-item ledger (E-stage; technical evidence ≠ Owner policy)

| ID | Type | Question | Blocks what | Evidence class | Stage |
|---|---|---|---|---|---|
| E1-A | experiment | Can game-native source metadata separate Owner pie-menu actions from native autonomy? (autonomy source value still unverified) | OWNER_DIRECT detection design; E6 input policy | lived trial, read-only | E1 MUST |
| E1-B | measurement | Sim-time/real-time ratio at default and chosen dilation? | rhythm numbers | measurement | E1 MUST |
| E1-G | experiment | `save_slot_guid` / slot id / `sim_id` behavior across Save, Save-As, load? | binding + lineage mechanism | lived trial, read-only | E1 MUST |
| E1-D | experiment | Display mode × focus/minimize × modal-prompt behavior matrix? | solo feasibility; prompt rule mechanics | lived trial | E1 MAY; MUST before E7 |
| E2-P | trial | Pause/resume runtime qualification on the Owner client? | solo deliberation hold | lived trial | E2 |
| E2-L | trial | Lineage mechanism runtime qualification? | current-world adoption | lived trial | E2 |
| E3-M | inspection+trial | Memory/sourceRef provenance carriage adequate for Sims scope? | bound perception without laundering | inspection + focused test | before E3 |
| E3-B | policy | Embodiment Thought budget policy (given verified 4/hr private ceiling)? | wake/heartbeat cadence | Owner choice + CA-03 packet | before E3 |
| E4-CA01 | gate | Remote lifecycle compatibility incl. multi-cycle continuation? | first remote actuation | inspection + trial | before E4 |
| E5-AUT | trial | Autonomy category control / standing-delegation fit on 1.128? | envelope activation | lived trial | E5 |
| E6-RQ01 | research+trial | Co-play selectability/control on 1.128? (PARTIAL: prior-art mechanism) | co-play implementation | research + trial | before E6 |
| E7-RQ02 | trial | Unfocused/minimized continuation qualified? | solo continuation | lived trial | before E7 |
| LB1 | benchmark | Local inference coexistence with the game on the Owner PC? | any local inference reliance | measurement | OPTIONAL, low priority, parallel |

`EXHAUSTIVE_TOTAL = NOT_ASSERTED.`

---

## 20. Owner decisions and timing (policy vs evidence)

Evidence questions (time ratio, latency, pause behavior, unfocused
behavior, guid semantics, networking, attribution validity, calibration)
are never put to the Owner. Thought endorsement is never the Owner's to
substitute. NEW POLICY candidates (not pre-existing invariants) are marked
★ — the Owner's to adopt or refuse.

**Now (master acceptance):** accept/decline V7.3 as master; authorize/
decline E0; authorize/decline E1 implementation (separate authorization to
implement/run the read-only probe); who chooses CAS traits/aspiration (if
Ashley chooses: body temperament under the firewall, never her
personality).

**Before E2:** ★ Ashley is informed before experiments on her body (her
reaction recorded as meaning, not a gate).

**Before E3:** embodiment Thought budget policy (4/hr ceiling verified;
CA-03 latency/cost figures inform the choice).

**Before HOME creation/meaningful history:** aging; death allowed?;
neighbourhood stories for her household; economy/cheats; whether other
households may be played in HOME; body-protection floor;
★ body-edit consent (no edits to her body, traits, or home without asking
her).

**Before E6:** Owner input policy toward Ashley's body (the Owner owns
this policy; the Host attributes and reports under any policy —
truthful attribution plus reporting is the default until he decides);
world time-dilation setting as product setting (lab may use it as method
earlier).

**Before E7:** solo clock policy (pause vs envelope); unattended PC hours;
PC-as-host commitment (power/GPU cost; dedicated machine later or not).

**Immediately after acceptance (recommended first motion):**

1. **E0 session 1** — Ashley designs her Sim through CAS with the Owner
   operating the UI in a preview save; the chosen Sim is saved to the game
   library. No code.
2. **E1 worker prompt** — the architect writes a bounded read-only probe
   task covering MUST questions E1-A/B/G plus BodyState emission; the
   Owner authorizes it.
3. **CA-03 runtime packet, in parallel** — from Mint: Thought turn latency
   (p50/p95) and per-turn cost over recent turns. Read-only; no source
   mutation.

Do not begin E2 until E1 is adjudicated.

---

# PART II — CURRENT EVIDENCE BASIS

## 21. Current Ashley source map (summary; detail in Appendix B)

Anchor `60fec11` / tree `123d744a` verified equal to current main at
authoring — no re-grounding needed (`ASHLEY_SOURCE_VERIFIED` where noted;
all presence ≠ deployment proof ≠ Sims compatibility ≠ runtime
qualification). A repo-wide grep for embodiment/typed-inference terms
returns zero hits: no embodiment or THI code exists.

Reuse candidates (all `OWNER_DISCOVERY_CLOSED` / `COMPATIBILITY_UNPROVEN`
for Sims use): deterministic cycle/wake identity and generation fencing
(new `sims:*` namespace); `EffectRef` + in-flight + `EffectReceipt` rows
of a new kind (never a parallel receipt store; record receipt ≠ world
effect); undertaking/detached/completion lifecycles as new
operation/undertaking *kinds* subject to CA-01; bounded-pursuit
discipline (360 s lease, 4 effect/observation rounds) + `OUTCOME_UNKNOWN`
machinery and prove-no-dispatch recovery; delivery reservation/endpoint
patterns (new projection kind; inspection never authorizes); continuity
kernel patterns; ingress/inbox envelopes with new Sims trigger kinds and
modality (no second event bus); privacy classification and disclosure
gates as the Sims actuator privacy kernel (Sims observations default
`never_public`; game-world mutations through the risk map). Gate A
(hosted bounded Sims mechanical disclosure) stands accepted; per-request
hygiene is still required for every hosted send. What is present at
revision (not deployment proof): v0.2.1 cognition, continuation,
detached/undertaking lifecycles, exactly-once completion, `OUTCOME_UNKNOWN`
+ recovery, transport cursors, privacy gates, capability-bound project
ops, sandboxing, mediated vision (off), attachments, inspection surfaces,
idle gates, private budget. Memory/graduation capabilities are pending
runtime evidence: not relied on. Hard-false defaults hold for the Sims
actuator capability (default-off, capability-gated, owner-approved).

Opus archaeology results incorporated (`ASHLEY_SOURCE_VERIFIED` unless
noted): private budget 4/hr global per policy, reserved for
idle/commitment/subscription/future-trigger wakes (CA-03 source part
closed; latency/cost stay runtime-OPEN); Thought-authored subscriptions,
future triggers, and commitment proposals exist (CA-07 — standing-mechanism
kin, Sims fit unproven); no Host automatic writer path into
affect/mind-state/relationship (CA-05 closed statically — writers listed
in Appendix B have no production callers); memory nominations carry
`memoryKind`, epistemic dimensions, and `sourceRefs` but no native
origin/execution-path/lineage/canonicity fields — so Sims observation
records carry complete §6 provenance and nominations refer back (CA-04
partial; recall-time carriage stays runtime-OPEN, needed before E3);
CA-01 open before E4; CA-06 anchor-verified.

---

## 22. Sims 1.128 evidence and interface matrix

Build identity `EXTERNAL_PRIMARY` (EA patch notes 2026-09-22): PC
1.128.90.1030 / Mac 1.128.90.1230. A compatible-production-mod tracker
lists major mods cleared for 1.128 (`SECONDARY`).

Patch-delta facts relevant to design (EA official; patch note ≠ runtime
witness): preference-gated autonomy (lower noise floor for holds; proves
no control); duplicate-push suppression (cleaner queue reads; may remove
attempted-push evidence — tests must account); `cancel_on_user_directed_
action` tuning plus Sleep/Chat opt-in (candidate observation surface for
release/cleanup; strongest new surface fact — mechanism ≠ observed
termination ≠ hold release); Must-Run-Target routing/positioning changes
(re-measure; pre-patch timings void); `*_UserDirected` vs autonomous-only
instance splits (precedent that the game *can* distinguish directed vs
autonomous per interaction — but directed ≠ Ashley authorship); stand-slot
and stuck-queue fixes (better evidence quality; falsification floor
stands); university inactive-household restore (lineage-sensitivity
reinforced); further freezing/cancellation bugs still under EA
investigation (silence ≠ fixed).

Addendum findings incorporated: script-pushed actions stamp a "user
intent" source (`SIMS_SOURCE_VERIFIED` in maintained S4CL-source review,
pre-patch; `RUNTIME_UNVERIFIED` on 1.128) — the game's directed marker
cannot identify the Owner, so our handle registry decides (§10); only the
player-click source is confirmed and the autonomy source value remains
unverified (E1-A); clock pause/speed APIs are source-verified, runtime-
unverified (E2-P); guid comes from the save-slot proto guid separate from
slot id, with Save-As behavior unverified (E1-G) plus external notes that
slot ids can be sticky or sentinel-valued at transient hooks — read
binding identifiers only at stable load points; in-game Python
networking/SSL is awkward prior-art-verified grounds for the helper
architecture (§18), with background-thread + main-thread-mutation-return
discipline; unattended running evidence is conflicting `SECONDARY`
(fullscreen may pause on focus loss; windowed/borderless reportedly
continues; DX11 implicated) — the E1-D matrix decides, and windowed/
borderless may become a product requirement; co-play selectability has
prior-art mechanism (household Sim made effectively unselectable via
selectability/selector hooks) from an archived mod (compatible to 1.107
only — feasibility evidence, never a dependency; RQ-01 PARTIAL); world
timing is a single variable affecting clock and interaction durations
(`SECONDARY`, consistent) with a default ratio of roughly one Sim day per
~24 real minutes — order-of-magnitude confirmation of the rhythm problem,
`RUNTIME_UNVERIFIED`, measured properly in E1-B; script interfaces for
affordance enumeration, enqueue, queue inspection, lifecycle, motives,
clock, and zone/travel remain prior-art status needing lived experiments
on 1.128.

Definitions: **S4CL** = Sims 4 Community Library, the maintained shared
script-modding library used as source reference. Household/residence/
inventory/property/ownership-flag representations: surveyed only,
interface status unknown, deferred past E2.

---

## 23. Typed-inference provider and resource evidence (condensed)

Provider research is evidence for a future path tuple (§13), never
architecture. Pinned reference: hosted TypeSafe Jev 1.13.0 (aliases
resolved there at cutoff), Choice ≤255, ~64K context, $0.042/1M input
with free output (vendor claims); independent gateway-measured medians
~140 ms server-side / ~0.83 s end-to-end with usable routing calibration
and poor answer-rating calibration (independent result, ~900 calls,
vendor-adjacent tasks — not Sims). Local candidates (all vendor-claimed,
no independent replication here): 421M-class encoder models (~1–2 GB),
0.8B-class decision models (~2 GB bf16), 395M-class marker models
(~1.5 GB, 8K context); larger models disqualified same-PC against the
Owner's 8 GB shared GPU (`OWNER_FACT` hardware: i7-9700K / RTX 2080
Super 8 GB / 32 GB RAM). Economics at vendor pricing with 1–2K
tokens/decision: event-driven use is cents/day; per-tick inference is
forbidden by cost and epistemics alike — typed inference only where
deterministic Host truth is insufficient, and cheap never means free.
Legal posture (section-cited secondary synthesis; primary confirmation
owed before any hosted send beyond Gate A scope): no-training promise
with consent/telemetry carve-outs, retention unstated, ZDR
enterprise-only, US-only, no uptime SLA. Local coexistence benchmark
(LB1) is optional, parallel, and low priority. No winner declared; no
live role earned; no provider locked. DIY classifier baselines are
legitimate shadow comparators, and any may win a narrow matching task —
kill criteria must be able to eliminate the THI path entirely.

---

## 24. Resource, failure, and self-deception register (condensed)

Budgets: Thought invocation ceiling 4/hr on the relevant private policy
(verified shape; embodiment policy still Owner decision); hosted-inference
event-driven cost cents/day; per-tick inference never. Coexistence of any
local model with the game on the Owner PC: plausible, unqualified,
benchmark-optional.

Do not be fooled by (each pairs a temptation with the standing rule):
semantic leakage from queue/motive/label wording into judgment
(firewall §12); decompiled-source consensus as proof (source ≠ runtime);
vote-count theater at zero witnesses; changelog silence as residual
coverage; candidate-into-recipe promotion (deterministic construction is
versioned); correlation as causation (causal law §10); key as history
(lineage §8); noncanonical as consequence-free (promotion ban §8);
fallback as qualification; zero-count theater (no trials, no success);
bounded view as world; silence as inactivity; post-state as attribution;
cancel as withdrawal; restored as uninterrupted; shadow as authority;
typed output as truth; posture as semantic action; inspection as
qualification; experiment as endorsement; rank as membership; quiet body
as CONTROL; no-failure-opportunity theater; API compatibility as semantic
equivalence; local as authorized; independent benchmark as our
qualification; paper footprint as VRAM fit; bridge-exists as
boundary-correct; generic ownership as domain compatibility;
admitted-remote then stale-local execution; shadow inference perturbing
the experiment via contention; provider/context limits silently selecting
the world; lease expiry concealing ongoing interaction; same designation
hiding different history; game-"directed" as Ashley authorship;
provenance lost in summarization/adoption.

---

# APPENDIX A — SOURCE LEDGER

| ID | Source | Kind | Supports | Limitations |
|---|---|---|---|---|
| P-V7.2 | V7.2 master, SHA `AC8C0FD0…62E0` verified | Lineage | Consolidated contracts superseded here | Superseded except via App. B |
| P-V7.1 | V7.1 repair, SHA `EAA3BC78…CB1C` verified | Lineage | Prior corrections | Superseded except via App. B |
| P-V7 | V7 master, SHA `E38820E9…791C` verified | Lineage | Patch/Ashley/provider regrounding | Superseded except via App. B |
| P-A1/A2 | Astra first + second pass, received in-session 2026-09-28 | Review | Prior findings, readiness | Second-pass file bytes absent; used via V7.2 absorption |
| P-O1 | Opus 5.5 first consultation (`ACCEPT_WITH_CORRECTIONS`) | Review | Reframe: presence, rhythm, P0, firewall, THI, lab | Source-blind per its terms; Sims claims tagged inferred |
| P-O2 | Opus follow-up adjudication (`READY_FOR_V7_3_AUTHORING`) | Review+archaeology | E0–E7, taxonomy, CA-01/03/04/05/06/07 | Latency/cost runtime-open; four Sims items deferred to addendum |
| P-O3 | Opus follow-up addendum (`READY_FOR_V7_3_AUTHORING`) | Review+research | Helper transport, prompts, selectability, dilation | Autonomy source still unverified; community evidence conflicting |
| S05 | Ashley `60fec11`, tree `123d744a`, main verified live | Primary source | All §21 mappings | Revision-pinned; no runtime observation |
| S01 | EA "Sul Sul, Smarter Sims!" Update 9/22/2026, PC 1.128.90.1030 | Primary vendor | Build identity; patch-delta facts | Vendor prose; silence ≠ no-change; unwitnessed on Owner client |
| S02–S04 | Community patch mirrors/analyses/wiki, 2026-09-22/23 | Secondary | Fix scope; residual bugs; non-retroactive fixes | Community analysis |
| S4CL | Sims 4 Community Library source (maintained shared library) | Sims source | Push source stamps; clock APIs; persistence services; queue hooks | Pre-patch revision; runtime on 1.128 unverified |
| S-LF | In-game LLM-calling mod source (prior art) | Sims source | subprocess/threading usable; SSL awkward; main-thread mutation discipline | One author; "no SSL" author statement, not independently verified |
| S-CAS | Selectability-control mod source, archived (compat to 1.107) | Sims source | Selectability/selector hooks as prior-art mechanism | Unmaintained; 1.128 runtime unverified; never a dependency |
| S-MCCC | MCCC FAQ/timing notes via community | Secondary | Single timing variable; ~24 min/Sim-day order of magnitude | Community; runtime unverified; measured in E1-B |
| S-JEV… | Hosted/local provider docs, cards, repos, benchmark, legal synthesis (as V7.2 S10–S25) | Mixed vendor/secondary | §23 figures | Vendor claims except where marked independent; confirm pre-budget/send |
| S26 | Owner facts: Sims build; PC hardware; Mint host; target UX | Owner fact | Anchors §§1/3/9/23 | Taken as given; unmeasured here |

Primary: S05, S01, S4CL-vendor, provider-vendor cards/repos. No search
snippet cited as primary evidence. No source added beyond the V7.2 set
plus the Opus-supplied research incorporated above.

---

# APPENDIX B — LINEAGE AND AUDIT

## B.1 Predecessor hashes

V7.2 `AC8C0FD0…62E0`, V7.1 `EAA3BC78…CB1C`, V7 `E38820E9…791C`
(all verified by file hash before authoring). Earlier reviews and Opus
passes are provenance; none is needed to interpret Part I.

## B.2 Prior-review absorption (condensed)

Earlier findings were absorbed into V7.2 and survive here in their V7.3
form: inspection ≠ qualification; experimental-vs-endorsed origin split;
receipts after final admission; stop/refusal as independent records;
rank/membership split with higher membership burden; boundary-placed
currentness with relevant-change invalidation; five hold dimensions with
social-first excluded; measured/predicted/constraint/unknown timing with
requalification triggers; retain-and-route mandatory reporting; whole-path
tuple with independent oracle; nonblocking inference law; operative
falsification floor. Historical disposition counts from prior merges are
not carried as naked aggregates — the rules above are their substance.

## B.3 V7.2 → V7.3 change ledger

| ID | V7.2 state | V7.3 state | Why | Design change? | Evidence | Stage |
|---|---|---|---|---|---|---|
| C01 | Production topology unfrozen; co-play an optional probe (A9) | Owner-stated target UX recorded (co-play + solo); four presence modes as supported states | Owner stated the product; architecture must handle all four states | YES | OWNER_FACT + INFERENCE | all |
| C02 | Timing as A4 measurement phase | First-class `EMBODIMENT_COGNITIVE_RHYTHM` + verified 4/hr budget fact, numbers unqualified | Time-scale mismatch is the central embodiment problem | YES | ASHLEY_SOURCE_VERIFIED (budget shape) | E1/E3/E5 |
| C03 | First Ashley authorship at A7; 71 KB with zero lived experiments | E0 mediated participation (zero code, parallel) | Cheapest real evidence path; evidence before architecture | YES | none needed | E0 |
| C04 | Single-axis origin set | Two-axis provenance (authority origin × execution path) + THOUGHT_STANDING, HOST_BODY_PROTECTION | "Ashley chose, Owner executed" ≠ "Owner chose, Owner executed" | YES | none needed | all |
| C05 | A0–A9 governing programme | E0–E7 canonical programme; A3 cross-cutting; A8 → BCLP; A9 → E6 core | Better order, same safety ladder | YES | none needed | all |
| C06 | A0 discovery/instrumentation with "work logged" acceptance | E1 strictly read-only with MUST questions A/B/G and raw-evidence acceptance | Logged work without answers must not count as success | YES | none needed | E1 |
| C07 | Binding key with no snapshot contract | Semantic `BODY_STATE_SNAPSHOT` contract (categories + invariants, no frozen schema) | One place stating what "body observation" means | YES | none needed | E1–E7 |
| C08 | Need/autonomy laws only | Five-law Sims psychology firewall + positive path + pre-E3 focused test | Most likely real-world honesty failure is Sims-specific | YES | CA-05 static | E3 |
| C09 | `WORLD_LINEAGE` required but unmechanised | Detectability frozen as requirement; inside/outside candidate, mechanism open | V7.2 required what it could not compute | YES (requirement kept; mechanism added as candidate) | SIMS_SOURCE_VERIFIED (feasibility) | E1/E2 |
| C10 | Test→canonical promotion banned without scope | `WORLD_NONCANONICAL != EXPERIENCE_UNREAL`; ban scoped to world state; memory append-only | Witnessed experiments are autobiographically real | YES (clarification) | none needed | all |
| C11 | A3 standalone five-dimension phase | Cross-cutting hold contract + pause-covered smallest rule | A3 is "what the body does while Ashley thinks" | YES | none needed | E4+ |
| C12 | Per-rung attribution ceremony; "Sofa A" as law | General causal law + E2 test-class definition + lab reference method; chair preferred | Same honesty, less ceremony; lab-scoped recipe | YES | SIMS_SOURCE_VERIFIED (handles/hooks, runtime unverified) | E2 |
| C13 | System One architectural identity (S1-*) | Slot renamed TYPED HOST INFERENCE; provider category separate; aliases kept | Name authority position, not vendor/metaphor | YES (naming) | none needed | later |
| C14 | Wake gating as future possibility | Monotone-add wake law frozen now; build later with kill criterion | Filter-as-preference and narrowing-loop safeguard | YES | existing subscription kin verified | later |
| C15 | Affordance matching as strongest early THI hypothesis | Thought picks from Host-enumerated affordances; deterministic prefilter rules | Cheapest correct mapping; no membership oracle needed early | YES | none needed | E3/E4 |
| C16 | Autonomy as interference; standing permission undesigned | `THOUGHT_STANDING` semantics + envelope as future contract, activation withheld | Free body controller; delegation must be authored | YES | kin verified; fit unproven | E5+ |
| C17 | Bridge/helper as qualification question | Helper-from-E3 structural architecture; in-mod network IO = NO | Embedded-Python transport awkward; credentials stay out | YES | Sims prior-art source | E3 |
| C18 | Hold as single mechanism | PAUSE / DILATE / ENVELOPE strategies; dilation = Owner world policy | Pause intrusive in co-play; dilation keeps mechanics consistent | YES | SECONDARY + runtime unverified | E4–E7 |
| C19 | Prompts unaddressed | Player-prompt decision-point rule (solo hold+wake; co-play Owner answers) | Modal dialogs pause the world and choose Ashley's life | YES | SECONDARY | E3+ |
| C20 | Selection unmodelled | BodyState carries selectability + selection; RQ-01 PARTIAL, implementation-neutral | Selection changes autonomy; prior art exists but archived | YES | Sims prior-art source | E6 |
| C21 | Home/items as post-A2 future surface | Early semantic world-building + late mechanical automation; acquisition provenance | Meaningful choices need no automation | YES | none needed | E0/E7 |
| C22 | Audit lineage inline in main flow (§§3/22/25/26, file:line §7, legal detail) | Design core in Part I; all audit in Appendices; hygiene defects fixed | 71 KB read as ledger, not design | NO (presentation) | none needed | — |

## B.4 A0–A9 → E0–E7 mapping

A0 → E1 (discovery/instrumentation, now read-only with MUST questions).
A1 → E2 binding component. A2 → E2 actuation component (chair class,
causal bundle, Owner-click control). A3 → cross-cutting rhythm/hold
contract (§9). A4 → E1 measurement + E5 living rhythm. A5-read → E3;
A5-actuation → E4 boundary. A6 → E3 perception. A7 → E4 (reframed: first
*self-executed* Thought-endorsed action; first *choice* is E0). A8 →
E5 bounded pursuit plus future standing delegation (no prospective
machinery until lived need). A9 → E6 (promoted from optional probe to
core milestone). E0 is new. E7 is the explicit product-life milestone not
clearly represented before.

## B.5 Opus consultation lineage

V7.2 → Opus first consultation (`ACCEPT_WITH_CORRECTIONS`: sound
attribution/safety architecture, not yet an embodiment design; keep laws
and instinct; resequence, add zero-code track, reframe inference) →
Opus follow-up adjudication (`READY_FOR_V7_3_AUTHORING`: E0–E7, taxonomy,
archaeology CA-01/03/04/05/06/07) → Opus addendum (`READY_FOR_V7_3_
AUTHORING`: helper transport, prompt rule, selectability prior art,
dilation, E1 scope) → this master. All Opus findings are native parts of
Part I above; the consultation texts are provenance, not companions.

## B.6 Ashley file:line archaeology (pinned to `60fec11`)

Budget: 4/hr global per policy with `policyId` reservations —
`private-budget/ledger.ts` (~143–153), `types.ts:66`, idle reservation
paths in `initiative/idle.ts:467` (CA-03 source part; Owner/completion
paths observed reservation-free by grep; latency/cost runtime-open).
Standing kin: `SubscriptionSemanticDelta` / `FutureTriggerSemanticDelta`
(`types.ts:971–995`, deterministic equality/substring match) plus
commitment proposals (CA-07 existence only). Firewall writers with no
production callers: `applyAffectiveEvent`, `upsertMindStateItem`,
`writeFromUserTurn`; affect otherwise reset only on forget
(`episodes.ts:525`); relationship projections recompute only from identity
revisions, memory corrections, or forget; durable memory enters only
through Thought nominations (`settlement/publish.ts:521`, also
`publish.ts:373–452,657–670` idempotent publish; CA-05 static).
Nominations carry `memoryKind`, epistemic dimensions
(`types.ts:314–341`, incl. `EpistemicTime`), and `sourceRefs` — no
origin/execution-path/lineage/canonicity fields (CA-04 partial).
Undertaking/detached/completion: `operation/worker-queue.ts:48–378`
(only `project.inspect` admitted today), `operation/detached.ts:117–578`
(only `project.investigate` admitted), `operation/completion.ts:30–367`
exactly-once binding (CA-01 open). Bounded pursuit: `effect/
continuation.ts:10–372` (360 s lease, `MAX_EFFECT_ROUNDS=4` per
`types.ts:70`); `retry/ledger.ts:586–1312`; `retry/startup-outcome-
recovery.ts:71–243`; `sidecar/recovery.ts:99–167`. Identity/fencing:
`core/cognitive-v021/wake/identity.ts:7–18`; `types.ts:205–287`;
`cycle/inbox.ts:343–435,716–774`; `cycle/fence.ts:78–274,438–588`.
Ingress/observation: `server.ts:1920–1949` ingress envelope, `:2108`
claim, `:2154` dispatch-started, `:2179` receipt, `:2288` finalize,
`:2613` cancel, `:701` temporal; `ingress/http.ts:789–998,1077`;
`inbox-consumer.ts:48–340`; `dispatch/live.ts:137–174,197–233`;
settlement envelope `types.ts:1275–1332`. Privacy: `core/privacy/
classification.ts:1–98`; `privacy/disclosure.ts`; `external-agency/
types.ts`, `policy.ts:32–97`, `disclosure-gate.ts:48–72`; M6
`canOfferBoundedOperation:false` (`thought/capability-reality.ts:468`).
Continuity: `core/continuity/db.ts`; `continuity/sessions.ts:5–131`;
`cycle/reconcile.ts:140–385`; `wake/ledger.ts:151–443`.
Sims-side references (source, runtime-unverified on 1.128): S4CL push
return `.interaction` (queue-append/run/start/outcome/cancel hooks),
`SOURCE_PIE_MENU` / `SOURCE_SCRIPT_WITH_USER_INTENT` values, clock
`ClockSpeedMode.PAUSED` set API (ClockSpeedMode = the game's clock-speed
enum), `CommonTimeUtils` total ticks,
`get_save_slot_proto_guid()`, hidden-household persistence service.

---

# FINAL MASTER BLOCK

```text
DOCUMENT = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3.md
DOCUMENT_TYPE = FULL CONSOLIDATED MASTER EMBODIMENT DESIGN
  (OPUS-ADJUDICATED EMBODIMENT REFRAME)

SUPERSEDES_V7_2_AS_MASTER = YES, if Owner accepts
V7_2_SHA256 = AC8C0FD0DF5E689A9E2AE6912D3ABD4FA16B0D693F45403A85FD1255AD7A62E0

EXTERNAL_MASTER_DEPENDENCY = NONE

ASHLEY_SOURCE_SHA = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
ASHLEY_SOURCE_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675
SIMS_BUILD = PC 1.128.90.1030
RESEARCH_CUTOFF = 2026-09-28

ONE_ASHLEY = PRESERVED

PRODUCT_UX_TARGET = CO_PLAY + SOLO_CONTINUATION
PRODUCT_TOPOLOGY_FROZEN = NO

PRESENCE_MODES = OWNER_PRESENT / OWNER_ABSENT / MIND_ABSENT / GAME_ABSENT

CANONICAL_PROGRAMME = E0 / E1 / E2 / E3 / E4 / E5 / E6 / E7

AUTHORITY_ORIGIN_AXIS =
  THOUGHT_ENDORSED / THOUGHT_STANDING / EXPERIMENT / OWNER_DIRECT /
  NATIVE_AUTONOMY / HOST_BODY_PROTECTION / UNKNOWN
EXECUTION_PATH_AXIS =
  HOST_HARNESS / OWNER_UI / GAME_AUTONOMY / UNKNOWN

SIMS_PSYCHOLOGY_FIREWALL = REQUIRED
BODY_STATE_CONTRACT = REQUIRED (semantic, not schema)
WORLD_LINEAGE_DETECTABILITY = REQUIRED (mechanism open)

RHYTHM_STRATEGIES = PAUSE / DILATE / ENVELOPE
GAME_PLAYER_PROMPTS_ARE_DECISION_POINTS = YES

ARCHITECTURAL_INFERENCE_SLOT = TYPED_HOST_INFERENCE
  (legacy aliases S1-*, J-* — one lineage note)
THI_REQUIRED_FOR_EARLY_EMBODIMENT = NO
THI_WAKE_GATE_MONOTONE_ADD = YES

IN_GAME_MOD_NETWORK_IO = NO
WINDOWS_HELPER_PROCESS_REQUIRED_FROM = E3

FIRST_BUILD = E1_STRICT_READ_ONLY
FIRST_ACTUATION = E2
FIRST_THOUGHT_ENDORSED_OWNER_EXECUTED_CHOICE = E0
FIRST_BOUND_EMBODIED_EXPERIENCE = E3
FIRST_THOUGHT_ENDORSED_SELF_EXECUTED_ACTION = E4

CA01_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
CA01_REQUIRED_BEFORE_E4 = YES

V7_3_DESIGN_READY_FOR_OWNER_DECISION = YES
MASTER_CAN_BE_ACCEPTED_BEFORE_RUNTIME_TESTS = YES
RUNTIME_EVIDENCE_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
CODE_ARCHAEOLOGY_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO

E0_READY_FOR_OWNER_AUTHORIZATION = YES
E1_READY_FOR_OWNER_AUTHORIZATION = YES
  (only after separate Owner authorization to implement/run it)
E2_EXECUTION_READY = NO
E3_EXECUTION_READY = NO
E4_EXECUTION_READY = NO

THI_REQUIRED_FOR_EARLY_EMBODIMENT = NO
PRODUCT_TOPOLOGY_FROZEN = NO
ONE_ASHLEY = PRESERVED

NEXT_OWNER_DECISION = accept-V7.3 → authorize-E0 → authorize-E1 →
  E0-session-1 (CAS in preview save, Sim to library) ∥ E1-probe-prompt ∥
  CA-03-runtime-packet → adjudicate-E1 → E2...
```

---

*End of V7.3 Master. One file; one programme; no required reconstruction.
Laws kept; programme resequenced; presence, rhythm, provenance, firewall,
BodyState, lineage, THI, and E0–E7 native to the design. No E-stage
execution authorized. No runtime proof claimed. No message to Owner.*
