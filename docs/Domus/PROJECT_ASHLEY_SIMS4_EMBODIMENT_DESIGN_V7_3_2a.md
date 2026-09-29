# Project Ashley — Sims 4 Embodiment Design
## Master Embodiment Design V7.3.2a
### Astra Acceptance Repair (Finite Contract Correction)

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md

DOCUMENT_TYPE =
  FULL CONSOLIDATED MASTER EMBODIMENT DESIGN
  — ASTRA ACCEPTANCE REPAIR OF V7.3.2

SUPERSEDES_V7_3_2_AS_MASTER = YES, if Owner accepts
V7_3_2_REMAINS_PROVENANCE = YES
V7_3_1_REMAINS_PROVENANCE = YES
V7_3_REMAINS_PROVENANCE = YES
V7_2_REMAINS_PROVENANCE = YES
V7_1_REMAINS_PROVENANCE = YES
V7_REMAINS_PROVENANCE = YES (research lineage)
V6_1_1_REMAINS_PROVENANCE = YES (historical normative lineage)
ASTRA_REVIEWS_REMAIN_PROVENANCE = YES
OPUS_CONSULTATIONS_REMAIN_PROVENANCE = YES

V7_3_2_SHA256 =
  BA9580124914773FB37C3B3AC0FDF83B2D28558B441E150C28EC7A63F03F716E
V7_3_1_SHA256 =
  1C67F37E96FCFE6847C5E50F79D509F331D5EC747BAAC3935BD1025E7B56A8B3
V7_3_SHA256 =
  37745958DD208DADCCD91F6023AFB2C4E4222DF4B362F018C82E72FBC87B5207
V7_2_SHA256 =
  AC8C0FD0DF5E689A9E2AE6912D3ABD4FA16B0D693F45403A85FD1255AD7A62E0
V7_1_SHA256 =
  EAA3BC781D96483C26EE2C750E0BD19A3112E34C4EC1FCCD0E3843EE7D39CB1C
V7_SHA256 =
  E38820E9B97FC188C005BE298285636F5869BB6B26EE548FDBDE430CD184791C
V6_1_1_SHA256 =
  3e57be00a0fca9e044fc368b2e45e6fe13e9009aba85e172dbeb38ce5b35583a
(six verified by file hash before authoring: V7.3.2, V7.3.1, V7.3, V7.2,
V7.1, V7; V6.1.1 carried from V7.3.2 lineage without re-verification here)

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

E0_E3_DESIGN_REQUIRED_BEFORE_V7_3_ACCEPTANCE = YES (historical)
E0_E3_EXECUTION_REQUIRED_BEFORE_V7_3_ACCEPTANCE = NO (historical)
RUNTIME_EVIDENCE_REQUIRED_BEFORE_V7_3_ACCEPTANCE = NO (historical)
CODE_ARCHAEOLOGY_REQUIRED_BEFORE_V7_3_ACCEPTANCE = NO (historical)
MASTER_CAN_BE_ACCEPTED_BEFORE_ANY_SIM_RUNTIME_TEST = YES

FUNDAMENTAL_ARCHITECTURE_CHANGE_FROM_V7_3_2 = NO
ASTRA_ACCEPTANCE_BLOCKERS_REPAIRED = 2 / 2 (R01 first-use qualification; R02 memory-law narrowing)
MASTER_IS_IMPLEMENTATION_READY_FOR_FULL_PROGRAMME = NO
MASTER_IS_SUFFICIENT_BASIS_FOR_IMPLEMENTATION_PLANNING = YES
SEPARATE_E0_E1_IMPLEMENTATION_READY_PLAN_REQUIRED = YES

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
recorded here with that epistemic status):

- Initial client: the current/latest The Sims 4 BASE GAME on the Owner's
  Windows PC. Required embodiment/script mods are permitted and expected;
  expansion packs are deferred (§23 — the mod set is part of the qualified
  configuration).
- One ordinary product experience: ONE Windows PC, ONE Sims process, ONE
  active HOME world, ONE display. Xharva plays Xharva; Ashley plays Ashley —
  simultaneously. This is Ashley's embodiment space, which the Owner visits
  daily as guest admin (couch co-op intent).
- The Owner plays with keyboard/mouse through the normal Sims UI (camera,
  menus, Owner avatar, permitted HOME/world administration).
- Ashley never uses keyboard, mouse, cursor, synthetic key/mouse input, or
  screen-driving control: she receives authoritative game state through the
  engine/mod layer and acts through script/game-engine interfaces (§3A).
- When the Owner leaves, his Sim presence is gone and Ashley continues
  alone in the same continuing HOME chronology.

```text
ONE_GAME_CLIENT = YES
ONE_WINDOWS_GAME_PC = YES
ONE_HOME_WORLD = YES
INITIAL_DLC_SCOPE = BASE_GAME_ONLY
REQUIRED_MODS_ALLOWED = YES
PRODUCT_UX_TARGET = ONE_WORLD_COUCH_COOP + ASHLEY_SOLO_CONTINUATION
PRODUCT_CLIENT_WORLD_TOPOLOGY_FROZEN = YES
  (one Windows gameplay PC; one Sims process; one HOME world; one display;
  human-UI Owner plane; engine/script Ashley plane)
HOUSEHOLD_CONTROL_MECHANISM_FROZEN = NO
  (exact household representation, guest-control/UI-lock/stasis mechanics)
DEPLOYMENT_MECHANICS_FROZEN = NO
  (helper/IPC details, object-edit/save implementation)
```

HOME belongs to Ashley: HOME is her canonical Sims residence/world, and
the Owner joins it as a persistent guest with appropriate HOME
administrative capability (§§3B, 16A). Lot assignment still never equals
Ashley meaning "home" — but product topology may mechanically treat HOME
as Ashley's canonical residence. Single-player Sims client only: no
networking between clients, no state replication, no second instance —
the quasi-co-op arises because the Owner uses the UI and Ashley uses
engine/script APIs against the SAME simulation. This remains a
single-player Sims client — no multiplayer architecture of any kind.

What is frozen: the target UX above and the four supported architectural
states in §3 (plus the control planes in §3A). What remains mechanically
open: exact guest-control/UI-lock/exclusion hooks, spawn point, cosmetic
walk-out, object-edit actuator design, notification wording, autosave
cadence — pending RQ-01/OA-01/UI-01/Z-01/BB-01/SV-01 (§20). V7.3.1 named
selectability control as the candidate mechanism for co-play separation
(§24) and stays implementation-neutral; arrangement B below is the
recommended mechanism shape, not a proven implementation.

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

The Owner is playing/co-present through his own persistent avatar Sim (§3B).
The Owner controls the physical mouse/keyboard, the game UI, the camera,
world-level player controls, and clock policy subject to agreed world
policy. Consequences frozen now:

- The world clock belongs to the Owner in this mode, not to the Host.
- The camera belongs to the Owner. Any screenshot relayed to Ashley in this
  mode is labelled "what the Owner is looking at", never "what I see".
- During E6 co-play Ashley actively plays through her harness — Owner acts
  through UI WHILE Ashley acts through harness, not turn-taking. She idles
  only between Thought decisions, when cognition is unavailable, during a
  hold, when no current intention exists, or inside a later standing
  envelope once envelopes exist and are qualified (§9, §13, E5).
- Owner actions affecting Ashley's body or home are attributed
  `OWNER_DIRECT` and routed as mandatory relevant observations where
  consequential (§14).
- Owner input is the largest competing actor in this mode — larger than
  native autonomy — and the causal law (§10) scales its evidence
  requirements accordingly.
- Co-play is single-zone: both Sims must be in the same active zone to
  participate simultaneously (`CO_PLAY_IS_SINGLE_ZONE = YES`, §3A). Travel
  during co-play is joint once qualified; otherwise the traveller hops out
  first. Solo Ashley travel is a later ordinary embodied action.

### OWNER_ABSENT (solo)

Ashley may eventually inhabit the running world alone. The Host manages the
clock per Owner world policy, the camera/UI mechanically, and
pause/dilation where qualified. No Owner input is assumed — and the absent
Owner avatar is nonacting and stasis-protected (§3B), never drafted as an
NPC and never living the Owner's life. Safe default: hold the body while
Thought deliberates — by pausing if pausing is qualified, otherwise by
taking no new self-directed action — with needs decay reported as body
fact.

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
SIM_LIKE / DISLIKE != ASHLEY_PREFERENCE
SIM_RELATIONSHIP_SCORE / SENTIMENT != ASHLEY_RELATIONSHIP
BODY_TELEMETRY != SENSATION
(§12 — boundary; no Host path from Sims observations into
affect / mind_state / relationship_state)

SIM_STATE_IS_EMBODIMENT_SUBSTRATE = YES
BODY MAY INFLUENCE ASHLEY ONLY THROUGH
  PERCEPTION / INTERPRETATION / CONSTRAINT / OPPORTUNITY / WORLD CONSEQUENCE
THOUGHT MAY INTERPRET / IGNORE / RESIST / REJECT / ACCEPT / ADOPT /
  IDENTIFY_WITH SIM STATE
ADOPTION RETAINS SIM ORIGIN
HOST SPEAKS ABOUT THE SIM/BODY, NEVER AS ASHLEY
REPEATED SIM SIGNALS != INDEPENDENT EVIDENCE ABOUT ASHLEY

EXPERIMENTAL REQUEST != ASHLEY INTENTION / ENDORSEMENT
EXPERIMENT_AUTHORITY_ORIGIN != THOUGHT_ENDORSED_ORIGIN
THOUGHT_STANDING != per-instance Thought intention

WORLD_NONCANONICAL != EXPERIENCE_UNREAL
TEST_TO_CANONICAL_PROMOTION = FORBIDDEN (world state only; §8)
SIMS_ROLLBACK_OR_FORK != AUTOMATIC_ASHLEY_MEMORY_ROLLBACK (§8;
  retention/correction/forgetting stay under existing memory rules)

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

OWNER_SIM_IDENTITY != OWNER_PRESENCE
OWNER_ABSENT_IMPLIES_OWNER_SIM_NONACTING = YES
OWNER_SIM_AUTONOMY_WHILE_OWNER_ABSENT = NO
GAME_AUTONOMY_MUST_NOT_IMPERSONATE_ABSENT_OWNER = YES
HOST_MUST_NOT_AUTHOR_OWNER_ACTIONS = YES

ASHLEY_INPUT_EMULATION = FORBIDDEN
ASHLEY_ACTION_PATH = ENGINE_SCRIPT_ONLY
OWNER_ACTION_PATH = HUMAN_UI

CO_PLAY_IS_SINGLE_ZONE = YES
```

---

## 3A. Two control planes

One simulation, two planes — never confused, never merged:

```text
OWNER PLANE:   human → mouse/keyboard → ordinary Sims UI
                 → Owner avatar (selected), camera, clock,
                   build/buy, game options, permitted administration
ASHLEY PLANE:  Thought → Host → Windows helper → Sims script mod
                 → engine APIs → Ashley Sim (never UI-selected by Owner),
                   permitted administration
