# Project Ashley — Sims 4 Embodiment E0/E1 Implementation-Ready Plan V1.2

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2.md
DOCUMENT_TYPE = CANONICAL E0/E1 IMPLEMENTATION SPECIFICATION (NOT implementation)
NORMATIVE_MASTER =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md
MASTER_SHA256 =
  A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3
SUPERSEDES_FOR_EXECUTION =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_1.md
  (V1.1 SHA 6911D638186CBCD05133EBF6305E0681A9F80A180475BD75A619A77D38B7F641)
PLAN_VERSION = V1.2
DATE = 2026-09-28 Europe/Istanbul
```

**NOT:** E-stage authorization · blanket programme authorization ·
implementation · probe creation (beyond this plan) · helper creation · live
actuation · body binding in production · standing-envelope activation ·
canonical-world inhabitation · runtime proof · autonomous-worker prompt
(deferred to a separate post-acceptance pass).

**HOW TO READ THIS PLAN.** §1 states authority, scope, and authorization
boundaries. §2 pins every baseline. §3 is the E0 Owner procedure (zero
code). §§4–5 state the E1 objective and architecture boundary. §§6–13 are
the mechanical build contract (dependency, layout, bootstrap, runtime
mechanics, allowlist, denylist, schema, logging, threading). §§14–18 are
first-load acceptance, LAB, and the three MUST witnesses plus MAY bounds.
§§19–29 are verification, packaging, evidence, verdicts, stops, constraints,
Owner decisions, pre-build gates, and next steps. Appendices carry the V1.2
repair ledger plus the retained Astra ledger, decision table, trace map, and
provenance. Normative keywords (MUST / MUST NOT / NEVER / FORBIDDEN / STOP)
bind the future implementation worker. Evidence tags follow the master
convention:

`ASHLEY_SOURCE_VERIFIED` · `SOURCE_VERIFIED` · `EXTERNAL_PRIMARY` ·
`CURRENT_DOC_VERIFIED` · `PRIOR_ART` · `SECONDARY` · `INFERENCE` ·
`RUNTIME_UNVERIFIED` · `UNKNOWN`

A future worker receiving V7.3.2a + this plan + the worker prompt needs NO
other packet (no V1, no V1.1, no SR packets, no Astra reviews, no repair
memos) to execute. Every corrected mechanism lives in this document itself.

---

## 1. Status / authority / scope

### 1.1 Plan status

```text
PLAN_STATUS = IMPLEMENTATION_READY_PLAN_V1_2_FOR_FINAL_ACCEPTANCE_REVIEW
PLAN_AUTHORIZES_IMPLEMENTATION = NO
PLAN_AUTHORIZES_RUNTIME = NO
PLAN_AUTHORIZES_E2 = NO
MASTER_ARCHITECTURE_CHANGED = NO
FUNDAMENTAL_MASTER_CHANGE_NEEDED = NO
ADDITIONAL_SOURCE_RESEARCH_REQUIRED = NO
RUNTIME_REQUIRED_BEFORE_PLAN_ACCEPTANCE = NO
E0_READY = YES (Owner procedure, §3)
E1_BUILD_PLAN_READY = YES
E1_RUNTIME_WITNESS_PLAN_READY = YES
FIRST_LOAD_ACCEPTANCE_REQUIRED = YES (§14)
READY_FOR_P1_DLL_CHECK = YES
READY_TO_AUTHOR_IMPLEMENTER_PROMPT = AFTER_FINAL_ACCEPTANCE
READY_FOR_OWNER_BUILD_AUTHORIZATION_AFTER_P1_P3 = AFTER_FINAL_ACCEPTANCE
E2_LEAKAGE = NONE
PLAN_BLOCKERS = NONE (pre-build gates P1–P3 in §28 are executable
  prerequisites, not plan blockers)
```

### 1.2 Authority chain

1. Normative architecture: V7.3.2a master (current/closed). Where this plan
   and the master conflict, the master wins and the worker MUST STOP (§25).
2. This plan: the single canonical E0/E1 execution specification. It absorbs
   V1, V1.1, Astra R1–R8 and C1–C7 repairs, and SR V1.2 mechanics so fully
   that subordinate artifacts are provenance only.
3. Future authorizations (NOT granted here): final plan acceptance →
   pre-build gates P1–P3 (§28) → bounded E1 BUILD grant (OD-3) → bounded
   INSTALL/RUNTIME grant (OD-4) → E1 execution → evidence adjudication → E2
   planning. No step is implied by the prior.

### 1.3 Scope — covered

- E0 Owner procedure (zero code), §3.
- E1 strictly read-only Sims telemetry probe: poll-only observation,
  real-time alarm scheduler, four registered Owner commands (five valid
  invocation forms), Owner-attested binding, build/package/install/witness/
  evidence/removal, §§4–29.
- E1 MUST questions E1-A / E1-B / E1-G; MAY observations as bounded
  opportunistic captures only, §19.

### 1.4 Scope — implementation authorization boundary

Once separately authorized, the worker may touch ONLY:

- `sims-e1/` product source, tools, tests (§7);
- gitignored build output (§7.2) and the single Mods install copy (§22);
- bounded local JSONL telemetry at the approved root (§§12, 22);
- focused tests (§20) and the §23 evidence assembly (copies + manifests).

Build, install, and runtime are SEPARATE grants (§§22, 26–28). No runtime
(game launch with probe, LAB trial, witness run) is authorized by this plan.

### 1.5 Explicit E2 exclusion

E2 and everything after it is FORBIDDEN. Non-exhaustive normative list
(full denylist §10): interaction push/enqueue/cancel; pause/resume or
clock/speed writes; motive/buff/trait writes; autonomy changes; selection
changes; save/save-as/load writes, scripted saves, custom save-data/lineage
writes; travel/spawn/despawn; household/object/Build-Buy mutation; tuning
injection; Mint connection; network I/O; credentials; subprocesses;
synthetic input; Windows helper transport; UI lock; avatar stasis; guest
control; couch co-op; THI/Jev; autonomy envelopes; OA-01/UI-01/RQ-01/Z-01/
BB-01/SV-01 qualification activity beyond passive E1 observation.

If any E1 objective appears to require an item above, the field is
UNAVAILABLE/DEFERRED — never a reason to weaken E1 (§10.4).

---

## 2. Normative master + exact source baseline

### 2.1 Master verification

```text
MASTER_FILE = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md
MASTER_SHA256_VERIFIED = YES (A06C24...E178F3, Get-FileHash, full read)
MASTER_ANCHOR_ASHLEY_SHA = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
MASTER_ANCHOR_ASHLEY_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675
```

### 2.2 Current Ashley baseline (established live at planning time)

```text
REPO_CANONICAL = XharvaK/Ashley
CHECKOUT = C:\Users\Xharv\Projects\Ashley
BRANCH = main
HEAD = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
HEAD_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675
ORIGIN_MAIN = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2 (identical tree, empty diff)
HEAD_SUBJECT = "Repair persisted Owner transport cursors"
HEAD_DATE = 2026-09-28 14:17:23 +0300
RELATION_TO_MASTER_ANCHOR = IDENTICAL (NO_RELEVANT_DELTA)
```

(`ASHLEY_SOURCE_VERIFIED` — `git rev-parse`, tree, diff, and log observed
in-session.) Do not invalidate the master because time passed: STOP only for
a real incompatible delta (§25), which does not exist.

### 2.3 Sims target baseline

```text
SIMS_TARGET = The Sims 4, latest/current BASE GAME, Owner Windows PC
MASTER_GROUNDING_BUILD = PC 1.128.90.1030 / Mac 1.128.90.1230 / Console 2.39
PATCH_DATE = 2026-09-22
TARGET_BUILD_AT_PLAN_TIME = PC 1.128.90.1030 (no newer build found at cutoff)
SIMS_SOURCE_VERIFIED = NO (no game client inspected from the planning checkout)
OWNER_CLIENT_VERIFIED = NO (no Documents\Electronic Arts\The Sims 4 folder present
  on the planning machine; Mods-path probe returned absent)
RUNTIME_UNVERIFIED = YES (all game-runtime facts owed to first-load acceptance + witness)
BUILD_IDENTITY_EVIDENCE = EXTERNAL_PRIMARY (EA official 9/22/2026 patch notes:
  PC 1.128.90.1030) + SECONDARY (community mirrors/trackers confirming the same
  numbers and the 1.128 compatibility-tracker reset)
```

Implementer rule: confirm the Owner client's Main-Menu build string at
first load and record it in the manifest + every bundle (§§14, 23). If the
client build ≠ 1.128.90.1030, STOP (§25) — do not "probably compatible"
forward.

### 2.4 Language / runtime / toolchain baseline

```text
ASHLEY_REPO_STACK = Node.js + TypeScript (agent-service ESM, tsc, vitest)
  (ASHLEY_SOURCE_VERIFIED: package.json, tsconfig, vitest.config)
AGENT_SERVICE_TEST_CMD = npm test --prefix apps/agent-service (vitest run)
DOCS_ONLY_VERIFICATION_FOR_THIS_PLAN = YES (no code changed; no corpus run owed)
PLANNING_MACHINE_TOOLCHAIN = Python 3.14.3 / Node v24.14.1
  (planning-machine fact only; NEVER the in-game compiler)
IN_GAME_RUNTIME_FAMILY = CPython 3.7 (PRIOR_ART + historic EXTERNAL_PRIMARY;
  exact 1.128 patch gated by P1, §28)
MOD_CONFIG_AT_PLAN_TIME = NONE (no Mods folder / no S4CL / no probe installed;
  clean-field assumption; implementer re-verifies at build time)
