# Project Ashley — Sims 4 Embodiment E0/E1 Implementation-Ready Plan V1.1

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_1.md
DOCUMENT_TYPE = CANONICAL E0/E1 IMPLEMENTATION SPECIFICATION (NOT implementation)
NORMATIVE_MASTER =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md
MASTER_SHA256 =
  A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3
SUPERSEDES_FOR_EXECUTION =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1.md
  (V1 SHA 10A3E2800C967D2DF0395FC5488C91D23289D951931AE0C1534CFD680064F254)
SUPPORTING_EVIDENCE =
  PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1_2.md
  (SR V1.2 SHA 50FF5B48ADD70C8BD4FED2ACEFB51C0B4C9F43B30BA5913090E71724DE59F99F)
PLAN_VERSION = V1.1
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
the mechanical build contract (dependency, layout, runtime mechanics,
allowlist, denylist, schema, logging, threading). §§14–18 are first-load
acceptance, LAB, and the three MUST witnesses plus MAY bounds. §§19–27 are
verification, packaging, evidence, verdicts, stops, constraints, Owner
decisions, pre-build gates, and next steps. Appendices carry the Astra
repair ledger, decision table, trace map, and provenance. Normative keywords
(MUST / MUST NOT / NEVER / FORBIDDEN / STOP) bind the future implementation
worker. Evidence tags follow the master convention:

`ASHLEY_SOURCE_VERIFIED` · `SOURCE_VERIFIED` · `EXTERNAL_PRIMARY` ·
`CURRENT_DOC_VERIFIED` · `PRIOR_ART` · `SECONDARY` · `INFERENCE` ·
`RUNTIME_UNVERIFIED` · `UNKNOWN`

A future worker receiving V7.3.2a + this plan + the worker prompt needs NO
other packet (no SR V1/V1.1/V1.2, no Astra review, no old V1) to execute.

---

## 1. Status / authority / scope

### 1.1 Plan status

```text
PLAN_STATUS = IMPLEMENTATION_READY_PLAN_V1_1_FOR_INDEPENDENT_REVIEW
PLAN_AUTHORIZES_IMPLEMENTATION = NO
PLAN_AUTHORIZES_RUNTIME = NO
PLAN_AUTHORIZES_E2 = NO
MASTER_ARCHITECTURE_CHANGED = NO
E0_IMPLEMENTATION_READY = YES (Owner procedure, §3)
E1_IMPLEMENTATION_PLAN_READY = YES
E1_DIRECT_IMPLEMENTATION_AUTHORIZED = NO
FIRST_LOAD_ACCEPTANCE_REQUIRED = YES (§14)
E2_LEAKAGE = NONE
PLAN_BLOCKERS = NONE (pre-build gates P1–P3 in §26 are executable
  prerequisites, not plan blockers)
```

### 1.2 Authority chain

1. Normative architecture: V7.3.2a master. Where this plan and the master
   conflict, the master wins and the worker MUST STOP (§24).
2. This plan: the single canonical E0/E1 execution specification. It absorbs
   V1, Astra R1–R8 repairs, and SR V1.2 mechanics so fully that subordinate
   artifacts are provenance only.
3. Future authorizations (NOT granted here): independent plan adjudication →
   pre-build gates P1–P3 (§26) → bounded E1 BUILD grant (OD-3) → bounded
   INSTALL/RUNTIME grant (OD-4) → E1 execution → evidence adjudication → E2
   planning. No step is implied by the prior.

### 1.3 Scope — covered

- E0 Owner procedure (zero code), §3.
- E1 strictly read-only Sims telemetry probe: poll-only observation,
  real-time alarm scheduler, Owner command contract, Owner-attested binding,
  build/package/install/witness/evidence/removal, §§4–27.
- E1 MUST questions E1-A / E1-B / E1-G; MAY observations as bounded
  opportunistic captures only, §18.

### 1.4 Scope — implementation authorization boundary

Once separately authorized, the worker may touch ONLY:

- `sims-e1/` product source, tools, tests (§7);
- gitignored build output (§7.2) and the single Mods install copy (§20);
- bounded local JSONL telemetry at the approved root (§§9, 12);
- focused tests (§19) and the §22 evidence assembly (copies + manifests).

Build, install, and runtime are SEPARATE grants (§§20, 25–26). No runtime
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
a real incompatible delta (§24), which does not exist.

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
first load and record it in the manifest + every bundle (§§14, 22). If the
client build ≠ 1.128.90.1030, STOP (§24) — do not "probably compatible"
forward.

### 2.4 Language / runtime / toolchain baseline

```text
ASHLEY_REPO_STACK = Node.js + TypeScript (agent-service ESM, tsc, vitest)
  (ASHLEY_SOURCE_VERIFIED: package.json, tsconfig, vitest.config)
AGENT_SERVICE_TEST_CMD = npm test --prefix apps/agent-service (vitest run)
DOCS_ONLY_VERIFICATION_FOR_THIS_PLAN = YES (no code changed; no corpus run owed)
PLANNING_Machine_TOOLCHAIN = Python 3.14.3 / Node v24.14.1
  (planning-machine fact only; NEVER the in-game compiler)
IN_GAME_RUNTIME_FAMILY = CPython 3.7 (PRIOR_ART + historic EXTERNAL_PRIMARY;
  exact 1.128 patch gated by P1, §26)
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
rule follows OD-2, §25: if Ashley chooses, traits/aspirations are body
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
a real-time 1 Hz scheduler, operated by five Owner console commands, gated
by Owner-attested arming — and return raw timestamped evidence answering
E1-A, E1-B, E1-G without mutating game state in any way.

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
+ verbatim source, motives/buffs MAY, event kinds. NOT the E3 ingestion
system, Mint path, wakes, or memory writes. Schema §11.

### 4.4 Non-claims

Nothing about actuation, pushed-action causality, pause semantics, lineage
efficacy, co-play, stasis, UI lock, envelopes, THI, memory, or E2+.
Polling absence is NEVER an end/outcome claim (§5.4). Logs existing ≠
success (§23).

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
  -> witness bundle assembled OUTSIDE the game (copies + manifest, §22)
```

Hard boundaries:

- Probe NEVER opens sockets/pipes/subprocesses/URLs; never reads
  credentials; never touches Mint/Discord/network (§10).
- Probe NEVER writes saves, slots, Sims, households, objects, tuning,
  clock, queues, or settings (§10).
- NO lifecycle monkeypatching, NO injection helper, NO S4CL import, NO
  veto-capable listener (all §13-B1 paths disqualified by construction;
  SR V1.2 injection census: 16/16 traced paths REQUIRE_PATCH, several veto).
- Background threads NEVER call game APIs; game reads happen on the game
  thread inside the alarm callback; only frozen plain-data crosses the queue.
- Probe inert unless armed in an authorized save (§9): otherwise at most one
  bounded `load_disabled` diagnostic per load, then silence.

### 5.1 Sole observation primitive: poll_once()

`poll_once()` is the ONLY game-state observation entry. On the game thread
it: checks `armed_name is not None AND sampling_active` (else returns
immediately, no record) → reads the §9 allowlisted getters/iterations →
converts EVERYTHING to plain data (IDs/strings/numbers/bools/None) at
copy-out → `try_put` to the bounded queue → returns. No file I/O, no
blocking, no join, no game mutation. Overrun (previous copy-out still
running) skips + counts `SAMPLER_OVERRUN`. Game refs NEVER escape: live
`Interaction`/`Sim`/`SimInfo` objects are never enqueued, never retained
across polls, never passed to the writer.

### 5.2 Real-time scheduler (SR V1.2 contract, PRIOR_ART + acceptance)