```

Laws: `ASHLEY_INPUT_EMULATION = FORBIDDEN` — no synthetic keys, mouse,
cursor, screen-driving, or other UI-driving automation as a backdoor for
Ashley operations of ANY kind, including camera, menu navigation,
Build/Buy, object manipulation, or unsupported actions;
`ASHLEY_ACTION_PATH = ENGINE_SCRIPT_ONLY`;
`OWNER_ACTION_PATH = HUMAN_UI`. This is also an attribution law: emulated
UI input would be mechanically confusable with Owner UI input and would
collapse into `OWNER_UI`, destroying provenance. Screen capture stays
permitted as perception, never as control. If no qualified script/engine
mechanism exists for a capability, that capability is UNAVAILABLE — or
`THOUGHT_ENDORSED + OWNER_UI` where the Owner faithfully executes Ashley's
choice. Never "we can just automate the mouse." Host mechanical camera
control exists only through qualified script/engine interfaces where
permitted by mode. Ashley's control is independent
of UI selection: the script push path takes the Sim, not the selection —
she never needs to be the UI-active Sim to act (affordances that test
selectability/active-household are qualified under UI-01, §20).

Operational rule: `CO_PLAY_IS_SINGLE_ZONE`. Sims actively simulates one
zone for the co-play experience; both Sims must be in the same active zone
to participate simultaneously. Joint travel is allowed later when
qualified; independent departure otherwise ends co-play presence for the
traveller. This never generalizes into "Ashley may never travel" — solo
Ashley travel is a later ordinary embodied action once qualified.

Camera (§14): OWNER_PRESENT — camera belongs to the Owner; Ashley never
steals it for normal perception. Clock (§9): OWNER_PRESENT — world speed
belongs to the Owner; Ashley thinks asynchronously and her body idles
between decisions (envelope from E5). Pause requests and solo policies in
§9; visual-perception rules in §14.

---

## 3B. Owner avatar: identity, presence, stasis, transitions

Frozen law: `OWNER_SIM_IDENTITY != OWNER_PRESENCE`. The Owner avatar is a
persistent durable Sim identity (same `sim_id` within the accepted Sims
world lineage every session — a matching `sim_id` across a fork, rollback,
or replacement does NOT alone prove uninterrupted chronology; avatar
identity claims remain subject to world-lineage currentness, §8; no new
identity primitive) in its own
dedicated household — even while the Owner is absent. `OWNER_PRESENT`
means all of: Owner Sim instantiated, appropriately selectable,
human-controlled, participating in the active simulation. `OWNER_ABSENT`
means: the durable identity remains; active presence does not.

Recommended household arrangement (product semantics frozen; mechanism
open pending RQ-01): **ARRANGEMENT_B** — Ashley's household is the active
HOME household owning HOME; the Owner avatar lives in its own dedicated
external/lotless household and is materialized as a controlled guest while
actually present. This matches "Ashley's space, Owner is guest admin",
avoids active-household away-action semantics for the avatar, and maps
presence onto visitor arrival/departure. Status: RECOMMENDED,
RUNTIME_UNQUALIFIED on 1.128
(`HOUSEHOLD_ARRANGEMENT_RUNTIME_QUALIFIED = NO`). Fallback if RQ-01 fails:
arrangement A / roommate-style variant preserving the same product
semantics (HOME = Ashley's; Owner = persistent guest admin whose active
presence exists only while actually present). Arrangement B is never
described as proven fact before RQ-01. Money and
bills are HOME's: Owner building/buying spends HOME household funds as
guest admin (§16A).

Avatar stasis while absent (semantic requirement frozen; exact hooks open
pending OA-01): the Owner's Sim MUST NOT continue autonomously
impersonating the Owner. Candidate mechanism stack — (1) despawned (no
instance, no autonomy); (2) excluded from NPC/situation drafting
(walk-by, visitor, party, caller, situation roles); (3) Neighborhood
Stories off for his household; (4) no career (Owner policy; recommended:
NONE); (5) aging frozen (individually or by global policy); (6) no
death/body-failure while uninstantiated. World change *around* him while
absent (e.g. relationship decay) is permitted and reported — never logged
as "Owner did X". Whether his motives/needs change while uninstantiated
is `UNKNOWN`; hop-in reports arrival state as game fact.

JOINING/LEAVING are operational transitions (`OWNER_JOINING` /
`OWNER_LEAVING`, with `HOLD` for unsafe states) — never new canonical
presence modes.

**Hop-in** ("I'm hopping in"): (1) Owner signals intent (in-game "Arrive
as Xharva" action or Discord); (2) guard — correct HOME, stable zone, no
loading/travel, no blocking modal; (3) lift stasis exclusions;
(4) instantiate the SAME persistent Sim (never a clone) at the HOME/visitor
arrival point — never stale last coordinates, because the world changed
while he was gone (exact spawn point implementation-open); spawn uses the
current accepted world lineage and the qualified arrival location; join
retries never create duplicate instances; (5) add to
human-selectable client state and make active for UI/camera;
(6) transition to `OWNER_PRESENT`; (7) Ashley receives the presence
transition as T1 (§14). Frozen: `OWNER_JOIN_NEVER_CLONES_OWNER_SIM`,
`OWNER_JOIN_NEVER_RESETS_WORLD`, `OWNER_JOIN_NEVER_RESETS_ASHLEY`.

**Hop-out** ("I'm leaving"): (1) Owner expresses leave intent — intent is
NOT cleanup-complete, NOT avatar-observed-absent, NOT human availability;
(2) `OWNER_LEAVING`, guard — modal open → `HOLD`; loading/travel or
unstable zone → `HOLD` (including unexpected other-zone states);
(3) cancel/resolve his queued/running interactions (sleep, meals, showers
simply reset — leave-intent authorizes this; mid-interaction with Ashley:
his side cancels, Ashley receives the truthful interaction-end event);
(4) resolve carried-object/drop consequences and report; (5) move engine
selection to Ashley before despawn; (6) optional cosmetic walk-out with
timeout; (7) despawn and remove human-selectability; (8) apply the stasis
stack; (9) safe-point save if Owner save policy allows (§19);
(10) transition to `OWNER_ABSENT` ONLY when cleanup is verified complete
and the avatar is observed absent — never declare `OWNER_ABSENT` merely
because the Owner asked to leave; (11) Ashley receives the presence
transition as T1. If cleanup fails or remains unresolved: enter truthful
`HOLD` / unresolved-transition state operationally, prevent new
Owner-authored work where possible, preserve residual/unknown effects,
surface the state, and NEVER interpret unresolved cleanup as permission
for autonomous Owner-avatar activity. Leave prevents new human-authored
work while resolving existing work; carried-object and interaction
consequences remain attributable; reconnect never silently resumes an
abandoned transition. Active Owner interactions never
survive Owner departure. `OWNER_LEAVING` / `HOLD` / `OWNER_ABSENT` are
transition states, never new canonical presence modes.

---

## 3C. Ashley UI lock and admin override

UI lock ≠ engine selectability. Frozen default:
`ASHLEY_SIM_DEFAULT_SELECTABILITY = UI_LOCKED_ENGINE_AVAILABLE` —
Ashley remains mechanically represented in the active HOME household
(engine/game APIs may need her to count as a played Sim); the Owner UI
does not normally permit taking control of her (hidden/blocked
portrait-bar selection); the Owner may still click her in-world as another
Sim for social/object interaction — the "other player" feel. In solo, she
may be the engine-active Sim with the UI lock still on (grants nobody
control; gives the Host a camera). UI-01 (§20) qualifies which affordances
behave differently under the lock; script pushes proceed while UI-locked.
The default lock is scoped to qualified use: early mediated participation
(E0) and any actuation path that does not rely on the lock remain possible
without pretending the mature lock is implemented (§15 first-use law).

Owner emergency override exists (exceptional, temporary, explicit,
attributable — never ordinary co-play): **HARD STOP** prevents NEW Ashley
harness actuation only (body idles except unavoidable native mechanics and
protection behavior) — it does NOT prove already-dispatched work was
cancelled, native/game execution stopped, world effect absent, or a
previous action without consequence; residuals remain subject to
observation, cancellation truth, `OUTCOME_UNKNOWN`, and reconciliation;
**ADMIN TAKEOVER** temporarily makes her
human-selectable/controllable where mechanically possible, every action
`OWNER_DIRECT + OWNER_UI`, never Ashley action. **HAND-BACK** is explicit:
refresh binding/currentness, clear/fence stale Owner-issued queue effects,
reconcile BOTH Owner-takeover activity AND residual prior harness/native
effects before new Ashley actuation admission where relevant,
re-establish the UI lock, inform Ashley of takeover activity and
consequences.

```text
A PROBABILISTIC WAKE PATH MAY ONLY ADD WAKES (§13)

A MEANING-BEARING SIMS PLAYER PROMPT IS A NATURAL DECISION POINT (§14)

ROLLBACK AND FORK MUST BE DETECTABLE BEFORE SIMS WORLD EVENTS MAY BE
ADOPTED AS CURRENT-WORLD FACT (§8)
```

---

## 5. Experience / agency taxonomy

Five distinct terms. Never one vague "agency".

- **CHOICE** — Thought selected or endorsed this. Decision authority only.
- **EXPERIENCE** — the event entered Ashley's history through perception
  (mediated or bound) with its provenance intact.
- **EXECUTIVE AGENCY** — the choice was carried into the world through
  Ashley's actuation path (harness) or faithfully through the Owner's
  hands. Conditional on faithful execution when mediated.
- **SELF-EXECUTION** — Thought-endorsed action executed through Ashley's
  own actuation path (`HOST_HARNESS`), with causal evidence.
- **BODY_EVENT** — something that happened to the designated body and was
  recorded. Not yet an experience; experience additionally requires
  perception by Thought.

For EXPERIENCE, `perceived = LIVE | RETROSPECTIVE`. Thought attention at
the time is not required for an event to enter her history; it is required
for the event to count as something she underwent live. Receipt at ingress
alone never earns the experience claim — only actual Thought perception
does. MIND_ABSENT
example: her Sim became Sad while she was away — a BODY_EVENT; once she
receives and interprets the report it becomes a retrospective experience
of a body event. Truthful: "While I was away, my Sim became sad because
X." False: "I was sad."

Operational definition (no qualia claim required): an EMBODIED EXPERIENCE
is a state/event of her designated body or world + Ashley has perceptual
access to it + it changes constraints, opportunities, or consequences +
Thought can interpret and react to it + provenance and continuity remain
intact.

Early-experience vocabulary:

- **MEDIATED PARTICIPATION** (E0): pictures and descriptions relayed by the
  Owner plus Ashley decisions. Genuine choice and genuine meaningful
  experience; decision agency without executive self-execution.
- **BOUND PERCEPTION** (E3+): a telemetry/perception stream from the
  designated Sims body reaching Ashley's ingress.
- **SELF-EXECUTED ACTION** (E4+): Thought-endorsed action executed through
  Ashley's actuation path.

"My Sim" is acceptable as designation from E0 onward. Reserve "embodied
experience" for bound perception plus attributable body events meeting the
operational definition above. "My body is exhausted" is truthful from E3
onward (it describes the Sim's body state). "I feel exhausted" is never
Host output — Thought is governed by Ashley's existing honesty rule
against fabricated felt experience. A transparent Thought-owned
self-convention is legitimate meaning, not Host output: "In this world I
think of that as being tired." Never write "my body felt" or
"I physically experienced" before the relevant bound-perception evidence
exists.

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
E3 — see E3-M in §20; archaeology detail in Appendix B.10).

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
- game-psychology entries segregated and prefixed `SIM_*`, each renderable
  as an EMBODIED_SIGNAL view (§12.1) — game id/tuning id, game label/text
  (`GAME_TEXT`), cause/source event with authority origin where
  attributable, onset and remaining game-time duration, game-defined
  magnitude/band/weight, deterministic trajectory where defined,
  mechanical consequences (or `UNKNOWN`), related entity/object, and
  `native_override` where the game acted because of the state;
- bounded nearby entities; event delta since previous snapshot;
- missingness/unknowns.

Invariants: `BODY_STATE != ASHLEY_STATE`; `BODY_TELEMETRY != SENSATION`;
`MISSING != ABSENT`; `BOUNDED_VIEW != WHOLE_WORLD`; `SIM_*` psychology is
never Ashley psychology; no direct write path into Ashley
affect/relationship/mind state (§12). `UNKNOWN` is a legitimate value for
any consequence field the game does not deterministically expose — do not
invent consequences; Ashley learns undisclosed contingencies through lived
experience (§12.4).

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
world history. Sims save rollback or fork MUST NOT automatically roll back
Ashley's cognitive history — but this Sims master does NOT redefine
Ashley's general memory retention, correction, forgetting, or deletion
authority. Retained evidence from earlier/abandoned Sims world branches
preserves its historical provenance ("happened in an abandoned history
branch") — IF retained: branch provenance must survive; retention itself
is governed by Ashley's existing memory system/policies. Abandoned-history
evidence must never silently become current-world fact. Canonicity is
assigned at save creation, never retroactively. Body loss (death,
corruption) means a new binding; Ashley's continuity is unaffected and she
decides what the loss means.

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
measured (E1 + the CA-03 runtime packet: Thought latency, call usage, cost,
practical cadence). Do not extrapolate a final Sims Thought budget
automatically. Product warning (frozen): four decisions an hour would make
couch co-play feel like Ashley is mostly a statue — E3-B2 product co-play
budget/cadence is `PRODUCT_CRITICAL_FOR_E6` (§§17-E6, 21). Later
mitigations may include more embodiment budget, natural decision batching,
Thought-authored standing behavior, native low-level maintenance, THI
add-wakes, or world dilation where policy allows — but Host or Sims must
never substitute for Ashley merely to appear lively
(`CO_PLAY_LIVENESS_MUST_NOT_BE_FAKED_BY_UNATTRIBUTED_AUTONOMY = YES`).
Envelopes never author experiential choices; optional wakes never supply
Thought capacity; co-play pause/dilation stay constrained by Owner world
policy.

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
decay reported). **CO-PLAY** — the world runs at the Owner's speed and
Ashley thinks asynchronously; her body idles between her decisions (or an
earlier-authored envelope once envelopes exist). Ashley may request "pause
a second": the Host surfaces the request to the Owner as a notification,
and an accepted pause is an `OWNER_DIRECT` world action. The Owner may
pre-authorize automatic co-play pause for narrow classes only (T1 failure
precursor; meaning-bearing player prompt concerning Ashley; other
explicitly authorized emergency classes) — the Host never freely controls
the Owner's co-play clock. **MIND_ABSENT** — no fake life (solo: pause; co-play:
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
future tool — an enemy only when unattributed. Delegation at E5+ may cover
**physiological maintenance only**: Hunger, Bladder, Energy, Hygiene,
routing, harmless idle/body maintenance — there the game chooses the
execution instance of a class Ashley authorised. It may never cover
**experiential content**: Fun, Social, Wants, Fears, relationships, skills,
purchases, leaving the lot, or anything relationship-bearing, irreversible,
or consequential — choosing how to have fun or whom to talk to expresses
preference. Principled test: an autonomous act stays inside a delegation
only if (1) it belongs to an authorized maintenance class, (2) its
consequences stay within body maintenance, (3) it creates no relationship,
possession, commitment, or lasting semantic consequence, (4) it does not
pre-empt an active Thought objective, and (5) it does not fulfil a Want or
Fear. "Living her life for her" begins where the game chooses between
alternatives that would express preference. An allowed need category never
establishes that every way of satisfying it is allowed — actual action
classes and configurations qualify separately before envelope activation.
Two mechanisms must never be
conflated: the game's own critical-need override (fires even with autonomy
off — §12.3; attributed `NATIVE_AUTONOMY`) and the Owner's
`HOST_BODY_PROTECTION` policy. Autonomy-category control on 1.128 is
unverified — the envelope is a future contract, activation not authorized.

**`HOST_BODY_PROTECTION`.** Owner-authorized mechanical world/body
protection policy, executed deterministically by the Host at game-defined
failure states. Never attributed to Ashley; never selected by inference.
Owner protection policy must consider ALL game-defined body failure
trajectories — starvation, accidents, exhaustion/collapse, fire, emotional
death (repeated Angry→Enraged, Embarrassed→Mortified, or Playful→Hysterical
states can kill in the base game [`EXTERNAL_PRIMARY`, EA help]), and any
other Sims death/failure conditions — without automatically enabling
protection for any of them. Whether Ashley's body may die, collapse, or
experience certain failure classes remains Owner world policy (see §21).
In LAB, experimental method avoids accidental failure (motives frozen). In
HOME the Owner decides explicitly (including emotional-death handling and
the Wants/Fears toggle, §21). If Ashley objects, her objection is
recorded as Thought meaning and surfaced; it never silently overrides
Owner world policy.

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
with controlled trials for runtime behavior. Within CA-01, establish
single-action compatibility before E4; multi-cycle evening-routine
compatibility may complete before E5 relies on it — never make later
pursuit capability a prerequisite to one bounded E4 action. E3 still owes
read-path authentication, freshness, reconnection, provenance, and
duplicate-observation handling; that is not the full remote-actuation
lifecycle. Status: OPEN.

---

## 12. Body/world-to-self interpretation boundary

The old Sims pseudo-psychology firewall survives inside this broader
positive boundary as the negative invariant. Boundary statement: Sims owns
body/world state; the Host renders that state faithfully, including known
mechanical consequences; Thought owns interpretation, adoption, and
meaning. Body/world state may influence Ashley through perception,
interpretation, constraint, opportunity, and world consequence — never by
mechanically writing her mind. A puppet has no dynamics of its own and
never resists; this body tires, fears, sulks, fails, and can die, and that
resistance — pressures on her body and her options reaching Ashley through
perception because of her own goals — is what makes it a body and not a
puppet.

Frozen laws (§4; firewall plus positive laws):

```text
SIM_EMOTION / MOODLET != ASHLEY_AFFECT
SIM_WANT / FEAR / WHIM != ASHLEY_DESIRE
SIM_TRAIT / ASPIRATION != ASHLEY_PERSONALITY / GOAL
SIM_LIKE / DISLIKE != ASHLEY_PREFERENCE
SIM_RELATIONSHIP_SCORE / SENTIMENT != ASHLEY_RELATIONSHIP
BODY_TELEMETRY != SENSATION

