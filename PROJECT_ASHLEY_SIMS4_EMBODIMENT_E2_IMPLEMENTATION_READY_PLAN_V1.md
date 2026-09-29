# Project Ashley — Sims 4 Embodiment E2 Implementation-Ready Plan V1

```text
DOCUMENT            = PROJECT_ASHLEY_SIMS4_EMBODIMENT_E2_IMPLEMENTATION_READY_PLAN_V1.md
DOCUMENT_TYPE       = IMPLEMENTATION-READY STAGE PLAN (E2 only)
NORMATIVE_MASTER    = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md
                      SHA256 A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3
PREDECESSOR_PLAN    = ..._E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md (CBF47BF6…130F683)
E1_ADJUDICATION     = sims-e1/evidence/E1_ADJUDICATION_2026-09-29.md (commit 3b0bb54)
ASHLEY_SOURCE       = main @ 3b0bb54 (probe 1.0.11 accepted instrument)
SIMS_BUILD          = PC 1.128.90.1030, base game
TARGET_ARCHIVES     = simulation.zip B97D71BB…24EC, core.zip 641E9233…690B, base.zip 5E53E2A5…2594
DATE                = 2026-09-29 Europe/Istanbul
STATUS              = ACCEPTED by Owner 2026-09-29 (L5 rollback file-restore trial: SKIPPED by Owner;
                      LAB single-seat chair: Owner will arrange before the runtime session)
```

**NOT:** Mint integration, Windows helper, remote actuation, Thought
endorsement, HOME creation, co-play, UI lock, stasis, THI, scripted save,
object edit, standing envelopes, E3 perception delivery.

---

## 1. Purpose and first claim

E2 earns exactly one new claim class, in LAB, under Owner experimental
authority:

```text
FIRST_CLAIM = first attributable body effect
AUTHORITY_ORIGIN = EXPERIMENT      (Owner-authorized experimental request)
EXECUTION_PATH   = HOST_HARNESS    (our script mod pushed it)
```

and qualifies two mechanisms the master assigns to E2:

- **E2-L** — world-lineage detection (rollback / fork) sufficient that later
  Sims world events can be classified current vs abandoned (master §8).
- **E2-P** — pause/resume via script on the Owner client (master §9, §20).

E2 also delivers the minimum **binding** needed for the experiment (§7):
designated body key + currentness check at admission.