```text
SCHEDULER = alarms.add_alarm_real_time(owner, TimeSpan(interval_in_real_seconds(1)),
  callback, repeating=True, use_sleep_time=False, cross_zone=False)
CANCEL = alarms.cancel_alarm(handle)
```

Status: `PRIOR_ART` (2021 MTS author-tested report + EA `simulate_to_time.py`
lineage; S4CL verifies the sibling `alarms.add_alarm`/`cancel_alarm` call
shape in live use but never calls the real-time variant) + STOP-gated
first-load acceptance (§14-D). NOT claimed as 1.128 source-verified.
Real-seconds basis (independent of game-clock pause — the reason game-time
alarms and `Zone.update` injection were both rejected). `cross_zone=False`:
zone change kills the alarm; probe detects dead-handle, sets
`sampling_active=False`, refuses substantive records until explicit `start`
(no silent resume). Scheduling/cancelling mutates ONLY probe-owned
scheduler state, never world state.

Owner flow per window: ONE `ashley_e1.start` → repeating 1 s alarm drives
`poll_once()` → Owner fully hands-off → ONE `ashley_e1.stop` → cancelled.
Two commands per window (not ~900 manual polls — the withdrawn V1 design
MUST NOT return).

### 5.3 Owner command contract (exactly five commands)

```text
ashley_e1.arm LAB_E1 | ashley_e1.arm LAB_E1_FORK
ashley_e1.disarm
ashley_e1.start
ashley_e1.stop
```

Via vanilla `sims4.commands.register` (call shape `SOURCE_VERIFIED` through
maintained wrapper use; `PRIOR_ART` for vanilla dispatch semantics). No pie
menu, dialog, UI, or gameplay surface. Bodies: validate strings →
set/clear locals → read-only snapshot → own-alarm create/cancel → return.
Volatile probe-local state ONLY:

```text
armed_name: None | "LAB_E1" | "LAB_E1_FORK"
armed_snapshot: {guid, slot_id, sim_id, wall_ms, monotonic_ns} | None
sampling_active: bool
alarm_handle: handle | None
```

Game restart clears all. No persistence, lineage, or save writes. Command
registration has NO unregister path in evidence → restart-required cleanup
stated truthfully (commands inert while disarmed; never misrepresented as
hot-unregistered).

### 5.4 Truth language (binding)

Presence language ONLY: `PRESENT_AT_T`, `APPEARED_BETWEEN_T0_T1`,
`ABSENT_AT_T`. Polling disappearance MUST NEVER be recorded as `ENDED`,
`CANCELLED`, or `OUTCOME`. Queue-exit = "entry X no longer present at
T+n" — never which of completed/cancelled/failed/superseded, never exact
end time. Schema §11 has no `ENDED` enumerant reachable from polling.

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
py` wires lifecycle + commands + alarm. A read in `writer.py` or a write
outside `writer.py` fails review.

### 7.1 PRODUCT SOURCE (committed)

```text
sims-e1/
  README.md                      # E0/E1 pointer + this-plan reference
  src/
    ashley_e1/
      __init__.py                # version constant only
      probe.py                   # load/unload, arm state machine, 4-5 commands, alarm create/cancel
      observers.py               # poll_once() read-only getters/iterations ONLY
      snapshot.py                # immutable plain-data record construction
      schema.py                  # schema_version + validators (pure)
      writer.py                  # background JSONL writer (file I/O only)
      guards.py                  # approved/forbidden symbol tables for review tooling
  tools/
    build.ps1                    # 3.7 compile + package .ts4script
    verify.ps1                   # package/load/static-guard/schema checks
    install.ps1                  # copy artifact -> Mods\AshleyE1 (+ backup step)
    remove.ps1                   # remove artifact + verify absence
  tests/
    test_schema.py               # schema/validator/missingness tests
    test_bounds.py               # rotation/queue/drop-cap-stop tests
    test_sequence.py             # session/sequence/monotonicity tests
    test_guards.py               # AST allow/deny tests over src/
    test_binding.py              # arm state machine + re-arm flow tests
    test_package.py              # magic/layout/entry/__pycache__ tests
  evidence/
    .gitkeep                     # RAW LOGS NEVER COMMITTED (§7.4)
```

Python focused tests run `python -m unittest discover` (stdlib only; the
3.7 compiler runs them too). TS corpus NOT gated on E1 (§19.8).

### 7.2 BUILD OUTPUT (never committed)

```text
sims-e1/build/
  ashley_e1_<VERSION>.ts4script
  ashley_e1_<VERSION>.sha256
  manifest.json   # §§8, 22 fields incl. compiler pin, magic, SHAs, game imports
```

`build/` gitignored via a scoped `sims-e1/.gitignore` (worker adds it; does
not rewrite root ignores).

### 7.3 LOCAL SIMS INSTALL (Owner PC, outside repo)

```text
<verified-Mods-root>\AshleyE1\ashley_e1_<VERSION>.ts4script
```

One folder deep (ts4script depth rule `CURRENT_DOC_VERIFIED`). Exactly one
copy. No companion config. No `.package` (tuning override unavoidable →
STOP, §24).

### 7.4 RUNTIME EVIDENCE (outside git; privacy-preserving)

- In-game sink: `<verified-root>\AshleyE1Telemetry\
  ashley_e1_<session>.jsonl` (+ rotation siblings).
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
  proves execution via the artifact's own `session_open` self-report, §14).
- Versioning: `E1_PROBE_VERSION = "1.0.<n>"` monotonic; embedded in
  `__init__`, filename, manifest, and every record. Any shipped-byte change
  bumps `<n>`.

### 8.3 Install / enable / verify-load (mechanical; commands §20)

1. Game closed. Back up `Mods/` + `saves/` + `Tray/` (bounded backup; §20).
2. Copy artifact to `<verified-Mods>\AshleyE1\` (exactly one copy; duplicate
   probe-package check incl. renamed zips).
3. Delete `localthumbcache.package` (installer action, never probe behavior).
4. Game Options → Other → CC+Mods ON, Script Mods Allowed ON; Apply; full
   restart. Mods list shows exactly one `ashley_e1` entry with matching
   version (else §8.4 STOP). Presence ≠ execution proof — the artifact's
   `session_open` self-report is the loader witness.

### 8.4 Mod load ambiguity rule

>1 `ashley_e1` entry, version mismatch filename-vs-self-report, or no
`session_open` within 2 min of stable LAB load → STOP as mod-load ambiguity
(§24). Do not "test anyway".

### 8.5 Removal / rollback

`remove.ps1`: game-closed check → delete exact artifact → delete
`localthumbcache.package` → verify glob empty + no new telemetry writes on
a removal-load. Rollback: remove + restore bounded backup WITHOUT
overwriting later Owner changes (no blind full-Mods restore). Saves
untouched (probe never wrote them).

---

## 9. Read-only API / hook allowlist (exact, mechanical)

Principle: read-only = no state-changing call/flag, no veto-capable
subscription, no side-effecting import. Every item needs first-load
acceptance on 1.128; anything unverifiable is DEFERRED, not improvised.
Evidence class per symbol: `PRIOR_ART` (S4CL `db1ca99` wrapper bodies
verified; vanilla producer semantics target-unverified) unless noted.

### 9.1 Approved imports (closed set for shipped source)

```text
VANILLA: services, sims.sim.Sim, sims.sim_info.SimInfo(+manager),
  server.clientmanager (via services.client_manager()), clock (read fns only),
  date_and_time (DateAndTime/TimeSpan/constructors + MILLISECONDS_PER_SECOND),
  scheduling (Timeline type ONLY as annotation — no alarm creation through it),
  alarms (add_alarm_real_time + cancel_alarm ONLY),
  sims4.commands (register for the 4-5 Owner commands ONLY),
  interactions.context (InteractionContext/SOURCE_* read ONLY),
  objects (HiddenReasonFlag/ALL_HIDDEN_REASONS constant ONLY),
  protocolbuffers-free (no proto import needed by probe)