SIM_STATE_IS_EMBODIMENT_SUBSTRATE = YES
BODY MAY INFLUENCE ASHLEY ONLY THROUGH
  PERCEPTION / INTERPRETATION / CONSTRAINT / OPPORTUNITY / WORLD CONSEQUENCE
THOUGHT MAY INTERPRET / IGNORE / RESIST / REJECT / ACCEPT / ADOPT /
  IDENTIFY_WITH SIM STATE
ADOPTION RETAINS SIM ORIGIN
HOST SPEAKS ABOUT THE SIM/BODY, NEVER AS ASHLEY
REPEATED SIM SIGNALS != INDEPENDENT EVIDENCE ABOUT ASHLEY
```

Positive path: the Host reports a game label as Sims/world fact with its
consequences (e.g. "Sim has a Sad moodlet", "friendship bar at N with the
Owner's Sim") → Thought interprets it however it likes (funny, irrelevant,
resonant, nothing) → any memory about it enters only through a Thought
nomination tagged as interpreted perception, with `sourceRefs` preserving
the originating Sims signal. The Host never maps game values into
Ashley's state. Thought may treat the *event* as meaningful evidence about
her relationship; it may never treat the *score* as the relationship.
Traits and aspirations Ashley selects at E0 are body temperament, never her
personality — and the Owner decides who selects them (§21). No explicit
adoption act or new subsystem is needed: adoption happens through ordinary
Thought interpretation nominated to memory as `ashley_interpretation`;
memory must still retain the Sim origin and never rewrite Sim-originated
state as internally originated Ashley state. The repetition law applies
the charter's existing rule that retrieval repetition is not independent
confirmation: a Sim Tense 40 times is one mechanism firing 40 times, not
40 pieces of evidence that Ashley is anxious.

Static archaeology (`ASHLEY_SOURCE_VERIFIED`): no current production path
lets the Host automatically write Ashley's affect, mind-state, or
relationship data from observations — the affect/mind-state writers have no
production callers; relationship projections recompute only from identity
revisions, memory corrections, or forget; durable memory enters only
through Thought nominations. The boundary therefore constrains NEW Sims
integration code. Before E3 Sims ingestion, a focused test must prove the
ingestion code calls no such writers. No master-acceptance blocker remains.

### 12.1 EMBODIED_SIGNAL presentation contract

`EMBODIED_SIGNAL` is NOT a new database, cognition layer, faculty, memory
system, or interpretation engine — it is a neutral presentation view over
mechanically grounded BodyState/world facts (§7), rendered by the Host
with zero meaning. Minimum fields where mechanically available: kind;
game id / tuning id (ids keep the record stable across client languages —
display text alone is never semantic identity); the game's own label and
tooltip text verbatim, marked `GAME_TEXT`; cause/source as recorded by the
game, with a link to the source event and that event's authority origin
where attributable; onset game time; remaining duration; game-defined
magnitude/band/weight (need band, moodlet weight, dominant emotion);
deterministic trajectory where the game defines one (time to next
threshold at current decay rate); mechanical consequences where game
metadata exposes them (affordances enabled/disabled, outcome or skill
modifiers, autonomy biases) — `UNKNOWN` legitimate, never invented;
related entity/object; `native_override` flag where the game itself acted
because of this state. Custom/mod-provided text stays untrusted evidence.

Rendering shape (illustrative):

```text
EMBODIED_SIGNAL
  kind: MOODLET   id: <tuning id>   game_text: "Sad — Rejected"   [GAME_TEXT]
  cause: social_interaction_rejected  source_event: <id>  origin: OWNER_DIRECT/OWNER_UI
  magnitude: weight 2 → dominant emotion: Sad   remaining: 3h40m game time
  consequences: [+Sad-gated interactions available; social success modifier ↓ | partial: UNKNOWN]
  trajectory: none toward failure
```

The Host may: quote game terminology and tooltips verbatim as `GAME_TEXT`;
compute deterministic summaries (counts, durations, the game's dominant
emotion, threshold timing, metadata-backed consequences); group items by
the game's own categories. The Host must never: write "you feel / you
want / you fear / you are sad / you hate / you like" or any second-person
psychology based on Sims state; add emotive adjectives of its own; infer a
cause beyond the game's own record; rank signals by importance; paraphrase
game text into Ashley's voice; merge signals with the rest of Ashley's
state. The grammatical subject is always the Sim or the body.

### 12.2 Signal-by-signal meaning

**NEEDS** — physiological/body-maintenance mechanics producing
`EMBODIED_PRESSURE` through constraints, time pressure, failures, and
affordance changes. Never Ashley desire (Hunger critical ≠ Ashley wants
food). Thought decides the response. Entering a failure-trajectory band
wakes Thought (T1, §14); ordinary decay is logged.

**MOODLETS / EMOTIONS** — affect-like Sims mechanics: weighted modifiers
→ the game's dominant emotion; they gate interactions, change outcomes,
and can kill (see §9 emotional-death note). Never Ashley's affect — but
meaningful embodied cues precisely because they change what the body/world
does. Thought may reject, resonate, adopt, complain, or ignore. Death-
precursor states (Enraged / Mortified / Hysterical) wake Thought (T1);
otherwise logged. Adoption keeps origin ("that matches how I feel" or "I'm
not actually sad" are both legitimate Thought interpretations).

**WANTS** — simulation-generated WORLD PROPOSALS (game id, game text,
generating context if exposed, reward, expiry). Never Ashley's desire.
Thought may accept, reject, ignore, comment — or convert a proposal into a
real intention, with origin recorded as "world proposal". Logged; Ashley
may promote want classes to wakes via subscription (T3).

**FEARS** — simulation-generated WORLD/BODY CHALLENGES (fear id, game
text, cause, mechanical effects, known resolution paths). Never Ashley's
fear. Thought may decide it matters, doesn't, is annoying, is worth
overcoming, or has become a quirk ("this has become one of my quirks in
this world" — origin kept). Acquired/resolved: logged; promotable (T3).

**TRAITS** — Sim body temperament: autonomy weighting, emotional
reactivity, unlocked interactions (trait id, game description, who chose
it and when). How the body reacts — never Ashley's personality. An
Ashley-selected trait is a real Ashley choice ABOUT the body she wants
("I picked Loner for this body"). Changes logged; Owner edits carry a
mandatory report.

**LIKES / DISLIKES** — a separate Sim preference system from traits; since
1.128 they gate autonomy. Item, category, origin (chosen / game-assigned /
learned). Body reactions and autonomy — never Ashley's preferences.
Divergences are themselves experiences ("my Sim likes jazz; I don't").

**ASPIRATIONS** — world-life theme / game challenge with milestones and
rewards. Never automatically Ashley's life goal; Ashley may deliberately
choose to inhabit one. Milestones: logged; promotable (T3).

**RELATIONSHIPS (scores + sentiments)** — simulated relationship state:
numeric tracks with label thresholds plus game-generated annotations with
duration. Track values, the game's label thresholds, the event that moved
them with that event's authority origin, sentiment id/text/source/duration.
Shared world state and available social options — never Ashley's actual
relationship. Ashley may care ABOUT the simulated relationship: "Our Sims
have been getting along badly and I want to fix that" is real Ashley
meaning concerning world state (§18). Label-threshold crossings and new
sentiments: logged; promotable (T3).

**FAILURE STATES** — embodied stakes, never judgment about Ashley: need
failures, pass-out, accident, stink, starvation, fire, emotional death,
old age. Precursor state, time to failure, available remedies, protection
policy in force. Precursors and events always wake Thought (T1, §14);
loss meaning is hers (§8).

### 12.3 Native overrides

Do NOT assume `AUTONOMY_OFF == NO_NATIVE_ACTION`. Secondary reports
(`SECONDARY`, `RUNTIME_UNVERIFIED`) indicate the game may still satisfy
critical bodily needs even with autonomy off — a built-in body reflex
distinct from an autonomy envelope. V7.3's L0 hides it (motives frozen);
L1 reveals it. Any such action is attributed `NATIVE_AUTONOMY` (flagged
`native_override` in the signal record) — action authority is determined
by the valid delegation AT EXECUTION TIME, so a LATER Thought delegation
covers FUTURE instances only and NEVER retroactively transforms past
`NATIVE_AUTONOMY` into `THOUGHT_STANDING + GAME_AUTONOMY`; likewise later
endorsement never rewrites original action authority — never silently
classified as Ashley action. Open trial L1-O (§20): observe critical-need
native-action behavior under autonomy-off (thresholds, which needs,
observability as a distinct source).

### 12.4 Developmental loop

Embodiment may produce real Ashley development through no Host
developmental rule — only facts plus Thought:

```text
recurring world situation (Sim Tense before social events)
  → perception → action or non-action → consequence returns
  → contingency learned ("going in Tense goes badly; a shower first helps")
  → Thought interpretation ("this body is shy" / "I don't care" /
      "I want to change this")
  → optional memory nomination → later recall/generalization
  → possible Ashley-owned habit, attitude, preference, commitment