What Ashley is told: before the first E2 trial the Owner tells Ashley that
tests will run through a test body (Owner decision 2026-09-29: YES). After
trials she may be shown results in the master §5 case-A form ("During a test
Xharva ran, my test body sat down"), never "I sat / chose". Showing results
is Owner-mediated in E2 (no Mint path until E3).

## 2. Inputs carried from E1 (evidence, not assumption)

| E1 fact | Consequence in E2 |
|---|---|
| Owner pie-menu → `InteractionSource.PIE_MENU`; native choices → `AUTONOMY`; `AUTONOMY` also on idles/sub-behaviours; game scripts use `SCRIPT` | Harness pushes are identified **only** by our handle registry (master §10), never by source label. Owner-click control is classifiable by `PIE_MENU` on a root entry. |
| Save-As keeps `save_slot_guid`, changes `slot_id`; `sim_id` stable across fork | `{save_slot_guid, sim_id}` is ambiguous between origin and fork. Lineage must use slot + ticks + an outside ledger (§6). |
| 40.0 game-min / real-min at normal speed; 1500 ticks / game-min | Tick deltas convert exactly; ledger comparisons use absolute ticks. |
| Game enters `SUPER_SPEED3` natively while the Sim sleeps | E2-P must record native speed changes separately from our requests. |
| Autonomy OFF still yields AUTONOMY idle mixers (~every 10 s) | "No foreign-origin interaction touches the body" (master §10) is judged on **root/super** interactions of foreign origin, with idle mixers classified and reported, not ignored. |
| Writer keeps up at 1 Hz; STOP/DISARM reliable; zero loss | E2 reuses the 1.0.11 writer, command adapter, and state machine unchanged. |
| `seating_Sit` tuning id `31564` observed at runtime on 1.128 | Sit affordance resolved **from the target object's own affordance list** and checked against 31564 (§5.3); never pushed by bare id alone. |

## 3. Scope

In scope (all LAB, Owner present at keyboard, autonomy OFF unless a trial
says otherwise):

1. Read-surface extension: posture type + posture target id; object lookup
   by id; save-complete observation.
2. Experiment command path: prepare → admit → push → lifecycle → verdict.
3. Handle registry and lifecycle correlation.
4. E2-L lineage ledger (outside the save) + load-time classification.
5. E2-P pause/resume via a probe-owned speed request.
6. Negative controls (§8).
7. Telemetry schema v2 (additive), bounded as in E1.

Explicitly excluded: any push other than the single admitted sit class; any
object creation/destruction/state write; any save/load/travel initiated by
the mod; any household/relationship/motive/trait/buff write; any in-save
marker write (§6.4 explains why none is needed for E2); network; Mint;
second experiment (lamp) — deferred as optional (master §10).

## 4. Architecture

```text
ONE artifact  ashley_embodiment_<V>.ts4script   (replaces ashley_e1_* in Mods\AshleyE1\)
  ashley_e1/          unchanged read-only observer + writer + schema (v2 additive)
  ashley_e2/
    registry.py       handle registry (pure; no game imports)
    admission.py      prepare/admit rules (pure logic over plain-data snapshots)
    actuator.py       the ONLY module allowed to call push/speed APIs (game thread)
    lineage.py        ledger model + classification (pure) ; ledger I/O via writer thread
    commands.py       ashley_e2.* registration + adapters (reuses E1 adapter pattern)
```

Planes: Owner acts via UI and console commands; the mod acts only through
engine APIs (`ASHLEY_INPUT_EMULATION = FORBIDDEN` unchanged). All game reads
and all actuation happen on the game thread inside command handlers or the
existing 1 Hz alarm callback. The writer thread does file I/O only.

AST guard (extends `tools/check_guards.py`): `ashley_e1/*` keeps the E1
read-only denylist verbatim. `ashley_e2/actuator.py` gets a **closed call
allowlist**: `sim.push_super_affordance`, `GameClock.push_speed`,
`GameClock.remove_request`, `Interaction.register_on_finishing_callback`,
`Interaction.unregister_on_finishing_callback`,
`PersistenceService.add_manual_save_complete_callback`. Any other mutating
call anywhere in the package fails the build. `registry.py`,
`admission.py`, `lineage.py` must import no game module.

## 5. Target bindings (exact 1.128 bytecode unless marked)

Evidence tags: `TARGET_BYTECODE` = read from 1.128 `simulation.zip`/`core.zip`
this session; `E1_RUNTIME` = observed in E1 telemetry; `RUNTIME_UNVERIFIED`
= must be proven at first E2 load (§10 gate).

### 5.1 Push

```python
from interactions.context import InteractionContext, QueueInsertStrategy
from interactions.priority import Priority

context = InteractionContext(sim, InteractionContext.SOURCE_SCRIPT_WITH_USER_INTENT,
                             Priority.High, insert_strategy=QueueInsertStrategy.NEXT)
result = sim.push_super_affordance(affordance, target_obj, context)   # EnqueueResult
```

- `Sim.push_super_affordance(self, super_affordance, target, context, **kwargs)`
  builds `AffordanceObjectPair(sa, target, sa, None)` and returns
  `aop.test_and_execute(context)` → `EnqueueResult(test_result, execute_result)`
  (`TARGET_BYTECODE`).
- `EnqueueResult.__bool__` = test_result and execute_result truthy;
  `EnqueueResult.interaction` dereferences `execute_result.interaction` —
  **raises if execute_result is None** (test failed). The actuator reads
  `result.execute_result` first and never calls `.interaction` on a failed
  test (`TARGET_BYTECODE`).
- On success `execute_result.interaction` is the queued Interaction object.
  `Interaction` is decorated `@unique_id('id', 1, MAX_UINT64)`, so `.id` is a
  per-instance uint64 (`TARGET_BYTECODE`). The registry stores `interaction.id`
  (as a string) and, on the game thread only, a weak reference; no live
  reference ever crosses to the writer (E1 §13 rule unchanged).
- The observer adds `interaction_id` (string) to every observed entry
  (additive schema v2 field) so presence rows and the registry join on the
  game's own id, not on `hex(id())`.
- Source choice: `SOURCE_SCRIPT_WITH_USER_INTENT` (enum value exists,
  `TARGET_BYTECODE`). Chosen so the push behaves like a directed action and is
  not dropped by autonomy re-evaluation. The recorded source label is **not**
  used for attribution (E1-A; master §10); the handle registry is.

### 5.2 Lifecycle

`Interaction.register_on_finishing_callback(cb)`, `.is_finishing`,
`.finishing_type`, `.running`, `.queued`, `.has_been_canceled`,
`.has_been_user_canceled`, `.has_been_reset` exist (`TARGET_BYTECODE`).
Callback payload shape and thread: `RUNTIME_UNVERIFIED` (first-load gate).
The registry also polls handle state each 1 Hz tick (belt and braces: a
missed callback cannot fabricate completion; it yields `OUTCOME_UNKNOWN`).

### 5.3 Target and affordance

- Target lookup: `services.object_manager(zone_id)` exists (signature
  `TARGET_BYTECODE`; default-zone behaviour of the argument and `.get(id)`
  are `RUNTIME_UNVERIFIED` — first-load gate).
- Affordance: `ScriptObject.super_affordances(cls, inst, context)` is a
  flexmethod (`TARGET_BYTECODE`); iterate the target's own `super_affordances(context)` and select
  the one whose tuning guid64 == `31564` (`seating_Sit`, `E1_RUNTIME`). If
  absent or not unique → reject `AFFORDANCE_NOT_OFFERED`. Never fetch by id
  from the instance manager and push onto an object that does not offer it.
- Target class requirement (master §10 E2 test class): single-seat chair —
  the Owner designates it; admission verifies the object offers 31564 and is
  not the sofa used in E1 (sofa id recorded as excluded).

### 5.4 Posture read (new observer field)

`Sim.posture` → Posture; `Sim.posture_target` returns `posture.target` or
None; `Posture.posture_type` / `Posture.name` are classmethods
(`TARGET_BYTECODE`). Observer records `posture = {"name": str, "target_id":
str|None}` replacing the E1 `posture: null`.

### 5.5 Speed (E2-P)

```python
clock = services.game_clock_service()
req = clock.push_speed(ClockSpeedMode.PAUSED, source=GameSpeedChangeSource.GAMEPLAY,
                       reason="ashley_e2_pause")
clock.remove_request(req, source=GameSpeedChangeSource.GAMEPLAY, reason="ashley_e2_release")
```

`ClockSpeedMode = {PAUSED 0, NORMAL 1, SPEED2 2, SPEED3 3,
INTERACTION_STARTUP_SPEED 4, SUPER_SPEED3 5}`; `GameSpeedChangeSource =
{SITUATION 0, UI_MODAL 1, GAMEPLAY 2, INITIAL 3}`; effective speed is the
first valid request from `game_speed_requests_gen()` (`TARGET_BYTECODE`).
Precedence between our GAMEPLAY request and the Owner's speed buttons is
**RUNTIME_UNVERIFIED** and is itself an E2-P trial question (§7).

### 5.6 Save observation (E2-L)

`PersistenceService.add_manual_save_complete_callback(cb)` registers `cb`;
`save_game_gen` calls the list with **no arguments** only when the save
succeeded, `slot_id > 1`, and `slot_id != AUTO_SAVE_SLOT_ID`
(`TARGET_BYTECODE`). This is a non-veto, non-patching subscription. It is the
one lifecycle subscription E2 adds (E1 had none). It is registered on ARM and
removed on DISARM via `remove_manual_save_complete_callback` (exists,
`TARGET_BYTECODE`), so it cannot fire in unbound saves. What
`get_save_slot_proto_buff()` and ticks read **inside** the callback
(post-Save-As slot, exact save ticks) is `RUNTIME_UNVERIFIED` (E2-L L1/L4).

### 5.7 Console output

`sims4.commands.output(s, context)` exists (`TARGET_BYTECODE`). Used only to
print admission tokens and rejection codes to the Owner; never world state.

## 6. E2-L — lineage mechanism

### 6.1 Principle

No in-save write. The save already carries an intrinsic, monotone,
game-written lineage coordinate: absolute game ticks. Combined with slot id,
guid, and an **outside-save ledger** that records every Owner save and every
attended load, the Host can classify each load (master §8: "outside-save
per-save files do not roll back when the save does").

### 6.2 Ledger

`<telemetry-root>\AshleyEmbodimentLedger\lineage.jsonl`, append-only, written
by the writer thread, never rotated or deleted by the mod. Records:

```text
LOAD_OBSERVED   {guid, slot_id, sim_id, ticks_at_first_poll, wall, session_uuid}
SAVE_OBSERVED   {guid, slot_id, sim_id, ticks_at_callback, wall, session_uuid,
                 loaded_from_slot_id}
```

`SAVE_OBSERVED` is written from the save-complete callback (armed only).
`loaded_from_slot_id` is the slot of the session's `LOAD_OBSERVED`.

### 6.3 Classification at each ARM+first poll (pure function, unit-tested)

Given current `(guid, slot, sim, T)` and the ledger:

| Condition | Class | Meaning |
|---|---|---|
| last `SAVE_OBSERVED` for (guid, slot) has ticks S and \|T − S\| ≤ ε | `CONTINUES_LAST_SAVE` | Loaded exactly the last observed save of this slot. Rows observed after S in earlier sessions of this slot are an **abandoned branch** unless a later save covered them. |
| T < S − ε | `ROLLBACK` | An older state of this slot was loaded (e.g. `.verN` restore, cloud restore). |
| T > S + ε | `UNOBSERVED_SAVE` | A save happened that the ledger did not see (mod not installed/armed). Currentness `UNKNOWN` until an observed save. |
| (guid, slot) never seen, but a `SAVE_OBSERVED` exists for this guid with this slot **as target** | `FORK` (Save-As) | Known fork of `loaded_from_slot_id`. |
| (guid, slot) never seen and no save record targets it | `FOREIGN_OR_UNKNOWN` | Not adoptable as current-world fact. |
| sim_id differs from the designated body for this lineage | `BODY_MISMATCH` | Admission refused. |
| last `SAVE_OBSERVED` into (guid, slot) has `loaded_from_slot_id` ≠ slot | `LINEAGE_TRANSFER` | Slot was overwritten with another slot's lineage (Save/Save-As onto an existing slot); classify against the source slot's history. |

Live reclassification: a session whose class is `FOREIGN_OR_UNKNOWN` or
`UNOBSERVED_SAVE` becomes `CONTINUES_LAST_SAVE` for the rest of the session
the moment an armed Owner Save is observed in it (the save captured exactly
the live state). This is also the bootstrap: with an empty ledger, the first
armed Owner Save establishes the lineage. Nothing earlier in that session is
retro-promoted — rows before the save stay `UNKNOWN`-class.

ε (load-time tick drift between save and first poll) is **unknown** and is
measured by the E2-L trial; until measured, ε = 0 and any nonzero drift is
reported, not absorbed.

### 6.4 Why no in-save marker in E2

The master's candidate adds an in-save marker; its purpose is detecting
fork/rollback. Ticks + slot + observed saves detect both for every Owner-UI
path that runs with the mod installed and armed. The residual gap — saves
made while the mod was absent/unarmed — is classified `UNOBSERVED_SAVE`
(honest `UNKNOWN`), not silently accepted. An in-save marker would close that
gap only for saves the mod also wrote, i.e. the same coverage. If the E2-L
trial shows an unclassifiable real case, an in-save marker becomes the
consolidated repair (requires custom tuning; separate review).

## 7. E2-P — pause qualification questions

| # | Question | Evidence |
|---|---|---|
| P1 | Does our GAMEPLAY PAUSED request stop game ticks? | telemetry `paused`, ticks frozen |
| P2 | Does `remove_request` restore the prior speed (NORMAL)? | ticks resume, `clock_speed` |
| P3 | While our request is active, can the Owner unpause from the UI? Which wins? | Owner presses play; telemetry |
| P4 | Interaction with native SUPER_SPEED3 (sleep) | observe if a trial reaches sleep; else `NOT_EXERCISED` |
| P5 | Request survival across stop/disarm: DISARM must remove any live request (fail-safe) | unit + runtime |
| P6 | No persisted save change | saves hash |

Pause is never automatic in E2; only the Owner command pauses.

## 8. Experiment protocol

### 8.1 Commands (native transport lowercases; tokens are lowercase hex/decimal)

```text
ashley_e2.prepare <object_id>      → validates; prints token or rejection code
ashley_e2.sit <token>              → admits once; pushes; prints handle id or rejection
ashley_e2.pause                    → pushes probe PAUSED request (one max)
ashley_e2.release                  → removes it
```

All four require the E1 state machine in SAMPLING (so every action is
observed) and an E2 lineage class of `CONTINUES_LAST_SAVE` or `FORK` whose
designated body is set (below). E1 commands are unchanged.

Body designation: the first successful `prepare` in a lineage records
`DESIGNATED_BODY {guid, slot, sim_id, lineage_class}` in the ledger; later
prepares must match it (`BODY_MISMATCH` otherwise). Designation ≠ identity
(master §7).

### 8.2 Admission (`prepare` → token; `sit` consumes)

`prepare` checks, on the game thread, from one fresh read:
1. armed + SAMPLING; lineage class admissible; body = designated body,
   instantiated, selectable;
2. object exists, offers exactly one 31564 affordance, is not excluded;
3. precondition: Sim's posture target ≠ object (not already seated there);
4. `BODY_BUSY` if any queued or running entry on the body has source
   `PIE_MENU`, `SCRIPT`, `SCRIPT_WITH_USER_INTENT`, or `REACTION`, or is one
   of our own unfinished pushes. Entries with `POSTURE_GRAPH`,
   `BODY_CANCEL_AOP`, `CARRY_CANCEL_AOP`, and `AUTONOMY` are permitted and
   recorded verbatim as competing-cause context (E1: a standing Sim always
   carries a running `POSTURE_GRAPH sim-stand`; autonomy-OFF still yields
   AUTONOMY idles). A foreign **root** for §8.3 = any entry that APPEARs after
   admission with source `PIE_MENU`/`SCRIPT`/`SCRIPT_WITH_USER_INTENT`/
   `REACTION` not in our registry, or any `AUTONOMY` entry targeting the
   experiment object;
5. clock not paused by any source (E2 experiments run unpaused; E2-P separate).

Token = 64-bit random, single use, bound to {object_id, body, lineage,
snapshot ticks}, expires after 30 real seconds. `sit <token>` re-runs checks
1–5 against a fresh read; any change → reject `STALE_SNAPSHOT`; replay of a
consumed token → `REPLAY_REJECTED`. Only then push.

### 8.3 Handle registry and verdict per experiment

Registry record: `{experiment_id, token, object_id, affordance_guid, sim_id,
interaction_id, pushed_wall, pushed_ticks, enqueue_result, states[],
finishing_type, posture_on_target_first_seen, foreign_root_interactions[]}`.
Written as schema-v2 rows (`experiment_*`).

Claim ladder (master §10; each is a separate field, never collapsed):

```text
REQUEST_ACCEPTED   token admitted
ENQUEUED           EnqueueResult truthy + our interaction id in queue view
STARTED            our interaction id observed running
EFFECT_OBSERVED    posture target == object and posture name == the seated
                   signature learned from the N5 Owner-click control on the
                   same chair (run N5 FIRST; the Host never guesses which
                   posture names mean "seated")
ATTRIBUTED         EFFECT_OBSERVED after STARTED, before any foreign root
                   interaction on body/target, precondition absent at admit
MAINTAINED_10S     seated on target for 10 s after ATTRIBUTED
FINISHED           finishing callback or poll; finishing_type recorded verbatim
OUTCOME_UNKNOWN    anything else (legitimate; never guessed)
```

### 8.4 Trial windows (Owner at keyboard, hands off mouse except where stated)

| Window | Action | Expected |
|---|---|---|
| T0 no-command control | 120 s, no commands | no posture change to target |
| N5 Owner-click control (run first) | Owner clicks Sit on the chair, then Stand | observed as `PIE_MENU` root, **no** registry match → classified `OWNER_DIRECT`, not harness; records the seated posture signature for §8.3 |
| T1–T3 experiments | prepare + sit, Sim standing ≥3 tiles away; ≥30 s between; timing chosen ad hoc by Owner | ATTRIBUTED + MAINTAINED_10S; then Owner `stand` click allowed only after FINISHED/60 s |
| N1 wrong target | prepare on a nonexistent id and on a non-chair object | `NO_OBJECT` / `AFFORDANCE_NOT_OFFERED`, no push |
| N2 stale | prepare, wait 35 s, sit | `TOKEN_EXPIRED` |
| N3 changed state | prepare, Owner makes Sim sit on target, then sit | `STALE_SNAPSHOT` |
| N4 replay | reuse a consumed token | `REPLAY_REJECTED` |
| P1–P6 | §7 | §7 |
| L1–L5 lineage | §9 | §9 |

## 9. E2-L trial

1. L1 Owner Save (armed) → `SAVE_OBSERVED`.
2. L2 stop/disarm, reload same slot → classify `CONTINUES_LAST_SAVE`; measure ε.
3. L3 play ≥60 s (armed), stop/disarm, reload without saving → `CONTINUES_LAST_SAVE`
   and rows from L3 marked abandoned branch.
4. L4 Save-As new slot `LAB_E2_FORK` (armed) → `SAVE_OBSERVED` with
   `loaded_from_slot_id`; reload fork → `FORK`.
5. L5 Owner restores an older `.verN` of the LAB slot outside the game
   (optional, Owner decision; file copy by Owner, not the mod) → `ROLLBACK`.
   If skipped: `NOT_EXERCISED`, and rollback stays source-feasible only.

## 10. First-load gate (E2, before any trial)

Same A–M shape as E1 §14, plus:
- N. All new symbols resolve (`push_super_affordance`, `InteractionContext.SOURCE_SCRIPT_WITH_USER_INTENT`,
  `Priority.High`, `QueueInsertStrategy.NEXT`, `object_manager`, `game_clock_service().push_speed/remove_request`,
  `ClockSpeedMode`, `GameSpeedChangeSource`, `get_persistence_service().add_manual_save_complete_callback`,
  `sims4.commands.output`). Missing → STOP, no fallback discovery.
- O. Posture field populated and plausible (standing vs seated) with no exception.
- P. `prepare` on the designated chair returns a token; no push occurs.

## 11. Verdicts

Per trial: `PASS` / `FAIL` / `OUTCOME_UNKNOWN` / `INVALID` (protocol breach) /
`INSTRUMENTATION_FAILURE` (as E1 §24). Stage verdict:

```text
E2_ACCEPTED requires:
  ≥3 experiments ATTRIBUTED + MAINTAINED_10S, zero false attribution
  N1–N5 all behave as specified
  E2-P P1, P2, P5, P6 answered (P3/P4 answered or NOT_EXERCISED with reason)
  E2-L L1–L4 classified correctly (L5 answered or NOT_EXERCISED)
  zero critical telemetry loss; saves change only by Owner saves
```

A failed experiment that is honestly `OUTCOME_UNKNOWN` is not a false claim,
but E2 is not accepted until three attributable successes exist.

## 12. First-use table (master §15 law)

| Mechanism | Enabled in E2? | Qualified by | First dependent capability | Disabled/fallback |
|---|---|---|---|---|
| Harness push (sit class only) | LAB, Owner command only | §8 trials | E4 Thought-endorsed action (after E3, CA-01) | no push path exists outside §8 commands |
| Probe PAUSED request | LAB, Owner command only | E2-P | E4 solo deliberation hold | none automatic |
| Lineage ledger + classification | LAB (and later HOME read-only) | E2-L | HOME creation; E3 current-world adoption | class `FOREIGN_OR_UNKNOWN` blocks adoption |
| Save-complete subscription | while ARMED | E2-L | E3 | inert unless armed |
| In-save marker | NO | — | only if E2-L fails a real case | — |
| UI lock / stasis / guest / scripted save / object edit | NO | later gates | — | — |

## 13. Implementation units and focused tests

| Unit | Tests (host + CPython 3.7) |
|---|---|
| `registry.py` | claim ladder transitions; foreign-root detection; unknown on missing callback; no ENDED from polling |
| `admission.py` | each rejection code; token expiry; single use; replay; stale snapshot diff |
| `lineage.py` | every §6.3 row incl. ε handling, abandoned-branch marking, body mismatch |
| `actuator.py` | stubbed game: exact push call shape/args; never `.interaction` on failed test; speed request single-instance; DISARM removes request |
| `commands.py` | lowercase token transport; adapters reject wrong arity; no action unless SAMPLING |
| observer posture | None-safe; name/target strings |
| schema v2 | new kinds validated; E1 kinds unchanged; bootstrap row unchanged shape + `schema_version 2` |
| guards | E1 denylist intact; actuator allowlist closed; pure modules import no game module |

Build/verify: extend `build.ps1`/`verify.ps1` for the new package name and
guards. No full corpus (docs + sims-e1 only). Internal version `2.0.0`
(product remains Embodiment 1.0.0).

## 14. Owner steps (summary)

1. Accept this plan (or amend).
2. Tell Ashley that body tests are coming (done by Owner per decision).
3. Confirm LAB has one single-seat chair; if not, place one (Owner UI).
4. Run the E2 first-load gate, then T/N windows, E2-P, E2-L in 1–2 sessions.

## 15. Open items carried

| Item | Status |
|---|---|
| ε (load tick drift) | measured in L2 |
| Owner-unpause precedence (P3) | trial |
| Finishing-callback payload/thread | first-load gate |
| Rollback trial via file restore (L5) | SKIPPED (Owner 2026-09-29) → rollback stays source-feasible, `NOT_EXERCISED` |
| Lamp toggle second experiment | deferred (optional) |
| Showing E2 results to Ashley | Owner-mediated until E3 |

## Appendix A. Independent review ledger (author self-review, 2026-09-29)

| # | Finding in draft | Resolution |
|---|---|---|
| R1 | `interaction.id` asserted without evidence | Confirmed `@unique_id('id', 1, MAX_UINT64)` on `Interaction` (bytecode); observer adds `interaction_id` so rows join the registry |
| R2 | `object_manager` / `super_affordances` asserted | `object_manager(zone_id)` and flexmethod `ScriptObject.super_affordances(cls, inst, context)` confirmed; default-zone/`.get` left to first-load gate |
| R3 | Lineage table had no bootstrap (empty ledger ⇒ every first session `FOREIGN_OR_UNKNOWN` forever) and no Save/Save-As onto an existing slot | Added live reclassification on armed Owner Save and `LINEAGE_TRANSFER` |
| R4 | `BODY_BUSY` would reject every standing Sim (E1: `POSTURE_GRAPH sim-stand` always running; AUTONOMY idles with autonomy OFF) | Rule rewritten on source classes with explicit permitted set and foreign-root definition |
| R5 | "posture name is a sit posture" = Host semantic guess | Seated signature learned from the Owner-click control on the same chair; N5 runs first |
| R6 | Save callback registration lifetime | Register on ARM, remove on DISARM (`remove_manual_save_complete_callback` exists) |

Residual risks (accepted, owned by trials): ε unknown; Owner-unpause
precedence unknown; finishing-callback payload unknown; super_affordances
may require a context whose sim is the body (built from the same
InteractionContext used for the push).