STDLIB: time (time/time_ns/perf_counter[_ns] reads ONLY), json, os (join/
  makedirs/stat ONLY under telemetry root), threading (writer Thread ONLY),
  queue (bounded Queue ONLY), uuid, hashlib (FNV-1a implemented locally or hashlib), struct
```

Any other import in shipped source FAILS verification. Dynamic import
(`importlib`, `__import__`, reflective `getattr` dispatch of game methods)
in shipped code is FORBIDDEN.

### 9.2 Approved reads (poll_once body; game thread only)

```text
R1 save/slot: services.get_persistence_service().get_save_slot_proto_guid() -> int;
  get_save_slot_proto_buff().slot_id -> int (PRIOR_ART; transient states UNKNOWN;
  stable-point rule §18)
R2 body lookup: services.sim_info_manager().get_all() + singleton-household filter
  (PRIOR_ART; LAB one-Sim household makes selection deterministic)
R3 sim_id/instantiation: SimInfo.id -> int; sim_info.get_sim_instance(
  allow_hidden_flags=...) None <=> SIMINFO_ONLY (PRIOR_ART)
R4 active/selection (MAY-grade, omit-if-absent): services.client_manager().
  get_first_client().active_sim[_info] (PRIOR_ART)
R5 queue/current: tuple(sim.queue) ordered iteration; tuple(sim.si_state) running set;
  per entry: guid64, affordance id, display/short text, target id,
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
  OPTIONAL passive append to on_buff_added/on_buff_removed lists is described but NOT
  used in E1 (poll covers MAY needs; no listener registration in the E1 build)
R10 zone (MAY-grade, omit-if-absent): zone/lot/room/position where exposed without hooks
```

If any R-item requires a mutating call on 1.128 → `UNAVAILABLE_DEFERRED`,
recorded in `unsupported[]`; MUST NOT use a write-to-read shortcut (§10.4).

### 9.3 Scheduler + commands (the only "registration" in E1)

- `alarms.add_alarm_real_time(...)` / `alarms.cancel_alarm(...)` per §5.2
  (PRIOR_ART + §14-D acceptance). No other alarm/timeline/Zone-update use.
- `sims4.commands.register` for exactly `ashley_e1.arm/disarm/start/stop`
  (arm takes one of two literals). No other command, no help-text trick that
  shows UI, no cheat-flag escalation beyond `Live` + `UNRESTRICTED` scope
  already proven harmless in wrapper use.

### 9.4 Lifecycle callbacks in-probe (no game hooks)

`on_load` (version check → command registration → emit `session_open`
attempt gated by arm), `poll_tick(handle)` (the alarm callback:
guard-armed → poll_once → try_put → return), `on_unload/teardown-signal`
(signal writer shutdown ONLY; no file I/O, no join on the game thread).
No UI, audio, camera, save, or selection touch.

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
        s4cl.* import of any kind
```

### 10.1 Exact static guard (replaces V1 semantic grep)

`verify.ps1` + `tests/test_guards.py` enforce over `sims-e1/src/`: (a)
import allowlist = §9.1 closed set (any other top-level import FAILS);
(b) forbidden-call AST set = §10 dotted names + alias-aware resolution
(`import X as Y` tracked; `from M import N as O` tracked); (c) no
`importlib`/`__import__`/`eval`/`exec`/`compile(` in shipped source;
(d) no `open(` outside `writer.py`; (e) no `socket|ssl|urllib|subprocess|
os\.system|os\.popen` tokens anywhere in shipped source. Legitimate
telemetry words (`save`, `autonomy`, `native_autonomy`) NEVER false-positive
— checks are symbol/call-based, with a dedicated test asserting a fixture
containing those words in comments/strings still passes.

### 10.2 Runtime boundary (replaces V1 object tripwire)

No "object exposes mutator → disable observer" rule (ordinary game objects
expose both reads and writes). Instead: approved-reader-functions-only; no
mutator call (review + AST); no live game ref leaves the game thread
(construction rule in `snapshot.py` — only `int/str/float/bool/None/list/
dict` cross); plain-data copy before queue. Violation = code defect, caught
pre-build.

### 10.3 Game-thread restriction

All game-state reads on the game thread inside the alarm callback. No lock
held across file I/O. Writer thread imports NO game modules (import-edge
check in verify).

### 10.4 Weakening prohibition

MUST field unobtainable read-only → `availability: UNAVAILABLE_DEFERRED` +
`reason: requires_mutation:<name>` (or `no_passive_path:<name>`), continue
everything else. STOP only if a MUST verdict becomes impossible (§24);
otherwise return the honest bounded/negative verdict.

---

## 11. Minimal E1 observation contract (versioned)

`OBSERVATION_SCHEMA_VERSION = 1` (`e1.telemetry/v1`; single version for all
V1.1 records — no silent v1.1 fork; any future change bumps the integer and
the plan). E3 is NOT frozen by this schema (§11.8).

### 11.1 Envelope (every line; key order fixed for digest stability)

```jsonc
{ "schema_version": 1,
  "telemetry_session_id": "uuidv4",  // per game-load lifecycle (§12.4)
  "written_sequence": 0,             // uint, contiguous WRITTEN order, starts 0
  "wall_timestamp_ms": 0,            // int, time.time()*1000 at copy-out
  "monotonic_ns": 0,                 // int, perf_counter_ns() (fallback perf_counter()*1e9)
  "game": { "ticks": 0,              // int absolute_ticks() or null
             "calendar": "string|null", // verbatim datetime string
             "clock_speed": "STRING|null", // ClockSpeedMode name verbatim
             "paused": true },        // true/false/null (null NEVER validates a window)
  "probe_version": "1.0.0",
  "sims_build": "1.128.90.1030",     // Main-Menu string at session_open
  "event_kind": "session_open",      // closed enum §11.3
  "attestation": { "armed_name": "LAB_E1|LAB_E1_FORK|UNARMED",
                   "armed_name_hash": "hex8|null",  // FNV-1a of armed_name
                   "snapshot_guid": "string|null",  // lossless strings §11.6
                   "snapshot_slot": "string|null",
                   "snapshot_sim": "string|null" },
  "save": { "save_slot_guid": "string|null", "slot_id": "string|null" },
  "zone": { "zone_id": "string|null", "lot_id": "string|null",
             "room": "string|null", "position": "[x,y,z]|null" },
  "body": { "sim_id": "string|null", "instantiated": true,
             "is_selectable": true, "is_selected": false,   // null if unexposed
             "posture": "string|null" },
  "interactions": { "observed": [ { "affordance_id": "string|null",
      "affordance_text": "string|null", "target_id": "string|null",
      "source_raw": "string|null",            // verbatim context.source
      "source_norm": "OWNER_UI|SCRIPT_DIRECTED|UNKNOWN",  // §11.2 mapping
      "present": true } ],                    // order = game order, cap §11.5
    "queue_truncated": false, "running_truncated": false },
  "source": { "origin_confidence": "EXPOSED|INFERRED_ABSENT|UNKNOWN" },
  "motives": [ { "id": "string", "value": "number|null", "band": "string|null" } ],
  "sim_signals": [ { "kind": "MOODLET|WANT|FEAR|TRAIT_NOTE|LIKE|ASPIRATION_NOTE|RELATIONSHIP_NOTE|FAILURE_PRECURSOR",
      "tuning_id": "string|null", "game_text": "string|null",
      "magnitude": "string|null", "consequences": "string|PARTIAL|UNKNOWN",
      "native_override": false } ],
  "missingness": {},      // field -> MISSING|UNEXPOSED|UNREADABLE:<why>
  "unsupported": [],      // allowlisted-but-unavailable-on-1.128 names
  "availability": "AVAILABLE|UNAVAILABLE_DEFERRED",
  "counters": { "dropped_queue": 0, "dropped_overrun": 0, "dropped_serialize": 0 },
  "writer": { "state": "OK|CAP_REACHED|FAILED_STICKY", "rotation_index": 0 },
  "note": "string|null" } // bounded §11.7; NEVER Owner free text
```