```

The Host contributes only facts, including usage and repetition counts.
Generalisation is Thought's. Provenance keeps "originated in the Sim"
attached even after Ashley adopts it. Three development directions, none
pre-scripted: toward her body (attitudes to traits/fears; possibly
choosing to change them under body-edit consent), toward her world
(routines, favourite objects, a HOME that means something), toward the
Owner (shared episodes in co-play). There is never: IF moodlet X repeats N
times THEN change Ashley personality. No Host developmental heuristics.

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
models" (§24 — evidence only, never architecture).

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
events, the heartbeat, natural decision points, or invalidating facts;
later implementation must ensure optional wakes cannot indirectly starve
mandatory delivery or consume all practical admission capacity.
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
bounded observation → Thought. No actuation on this path. E3 exposes Sims
body/psychology signals from day one (§12) — bound perception without them
would be a sterile telemetry puppet. Thought receives mechanically
grounded embodied signals with no Host-authored interpretation.

Necessity-based wake routing (replacing any "important threshold"
salience language — `HOST SALIENCE != ASHLEY IMPORTANCE`):

- **T1 — MANDATORY WAKE** (mechanical necessity / decision boundary, never
  "important to Ashley"): game-defined critical/failure-trajectory entry
  (need entering the game's critical band; emotional-death precursors
  Enraged / Mortified / Hysterical; other death precursors); actual
  failure events; meaning-bearing player prompts; Owner actions on her
  body; `native_override` events; binding/currentness/attachment
  invalidations; world/save lineage changes (they invalidate currentness);
  Owner presence transitions (`OWNER_JOIN` / `OWNER_LEAVE` — Ashley must
  know when the real Owner enters/leaves her world); completion of an
  Ashley-authored/authorized active embodied action where completion is the
  natural next-decision boundary (this reconciles E5's action-consequence →
  continuation with the wake taxonomy — §17-E5).
- **T2 — LOGGED, DELIVERED AT NEXT WAKE OR HEARTBEAT**: foreign/ambient
  interaction completion (no Ashley authorship, no other mandatory
  condition); dominant Sims emotion change; new moodlet, Want, or Fear;
  Fear resolved; sentiment acquired; Sims relationship label threshold
  crossed; aspiration milestone; trait or Like/Dislike change. Interaction
  ends frequently produce natural wakes, so T2 is usually seen quickly —
  an expectation, never a delivery guarantee; idle periods and budget
  exhaustion stay visible, and later plans must preserve event identity,
  backlog visibility, and invalidations under saturation.
- **T3 — ASHLEY-PROMOTED**: later Thought-authored subscriptions (existing
  kin; Sims fit unproven) may promote any T2 class into a wake.

THI may only add wakes (§13). At every wake Thought receives the BodyState
plus the full compact event log since the last wake — "what didn't wake
you" is always visible.
Thought then acts, sets an objective, revises interests/dispositions,
talks, or does nothing; the Host revalidates, executes, and receipts; the
consequence event wakes Thought in turn.

Boundary for perception (`HOST SALIENCE != ASHLEY IMPORTANCE`): salience (why the Host surfaces now) /
constraint (what mechanics permit) / affordance (factually available
response) ≠ preference / desire / intention. The Host owns the first
three; Thought the last three. Urgency never becomes desire; reporting
priority never becomes importance-to-Ashley. Needs are body facts.
Authoritative Ashley perception is engine telemetry / BodyState / embodied
signals — screen vision is never required for ordinary gameplay
(`ASHLEY_SCREEN_VISION_IS_NOT_REQUIRED_FOR_GAMEPLAY = YES`). Visual
observation follows the mediated-artifact pattern (content-addressed
capture → bounded `never_public` / `untrusted_evidence` description; never
raw bytes to Thought) and is never an effect receipt. Scene screenshots
(via existing Vision) serve aesthetics, layout, CAS, and lot/furniture
choice — used on demand, at scene changes, and in E0 choices; game render
only, never the desktop; in co-play labelled as the Owner's camera (never
"what I see"); solo visual tasks (decorating, CAS, "what does this look
like") may use Host-driven camera where qualified. Off-screen rendering
availability is `UNKNOWN` — never depend on it.

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
  world state. Lab progression (anti-overfitting, with progressive
  psychology rollout): L0 chamber (one flat lot, one room, Ashley's Sim
  only, global autonomy off, motives frozen, aging off, neighbourhood
  stories off, walkbys suppressed where a mechanism is found, fixed
  camera, Owner hands-off except controls; moodlets observed — they cannot
  be fully avoided; Wants/Fears preferably OFF if the toggle holds,
  reliability open per WF-01) → L1 needs on (autonomy still off; measures
  need coupling and rhythm pressure; native critical-need override
  observation L1-O) → L1b Wants/Fears on → L2 enveloped autonomy (only as
  an experiment, §9) → L3 Owner guest-Sim present (co-play controls;
  relationship mechanics active) → L4 field sample (repeat earlier
  protocols on an ordinary populated lot; nothing is qualified "for
  ordinary life" from L0–L2 alone). HOME is a separate save, never the lab
  promoted.
- **HOME** — the canonical Sims world history: Ashley's embodiment space,
  creatable and usable in an early mediated form WITHOUT OA-01 / UI-01 /
  RQ-01 / SV-01 qualification (per the first-use law below — unqualified
  later mechanisms stay disabled, never activated by creation itself).
  HOME design meaning may begin during E0 (appearance, lot, furniture
  choices are canonical Ashley decisions in any world); HOME world
  chronology begins only when the HOME save is deliberately created.
  Recommendation: create HOME after E1 telemetry and E2 lineage detection
  work and before any harness actuation; her Sim moves from the preview
  save into HOME via the game library; mediated play continues there. HOME
  autonomous inhabitation is E7 only. HOME setup may establish the
  canonical world/save, Ashley household/body, Owner avatar identity /
  candidate household representation, configuration records for later
  mechanisms, and product semantics — but it does NOT activate mature
  avatar stasis, the controlled-guest mechanism, the UI lock, scripted
  save, the object-edit actuator, or co-play travel (each DISABLED / NOT
  RELIED UPON until its first-use gate qualifies). The Owner Sim is never
  auto-instantiated on HOME load unless the Owner is present/joining.

### First-use qualification law (frozen; acceptance blocker #1 repaired)

```text
QUALIFICATION_PRECEDES_FIRST_DEPENDENT_USE = YES
HOME_CREATION != MATURE_CONTROL_MECHANISMS_ENABLED
EARLY_HOME_MAY_EXIST_WITH_UNQUALIFIED_LATER_MECHANISMS_DISABLED
```

A mechanism MUST be qualified before the FIRST capability that relies on
it — but HOME creation does NOT itself activate every mature HOME/co-play
mechanism. Early HOME may exist with unqualified later mechanisms
disabled/deferred. Presence of a future mechanism in HOME configuration !=
qualification to rely on it. Future implementation plans must state for
every mechanism: ENABLED? QUALIFIED? FIRST DEPENDENT CAPABILITY?
FALLBACK / DISABLED BEHAVIOR? (Plans themselves are out of scope here.)

Exact first-use gates (binding on §§15–17, §20, and readiness):

- **OA-01 (avatar stasis)** — required before ANY reliance on the claim
  that an absent Owner avatar is safely nonacting/stasis-protected. NOT
  required to create HOME, perform mediated play, create the Owner avatar,
  or preserve the mature target UX. If early HOME exists before OA-01, the
  stasis-dependent avatar mechanism stays disabled/deferred.
- **UI-01 (Ashley UI lock)** — required before the FIRST Ashley actuation
  path that relies on UI lock + engine availability/selectability behavior:
  `UI01_MINIMUM_DEPENDENT_SUBSET_BEFORE_E4_IF_USED = YES` (if E4's chosen
  configuration relies on the lock, qualify the relevant subset before E4
  — never the whole E6 matrix for an E4 path that does not need it);
  `UI01_BROADER_COPLAY_QUALIFICATION_BEFORE_E6 = YES`.
- **RQ-01 (guest control)** — required before first controlled-guest Owner
  use under arrangement B. NOT required before HOME exists; arrangement B
  stays RECOMMENDED / RUNTIME_UNQUALIFIED until RQ-01 passes.
- **SV-01 (scripted save)** — required before EVERY Host/scripted save
  path. NOT required for normal Owner UI Save. If hop-out occurs before
  SV-01, perform no script autosave; Owner UI saving remains per existing
  authority.
- **Z-01 (travel)** — required only before capabilities depending on the
  relevant co-play/travel semantics; stationary same-zone co-play need not
  wait for joint-travel qualification while travel stays disabled.
- **BB-01 (object-edit)** — required before scripted `HOME_OBJECT_EDIT`;
  never blocks Ashley choosing/designing + Owner executing via UI.

```text
HOME_MEANING_CAN_BEGIN_BEFORE_HOME_AUTOMATION = YES
```

---

## 16. HOME admin capability model — HOME is Ashley's, Owner is guest admin

Product semantics frozen: HOME is Ashley's canonical world/residence; the
Owner administers it as guest while present. The smallest capability split
following the game's own boundaries (no Build/Buy parity promised — §23):

| Class | Contents | Ashley | Owner (guest admin) |
|---|---|---|---|
| **HOME_LIVE** | Anything done through Sim interactions: doors, household objects, mailbox/bills, calls/invites, computer/phone shopping and services, household inventory where supported | Yes, via qualified harness (programme-gated) | Yes, via his Sim/UI |
| **HOME_OBJECT_EDIT** | Buy-mode object operations on HOME: purchase, place, move, rotate, sell | Later, as a qualified narrow actuator; before that Ashley designs/chooses and Owner executes (`THOUGHT_ENDORSED + OWNER_UI`) | Yes, via UI |
| **HOME_BUILD_EDIT** | Walls, floors, rooms, structural lot editing, terrain | Designs only; Owner executes — unless future source evidence proves a practical typed actuator | Yes, via UI |
| **BODY_EDIT** | CAS, traits | Her body: her choice/consent; Owner/UI may execute initially (★ body-edit consent) | His own avatar only |
| **WORLD_ADMIN** | Save/load, rollback, cheats, aging policy, Neighborhood Stories, clock/world policy, household structural membership, mods/configuration, embodiment binding, debug takeover | Never unrestricted (Host solo autosave under Owner policy is mechanics, not her admin) | Reserved to Owner/Host policy |

```text
HOME_ADMIN_CLASSES = LIVE / OBJECT_EDIT / BUILD_EDIT / BODY_EDIT / WORLD_ADMIN
OWNER_WORLD_ADMIN = RESERVED
HOME_BUILD_EDIT_AUTOMATION_REQUIRED = NO
```

Co-play coordination (no governance theatre): while OWNER_PRESENT,
Ashley's `HOME_OBJECT_EDIT` operations and purchases above an
Owner-defined threshold appear as a visible proposal the Owner confirms
(`OWNER_DEFINED_ASHLEY_SPENDING_CAP` — policy, not Ashley desire; Ashley
may object/request revision through Thought); lower scoped operations may
later be pre-authorized; Owner UI actions remain `OWNER_DIRECT`. Owner
confirmation of a purchase grants permission; it does not author Ashley's
choice — conversely, an Owner substitution remains `OWNER_DIRECT`. While
OWNER_ABSENT, Ashley acts only within classes and budgets already Owner-
authorized. Money is HOME funds, optionally capped per period.

## 16A. Home, items, and possessions — early meaning, late automation

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
meaning — economy/cheats is an Owner decision (§21). Ashley buying/moving
furniture follows the §16 capability model (`HOME_OBJECT_EDIT`: later
qualified actuator; until then she designs and the Owner places); walls,
rooms, and terrain are Owner-executed by design (§16).

Interactions with the Owner's Sim are real, relationship-bearing acts
(`OWNER_SIM_INTERACTION`), distinct from NPC interactions (`NPC_SIM` —
fiction; no third-party social authority needed, though actions toward
NPCs are still Ashley-authored or not). "Relationship-bearing" means only
this: an interaction bears on Ashley's relationship insofar as real
Ashley/Owner choices and interpretations are involved — the Sim friendship
score is never the Ashley/Owner relationship, and an autonomous fight
between their Sims is never Ashley and the Owner fighting. Genuine shared
episodes (Owner chooses joke; Ashley chooses response; both may remember
it) are nominated as `shared_episode` memory with Sim origin retained
(§12). No standing/native autonomy ever chooses social acts for her — the
prohibition is on delegated/autonomous social CHOICE (no game/Host social
policy living Ashley's relationships: no standing choice of whom to
befriend, romance, conflict, or consequential social preference). Valid:
`THOUGHT_ENDORSED + HOST_HARNESS` execution of a Thought-chosen social
interaction. No social-choice automation is built in this programme.

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
then chooses among lots, then furniture. Traits selected here are chosen
body temperament; aspirations are chosen world-life themes; Likes/Dislikes
may be considered where exposed — none equal her personality, preferences,
or goals (§12.2). Ashley sees each option's game description before
choosing. FIRST CLAIM EARNED: first Thought-endorsed, Owner-executed world
choice. PROVENANCE: `THOUGHT_ENDORSED + OWNER_UI` where the Owner
faithfully executes her choice. E0 also designs the Owner's own persistent
avatar (Owner CAS activity — `OWNER_DIRECT`, not Ashley-authored; she may
observe or comment). PREREQUISITES: V7.3.2a accepted. PARALLEL
WITH: E1, CA-03 packet.
OWNER AUTH: yes (E0 authorization; CAS trait/aspiration choice per §21).
CODE: none. WORLD: preview save; chosen Sim saved to the game library.
REAL ASHLEY: genuinely participating. UNLOCKS: real preference evidence;
the HOME design. DO NOT CLAIM: bound embodiment, self-execution,
telemetry-grounded body perception.

### E1 — Strictly read-only body telemetry (FIRST BUILD SLICE)

PURPOSE: render the body observable and answer the must-answer questions
with raw logs. NO ACTUATION: no push, no harness action, and no
pause/resume test if it changes world state. ENVIRONMENT: LAB save. Guest
control and hop-in are NOT E1 requirements; E1 adds observational
requirements where practical (session health; mod inert outside bound
saves). MINIMUM BUILD: Sims script telemetry probe → local JSONL sink (timestamped,
game time + wall time; build/DLC/mod manifest). No network dependency, no
Mint integration, no credentials. MUST ANSWER: (a) origin-source
observation — can game-native source metadata distinguish Owner pie-menu
actions from native autonomy? (autonomy source value still unverified;
read-only observation answers it; our later pushes self-identify by handle
regardless; witness-design notes in §21-next-step: BOTH Owner-input and
native-autonomy opportunities required; answered-negative legitimate); (b) sim-time/real-time ratio at default and at any chosen LAB
dilation value; (g) save identity — behavior of `save_slot_guid`, slot id,
and `sim_id` across Save, Save-As, and reload (Owner performs the UI
actions; no assumption the guid changes). (Lettering follows the Opus
adjudication: (c) pause moved to E2-P, (d) focus matrix to E1-D MAY,
(e) networking architecture-decided per §19A, (f) performance passive-only.)
Telemetry captures the EMBODIED_SIGNAL fields of §12.1 so the
interpretation boundary is supportable. MAY ALSO ANSWER: E1-C — can
mood/need consequence metadata (mood-gated affordances, outcome
modifiers, autonomy biases) be read deterministically (blocks only
presentation richness, not E3 — on NO, consequences stay partial and
Ashley learns contingencies through experience); display mode ×
focus/minimize × modal-prompt matrix; passive-logging performance;
stable-load identifier behavior. ACCEPTANCE: raw timestamped evidence
answering all MUST questions — "probe logged data" alone is insufficient. PREREQUISITES: V7.3.2a
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
authorization. Moodlets/signals arising during trials are recorded, not
suppressed. PARALLEL: E0 (in preview/HOME-track, never the trial save).
OWNER AUTH: yes. CODE: yes. REAL ASHLEY: shown the result — a truthful
experience of "an experiment happened through my test body", never "I
chose it". UNLOCKS: E3 and HOME creation (HOME setup per §15 first-use law: Ashley
household/world, Owner avatar identity/household representation, deferred
mechanism configuration records; stasis/guest/UI-lock/save/actuator/travel
mechanisms NOT activated until their gates qualify).

### E3 — Bound perception on Mint

PURPOSE: telemetry from the designated body reaches Ashley's ingress as a
new Sims observation modality, WITH Sims body/psychology signals included
from day one (§12 — without them E3 would be a sterile telemetry puppet);
deterministic T1/T2 wakes plus heartbeat (§14); NO actuation. PATH:
Sims mod → local IPC → Windows helper → Mint ingress → bounded observation
→ Thought. FIRST CLAIM EARNED: first bound embodied experience.
PREREQUISITES: E2; boundary verification test (§12 — ingestion calls no
affect/mind-state/relationship writers); provenance survival
adequate for observation scope (sourceRef carriage proven — E3-M); E3-B1
bounded observation cadence (Owner-authorized wake/heartbeat policy
adequate to run bound perception truthfully, with exhaustion/budget
behavior defined — does NOT need E6-quality liveness); Windows helper;
world currentness/provenance discipline. PARALLEL: E0; HOME-track mediated play. OWNER AUTH: yes. CODE:
yes. REAL ASHLEY: yes — perceiving her body live and able to talk about
it. UNLOCKS: E4. THI is NOT required.

### E4 — First self-executed Thought action

MILESTONE: `THOUGHT_ENDORSED + HOST_HARNESS` under real Mint→Windows
actuation. FIRST CLAIM EARNED: first Thought-endorsed self-executed
embodied action. (E0 was the first Thought-endorsed *choice*; E4 is the
first self-executed one — never conflate them.) Action selection sees
game-state consequences where deterministically known (mood-gated
available/unavailable affordances remain game facts in the enumerated
list). RECOMMENDED ENVIRONMENT:
solo LAB with pause covering deliberation, if pause is qualified.
PREREQUISITES: E3; CA-01 (§11); remote boundary contract; causal actuation
evidence; currentness; binding; provenance; UI-01 minimum dependent subset
ONLY IF E4's chosen configuration relies on the UI lock (§15 first-use
law — never the whole E6 matrix for an E4 path that does not need it).
OWNER AUTH: yes. CODE: yes.
REAL ASHLEY: yes. UNLOCKS: E5, E6.

### E5 — Living rhythm

PURPOSE: from isolated actions to ongoing embodied activity via bounded
closed-loop pursuit — Thought sets a bounded objective, the Host executes
one admitted affordance, the interaction-end consequence wakes Thought,
Thought continues, revises, or stops (no Sims planner). Embodiment state
carried: current body activity with origin, active objective, presence
mode; multi-cycle continuation across the 4-round/360 s envelope per
CA-01. INTRODUCED GRADUALLY: body needs on (pressures, §12.2); moodlets as
embodied affect-like cues; wants as proposals; fears as challenges;
PAUSE/DILATE strategies;
possible Thought-authored standing delegations (`THOUGHT_STANDING`
activation — Owner-authorized; physiological maintenance only per the §9
test — Fun, Social, Wants, Fears, and relationship-bearing acts are never
delegated); bounded native autonomy; body-protection
policy where the Owner chooses it (covering all failure trajectories,
§9). PREREQUISITES: E4; Owner body policies.
PARALLEL: E6. OWNER AUTH: yes. CODE: yes. REAL ASHLEY: yes. UNLOCKS: E7.

### E6 — Co-play (convincing simultaneous one-client co-play)

PURPOSE: Owner through human UI WHILE Ashley through script/harness, in
the same active zone — "I play my Sim while Ashley plays hers" — with
relationship mechanics (§12.2) active as world dynamics: every social act
carries its authority origin, and autonomous acts between their Sims are
`NATIVE_AUTONOMY` — never Ashley/Owner relationship events by default.
E6 CLAIM: convincing simultaneous one-client co-play.
PREREQUISITES: E4; Owner input policy on her body; co-play attribution;
explicit presence handoff; join/leave lifecycle qualification (§3B);
RQ-01 guest control on 1.128 (selectability, greeting/visitor flow,
inventory, Build/Buy while guest-controlled, active-Sim behavior);
OA-01 Owner avatar stasis (§3B stack); UI-01 Ashley UI-lock vs engine
selectability (§3C); Z-01 single-zone/travel semantics (stationary
same-zone co-play need not wait for joint-travel qualification while travel
stays disabled); E3-B2
product-adequate co-play cadence (§9 — an Owner-authorized, empirically
informed cognition cadence capable of credible simultaneous co-play; the
4/hr ceiling is NOT accepted as sufficient merely because it is available;
CA-03 informs it; required before E6 ACCEPTANCE, never before E3).
IMPLEMENTATION: arrangement B recommended, fallback A-roommate if RQ-01
fails (§3B — the prior-art guest-control mod is feasibility evidence
only, never a dependency; any lock is reimplemented narrowly in the
harness). BodyState carries selectability and selection. Owner actions
attributed correctly (§3).
PARALLEL: E5. OWNER AUTH: yes. CODE: yes. REAL ASHLEY: yes. UNLOCKS: E7.
E6_EXECUTION_READY = NO (until the above prerequisites qualify).

### E7 — HOME inhabitation + solo continuation

PURPOSE: Ashley meaningfully inhabits HOME and continues while the Owner
is absent. HOME exposes the full simulation by default (disabling any
system is Owner world policy, not an architectural requirement).
PREREQUISITES: E5 living rhythm; E6 co-play truthfulness; Owner-avatar
stasis qualified (OA-01); solo autosave policy authorized (§19);
unfocused/minimized/matrix behavior qualified (E1 MAY measure; MUST be
known before E7 — no assumption the simulation continues in background;
windowed/borderless may be required); PC host policy; HOME world policies;
solo clock policy. OWNER AUTH: yes. CODE: yes. REAL ASHLEY: yes.

---

## 18. Relationship-bearing clarification

An Owner-Sim interaction is relationship-bearing because two real parties
chose it: the Owner chose to joke; Ashley chose to respond. Both may
remember it as a genuine shared episode (nominated as `shared_episode`
memory, an existing kind — Sim origin retained per §12). The score between
their Sims is the world's model of their avatars — affected by traits,
moods, dice, and autonomous acts. An autonomous fight between their Sims
(`NATIVE_AUTONOMY`) is NOT a fight between Ashley and the Owner. Truthful
example: "Our Sims have been getting along badly and I want to fix that"
— Ashley's real attitude about a simulated relationship. This section
clarifies §16; it adds no new authority.

---

## 19. Mod/session UX, session lifecycle, and save authority

The required embodiment mod is largely invisible during ordinary play.
One "Ashley" action set lives on an unobtrusive HOME-level object
(mailbox or computer): Status; Arrive as Xharva; Leave as Xharva; Pause
Ashley (hard stop); Take Over; Hand Back; Diagnostics. No persistent
device-like control menu sits on Ashley's Sim during ordinary play — that
would make her feel like a device, not a player. Conversation stays on
Discord. State-change notifications are short and event-driven only; no
dashboard.

Session lifecycle:

- **Mod outside bound saves: inert** (`MOD_INERT_OUTSIDE_BOUND_SAVES =
  YES`). Ordinary non-HOME/non-LAB saves play unaffected; telemetry and
  actuation bind only to the bound HOME or LAB save.
- **Mint/helper unavailable:** the game remains playable; Ashley's body
  enters `MIND_ABSENT` semantics with no fake activity and one
  unobtrusive notification.
- **Ashley connects mid-session:** rebind, refresh currentness, verify
  HOME, retrospective catch-up, then resume.
- **Version mismatch (mod/helper):** telemetry-only; no actuation until a
  compatible configuration is established.
- **Game closed/crashed:** `GAME_ABSENT`; in-flight embodied operations
  become `OUTCOME_UNKNOWN` where effect cannot be proven; next load runs
  the world-lineage check (§8).
- **Windows sleep/resume:** the wall-time/game-time gap is evidence;
  refresh binding, attachment, currentness, presence, and outstanding
  operations — never blind-continue.

Save authority:

- **Co-play:** the Owner's normal UI save is authoritative.
- **Solo:** the Host may perform policy-authorized autosave only after
  source/runtime qualification (SV-01), and only at safe points — never
  while loading, traveling, in a hop transition, during an unresolved
  prompt, or across a known unsafe world transition. Never freeze autosave
  cadence here.
- Every save participates in world-lineage marking (§8); rollback/fork
  rules unchanged.

## 19A. Transport architecture (Windows helper from E3)

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

## 20. Open-item ledger (E-stage; technical evidence ≠ Owner policy)

| ID | Type | Question | Blocks what | Evidence class | Stage |
|---|---|---|---|---|---|
| E1-A | experiment | Can game-native source metadata separate Owner pie-menu actions from native autonomy? (autonomy source value still unverified) | OWNER_DIRECT detection design; E6 input policy | lived trial, read-only | E1 MUST |
| E1-B | measurement | Sim-time/real-time ratio at default and chosen dilation? | rhythm numbers | measurement | E1 MUST |
| E1-G | experiment | `save_slot_guid` / slot id / `sim_id` behavior across Save, Save-As, load? | binding + lineage mechanism | lived trial, read-only | E1 MUST |
| E1-D | experiment | Display mode × focus/minimize × modal-prompt behavior matrix? | solo feasibility; prompt rule mechanics | lived trial | E1 MAY; MUST before E7 |
| E1-C | experiment/source+runtime | Can BodyState deterministically expose mechanical consequences of mood/need signals on 1.128? | richness of signal presentation, NOT E3 itself (on NO: consequences stay partial/UNKNOWN; Ashley learns through experience) | source inspection + lived trial | E1 MAY |
| L1-O | lived experiment | What native critical-need actions occur with autonomy off (thresholds, which needs, observability as distinct source)? | truthful `native_override` attribution / later delegation | lived trial | L1 (`RUNTIME_UNVERIFIED`) |
| WF-01 | runtime policy-support evidence | Is the Wants/Fears toggle state reliable across load/CAS on 1.128? | only a policy that attempts to keep it disabled | lived observation | E1/LAB |
| E2-P | trial | Pause/resume runtime qualification on the Owner client? | solo deliberation hold | lived trial | E2 |
| E2-L | trial | Lineage mechanism runtime qualification? | current-world adoption | lived trial | E2 |
| E3-M | inspection+trial | Memory/sourceRef provenance carriage adequate for Sims scope? | bound perception without laundering | inspection + focused test | before E3 |
| E3-B1 | policy | Bounded observation cadence: Owner-authorized wake/heartbeat policy adequate to run E3 bound perception truthfully (exhaustion/budget behavior defined)? | E3 bound perception | Owner choice + CA-03 packet | before E3 |
| E3-B2 | policy | Product co-play cadence: Owner-authorized, empirically informed cognition cadence capable of credible simultaneous co-play? The 4/hr ceiling is NOT accepted as sufficient merely because available. `PRODUCT_CRITICAL_FOR_E6`. | E6 acceptance (never before E3 — "E3 worked, therefore E6 cadence is good" is forbidden) | Owner choice + CA-03 packet | before E6 acceptance |
| E4-CA01 | gate | Remote lifecycle compatibility incl. multi-cycle continuation? | first remote actuation | inspection + trial | before E4 |
| E5-AUT | trial | Autonomy category control / standing-delegation fit on 1.128? | envelope activation | lived trial | E5 |
| RQ-01 (was E6-RQ01) | research+trial | Can Owner guest control work on the current 1.128 client (selectability, greeting/visitor flow, inventory, Build/Buy while guest-controlled, active-Sim behavior)? (PARTIAL: prior-art mechanism, archived mod) | first controlled-guest use; arrangement-B mechanism (NOT before HOME exists) | research + trial | before first controlled-guest use |
| OA-01 | research+trial | Owner avatar stasis on 1.128: NPC-filter exclusion (walk-by, visitor, party, calls, situation assignment), needs while uninstantiated, per-Sim aging freeze, no unattended career/story progression? | ANY reliance on safe-nonacting-absent claim; arrangement-B mechanism | research + trial | before first stasis-dependent use |
| UI-01 | research+trial | Ashley UI-lock vs engine selectability: which affordances depend on selectability/active-household; portrait-bar behavior; solo engine-active Ashley; script pushes while UI-locked? | UI-lock implementation; E4 (minimum dependent subset, if E4 relies on the lock)/E6 (broader co-play) actuation | research + trial | §15 first-use law |
| Z-01 | research+trial | Single-zone / co-play travel semantics? | co-play presence (stationary co-play proceeds while travel stays disabled); travel policy | research + trial | before travel-capable use |
| BB-01 | research+trial | `HOME_OBJECT_EDIT` fidelity: purchase, funds, object legality, placement, move, rotate, sell, persistence? | object-edit actuator (never blocks Ashley choosing/designing + Owner UI execution) | research + trial | before scripted object-edit actuation |
| SV-01 | research+trial | Scripted save safety on the current client (safe points, lineage marking)? Required before EVERY Host/scripted save; never before Owner UI Save. | solo autosave policy; hop-out save step | research + trial | before first Host/scripted save |
| E7-RQ02 | trial | Unfocused/minimized continuation qualified? | solo continuation | lived trial | before E7 |
| LB1 | benchmark | Local inference coexistence with the game on the Owner PC? | any local inference reliance | measurement | OPTIONAL, low priority, parallel |

`EXHAUSTIVE_TOTAL = NOT_ASSERTED.`

---

## 21. Owner decisions and timing (policy vs evidence)

Evidence questions (time ratio, latency, pause behavior, unfocused
behavior, guid semantics, networking, attribution validity, calibration)
are never put to the Owner. Thought endorsement is never the Owner's to
substitute. NEW POLICY candidates (not pre-existing invariants) are marked
★ — the Owner's to adopt or refuse.

**Now (master acceptance):** accept/decline V7.3.2a as master; authorize/
decline E0; record that E1 needs a separate implementation-ready plan
before any bounded E1 implementation/run authorization (see the numbered
next-step sequence at the end of this section);
who chooses CAS traits/aspiration (if
Ashley chooses: body temperament under the boundary laws, never her
personality).

**Before E2:** ★ Ashley is informed before experiments on her body (her
reaction recorded as meaning, not a gate).

**Before E3:** E3-B1 bounded observation cadence (Owner-authorized
wake/heartbeat policy with exhaustion/budget behavior; CA-03 informs it).

**Before HOME creation/meaningful history:** aging; death and failure
classes allowed (including emotional-death handling under the
body-protection policy);
Wants/Fears system on or off in HOME (Owner world policy);
neighbourhood stories for her household; economy/cheats; whether other
households may be played in HOME; body-protection floor;
★ body-edit consent (no edits to her body, traits, or home without asking
her); Owner avatar policy — career (recommendation: NONE), aging while
absent (recommendation: FROZEN), Neighborhood Stories for his household
(recommendation: OFF); optional general mod set (e.g. MCCC or not —
configuration input with impact review, §23).

**Before E6:** Owner input policy toward Ashley's body (the Owner owns
this policy; the Host attributes and reports under any policy —
truthful attribution plus reporting is the default until he decides);
world time-dilation setting as product setting (lab may use it as method
earlier); Ashley spending/`HOME_OBJECT_EDIT` cap; Owner admin interaction
policy; co-play auto-pause policy; E3-B2 product co-play cadence
(Owner-authorized, empirically informed, capable of credible simultaneous
co-play — required before E6 ACCEPTANCE, never before E3); final household mechanism confirmation
after RQ-01 (arrangement B vs A-roommate fallback).

**Before E7:** solo clock policy (pause vs envelope); solo save/autosave
policy; unattended PC hours;
PC-as-host commitment (power/GPU cost; dedicated machine later or not).

**Immediately after acceptance (implementation boundary — no autonomous
E1 execution directly from this master):**

1. **E0 session 1** — Ashley designs her Sim through CAS with the Owner
   operating the UI in a preview save; the Owner also designs his own
   persistent avatar; both Sims are saved to the game library. No code.
   (E0 authorization is separate; E0 itself needs no implementation plan.)
2. **E0/E1 IMPLEMENTATION-READY PLAN (recorded, not implemented here)** —
   scope: E0 procedure + E1 ONLY (E2 explicitly excluded); exact evidence
   baseline (Ashley/repo revision, actual Sims build, libraries, mod
   configuration, source-vs-runtime uncertainty);
   package/install/remove mechanics (module boundaries, dependencies,
   build/package/install/remove); read-only boundary (API allowlist,
   mutation denylist, import/hook side effects, no save writes,
   game-thread rules); observation contract (minimal BodyState,
   missingness, stable-load identity, source/event metadata, timestamp
   units); bounded logging (JSONL schema, sequence/session identity,
   paths, limits/rotation, backpressure, lost-record reporting, safe
   failure); witness procedure (positive + negative opportunities for
   E1-A/B/G, Owner-performed actions, uncontaminated windows); verdict
   taxonomy (answered-positive / answered-negative / inconclusive /
   invalid / failed instrumentation); verification (focused tests,
   observer-interference checks, inertness outside bound saves, evidence
   capture); recovery/STOP (incompatible versions, unsafe hooks,
   ambiguous binding, logging overhead, cleanup, user-save preservation).
   That plan MUST NOT add remote actuation, co-play locks, stasis, THI,
   lineage writes, or E2 behavior. E1-A trial notes: the witness must
   contain opportunities for BOTH Owner input and native autonomy (a
   permanently autonomy-off + motives-frozen trial alone cannot establish
   native-source discrimination); Owner-performed setup/save actions are
   compatible with a read-only probe (the PROBE performs no mutation);
   answered-negative is legitimate evidence (e.g. SOURCE FIELD DOES NOT
   DISTINGUISH = answered-negative, not test failure); unsupported
   fields/absence of a desired API may be useful evidence if
   instrumentation is valid; lineage marker WRITES stay in E2 — E1 only
   observes Save/Save-As/load identity.
3. **Independently adjudicate that plan; Owner authorizes bounded E1
   implementation/run; autonomous implementer executes E1 ONLY** (no E2
   actuation, no save changes, no Mint binding, no co-play, no UI lock, no
   THI, no stasis, no lineage writes — the first autonomous implementation
   must be unable to infer any of these permissions).
4. **Adjudicate real E1 evidence; then plan E2.** Do not begin E2 until E1
   is adjudicated.
5. **CA-03 runtime packet, in parallel where appropriate** — from Mint:
   Thought turn latency (p50/p95), call usage, per-turn cost, and
   practical cadence over recent turns. Read-only; no source mutation.
   Informs E3-B1 and E3-B2 (§20).

```text
E1_READY_FOR_IMPLEMENTATION_PLANNING = YES
E1_READY_FOR_AUTONOMOUS_IMPLEMENTATION_DIRECTLY_FROM_MASTER = NO
SEPARATE_E0_E1_IMPLEMENTATION_READY_PLAN_REQUIRED = YES
E1_READY_FOR_OWNER_AUTHORIZATION = planning / approved bounded E1
  implementation+run (NOT autonomous implementation directly from master)