```

### 2.5 Repo conventions the E1 worker MUST follow

- TypeScript services under `apps/<service>/src`, tests colocated
  `src/**/*.test.ts`, vitest (`ASHLEY_SOURCE_VERIFIED`).
- Shared TS packages under `packages/`; `config/*.example.*` committed, real
  env at `~/.composer-assistant/.env`, never in-repo.
- `node_modules/`, `dist/`, `*.log` gitignored; build output never committed.
- Qualification runners under `scripts/qualification/`; large runtime
  artifacts zipped beside reports. E1 raw telemetry stays OUT of git
  (§§7.4, 12).
- PowerShell 5.1+ is the repo script shell; new E1 tooling scripts MUST be
  `.ps1` (build/verify/install/remove) plus stdlib-only Python/Node checks.

---

## 3. E0 Owner procedure (ZERO CODE)

E0 is Owner-executed, Ashley-participating. No code, mod, telemetry, helper,
or Mint change. Provenance per choice: `THOUGHT_ENDORSED + OWNER_UI` where
the Owner faithfully executes Ashley's choice; any Owner substitution is
`OWNER_DIRECT + OWNER_UI` and MUST be labelled at the time. (Chosen-chooser
rule follows OD-2, §27: if Ashley chooses, traits/aspirations are body
temperament/world-life theme under the boundary laws, never her personality.)

### 3.1 Saves and contamination control

1. Create/identify TWO separate saves: `PREVIEW_E0` (E0 play/design;
   canonical-history-free; never promoted) and `LAB_E1` (reserved for E1;
   E0 NEVER runs in LAB during trial windows — master anti-contamination
   rule). Later HOME is a third, separate save (post-E2 planning).
2. Never open the LAB save for E0 play; never copy PREVIEW households/sims
   into LAB (LAB uses fresh actors, §15); never issue game instructions
   inside witness windows. Accidental LAB contact is a declared protocol
   deviation in the bundle.

### 3.2 Session 1 — Ashley's Sim

1. Owner shares CAS screens/descriptions; Ashley sees each candidate's
   in-game description text before choosing (read verbatim or screenshot).
2. Ashley chooses appearance/body parameters where she wishes. Owner builds
   exactly what she specifies; deviations declared `OWNER_DIRECT`.
3. Traits/aspiration (+ optionally Likes/Dislikes where exposed): Ashley
   selects body temperament / world-life theme; Owner reads each game
   description first. These are body/world facts, NEVER personality,
   preferences, or goals.
4. Iterate with screenshots until Ashley accepts or explicitly defers.
5. Save the accepted Sim to the game library from PREVIEW_E0. Record: Sim
   name, trait/aspiration display text (+ IDs ONLY where the game visibly
   exposes them, else `UNKNOWN`), screenshot IDs, date, save name.

### 3.3 Session 1b — Owner avatar

Owner separately creates their own persistent avatar (`OWNER_DIRECT`, not
Ashley-authored; she may observe/comment). Save to the library; record the
same fields. Do NOT merge households in PREVIEW as a "HOME draft".

### 3.4 Session 2+ — lots/furniture (optional, still E0)

Owner walks Ashley through lot/furniture options (screenshots +
descriptions); Ashley chooses; Owner executes in PREVIEW only. Faithful
execution = `THOUGHT_ENDORSED + OWNER_UI`; taste substitutions =
`OWNER_DIRECT`.

### 3.5 Minimum record per E0 session

Dated note (save name, participants, duration); per choice: Ashley's
verbatim choice, Owner execution note (faithful/substituted + what),
screenshot refs, game IDs where visible, library entry name; explicit
deferred list.

### 3.6 Completion criteria (ALL required)

1. Ashley's Sim designed in PREVIEW_E0 and saved to the library.
2. Owner avatar designed and saved to the library.
3. Per-choice provenance log (endorsed vs owner-direct labelled).
4. Screenshots/descriptions archived with the log.
5. PREVIEW save + library entry names recorded; LAB untouched during trial windows.

### 3.7 What E0 does NOT prove

No bound embodiment, self-execution, telemetry-grounded perception, binding,
lineage, rhythm, co-play, or HOME chronology. First-claim scope only: first
Thought-endorsed, Owner-executed world choice.

---

## 4. E1 objective and claims

### 4.1 Objective

Render the body observable with a strictly read-only in-game probe driven by
a real-time 1 Hz scheduler, operated by four registered Owner console
commands (five valid invocation forms), gated by Owner-attested arming — and
return raw timestamped evidence answering E1-A, E1-B, E1-G without mutating
game state in any way.

### 4.2 MUST claims (evidence owed, §§16–18)

- **E1-A — origin/source visibility:** can observable per-entry metadata
  (`context.source` verbatim) distinguish Owner pie-menu action from native
  autonomy on APPEAR transitions? Both classes MUST have genuine
  opportunities. `ANSWERED_NEGATIVE` is valid evidence with validity proof.
- **E1-B — game time / wall time:** measured ratio at normal/default speed
  on the Owner client via automatic 1 Hz sampling (wall + monotonic +
  ticks). No speed change to answer it.
- **E1-G — save/body identity:** observed `(save_slot_guid, slot_id,
  sim_id)` across Owner-performed Save, Save-As, reloads under explicit
  re-arm. The probe performs no save. No Save-As assumption.

### 4.3 Telemetry foundation

Minimum read-only subset: binding attestation + identifiers, timestamps
(wall + monotonic + game), zone, Sim instantiation, interaction observations
with per-entry identity + verbatim source, motives/buffs MAY, event kinds.
NOT the E3 ingestion system, Mint path, wakes, or memory writes. Schema §11.

### 4.4 Non-claims

Nothing about actuation, pushed-action causality, pause semantics, lineage
efficacy, co-play, stasis, UI lock, envelopes, THI, memory, or E2+.
Polling absence is NEVER an end/outcome claim (§5.4). Logs existing ≠
success (§24).

---

## 5. Architecture boundary + observation model

```text
E1_PATH = SIMS MOD (read-only probe) -> LOCAL JSONL SINK
E1_NETWORK = NONE
E1_MINT = NONE (no ingress, no helper, no credentials)
E1_ACTUATION = NONE
E1_WRITE_TO_SAVE = NONE (including custom data)
E1_SYNTHETIC_INPUT = NONE (ASHLEY_INPUT_EMULATION = FORBIDDEN)
E1_LIFECYCLE_PATCHING = NONE (no injection, no monkeypatching, no veto hooks)
E1_LIFECYCLE_SUBSCRIPTION = NONE (no load/unload/zone callbacks registered;
  all boundaries are Owner-command driven, §5.5)
E1_RUNTIME_DEPENDENCY = NONE (S4CL explicitly NOT bundled/imported/required)
```

Data flow:

```text
[Sims 4 1.128, armed LAB save]
  -> Owner command (arm/start/stop/disarm; attestation + scheduler control ONLY)
  -> real-time alarm 1 Hz -> poll_once() on game thread (read/copy-out ONLY, §13)
  -> immutable plain-data records -> bounded in-memory queue (1024)
  -> background writer thread (file I/O ONLY)
  -> <verified-telemetry-root>\AshleyE1Telemetry\ashley_e1_<session>.jsonl (+ siblings)
  -> witness bundle assembled OUTSIDE the game (copies + manifest, §23)
```

Hard boundaries:

- Probe NEVER opens sockets/pipes/subprocesses/URLs; never reads
  credentials; never touches Mint/Discord/network (§10).
- Probe NEVER writes saves, slots, Sims, households, objects, tuning,
  clock, queues, or settings (§10).
- NO lifecycle monkeypatching, NO injection helper, NO S4CL import, NO
  veto-capable listener, NO lifecycle/unload/zone callback registration of
  any kind (all §13-B1 paths disqualified by construction; SR V1.2 injection
  census: 16/16 traced paths REQUIRE_PATCH, several veto).
- Background threads NEVER call game APIs; game reads happen on the game
  thread inside the alarm callback; only frozen plain-data crosses the queue.
- Probe inert unless armed in an authorized save (§9): otherwise at most one
  bounded `load_disabled` bootstrap diagnostic per load, then silence (§12.2).

### 5.1 Sole observation primitive: poll_once()

`poll_once()` is the ONLY game-state observation entry. On the game thread
it: checks the §5.5 state machine is in SAMPLING (else returns immediately,
no record) → reads the §9 allowlisted getters/iterations → converts
EVERYTHING to plain data (IDs/strings/numbers/bools/None) at copy-out →
`try_put` to the bounded queue → returns. No file I/O, no blocking, no
join, no game mutation. Overrun (previous copy-out still running) skips +
counts `SAMPLER_OVERRUN`. Game refs NEVER escape: live `Interaction`/`Sim`/
`SimInfo` objects are never enqueued, never retained across polls, never
passed to the writer. `entry_key` derivation (`hex(id(...))`) happens
inside copy-out on the game thread; only the hex string crosses the queue.

### 5.2 Real-time scheduler (SR V1.2 contract, PRIOR_ART + acceptance)

Selected call contract (fully qualified; no mystery symbol remains):

```python
import alarms                                          # PRIOR_ART: live S4CL use
from clock import interval_in_real_seconds             # PRIOR_ART: MTS 2021 report
from date_and_time import TimeSpan                     # PRIOR_ART: MTS 2021 report

time_span = TimeSpan(interval_in_real_seconds(1))      # 1-real-second span
alarm_handle = alarms.add_alarm_real_time(
    owner=_PROBE_ALARM_OWNER,      # probe-owned singleton, see below
    time_span=time_span,
    callback=_poll_tick,
    repeating=True,
    use_sleep_time=False,
    cross_zone=False)

alarms.cancel_alarm(alarm_handle)                      # teardown path
```

- `owner` (`_PROBE_ALARM_OWNER`) is a probe-module-owned plain-object
  singleton created once in `probe.py` at `initialize_probe` (§8.3). It
  holds NO game reference (no Sim, no object, no service, no client); it
  exists only to satisfy the alarm API's owner slot and to anchor
  cancellation identity. It creates no world state.
- `callback` (`_poll_tick`) is the probe's module-level alarm function:
  guard SAMPLING → `poll_once()` → `try_put` → return.
- Status: `PRIOR_ART` (2021 MTS author-tested report + EA
  `simulate_to_time.py` lineage; S4CL verifies the sibling `alarms.
  add_alarm`/`cancel_alarm` call shape in live use but never calls the
  real-time variant) + STOP-gated first-load acceptance (§14-D). NOT claimed
  as 1.128 source-verified. Any selected symbol missing at first load =
  `INSTRUMENTATION_FAILURE` + STOP (§25), with NO fallback discovery (no
  game-time alarm, no manual polling, no Zone-update injection).
- Real-seconds basis (independent of game-clock pause — the reason
  game-time alarms and `Zone.update` injection were both rejected).
- `cross_zone=False` means ONLY that the alarm ceases to operate across a
  zone boundary. It does NOT trigger any probe reset, cleanup, or resume.
  Unexpected alarm cessation (dead handle observed, zone change, unannounced
  world transition) → current window INVALID, STOP sampling, explicit Owner
  disarm/re-arm required (§5.5). No silent resume, ever.
- Scheduling/cancelling mutates ONLY probe-owned scheduler state, never
  world state.

Owner flow per window: ONE `ashley_e1.start` → repeating 1 s alarm drives
`poll_once()` → Owner fully hands-off → ONE `ashley_e1.stop` → cancelled.

### 5.3 Owner command contract (four registered commands; five invocation forms)

Registered names (exactly four — no "4–5 commands" wording anywhere in
implementation, tools, or tests):

```text
ashley_e1.arm      (takes one literal argument)
ashley_e1.disarm   (takes no argument)
ashley_e1.start    (takes no argument)
ashley_e1.stop     (takes no argument)
```

Valid invocation forms (exactly five):

```text
ashley_e1.arm LAB_E1
ashley_e1.arm LAB_E1_FORK
ashley_e1.disarm
ashley_e1.start
ashley_e1.stop
```

Registration call form (pinned; per-name `description`/`usage` strings are
fixed literals naming the command; dispatch semantics target-confirmed at
first-load acceptance §14-I):

```python
from sims4.commands import CommandType, CommandRestrictionFlags, register

register('ashley_e1.arm', CommandRestrictionFlags.UNRESTRICTED,
         _cmd_arm, 'Arm the Ashley E1 probe in LAB_E1 or LAB_E1_FORK.',
         'ashley_e1.arm LAB_E1 | ashley_e1.arm LAB_E1_FORK', CommandType.Live)
register('ashley_e1.disarm', CommandRestrictionFlags.UNRESTRICTED,
         _cmd_disarm, 'Disarm the Ashley E1 probe and close the session.',
         'ashley_e1.disarm', CommandType.Live)
register('ashley_e1.start', CommandRestrictionFlags.UNRESTRICTED,
         _cmd_start, 'Start Ashley E1 1 Hz sampling.',
         'ashley_e1.start', CommandType.Live)
register('ashley_e1.stop', CommandRestrictionFlags.UNRESTRICTED,
         _cmd_stop, 'Stop Ashley E1 sampling (remains armed).',
         'ashley_e1.stop', CommandType.Live)
```

Handler signatures (pinned):

```python
def _cmd_arm(arm_name: str, _connection=None) -> bool: ...
def _cmd_disarm(_connection=None) -> bool: ...
def _cmd_start(_connection=None) -> bool: ...
def _cmd_stop(_connection=None) -> bool: ...
```

- `arm_name` is a plain string; the handler accepts ONLY the exact literals
  `LAB_E1` / `LAB_E1_FORK` (case-sensitive, no whitespace tolerated, no
  prefix match). Anything else → return False, state unchanged, bounded
  misuse diagnostic (a `load_disabled`-class single row ONLY if a writer is
  open, else in-memory counter surfaced at next session).
- Return True = accepted and applied; False = rejected, prior state
  untouched. Handlers perform NO game reads beyond the §9 allowlist on the
  `start` path (snapshot population, §5.5), NO file I/O, NO blocking.
- Via vanilla `sims4.commands.register` (call shape `SOURCE_VERIFIED`
  through maintained wrapper use; `PRIOR_ART` for vanilla dispatch
  semantics). No pie menu, dialog, UI, or gameplay surface. Command
  registration has NO unregister path in evidence → restart-required cleanup
  stated truthfully (commands inert while disarmed; never misrepresented as
  hot-unregistered).

Volatile probe-local state ONLY:

```text
probe_state: UNARMED | ARMED | SAMPLING        (§5.5 machine)
armed_name: None | "LAB_E1" | "LAB_E1_FORK"
armed_snapshot: {guid, slot_id, sim_id, wall_ms, monotonic_ns} | None
alarm_handle: handle | None
telemetry_session_id: uuid | None              (allocated at arm)
writer_idle: bool                              (set writer-side on close)
```

Game restart clears all. No persistence, lineage, or save writes.

### 5.4 Truth language (binding)

Presence language ONLY: `PRESENT_AT_T`, `APPEARED_BETWEEN_T0_T1`,
`ABSENT_AT_T`. Polling disappearance MUST NEVER be recorded as `ENDED`,
`CANCELLED`, or `OUTCOME`. Queue-exit = "entry X no longer present at
T+n" — never which of completed/cancelled/failed/superseded, never exact
end time. Schema §11 has no `ENDED` enumerant reachable from polling.

### 5.5 Command-driven session state machine (canonical; no lifecycle hooks)

E1 has intentionally abandoned lifecycle hooks. Session boundaries are
Owner-command driven ONLY. There is no `on_load`, no `on_unload` handler,
no teardown callback registered with the game (V1.1 §9.4's lifecycle
callbacks are WITHDRAWN in full — the probe registers NOTHING with game
systems except the four console commands and its own alarm).

```text
UNARMED
  |  arm <authorized literal>   [requires writer_idle; else reject
  |                               SESSION_PREDECESSOR_UNRESOLVED]
  v
ARMED  (fresh telemetry_session_id allocated; prior snapshot cleared;
        writer file opened; NO sampling yet)
  |  start   [creates at most one alarm; first successful poll populates
  |            armed_snapshot guid/slot/sim, then session_open is emitted]
  v
SAMPLING
  |  stop    [cancel alarm; clear handle; sampling_active=false]
  v
ARMED
  |  disarm  [STOP semantics + clear armed_name/snapshot + signal
  |            writer/session closure WITHOUT blocking the game thread]
  v
UNARMED
```

Rules (binding):

- **ARM** accepts exactly `LAB_E1` / `LAB_E1_FORK`. Reject while SAMPLING
  (return False, state unchanged). On accept: allocate a NEW
  `telemetry_session_id` (UUIDv4), clear `armed_snapshot`, open the session
  writer file (zero lines yet), enter ARMED. If `writer_idle` is False (a
  predecessor session's writer has not confirmed closure) → reject with
  `SESSION_PREDECESSOR_UNRESOLVED`, state unchanged; Owner waits and
  retries. No accumulating writers, ever.
- **START** requires ARMED (else False). Creates at most one alarm (a live
  handle is never duplicated). Repeated `start` while SAMPLING = NO-OP
  SUCCESS (return True; increment `counters.redundant_starts`; V1.1's
  "cancel and restart" behavior is WITHDRAWN). The first successful poll
  populates `armed_snapshot` (read-only guid/slot/sim triple + stamps) and
  only then is `session_open` emitted (§12.2). Snapshot values are recorded;
  continuity is NEVER required.
- **STOP**: if SAMPLING → `cancel_alarm`, clear handle, not sampling; if
  already ARMED/not sampling → no-op success (True). Remains ARMED either
  way.
- **DISARM**: STOP semantics, then clear `armed_name` + `armed_snapshot`,
  emit best-effort `session_close` via the writer queue, SIGNAL writer
  shutdown (set event, return immediately — no I/O, no join, no wait),
  enter UNARMED. The writer closes on its own bounded writer-side deadline
  and then sets `writer_idle=True`. Closure is an explicit Owner-session
  boundary, never an automatic unload/reset.
- **LOAD / RELOAD (all of them, including every E1-G step):** because no
  lifecycle hook exists, the Owner MUST `stop` + `disarm` BEFORE every
  load/reload transition, and `arm <expected literal>` + `start` only AFTER
  the Owner confirms return to live play (§18 completion conditions). Any
  world transition observed without this sequence → window INVALID, STOP
  sampling, explicit disarm/re-arm required. No automatic anything.
- **Unexpected alarm cessation:** dead handle, zone change, unannounced
  transition → window INVALID, STOP sampling, explicit Owner disarm/re-arm.
  `cross_zone=False` is a cessation fact, not a cleanup mechanism.

---

## 6. Dependency decision — NO S4CL for E1 (direct minimal interfaces)

```text
E1_DEPENDENCY = NONE (vanilla interfaces only; S4CL explicitly NOT bundled,
  NOT imported, NOT required at runtime)
S4CL_STATUS = SOURCE-REFERENCE ONLY (consulted at db1ca99 / v3.22 pre-1.128;
  latest release at plan time still v3.22 2026-08-27; no 1.128 clearance citable)
```

Reason (compared on maintenance, compatibility, API stability, surface,
packaging, risk, scope): S4CL releases lag patches by design and none
clears 1.128; E1 needs only a tiny read surface (identity, clock-read,
queue-iterate, motive/buff-read, save-slot reads) where vanilla is the most
stable layer; S4CL would add a second version gate, a `.config` companion,
dialog/test frameworks E1 MUST NOT use, and the exact injection machinery
§5 forbids. S4CL stays a consulted source (hook shapes, service names);
cite `s4cl_source_consulted: db1ca99` informationally in the manifest.
Reconsideration at E2+ ONLY with a 1.128-cleared S4CL release + a named
vanilla-insufficient need + dual-gate rollback recorded. E1 evidence MUST
NOT depend on S4CL existing.

Build-time (non-runtime) dependencies: system Python 3.7.x (post-gate P2/P3)
for compilation; PowerShell 5.1+ scripts; repo-present Node for JSON checks.
No pip packages. No installs under this plan (§1.4).

---

## 7. Source / module / package layout

All paths relative to repo root. Package `ashley_e1` (top-level inside the
`.ts4script`; no `s4cl` namespace, no agent imports). Game-touching reads
ONLY in `observers.py`/`snapshot.py`; file I/O ONLY in `writer.py`; `probe.
py` owns initialization + state machine + commands + alarm. A read in
`writer.py` or a write outside `writer.py` fails review.

### 7.1 PRODUCT SOURCE (committed)

```text
sims-e1/
  README.md                      # E0/E1 pointer + this-plan reference
  src/
    ashley_e1/
      __init__.py                # E1_PROBE_VERSION + initialize_probe() call ONLY
      probe.py                   # initialize_probe, state machine, 4 commands, alarm create/cancel
      observers.py               # poll_once() read-only getters/iterations ONLY
      snapshot.py                # immutable plain-data record construction
      schema.py                  # schema_version + validators (pure)
      writer.py                  # background JSONL writer (file I/O only)
  tools/
    build.ps1                    # 3.7 compile + package .ts4script
    verify.ps1                   # package/load/static-guard/schema checks
    check_guards.py              # AST allow/deny gate (stdlib only; deny table lives HERE)
    install.ps1                  # copy artifact -> Mods\AshleyE1 (+ backup step)
    remove.ps1                   # remove artifact + verify absence
  tests/
    guard_tables.py              # verification-only allow/deny tables (NOT shipped)
    test_schema.py               # schema/validator/missingness/vocabulary tests
    test_bounds.py               # rotation/queue/drop-cap-stop tests
    test_sequence.py             # session/sequence/monotonicity tests
    test_guards.py               # AST allow/deny tests over src/ (+ harmless-string fixtures)
    test_binding.py              # arm literals + re-arm flow tests
    test_session.py              # state-machine + predecessor + reload re-arm tests
    test_bootstrap.py            # init-once + secondary-import purity + no pre-start alarm
    test_identity.py             # entry_key/membership/APPEAR-loss tests
    test_root.py                 # component-safe derivation + no-write-on-failure tests
    test_package.py              # magic/layout/entry/__pycache__ tests
  evidence/
    .gitkeep                     # RAW LOGS NEVER COMMITTED (§7.4)
```

There is NO shipped `guards.py`: verification-only deny tables live under
`tests/` + `tools/` precisely so runtime-source checks never conflict with
a shipped deny-table (§10.1).

Python focused tests run `python -m unittest discover` (stdlib only; the
3.7 compiler runs them too). TS corpus NOT gated on E1 (§20.8).

### 7.2 BUILD OUTPUT (never committed)

```text
sims-e1/build/
  ashley_e1_<VERSION>.ts4script
  ashley_e1_<VERSION>.sha256
  manifest.json   # §§8, 23 fields incl. compiler pin, magic, SHAs, game imports
```

`build/` gitignored via a scoped `sims-e1/.gitignore` (worker adds it; does
not rewrite root ignores).

### 7.3 LOCAL SIMS INSTALL (Owner PC, outside repo)

```text
<installer-confirmed-root>\Mods\AshleyE1\ashley_e1_<VERSION>.ts4script
```

One folder deep (ts4script depth rule `CURRENT_DOC_VERIFIED`). Exactly one
copy. No companion config. No `.package` (tuning override unavoidable →
STOP, §25). The root is the installer-confirmed value recorded in the
install manifest (§12.1), never a probe guess.

### 7.4 RUNTIME EVIDENCE (outside git; privacy-preserving)

- In-game sink: `<verified-root>\AshleyE1Telemetry\`
  `ashley_e1_<telemetry_session_id>.jsonl` (+ rotation siblings) plus one
  bootstrap file per load `ashley_e1_bootstrap_<boot_id>.jsonl` (§12.2).
- Witness bundles `sims-e1/evidence/<witness-id>/` hold COPIES + manifests +
  notes. `sims-e1/evidence/.gitignore` covers `*.jsonl*`; only manifests,
  verdicts, and redacted excerpts (≤50 lines, `%USERPROFILE%`-tokenized
  paths) may be committed.
- Privacy: no chat/Discord IDs; no Sim/household/lot display names (FNV-1a
  hex8 hashes where correlation needs a label); large IDs lossless (§11).

---

## 8. Sims runtime / package mechanics + build contract

### 8.1 Target family and magic (planning contract; pin gated by P1–P3)

```text
TARGET_FAMILY = CPython 3.7 (EXTERNAL_PRIMARY historic migration 3.3.5->3.7.0 +
  CURRENT_DOC_VERIFIED tooling convention + PRIOR_ART workspace/decompiler corroboration;
  exact 1.128 patch gated by P1)
EXPECTED_MAGIC = 3394 + CRLF (SOURCE_VERIFIED, CPython v3.7.0 _bootstrap_external)
OPTIMIZE = 0 (no -O; asserts preserved)
INVALIDATION = timestamp (default; checked-hash only under SOURCE_DATE_EPOCH discipline)
SOURCE_PATHS = normalized relative package paths (no absolute checkout leaks)
```

System Python 3.14 MAY package/inspect (header parsing is version-agnostic
byte work); it MUST NEVER compile game-target modules.

### 8.2 Artifact mechanics (binding)

- `.ts4script` = zip with legacy adjacent `.pyc` ONLY:
  `ashley_e1/__init__.pyc` + sibling-module `.pyc` (mechanism: 3.7
  `compileall -b` / `py_compile` legacy placement; verified by unzipping +
  listing). `.py`-only = treated-as-empty (prior-art loader matrix) → all-
  `.pyc` ships; dual `.py`+`.pyc` forbidden (loader prefers `.py` —
  ambiguity disqualifying for evidence). No `__pycache__`, no `.pyo`,
  no vendored libraries, no `sims4communitylib/`.
- Entry: top-level package import on loader scan (`PRIOR_ART` discovery
  rules; exact bootstrap call target-unverified → first-load acceptance
  proves execution via the artifact's own `load_disabled` bootstrap witness,
  §14).
- Versioning: `E1_PROBE_VERSION = "1.0.<n>"` monotonic; embedded in
  `__init__`, filename, manifest, and every record. Any shipped-byte change
  bumps `<n>`.

### 8.3 Package bootstrap (explicit initialization path)

`ashley_e1/__init__.py` contains EXACTLY (modulo comments/evidence tags):

```python
E1_PROBE_VERSION = "1.0.0"

from .probe import initialize_probe
initialize_probe()
```

`initialize_probe()` (in `probe.py`) is idempotent via a module-level
`_INITIALIZED` flag: first call registers the four commands (§5.3), creates
`_PROBE_ALARM_OWNER`, sets state UNARMED, derives the telemetry root (§12.1)
and — ONLY if derivation succeeds — opens the bootstrap file and writes the
single `load_disabled` row (§12.2); repeat calls return immediately with no
further effect. Initialization does NOT create an alarm, does NOT spawn the
session writer, does NOT begin sampling.

Importing secondary modules (`observers`, `snapshot`, `schema`, `writer`)
MUST NOT independently register commands, spawn writers/threads, or schedule
alarms — enforced by `test_bootstrap.py` (import each module in isolation
under stubbed game modules; assert zero registrations, zero threads, zero
alarms) and by review (no `register(`, no `Thread(`, no `add_alarm` outside
`probe.py`).

### 8.4 Install / enable / verify-load (mechanical; commands §22)

1. Game closed. Back up `Mods/` + `saves/` + `Tray/` (bounded backup; §22).
2. Copy artifact to `<installer-confirmed-root>\Mods\AshleyE1\` (exactly one
   copy; duplicate probe-package check incl. renamed zips).
3. Delete `localthumbcache.package` (installer action, never probe behavior).
4. Game Options → Other → CC+Mods ON, Script Mods Allowed ON; Apply; full
   restart. Mods list shows exactly one `ashley_e1` entry with matching
   version (else §8.5 STOP). Presence ≠ execution proof — the artifact's
   `load_disabled` bootstrap witness is the loader proof (§14).

### 8.5 Mod load ambiguity rule

>1 `ashley_e1` entry, version mismatch filename-vs-self-report, or no
`load_disabled` within 2 min of stable LAB load → STOP as mod-load ambiguity
(§25) or `ROOT_OR_BOOTSTRAP_UNRESOLVED` (§12.1) respectively. Do not "test
anyway".

### 8.6 Removal / rollback

`remove.ps1`: game-closed check → delete exact artifact → delete
`localthumbcache.package` → verify glob empty + no new telemetry writes on
a removal-load. Rollback: remove + restore bounded backup WITHOUT
overwriting later Owner changes (no blind full-Mods restore). Saves
untouched (probe never wrote them).

---

## 9. Read-only API / hook allowlist (exact, mechanical)

Principle: read-only = no state-changing call/flag, no veto-capable
subscription, no side-effecting import, no lifecycle registration. Every
item needs first-load acceptance on 1.128; anything unverifiable is
DEFERRED, not improvised. Evidence class per symbol: `PRIOR_ART` (S4CL
`db1ca99` wrapper bodies verified; vanilla producer semantics
target-unverified) unless noted.

### 9.1 Approved imports (closed set for shipped source)

```text
VANILLA: services, sims.sim.Sim, sims.sim_info.SimInfo(+manager),
  server.clientmanager (via services.client_manager()), clock
  (interval_in_real_seconds + read fns),
  date_and_time (DateAndTime/TimeSpan constructors + MILLISECONDS_PER_SECOND),
  scheduling (Timeline type ONLY as annotation — no alarm creation through it),
  alarms (add_alarm_real_time + cancel_alarm ONLY),
  sims4.commands (register for the four Owner commands ONLY),
  interactions.context (InteractionContext/SOURCE_* read ONLY),
  objects (HiddenReasonFlag/ALL_HIDDEN_REASONS constant ONLY),
  protocolbuffers-free (no proto import needed by probe)
STDLIB: time (time/time_ns/perf_counter[_ns] reads ONLY), sys (version ONLY),
  json, os (join/makedirs/stat ONLY under telemetry root), os.path + pathlib
  (component-safe derivation/comparison ONLY, §12.1), threading (writer Thread
  + Event ONLY), queue (bounded Queue ONLY), uuid, hashlib (FNV-1a implemented
  locally or hashlib), struct
```

Any other import in shipped source FAILS verification. Dynamic import
(`importlib`, `__import__`, reflective `getattr` dispatch of game methods)
in shipped code is FORBIDDEN. Allow/deny tables live in `tests/
guard_tables.py` + `tools/check_guards.py` (verification-only, §10.1).

### 9.2 Approved reads (poll_once body; game thread only)

```text
R1 save/slot: services.get_persistence_service().get_save_slot_proto_guid() -> int;
  get_save_slot_proto_buff().slot_id -> int (PRIOR_ART; transient states UNKNOWN;
  completion-point rule §18)
R2 body lookup + SINGLETON PREDICATE (mechanical; worker MUST NOT invent another):
  candidates = services.sim_info_manager().get_all()          (PRIOR_ART)
  eligible(si) = si is not None
    AND si.get_sim_instance() is not None                    (R3 instantiated read)
    AND the instance's selectability read is True            (allowlisted selectability read)
  REQUIRE len(eligible) == 1 → the LAB Sim.
  len == 0 or len > 1 → emit guard_exhausted, take NO substantive record,
  STOP sampling for the window: LAB_IDENTITY_AMBIGUOUS (§25). The Owner fixes
  LAB composition (one-Sim household, §15); explicit re-arm required after.
  (LAB one-Sim setup makes selection deterministic; the predicate above is the
  complete rule — no household-name matching, no first-seen trust.)
R3 sim_id/instantiation: SimInfo.id -> int; sim_info.get_sim_instance(
  allow_hidden_flags=...) None <=> SIMINFO_ONLY (PRIOR_ART)
R4 active/selection (MAY-grade, omit-if-absent): services.client_manager().
  get_first_client().active_sim[_info] (PRIOR_ART)
R5 queue/current: tuple(sim.queue) ordered iteration; tuple(sim.si_state) running set;
  per entry: process-local entry_key hex(id(entry)) (computed at copy-out),
  guid64, affordance id, display/short text, target id,
  interaction.context.source verbatim, context.sim id (PRIOR_ART shape)
R6 clock: services.time_service().sim_now -> DateAndTime; absolute_ticks() [ms scale
  per wrapper docstring — reconfirmed at witness vs wall truth]; hour/minute/second/
  day/week + absolute_* variants; services.game_clock_service().clock_speed
  (ClockSpeedMode PAUSED/NORMAL/SPEED2/SPEED3/INTERACTION_STARTUP_SPEED/SUPER_SPEED3),
  current_clock_speed_scale() (PRIOR_ART; rollover UNKNOWN, negligible in 15-min windows)
R7 wall/monotonic: time.time()/time_ns + time.perf_counter[_ns]
  (perf_counter import+call SOURCE_VERIFIED in shipped S4CL; 1.128 parity RUNTIME_UNVERIFIED
  until §14-F self-report)
R8 motives (MAY): statistic-getter chain ONLY (has/get/is_locked/value; PRIOR_ART)
R9 buffs (MAY): BuffComponent iteration + Buff.guid64 + has_buff (PRIOR_ART);
  NO listener registration in the E1 build (poll covers MAY needs)
R10 zone/selectability (MAY-grade, omit-if-absent): zone/lot/room/position/selectability
  where exposed without hooks
```

If any R-item requires a mutating call on 1.128 → `UNAVAILABLE_DEFERRED`,
recorded in `unsupported[]`; MUST NOT use a write-to-read shortcut (§10.4).

### 9.3 Scheduler + commands (the only "registration" in E1)

- `alarms.add_alarm_real_time(...)` / `alarms.cancel_alarm(...)` per §5.2
  (PRIOR_ART + §14-D acceptance). No other alarm/timeline/Zone-update use.
- `sims4.commands.register` for exactly the four names in §5.3. No other
  command, no help-text trick that shows UI, no cheat-flag escalation beyond
  `Live` + `UNRESTRICTED` scope already proven harmless in wrapper use.

### 9.4 No lifecycle callbacks (withdrawal notice)

V1.1 §9.4 (`on_load` / `poll_tick`-as-hook / `on_unload/teardown-signal`
as game-registered callbacks) is WITHDRAWN. The probe registers NOTHING
with game systems except the four console commands (§5.3) and its own alarm
(§5.2). `_poll_tick` is the alarm callback, not a lifecycle hook. Writer
shutdown is signalled by `disarm` (§5.5), never by an unload notification.

---

## 10. Mutation denylist (binding)

```text
D-PUSH  sim.push_super_affordance / queue append/run/start / InteractionQueue.*mutators /
        interaction .cancel/.execute/.test_and_execute / AffordanceObjectPair.execute
D-MOTIVE statistic/motive set/increase/decrease/add/remove, buff add/remove,
        trait/aspiration add/remove, want/fear fulfil/toggle, statistic modifiers
D-CLOCK set_clock_speed / pause_the_game / set_current_time / advance_current_time /
        any GameClock setter
D-SAVE  persistence save_using / save_game_gen invocation / save-slot write /
        custom save-data write / SaveGameData mutation
D-AUTO  autonomy enable/disable/category set (even "to observe")
D-SELECT selection/active-Sim/selectability setters
D-TRAVEL travel/zone-change request, household move, spawn/despawn/destroy/reset
D-HOUSE household add/remove/merge, funds cheat, aging/story/career setters
D-OBJECT Build/Buy place/move/sell, object state set, inventory move
D-TUNING tuning inject/override, XML patch, .package write
D-UI dialog/notification/pie-menu registration, camera move, prompt answer
D-NET socket/ssl/http/urllib/subprocess/os.system/pipe/shm server/Discord/Mint import
D-CRED any credential/key/token file read beyond game build identity
D-INPUT synthetic key/mouse/cursor/gamepad injection of any kind
D-PATCH CommonInjectionUtils/inject_safely_into or equivalent setattr-patching,
        S4CL event-registry/dispatcher import or equivalent listener framework,
        s4cl.* import of any kind, any game lifecycle/unload/zone callback registration
```

### 10.1 AST-only static guard (no lexical bans)

`tools/check_guards.py` (stdlib `ast` only; deny table lives in that file,
mirrored in `tests/guard_tables.py` — verification-only, never shipped)
plus `verify.ps1` enforce over `sims-e1/src/`:

(a) import allowlist = §9.1 closed set (any other top-level import FAILS);
(b) forbidden-call set = §10 dotted names resolved alias-aware (`import X
as Y`, `from M import N as O`, and attribute-call targets
`obj.<mutator>(...)` where `obj` binds to a game module — tracked through
assignment);
(c) no `importlib` / `__import__` / `eval` / `exec` / `compile(` in shipped
source;
(d) no `open(` outside `writer.py`;
(e) writer game-import edge: `writer.py` imports NO game/VANILLA module.

Comments and strings are DATA: no rule fails on word appearance. Mandatory
fixtures in `test_guards.py` prove ALL of these PASS: a module containing
`autonomy_setting = 1`, the words `save` / `native_autonomy` in comments,
denylist symbol names (`push_super_affordance`, `save_using`) quoted inside
test fixtures and docstrings — while an actual aliased mutator call
(`import sims.sim as _s; _s...` call shape, or `from x import push as p;
p(...)`) FAILS. Any raw text-grep gate over source (e.g. banning
`autonomy.*set` as text) is FORBIDDEN in `verify.ps1` and in the E2-leakage
gate (§26.6).

### 10.2 Runtime boundary

Approved-reader-functions-only; no mutator call (review + AST); no live
game ref leaves the game thread (construction rule in `snapshot.py` — only
`int/str/float/bool/None/list/dict` cross, plus the `entry_key` hex string);
plain-data copy before queue. Violation = code defect, caught pre-build.

### 10.3 Game-thread restriction

All game-state reads on the game thread inside the alarm callback. No lock
held across file I/O. Writer thread imports NO game modules (import-edge
check in verify).

### 10.4 Weakening prohibition

MUST field unobtainable read-only → `availability: UNAVAILABLE_DEFERRED` +
`reason: requires_mutation:<name>` (or `no_passive_path:<name>`), continue
everything else. STOP only if a MUST verdict becomes impossible (§25);
otherwise return the honest bounded/negative verdict.

---

## 11. Minimal E1 observation contract (versioned)

`OBSERVATION_SCHEMA_VERSION = 1` (`e1.telemetry/v1`; single version for all
V1.2 records — V1/V1.1 never shipped, so no migration exists; any future
change bumps the integer and the plan). E3 is NOT frozen by this schema
(§11.8).

### 11.1 Envelope (every line; key order fixed for digest stability)

```jsonc
{ "schema_version": 1,
  "telemetry_session_id": "uuidv4|null",  // session UUID; null ONLY on load_disabled
  "boot_id": "uuidv4|null",               // bootstrap-load UUID; required on load_disabled
  "written_sequence": 0,                  // uint, contiguous WRITTEN order, starts 0
  "wall_timestamp_ms": 0,                 // int, time.time()*1000 at copy-out
  "monotonic_ns": 0,                     // int, perf_counter_ns() (fallback perf_counter()*1e9)
  "game": { "ticks": 0,                   // int absolute_ticks() or null
             "calendar": "string|null",    // verbatim datetime string
             "clock_speed": "STRING|null", // ClockSpeedMode name verbatim
             "paused": true },             // true/false/null (null NEVER validates a window)
  "probe_version": "1.0.0",
  "sims_build": "1.128.90.1030",          // Main-Menu string at bootstrap
  "event_kind": "session_open",           // closed enum §11.3
  "reason": "string|null",                // ≤128 chars; failure/close cause (§11.3)
  "checkpoint_reason": "PERIODIC_60S|ROTATION|PRE_DISARM|null",
  "close_reason": "DISARM_CLEAN|CAP_REACHED|FAILED_STICKY|ARMED_NEVER_STARTED|null",
  "observation_complete": true,           // bool on observation rows; null elsewhere
  "attestation": { "armed_name": "LAB_E1|LAB_E1_FORK|UNARMED",
                   "armed_name_hash": "hex8|null",
                   "snapshot_guid": "string|null",
                   "snapshot_slot": "string|null",
                   "snapshot_sim": "string|null" },
  "save": { "save_slot_guid": "string|null", "slot_id": "string|null" },
  "zone": { "zone_id": "string|null", "lot_id": "string|null",
             "room": "string|null", "position": "[x,y,z]|null" },
  "body": { "sim_id": "string|null", "instantiated": true,
             "is_selectable": true, "is_selected": false,
             "posture": "string|null" },
  "interactions": { "observed": [ { "entry_key": "hex|null",   // §11.2 process-local id
      "membership": "QUEUED|RUNNING|QUEUED_AND_RUNNING",       // §11.2
      "affordance_id": "string|null",
      "affordance_text": "string|null", "target_id": "string|null",
      "source_raw": "string|null",                             // verbatim context.source
      "source_norm": "OWNER_UI|SCRIPT_DIRECTED|UNKNOWN",       // §11.2 mapping
      "source_confidence": "EXPOSED|UNKNOWN",                  // §11.2 per-entry
      "present": true } ],
    "queue_truncated": false, "running_truncated": false,
    "observation_complete": true },                            // §11.2 APPEAR gate
  "motives": [ { "id": "string", "value": "number|null", "band": "string|null" } ],
  "sim_signals": [ { "kind": "MOODLET|WANT|FEAR|TRAIT_NOTE|LIKE|ASPIRATION_NOTE|RELATIONSHIP_NOTE|FAILURE_PRECURSOR",
      "tuning_id": "string|null", "game_text": "string|null",
      "magnitude": "string|null", "consequences": "string|PARTIAL|UNKNOWN",
      "native_override": null } ],          // null/UNKNOWN default; NEVER false by default
  "missingness": {},      // field -> {"status": MISSING|ABSENT|UNSUPPORTED|UNKNOWN,
                          //           "detail": "string|null"} (§11.4)
  "unsupported": [],      // allowlisted-but-unavailable-on-1.128 names
  "availability": "AVAILABLE|UNAVAILABLE_DEFERRED",
  "counters": { "dropped_queue": 0, "dropped_overrun": 0, "dropped_serialize": 0,
                "redundant_starts": 0 },
  "writer": { "state": "OK|CAP_REACHED|FAILED_STICKY", "rotation_index": 0 },
  "note": "string|null" } // bounded §11.7; NEVER Owner free text
```

### 11.2 Interaction identity + APPEAR semantics (binding)

- `entry_key`: `hex(id(interaction))` computed at copy-out on the game
  thread (or equivalent process-local object identity). Semantics NARROW:
  valid ONLY within one `telemetry_session_id`; NOT a durable Sims handle;
  NOT stable across restart/reload/new session; NOT evidence of identity
  across an unobserved gap; used ONLY to compare adjacent COMPLETE
  observations. Repeated same affordance/target values stay distinguishable
  through `entry_key`.
- `membership`: `QUEUED` (in `tuple(sim.queue)` only), `RUNNING` (in
  `tuple(sim.si_state)` only), `QUEUED_AND_RUNNING` (same live object in
  both — deduplicate by `entry_key`, record both memberships). Queue and
  running are collected as SEPARATE memberships, never merged silently.
- APPEAR: an entry APPEARS only when ALL hold: previous observation is
  COMPLETE + current observation is COMPLETE + same telemetry session +
  `entry_key` absent in previous + present in current. An observation is
  COMPLETE iff `interactions.observation_complete == true` (false when: any
  drop counter advanced since the previous poll, queue/running truncation
  active, poll skipped/overrun, or no valid baseline exists). NEVER infer
  APPEAR across: dropped poll, queue/running truncation, missing baseline,
  restart, reload, new session, writer/capture fault. A transition touching
  an incomplete observation is UNUSABLE — no inferred repair (§17 loss
  policy).
- Source mapping (conservative; E1-A §16): `source_norm: OWNER_UI` ONLY on
  the confirmed player-click verbatim value on 1.128; `SCRIPT_DIRECTED`
  ONLY on the confirmed script-with-user-intent stamp; everything else
  (including any autonomy-shaped value — S4CL side has NO autonomy enum
  value at all) → `UNKNOWN`. Per-entry `source_confidence: EXPOSED` only
  when the mapping above was proven at the witness; else `UNKNOWN`. The old
  global `source.origin_confidence` object is REMOVED (one ambiguous global
  replaced by per-entry confidence). Never invent `NATIVE_AUTONOMY` from
  silence.

### 11.3 Event-kind enum (closed) + per-kind payload contract

```text
session_open | session_checkpoint | session_close | zone_snapshot |
presence_snapshot | clock_snapshot | save_observation | guard_exhausted |
dropped_summary | load_disabled | cap_reached | writer_failed
```

No `interaction_event/ENDED`, no `witness_marker`, no `save_marker`, no
rotation-specific kind (rotation uses `session_checkpoint` with
`checkpoint_reason: ROTATION`), no other kind. Per-kind contract
(R = required non-null; N = MUST be null/absent; O = optional):

```text
load_disabled:        R {boot_id, wall, monotonic, probe_version, sims_build,
                       schema_version, runtime facts}; telemetry_session_id N;
                       attestation.armed_name=UNARMED fixed; save/zone/body/
                       interactions/motives/sim_signals N-or-empty; reason O.
                       (bootstrap/import/runtime facts ONLY — §12.2.)
session_open:         R {telemetry_session_id, wall, monotonic, attestation
                       (armed_name set + snapshot POPULATED from first poll),
                       save, zone, body}; reason N.
session_checkpoint:   R {telemetry_session_id, checkpoint_reason, counters,
                       writer}; PERIODIC_60S also carries clock/game summary.
session_close:        R {telemetry_session_id, close_reason, final counters};
                       best-effort, writer-side (§12.2).
presence_snapshot:    R {telemetry_session_id, observation_complete bool,
                       interactions{}, attestation, save, zone, body,
                       wall, monotonic}.
clock_snapshot:       R {telemetry_session_id, wall, monotonic, game{}};
                       observation_complete O (clock rows are not APPEAR inputs).
zone_snapshot:        R {telemetry_session_id, zone, wall, monotonic}.
save_observation:     R {telemetry_session_id, save{}, attestation, wall,
                       monotonic, observation_complete=true}.
guard_exhausted:      R {telemetry_session_id-or-null, reason (e.g.
                       LAB_IDENTITY_AMBIGUOUS:<0|2+>), wall, monotonic}.
dropped_summary:      R {telemetry_session_id, reason
                       (QUEUE_SATURATION|SAMPLER_OVERRUN|SERIALIZE_FAILURE),
                       count in counters}; observation fields N.
cap_reached:          R {telemetry_session_id, writer.state=CAP_REACHED,
                       reason}; best-effort only.
writer_failed:        R {telemetry_session_id, writer.state=FAILED_STICKY,
                       reason}; best-effort only; NO further rows after it
                       except a counted close attempt (no recursion, §12.7).
```

`writer.state` is ONLY `OK | CAP_REACHED | FAILED_STICKY`; failure cause
belongs in `reason`, never in a fourth state.

### 11.4Vocabulary (canonical; one spelling)

`missingness` maps field → `{"status", "detail"}` where `status` is exactly
one of `MISSING` (expected but unreadable now) / `ABSENT` (verified
non-present, e.g. empty queue) / `UNSUPPORTED` (allowlisted but no 1.128
path — also listed in `unsupported[]`) / `UNKNOWN` (genuinely not
determinable). Older spellings (`UNEXPOSED`, `UNREADABLE:<why>`) MUST NOT
appear in records, tests, or verdicts — detail strings carry the why.
`MISSING != ABSENT` (master §4). `UNKNOWN` legitimate for any
consequence/source field the game does not deterministically expose.

### 11.5 Boundedness

Queue+running observed capped at 8 entries each (game order; overflow →
`queue_truncated/running_truncated: true` + counted + `observation_complete:
false`). `motives[]` ≤12, `sim_signals[]` ≤16 (failure-precursors first).
Caps are schema facts; changing them bumps `schema_version`.

### 11.6 Lossless IDs and strings

IDs that can exceed JSON-safe integer range serialize as STRINGS (guid,
slot, sim, tuning/affordance ids — always strings, never coerced numbers).
Every string field bounded (display text ≤160 chars, ids ≤64, note/reason/
detail ≤256/128/128); max serialized record 8 KiB (larger → drop +
`dropped_serialize`, never truncate-and-write). Queue capacity 1024 × 8 KiB
= 8 MiB is a SERIALIZED-PAYLOAD upper bound on queued record bytes — it is
NOT a claim about total Python heap usage (object overhead untracked by the
plan; validated via §21 drop/overrun counters, not memory assertions).

### 11.7 No Owner text in telemetry

Owner witness notes (T/W-times, click descriptions, attestations) stay in
external `witness_*.md`. The probe accepts only the two arm literals; no
free-text argument exists on any command.

### 11.8 E3 non-freeze

This schema is the E1 witness vehicle, not future BodyState. No E3
ingestion/wake/memory field may be smuggled in "for later" — First-Use
Law (master §15): OA-01/UI-01/RQ-01/Z-01/BB-01/SV-01 preparatory code
FORBIDDEN unless mechanically unavoidable for read-only telemetry, in which
case STOP as a planning question, not silent scope.

---

## 12. Logging contract (bounded local telemetry only)

### 12.1 Format and root (exact; installer-confirmed, runtime-derived)

- JSONL, UTF-8, LF, one record per line, no BOM, key order §11.1.
- Under OD-4 the installer receives the EXACT Owner-confirmed Sims
  user-data root. The installer MUST: (1) validate it (exists; contains or
  can host `Mods`); (2) derive `<root>\Mods`; (3) verify destination
  `<root>\Mods\AshleyE1\`; (4) copy the exact artifact; (5) record
  root/destination/artifact-SHA in the install manifest; (6) ensure the
  package's resulting module path is structurally beneath
  `<root>\Mods\AshleyE1\`. There is NO runtime configuration channel — the
  probe never receives the root any other way.
- Runtime probe derives the root ONLY from its actual installed `__file__`
  path using component-safe logic: resolve the path, split into components,
  scan from the right for an adjacent `('Mods', 'AshleyE1')` component pair;
  root = join of components before it; verify structural shape
  `<root>/Mods/AshleyE1/<artifact-or-package-internals>`. Naive textual
  `partition("Mods")` (matchable by arbitrary path substrings) is
  FORBIDDEN. The runtime performs NO second comparison against the
  Owner-confirmed root (unavailable in-process) — structural validity is the
  complete check.
- If structural derivation fails: create NO telemetry directory, write NO
  fallback file, guess NO root. Bootstrap evidence will then be absent and
  acceptance STOPs with `ROOT_OR_BOOTSTRAP_UNRESOLVED` (§14). Never
  hardcode `%USERPROFILE%\Documents`; never scan the filesystem; never
  create a guessed Sims root.
- Directory: `<derived-root>\AshleyE1Telemetry\` (created by probe if
  absent under default user ACLs; nothing outside it).
- Closed filesystem allowlist (the ONLY path operations shipped code may
  use): component-safe parent traversal (bounded, ≤6 levels), join/normalize/
  canonical-compare, mkdir of the telemetry root, stat/enumerate WITHIN the
  telemetry root, telemetry file create/write/flush/close. No broad search,
  no traversal outside the root, no delete/unlink (the probe deletes
  NOTHING — rotation creates NEW numbered files only).
- Active file: `ashley_e1_<telemetry_session_id>.jsonl`; rotations
  `ashley_e1_<session>.jsonl.<n>` (n=1,2,3,4 — NEW numbered files, never
  overwrite). Bootstrap file: `ashley_e1_bootstrap_<boot_id>.jsonl`.

### 12.2 Startup records (consistent: bootstrap vs attended session)

- BOOTSTRAP IMPORT: after successful `initialize_probe` but BEFORE any arm,
  the probe writes exactly one minimal `load_disabled` row into the
  bootstrap file. Allowed content ONLY: `probe_version`, `schema_version`,
  embedded Python version, required-import availability summary,
  `perf_counter` availability, bootstrap wall/monotonic stamps,
  package/build identity where locally embedded. It MUST NOT contain save
  identifiers, Sim/body state, interaction state, world state, or Owner
  free text. This row is the loader/bootstrap execution witness
  (replacing V1.1's contradictory `session_open`-while-UNARMED).
- If the telemetry root cannot be derived (§12.1): DO NOT WRITE IT ANYWHERE
  ELSE. No fallback path exists. External absence of bootstrap evidence
  within the acceptance timeout → STOP `ROOT_OR_BOOTSTRAP_UNRESOLVED`.
- ATTENDED SESSION: after `arm` (session id allocated, file opened, zero
  lines) + `start` + first successful poll (snapshot populated) → emit
  `session_open` for the NEW attested session. Substantive rows follow only
  then. An arm→disarm cycle with no start closes with `close_reason:
  ARMED_NEVER_STARTED`.
- SESSION CLOSE: best-effort `session_close` written writer-side after
  explicit `disarm` (or cap/failure close reasons). It MUST NOT depend on
  any game unload notification (none is registered, §5.5).

### 12.3 Sequence semantics

`written_sequence` = contiguous WRITTEN-record order per session UUID (and
separately per bootstrap file), starting 0, +1 per physical line.
Capture-side losses (queue saturation, overrun, serialize failure) NEVER
create sequence gaps — they increment the `counters{}` fields reported in
subsequent records plus periodic `dropped_summary` rows (≤1/s). Rotation
does NOT reset the sequence and is NOT a drop: rotation is represented as
`session_checkpoint` with `checkpoint_reason: ROTATION` (+ `rotation_index`
incremented) in the new sibling's first rows.

### 12.4 Session identity

UUIDv4 per ARM (attested observation session — §5.5). Never reused across
reloads (reload REQUIRES re-arm → new UUID naturally); correlation across
reloads uses the external witness table, never a continuous sequence.
UUID-generation randomness itself is not the test target — non-reuse across
arms is (§20).

### 12.5 Flush policy + writer design

Single background writer thread, one open handle per session. Flush on every
checkpoint, every `cap_reached`/`writer_failed`, disarm-signal, and ≥every
5 s while sampling. `threading.Thread` + `queue.Queue(1024)` existence
in-mod is `PRIOR_ART` (shipped S4CL uses both); game-thread safety rule
stands regardless (§13).

### 12.6 Caps (kept) with no-deletion semantics

```text
MAX_ACTIVE_FILE_BYTES = 8 MiB
MAX_ROTATED_SIBLINGS_PER_SESSION = 4   (per-session total ≈ 40 MiB)
MAX_TELEMETRY_DIR_BYTES = 200 MiB (all sessions; accounted BEFORE each write;
  never knowingly exceeded)
RETENTION_FOR_TRIAL = until adjudicated + 30 days; then Owner archives/deletes.
  No cloud copy. No raw-log commit.
ROTATION = size-triggered, rotate BEFORE exceeding; new sibling opens with a
  session_checkpoint{checkpoint_reason: ROTATION} row (sequence continues;
  zero data loss across boundary).
DIR_CEILING = when the next write would exceed 200 MiB: STOP CAPTURE, emit
  best-effort cap_reached (writer.state=CAP_REACHED + reason), close handle.
  The PROBE DELETES NOTHING. Owner archives/deletes outside the game.
```

### 12.7 Queue / backpressure / fault accounting

- Capacity 1024. Game-thread `try_put` (never block). Full queue: drop
  OLDEST `clock_snapshot` first, then `zone_snapshot` (the ONLY
  preferentially-evictable classes). Presence observations required for E1-A
  are CRITICAL and MUST NOT be classified disposable. Preserve `session_*`,
  `save_observation`, `presence_snapshot`, `guard_exhausted`,
  `dropped_summary`, checkpoints. If NO disposable record exists
  (all-critical backlog) → fail closed: stop capture for the window and mark
  `saturation_critical` in `reason`; affected witness INVALID per §24 (never
  silently shed critical rows to protect a drop-rate number).
- Aggregate drop tolerance MUST NOT hide critical loss: E1-A validity needs
  zero loss on the APPEAR transitions used (§11.2 COMPLETE-pair rule); E1-G
  needs zero loss across completion points; E1-B tolerates ≤5%/5-min ONLY on
  clock-class rows with speed/pause still provable. Any critical-class loss
  = affected witness `INSTRUMENTATION_FAILURE` (§24). A transition touching
  a dropped/incomplete observation is UNUSABLE — no inferred repair.
- `dropped_summary{reason: QUEUE_SATURATION|SAMPLER_OVERRUN|
  SERIALIZE_FAILURE, count}` at ≤1/s; per-record `counters{}` cumulative.
- Serialization: fully in-memory, single `write()+LF`. Failure drops THAT
  record via bounded non-recursive fault accounting (counter + sticky flag;
  the accounting path itself never serializes a second complex object —
  fixed prebuilt bytes). After an unrecoverable write failure: stop ordinary
  writes, mark failure sticky IN MEMORY, best-effort final `writer_failed`
  diagnostic only (it cannot violate cap/schema/root restrictions — if it
  cannot be written validly, it is counted, not forced). Final diagnostic
  cannot violate the restrictions it reports. No recursive failure logging,
  ever.
- Crash: torn final line possible ("single write" atomicity promise
  WITHDRAWN). Bundle rule: one trailing partial line tolerated
  (`truncated_tail: true`); any non-tail corruption or ≥2 bad lines =
  `INVALID` (§§23–24). A tolerated tail does NOT prove clean completion —
  a witness whose required final observation was the torn line fails.
- Flush failure (3 consecutive) → stop capture, sticky `FAILED_STICKY`,
  best-effort `writer_failed` row, silence for the session (fail-closed).
- Disarm/teardown: the game-thread command handler SIGNALS shutdown only
  (sets event, returns immediately — no I/O, no join). The writer performs
  its own bounded drain with a writer-side deadline, then closes and sets
  `writer_idle=True`; still-queued rows counted as dropped, never blocking
  the game.

---

## 13. Threading / lifecycle model (binding)

```text
GAME THREAD:  alarm callback -> guard(SAMPLING) -> poll_once copy-out
              (plain-data ONLY, entry_key as hex string) -> try_put(queue)
              -> return. No I/O. No block.
WRITER THREAD: blocking take -> serialize -> write -> flush policy (§12.5).
               Game-module imports: NONE (import-edge checked).
SESSIONS:     arm opens / disarm signals close (Owner-command boundaries ONLY);
              predecessor unresolved -> SESSION_PREDECESSOR_UNRESOLVED (§5.5).
RELOAD:       NO automatic state change. Owner stop+disarm BEFORE, re-arm AFTER.
              Commands persist till game restart (truthful, §5.3); NO accumulating
              timers/threads/alarms/game refs (acceptance §14-K + unit tests).
INFERENCE/NETWORK: NONE anywhere.
```

- Immutable copy-out on the game thread before enqueue (freeze: game
  objects → IDs/strings/numbers immediately; never enqueue a live handle).
- At most one outstanding copy-out (overrun skips + counts).
- Forced termination of blocked OS I/O is NEVER promised; shutdown is
  signal + writer-side deadline only.

---

## 14. First-load acceptance (bounded instrumentation qualification)

Before ANY E1 witness: one bounded session proving the instrument. All
checks STOP-gated; any load-bearing failure = `INSTRUMENTATION_FAILURE` +
STOP (§25), except root/bootstrap failure which is
`ROOT_OR_BOOTSTRAP_UNRESOLVED`. No redesign, no S4CL, no injection, no
weakening inside the run. Any selected runtime symbol missing at first load
remains failure with NO fallback discovery.

```text
A. Target build identity: Main-Menu string == PC 1.128.90.1030 (photo/transcription
   in manifest). Mismatch → STOP (wrong build).
B. Runtime self-report: load_disabled row records embedded python version +
   perf_counter available true/false. perf_counter absent → STOP for E1-B
   (monotonic channel required); time.time fallback keeps correlation only.
C. Required imports resolve: alarms(+add_alarm_real_time/cancel_alarm),
   clock.interval_in_real_seconds, date_and_time.TimeSpan, services,
   sims/sim_info/client managers, interactions.context, sims4.commands
   (four-name registration surface). Any missing REQUIRED import → STOP.
D. Real-time scheduler qualification: import ok → TimeSpan(1-real-second)
   construction accepted → 60-s trial: 60±2 callbacks unpaused; callbacks
   continue across a brief pause toggle; ZERO callbacks after stop; callback
   nonblocking (overrun counter clean); save-directory hash check (§21.1)
   shows no PERSISTED save-file change. Fail any → STOP. (The hash check
   detects persisted save-file changes ONLY — it does not prove absence of
   every transient in-memory/world mutation; phrase the claim narrowly.)
E. poll_once getters exist: guid/slot/sim/queue/si_state/clock/calendar/speed/paused
   attribute-or-callable presence + None-safety (no exception on empty LAB point);
   singleton predicate returns exactly one eligible Sim (§9.2-R2).
   Missing REQUIRED getter → STOP (or UNSUPPORTED iff a MUST verdict survives — §10.4).
F. perf_counter monotonicity: two successive calls non-decreasing + resolution sane.
G. guid/slot/sim reads behave: repeated reads stable within a completion point; no
   exception; types recorded (ints kept as strings downstream).
H. No persisted save mutation: saves/ directory hashes before/after acceptance
   identical (excluding nothing — no Owner saves during acceptance); any
   unexplained delta → STOP. (Narrow claim per D: persisted files only.)
I. Command family: exactly four registrations observed; arm LAB_E1 ok;
   arm BADNAME rejected; arm while SAMPLING rejected; disarm ok;
   start-while-UNARMED rejected; stop-while-ARMED ok (no-op); repeated start
   while SAMPLING = no-op success with redundant_starts counted and exactly
   ONE live alarm; stop-while-idle ok.
J. Start/stop/cancel: state transitions UNARMED→ARMED→SAMPLING→ARMED→UNARMED
   correct; SESSION_PREDECESSOR_UNRESOLVED branch covered by unit test
   (forced re-arm during open writer rejected); zone-change kill path
   described but NOT exercised live (dead-handle branch unit-covered).
K. Writer/logging: rotation at exactly MAX+1 byte via session_checkpoint/
   ROTATION; sibling cap; dir-cap CAP_REACHED (no deletion); torn-tail single
   line tolerated in a fixture; counters arithmetic; writer_failed non-recursion.
L. Drop discipline: zero critical-class loss during acceptance; clock-class ≤5%/5-min.
M. Bootstrap/root evidence: load_disabled present ≤2 min after stable LAB load
   with UNARMED attestation and runtime facts; root structurally valid per §12.1;
   session_open appears ONLY after arm+start+first poll (never before arm).
```

Only after A–M pass (recorded in `acceptance.md`, §23) may E1-A/B/G windows run.

---

## 15. LAB configuration (minimum, noncanonical, low-noise)

```text
LAB_SAVE_NAME = LAB_E1 (exact literal for arm)
FORK_SAVE_NAME = LAB_E1_FORK (exact literal for re-arm)
LAB_PURPOSE = E1 telemetry (never HOME, never PREVIEW_E0)
HOME_SAVE = NOT CREATED IN E1
```

### 15.1 LAB world (L0 chamber, then staged opening)

Base L0 (deterministic-observation windows): one flat residential lot;
ONE single-seat chair (unique, later-E2 reference only), bed, fridge,
bathroom set; no career/instrument/mischief objects. ONE Sim (fresh
"E1-Proband", base-game traits, non-social aspiration; unrelated to
Ashley/Owner designs). Global autonomy OFF; aging OFF; Neighborhood Stories
OFF for the LAB household; walkbys suppressed via in-game lot/visit
settings ONLY (no mod/cheat beyond standard options). Motives: OBSERVED as
exposed (motive FREEZING is NOT an E1 prerequisite and NOT a probe action —
if a freeze mechanism exists it is an Owner setup fact, recorded, never
claimed unless verified). Wants/Fears: OFF for L0 windows (toggle state
recorded every load; must hold across load — WF-01 support note). Fixed
camera per window (Owner sets once, untouched during windows); display mode
recorded.

Native-autonomy window (E1-A native leg): SAME lot, SAME Wants/Fears (OFF),
SAME motives posture, SAME camera/display/objects — the ONLY deliberate
change is autonomy OFF→ON (Full or default — recorded). Owner hands-off
after `start` for the window. Same build, same probe, reloaded fresh. Any
further unavoidable difference is declared in the witness manifest (else the
legs are INCOMPARABLE → `INCONCLUSIVE`, never negative).

### 15.2 LAB setup = Owner facts, never probe actions

Autonomy, Wants/Fears, aging, stories, cheats, lot furnishings, household
composition: ALL Owner setup. The probe NEVER changes any of them (denylist
§10). The manifest records them per window (§15.3) from Owner transcription.

### 15.3 LAB record (manifest fields per window)

`lab_save_name(armed), guid/slot/sim@open, autonomy, motives posture,
wants_fears, aging, stories, lot/object manifest, camera/display, options
transcription, probe version+sha, sims build`.

---

## 16. E1-A witness — origin / source visibility (MUST, narrowed)

Question: on APPEAR transitions (§11.2 COMPLETE-pair rule), does per-entry
`context.source` verbatim distinguish Owner pie-menu action from native
autonomy? (No end/outcome claims. No universal classifier. Bounded to
build/fixture/opportunities.)

### 16.1 Preconditions

Build+sha recorded; Sims build verified (§14-A); LAB_E1 at known point;
telemetry dir empty-or-archived; acceptance A–M passed; armed `LAB_E1`;
competing script mods absent-or-documented; drop counters zero at start.

### 16.2 Owner actions (scripted, timestamped BEFORE acting)

Leg 1 — Owner-input (autonomy posture recorded; need pressure avoided): at
wall T1 click Sim → queue unique single-step interaction (e.g. sit on the
single-seat chair); await appearance in polls; at T2 a second distinct
interaction; at T3 120 s no-command control; repeat 1–3 twice (≥4 Owner
opportunities + ≥2 controls). T-times written down BEFORE clicking (±2 s
correlation tolerance).

Leg 2 — native (autonomy ON, Wants/Fears and all else IDENTICAL to Leg 1
per §15.1, `start`, then HANDS-OFF mouse/keyboard except emergency): 10 min
timer; prior Owner queues verifiably clear in consecutive COMPLETE polls
before the window counts; if zero native appearances, extend once to
20 min; still zero → honest null (→ `INCONCLUSIVE`, §24), do NOT click "to
help". Optional external screen capture/timestamp notes allowed (outside the
game; never an in-game marker UI).

### 16.3 Expected telemetry

1 Hz `presence_snapshot` rows: each APPEAR (COMPLETE-pair §11.2) carries
`entry_key`, `membership`, `source_raw` verbatim, `source_norm`,
`source_confidence` + wall/monotonic stamps. Owner clicks SHOULD show the
player-click stamp; native appearances show whatever 1.128 exposes (possibly
no distinct value — S4CL side has none — which is itself the finding).

### 16.4 Evidence artifact

Per-leg JSONL excerpts + `witness_A.md` (T-times, configs incl. Wants/Fears
posture per leg, click descriptions, completion observations, drop
counters, file hashes) + Owner screen-capture refs if used.

### 16.5 Validity proof (required regardless of outcome)

≥2 Owner-clicked APPEAR transitions with wall-time correlation inside
tolerance AND lossless COMPLETE-pair capture of those transitions (zero
critical loss). For `ANSWERED_POSITIVE` or `ANSWERED_NEGATIVE`: adequate
observed opportunities for BOTH classes (≥2 valid native APPEARs alongside
≥2 Owner APPEARs), validity held, no contradiction. Insufficient native
opportunities → `INCONCLUSIVE`, NEVER `ANSWERED_NEGATIVE`. Without validity:
`INVALID` (deviation) or `INSTRUMENTATION_FAILURE` (loss) — never negative.

### 16.6 Verdicts (meanings per §24 precedence)

- `ANSWERED_POSITIVE`: Owner vs native APPEAR rows separate by source
  value/absence-pattern across ≥2 instances each, validity held, no
  contradiction. Bounded claim only.
- `ANSWERED_NEGATIVE`: validity held AND classes indistinguishable (same
  stamp or both absent) across the full opportunity set (both classes
  adequate). First-class SUCCESS, never failure, never rerun-until-positive.
- `INCONCLUSIVE`: zero/insufficient native appearances or incomparable leg
  configs.
- `INVALID`: clicks during hands-off, wrong save/arm, autonomy or
  Wants/Fears mis-setting, timing beyond tolerance. Deliberate protocol
  violation is INVALID; natural interruption is INCONCLUSIVE.
- `INSTRUMENTATION_FAILURE`: lifecycle-substitute claims, handle/timestamp
  gaps, critical drops, broken reader, or transitions touching incomplete
  observations presented as APPEARs (missing callback data is
  instrumentation failure, NOT "game exposes nothing").

---

## 17. E1-B witness — game time / wall time (MUST)

### 17.1 Preconditions

Same build/save/probe/acceptance checks. Normal/default speed ONLY. Pause
MUST NOT be triggered by anyone (game auto-pause/modal/load → window
excluded as `INCONCLUSIVE`, not data).

### 17.2 Owner actions

At wall W0 (written down): stable unpaused play, game clock G0 verbatim.
`ashley_e1.start` (armed beforehand per §5.5); hands-off 15 min (timer; no
clicks/camera/menus). At W1: note G1; `ashley_e1.stop`. Repeat once (two
15-min windows, ≥30 min total wall).

### 17.3 Expected telemetry

Automatic 1 Hz `clock_snapshot` rows `{wall_timestamp_ms, monotonic_ns,
ticks, calendar, clock_speed, paused}`. Ratio per window computed offline
from the MONOTONIC channel: `r = Δgame-minutes / Δwall-minutes`
(game-minutes from tick/calendar conversion reconfirmed at witness vs
G0/G1 truth). Agreement: `abs(r1−r2)/mean(r1,r2) ≤ 0.10`, else discrepancy
reported and stable-ratio conclusion WITHHELD (not auto-diagnosed as
instrument failure).

### 17.4 Evidence artifact

Full-window JSONL + `witness_B.md` (W0/W1, G0/G1, speed attestation,
pause-absence, drop counters, hashes).

### 17.5 Validity / verdicts (meanings per §24 precedence)

Validity: `clock_speed` constant default, `paused == false` on EVERY row
(`null` NEVER validates), sampler gaps <2 s, critical drops zero.
`ANSWERED_POSITIVE`: both ratios + relative difference reported with
agreement. `INCONCLUSIVE`: interruption/gaps. `INVALID`: non-default speed
or input intrusion. `INSTRUMENTATION_FAILURE`: ticks/calendar frozen while
the world visibly advanced, or monotonic channel broken. Report r1, r2,
difference — no confidence-interval theater.

---

## 18. E1-G witness — save / body identity (MUST)

Probe performs NO save. Owner performs all UI saves. Separate session UUIDs
per arm/reload; correlation via the witness table (never a continuous
sequence across reloads). Values recorded are POST-COMPLETION RETURNED
VALUES (§18.1) — never "stable therefore fresh".

### 18.1 Completion conditions (replacing "validity points" phrasing)

After each Owner Save / Load / Save-As step, an observation point is
COMPLETE only when ALL hold:

1. Owner confirms the UI operation completed;
2. Owner confirms return to normal live gameplay;
3. sampling is armed+started as the step requires;
4. 30 quiet seconds elapse (additional wait, NOT freshness proof);
5. consecutive COMPLETE observations (§11.2) are collected;
6. returned guid/slot/sim values are recorded.

Repeated stability alone does NOT prove freshness. If post-save and
post-reload values differ: preserve BOTH, report the difference, invent NO
persisted-identity conclusion.

### 18.2 Owner actions (exact command sequence; G0–G5 labels)

```text
ORIGIN INITIAL:
  load LAB_E1 → live play confirmed → arm LAB_E1 → start →
  §18.1 completion → record (G0/S0/M0) → stop → disarm
OWNER SAVE:
  arm LAB_E1 → start → Owner performs Save (UI) → §18.1 completion →
  record (G1/S1/M1) → stop → disarm → Owner reloads LAB_E1 (no edits)
ORIGIN RELOAD:
  live play confirmed → arm LAB_E1 → start → §18.1 completion →
  record (G2/S2/M2) → stop → disarm
SAVE-AS:
  Owner performs Save-As → NEW slot LAB_E1_FORK (never overwrite) →
  live play confirmed → arm LAB_E1_FORK → start → §18.1 completion →
  record (G3/S3/M3) → stop → disarm → Owner loads LAB_E1_FORK
FORK RELOAD:
  live play confirmed → arm LAB_E1_FORK → start → §18.1 completion →
  record (G4/S4/M4) → stop → disarm → Owner reloads origin LAB_E1
FINAL ORIGIN RELOAD:
  live play confirmed → arm LAB_E1 → start → §18.1 completion →
  record (G5/S5/M5) → stop → disarm
```

Every load/reload is preceded by `stop`+`disarm` and followed by explicit
re-arm (§5.5) — including the intermediate reloads. Preserve the fork
(deletion is OD-6, post-adjudication). Competing autosave/mod interference
excluded by Owner control (intrusion → declare + redo).

### 18.3 Expected telemetry

`save_observation` poll rows at each completion point carrying the
`(guid, slot, sim_id)` triple as lossless strings + attestation context.

### 18.4 Evidence artifact

`witness_G.md` (G0..G5/S/M step table + command transcript + wall times +
reload map) + JSONL excerpts + slot-list screenshots showing both saves.

### 18.5 Validity / verdicts (meanings per §24 precedence)

Validity: each completion point satisfied per §18.1 with sequence continuity
inside its session and zero critical loss across the point.
`ANSWERED_POSITIVE`: each identifier's Save/Save-As/reload behavior stated
as an OBSERVED rule with ≥1 confirming instance per transition, scoped to
this sequence/build (e.g. "Save preserves guid; Save-As produced
<same|changed>; sim_id stable across G0–G5"). Field-absent shape =
`ANSWERED_NEGATIVE (field absent)` with the same validity weight (an
`unsupported[]` declaration alone is NOT absence evidence — needs a
verified-unavailable read or supported-absence finding). `INCONCLUSIVE`:
missing completion point. `INVALID`: re-arm skipped at any reload,
transient-hook reads, or non-Owner saves. `INSTRUMENTATION_FAILURE`:
all-absent triple without declaration, or drops across completion points.

---

## 19. MAY observations (bounded, opportunistic — never at MUST expense)

Each ≤15 min / ≤2 MiB extra; SKIPPED the moment a MUST window is
threatened. Same taxonomy (§24); never gate acceptance.

- **M1 display/focus/minimize:** mode (fullscreen/windowed/borderless) +
  focus-loss/minimize outcome as `zone_snapshot{note}` + witness line. No
  automated focus manipulation.
- **M2 modal pause:** natural prompts only (record pause/clock effect);
  NEVER summon prompts deliberately.
- **M3 passive overhead:** Owner smoothness 1–5 + overrun/drop counters,
  5-min loaded vs 5-min unloaded baseline at the same LAB point. No
  profilers/overlays. (Check for prohibited effects + unexplained
  interference, not stochastic equivalence.)
- **M4 stable-load identifiers:** G2/G5 reload points double as M4 data —
  zero extra cost.
- **M5 E1-C consequence metadata:** per moodlet/motive entry, record whether
  deterministic consequence fields (affordance gates, outcome modifiers,
  autonomy biases) are exposed or `UNKNOWN`. No E3-richness verdict beyond
  present/absent/partial.
- **M6 WF-01 toggle support:** toggle state before/after each load (+ CAS
  open/close only if CAS opens during E0-adjacent work — never open CAS in
  LAB to test it).

---

## 20. Focused verification (no full corpus)

Stdlib `unittest` in `sims-e1/tests/` + `verify.ps1` per-check lines
(`VERIFY_PASS/FAIL`; any FAIL blocks install). Each bullet below is a named
test group:

- BOOTSTRAP: package-entry import initializes exactly once (second import
  is a no-op); secondary-module imports register nothing, spawn nothing,
  schedule nothing (stubbed game modules count calls); no alarm exists
  before explicit `start`.
- COMMANDS: exactly four command registrations with pinned names/flags/
  handler arities; two valid arm literals accepted; invalid literal
  rejected; unrelated/ambiguous/unknown rejected fail-closed; arm while
  SAMPLING rejected; start-while-UNARMED rejected; repeated start = no-op
  success with `redundant_starts` counted and one live alarm; stop/disarm
  transitions per §5.5; new arm rejected while predecessor writer
  unresolved (`SESSION_PREDECESSOR_UNRESOLVED`).
- SESSIONS: fresh UUID per arm; explicit post-reload re-arm required (no
  automatic unload/reset — simulate load boundary, assert state demands
  re-arm); writer closure is an explicit disarm boundary (no-unload-
  notification test); arm→disarm without start closes
  `ARMED_NEVER_STARTED`.
- INTERACTION IDENTITY: repeated same-affordance/target instances
  distinguishable via `entry_key`; same live object in queue+running
  deduplicates with `QUEUED_AND_RUNNING` preserved; APPEAR NOT inferred
  across dropped/incomplete/truncated/missing-baseline/new-session gaps;
  `entry_key` never claimed durable across reload (recomputed fixture).
- LOGGING: unarmed bootstrap emits ONLY minimal `load_disabled` (assert
  absence of save/Sim/interaction/world fields); armed start emits
  `session_open` with populated snapshot; rotation marker is a
  `session_checkpoint{ROTATION}` validating against the closed schema (no
  extra kind); failure/drop/checkpoint payloads validate per §11.3
  (required vs null fields); write failure terminates logging (bounded
  diagnostic, no recursion — failing writer fixture halts after one row).
- ROOT: valid installed path (`...\Mods\AshleyE1\...`) derives the root;
  a path containing textual `Mods` elsewhere (e.g.
  `...\MyModsBackup\AshleyE1\...`, `...\ModsStuff\...`) does NOT derive;
  failed derivation performs ZERO filesystem writes (monitored temp HOME).
- GUARDS: `autonomy_setting` harmless string passes; denylist names inside
  comments/docstrings/fixtures pass; actual forbidden mutator calls fail
  (including `import X as Y` / `from M import N as O` alias shapes and
  attribute-call targets); unapproved dynamic import/reflective dispatch
  fails; writer game-import edge fails.
- PACKAGE: wrong magic FAIL; wrong compiler family FAIL; wrong archive
  paths FAIL; missing entry FAIL; accidental `__pycache__` FAIL; raw `.py`
  in shipped archive FAIL; manifest hash/digest mismatch FAIL;
  `compileall`-success≠compatibility negative test (3.14-compiled fixture
  REJECTED by the verifier).
- SCHEDULER mock: alarm create/repeat/cancel lifecycle; overrun/drop
  accounting; dead-handle (zone-change) branch → window-invalid + re-arm
  required (no auto-resume); callback performs no I/O (mock asserts no
  open/write in callback path).
- WITNESSES: G-sequence validator requires re-arm after every reload;
  incomplete native opportunity forces INCONCLUSIVE (never NEGATIVE);
  lost APPEAR baseline marks the transition unusable; verdict-precedence
  fixtures (co-occurring failure+deviation → INSTRUMENTATION_FAILURE wins).
- SCHEMA/SEQUENCE/BOUNDS (retained): required fields, closed vocabularies,
  truncation flags, privacy (no display-name survives), canonical
  `MISSING≠ABSENT≠UNSUPPORTED≠UNKNOWN`, falsy-value distinction;
  monotonic contiguous written order + planted-gap detector + session
  non-reuse on re-arm; rotate at exactly MAX+1 + sibling cap + dir-cap
  CAP_REACHED with NO deletion; all-critical saturation fails closed;
  serialize/write/flush faults + sticky states + non-recursive accounting;
  torn-tail (one partial tail tolerated, two/non-tail fail); large-integer
  lossless preservation; artifact manifest hashing; source-content digest.

NOT required: full Ashley corpus (`npm test`, `phase0:*`, `eval:*`) — this
plan is docs-plus-E1-focused-tests only (master §8 selection).

---

## 21. Performance / observer-interference qualification

Reported in every bundle: total records, `dropped_*` by reason, max queue
depth, overrun count, flush failures, rotations, per-window drop %,
Owner smoothness note, loaded-vs-unloaded ratio comparison (check
prohibited effects + unexplained interference, not stochastic equivalence).
STOP thresholds: >5% clock-class drops/5-min; ANY critical-class drop;
Owner-attributed perceptible slowdown (recorded verbatim). Affected windows
`INVALID` (rerun after fix/scope reduction).

### 21.1 Save-directory hash check (narrow procedure)

Before/after acceptance and around each witness window (no Owner saves
inside the checked interval unless the window IS a save step): snapshot
`sha256` of every file under the Owner saves directory + `localthumbcache`
mtime/size listing. Identical → "no PERSISTED save-file change detected".
Changed → STOP, investigate. This procedure detects PERSISTED save-file
changes ONLY; it does not prove absence of transient in-memory or
unpersisted world mutation — phrase the claim narrowly in every bundle.

---

## 22. Packaging / install / remove (exact mechanical procedure)

Prerequisites: Windows PowerShell 5.1+, post-gate-P2 CPython 3.7.x (hash-
verified), game CLOSED, bounded backup taken. All commands from repo root.
`<V>` = probe version.

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/build.ps1 -Version <V>
# 1) assert 3.7 compiler identity (else STOP: TOOLING)  2) legacy -b compile,
#    optimize=0  3) zip -> sims-e1/build/ashley_e1_<V>.ts4script (pyc-only,
#    relative paths, normalized metadata)  4) sha256 sidecar  5) manifest.json
powershell -ExecutionPolicy Bypass -File sims-e1/tools/verify.ps1 -Version <V>
# must print VERIFY_PASS (per-check lines incl. tools/check_guards.py AST gate);
# else STOP, no install
powershell -ExecutionPolicy Bypass -File sims-e1/tools/install.ps1 -Version <V>
# game-closed check; receive + validate OD-4 Owner-confirmed root (§12.1 steps
# 1-6: validate, derive Mods, verify Mods\AshleyE1\, copy exact artifact,
# record install manifest, confirm structural path); backup Mods/saves/Tray
# completion check; bounded Mods-tree duplicate probe-package check (incl.
# renamed zips); delete localthumbcache.package; print enable checklist
# (Owner enables CC+Script Mods, restarts, loads LAB_E1, arms per witness)
powershell -ExecutionPolicy Bypass -File sims-e1/tools/remove.ps1
# game-closed check; delete exact artifact only; delete localthumbcache
# (if authorized); verify glob empty + no new telemetry writes on removal load
```

Enable (Owner, mechanical): Game Options → Other → CC+Mods ON, Script Mods
Allowed ON; Apply; quit-to-desktop; relaunch; Mods list exactly one
`ashley_e1` (version match). Mods-list presence ≠ execution proof — the
artifact's `load_disabled` bootstrap witness is the loader proof (§14-M).

Every step scripted; hand-editing the `.ts4script`, hand-placing files, or
config-file enabling = protocol deviation → declared or STOP. Removal never
touches saves; never blind-restores a whole old Mods backup over later
Owner changes.

---

## 23. Evidence bundle (exact contents)

Per witness (`acceptance`, `A`, `B`, `G`, optional MAY), directory
`sims-e1/evidence/<witness-id>/` (local; allowlisted commits only):

```text
manifest.json         # plan/master SHAs; probe version+sha256; compiler pin+hash;
                      # magic 3394; sims build (menu string); LAB lineage+config;
                      # s4cl_source_consulted db1ca99 (info); game_imports[];
                      # file list+sha256; wall/monotonic bounds; per-symbol evidence classes
install_manifest.json # (acceptance bundle) OD-4 root, Mods derivation, destination,
                      # artifact SHA, structural-path confirmation
witness_<id>.md       # preconditions, T/W-times (written BEFORE acting), command
                      # transcript (arm/start/stop/disarm per step), configs,
                      # deviations (or "none"), drop counters, hashes
verdict.md            # per-question + overall verdicts (§24)
excerpts/             # redacted JSONL ≤200 lines per claim (raw .jsonl local, gitignored)
screenshots/          # build string, slot list, relevant views as needed
verify.log            # verify.ps1 output for the build under test
acceptance.md         # (acceptance bundle) §14 A–M results
```

Raw-log integrity: sha256 of every `.jsonl` (+siblings) in `manifest.json`
at bundle time; post-bundle byte change invalidates. Corrupt-line rule
§12.7 applies at bundle verification.

---

## 24. Verdict taxonomy (binding; single authority for verdict meanings)

Per-question (E1-A/B/G, each MAY):

```text
ANSWERED_POSITIVE       established with validity proof, no contradiction, bounded scope
ANSWERED_NEGATIVE       validity held AND answer is "no/absent/indistinguishable"
                        (E1-A source-indistinguishability with BOTH classes adequate;
                        E1-G field-absent).
                        FIRST-CLASS SUCCESS — never failure, never rerun-until-positive.
INCONCLUSIVE            valid protocol but insufficient natural opportunity/interruption
                        (zero/insufficient native instances; interrupted window) —
                        bounded rerun, not redesign
INVALID                 Owner protocol deviation (wrong save/arm/config/input/timing,
                        skipped re-arm, deliberate timing or configuration violation) —
                        rerun window
INSTRUMENTATION_FAILURE probe/logging/validity failure (scheduler, handles, timestamps,
                        drops, corruption, missing reader, APPEAR claimed across an
                        incomplete observation) — fix + rerun; E1 unanswerable yet
```

Canonical precedence (highest first — when several apply, the HIGHER wins):

```text
1. INSTRUMENTATION_FAILURE
2. INVALID
3. INCONCLUSIVE
4. ANSWERED_POSITIVE / ANSWERED_NEGATIVE
```

A window with a critical drop AND a protocol deviation is
`INSTRUMENTATION_FAILURE`, not `INVALID`. A valid window with zero native
opportunities is `INCONCLUSIVE`, never `ANSWERED_NEGATIVE`. §§16–18 state
question-specific validity; THIS section is the single authority for what
the verdicts mean and which wins.

Overall (exactly one):

```text
E1_EVIDENCE_READY_FOR_ARCHITECT_ADJUDICATION
  — all three MUSTs ANSWERED_POSITIVE or ANSWERED_NEGATIVE with validity proofs,
    drop/corruption bounds met, first-load acceptance passed, save-hash + inertness
    checks passed (§21.1), no open STOP items.
E1_BLOCKED_<reason> — otherwise, with the exact finite blocker list.
```

"Logs exist" ≠ success.

---

## 25. STOP / failure / recovery (binding on the worker)

STOP = halt affected work, preserve evidence, report (`STOP_<cause>.md`:
observed / preserved / NOT attempted / exact missing fact or permission).
Do NOT improvise around the architecture. NEVER "fix forward" inside the
game (mutating the LAB save to rescue a window invalidates it).

STOP for: repo divergence (HEAD/tree ≠ §2.2 or unassessed relevant delta);
wrong/unverifiable Sims build; dependency incompatibility (incl. any
pressure to add S4CL/library — E1 ships none); P1 contradiction
(`BUILD_CONTRACT_INVALID`); missing compiler without TOOLING grant; unsafe
hook/API (veto-capable, mutating read, side-effecting import, network/IPC
request, lifecycle-callback registration of any kind); MUST-impossible
field gap (§10.4); `LAB_IDENTITY_AMBIGUOUS` (0 or >1 eligible Sims, §9.2-R2);
`SESSION_PREDECESSOR_UNRESOLVED` (new arm while prior writer open, §5.5);
`ROOT_OR_BOOTSTRAP_UNRESOLVED` (no bootstrap evidence in timeout, §12.1);
ambiguous identity with no stable alternative; mod-load ambiguity (§8.5);
first-load acceptance failure (incl. scheduler tests §14-D); unexplained
persisted save mutation (§21.1 at witness); slowdown/drop bounds exceeded
(§21); corruption beyond §12.7 tolerance; any need for
networking/credentials/Mint/helper/E2 actuation to "complete" E1; any
unplanned architecture; missing grant for the step at hand.

Recovery: `stop`/`disarm`, remove probe per §22 removal if game state is in
doubt; restore bounded backup without overwriting later Owner changes;
re-verify clean launch; report.

---

## 26. Worker execution constraints (binding)

1. Touch ONLY §7 paths (+ scoped `sims-e1/.gitignore` +
   `sims-e1/evidence/.gitignore`). Never edit Ashley source (`apps/`,
   `packages/`, `config/`, `scripts/`, `deploy/`, wider `docs/`), saves
   (except Owner UI steps §18), or install anything beyond the §22 artifact
   copy.
2. Worker scripts run offline (no network calls in build/verify/install/
   remove; JSON checks via stdlib/Node present).
3. No credentials/keys/tokens/Mint/Discord references anywhere in E1 code,
   tools, tests, logs, bundles.
4. Every game-facing name carries an evidence-tag comment at first use
   (`# PRIOR_ART|S4CL db1ca99|RUNTIME_UNVERIFIED: ...`). Untagged game names
   fail review.
5. Witness honesty: T/W-times BEFORE acting; never backfill from telemetry;
   never cherry-pick windows; report nulls.
6. E2-leakage gate before every commit: run `tools/check_guards.py` (AST /
   symbol / alias gate, §10.1) over `sims-e1/src/` — NOT a text grep. Any
   FAIL = commit refused. (The deny table is symbol-scoped; §20 fixtures
   prove `save`/`autonomy` telemetry words still pass.)
7. Docs-only siblings: no full-corpus run owed; focused E1 tests +
   `verify.ps1` are the gate.

---

## 27. Owner decisions

```text
OD-2  Authorize E0 + chooser behavior (Ashley body-temperament choice under
      boundary laws vs Owner-directed alternatives). Gates E0 session 1.
OD-3  (a) Authorize exact compiler tooling IF P3 applies (pinned CPython 3.7.x
      acquisition); (b) then bounded E1 BUILD grant (source+tests+package only,
      post-V1.2-acceptance). NO game contact.
OD-4  Authorize exact artifact install + runtime witness (names: artifact SHA256,
      Sims build, Owner-confirmed user-data root, verified Mods derivation,
      LAB_E1 + LAB_E1_FORK, witness IDs, retention window). Separate grant per
      witness run or run-set.
OD-5  Later HOME/world policies (aging, death/failure classes incl. emotional-death
      handling, Wants/Fears HOME posture, stories, economy/cheats, body-edit consent,
      avatar policy, mod set). DEFERRED — needed before HOME/E5+, never before E1.
OD-6  Fork + raw-evidence retention/deletion after adjudication (default keep till
      adjudicated+30d; probe deletes nothing itself).
```

Master acceptance is NOT an open decision (V7.3.2a current/closed).
Compiler/API/hook/tick/layout facts are NOT Owner decisions (they are
evidence + gates P1–P3 below). Commit references never authorize committing.

---

## 28. Pre-build gates P1–P3 (executable prerequisites, not plan blockers)

```text
GATE P1 — OWNER DLL CHECK (before BUILD grant):
  Report from the Owner PC game folder (.../The Sims 4/Game/Bin/):
  exact python*_x64.dll filename + Details-tab File version.
  Compatible (3.7.x, magic-3394 family) → pin compiler, proceed to P2.
  Contradictory → BUILD_CONTRACT_INVALID, STOP, return to adjudication.
  P1_IS_EXECUTABLE_PREBUILD_GATE = YES
GATE P2 — COMPILER PIN:
  Exact CPython 3.7.x release + source + hash recorded in the build manifest.
  P2_IS_EXECUTABLE_PREBUILD_GATE = YES
GATE P3 — TOOLING AUTHORIZATION (only if the pinned compiler is absent):
  Separate explicit grant to acquire the exact package. Plan acceptance and
  BUILD grant MUST NOT be read as tooling authorization. DO NOT INSTALL
  under any planning or build-only grant without it.
  P3_IS_AUTHORIZATION_GATE = YES
FIRST_LOAD_ACCEPTANCE_IS_VALID_RUNTIME_GATE = YES (§14)
```

---

## 29. Exact next step after plan acceptance

1. Final acceptance review of THIS plan (ACCEPT / ACCEPT_WITH_CORRECTIONS
   bounded-list / REJECT with reasons).
2. On ACCEPT: Owner completes P1 (DLL read, ≤1 min) → compiler pinned (P2)
   → tooling decided (P3) → OD-3 BUILD grant → worker builds/verifies,
   returns artifact + `verify.log` + manifest (no game contact).
3. OD-4 runtime grant (names the Owner-confirmed root, §27) → installer
   validates root + derives Mods (§12.1) → first-load acceptance (§14)
   with Owner → E1-A/B/G witnesses → §23 bundles + §24 verdicts.
4. Architect adjudicates E1 evidence; then (only then) E2 planning begins.
   Implementer prompt authored separately post-acceptance — NOT in this pass.

---

## Appendix A. Repair ledgers

### A.1 V1.2 repair ledger (Astra C1–C7)

| ID | Repair | Disposition | V1.2 section |
|---|---|---|---|
| C1 | Bootstrap/call bindings: `__init__` = version + idempotent `initialize_probe()`; secondary-import purity; fully-qualified `TimeSpan(interval_in_real_seconds(1))`; complete alarm call with probe-owned owner; exactly four registered names (five invocation forms) with pinned register form/flags/signatures/validation; mechanical singleton predicate + `LAB_IDENTITY_AMBIGUOUS` | REPAIRED | §§5.2, 5.3, 7.1, 8.3, 9.1–9.3, 14-C/D/E/I, 20, 25 |
| C2 | Command/session boundaries: UNARMED→ARMED→SAMPLING→ARMED→UNARMED machine; arm allocates session, rejects-while-sampling/predecessor-open; start no-op (no cancel-restart); snapshot at first poll; disarm signals close off-thread; stop+disarm before EVERY load/reload + re-arm after; automatic lifecycle/reset claims removed | REPAIRED | §§5.5, 9.4, 12.2, 12.4, 13, 14-I/J, 18.2, 20, 25 |
| C3 | Interaction instance/APPEAR: `entry_key` (process-local, session-scoped); `membership` QUEUED/RUNNING/QUEUED_AND_RUNNING with dedupe; COMPLETE-pair APPEAR rule + exhaustive never-infer list; presence-CRITICAL loss policy; per-entry `source_confidence`; `native_override` null-default; canonical MISSING/ABSENT/UNSUPPORTED/UNKNOWN | REPAIRED | §§11.1–11.4, 12.7, 16, 17, 20, 24 |
| C4 | Startup/log consistency: bootstrap `load_disabled` (instrumentation facts only) vs post-first-poll `session_open`; `ROOT_OR_BOOTSTRAP_UNRESOLVED`; rotation as `session_checkpoint{ROTATION}`; per-kind payload required/null contract; `writer.state` 3 values + `reason`; non-recursive failure accounting | REPAIRED | §§11.3, 12.1–12.3, 12.7, 14-M, 20 |
| C5 | Root confirmation: installer-owned validation/derivation/record under OD-4; runtime `__file__` component-safe derivation (no naive partition); no second comparison, no fallback write; closed path-operation allowlist | REPAIRED | §§7.3, 8.4, 12.1, 14-M, 20, 22, 27 (OD-4) |
| C6 | Guard contradiction: every lexical/word-appearance rule deleted; AST/symbol/alias-only gate; comments/strings are data with passing fixtures; deny tables verification-only under `tests/`+`tools/`; no shipped `guards.py`; leakage gate runs the AST script | REPAIRED | §§7.1, 9.1, 10.1, 20, 26.6 |
| C7 | Witness/verdict conditions: E1-A Wants/Fears identical, autonomy-only delta, both-classes-adequate rule; E1-G completion conditions replace "validity points", returned-values language, full per-step command transcript; §24 precedence chain as single authority | REPAIRED | §§15.1, 16, 18, 20, 24 |

### A.2 Retained Astra R1–R8 ledger (still true after C1–C7)

| ID | Repair | Disposition | V1.2 section |
|---|---|---|---|
| R1 | Build contract: pinned 3.7 family + magic 3394 + legacy pyc-only layout + no-recompile verifier; compiler pin via P1/P2, install via P3 only | REPAIRED | §§8, 22, 26, 28 |
| R2 | Exact API/hook contract: closed import set, poll_once reads, alarm+command mechanisms, singleton predicate, no patch/injection/lifecycle fallback | REPAIRED | §§5, 9, 10, 14 |
| R3 | Safe E1-G binding: Owner-attested arm/disarm/start/stop, two-name literals, re-arm on every reload/Save-As, IDs as observations, returned-values rule | REPAIRED | §§5.3, 5.5, 11, 12, 18 |
| R4 | Guards: AST-only allow/deny (alias-aware), comments/strings pass, verification-only tables, shipped-source filesystem scope | REPAIRED | §§9.1, 10.1–10.2, 12.1, 13, 20 |
| R5 | Schema: per-entry identity/confidence, written_sequence written-order, monotonic+wall pair, lossless string IDs, canonical vocabulary, counters/writer/rotation fields, bounds, no Owner text | REPAIRED | §11 |
| R6 | Logging/threading: no-deletion cap-stop + sticky states, rotation≠drop, critical-loss invalidation, fail-closed saturation, best-effort close, torn-tail rule, game-thread signal-only teardown, predecessor gate | REPAIRED | §§12–13 |
| R7 | Witnesses: independent native candidacy (E1-A), monotonic+agreement E1-B with precedence split, completion-point/session-UUID E1-G, interference-check replacement, save-hash narrow procedure | REPAIRED | §§14–19, 21, 24 |
| R8 | Install/authority: installer-confirmed root derivation (no hardcoded Documents, no scan), grant separation (plan/tooling/build/install-runtime), bounded backup without overwrite-restore, no false PLAN_BLOCKERS claim | REPAIRED | §§1, 7, 12, 22, 25–29 |

Nonblocking hygiene applied: "four registered commands, five valid
invocation forms" throughout; stale section references corrected (no
dangling §19.6/§22.../§24... pointers); "accepted-or-pending" removed
(master current/closed); queue bound stated as serialized-payload upper
bound, not heap; save-hash claim narrowed to persisted files; V1.1 stray
"cancel and restart" removed; E0 IDs where-visible-only; findings
build/fixture-bounded; source-content digest + normalized ZIP metadata in
manifest (§§8, 22).

## Appendix B. Decision table (mechanical choices, settled)

| # | Choice | Options | Evidence | Decision | Reason | Residual |
|---|---|---|---|---|---|---|
| D1 | S4CL | depend / direct | no 1.128 clearance citable; injection-based events; dual version gate | direct vanilla; S4CL source-ref only | smallest breakage surface; single gate; read-only minimum build | vanilla names target-confirm at first load |
| D2 | Source home | `apps/` / `sims-e1/` | `apps/` = Node services (verified) | `sims-e1/` top-level | avoids TS-gate misfire on Python probe | none |
| D3 | Telemetry sink | Mods-adjacent / dedicated dir | depth-rule + permission clarity | dedicated `AshleyE1Telemetry/` under derived root | bounds clarity; no Mods pollution | root confirmed at load |
| D4 | Transport | JSONL-local / IPC now | master §19A: helper from E3; in-mod net = NO | JSONL-local | only E1-compatible option | none |
| D5 | Sampling driver | manual-poll / game-time alarm / Zone-update / real-time alarm | manual contaminates+burdens; game-time stalls on pause; Zone-update needs injection | real-time alarm 1 Hz (PRIOR_ART + acceptance) | wall-true, hands-off, cancellable, no patch | target acceptance §14-D |
| D6 | Queue depth | 256/1024/unbounded | unbounded forbidden; 256 thin on zone events | 1024 + clock/zone-only eviction + critical fail-closed | headroom; serialized bound §11.6 | counters validate |
| D7 | Log caps | small/chosen/large | small rotates mid-witness; large risks disk | 8 MiB / 4 sibs / 200 MiB + cap-stop | fits windows; bounded; no deletion | first-witness sizes confirm |
| D8 | E1-A legs | off-only / staged OFF→ON | frozen/off trial cannot answer native side (normative) | staged L0 + autonomy-ON hands-off, all else identical | only design yielding both classes | native yield measured |
| D9 | Save-As target | overwrite / new-slot fork | overwrite destroys baseline | `LAB_E1_FORK` + explicit re-arm | reversibility + interpretability | OD-6 deletes post-adjudication |
| D10 | Test runner | pytest / stdlib unittest | no-install constraint | stdlib unittest (also under 3.7) | zero new deps; offline | none |
| D11 | Schema freeze | freeze E3 / version E1 only | BODY_STATE semantic-not-frozen; First-Use Law | `e1.telemetry/v1` only | keeps E1 honest, E3 free | none |
| D12 | Binding read | name-probe / attested-arm | no passive exact-name read in evidence | Owner-attested arm/disarm/start/stop; name-compare N2 conditional | only enforceable read-only mechanism | N2 if target later supplies name read |
| D13 | Bootstrap witness | session_open-while-unarmed / dedicated row | V1.1 contradiction around unarmed session_open | dedicated `load_disabled` bootstrap file + row | resolves contradiction; loader proof without session | none |
| D14 | Guard location | shipped guards.py / verification-only tables | shipped deny-table conflicts with runtime-source checks | tables under `tests/`+`tools/`; AST script is the gate | no conflict; comments/strings pass | none |
| D15 | Session identity | per-load UUID / per-arm UUID | no lifecycle hooks; boundaries are commands | UUID per arm | reload implies re-arm implies new UUID | predecessor gate §5.5 |

## Appendix C. Requirement-to-section trace (repair-task §§3–12)

C1 → §§5.2, 5.3, 7.1, 8.3, 9.1–9.3, 14, 20, 25. C2 → §§5.5, 9.4, 12.2,
12.4, 13, 14, 18.2, 20, 25. C3 → §§11.1–11.4, 12.7, 16, 17, 20, 24.
C4 → §§11.3, 12.1–12.3, 12.7, 14, 20. C5 → §§7.3, 8.4, 12.1, 14, 20, 22,
27. C6 → §§7.1, 9.1, 10.1, 20, 26.6. C7 → §§15.1, 16, 18, 20, 24.
Editorial fixes (§10 of task) → §§4.1, 5.3, 11.6, 14-D/H, 21.1, App. D.
Tests (§11) → §20. Gates (§12) → §28. E0 (§13) → §3 unchanged. Ledger
(§14) → App. A. Self-containment (§15) → §1.2 + this appendix. Worker
prompt: NOT authored (§29).

## Appendix D. Provenance (history explains; contracts above govern)

V7.3.2a (master, current/closed, unchanged); V1 (superseded for execution,
provenance retained); Astra HOLD (R1–R8, all repaired per App. A.2); V1.1
(superseded for execution by this plan; C1–C7 defects corrected per App.
A.1); Astra final review `REPAIR_V1_1_BEFORE_IMPLEMENTATION`
(`FUNDAMENTAL_MASTER_CHANGE_NEEDED = NO`,
`ADDITIONAL_SOURCE_RESEARCH_REQUIRED = NO`,
`RUNTIME_REQUIRED_BEFORE_PLAN_ACCEPTANCE = NO` — this repair is internal
contract work only); SR V1/V1.1/V1.2 (supporting engineering evidence only
— fully absorbed). Consulted S4CL revision `db1ca99` / v3.22 (2026-08-27,
pre-1.128, informational); EA 9/22/2026 notes (build identity); 2021 MTS
real-time-alarm report (scheduler lineage); CPython v3.7.0 loader source
(magic/header); Python 3.7 compileall/zipimport docs (mechanism, not loader
proof).

---

*End of E0/E1 Implementation-Ready Plan V1.2. No E-stage execution
authorized. No runtime proof claimed. No implementer prompt authored.
Next: final acceptance review → P1 DLL check → P2/P3 tooling → OD-3 build →
OD-4 runtime (names the Owner-confirmed root) → acceptance → witnesses →
adjudication.*