### 11.2 Source mapping (conservative; E1-A §16)

Map `source_norm: OWNER_UI` ONLY on the confirmed player-click value
(`SOURCE_PIE_MENU`-equivalent verbatim on 1.128); `SCRIPT_DIRECTED` ONLY on
the confirmed script-with-user-intent stamp; everything else (including any
autonomy-shaped value — S4CL side has NO autonomy enum value at all) →
`UNKNOWN` with `origin_confidence: UNKNOWN` unless the witness proves the
mapping. Never invent `NATIVE_AUTONOMY` from silence. (V1 cross-reference
error corrected: this rule belongs to E1-A, not E1-B.)

### 11.3 Event-kind enum (closed)

`session_open | session_checkpoint | session_close | zone_snapshot |
presence_snapshot | clock_snapshot | save_observation | guard_exhausted |
dropped_summary | load_disabled | cap_reached | writer_failed`

- No `interaction_event/ENDED`, no `witness_marker` injection, no
  `save_marker` from a hook (save observations are poll rows correlated by
  the Owner's external witness table).
- `load_disabled` is the ONLY record permitted while unarmed/outside
  authorized saves (one per load + one per explicit command misuse, bounded).

### 11.4 Missingness / unsupported / unknown (§7 of task)

Every unreadable field appears in `missingness` with reason; never silently
omitted. Distinctions binding: `MISSING` (expected but unreadable now) vs
`ABSENT` (verified non-present, e.g. empty queue) vs `UNSUPPORTED`
(allowlisted but no 1.128 path — also listed in `unsupported[]`) vs
`UNKNOWN` (value genuinely not determinable). `MISSING != ABSENT` (master
§4). `UNKNOWN` legitimate for any consequence/source field the game does
not deterministically expose.

### 11.5 Boundedness

Queue+running observed capped at 8 entries each (game order; overflow →
`queue_truncated/running_truncated: true` + counted). `motives[]` ≤12,
`sim_signals[]` ≤16 (failure-precursors first). Caps are schema facts;
changing them bumps `schema_version`.

### 11.6 Lossless IDs and strings

IDs that can exceed JSON-safe integer range serialize as STRINGS (guid,
slot, sim, tuning/affordance ids — always strings, never coerced numbers).
Every string field bounded (display text ≤160 chars, ids ≤64, note ≤256);
max serialized record 8 KiB (larger → drop + `dropped_serialize`, never
truncate-and-write). Queue-memory bound derives from 1024 × 8 KiB = 8 MiB
worst case (stated, not "under 1 MiB" theater).

### 11.7 No Owner text in telemetry

Owner witness notes (T/W-times, click descriptions, attestations) stay in
external `witness_*.md`. The probe accepts only the two arm literals; no
free-text argument exists on any command.

### 11.8 E3 non-freeze

This schema is the E1 witness vehicle, not future BodyState. No E3
ingestion/wake/memory field may be smuggled into V1 "for later" — First-Use
Law (master §15): OA-01/UI-01/RQ-01/Z-01/BB-01/SV-01 preparatory code
FORBIDDEN unless mechanically unavoidable for read-only telemetry, in which
case STOP as a planning question, not silent scope.

---

## 12. Logging contract (bounded local telemetry only)

### 12.1 Format and root (exact)

- JSONL, UTF-8, LF, one record per line, no BOM, key order §11.1.
- Root resolved at load: `__file__`-anchored derivation (module path →
  partition at `Mods` → parent chain) validated against the Owner-confirmed
  Sims user-data root; if derivation fails or disagrees → `session_open`
  records `root_unresolved` and stays inert (STOP-grade config fault, §24).
  Never hardcode `%USERPROFILE%\Documents`; never scan the filesystem; never
  create a guessed Sims root. Same verified root for Mods + telemetry.
- Directory: `<verified-root>\AshleyE1Telemetry\` (created by probe if
  absent under default user ACLs; nothing outside it).
- Active file: `ashley_e1_<telemetry_session_id>.jsonl`; rotations
  `ashley_e1_<session>.jsonl.<n>` (n=1,2,3,4 — NEW numbered files, never
  overwrite).

### 12.2 Session open/close

- `session_open` first line: `{probe_version, sims_build, armed_name:
  UNARMED, runtime self-report (python version, perf_counter würdigt true/
  false), schema_version}`. Substantive rows require armed+sampling (§5.3).
- `session_close` on clean unload; `session_checkpoint` on teardown-signal
  + every 60 s of sampling. All close markers best-effort (never promise a
  clean close after I/O failure).

### 12.3 Sequence semantics (corrected)

`written_sequence` = contiguous WRITTEN-record order per session UUID,
starting 0, +1 per physical line. Capture-side losses (queue saturation,
overrun, serialize failure) NEVER create sequence gaps — they increment the
`counters{}` fields reported in subsequent records plus periodic
`dropped_summary` rows (≤1/s). Rotation does NOT reset the sequence and is
NOT a drop (rotation metadata in `writer{}`).

### 12.4 Session identity

UUIDv4 per game-load lifecycle. Never reused across reloads (reload =
new UUID; correlation across reloads uses the external witness table, never
a continuous sequence). UUID-generation randomness itself is not the test
target — non-reuse on reopen is (§19).

### 12.5 Flush policy + writer design

Single background writer thread, one open handle per session. Flush on every
checkpoint, every `cap_reached`/`writer_failed`, teardown-signal, unload,
and ≥every 5 s while sampling. `threading.Thread` + `queue.Queue(1024)`
existence in-mod is `PRIOR_ART` (shipped S4CL uses both); game-thread safety
rule stands regardless (§13).

### 12.6 Caps (kept) with no-deletion semantics (repaired)

```text
MAX_ACTIVE_FILE_BYTES = 8 MiB
MAX_ROTATED_SIBLINGS_PER_SESSION = 4   (per-session total ≈ 40 MiB)
MAX_TELEMETRY_DIR_BYTES = 200 MiB (all sessions; accounted BEFORE each write;
  never knowingly exceeded)
RETENTION_FOR_TRIAL = until adjudicated + 30 days; then Owner archives/deletes.
  No cloud copy. No raw-log commit.
ROTATION = size-triggered, rotate BEFORE exceeding; new sibling starts with a
  rotation row (sequence continues; zero data loss across boundary).
DIR_CEILING = when the next write would exceed 200 MiB: STOP CAPTURE, emit
  best-effort cap_reached, enter sticky CAP_REACHED (writer.state), close handle.
  The PROBE DELETES NOTHING — oldest-closed-session eviction is FORBIDDEN
  (V1's deletion rule is withdrawn). Owner archives/deletes outside the game.
```

### 12.7 Queue / backpressure / fault accounting (repaired)

- Capacity 1024. Game-thread `try_put` (never block). Full queue: drop
  OLDEST `presence/clock_snapshot` first (disposable sampler class);
  preserve `session_*`, `save_observation`, `guard_exhausted`,
  `dropped_summary` ordering of criticality. If NO disposable record exists
  (all-critical backlog) → fail closed: stop capture for the window,
  `writer.state` notes `saturation_critical`, affected witness INVALID per
  §23 (never silently shed critical lifecycle rows to protect a drop-rate
  number).
- Aggregate drop tolerance MUST NOT hide critical loss: E1-A validity needs
  zero loss on the APPEAR transitions used; E1-G needs zero loss across
  stable points; E1-B tolerates ≤5%/5-min ONLY on sampler-class rows with
  speed/pause still provable. Any critical-class loss = affected witness
  `INSTRUMENTATION_FAILURE` (§23).
- `dropped_summary{reason: QUEUE_SATURATION|SAMPLER_OVERRUN|
  SERIALIZE_FAILURE, count}` at ≤1/s; per-record `counters{}` cumulative.
- Serialization: fully in-memory, single `write()+LF`. Failure drops THAT
  record via bounded non-recursive fault accounting (counter + sticky flag;
  the accounting path itself never serializes a second complex object —
  fixed prebuilt bytes).
- Crash: torn final line possible ("single write" atomicity promise
  WITHDRAWN). Bundle rule: one trailing partial line tolerated
  (`truncated_tail: true`); any non-tail corruption or ≥2 bad lines =
  `INVALID` (§§22–23). A tolerated tail does NOT prove clean completion —
  a witness whose required final observation was the torn line fails.
- Flush failure (3 consecutive) → stop capture, sticky `FAILED_STICKY`,
  best-effort `writer_failed` row, silence for the session (fail-closed).
- Teardown: game-thread callback SIGNALS shutdown only (sets event, returns
  immediately — no I/O, no join, no "2 s drain on the game thread"). The
  writer performs its own bounded drain with a writer-side deadline, then
  closes; still-queued rows counted as dropped, never blocking the game.

---

## 13. Threading / lifecycle model (binding)

```text
GAME THREAD:  alarm callback -> guard(armed+sampling) -> poll_once copy-out
              (plain-data ONLY) -> try_put(queue) -> return. No I/O. No block.
WRITER THREAD: blocking take -> serialize -> write -> flush policy (§12.5).
               Game-module imports: NONE (import-edge checked).
RELOAD:       one bounded writer lifecycle per game-load session; alarm handle
              cleared; listeners/commands: commands persist till restart (truthful,
              §5.3); NO accumulating timers/threads/game refs (acceptance §14-K).
INFERENCE/NETWORK: NONE anywhere.
```

- Immutable copy-out on the game thread before enqueue (freeze: game
  objects → IDs/strings/numbers immediately; never enqueue a live handle).
- At most one outstanding copy-out (overrun skips + counts).
- Strings/record bounded (§11.6) ⇒ queue memory ≤1024×8 KiB = 8 MiB worst
  case (defensible bound, stated derivation).
- Forced termination of blocked OS I/O is NEVER promised; shutdown is
  signal + writer-side deadline only.

---

## 14. First-load acceptance (bounded instrumentation qualification)

Before ANY E1 witness: one bounded session proving the instrument. All
checks STOP-gated; any load-bearing failure = `INSTRUMENTATION_FAILURE` +
STOP (§24). No redesign, no S4CL, no injection, no weakening inside the run.

```text
A. Target build identity: Main-Menu string == PC 1.128.90.1030 (photo/transcription
   in manifest). Mismatch → STOP (wrong build).
B. Runtime self-report: session_open records embedded python version +
   perf_counter available true/false. perf_counter absent → STOP for E1-B
   (monotonic channel required); time.time fallback keeps correlation only.
C. Required imports resolve: alarms(+add_alarm_real_time/cancel_alarm),
   services, clock/date_and_time/scheduling names, sims/sim_info/client managers,
   interactions.context, sims4.commands. Any missing REQUIRED import → STOP.
D. Real-time scheduler qualification: import ok → signature accepted →
   60-s trial: 60±2 callbacks unpaused; callbacks continue across a brief pause
   toggle; ZERO callbacks after stop; callback nonblocking (overrun counter clean);
   no game mutation observed (save mtimes/hash check, §19.6 clean). Fail any → STOP.
E. poll_once getters exist: guid/slot/sim/queue/si_state/clock/calendar/speed/paused
   attribute-or-callable presence + None-safety (no exception on empty LAB point).
   Missing REQUIRED getter → STOP (or UNSUPPORTED iff a MUST verdict survives — §10.4).
F. perf_counter monotonicity: two successive calls non-decreasing + resolution sane.
G. guid/slot/sim reads behave: repeated reads stable within a stable point; no
   exception; types recorded (ints kept as strings downstream).
H. No game mutation: saves/ directory hashes before/after acceptance identical
   (excluding nothing — no Owner saves during acceptance); any unexplained delta → STOP.
I. Command family: arm LAB_E1 ok; arm BADNAME rejected; disarm ok; start-while-
   disarmed rejected; stop-while-idle ok; double-start idempotent-restart (counted).
J. Start/stop/cancel: sampling_active transitions correct; cross_zone kill path
   described (zone change during acceptance NOT required — dead-handle branch covered
   by unit test + code review).
K. Writer/logging: rotation at exactly MAX+1 byte; sibling cap; dir-cap CAP_REACHED
   (no deletion); torn-tail single line tolerated in a fixture; counters arithmetic.
L. Drop discipline: zero critical-class loss during acceptance; sampler-class ≤5%/5-min.
```

Only after A–L pass (recorded in `acceptance.md`, §22) may E1-A/B/G windows run.

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
claimed unless verified). Wants/Fears: toggle state recorded every load;
prefer OFF for L0 windows if it holds across load (WF-01 support note).
Fixed camera per window (Owner sets once, untouched during windows);
display mode recorded.

Native-autonomy window (E1-A native leg): SAME lot, autonomy ON (Full or
default — recorded), motives ON, Wants/Fears ON (L1b posture), Owner
hands-off after `start` for the window. Same build, same probe, reloaded
fresh; NOT a config drift between legs beyond the documented autonomy
change (keep everything else identical).

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

Question: on APPEAR transitions, does per-entry `context.source` verbatim
distinguish Owner pie-menu action from native autonomy? (No end/outcome
claims. No universal classifier. Bounded to build/fixture/opportunities.)

### 16.1 Preconditions

Build+sha recorded; Sims build verified (§14-A); LAB_E1 at known point;
telemetry dir empty-or-archived; acceptance A–L passed; armed `LAB_E1`;
competing script mods absent-or-documented; drop counters zero at start.

### 16.2 Owner actions (scripted, timestamped BEFORE acting)

Leg 1 — Owner-input (autonomy OFF-or-Full recorded; need pressure avoided):
at wall T1 click Sim → queue unique single-step interaction (e.g. sit on
the single-seat chair); await appearance in polls; at T2 a second distinct
interaction; at T3 120 s no-command control; repeat 1–3 twice (≥4 Owner
opportunities + ≥2 controls). T-times written down BEFORE clicking (±2 s
correlation tolerance).

Leg 2 — native (autonomy ON, `start`, then HANDS-OFF mouse/keyboard except
emergency): 10 min timer; prior Owner queues verifiably clear in
consecutive polls before the window counts; if zero native appearances,
extend once to 20 min; still zero → honest null (→ `INCONCLUSIVE`, §23), do
NOT click "to help". Optional external screen capture/timestamp notes
allowed (outside the game; never an in-game marker UI).

### 16.3 Expected telemetry

1 Hz `presence_snapshot` rows: each APPEAR (entry absent at T0, present at
T1) carries `source_raw` verbatim + wall/monotonic stamps. Owner clicks
SHOULD show the player-click stamp; native appearances show whatever 1.128
exposes (possibly no distinct value — S4CL side has none — which is itself
the finding).

### 16.4 Evidence artifact

Per-leg JSONL excerpts + `witness_A.md` (T-times, configs, click
descriptions, completion observations, drop counters, file hashes) + Owner
screen-capture refs if used.

### 16.5 Validity proof (required regardless of outcome)

≥2 Owner-clicked APPEAR transitions with wall-time correlation inside
tolerance AND lossless poll capture of those transitions (zero critical
loss). Without this: `INVALID` (deviation) or `INSTRUMENTATION_FAILURE`
(loss) — never negative.

### 16.6 Verdicts

- `ANSWERED_POSITIVE`: Owner vs native APPEAR rows separate by source
  value/absence-pattern across ≥2 instances each, validity held, no
  contradiction. Bounded claim only.
- `ANSWERED_NEGATIVE`: validity held AND classes indistinguishable (same
  stamp or both absent) across the full opportunity set. First-class
  SUCCESS, never failure, never rerun-until-positive.
- `INCONCLUSIVE`: zero native appearances (nothing to compare) or
  incomparable leg configs.
- `INVALID`: clicks during hands-off, wrong save/arm, autonomy mis-setting,
  timing beyond tolerance. (Stray text from V1 corrected: deliberate
  protocol violation is INVALID; natural interruption is INCONCLUSIVE.)
- `INSTRUMENTATION_FAILURE`: lifecycle-substitute claims, handle/timestamp
  gaps, critical drops, or broken reader (missing callback data is
  instrumentation failure, NOT "game exposes nothing").

---

## 17. E1-B witness — game time / wall time (MUST)

### 17.1 Preconditions

Same build/save/probe/acceptance checks. Normal/default speed ONLY. Pause
MUST NOT be triggered by anyone (game auto-pause/modal/load → window
excluded as `INCONCLUSIVE`, not data).

### 17.2 Owner actions

At wall W0 (written down): stable unpaused play, game clock G0 verbatim. ONE
`ashley_e1.start`; hands-off 15 min (timer; no clicks/camera/menus). At W1:
note G1; ONE `ashley_e1.stop`. Repeat once (two 15-min windows, ≥30 min
total wall).

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

### 17.5 Validity / verdicts

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
per reload; correlation via the witness table (never a continuous sequence
across reloads).

### 18.1 Preconditions

LAB_E1 loaded, armed, session open; identifiers at stable load recorded:
guid G0, slot S0, sim M0. Stable-point rule: post-LOAD reads only after
load-complete + 30 s quiet; post-SAVE reads at a SEPARATE post-save stable
point (same 30 s quiet, no load involved — "after load-complete" never
governs a no-load step). 30 s quiet is an additional wait, not freshness
proof; source-defined validity points govern.

### 18.2 Owner actions (exact sequence)

1. Armed `LAB_E1`, `start` → **Save** (UI) → post-save stable point →
   record (G1/S1/M1) → `stop`.
2. Reload `LAB_E1` (no edits) → stable → record (G2/S2/M2).
3. `stop`, `disarm`; **Save-As** → NEW slot `LAB_E1_FORK` (never overwrite)
   → `arm LAB_E1_FORK`, `start` → stable → record (G3/S3/M3) →
   load `LAB_E1_FORK` → stable → record (G4/S4/M4).
4. `stop`, `disarm`; reload origin `LAB_E1` → `arm LAB_E1`, `start` →
   stable → record (G5/S5/M5). Preserve the fork (deletion is OD-6, post-
   adjudication). Competing autosave/mod interference excluded by Owner
   control (intrusion → declare + redo).

### 18.3 Expected telemetry

`save_observation` poll rows at each stable point carrying the
`(guid, slot, sim_id)` triple as lossless strings + attestation context.

### 18.4 Evidence artifact

`witness_G.md` (G0..G5/S/M step table + wall times + reload map) + JSONL
excerpts + slot-list screenshots showing both saves.

### 18.5 Validity / verdicts

Validity: each stable point settled with sequence continuity inside its
session and zero critical loss across the point. `ANSWERED_POSITIVE`: each
identifier's Save/Save-As/reload behavior stated as an OBSERVED rule with
≥1 confirming instance per transition, scoped to this sequence/build (e.g.
"Save preserves guid; Save-As produced <same|changed>; sim_id stable
across G0–G5"). Field-absent shape =
`ANSWERED_NEGATIVE (field absent)` with the same validity weight (an
`unsupported[]` declaration alone is NOT absence evidence — needs a
verified-unavailable read or supported-absence finding). `INCONCLUSIVE`:
missing stable point. `INVALID`: transient-hook reads or non-Owner saves.
`INSTRUMENTATION_FAILURE`: all-absent triple without declaration, or drops
across stable points.

---

## 19. MAY observations (bounded, opportunistic — never at MUST expense)

Each ≤15 min / ≤2 MiB extra; SKIPPED the moment a MUST window is
threatened. Same taxonomy; never gate acceptance.

- **M1 display/focus/minimize:** mode (fullscreen/windowed/borderless) +
  focus-loss/minimize outcome as `zone_snapshot{note}` + witness line. No
  automated focus manipulation.
- **M2 modal pause:** natural prompts only (record pause/clock effect);
  NEVER summon prompts deliberately.
- **M3 passive overhead:** Owner smoothness 1–5 + overrun/drop counters,
  5-min loaded vs 5-min unloaded baseline at the same LAB point. No
  profilers/overlays. (Replaces V1's stochastic "no new interaction"
  equivalence: check for prohibited effects + unexplained interference
  instead.)
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
(`VERIFY_PASS/FAIL`; any FAIL blocks install). Coverage (each a named test):

- Schema: required fields, closed vocabularies, truncation flags, privacy
  (no display-name survives), `MISSING≠ABSENT≠UNSUPPORTED≠UNKNOWN`,
  falsy-value distinction (missing vs false/zero/empty/verified-absence).
- Sequence/session: monotonic contiguous written order; planted-gap
  detector; session non-reuse on reopen (NOT randomness quality).
- Rotation/bounds: rotate at exactly MAX+1; sibling cap; dir-cap
  CAP_REACHED with NO deletion (eviction-order tests FORBIDDEN — replaced by
  cap-stop + preservation tests); all-critical saturation fails closed.
- Faults: serialize/write/flush failures; sticky states; non-recursive
  accounting; torn-tail (one partial tail tolerated, two/non-tail fail).
- Binding: `LAB_E1` accepted; `LAB_E1_FORK` accepted; unrelated/ambiguous/
  unknown rejected fail-closed; guid/slot change alone does NOT reject the
  authorized fork; Save-As re-arm flow; start/stop idempotency;
  start-while-disarmed rejected.
- Guards: exact allow/deny AST (aliases, `import X as Y`, `from M import N
  as O` resolved); approved telemetry words (`save`, `autonomy`) in
  comments/strings PASS; exact mutator call FAILS; unapproved dynamic
  import/reflective dispatch FAILS; writer game-import edge FAILS.
- Package: wrong magic FAIL; wrong compiler family FAIL; wrong archive
  paths FAIL; missing entry FAIL; accidental `__pycache__` FAIL; raw `.py`
  in shipped archive FAIL; manifest hash/digest mismatch FAIL;
  `compileall`-success≠compatibility negative test (3.14-compiled fixture
  REJECTED by the verifier).
- Scheduler mock: alarm create/repeat/cancel lifecycle; overrun/drop
  accounting; dead-handle (zone-change) branch; callback never performs I/O
  (mock asserts no open/write in callback path).
- Reload hygiene: no accumulating timers/threads/game refs (where testable
  without the game: state-machine reset test).
- Witness validators: reject critical loss, unknown speed/pause,
  invalid timing, missing stable points.

NOT required: full Ashley corpus (`npm test`, `phase0:*`, `eval:*`) — this
plan is docs-plus-E1-focused-tests only (master §8 selection).

---

## 21. Performance / observer-interference qualification

Reported in every bundle: total records, `dropped_*` by reason, max queue
depth, overrun count, flush failures, rotations, per-window drop %,
Owner smoothness note, loaded-vs-unloaded ratio comparison (§19-M3
replacement rule: check prohibited effects + unexplained interference, not
stochastic equivalence). STOP thresholds: >5% sampler-class drops/5-min;
ANY critical-class drop; Owner-attributed perceptible slowdown (recorded
verbatim). Affected windows `INVALID` (rerun after fix/scope reduction).

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
# must print VERIFY_PASS (per-check lines); else STOP, no install
powershell -ExecutionPolicy Bypass -File sims-e1/tools/install.ps1 -Version <V>
# game-closed check; verified-root check (§12.1); backup Mods/saves/Tray
# completion check; bounded Mods-tree duplicate probe-package check (incl.
# renamed zips); copy exact artifact -> <root>\Mods\AshleyE1\;
# delete localthumbcache.package; print enable checklist
# (Owner enables CC+Script Mods, restarts, loads LAB_E1, arms per witness)
powershell -ExecutionPolicy Bypass -File sims-e1/tools/remove.ps1
# game-closed check; delete exact artifact only; delete localthumbcache
# (if authorized); verify glob empty + no new telemetry writes on removal load
```

Enable (Owner, mechanical): Game Options → Other → CC+Mods ON, Script Mods
Allowed ON; Apply; quit-to-desktop; relaunch; Mods list exactly one
`ashley_e1` (version match). Mods-list presence ≠ execution proof — the
artifact's `session_open` self-report is the loader witness (§14).

Every step scripted; hand-editing the `.ts4script`, hand-placing files, or
config-file enabling = protocol deviation → declared or STOP. Removal never
touches saves; never blind-restores a whole old Mods backup over later
Owner changes.

---

## 23. Evidence bundle (exact contents)

Per witness (`acceptance`, `A`, `B`, `G`, optional MAY), directory
`sims-e1/evidence/<witness-id>/` (local; allowlisted commits only):

```text
manifest.json         # plan/SR/master SHAs; probe version+sha256; compiler pin+hash;
                      # magic 3394; sims build (menu string); LAB lineage+config;
                      # s4cl_source_consulted db1ca99 (info); game_imports[];
                      # file list+sha256; wall/monotonic bounds; per-symbol evidence classes
witness_<id>.md       # preconditions, T/W-times (written BEFORE acting), configs,
                      # deviations (or "none"), drop counters, hashes
verdict.md            # per-question + overall verdicts (§24... §23)
excerpts/             # redacted JSONL ≤200 lines per claim (raw .jsonl local, gitignored)
screenshots/          # build string, slot list, relevant views as needed
verify.log            # verify.ps1 output for the build under test
acceptance.md         # (acceptance bundle) §14 A–L results
```

Raw-log integrity: sha256 of every `.jsonl` (+siblings) in `manifest.json`
at bundle time; post-bundle byte change invalidates. Corrupt-line rule
§12.7 applies at bundle verification.

---

## 24. Verdict taxonomy (binding)

Per-question (E1-A/B/G, each MAY):

```text
ANSWERED_POSITIVE       established with validity proof, no contradiction, bounded scope
ANSWERED_NEGATIVE       validity held AND answer is "no/absent/indistinguishable"
                        (E1-A source-indistinguishability; E1-G field-absent).
                        FIRST-CLASS SUCCESS — never failure, never rerun-until-positive.
INCONCLUSIVE            opportunities/conditions insufficient (zero native instances;
                        interrupted window) — bounded rerun, not redesign
INVALID                 protocol deviation (wrong save/arm/config/input/timing) — rerun window
INSTRUMENTATION_FAILURE probe/logging/validity failure (scheduler, handles, timestamps,
                        drops, corruption, missing reader) — fix + rerun; E1 unanswerable yet
```

Overall (exactly one):

```text
E1_EVIDENCE_READY_FOR_ARCHITECT_ADJUDICATION
  — all three MUSTs ANSWERED_POSITIVE or ANSWERED_NEGATIVE with validity proofs,
    drop/corruption bounds met, first-load acceptance passed, inertness + user-save
    checks passed, no open STOP items.
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
request); MUST-impossible field gap (§10.4); ambiguous identity with no
stable alternative; mod-load ambiguity (§8.4); first-load acceptance
failure (incl. scheduler tests §14-D); unexplained save mutation (§19.6
analogue at witness); slowdown/drop bounds exceeded (§21); corruption
beyond §12.7 tolerance; any need for networking/credentials/Mint/helper/E2
actuation to "complete" E1; any unplanned architecture; missing grant for
the step at hand.

Recovery: `stop`/`disarm`, remove probe per §22... per §20/§22 removal if
game state is in doubt; restore bounded backup without overwriting later
Owner changes; re-verify clean launch; report.

---

## 26. Worker execution constraints (binding)

1. Touch ONLY §7 paths (+ scoped `sims-e1/.gitignore` +
   `sims-e1/evidence/.gitignore`). Never edit Ashley source (`apps/`,
   `packages/`, `config/`, `scripts/`, `deploy/`, wider `docs/`), saves
   (except Owner UI steps §18), or install anything beyond the §22... §20
   artifact copy.
2. Worker scripts run offline (no network calls in build/verify/install/
   remove; JSON checks via stdlib/Node present).
3. No credentials/keys/tokens/Mint/Discord references anywhere in E1 code,
   tools, tests, logs, bundles.
4. Every game-facing name carries an evidence-tag comment at first use
   (`# PRIOR_ART|S4CL db1ca99|RUNTIME_UNVERIFIED: ...`). Untagged game names
   fail review.
5. Witness honesty: T/W-times BEFORE acting; never backfill from telemetry;
   never cherry-pick windows; report nulls.
6. E2-leakage gate before every commit: AST denylist + import-edge + token
   grep (`push|enqueue|save_using|set_clock|set_motive|autonomy.*set|travel|
   helper|mint|socket|THI|Jev|lineage.*write|autosave`) over `sims-e1/src/`.
   Any hit = commit refused. (Word-based, symbol-scoped — §10.1 fixtures
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
      post-V1.1-acceptance). NO game contact.
OD-4  Authorize exact artifact install + runtime witness (names: artifact SHA256,
      Sims build, verified user-data root, LAB_E1 + LAB_E1_FORK, witness IDs,
      retention window). Separate grant per witness run or run-set.
OD-5  Later HOME/world policies (aging, death/failure classes incl. emotional-death
      handling, Wants/Fears HOME posture, stories, economy/cheats, body-edit consent,
      avatar policy, mod set). DEFERRED — needed before HOME/E5+, never before E1.
OD-6  Fork + raw-evidence retention/deletion after adjudication (default keep till
      adjudicated+30d; probe deletes nothing itself).
```

Master acceptance is NOT an open decision (V7.3.2a current). Compiler/API/
hook/tick/layout facts are NOT Owner decisions (they are evidence + gates
P1–P3 below). Commit references never authorize committing.

---

## 28. Pre-build gates P1–P3 (executable prerequisites, not plan blockers)

```text
GATE P1 — OWNER DLL CHECK (before BUILD grant):
  Report from the Owner PC game folder (.../The Sims 4/Game/Bin/):
  exact python*_x64.dll filename + Details-tab File version.
  Compatible (3.7.x, magic-3394 family) → pin compiler, proceed to P2.
  Contradictory → BUILD_CONTRACT_INVALID, STOP, return to adjudication.
GATE P2 — COMPILER PIN:
  Exact CPython 3.7.x release + source + hash recorded in the build manifest.
GATE P3 — TOOLING AUTHORIZATION (only if the pinned compiler is absent):
  Separate explicit grant to acquire the exact package. Plan acceptance and
  BUILD grant MUST NOT be read as tooling authorization. DO NOT INSTALL
  under any planning or build-only grant without it.
```

---

## 29. Exact next step after plan acceptance

1. Independent review of THIS plan (ACCEPT / ACCEPT_WITH_CORRECTIONS
   bounded-list / REJECT with reasons).
2. On ACCEPT: Owner completes P1 (DLL read, ≤1 min) → compiler pinned (P2)
   → tooling decided (P3) → OD-3 BUILD grant → worker builds/verifies,
   returns artifact + `verify.log` + manifest (no game contact).
3. OD-4 runtime grant → first-load acceptance (§14) with Owner → E1-A/B/G
   witnesses → §23 bundles + §24 verdicts.
4. Architect adjudicates E1 evidence; then (only then) E2 planning begins.
   Implementer prompt authored separately post-acceptance — NOT in this pass.

---

## Appendix A. Astra R1–R8 repair ledger

| ID | Repair | Disposition | V1.1 section |
|---|---|---|---|
| R1 | Build contract: pinned 3.7 family + magic 3394 + legacy pyc-only layout + no-recompile verifier; compiler pin via P1/P2, install via P3 only | REPAIRED | §§8, 20, 26, 28 |
| R2 | Exact API/hook contract: closed import set, poll_once reads, alarm+command mechanisms, no patch/injection fallback | REPAIRED | §§5, 9, 10, 14 |
| R3 | Safe E1-G binding: Owner-attested arm/disarm/start/stop, two-name literals, TRUE-only collection, re-arm on Save-As, IDs as observations | REPAIRED | §§5.3, 11, 12, 18 |
| R4 | Guards: exact AST allow/deny (alias-aware), no semantic word bans, no object tripwire, no SSL probe, shipped-source filesystem scope | REPAIRED | §§9.1, 10.1–10.2, 13, 20 |
| R5 | Schema: event-specific payloads, written_sequence written-order, monotonic+wall pair, lossless string IDs, tri-state unknowns, MISSING/ABSENT/UNSUPPORTED/UNKNOWN, counters/writer/rotation fields, bounds, no Owner text | REPAIRED | §11 |
| R6 | Logging/threading: no-deletion cap-stop + sticky states, rotation≠drop, critical-loss invalidation, fail-closed saturation, best-effort close, torn-tail rule, game-thread signal-only teardown, bounded lifecycle, derived memory bound | REPAIRED | §§12–13 |
| R7 | Witnesses: independent native candidacy (E1-A), monotonic+agreement E1-B with INCONCLUSIVE/INVALID split, stable-point/session-UUID E1-G, interference-check replacement | REPAIRED | §§14–19, 21, 24 |
| R8 | Install/authority: verified-root derivation (no hardcoded Documents, no scan), grant separation (plan/tooling/build/install-runtime), bounded backup without overwrite-restore, V1.1 carries no PLAN_BLOCKERS=NONE falsehood (gates explicit) | REPAIRED | §§1, 7, 12, 20, 25–29 |

Nonblocking hygiene applied: origin-mapping rule sited at E1-A (§11.2);
V1 stray INVALID-clause text removed (natural interruption =
INCONCLUSIVE, deliberate violation = INVALID); EA/S4CL evidence
dated/revisioned; queue-memory bound derived (1024×8 KiB); E0 IDs
where-visible-only; findings build/fixture-bounded; source-content digest +
normalized ZIP metadata in manifest (§22... §§8/22); deterministic-build
residuals documented rather than hand-waved.

## Appendix B. Decision table (mechanical choices, settled)

| # | Choice | Options | Evidence | Decision | Reason | Residual |
|---|---|---|---|---|---|---|
| D1 | S4CL | depend / direct | no 1.128 clearance citable; injection-based events; dual version gate | direct vanilla; S4CL source-ref only | smallest breakage surface; single gate; read-only minimum build | vanilla names target-confirm at first load |
| D2 | Source home | `apps/` / `sims-e1/` | `apps/` = Node services (verified) | `sims-e1/` top-level | avoids TS-gate misfire on Python probe | none |
| D3 | Telemetry sink | Mods-adjacent / dedicated dir | depth-rule + permission clarity | dedicated `AshleyE1Telemetry/` under verified root | bounds/eviction clarity; no Mods pollution | root confirmed at load |
| D4 | Transport | JSONL-local / IPC now | master §19A: helper from E3; in-mod net = NO | JSONL-local | only E1-compatible option | none |
| D5 | Sampling driver | manual-poll / game-time alarm / Zone-update / real-time alarm | manual contaminates+burdens; game-time stalls on pause; Zone-update needs injection | real-time alarm 1 Hz (PRIOR_ART + acceptance) | wall-true, hands-off, cancellable, no patch | target acceptance §14-D |
| D6 | Queue depth | 256/1024/unbounded | unbounded forbidden; 256 thin on zone events | 1024 + priority drops + critical fail-closed | headroom; 8 MiB derived bound | counters validate |
| D7 | Log caps | small/chosen/large | small rotates mid-witness; large risks disk | 8 MiB / 4 sibs / 200 MiB + cap-stop | fits windows; bounded; no deletion | first-witness sizes confirm |
| D8 | E1-A legs | off-only / staged OFF→ON | frozen/off trial cannot answer native side (normative) | staged L0 + autonomy-ON hands-off | only design yielding both classes | native yield measured |
| D9 | Save-As target | overwrite / new-slot fork | overwrite destroys baseline | `LAB_E1_FORK` + explicit re-arm | reversibility + interpretability | OD-6 deletes post-adjudication |
| D10 | Test runner | pytest / stdlib unittest | no-install constraint | stdlib unittest (also under 3.7) | zero new deps; offline | none |
| D11 | Schema freeze | freeze E3 / version E1 only | BODY_STATE semantic-not-frozen; First-Use Law | `e1.telemetry/v1` only | keeps E1 honest, E3 free | none |
| D12 | Binding read | name-probe / attested-arm | no passive exact-name read in evidence | Owner-attested arm/disarm/start/stop (N1); name-compare N2 conditional | only enforceable read-only mechanism | N2 if target later supplies name read |

## Appendix C. Requirement-to-section trace (task §§4–16)

§4 mechanics (A–G) → §§5, 9, 11–14, 16–18. §5 build → §§8, 20, 26, 28.
§6 boundary → §§5, 9–10. §7 schema → §11. §8 logging/threading → §§12–13.
§9 filesystem → §§7, 12–13, 20. §10 E0 → §3. §11 first-load → §14.
§12 tests → §20... §19. §13 install/remove → §§20, 22. §14 Owner decisions →
§§25, 27. §15 pre-build gates → §28. §16 R1–R8 → App. A. Self-containment →
§1.2 + this appendix. Worker prompt: NOT authored (§29).

## Appendix D. Provenance (history explains; contracts above govern)

V7.3.2a (master, accepted-or-pending, unchanged); V1 (superseded for
execution, provenance retained); Astra HOLD (R1–R8, all repaired per App.
A); SR V1 (initial packet, BLOCKED — subsumed); SR V1.1 (poll doctrine +
attested binding sketch — subsumed); SR V1.2 (real-time scheduler + arm
contract — absorbed fully; supporting evidence only). Consulted S4CL
revision `db1ca99` / v3.22 (2026-08-27, pre-1.128, informational); EA
9/22/2026 notes (build identity); 2021 MTS real-time-alarm report
(scheduler lineage); CPython v3.7.0 loader source (magic/header);
Python 3.7 compileall/zipimport docs (mechanism, not loader proof).

---

*End of E0/E1 Implementation-Ready Plan V1.1. No E-stage execution
authorized. No runtime proof claimed. No implementer prompt authored.
Next: independent review → P1 DLL check → P2/P3 tooling → OD-3 build →
OD-4 runtime → acceptance → witnesses → adjudication.*