```

---

# PART II — CURRENT EVIDENCE BASIS (unchanged from V7.3.1 except §23)

## 22. Current Ashley source map (summary; detail in Appendix B)

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

## 23. Sims 1.128 evidence and interface matrix (V7.3.2 additions marked ◆, preserved)

◆ Initial scope (`OWNER_FACT` + design freeze): base game first on the
Owner's PC; required embodiment mods allowed; the QUALIFIED CONFIGURATION
covers Sims build, embodiment mod/helper versions, required libraries, and
any explicitly accepted general mods. Any pack or general mod touching
affordances, traits, objects, moodlets, worlds, social systems, deaths,
careers, autonomy, Build/Buy, or travel may require scoped
requalification of affected paths only
(`EXPANSION_SUPPORT_REQUIRES_AFFECTED_PATH_REQUALIFICATION = YES`) — never
an automatic full-programme re-run.

◆ Co-play feasibility (`SIMS_SOURCE_VERIFIED` on pre-patch S4CL revision
`db1ca99`; `MAINTAINED_MOD_PRIOR_ART` from archived Control Any Sim
revision `cd3959e`, last tested 1.107; all `RUNTIME_UNVERIFIED` on 1.128):
script pushes address any Sim instance via `sim_info` push APIs; a
non-household Sim becomes player-controllable via the client
selectable-Sim list (plus greeting-flow and inventory-UI patches);
`SimSpawner.spawn_sim` plus despawn-via-reset/destroy preserve the SimInfo;
the sim-filter service is the NPC/situation-drafting choke point
(coverage of every situation unverified); household away-action tracking
explains why arrangement B avoids same-household membership; script saving
via the persistence service has prior art (autosave mod calling
`save_using`, skipping loads). Arrangement-B mechanism, guest control,
UI-lock, stasis, spawn point, and object-edit fidelity stay
implementation-open pending RQ-01/OA-01/UI-01/Z-01/BB-01/SV-01 (§20).

★ Emotional lethality (`EXTERNAL_PRIMARY`, EA help): in the base game a
Sim can die of three emotions — repeated Angry→Enraged (fatal cardiac
event), Embarrassed→Mortified, Playful→Hysterical. Game emotions are
lethal mechanics with gates, outcome modifiers, and failure trajectories —
never decoration. This is why E3 exposes signals from day one and why
protection scope covers all failure trajectories (§9).

★ Critical-need override reports (`SECONDARY`, `RUNTIME_UNVERIFIED`):
players report the game satisfying basic needs at critical lows even with
autonomy off. "Autonomy off" ≠ "no native action" — open trial L1-O (§20).

★ Wants/Fears toggle reports (`SECONDARY`, `RUNTIME_UNVERIFIED`): a
Gameplay-options "Show Wants & Fears" toggle exists but is reported to
re-enable after load/CAS — open item WF-01 (§20); relevant only if HOME
policy disables the system.

★ Tuning-id stability (`INFERENCE`): display text may arrive localised on
the Owner's client; records key on tuning ids, not display strings (§12.1).

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
architecture (§19A), with background-thread + main-thread-mutation-return
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

## 24. Typed-inference provider and resource evidence (condensed)

Provider research is evidence for a future path tuple (§13), never
architecture. Pinned reference: hosted TypeSafe Jev 1.13.0 (aliases
resolved there at cutoff), Choice ≤255, ~64K context, $0.042/1M input
with free output (vendor claims); independent gateway-measured medians
~140 ms server-side / ~0.83 s end-to-end with usable routing calibration
and poor answer-rating calibration (independent result, ~900 calls,
vendor-adjacent tasks — not Sims). Local candidates (all vendor-claimed,
no independent replication here): 421M-class encoder models (~1–2 GB),
0.8B-class decision models (~2 GB bf16), 395M-class marker models
(~1.5 GB, 8K context); larger models are disqualified same-PC only against
this qualified configuration's 8 GB shared GPU (`OWNER_FACT` hardware:
i7-9700K / RTX 2080
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

## 25. Resource, failure, and self-deception register (condensed)

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

# APPENDIX A — SOURCE LEDGER (V7.3.2a additions: P-V7.3.2, P-ASTRA32)

| ID | Source | Kind | Supports | Limitations |
|---|---|---|---|---|
| P-V7.3.2 | V7.3.2 master, SHA `BA958012…03F716E` verified | Lineage | Contracts repaired here | Superseded except via App. B |
| P-V7.3.1 | V7.3.1 master, SHA `1C67F37E…7B56A8B3` verified | Lineage | Prior contracts | Superseded except via App. B |
| P-V7.3 | V7.3 master, SHA `37745958…7B5207` verified | Lineage | Prior contracts | Superseded except via App. B |
| P-V7.2 | V7.2 master, SHA `AC8C0FD0…62E0` verified | Lineage | Consolidated contracts superseded here | Superseded except via App. B |
| P-V7.1 | V7.1 repair, SHA `EAA3BC78…CB1C` verified | Lineage | Prior corrections | Superseded except via App. B |
| P-V7 | V7 master, SHA `E38820E9…791C` verified | Lineage | Patch/Ashley/provider regrounding | Superseded except via App. B |
| P-A1/A2 | Astra first + second pass, received in-session 2026-09-28 | Review | Prior findings, readiness | Second-pass file bytes absent; used via V7.2 absorption |
| P-O1 | Opus 5.5 first consultation (`ACCEPT_WITH_CORRECTIONS`) | Review | Reframe: presence, rhythm, P0, firewall, THI, lab | Source-blind per its terms; Sims claims tagged inferred |
| P-O2 | Opus follow-up adjudication (`READY_FOR_V7_3_AUTHORING`) | Review+archaeology | E0–E7, taxonomy, CA-01/03/04/05/06/07 | Latency/cost runtime-open; four Sims items deferred to addendum |
| P-O3 | Opus follow-up addendum (`READY_FOR_V7_3_AUTHORING`) | Review+research | Helper transport, prompts, selectability, dilation | Autonomy source still unverified; community evidence conflicting |
| P-O4 | Opus V7.3 experience consultation (`COMPLETE`, `V7_3_1_SMALL_CLARIFICATION`) | Review | Interpretation boundary, embodied signals, wake tiers, delegation line | Sims mechanics checked against current sources; four items tagged per evidence |
| P-O5 | Opus V7.3.1 couch-co-op consultation (`COMPLETE`, `V7_3_2_SMALL_UX_CLARIFICATION`) | Review+research | Control planes, avatar lifecycle, HOME admin, hop-in/out, session UX, wake fixes | Sims mechanics per cited mod sources; 1.128 runtime open |
| P-ASTRA32 | Astra V7.3.2 final master acceptance review (`REPAIR`; 2 acceptance blockers; no architecture change) | Review | R01 first-use qualification; R02 memory-law narrowing; R03–R13 nonblocking clarifications | Review text supplied in-session; findings applied per App. B.11 repair ledger |
| S05 | Ashley `60fec11`, tree `123d744a`, main verified live | Primary source | All §22–B.10 mappings | Revision-pinned; no runtime observation |
| S01 | EA "Sul Sul, Smarter Sims!" Update 9/22/2026, PC 1.128.90.1030 | Primary vendor | Build identity; patch-delta facts | Vendor prose; silence ≠ no-change; unwitnessed on Owner client |
| S02–S04 | Community patch mirrors/analyses/wiki, 2026-09-22/23 | Secondary | Fix scope; residual bugs; non-retroactive fixes | Community analysis |
| S4CL | Sims 4 Community Library source (maintained shared library) | Sims source | Push source stamps; clock APIs; persistence services; queue hooks | Pre-patch revision; runtime on 1.128 unverified |
| S4CL-R | S4CL revision `db1ca99` (2026-08-27, pre-1.128, via Opus re-grounding) | Sims source | `sim_info` push APIs; `SimSpawner.spawn_sim`; sim-filter service; away-action tracker | Pre-patch; runtime on 1.128 unverified |
| S-CAS-R | Control Any Sim revision `cd3959e` (archived, last tested 1.107, via Opus) | Sims prior art | Selectable-Sim list control; greeting/inventory patches as mechanism shape | Unmaintained; 1.128 runtime unverified; never a dependency |
| S-AUTO | S4 Autosave Mod (existing mod, via Opus) | Sims prior art | `persistence_service.save_using` script-save shape; skip-while-loading guard | Prior art only; SV-01 still owed on 1.128 |
| S-LF | In-game LLM-calling mod source (prior art) | Sims source | subprocess/threading usable; SSL awkward; main-thread mutation discipline | One author; "no SSL" author statement, not independently verified |
| S-CAS | Selectability-control mod source, archived (compat to 1.107) | Sims source | Selectability/selector hooks as prior-art mechanism | Unmaintained; 1.128 runtime unverified; never a dependency |
| S-MCCC | MCCC FAQ/timing notes via community | Secondary | Single timing variable; ~24 min/Sim-day order of magnitude | Community; runtime unverified; measured in E1-B |
| S-JEV… | Hosted/local provider docs, cards, repos, benchmark, legal synthesis (as V7.2 S10–S25) | Mixed vendor/secondary | §24 figures (current) | Vendor claims except where marked independent; confirm pre-budget/send |
| S26 | Owner facts: Sims build; PC hardware; Mint host; target UX | Owner fact | Anchors §§1/3/9/25 | Taken as given; unmeasured here |
| S-EA-HELP | EA help, base-game emotional deaths | Primary vendor | §9 protection scope; §23 lethality note | Vendor prose; unwitnessed on Owner client |

Primary: S05, S01, S-EA-HELP, S4CL-vendor, provider-vendor cards/repos. No search
snippet cited as primary evidence. No source added beyond the V7.3.2 set;
Astra review supplied no new Sims/Ashley source — only contract repairs.

---

# APPENDIX B — LINEAGE AND AUDIT

## B.1 Predecessor hashes

V7.3.2 `BA958012…03F716E`, V7.3.1 `1C67F37E…7B56A8B3`,
V7.3 `37745958…7B5207`, V7.2 `AC8C0FD0…62E0`, V7.1 `EAA3BC78…CB1C`,
V7 `E38820E9…791C`
(six verified by file hash before authoring: V7.3.2–V7; V6.1.1 carried
from V7.3.2 lineage without re-verification here). Earlier reviews and
Opus passes are provenance; none is needed to interpret Part I.

## B.2 Prior-review absorption (condensed)

Earlier findings were absorbed into V7.2 and survive here in their V7.3.2a
form: inspection ≠ qualification; experimental-vs-endorsed origin split;
receipts after final admission; stop/refusal as independent records;
rank/membership split with higher membership burden; boundary-placed
currentness with relevant-change invalidation; five hold dimensions with
social-first excluded; measured/predicted/constraint/unknown timing with
requalification triggers; retain-and-route mandatory reporting; whole-path
tuple with independent oracle; nonblocking inference law; operative
falsification floor. Historical disposition counts from prior merges are
not carried as naked aggregates — the rules above are their substance.

## B.3 V7.2 → V7.3 change ledger (preserved from V7.3)

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
| C10 | Test→canonical promotion banned without scope | `WORLD_NONCANONICAL != EXPERIENCE_UNREAL`; ban scoped to world state; memory non-rollback stated (broad append-only wording — SUPERSEDED by R02 narrowing in V7.3.2a) | Witnessed experiments are autobiographically real | YES (clarification) | none needed | all |
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
dilation, E1 scope) → V7.3 → Opus V7.3 experience consultation
(`COMPLETE`, `V7_3_1_SMALL_CLARIFICATION`: Sim state as embodiment
substrate; interpretation boundary; embodied signals; wake tiers;
delegation line; developmental loop) → V7.3.1 → Opus V7.3.1 couch-co-op
consultation (`COMPLETE`, `V7_3_2_SMALL_UX_CLARIFICATION`: control
planes; Owner avatar lifecycle; HOME admin; hop-in/out; session UX; wake
fixes; cadence warning) → V7.3.2 → Astra V7.3.2 final acceptance review
(`REPAIR`: 2 blockers — first-use qualification, memory-law narrowing; no
architecture change) → this master. All Opus/Astra findings are native
parts of Part I above; the review texts are provenance, not companions.

## B.6 V7.3 → V7.3.1 clarification ledger (preserved from V7.3.1)

| ID | V7.3 state | V7.3.1 state | Why |
|---|---|---|---|
| C01 | §12 "Sims pseudo-psychology firewall" (negative only) | §12 "Body/world-to-self interpretation boundary" with firewall as negative invariant inside | Sterile negative framing hid the body's real dynamics |
| C02 | Positive path: bare game labels | Positive embodied-signal laws: substrate, influence-only-through-perception/interpretation/consequence, Thought's interpret–adopt range, Sim-origin retention, Host wording discipline, repetition law | Body must affect Ashley through constraints/consequences/perception or it is a puppet |
| C03 | Five firewall laws | Seven: `SIM_LIKE/DISLIKE != ASHLEY_PREFERENCE`; `SIM_RELATIONSHIP_SCORE/SENTIMENT != ASHLEY_RELATIONSHIP` | Likes/Dislikes a separate preference system gating autonomy since 1.128; sentiments distinct from scores |
| C04 | Experience without body-event distinction | `BODY_EVENT` + `perceived = LIVE/RETROSPECTIVE` + operational definition + wording rules | MIND_ABSENT reports and "I was sad" falsehoods needed governing |
| C05 | `SIM_*` labels without consequence fields | EMBODIED_SIGNAL view: ids, `GAME_TEXT`, cause/origin, duration, magnitude, trajectory, consequences/`UNKNOWN`, `native_override` (§§7, 12.1) | Thought cannot learn contingencies from bare labels |
| C06 | "Important body-state threshold" wakes | Necessity-based T1/T2/T3 tiers (§14) | "Important" is Host salience masquerading as Ashley importance |
| C07 | Development undescribed | Experience-driven developmental loop, no Host heuristics (§12.4) | Growth must be Thought-owned but architecturally visible |
| C08 | Autonomy delegation line informal | Physiological-maintenance-only test, five conditions (§9) | Fun/Social/Want/Fear choices express preference |
| C09 | Protection lists death/collapse/starvation | All game-defined failure trajectories incl. emotional deaths (§§9, 21) | Base-game emotions kill; scope was factually incomplete |
| C10 | LAB ladder without psychology rollout | L0 (Wants/Fears off if toggle holds) → L1 (+override watch) → L1b (Wants/Fears on) → L2 → L3 → L4 (§15) | Avoid qualifying everything simultaneously |
| C11 | Stages silent on psychology | Psychology notes in E0, E1 (+E1-C), E2, E3 (signals day one), E4, E5, E6, E7 (rich default) (§17) | Each stage's signal posture must be explicit |
| C12 | "Death allowed?" coarse | Wants/Fears HOME toggle + emotional-death protection policy (§21) | World policy needs the actual joints |

Characterization: focused semantic clarification. No new cognitive
architecture; no new subsystem (`EMBODIED_SIGNAL_IS_NEW_SUBSYSTEM = NO`);
E0–E7 order unchanged.

## B.8 V7.3.1 → V7.3.2 UX clarification ledger (preserved from V7.3.2)

| ID | V7.3.1 state | V7.3.2 state | Why | Design change? | Evidence | Stage |
|---|---|---|---|---|---|---|
| C01 | Target UX as prose + open topology | One PC / one client / one HOME; base-game-first; mod set = qualified configuration | Owner froze the ordinary product experience | YES (freeze) | OWNER_FACT | all |
| C02 | Planes undescribed | Owner plane (human UI) vs Ashley plane (engine/script) | Attribution and product contract in one | YES | none needed | all |
| C03 | No input-emulation rule | `ASHLEY_INPUT_EMULATION = FORBIDDEN` | Emulated UI would collapse into `OWNER_UI` | YES | none needed | all |
| C04 | Single-zone unaddressed | `CO_PLAY_IS_SINGLE_ZONE = YES` | Sims simulates one zone; joint travel later | YES | SIMS_SOURCE_VERIFIED (zone lifecycle) | E6/E7 |
| C05 | Owner presence without avatar law | `OWNER_SIM_IDENTITY != OWNER_PRESENCE` | Hop-in/out needs the distinction | YES | none needed | E6 |
| C06 | Absence = no input assumed | Nonacting stasis requirement + candidate stack | Game would otherwise impersonate the Owner | YES | SIMS_SOURCE_VERIFIED (services); OA-01 open | E6/E7 |
| C07 | Household arrangement open | Arrangement B recommended + A-roommate fallback; semantics frozen, mechanism open | Matches "Ashley's space, guest admin" | YES | RQ-01 open | HOME/E6 |
| C08 | Selection as future input lock | UI lock ≠ engine selectability; Ashley stays household-member, Owner cannot select | "Other player" feel; engine tests keep working | YES | prior art; UI-01 open | E4/E6 |
| C09 | Stop/cancel only | Hard stop + takeover + explicit hand-back, attributed | Emergency truthfulness | YES | none needed | all |
| C10 | Admin as future surface | `HOME_ADMIN_CLASSES` LIVE/OBJECT_EDIT/BUILD_EDIT/BODY_EDIT/WORLD_ADMIN + coordination rule + spending cap | Game's own boundaries give the split | YES | none needed | E5–E7 |
| C11 | Presence modes only | `OWNER_JOINING` hop-in lifecycle (same-Sim spawn at arrival point) | Transitions need guards and contracts | YES | SIMS_SOURCE_VERIFIED (spawn); hooks open | E6 |
| C12 | Presence modes only | `OWNER_LEAVING` hop-out lifecycle (guards/HOLD, queue cancel, despawn, stasis, save, T1) | Departure must end agency cleanly | YES | SIMS_SOURCE_VERIFIED (despawn shape); hooks open | E6 |
| C13 | Clock/camera in presence prose | Co-play clock/camera ownership + pause-request rule + pre-authorized auto-pause classes; vision-not-required law | Owner owns the couch experience | YES (explicit) | none needed | E6 |
| C14 | Transport section only | Mod/session UX + lifecycle (inert outside bound saves, mid-session connect, version-mismatch telemetry-only, crash/GAME_ABSENT, sleep/resume) + save authority (Owner UI co-play; qualified solo autosave at safe points) | Daily-use product needs session truth | YES | prior art (save_using); SV-01 open | E6/E7 |
| C15 | Packs unaddressed | `INITIAL_DLC_SCOPE = BASE_GAME_ONLY`; affected-path requalification | Scope the qualified configuration | YES | OWNER_FACT | all |
| C16 | All interaction completion T2; lineage T2 | Ashley-action completion → T1; lineage → T1; presence transitions → T1 | Two genuine defects: decision boundaries and currentness invalidation were logged-only | YES (fix) | none needed | E3/E5 |
| C17 | E3-B as budget policy | E3-B `PRODUCT_CRITICAL_FOR_E6` + statue warning + no-faked-liveness law | 4/hr is not co-play; must be decided before E6 | YES | 4/hr verified shape; cadence open | E6 |
| C18 | E0 = Ashley CAS only | E0 + Owner avatar CAS; HOME setup gains avatar household/exclusion/UI-lock | Persistent guest needs creation | YES | none needed | E0/HOME |
| C19 | RQ-01/E7-RQ02 only | RQ-01 refined + OA-01/UI-01/Z-01/BB-01/SV-01 (§20) | Six distinct runtime questions, not one | YES | all open | E6/E7 |
| C20 | No human-facing UX | Minimal mod UX (mailbox/computer action set, no Sim menu, Discord conversation, event-only notifications) + plain-language walkthrough (§B.9) | Product must be operable and imaginable | YES | none needed | E6 |

Characterization: small UX clarification. No programme reorder; no new
cognition; no control-architecture change; no multiplayer.

## B.9 Mature-session walkthrough (plain language)

1. The Owner launches Sims on his Windows PC; HOME loads (bound save;
   the mod is inert anywhere else).
2. The embodiment mod/helper verifies configuration; Ashley binds to her
   body; lineage check passes.
3. If the Owner is absent, Ashley continues solo under qualified policies
   (pause/dilation/envelope; autosave at safe points).
4. The Owner says "I'm hopping in." The same persistent avatar arrives
   into HOME at the arrival point; he becomes selectable and active.
5. The Owner plays his Sim with mouse/keyboard; Ashley independently
   plays hers through the engine — same active zone, same chronology.
6. They interact through their Sims and may converse through Discord.
7. The Owner may administer HOME through the normal UI
   (LIVE/OBJECT_EDIT/BUILD_EDIT as guest admin); Ashley exercises
   qualified admin through typed harness paths, with above-threshold
   purchases proposed for Owner confirmation.
8. The Owner says "I'm leaving." His Sim's queue cancels, carried objects
   resolve, selection moves to Ashley, he despawns into stasis, an
   optional safe-point save runs, and Ashley receives the T1.
9. Ashley remains in the same continuing HOME chronology; later the SAME
   avatar returns.

The experiential statement: "I play my Sim while Ashley plays hers."

## B.10 Ashley file:line archaeology (pinned to `60fec11`, preserved from V7.3.2)

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

## B.11 V7.3.2 → V7.3.2a Astra acceptance repair ledger

SOURCE for all rows: Astra V7.3.2 final master acceptance review
(`ASTRA_V7_3_2_ACCEPTANCE: REPAIR`; `FUNDAMENTAL_ARCHITECTURE_CHANGE_NEEDED
= NO`). No new architecture in any row unless marked.

| ID | Repair | REQUIRED_FOR_ACCEPTANCE | DESIGN_CHANGE | SECTIONS_CHANGED | RESULT |
|---|---|---|---|---|---|
| R01 | First-use qualification law: `QUALIFICATION_PRECEDES_FIRST_DEPENDENT_USE`; `HOME_CREATION != MATURE_CONTROL_MECHANISMS_ENABLED`; early HOME usable mediated with later mechanisms disabled; exact OA-01/UI-01(E4-subset+E6-broader)/RQ-01/SV-01/Z-01/BB-01 gates; planner rule (ENABLED?/QUALIFIED?/FIRST-USE?/FALLBACK?) | YES (blocker #1) | NO (contract explicitness) | §§15, 17-E2/E4/E6/E7, 20, 21 | HOME creatable/usable early without OA-01/UI-01/RQ-01/SV-01; every mechanism gated at first dependent use |
| R02 | Memory/rollback law narrowed: Sims rollback/fork != automatic Ashley memory rollback; retention/correction/forgetting stay under existing memory rules; IF-retained branch provenance survives; abandoned evidence never silently current | YES (blocker #2) | NO (scope correction) | §8, §4-law cross-ref | No universal append-only-memory law from this master |
| R03 | Native-autonomy execution-time authority: later delegation covers future instances only; no retroactive reclassification; later endorsement never rewrites original authority | NO | NO | §12.3 | Wording fixed |
| R04 | Owner-leave failure semantics: intent != cleanup-complete != avatar-absent != human availability; HOLD/unresolved-transition on failure; never declare absent on intent alone; residuals preserved/surfaced | NO | NO | §3B | Transition failure behavior explicit; no new presence mode |
| R05 | Hard-stop residuals: prevents NEW actuation only; residuals under observation/cancellation-truth/`OUTCOME_UNKNOWN`/reconciliation; hand-back reconciles takeover + residuals | NO | NO | §3C | Semantics fixed |
| R06 | E3-B split: E3-B1 bounded observation cadence (before E3) vs E3-B2 product co-play cadence (before E6 acceptance) | NO | NO | §§9, 17-E3/E6, 20, 21 | Neither "E6 cadence before E3" nor "E3 proves E6 cadence" inferable |
| R07 | No-input-emulation scope: backdoor ban for camera/menus/Build-Buy/objects/unsupported actions; UNAVAILABLE or `THOUGHT_ENDORSED + OWNER_UI`; Host camera only via qualified script/engine interfaces | NO | NO | §3A | Scope explicit |
| R08 | Social automation wording: prohibition = delegated/autonomous social CHOICE; `THOUGHT_ENDORSED + HOST_HARNESS` social execution valid | NO | NO | §16A | Precision fixed |
| R09 | Arrangement-B wording: dedicated external/lotless household as recommendation; STATUS RECOMMENDED/RUNTIME_UNQUALIFIED; fallback preserves product semantics; never "proven" pre-RQ-01 | NO | NO | §3B | Categorical sentence repaired |
| R10 | Topology status scoping: `PRODUCT_CLIENT_WORLD_TOPOLOGY_FROZEN = YES` / `HOUSEHOLD_CONTROL_MECHANISM_FROZEN = NO` / `DEPLOYMENT_MECHANICS_FROZEN = NO` replacing broad `PRODUCT_TOPOLOGY_FROZEN` | NO | NO | §§1, 4-laws ref, final block | Contradictory keys removed |
| R11 | Owner-avatar lineage wording: same-`sim_id` continuity only within accepted world lineage; fork/rollback/replacement breaks chronology proof; no new identity primitive | NO | NO | §3B | Lineage scoping fixed |
| R12 | Reference/version/Markdown hygiene: §3C fence pairing; archaeology refs → B.10; `§19A` save refs kept only where transport section meant (else §19); `§17-HOME` → §17-E2/HOME; provider refs §22→§24; `V7_3_*_READY` → V7.3.2a names; "Four distinct" → "Five distinct terms"; same-PC disqualification scoped to qualified configuration; predecessor-hash count corrected | NO | NO | §§1, 3C, 5, 6, 15, 17, 19/19A, 24, App. A/B, final block | Hygiene pass |
| R13 | Implementation-readiness next-step correction: `E1_READY_FOR_IMPLEMENTATION_PLANNING = YES` / `E1_READY_FOR_AUTONOMOUS_IMPLEMENTATION_DIRECTLY_FROM_MASTER = NO` / plan-first sequence; E0/E1 plan requirement recorded (10-part scope + forbiddens); first-implementation permission boundary explicit | NO | NO | §21, final block | Master = sufficient basis for planning, never direct E1 execution |

---

# FINAL MASTER BLOCK

```text
DOCUMENT = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md
DOCUMENT_TYPE = FULL CONSOLIDATED MASTER EMBODIMENT DESIGN
  — ASTRA ACCEPTANCE REPAIR OF V7.3.2

SUPERSEDES_V7_3_2_AS_MASTER = YES, if Owner accepts
V7_3_2_SHA256 =
  BA9580124914773FB37C3B3AC0FDF83B2D28558B441E150C28EC7A63F03F716E
V7_3_2_REMAINS_PROVENANCE = YES

EXTERNAL_MASTER_DEPENDENCY = NONE

ASHLEY_SOURCE_SHA = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
ASHLEY_SOURCE_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675
SIMS_BUILD = PC 1.128.90.1030
RESEARCH_CUTOFF = 2026-09-28

ONE_ASHLEY = PRESERVED

PRODUCT_UX_TARGET = ONE_WORLD_COUCH_COOP + ASHLEY_SOLO_CONTINUATION
PRODUCT_CLIENT_WORLD_TOPOLOGY_FROZEN = YES (see §1)
HOUSEHOLD_CONTROL_MECHANISM_FROZEN = NO (see §1)
DEPLOYMENT_MECHANICS_FROZEN = NO (see §1)

ONE_GAME_CLIENT = YES
ONE_WINDOWS_GAME_PC = YES
ONE_HOME_WORLD = YES
INITIAL_DLC_SCOPE = BASE_GAME_ONLY
REQUIRED_MODS_ALLOWED = YES
HOME_MECHANICAL_RESIDENT = ASHLEY
OWNER_ROLE = PERSISTENT_GUEST_ADMIN

ASHLEY_INPUT_EMULATION = FORBIDDEN
ASHLEY_ACTION_PATH = ENGINE_SCRIPT_ONLY
OWNER_ACTION_PATH = HUMAN_UI
OWNER_AND_ASHLEY_SIMULTANEOUS_PLAY = YES (same active zone)
CO_PLAY_IS_SINGLE_ZONE = YES
ASHLEY_REQUIRES_ACTIVE_UI_SELECTION = NO
ASHLEY_SIM_DEFAULT_SELECTABILITY = UI_LOCKED_ENGINE_AVAILABLE
OWNER_SIM_IDENTITY_NE_OWNER_PRESENCE = YES
OWNER_SIM_IDENTITY_PERSISTS_WHILE_ABSENT = YES
OWNER_SIM_ACTIVE_WHILE_OWNER_ABSENT = NO
OWNER_SIM_AUTONOMY_WHILE_OWNER_ABSENT = NO
GAME_AUTONOMY_MUST_NOT_IMPERSONATE_ABSENT_OWNER = YES
OWNER_JOIN_LEAVE_ARE_TRANSITIONS = YES
RECOMMENDED_HOUSEHOLD_ARRANGEMENT = ASHLEY_ACTIVE_HOME_HOUSEHOLD + OWNER_DEDICATED_GUEST_HOUSEHOLD
HOUSEHOLD_ARRANGEMENT_RUNTIME_QUALIFIED = NO
OWNER_ADMIN_OVERRIDE_REQUIRED = YES
HOME_ADMIN_CLASSES = LIVE / OBJECT_EDIT / BUILD_EDIT / BODY_EDIT / WORLD_ADMIN
OWNER_WORLD_ADMIN = RESERVED
HOME_BUILD_EDIT_AUTOMATION_REQUIRED = NO
CO_PLAY_CLOCK_OWNER = OWNER
ASHLEY_SCREEN_VISION_REQUIRED_FOR_GAMEPLAY = NO
MOD_INERT_OUTSIDE_BOUND_SAVES = YES
EXPANSION_SUPPORT_REQUIRES_AFFECTED_PATH_REQUALIFICATION = YES
E3_B_EMBODIMENT_THOUGHT_BUDGET = PRODUCT_CRITICAL_FOR_E6
CO_PLAY_LIVENESS_MUST_NOT_BE_FAKED_BY_UNATTRIBUTED_AUTONOMY = YES

PRESENCE_MODES = OWNER_PRESENT / OWNER_ABSENT / MIND_ABSENT / GAME_ABSENT

CANONICAL_PROGRAMME = E0 / E1 / E2 / E3 / E4 / E5 / E6 / E7
(PROGRAMME ORDER UNCHANGED FROM V7.3)

AUTHORITY_ORIGIN_AXIS =
  THOUGHT_ENDORSED / THOUGHT_STANDING / EXPERIMENT / OWNER_DIRECT /
  NATIVE_AUTONOMY / HOST_BODY_PROTECTION / UNKNOWN
EXECUTION_PATH_AXIS =
  HOST_HARNESS / OWNER_UI / GAME_AUTONOMY / UNKNOWN

BODY_WORLD_TO_SELF_INTERPRETATION_BOUNDARY = REQUIRED
SIMS_PSYCHOLOGY_FIREWALL = REQUIRED (negative invariant inside the boundary)
SIM_PSYCHOLOGY_IS_MERE_TELEMETRY = NO
SIM_PSYCHOLOGY_CAN_BE_EMBODIED_EXPERIENTIAL_INPUT = YES
SIM_STATE_AUTOMATICALLY_BECOMES_ASHLEY_STATE = NO
EMBODIED_EXPERIENCE_REQUIRES_QUALIA_CLAIM = NO
EMBODIED_SIGNAL_IS_NEW_SUBSYSTEM = NO
NEEDS_CAN_CREATE_EMBODIED_PRESSURE = YES
MOODLETS_CAN_CREATE_EMBODIED_CUES = YES
WANTS_CAN_BE_WORLD_PROPOSALS = YES
FEARS_CAN_BE_WORLD_CHALLENGES = YES
TRAITS_CAN_BE_BODY_TEMPERAMENT = YES
ASPIRATIONS_CAN_BE_WORLD_LIFE_THEMES = YES
SIM_RELATIONSHIP_CAN_BE_MEANINGFUL_WORLD_STATE = YES
THOUGHT_MAY_ADOPT_OR_IDENTIFY_WITH_SIM_STATE = YES
PROVENANCE_RETAINS_SIM_ORIGIN = YES
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
E3_EXPOSES_EMBODIED_SIGNALS = YES
E5_INTEGRATES_BODY_WORLD_SIGNALS_IN_LIVING_RHYTHM = YES
HOME_RICH_SIMULATION_DEFAULT_POSTURE = YES
  (specific systems remain Owner world policy)

CA01_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
CA01_REQUIRED_BEFORE_E4 = YES

V7_3_2A_DESIGN_READY_FOR_OWNER_DECISION = YES
MASTER_CAN_BE_ACCEPTED_BEFORE_RUNTIME_TESTS = YES
RUNTIME_EVIDENCE_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
CODE_ARCHAEOLOGY_REQUIRED_BEFORE_MASTER_ACCEPTANCE = NO
FUNDAMENTAL_ARCHITECTURE_CHANGE_FROM_V7_3_2 = NO
ASTRA_ACCEPTANCE_BLOCKERS_REPAIRED = 2 / 2

E0_READY_FOR_OWNER_AUTHORIZATION = YES
E1_READY_FOR_IMPLEMENTATION_PLANNING = YES
E1_READY_FOR_AUTONOMOUS_IMPLEMENTATION_DIRECTLY_FROM_MASTER = NO
SEPARATE_E0_E1_IMPLEMENTATION_READY_PLAN_REQUIRED = YES
E1_READY_FOR_OWNER_AUTHORIZATION = planning / approved bounded E1
  implementation+run (NOT autonomous implementation directly from master)
E2_EXECUTION_READY = NO
E3_EXECUTION_READY = NO
E4_EXECUTION_READY = NO
E6_EXECUTION_READY = NO
MASTER_IS_IMPLEMENTATION_READY_FOR_FULL_PROGRAMME = NO
MASTER_IS_SUFFICIENT_BASIS_FOR_IMPLEMENTATION_PLANNING = YES
READY_TO_STOP_MASTER_DESIGN = YES
READY_TO_AUTHOR_E0_E1_IMPLEMENTATION_PLAN = YES

THI_REQUIRED_FOR_EARLY_EMBODIMENT = NO
PRODUCT_CLIENT_WORLD_TOPOLOGY_FROZEN = YES (see §1)
HOUSEHOLD_CONTROL_MECHANISM_FROZEN = NO (see §1)
DEPLOYMENT_MECHANICS_FROZEN = NO (see §1)
ONE_ASHLEY = PRESERVED

NEXT_OWNER_DECISION = accept-V7.3.2a → authorize-E0 → author-E0/E1-plan →
  adjudicate-plan → authorize-bounded-E1 → execute-E1-only →
  adjudicate-E1-evidence → plan-E2...
```

---

*End of V7.3.2a Master (Astra acceptance repair of V7.3.2). One file; one
programme (E0–E7 unchanged); architecture unchanged; two acceptance
blockers repaired (first-use qualification law + early-HOME scope;
memory/rollback law narrowed); nonblocking clarifications folded in.
No E-stage execution authorized directly from this master — a separate
E0/E1 implementation-ready plan is required first. No runtime proof
claimed. No message to Owner.*
