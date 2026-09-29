# Project Ashley — Sims 4 Embodiment E0/E1 Implementation-Ready Plan V1

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1.md
DOCUMENT_TYPE = SEPARATE E0/E1 IMPLEMENTATION-READY PLAN (NOT implementation)
NORMATIVE_MASTER =
  PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md
MASTER_SHA256_EXPECTED =
  A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3
PLAN_VERSION = V1
DATE = 2026-09-28 Europe/Istanbul
AUTHOR_ROLE = implementation-plan architect (Muse, fresh context)
```

**NOT:** E-stage authorization · blanket programme authorization ·
implementation · Sims mod creation (beyond this plan) · helper creation ·
live actuation · body binding in production · standing-envelope activation ·
canonical-world inhabitation · runtime proof of any kind · autonomous-worker
prompt (explicitly deferred to a later pass after independent review).

**HOW TO READ THIS PLAN.** Section 1 states authority and scope. Section 2
pins the exact baseline. Sections 3–4 give the E0 procedure and E1 objective.
Sections 5–13 are the mechanical build contract. Sections 14–18 are the lab
and witness procedures. Sections 19–27 are verification, evidence, verdicts,
stops, constraints, and next steps. Normative keywords (MUST / MUST NOT /
NEVER / FORBIDDEN / STOP) bind the implementation worker. Evidence tags
follow the master convention:

`ASHLEY_SOURCE_VERIFIED` · `SIMS_SOURCE_VERIFIED` · `EXTERNAL_PRIMARY` ·
`SECONDARY` · `OWNER_FACT` · `PRIOR_ART` · `CURRENT_DOC_VERIFIED` ·
`INFERENCE` · `RUNTIME_UNVERIFIED` · `UNKNOWN` · `SOURCE_VERIFIED`

A consequential mechanical choice without one of these tags is a plan defect.

---

## 1. Status / authority / scope

### 1.1 Plan status

```text
PLAN_STATUS = IMPLEMENTATION_READY_PLAN_V1_FOR_INDEPENDENT_REVIEW
PLAN_AUTHORIZES_IMPLEMENTATION = NO
PLAN_AUTHORIZES_RUNTIME = NO
PLAN_AUTHORIZES_E2 = NO
MASTER_IS_IMPLEMENTATION_READY_FOR_FULL_PROGRAMME = NO (per master)
MASTER_IS_SUFFICIENT_BASIS_FOR_IMPLEMENTATION_PLANNING = YES (per master)
E1_READY_FOR_IMPLEMENTATION_PLANNING = YES (per master)
E1_READY_FOR_AUTONOMOUS_IMPLEMENTATION_DIRECTLY_FROM_MASTER = NO (per master)
SEPARATE_E0_E1_IMPLEMENTATION_READY_PLAN_REQUIRED = YES (satisfied by this file, pending review)
```

### 1.2 Authority chain

1. Normative architecture: V7.3.2a master (accepted-or-pending Owner
   acceptance; this plan does not decide acceptance).
2. This plan: mechanical E0/E1 only. It may not override the master. Where
   this plan and the master conflict, the master wins and the worker MUST
   STOP (see §24).
3. Future authorizations (NOT granted here): independent plan adjudication →
   explicit Owner bounded-E1 implementation/run authorization → E1 execution
   → E1 evidence adjudication → E2 planning. No step is implied by the prior.

### 1.3 Scope — what this plan covers

- E0 Owner procedure (zero code), §3.
- E1 strictly read-only Sims telemetry probe: build, package, install,
  witness, evidence, removal, §4–§24.
- E1 MUST questions E1-A / E1-B / E1-G (master §17-E1, §20).
- E1 MAY observations as bounded opportunistic captures only, §18.

### 1.4 Scope — implementation authorization boundary

The implementation worker, once separately authorized, is authorized to:

- create/modify/delete files ONLY under the E1 product-source, tool, test,
  build-output, and evidence paths named in §7;
- add a gitignored build artifact and a local Mods install copy per §20;
- write bounded local JSONL telemetry per §12 to the single path in §12;
- run focused tests per §19 on the worker machine;
- execute the LAB witness on the Owner PC only under explicit runtime
  authorization with the Owner present/available per §15–§17.

### 1.5 Runtime authorization boundary

No runtime (game launch with probe installed, LAB trial, witness run) is
authorized by this plan. Runtime requires a separate explicit Owner
authorization naming: build under test (hash), Sims build, LAB save,
witness ID(s), and retention window. Unauthorized runtime is a STOP event.

### 1.6 Explicit E2 exclusion

E2 and everything after it is FORBIDDEN in E1 work. Non-exhaustive
forbidden list (normative; §10 is the binding denylist):

- interaction push/enqueue/cancel; pause/resume writes; motive/buff/trait
  writes; autonomy changes; clock/speed changes; selection changes;
  save/save-as/load writes or scripted saves; custom save-data/lineage
  writes; travel; household/ Sim creation/deletion/mutation; object/Build-Buy
  mutation; tuning injection; Mint connection; network I/O; credentials;
  synthetic input; Windows helper transport; UI lock; avatar stasis; guest
  control; couch co-op; scripted saving; world-lineage writes; THI/Jev;
  native-autonomy envelopes; OA-01/UI-01/RQ-01/Z-01/BB-01/SV-01 qualification
  activity beyond passive E1 observation.

If any E1 objective appears to require an item above, the field is
UNAVAILABLE/DEFERRED — never a reason to weaken E1 (§10.4).

---

## 2. Normative master + exact source baseline

### 2.1 Master verification

```text
MASTER_FILE = PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md
MASTER_SHA256_VERIFIED = YES
  (Get-FileHash SHA256 = A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3)
MASTER_ANCHOR_ASHLEY_SHA = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
MASTER_ANCHOR_ASHLEY_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675
```

`ASHLEY_SOURCE_VERIFIED` for the hash check above (computed in this session
on the planning checkout).

### 2.2 Current Ashley baseline (established live in this planning session)

```text
REPO_CANONICAL = XharvaK/Ashley
CHECKOUT = C:\Users\Xharv\Projects\Ashley
BRANCH = main
HEAD = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
HEAD_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675
ORIGIN_MAIN = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2
ORIGIN_MAIN_TREE = 123d744a17a248e6310e2fab2abb90610a6a7675
HEAD_SUBJECT = "Repair persisted Owner transport cursors"
HEAD_DATE = 2026-09-28 14:17:23 +0300
DIFF_HEAD_TO_ORIGIN_MAIN = EMPTY (no diff stat; log HEAD..origin/main empty)
WORKTREE_STATE = clean tracked tree; untracked planning/design docs only
RELATION_TO_MASTER_ANCHOR = IDENTICAL (HEAD == anchor SHA; tree == anchor tree)
BASELINE_CLASSIFICATION = NO_RELEVANT_DELTA
```

Method: `git rev-parse HEAD`, `git rev-parse 'HEAD^{tree}'`,
`git rev-parse origin/main` + tree, `git diff HEAD origin/main --stat`,
`git log --oneline HEAD..origin/main`, `git status --short --branch`
(`ASHLEY_SOURCE_VERIFIED` — observed outputs in-session).

No re-grounding of the master is needed. Do not invalidate the master
because time passed: STOP only for a real incompatible delta (§24), which
does not exist at planning time.

### 2.3 Sims target baseline

```text
SIMS_TARGET = The Sims 4, latest/current BASE GAME, Owner Windows PC
MASTER_GROUNDING_BUILD = PC 1.128.90.1030 / Mac 1.128.90.1230 / Console 2.39
PATCH_DATE = 2026-09-22
TARGET_BUILD_AT_PLAN_TIME = PC 1.128.90.1030 (no newer build found at cutoff)
SIMS_SOURCE_VERIFIED = NO (no game client inspected from this checkout)
OWNER_CLIENT_VERIFIED = NO (no Documents\Electronic Arts\The Sims 4 folder
  present on this machine at planning time; Mods-path probe returned absent)
RUNTIME_UNVERIFIED = YES (all game-runtime facts owed to the E1 witness)
BUILD_IDENTITY_EVIDENCE = EXTERNAL_PRIMARY (EA official 9/22/2026 patch notes:
  PC 1.128.90.1030) + SECONDARY (community mirrors/trackers confirming the same
  numbers, and confirming 1.128 reset mod-compatibility status)
```

Implementer rule: confirm the Owner client's Main-Menu build string at
witness time and record it in every evidence bundle (§22). If the client
build ≠ 1.128.90.1030, STOP per §24 (wrong/unsupported build) — do not
"probably compatible" forward.

### 2.4 Language / runtime / toolchain baseline

```text
ASHLEY_REPO_STACK = Node.js + TypeScript (agent-service ESM, tsc, vitest)
  (ASHLEY_SOURCE_VERIFIED: package.json, tsconfig, vitest.config)
AGENT_SERVICE_TEST_CMD = npm test --prefix apps/agent-service (vitest run)
DOCS_ONLY_VERIFICATION_FOR_THIS_PLAN = YES (no code changed; no corpus run owed)
WORKER_SYSTEM_TOOLCHAIN_OBSERVED = Python 3.14.3 / Node v24.14.1
  (planning-machine fact only; NOT the in-game runtime)
IN_GAME_RUNTIME = UNKNOWN UNTIL WITNESS (embedded interpreter version, stdlib
  subset, SSL/network availability to be recorded by the implementer from
  primary/prior-art sources + load-time probe self-report; never assume the
  system Python above is the game runtime)
MOD_CONFIG_AT_PLAN_TIME = NONE (no Mods folder / no S4CL / no probe installed;
  clean-field assumption recorded; implementer re-verifies at build time)
```

### 2.5 Repo conventions the E1 worker MUST follow

- TypeScript services live under `apps/<service>/src`, tests colocated as
  `src/**/*.test.ts`, run with vitest (`ASHLEY_SOURCE_VERIFIED`).
- Shared TS packages live under `packages/` (currently `privacy-core`).
- `config/*.example.*` are committed; real env lives at
  `~/.composer-assistant/.env`, never in-repo (`ASHLEY_SOURCE_VERIFIED`).
- `node_modules/`, `dist/`, `*.log` are gitignored; build output is never
  committed (`ASHLEY_SOURCE_VERIFIED`: `.gitignore`).
- Evidence/artifact convention: qualification runners live under
  `scripts/qualification/`; large runtime artifacts are zipped beside reports
  (observed precedent). E1 follows the same shape but keeps RAW telemetry
  OUT of git (see §7/§12).
- PowerShell is the repo's script shell (`package.json` scripts call
  `powershell -ExecutionPolicy Bypass -File ...`). New E1 tooling scripts
  MUST be `.ps1` (build/pack/verify) plus dependency-free `node` where a
  JSON check is needed — matching existing conventions, not inventing new ones.

---

## 3. E0 Owner procedure (ZERO CODE)

E0 is an Owner-executed, Ashley-participating procedure. No code, no mod,
no telemetry, no helper, no Mint change. Normative provenance for every E0
choice: `THOUGHT_ENDORSED + OWNER_UI` where the Owner faithfully executes
Ashley's choice; any Owner substitution is `OWNER_DIRECT + OWNER_UI` and
MUST be labelled as such at the time.

### 3.1 Saves and contamination control

1. Create/identify TWO separate saves before starting:
   - `PREVIEW` — E0 play/design save. Canonical-history-free; may be
     discarded or archived, never promoted into LAB or HOME.
   - `LAB` — reserved for E1/E2 trials. E0 NEVER runs in LAB during E1/E2
     trial windows (master anti-contamination rule).
2. Later HOME is a third, separate save (created per master §15/§17-E2,
   after lineage-detection work). E0 choices may inform HOME via the game
   library / fresh creation — never by promoting the PREVIEW file itself.

### 3.2 Participants and planes

- Ashley participates through conversation (Discord): she describes,
  chooses, revises. This is genuine choice and genuine meaningful
  experience (decision agency), not self-execution.
- The Owner operates the UI (mouse/keyboard, CAS, lots, Build/Buy): human-UI
  plane only. Ashley never directs synthetic input.

### 3.3 Session 1 — Ashley's Sim

1. Owner shares CAS screens/descriptions; Ashley sees each option's
   in-game description text before choosing (Owner reads verbatim or
   screenshots where readable).
2. Ashley chooses appearance/body parameters where she wishes (skin tone,
   face, hair, body shape, clothing style, voice if used). Owner builds
   exactly what she specifies; deviations are declared as `OWNER_DIRECT`.
3. Traits/aspiration: Ashley selects body temperament (traits) and
   world-life theme (aspiration), and optionally Likes/Dislikes where
   exposed. The Owner MUST read the game's own description of each candidate
   before she chooses. These are body/world facts, NEVER her personality,
   preferences, or goals — state this aloud in-session if useful.
4. Iterate with screenshots until Ashley accepts or explicitly defers.
5. Save the accepted Sim to the game library (Library share step) from
   PREVIEW. Record: Sim name, trait/aspiration IDs + display text, screenshot
   IDs, date, PREVIEW save name.

### 3.4 Session 1b — Owner avatar

1. The Owner separately creates/designs their own persistent avatar Sim.
   This is Owner CAS activity: `OWNER_DIRECT`, not Ashley-authored. She may
   observe or comment; commentary is not authorship.
2. Save the Owner avatar to the game library as well. Record the same
   provenance fields. Do NOT merge households in PREVIEW as a "HOME draft" —
   household arrangement is deferred to RQ-01 and later planning.

### 3.5 Session 2+ — lots and furniture (optional, still E0)

1. Owner walks Ashley through lot options (screenshots + descriptions);
   Ashley chooses preferred lot/style; Owner places nothing canonical (PREVIEW
   only).
2. Same for furniture/aesthetics: Ashley chooses; Owner executes in PREVIEW.
   Purchases here are `THOUGHT_ENDORSED + OWNER_UI` only if faithfully
   executed; Owner taste substitutions are `OWNER_DIRECT`.

### 3.6 What Ashley receives (minimum record per E0 session)

- Dated session note: save name (`PREVIEW`), participants, duration.
- For each choice: Ashley's verbatim choice text, Owner's execution note
  (faithful / substituted + what), screenshot reference(s), game-ID where
  visible (trait/aspiration IDs), resulting library entry name.
- Explicit list of anything deferred (appearance item, trait, lot).

### 3.7 E0 completion criteria

E0 is COMPLETE when ALL hold:

1. Ashley's Sim designed in CAS in PREVIEW and saved to the library.
2. Owner avatar designed and saved to the library.
3. Per-choice provenance log exists (endorsed vs owner-direct labelled).
4. Screenshots/descriptions Ashley used are archived with the log.
5. PREVIEW save name and library entry names recorded; LAB untouched by E0
   during any trial window.

### 3.8 What E0 does NOT prove

- No bound embodiment, no self-execution, no telemetry-grounded body
  perception, no binding/currentness, no lineage, no rhythm/cadence, no
  co-play, no HOME chronology. E0's first-claim scope only: first
  Thought-endorsed, Owner-executed world choice.

### 3.9 Contamination avoidance (binding on E0 + E1)

- Never open the LAB save for E0 play.
- Never copy PREVIEW households/sims into LAB as trial actors (use fresh
  LAB actors per §14).
- Never discuss E0 choices inside LAB witness windows as instructions to
  the game; conversation is fine outside windows, with timestamps proving
  separation.
- If accidental LAB contact occurs, declare it in the evidence bundle as a
  protocol deviation; the adjudicator decides validity (§23).

---

## 4. E1 objective and claims

### 4.1 One-sentence objective

Render the body observable with a strictly read-only in-game probe that
writes bounded local JSONL, and return raw timestamped evidence answering
E1-A, E1-B, E1-G — without mutating game state in any way.

### 4.2 MUST claims (evidence owed, §15–§17)

- **E1-A — origin/source visibility:** can observable Sims metadata
  distinguish Owner pie-menu (UI) action from native autonomy? Both
  opportunity classes MUST appear in the witness. `ANSWERED_NEGATIVE`
  ("source metadata does not distinguish these classes") is valid evidence,
  not failure — provided instrumentation validity is proven (§23).
- **E1-B — game time / wall time:** measured relationship at normal/default
  speed on the Owner client. No world-speed change to answer it.
- **E1-G — save/body identity:** observed behavior of `save_slot_guid`,
  slot id, `sim_id` across Owner-performed Save, Save-As, reload. The probe
  performs no save. No assumption about Save-As semantics.

### 4.3 Telemetry foundation (minimum BodyState subset)

Capture the minimum useful read-only subset required by E1 and future
planning — binding identifiers, timestamps, zone, Sim instantiation,
selection/selectability (observed), interaction metadata + source/origin
metadata as exposed, motives/needs, bounded `SIM_*` entries, event kinds.
Do NOT build the eventual full E3 ingestion system, Mint path, wakes, or
memory writes. Schema in §11.

### 4.4 Explicit non-claims

E1 claims NOTHING about: actuation, causality of pushed actions, pause
semantics, lineage-marker efficacy, co-play, stasis, UI lock, envelopes,
THI, memory, or any E2+ behavior. Logs existing ≠ E1 success (§23).

---

## 5. Architecture boundary

```text
E1_PATH = SIMS MOD (read-only probe) -> LOCAL JSONL SINK
E1_NETWORK = NONE
E1_MINT = NONE (no ingress, no helper, no credentials)
E1_ACTUATION = NONE
E1_WRITE_TO_SAVE = NONE (including custom data)
E1_SYNTHETIC_INPUT = NONE (ASHLEY_INPUT_EMULATION = FORBIDDEN, master §3A/§4)
```

Data-flow diagram (mechanical):

```text
[Sims 4 1.128 process, LAB save]
  -> probe observers (game thread, read-only, §9/§13)
  -> immutable record copy
  -> bounded MPSC queue (memory only)
  -> background writer thread ( ultrasonic: file I/O ONLY, §13)
  -> %USERPROFILE%\Documents\Electronic Arts\The Sims 4\AshleyE1Telemetry\
     ashley_e1_<telemetry_session_id>.jsonl (+ rotated siblings, §12)
  -> witness bundle assembled OUTSIDE the game (copy + manifest, §22)
```

Hard boundaries:

- The probe NEVER opens a socket, pipe server, subprocess, or URL; never
  reads credentials; never touches Mint, Discord, or the network (§10).
- The probe NEVER writes to any save, slot, Sim, household, object, tuning,
  clock, queue, or setting (§10).
- Background threads NEVER call game-mutating APIs; game-state reads happen
  on the game thread; only plain-data copies cross the queue (§13).
- The probe is inert outside bound saves (§19.6): outside LAB it loads (so
  load-correctness is observable) but emits only a bounded load/disabled
  record and stays silent otherwise.

---

## 6. Dependency decision — NO S4CL for E1 (direct minimal interfaces)

### 6.1 Decision (binding)

```text
E1_DEPENDENCY = NONE (vanilla interfaces only; S4CL explicitly NOT bundled,
  NOT imported, NOT required at runtime)
S4CL_STATUS = DEFERRED/CANDIDATE FOR LATER STAGES ONLY (requalification gate below)
```

### 6.2 Evidence and reasoning

| Dimension | Direct minimal interfaces (chosen) | S4CL dependency (rejected for E1) |
|---|---|---|
| Maintenance | No third-party release lag; E1 breaks only if EA breaks vanilla reads we use | S4CL releases lag patches by design; 1.128 clearance was UNKNOWN at planning time (trackers reset for 1.128; `SECONDARY`): the Sept-22 mods safety guide confirms patch reset compatibility checks, and S4CL's canonical repo (DeviantGameMods) exposes no citable 1.128-cleared release in planning evidence (`CURRENT_DOC_VERIFIED` for repo identity/docs; `RUNTIME_UNVERIFIED` for 1.128 behavior) |
| Build compatibility | Probe compiles against vanilla services only; version gate is one variable (game build) | Probe version gate becomes two variables (game build × S4CL release); a stale S4CL on 1.128 is a STOP event the worker cannot fix inside E1 scope |
| API stability | Read surface needed is tiny (identity, clock-read, queue-inspect, motive/buff-read, zone-read, event-subscribe); vanilla services are the most stable layer | S4CL wraps the same vanilla layer plus its own event/logging/dialog frameworks E1 does not need — larger API surface, larger breakage surface |
| Telemetry surface | Sufficient: everything E1-A/B/G needs is observable (or provably absent) without S4CL helpers | S4CL adds convenience (logging, dialogs, testing framework) that E1 MUST NOT use (dialogs = stimulus; test framework = extra code) |
| Packaging burden | One `.ts4script`, no companion config, no multi-file install | S4CL requires `sims4communitylib.ts4script` + `.config` kept together at ≤1-folder depth — doubles install-failure modes and load-order questions |
| Dependency risk | Zero supply-chain beyond EA + worker code | Unmaintained-prior-art risk is already recorded in the master (Control-Any-Sim archived at 1.107; S4CL pre-patch revision `db1ca99`): adding it reintroduces exactly the risk E1 is meant to avoid |
| Scope | Matches "strictly read-only, minimum build" (master §17-E1) | Contradicts minimum-build: imports a general framework for a bounded probe |

Prior-art role of S4CL: retained as SOURCE reference (hook shapes, service
names, event patterns) — read its maintained source during implementation,
but do not import or bundle it. Cite the S4CL revision consulted in the
bundle manifest as `s4cl_source_consulted` (informational only).

### 6.3 Reconsideration gate (only legitimate path to add S4CL later)

S4CL may enter at E2+ planning ONLY if ALL hold: (a) a 1.128-cleared S4CL
release is cited with version+date; (b) a named E2 need cannot be met
cleanly on vanilla interfaces; (c) the E2 plan records the dual version
gate and rollback (remove S4CL, probe still loads or fails-safe). E1
evidence MUST NOT depend on S4CL existing.

### 6.4 Allowed build-time dependencies (non-runtime)

- Worker-side: system Python 3.x for zip packaging + JSON schema checks;
  PowerShell 5.1+ scripts; Node for JSON validation (optional, repo-present).
- No pip packages required. If the worker wants a linter/formatter, it MUST
  be already present on the machine — no installs (this task authorizes no
  installs; §1.4).

---

## 7. Source / module / package layout

All paths relative to repo root `C:\Users\Xharv\Projects\Ashley`.

### 7.1 PRODUCT SOURCE (committed, reviewed)

```text
sims-e1/
  README.md                      # E1-only orientation + pointer to this plan
  src/
    ashley_e1/
      __init__.py                # package marker, version constant only
      probe.py                   # load/unload, save-binding gate, lifecycle
      observers.py               # read-only subscriptions (zone/sim/queue/clock/save events)
      snapshot.py                # immutable record construction (copy-out)
      schema.py                  # schema_version + record validators (pure)
      writer.py                  # background JSONL writer (file I/O only)
      guards.py                  # read-only self-checks (denylist tripwires)
  tools/
    build.ps1                    # compileall + package .ts4script (mechanical, §20)
    verify.ps1                   # package/load/static-guard/schema checks (§19)
    install.ps1                  # copy artifact -> Mods\AshleyE1 (+ backup step)
    remove.ps1                   # remove artifact + verify absence + cache note
  tests/
    test_schema.py               # schema/validator tests (stdlib unittest)
    test_bounds.py               # rotation/queue/drop-counter tests
    test_sequence.py             # session/sequence/monotonicity tests
    test_guards.py               # denylist static-guard tests over src/
  evidence/
    .gitkeep                     # RAW LOGS NEVER COMMITTED (see §7.4)
```

Package name: `ashley_e1` (top-level inside the `.ts4script`; no `s4cl`
namespace, no Ashley-agent imports). Module split is normative: game-touching
reads live ONLY in `observers.py`/`snapshot.py`; file I/O lives ONLY in
`writer.py`; `probe.py` wires lifecycle. A read in `writer.py` or a write
outside `writer.py` is a review failure.

Test-location rule: Python focused tests live in `sims-e1/tests/` and run
with `python -m unittest discover` (stdlib only — no pytest dependency).
TS corpus is NOT run for E1 (§19.8).

### 7.2 BUILD OUTPUT (never committed)

```text
sims-e1/build/
  ashley_e1_<VERSION>.ts4script   # single shippable artifact
  ashley_e1_<VERSION>.sha256      # hash sidecar
  manifest.json                   # version, game-build target, file list, hashes
```

`build/` is gitignored (worker adds the ignore entry under `sims-e1/` scope
only — a 3-line `.gitignore` inside `sims-e1/`, not a rewrite of root ignores).

### 7.3 LOCAL SIMS INSTALL (Owner PC, outside repo)

```text
%USERPROFILE%\Documents\Electronic Arts\The Sims 4\Mods\AshleyE1\ashley_e1_<VERSION>.ts4script
```

One folder deep (satisfies the ts4script depth rule: top-level or one
folder deep — `CURRENT_DOC_VERIFIED` from multiple install guides).
No companion config file. No second copy anywhere in Mods. No `.package`
file for E1 (no tuning override needed; if the implementer finds a tuning
file unavoidable → STOP, §24).

### 7.4 RUNTIME EVIDENCE (outside git; privacy-preserving)

- In-game sink (written by probe): `%USERPROFILE%\Documents\Electronic
  Arts\The Sims 4\AshleyE1Telemetry\ashley_e1_<session>.jsonl` (+ rotations).
- Witness bundle assembly (worker, outside the game):
  `sims-e1/evidence/<witness-id>/` containing COPIES + `manifest.json` +
  witness notes. Raw `.jsonl` MUST be listed in `sims-e1/evidence/.gitignore`
  (worker creates it: `*.jsonl` + `*.jsonl.*`); only `manifest.json`,
  `verdict.md`, and redacted excerpts (≤50 lines, no user-identifying paths
  beyond the standard Sims folder layout) may be committed for review.
- Telemetry MUST NOT include: chat text, Discord IDs, system usernames
  beyond the standard path prefix (strip to `%USERPROFILE%` token at bundle
  time), other-household Sim names beyond IDs needed for E1-A/G (IDs only;
  display names truncated to first-8-chars hash where the game exposes them —
  exact rule in §11.6).

---

## 8. Sims runtime / package mechanics

### 8.1 Artifact mechanics (binding)

- `.ts4script` = zip archive containing compiled Python (`INFERENCE` for the
  exact inner layout until the implementer inspects a known-good 1.128 script
  mod; the build script MUST verify by unzipping and listing: exactly one
  top-level package dir `ashley_e1/` + no stray `__pycache__` at ship).
- `.package` files: NOT SHIPPED in E1. No tuning, no CAS, no Build/Buy.
- Python layout inside artifact: `ashley_e1/__init__.py` + modules from §7;
  no vendored libraries; no `sims4communitylib/`.
- Versioning: `E1_PROBE_VERSION = "1.0.<n>"` monotonic integer suffix;
  version string embedded in `__init__.py`, filename, manifest, and every
  telemetry record (`probe_version`). Rebuilds that change ANY shipped byte
  bump `<n>`.

### 8.2 Install / enable / verify-load (mechanical; see §20 for commands)

1. Close game. Back up `The Sims 4` user folder (or at minimum `Mods/` +
   `saves/` + `Tray/`).
2. Copy artifact to `Mods\AshleyE1\` (exactly one copy).
3. Delete `localthumbcache.package`.
4. Game Options → Other → Enable Custom Content and Mods = ON; Script Mods
   Allowed = ON; Apply; full restart.
5. Load LAB save; expected: at most one unobtrusive load record in telemetry
   (probe announces version + bound-save match result). No dialog, no new
   pie-menu entries, no visible Sim changes. Any dialog/menu entry = STOP.

### 8.3 Mod load ambiguity rule

If the game shows >1 `ashley_e1` entry, or the telemetry `probe_version`
differs from the installed filename version, or no load record appears
within 2 minutes of stable LAB load: STOP as mod-load ambiguity (§24). Do
not "test anyway".

### 8.4 Removal / rollback

`tools/remove.ps1` deletes `Mods\AshleyE1\ashley_e1_*.ts4script`, deletes
`localthumbcache.package`, and verifies (glob + telemetry-dir "no new
writes" check). Rollback = remove + restore `Mods/` backup + delete cache +
relaunch. Removal MUST leave saves untouched (probe never wrote to them).

---

## 9. Read-only API / hook allowlist

Normative principle: **read-only means no state-changing call, no
state-changing flag, no subscription that vetoes/altsers flow, no import
whose execution mutates.** Every allowlisted item needs a verified
1.128 read path; anything unverifiable is DEFERRED, not improvised.

### 9.1 Allowlisted reads (candidate set; implementer verifies each on 1.128)

```text
ALLOWLIST (read-only):
  A1  active Sim / selected Sim identity READ (id + household id; no set)
  A2  SimInfo read: sim_id, first-seen display label hash, age/species/occult
      CLASS READ ONLY (no CAS, no trait/aspiration add/remove)
  A3  instantiation state READ (instantiated vs SIMINFO_ONLY)
  A4  selectability + selection state READ (IS_SELECTABLE / IS_SELECTED)
  A5  interaction queue INSPECTION read (current + queued entries: id/handle,
      affordance id + game text, target id, posture/phase where exposed)
  A6  interaction source/origin metadata READ (e.g. pie-menu/source stamp
      fields as exposed; record verbatim + record absence explicitly)
  A7  motive/commodity level READ (numeric/band as exposed; no set/tune)
  A8  buff/moodlet list READ (tuning id + game text + onset/remaining where
      exposed; no add/remove)
  A9  want/fear STATE READ where naturally available (no toggle, no fulfil)
  A10 clock READ (game timestamp/ticks, speed enum value, paused flag — READ ONLY)
  A11 zone READ (zone id, lot/venue id+name hash, room/bounded position where exposed)
  A12 save/slot identity READ at stable load points (save_slot_guid via
      save-slot proto guid accessor; slot id; sim_id re-read — §17)
  A13 game-time tick counter READ (CommonTimeUtils-style total ticks where
      available; wall clock via Python time.time() at copy-out)
  A14 save/load/zone lifecycle NOTIFICATION subscription (observe only:
      pre-save announcement, post-load stable point, zone early/late load,
      teardown — callbacks do NOTHING but schedule a read snapshot)
```

If obtaining any A-item requires a mutating call on 1.128, the item becomes
`UNAVAILABLE_DEFERRED` and is recorded as such — the worker MUST NOT use a
write-to-read shortcut.

### 9.2 Allowlisted subscriptions/listeners (observe-only, never veto)

- Zone early/late load + teardown observers → schedule bound-save check +
  snapshot (read-only).
- Sim spawn/init observers → record instantiation transitions (no spawn call).
- Interaction queued/started/ended/outcome observers → record lifecycle for
  the entries the game reports (no push/cancel from the callback).
- Save-announcement observer (if a pre-save hook exists that fires without
  requiring the probe to approve the save) → record save-intent marker.
  If the only available hook can cancel/delay saves → DO NOT SUBSCRIBE
  (veto-capable = forbidden).
- Bounded periodic sampler: ONE timer at 1 Hz (default; §13) that copies the
  current snapshot. No faster rate without a STOP-raising justification.

### 9.3 Lifecycle callbacks

`on_load` (verify version, check bound-save match, open session, emit
`session_open`), `on_zone_stable` (emit `zone_snapshot`), `on_teardown`
(flush + emit `session_checkpoint`), `on_unload` (flush + close + emit
`session_close`). None may show UI, play audio, move camera, or touch saves.

### 9.4 Import / hook side-effect audit (binding)

- The worker MUST list every imported game module in `manifest.json`
  (`game_imports[]`) with per-module side-effect disposition
  (`import_time_side_effects: NONE_OBSERVED | UNKNOWN→DEFERRED`).
- Any import whose execution registers interactions, injects affordances,
  patches selectors, alters tuning, or shows UI is FORBIDDEN.
- Dynamic import tricks (`importlib` reload games, monkeypatching,
  `injector` decorators that wrap game functions) are FORBIDDEN in E1 —
  even "read-only wrappers" — because they change the call path under
  observation. Observer-interference testing (§19.7) would be meaningless
  with patched functions.

---

## 10. Mutation denylist (binding)

```text
DENYLIST (MUST NEVER be called/imported/subscribed-with-write in E1):
  D-SAVE    any save/load API (save_using, save-slot write, save-as trigger,
            custom save-data write, persistence-service mutation)
  D-PUSH    interaction push/enqueue/run/start/cancel (incl. sim_info push APIs)
  D-MOTIVE  motive/commodity set/decay-freeze, buff add/remove, trait/aspiration
            add/remove, want/fear fulfil/toggle
  D-AUTO    autonomy enable/disable/category set (even "to observe")
  D-CLOCK   clock set/paused set/speed set/time-of-day set
  D-SELECT  selection set, selectability set, active-Sim set
  D-TRAVEL  travel/zone-change request, household move, spawn/despawn/destroy/reset
  D-HOUSE   household add/remove/merge/split, funds cheat, aging-policy set,
            story-progression set, career assign
  D-OBJECT  Build/Buy place/move/sell, object state set, inventory move
  D-TUNING  tuning inject/override, XML patch, .package write
  D-UI      dialog/notification/pie-menu registration, camera move, prompt answer
  D-NET     socket, ssl, http, urllib, subprocess, os.system, pipe, shared-memory
            server, Discord/Mint client import
  D-CRED    any credential/key/token file read (beyond game build identity)
  D-INPUT   synthetic key/mouse/cursor/gamepad event injection of any kind
```

### 10.1 Static guard (mechanical)

`tools/verify.ps1` fails the build if any denylisted token (dotted-path
list maintained in `tests/test_guards.py::DENYLIST_TOKENS`) appears in
`sims-e1/src/` outside comments that carry the exact marker
`# DENYLIST-REF (doc only):`. The worker keeps the token list synchronized
with §10; adding a game API to the allowlist REQUIRES adding its
mutating siblings to the denylist in the same commit.

### 10.2 Runtime tripwire

`guards.py` wraps the observer registration path: if any callback receives
a game object exposing a denylisted mutator AND the probe holds a reference
that could call it, the probe emits `guard_trip` + disables that observer
for the session (fail-closed) rather than calling. Guard trips are
first-class evidence (§23: `INSTRUMENTATION_FAILURE` if load-bearing).

### 10.3 Game-thread restriction

All game-state reads execute on the game thread inside observer/callback or
the 1 Hz sampler. No game object escapes the game thread except as a
frozen plain-data copy (§13). No lock is held across file I/O.

### 10.4 Weakening prohibition

If a MUST field (§11) cannot be obtained read-only on 1.128: record
`availability: UNAVAILABLE_DEFERRED` + `reason: requires_mutation:<name>`
and continue answering everything else. Do NOT weaken E1. Do NOT add a
"tiny write". STOP only if the missing field makes a MUST verdict
impossible (§24); otherwise return the negative/bounded verdict honestly.

---

## 11. Minimal E1 observation contract (versioned)

`OBSERVATION_SCHEMA_VERSION = 1` (`e1.telemetry/v1`). E3 is explicitly NOT
frozen by this schema (§11.7).

### 11.1 Envelope (every line)

```jsonc
{
  "schema_version": 1,             // integer, MUST be 1 for all V1 records
  "telemetry_session_id": "uuidv4",// one per probe load->unload cycle (§12.4)
  "sequence": 0,                   // uint64, starts 0, +1 per record, no gaps (gaps => dropped counter record)
  "wall_timestamp_ms": 0,          // int64, Python time.time()*1000 at copy-out (game thread)
  "game_timestamp": {              // game time as exposed; raw + normalized
    "ticks": 0,                    // int64 raw tick counter where available, else null
    "sim_datetime": "string|null", // game datetime string verbatim where available
    "clock_speed": "STRING|null",  // speed enum name verbatim (e.g. "SPEED_ONE"), never inferred int
    "paused": true                 // bool where available, else null (tristate: true/false/null)
  },
  "probe_version": "1.0.0",
  "sims_build": "1.128.90.1030",   // Main-Menu string, recorded at session_open
  "event_kind": "session_open",    // enum (§11.3)
  "save": {
    "save_slot_guid": "string|null",
    "slot_id": "string|int|null",  // verbatim type preserved; never coerced
    "save_name_hash": "string|null"// 8-char hash of display name (privacy, §11.6)
  },
  "zone": { "zone_id": "string|null", "lot_id": "string|null",
             "venue": "string|null", "room": "string|null",
             "position": "[x,y,z]|null" },
  "body": {
    "sim_id": "string|int|null",
    "instantiated": true,          // false = SIMINFO_ONLY
    "is_selectable": true,         // null if unexposed
    "is_selected": false,          // null if unexposed
    "posture": "string|null"       // verbatim where exposed
  },
  "interactions": {
    "current": null,               // InteractionRecord or null
    "queue": []                    // InteractionRecord[0..N] in game order
  },
  "source": {
    "origin_raw": "string|null",   // verbatim source stamp (e.g. SOURCE_PIE_MENU) or null
    "origin_norm": "OWNER_UI|NATIVE_AUTONOMY|SCRIPT_DIRECTED|UNKNOWN",
    "origin_confidence": "EXPOSED|INFERRED_ABSENT|UNKNOWN",
    "cause_event": "string|null",  // game cause where exposed
    "executor": "GAME_AUTONOMY|OWNER_UI|HOST_HARNESS|UNKNOWN"
  },
  "motives": [ { "id": "string", "game_text": "string|null",
                  "value": "number|null", "band": "string|null" } ],
  "sim_signals": [ { "kind": "MOODLET|WANT|FEAR|TRAIT_NOTE|LIKE|ASPIRATION_NOTE|RELATIONSHIP_NOTE|FAILURE_PRECURSOR",
                     "tuning_id": "string|null", "game_text": "string|null [GAME_TEXT]",
                     "onset_game_time": "string|null", "remaining": "string|null",
                     "magnitude": "string|null", "consequences": "string|PARTIAL|UNKNOWN",
                     "native_override": false } ],   // bounded: §11.5
  "cause": "string|null",          // lifecycle cause where the game exposes it
  "missingness": {},               // field-name -> MISSING|UNEXPOSED|UNREADABLE:<why>
  "unsupported": [],               // allowlisted-but-unavailable-on-1.128 field names
  "availability": "AVAILABLE|UNAVAILABLE_DEFERRED",
  "note": "string|null"
}
```

InteractionRecord:

```jsonc
{ "handle": "string|null", "affordance_id": "string|null",
  "affordance_text": "string|null [GAME_TEXT]", "target_id": "string|null",
  "phase": "QUEUED|RUNNING|ENDED|UNKNOWN", "origin_raw": "string|null",
  "origin_norm": "OWNER_UI|NATIVE_AUTONOMY|SCRIPT_DIRECTED|UNKNOWN" }
```

### 11.2 Field rules

- Verbatim game strings keep original text + `[GAME_TEXT]` marker in docs;
  records key on IDs (`affordance_id`, `tuning_id`), never display text.
- `origin_norm` mapping MUST be conservative: map to `OWNER_UI` ONLY on the
  confirmed player-click source value; map to `SCRIPT_DIRECTED` ONLY on the
  confirmed script-with-user-intent stamp; everything else (including any
  unverified "autonomy" value) → `UNKNOWN` with `origin_confidence: UNKNOWN`
  unless the witness proves the mapping (§16). Never invent `NATIVE_AUTONOMY`
  from silence.
- Timestamps: wall ms + game ticks BOTH on every record (E1-B needs the
  pair). Units fixed: ms wall, raw ticks + verbatim datetime game.
- `sequence` is per-session monotonic; any intentional gap (rotation,
  teardown) is closed with a `dropped` accounting record (§12.7), never a
  silent jump.

### 11.3 Event-kind enum (closed for V1)

`session_open | session_checkpoint | session_close | zone_snapshot |
interaction_event | motive_snapshot | signal_snapshot | clock_snapshot |
save_marker | guard_trip | dropped | load_disabled | witness_marker`

- `witness_marker` is written ONLY by the Owner's in-game clock-readable
  action AND a simultaneous wall-clock note — the probe never injects
  markers itself (no UI). The witness procedure (§15–§17) defines marker
  discipline: Owner performs a distinctive observable game action (e.g. open/
  close a specific panel is NOT observable — use queue-visible actions only)
  at recorded wall times; the worker correlates after.
- `load_disabled` is the ONLY record emitted outside the bound LAB save.

### 11.4 Missingness / unsupported / unknown

- Every unreadable field appears in `missingness` with a reason; never omit
  silently. `MISSING != ABSENT` (master §4): record which.
- `unsupported[]` lists allowlisted fields with no 1.128 read path found.
- `UNKNOWN` is a legitimate value for any consequence/source field the game
  does not deterministically expose.

### 11.5 Boundedness

- `queue[]` capped at 8 entries (game order; overflow → `truncated: true` +
  count). `motives[]` capped at 12. `sim_signals[]` capped at 16, priority:
  failure-precursors > moodlets > wants/fears > rest. Caps are schema facts
  recorded per record (`truncated` flags); changing caps changes schema
  version.

### 11.6 Privacy

- No Sim display names, no household names, no lot street addresses, no
  account IDs. Hash display strings (FNV-1a 32-bit, hex8) where a label is
  needed for correlation. Bundle step strips absolute paths to
  `%USERPROFILE%`-rooted tokens.

### 11.7 E3 non-freeze

This schema is the E1 witness vehicle, not the future BodyState. E3 may
extend/replace it. No E3 ingestion, wake, or memory field may be smuggled
into V1 "for later" — First-Use Law (§5 of task; master §15): OA-01/UI-01/
RQ-01/Z-01/BB-01/SV-01 preparatory code is FORBIDDEN unless mechanically
unavoidable for read-only telemetry, in which case it is a planning question
→ STOP, not silent scope.

---

## 12. Logging contract (bounded local telemetry only)

### 12.1 Envelope and path (exact)

- Format: JSONL, UTF-8, LF, one record per line, no BOM. No pretty-print.
- Directory: `%USERPROFILE%\Documents\Electronic Arts\The Sims 4\AshleyE1Telemetry\`
  (created by probe on first `session_open` if absent; mode: user-private
  default ACLs; no file outside this dir).
- Active file: `ashley_e1_<telemetry_session_id>.jsonl`.
- Rotated siblings: `ashley_e1_<session>.jsonl.<n>` (`<n>` = 1,2,3…).

### 12.2 Session open/close

- `session_open` first line: `{probe_version, sims_build, save/slot/guid
  as known, lab_match: TRUE|FALSE|UNKNOWN, schema_version}`. If
  `lab_match=FALSE` (not the bound LAB save): emit `load_disabled` + close
  file immediately (stay inert).
- `session_close` last line on clean unload; `session_checkpoint` on zone
  teardown + every 60 s of sampler time (whichever first).

### 12.3 Sequence behavior

Per-session `sequence` starts 0, increments exactly 1 per written line.
Rotation does NOT reset it. A crash-recovered session NEVER reuses a session
id (new UUID on next load; the gap is documented in the witness notes, not
patched).

### 12.4 Session identity

`telemetry_session_id` = UUIDv4 generated in `on_load`. It is the file stem,
the bundle key, and the correlation key in witness notes. No date-username
in the id.

### 12.5 Flush policy + writer design

- Single background writer thread, one open handle per session.
- Flush on: every `session_checkpoint`, every `save_marker`,
  every `guard_trip`, zone teardown, unload, and at least every 5 s during
  continuous writes. `flush()` errors → `dropped` accounting continues in
  memory; writer retries on next flush; after 3 consecutive flush failures
  the probe closes the file cleanly and goes silent for the session
  (fail-closed) with a final best-effort `session_close{close_reason:
  FLUSH_FAILURE}`.

### 12.6 Maximum log size / rotation / retention

```text
MAX_ACTIVE_FILE_BYTES = 8 MiB
MAX_ROTATED_SIBLINGS_PER_SESSION = 4   (total per-session cap ≈ 40 MiB)
MAX_TELEMETRY_DIR_BYTES = 200 MiB (all sessions; enforced at session_open:
  oldest closed sessions deleted first; active session never deleted)
RETENTION_FOR_TRIAL = until witness adjudicated + 30 days, then Owner deletes
  or archives; no cloud copy; no repo commit of raw logs
ROTATION_POLICY = size-triggered; rotate BEFORE exceeding cap; rotation emits
  a `dropped`-family accounting line as first record of the sibling
  (sequence continues; zero data lines lost across the boundary unless
  §12.7 queue saturation says otherwise)
```

No unbounded logging: any of these caps being hit is normal operation, not
error — recorded, counted, adjudicated (§23 weighs drop rate).

### 12.7 Queue / backpressure / dropped-record counters

- Bounded in-memory MPSC queue, capacity 1024 records. Game thread
  `try_put`; on full → drop OLDEST sampler-class record first (priority:
  preserve `session_*`, `guard_trip`, `interaction_event`, `save_marker`
  over `clock_snapshot`/`motive_snapshot`), increment
  `dropped_sampler_total`, and emit a `dropped{reason: QUEUE_SATURATION,
  count}` summary at next successful write (at most 1 per second).
- Malformed-write behavior: the writer NEVER writes a partial line (serialize
  fully in memory, single `write()` + `\n`). A serialization failure drops
  that record + emits `dropped{reason: SERIALIZE_FAILURE}`.
- Crash behavior: torn last line possible; bundle verifier (`verify.ps1`
  + bundle check) treats a single trailing partial line as
  `truncated_tail: true` (tolerated) — two or more corrupt lines, or a
  corrupt non-tail line, = `INVALID` bundle (§23).
- Zone-change/shutdown: teardown drains up to 2 s (bounded), then
  `session_checkpoint{close_reason: TEARDOWN_DRAIN_TIMEOUT|CLEAN}`; records
  still queued after the deadline are counted in `dropped` and abandoned
  (never block the game thread).

---

## 13. Threading / backpressure model (binding)

```text
GAME_THREAD:      observers + 1 Hz sampler -> snapshot.py copy-out
                  (plain-data dicts/lists/strings/numbers ONLY) -> try_put(queue)
WRITER_THREAD:    blocking take -> serialize -> write -> flush policy
INFERENCE/NETWORK IN E1: NONE (no model, no socket, no subprocess anywhere)
GAME_MUTATION FROM WRITER_THREAD: NEVER (writer imports no game modules;
                  verified by verify.ps1 import-edge check)
```

- Observations are ALWAYS copied into immutable records on the game thread
  before enqueue (freeze at copy-out: convert game objects → IDs/strings/
  numbers immediately; never enqueue a live game handle).
- File writing moves to the background writer (single thread, §12.5).
- Bounded queue 1024 + saturation policy §12.7. Saturation that drops >
  5% of records in any 5-minute window, or ANY drop of `session_*` /
  `guard_trip` / `save_marker`, is a STOP-grade observer failure (§24).
- The 1 Hz sampler skips (does not backlog) if the previous copy-out is
  still running: at most one outstanding copy-out; overrun counted in
  `dropped{reason: SAMPLER_OVERRUN}`.

---

## 14. LAB configuration (minimum, noncanonical, low-noise)

### 14.1 Identity and separation

```text
LAB_SAVE_NAME = LAB_E1 (exact; worker + Owner use this name verbatim)
LAB_PURPOSE = E1 telemetry + later E2 qualification (never HOME, never PREVIEW)
PREVIEW_SAVE_NAME = PREVIEW_E0 (E0 only; §3)
HOME_SAVE = NOT CREATED IN E1 (deferred to post-E2 planning per master §17-E2)
MOD_BINDING = probe binds ONLY to save whose slot guid OR save-name-hash
  matches LAB_E1 as recorded at first instrumented load (both recorded;
  guid preferred; name-hash is the fallback + mismatch detector)
```

### 14.2 LAB world (L0 chamber, then staged openings)

Base L0 (deterministic-observation window):

- One flat residential lot, unfurnished except ONE single-seat chair
  (unique target for later E2 reference only — E1 does not use it), one bed,
  one fridge, one bathroom set (toilet+shower+sink). No career objects, no
  instruments, no easels, no chemistry, no mischief objects.
- ONE Sim (LAB actor "E1-Proband", fresh CAS, no relation to Ashley/Owner
  designs; base-game traits only; aspiration any non-social).
- Global autonomy OFF; motives FROZEN if a cheat/mechanism exists that does
  not itself write lineage-relevant state — otherwise motives ON but logged
  (record which; never claim "frozen" unless verified).
- Aging OFF; Neighborhood Stories OFF for the LAB household; walkbys
  suppressed ONLY via in-game lot/visit settings (no mod, no cheat that
  writes persistent world state beyond standard options).
- Wants/Fears: record toggle state; prefer OFF for L0 windows if the toggle
  holds across load (WF-01 support note); verify after every load.
- Fixed camera angle per witness window (Owner sets once, does not touch
  during windows); display mode recorded (§18.1).

Native-autonomy-observation window (required for E1-A's native side):

- Same lot. Autonomy ON (at least "Full" or default per game options),
  motives ON, Wants/Fears ON (L1b posture), Owner hands-off for the window
  duration. This window exists SOLELY to produce native-autonomy
  opportunities the probe can observe. No probe change between windows —
  same build, same save lineage point (reloaded fresh, §16.4).

### 14.3 LAB household/policy record (bundle manifest fields)

`lab_save_name, save_slot_guid@open, slot_id, sim_id, autonomy_setting,
motives_setting, wants_fears_toggle, aging, stories, lot_id, object manifest
(chair/bed/fridge/bathroom ids), camera/display mode, game options hash
(manual transcription of the relevant options screen)`.

### 14.4 What LAB is NOT

Not canonical, not Ashley's home, not the Owner's play save, not a stress
test, not a population sample (L4 comes later). Ordinary-user saves are
never opened with the probe installed except for the inertness check
(§19.6).

---

## 15. E1-A witness — origin / source visibility (MUST)

Question: can observable Sims metadata distinguish Owner pie-menu action
from native autonomy? Both classes MUST have genuine opportunities.

### 15.1 Preconditions

1. Build under test recorded (filename + sha256 + probe_version); Sims build
   = 1.128.90.1030 (Main-Menu string photographed/transcribed); LAB_E1 at
   known lineage point (guid+slot recorded); telemetry dir empty-or-archived.
2. Probe installed per §20; load record + `session_open{lab_match:TRUE}`
   observed; queue-drop counters zero at start.
3. L0 config for the Owner-input leg (§14.2 base); native leg uses the
   autonomy-ON window config. BOTH legs in the same session if stable, else
   two sessions with fresh reloads (record which).

### 15.2 Owner actions (scripted, timestamped)

Leg 1 — Owner-input opportunities (autonomy OFF or Full — record; motives as
per §14.2; need pressure avoided so Owner clicks are the only plausible
cause):

1. At wall time T1 (Owner wall clock, second precision, written down BEFORE
   clicking): click LAB Sim → queue a unique single-step interaction
   (e.g. Sit on the single-seat chair). Wait for completion or 90 s.
2. At T2: click a second distinct interaction (e.g. Sleep/Nap or Watch TV
   if present; must be queue-visible). Wait likewise.
3. At T3: explicitly do NOTHING for 120 s (negative-control window).
4. Repeat 1–3 twice (total ≥4 Owner-input opportunities + ≥2 no-command
   windows).

Leg 2 — native-autonomy opportunities (autonomy ON, Owner hands OFF mouse/
keyboard for the whole leg except emergency):

1. At T4: hands-off 10 minutes (timer visible). No clicks, no camera moves.
2. If zero native interactions occur in 10 min, extend once to 20 min. If
   still zero, record the null result honestly (it constrains verdicts, §23)
   — do NOT click "to help".

### 15.3 Expected telemetry

- Every Owner click SHOULD produce: `interaction_event{phase: QUEUED→RUNNING
  →ENDED}` with `origin_raw` = the game's player-click stamp (whatever
  1.128 exposes) and stable `handle` correlation across the three phases.
- Native leg SHOULD produce: at least one `interaction_event` with a
  DIFFERENT `origin_raw`/absence pattern, or an explicit finding that no
  distinct stamp exists.
- `wall_timestamp_ms` brackets every leg (Owner's written T-times ±2 s
  tolerance for correlation).

### 15.4 Evidence artifact

Per-leg JSONL excerpt + `witness_A.md` (T-times, leg configs, click
descriptions, completion observations, drop counters, file hashes).

### 15.5 Instrumentation-validity proof (required regardless of outcome)

At least 2 Owner-clicked interactions show full QUEUED→RUNNING→ENDED
lifecycle with stable handles AND wall-time correlation within tolerance.
Without this, E1-A is `INVALID` or `INSTRUMENTATION_FAILURE` — never
negative.

### 15.6 Verdicts

- `ANSWERED_POSITIVE`: Owner-input stamps and native stamps (or principled
  absence-patterns) separate the classes across ≥2 instances each, with
  validity proof + no contradictory instance.
- `ANSWERED_NEGATIVE`: validity proof holds AND Owner vs native records are
  indistinguishable (same stamp, or both absent) across the full opportunity
  set. This is SUCCESS-grade evidence (design input), not failure.
- `INCONCLUSIVE`: native leg produced zero native opportunities (nothing to
  compare), or legs ran under incomparable configs.
- `INVALID`: protocol deviation (clicks during hands-off, wrong save,
  autonomy mis-setting, clock drift > tolerance un Wahlzeiten).
- `INSTRUMENTATION_FAILURE`: lifecycle/handles/timestamps missing or drop
  rate beyond §13 bounds.

---

## 16. E1-B witness — game time / wall time (MUST)

### 16.1 Preconditions

Same build/save/probe checks as §15.1. Normal/default speed ONLY. No speed
change before or during. Pause MUST NOT be triggered by anyone (if the game
auto-pauses — modal, load — record it as `INVALID`-window, not data).

### 16.2 Owner actions

1. At wall time W0 (written down): observe stable unpaused play, note game
   clock reading G0 (verbatim datetime string).
2. Hands-off 15 minutes wall (timer). No clicks, no camera, no menus.
3. At W1: note game clock G1. End window.
4. Repeat once (two 15-min windows). Total ≥30 min wall.

### 16.3 Expected telemetry

Continuous `clock_snapshot` records (1 Hz sampler): `{wall_timestamp_ms,
ticks, sim_datetime, clock_speed, paused}`. Ratio computed offline:
`(G1−G0 game-minutes) / (W1−W0 wall-minutes)` + tick-rate check. Both windows
MUST agree within 10% or the discrepancy is investigated (not averaged away).

### 16.4 Evidence artifact

Full-window JSONL + `witness_B.md` (W0/W1, G0/G1, speed setting photo/note,
pause-absence attestation, drop counters, file hashes).

### 16.5 Validity / verdicts

- Validity proof: `clock_speed` constant at default across the window,
  `paused` never true, sampler gaps <2 s, drop rate within bounds.
- `ANSWERED_POSITIVE`: ratio measured in both windows with agreement
  (report ratio + confidence interval, e.g. "≈1 Sim-day per ~24 wall-min —
  CONFIRM/REVISE with numbers").
- `INCONCLUSIVE`: auto-pause/modal intruded, or sampler gaps invalidate.
- `INVALID`: speed was not default, or Owner input intruded.
- `INSTRUMENTATION_FAILURE`: ticks/datetime absent or frozen while the world
  visibly advanced.

---

## 17. E1-G witness — save / body identity (MUST)

The probe performs NO save. The Owner performs all UI saves.

### 17.1 Preconditions

LAB_E1 loaded, session open, identifiers recorded at stable load:
`save_slot_guid (G0), slot_id (S0), sim_id (M0)`.

### 17.2 Owner actions (exact sequence, fresh timestamps each step)

1. **Save** (Ctrl+S / UI Save) → wait for save-complete → record wall time
   + read back identifiers from telemetry (`G1/S1/M1`) without reloading.
2. **Reload** (load the just-saved LAB_E1, no edits) → stable point → record
   (`G2/S2/M2`).
3. **Save-As** to a NEW slot/name (`LAB_E1_FORK`, never overwriting LAB_E1)
   → record (`G3/S3/M3`) → load `LAB_E1_FORK` → stable → record
   (`G4/S4/M4`).
4. **Reload origin** (load LAB_E1 again) → stable → record (`G5/S5/M5`).
   Delete NOTHING yet; `LAB_E1_FORK` retention decision is an Owner call
   after adjudication (default: keep until adjudicated, then Owner deletes).

### 17.3 Expected telemetry

`save_marker` (if the game exposes a pre-save hook) and/or
`zone_snapshot`/`session_checkpoint` at each stable point carrying the
triple `(guid, slot, sim_id)`. Stable-load-point rule: read identifiers
ONLY after load-complete + 30 s quiet (no loading icon, no travel);
transient-hook values are NEVER recorded as findings (master §23: slot ids
can be sticky/sentinel at transient hooks).

### 17.4 Evidence artifact

`witness_G.md` (step table G0..G5/S/M + wall times + which reload went where)
+ JSONL excerpts at each stable point + save-slot screenshots (slot list
showing both saves).

### 17.5 Validity / verdicts

- Validity proof: each stable point has a settled identifier triple with
  sequence continuity and no drops across the point.
- `ANSWERED_POSITIVE`: the Save/Save-As/reload behavior of each identifier
  is stated as a rule with ≥1 confirming instance per transition (e.g.
  "Save preserves guid; Save-As produced guid X (same/changed); reload
  preserves; sim_id stable across all five points" — exact findings, not
  assumptions).
- `ANSWERED_NEGATIVE`: not applicable in the same sense as E1-A; for E1-G
  the "negative" shape is "identifier X carries no discriminating signal"
  (e.g. guid absent on 1.128) — recorded as `ANSWERED_NEGATIVE (field
  absent)` with the same validity weight.
- `INCONCLUSIVE`: any step's stable point missing (crash, modal, rushed
  read).
- `INVALID`: reads taken at transient hooks, or saves performed by anyone/
  anything but the Owner UI (autosave intrusion → declare + redo).
- `INSTRUMENTATION_FAILURE`: guid/slot/sim_id all absent with no
  `unsupported[]` declaration, or drops across stable points.

---

## 18. MAY observations (bounded, opportunistic — never at MUST expense)

Each MAY is TIME-BOXED (≤15 min extra witness time each, ≤2 MiB extra log
each) and SKIPPED the moment it threatens a MUST window. MAY findings are
reported with the same verdict taxonomy but NEVER gate E1 acceptance.

- **M1 display/focus/minimize:** record (display mode: fullscreen vs
  windowed vs borderless; focus loss outcome; minimize outcome) as
  `zone_snapshot{note}` + witness line. No automated focus manipulation.
- **M2 modal-prompt pause:** if a natural game prompt appears during a MUST
  window, record its pause/clock effect; NEVER summon prompts deliberately.
- **M3 passive overhead:** compare menu/frame smoothness qualitatively
  (Owner 1–5 note) + sampler-overrun/drop counters with probe loaded vs a
  5-min unloaded baseline in the same LAB point. No profilers, no overlays.
- **M4 stable-load identifiers:** the G2/G5 reload points of §17 double as
  M4 data (identifier stability across clean loads) — zero extra cost.
- **M5 E1-C consequence metadata:** for each observed moodlet/motive entry,
  record whether the game exposed deterministic consequence fields
  (affordance gates, outcome modifiers, autonomy biases) or `UNKNOWN`. NO
  verdict on E3 richness beyond "fields present/absent/partial".
- **M6 Wants/Fears toggle (WF-01 support):** record toggle state before/
  after each load + CAS open/close if CAS is opened during E0-adjacent work
  (never open CAS in LAB to test this — opportunistic only).

---

## 19. Focused verification (no full corpus)

### 19.1 Unit tests (stdlib `unittest`, `sims-e1/tests/`)

- `test_schema.py`: envelope required-field presence; `origin_norm` closed
  vocabulary; `sequence` monotonic fixture; truncation flags; privacy rule
  (no display-name field survives construction).
- `test_bounds.py`: rotation at exactly `MAX_ACTIVE_FILE_BYTES+1`;
  sibling cap enforcement; dir-cap eviction order; queue-1024 saturation
  priority (sampler dropped before `guard_trip`); `dropped` counter
  arithmetic.
- `test_sequence.py`: session UUID uniqueness across 1000 generations;
  sequence gap detector flags a planted gap; crash-tail tolerance (one
  partial tail line tolerated, two = fail).
- `test_guards.py`: denylist token scan over `sims-e1/src/` fails on a
  planted `save_using` line, passes on the clean tree; writer-import edge
  check (no game-module import in `writer.py`).

### 19.2 Package / load checks (`tools/verify.ps1`)

Unzip artifact → assert single top-level `ashley_e1/` → `compileall` clean →
manifest hash match → denylist scan → schema fixture validate → report
`VERIFY_PASS/FAIL` with per-check lines. Any FAIL blocks install.

### 19.3 Read-only static guards

Denylist scan (§10.1) + import-edge check + "no `open(` outside `writer.py`"
check + "no `socket|ssl|urllib|subprocess|os.system`" check. All in
`verify.ps1`; all must pass.

### 19.4 Inertness outside bound saves

Load a NON-LAB save (any disposable user save COPY, never the original)
with probe installed → expect exactly one `load_disabled` record + silence
for 5 min → PASS. Any further record = FAIL + STOP.

### 19.5 Observer-interference test

Same LAB point, 5 min unloaded (Owner qualitative note + wall/game-time
ratio) vs 5 min loaded (same). PASS if: ratio agrees within 10%, no new
interaction appears that the unloaded baseline lacks, drop counters zero.
Interference or >10% drift = `INCONCLUSIVE`-grade finding, adjudicator decides.

### 19.6 User-save risk check

Verify: no save file mtime/content change attributable to probe windows
(compare `saves/` hashes before/after witness, excluding Owner-performed
saves in §17 which are expected). Any unexplained save mutation = STOP +
rollback + report.

### 19.7 Performance / overhead qualification

Sampler-overrun counter + drop counters + Owner smoothness note (§18-M3).
STOP thresholds: >5% drops in any 5-min window; any `session_*`/`guard_trip`/
`save_marker` drop; perceptible game slowdown attributed by Owner to the
probe (Owner call, recorded verbatim).

### 19.8 What is NOT required

Full Ashley corpus (`npm test`, `phase0:offline`, `eval:full`) is NOT gated
on E1 probe work (master §8: docs/pure-logic selection; this plan itself is
docs-only). The worker runs ONLY `sims-e1` focused tests + `verify.ps1`.
E2+ will define its own gate; E1 MUST NOT pre-run it.

---

## 20. Packaging / install / remove (exact mechanical procedure)

Prerequisites: Windows PowerShell 5.1+, system Python 3.x with `compileall`
+ `zipfile` (stdlib only), game CLOSED, backup taken. All commands from repo
root. `<V>` = probe version (e.g. `1.0.0`).

Build (worker executes; `sims-e1/tools/build.ps1`):

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/build.ps1 -Version <V>
# verify:  1) compileall clean  2) zip -> sims-e1/build/ashley_e1_<V>.ts4script
#          3) sha256 sidecar    4) manifest.json (version, target build
#             1.128.90.1030, file list, hashes, game_imports[], denylist rev)
powershell -ExecutionPolicy Bypass -File sims-e1/tools/verify.ps1 -Version <V>
# must print VERIFY_PASS (per-check lines); else STOP, no install
```

Install (Owner or worker with Owner present; `sims-e1/tools/install.ps1`):

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/install.ps1 -Version <V>
# 1) confirm game closed  2) backup Mods/saves/Tray to Teh Sims 4_BACKUP_<date>
# 3) assert no ashley_e1_*.ts4script already present (else abort: duplicate)
# 4) assert no sims4communitylib.* present (E1 ships none; presence is a warning, not fatal)
# 5) copy artifact -> Documents\Electronic Arts\The Sims 4\Mods\AshleyE1\
# 6) delete localthumbcache.package  7) print post-install checklist (enable
#    CC+Script Mods, restart, load LAB_E1, expect one load record)
```

Enable in game (Owner, mechanical): Game Options → Other → Enable Custom
Content and Mods = ON; Script Mods Allowed = ON; Apply Changes; quit to
desktop; relaunch; Mods list shows exactly one `ashley_e1` entry (version
matches filename; else §8.3 STOP).

Remove / rollback (`sims-e1/tools/remove.ps1`):

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/remove.ps1
# 1) game closed check  2) delete Mods\AshleyE1\ashley_e1_*.ts4script
# 3) delete localthumbcache.package  4) verify glob empty + telemetry dir
#    shows no new writes after removal load  5) optional: restore Mods backup
```

No undocumented manual magic: every step above is scripted; any deviation
(notably hand-editing the `.ts4script`, hand-placing files elsewhere, or
enabling via config-file edits) is a protocol deviation → declared in the
bundle or STOP.

---

## 21. Performance / observer-interference qualification

Carried by §19.5 + §19.7 + §12.7 counters. Minimum reported numbers in every
bundle: total records, `dropped_*` totals by reason, max queue depth
observed, sampler-overrun count, flush-failure count, rotation count,
per-window drop %, Owner smoothness note (1–5 + words), loaded-vs-unloaded
ratio comparison. Adjudication thresholds (§23): drops >5%/5-min or any
load-bearing drop = `INSTRUMENTATION_FAILURE`; perceptible slowdown = STOP
+ `INVALID` for affected windows (rerun after fix or scope reduction).

---

## 22. Evidence bundle (exact contents)

Per witness (`A`, `B`, `G` + optional MAY bundle), directory
`sims-e1/evidence/<witness-id>/` (local; only allowlisted files committed):

```text
manifest.json         # bundle key: plan version, probe version+sha256,
                      # sims build (menu string), LAB lineage (guid/slot/sim),
                      # lab config (§14.3), s4cl_source_consulted (info),
                      # game_imports[], file list + sha256, wall/game time bounds
witness_<A|B|G>.md    # procedure log: preconditions, T/W-times, configs,
                      # deviations (or "none"), drop counters, hashes
verdict.md            # per-question verdict + overall (§23)
excerpts/             # redacted JSONL excerpts ≤200 lines per claim
                      # (full raw .jsonl stays local, gitignored, retained §12.6)
screenshots/          # build string, slot list, relevant game views (as needed)
verify.log            # verify.ps1 output for the build under test
```

Raw-log integrity: sha256 of every `.jsonl` (+ siblings) recorded in
`manifest.json` at bundle time; any post-bundle byte change invalidates the
bundle. Corrupt-line rule §12.7 applies at bundle verification.

---

## 23. Verdict taxonomy (binding)

Per-question verdicts (E1-A, E1-B, E1-G, each MAY):

```text
ANSWERED_POSITIVE       claim established with validity proof, no contradiction
ANSWERED_NEGATIVE       validity proof holds AND the answer is "no / absent /
                        indistinguishable" (E1-A source-indistinguishability;
                        E1-G field-absent). FIRST-CLASS SUCCESS, never failure.
INCONCLUSIVE            opportunities/conditions insufficient (e.g. zero native
                        instances; intruded window) — needs a bounded rerun, not redesign
INVALID                 protocol deviation (wrong save/config/input/timing) —
                        window rerun required, design stands
INSTRUMENTATION_FAILURE probe/logging/validity-proof failure (lifecycle, handles,
                        timestamps, drops, corruption) — fix + rerun, E1 not answerable yet
```

Overall E1 verdict (exactly one):

```text
E1_EVIDENCE_READY_FOR_ARCHITECT_ADJUDICATION
  — all three MUSTs are ANSWERED_POSITIVE or ANSWERED_NEGATIVE with validity
    proofs, drop/corruption bounds met, inertness + user-save checks passed,
    no open STOP items.
E1_BLOCKED_<reason> — otherwise, with the exact finite blocker list
  (missing field, incompatible build/dependency, ambiguous identity,
  load ambiguity, slowdown, drops, corruption, ...).
```

"Logs exist" ≠ success. Negative results are valid evidence and MUST be
reported as `ANSWERED_NEGATIVE`, never relabelled failure, never rerun until
they turn positive.

---

## 24. STOP / failure / recovery (binding on the worker)

STOP means: halt the affected work, preserve evidence, report — do NOT
improvise around the architecture. Any STOP produces a `STOP_<cause>.md` in
the evidence dir with: what was observed, what was preserved, what was NOT
attempted, and the exact missing fact/permission needed to resume.

The worker MUST STOP for (non-exhaustive; master §21-next-step-2 + task §10):

1. Unexpected repo divergence (HEAD/tree ≠ §2.2, or `origin/main` moved with
   implementation-relevant delta unassessed).
2. Wrong/unsupported Sims build (menu string ≠ 1.128.90.1030) or build
   unverifiable.
3. Dependency incompatible with target build (including any pressure to add
   S4CL/any library to "fix" compatibility — E1 ships none).
4. Unsafe hook/API (only veto-capable save hook exists; any read requiring
   mutation; any import with side effects; any request for network/IPC).
5. Telemetry field requiring mutation to obtain (§10.4 → record unavailable;
   STOP only if a MUST verdict becomes impossible).
6. Ambiguous save/body identity (guid/slot/sim_id unreadable AND no stable
   alternative; or Save-As semantics uninterpretable at stable points).
7. Mod load ambiguity (§8.3).
8. User-save risk (unexplained save mutation, §19.6).
9. Unacceptable game slowdown or drop bounds exceeded (§13/§21).
10. Corrupt logging beyond §12.7 tolerance.
11. Need for networking, credentials, Mint, helper, or any E2 actuation to
    "complete" E1.
12. Need for unplanned architecture (new schema axis, new mechanism, new
    household/control/lock/stasis/travel/save/lineage/THI/memory work).
13. Owner authorization missing for the step at hand (build vs install vs
    runtime vs rerun are separate grants).

Recovery: remove probe per §20 if the game state is in doubt; restore Mods
backup; re-verify clean launch; report. Never "fix forward" inside the game
(mutating the LAB save to rescue a witness window invalidates the window).

---

## 25. Worker execution constraints (binding)

1. Touch ONLY §7 paths (+ `.gitignore` inside `sims-e1/` + this plan's
   successor notes if directed). Never edit Ashley source (`apps/`,
   `packages/`, `config/`, `scripts/`, `deploy/`, `docs/` beyond the E1
   evidence allowlist), never touch saves except via Owner UI steps in §17,
   never install anything beyond the §20 artifact copy.
2. No network calls from worker scripts (build/verify/install/remove run
   offline; JSON validation uses repo-present Node or stdlib Python only).
3. No credentials, API keys, tokens, or Mint/Discord references anywhere in
   E1 code, tools, tests, logs, or bundles.
4. Every game-facing name (service, function, event, tuning id) MUST carry
   an evidence tag in a code comment at first use
   (`# SOURCE_VERIFIED|S4CL_PRIOR_ART|INFERENCE|RUNTIME_UNVERIFIED: ...`).
   Untagged game names fail review.
5. Witness honesty: record T/W-times BEFORE acting where the procedure says
   so; never backfill timestamps from telemetry; never cherry-pick windows;
   report null results.
6. E2 leakage check before every commit: `verify.ps1` denylist + import-edge
   + "no E2 token" grep (`push|enqueue|save_using|set_clock|set_motive|
   autonomy|travel|helper|mint|socket|THI|Jev|lineage.*write|autosave`)
   over `sims-e1/src/`. Any hit = commit refused.
7. Docs-only siblings: if the worker touches repo docs, no full-corpus run
   is owed (master §8); focused E1 tests + `verify.ps1` are the gate.

---

## 26. Open items / Owner decisions (finite)

### 26.1 Plan blockers

```text
PLAN_BLOCKERS = NONE (plan is authorable from master + current evidence;
  all runtime unknowns are converted to witness designs above, not hidden)
```

### 26.2 Owner decisions required (before/after review — NOT decided here)

1. **OD-1 (now):** accept V7.3.2a as master or not (master §21).
2. **OD-2 (now):** authorize/decline E0 (CAS trait/aspiration chooser rule:
   who chooses — Ashley body-temperament choice under boundary laws, §3.3).
3. **OD-3 (after plan adjudication):** authorize/decline bounded E1
   implementation (build-only grant, §1.4).
4. **OD-4 (after build verification):** authorize/decline bounded E1
   install + runtime witness (naming build hash, Sims build, LAB save,
   witness IDs, retention window, §1.5).
5. **OD-5 (standing):** Wants/Fears HOME posture, aging/death/failure-class
   policy, economy/cheats, stories, body-edit consent — deferred (needed
   before HOME/E5+, NOT before E1; recorded so E1 LAB choices don't
   pre-decide them).
6. **OD-6 (after E1):** retention/deletion of `LAB_E1_FORK` + raw telemetry
   past the §12.6 window.

No impeachment of the plan on OD items: they are explicit inputs, not gaps.

### 26.3 Residual uncertainties (owned, not hidden)

- Exact 1.128 vanilla read paths/names (`SOURCE_VERIFIED` at implementation;
  `RUNTIME_UNVERIFIED` until witness; S4CL consulted as `PRIOR_ART` only).
- In-game Python version/stdlib subset (`UNKNOWN` → recorded at
  `session_open` as `runtime_probe{python_version, ssl_available:false…}` —
  read-only self-report, no network test beyond import-availability check).
- S4CL 1.128 clearance (`UNKNOWN` at planning; irrelevant by design §6).
- Owner-client build string (`RUNTIME_UNVERIFIED` → §2.3 rule).
- Native-autonomy yield in LAB windows (`UNKNOWN` → E1-A leg 2 measures it).

---

## 27. Exact next step after plan acceptance

1. Independent review of THIS plan (architecture + Owner). Disposition is
   exactly: ACCEPT / ACCEPT_WITH_CORRECTIONS (bounded list) / REJECT (reasons).
2. On ACCEPT: Owner issues the bounded E1 implementation grant (OD-3: build
   only — files, version seed, no runtime).
3. Implementer executes §7–§13 + §19–§20 build/verify loop, returns build
   artifact + `verify.log` + manifest (no game contact yet).
4. Owner issues the runtime grant (OD-4); implementer runs §14–§18 witnesses
   with the Owner, assembles §22 bundles, assigns §23 verdicts.
5. Architect adjudicates E1 evidence; then (and only then) E2 planning begins.
   Do NOT author the autonomous implementation-worker prompt in this pass
   (deferred per task §20 until after plan acceptance).

---

## Appendix P-A. Decision table (unresolved mechanical choices, decided)

| # | Choice | Options | Evidence | Recommendation | Reason | Residual uncertainty |
|---|---|---|---|---|---|---|
| D1 | S4CL depend or not | (a) depend (b) direct vanilla | §6.2: 1.128 tracker reset (`SECONDARY`); S4CL repo/docs verified, 1.128 clearance not citable (`CURRENT_DOC_VERIFIED`/`RUNTIME_UNVERIFIED`); master minimum-build rule | (b) direct, S4CL as source-reference only | Smallest breakage surface, single version gate, matches read-only minimum build | Exact vanilla names verified at implementation |
| D2 | Product-source home | (a) `apps/sims-e1-probe/` (b) `sims-e1/` top-level | Repo convention: `apps/` = Node services (`ASHLEY_SOURCE_VERIFIED`); probe = Python, alien stack | (b) `sims-e1/` | Avoids pretending the probe is a Node service; keeps TS gates from misfiring on it | None (naming only) |
| D3 | Telemetry sink | (a) Mods-adjacent file (b) dedicated `AshleyE1Telemetry/` dir | Install guides: Mods depth rule (`CURRENT_DOC_VERIFIED`); telemetry-beside-mods risks depth/permission confusion | (b) dedicated dir | One writer-owned dir, clear bounds/eviction, no Mods pollution | None |
| D4 | Transport | (a) JSONL-local (b) localhost IPC now | Master §19A: helper from E3; in-mod network IO = NO; E1 = JSONL-local (normative) | (a) JSONL-local | Only E1-compatible option; IPC is E3 architecture | None |
| D5 | Sampling | (a) event-only (b) event + 1 Hz sampler | E1-B needs continuous clock pairs; event-only cannot measure ratios | (b) event + bounded 1 Hz sampler | Measurement requirement forces it; bound keeps overhead trivial | 1 Hz confirmed non-intrusive via §19.5 |
| D6 | Queue depth | 256 / 1024 / unbounded | Unbounded forbidden (§12); 256 risks drops on zone events; 1024 ≈ <1 MiB plain-data | 1024 + priority drops | Headroom without memory risk | Tuned by §12.7 counters, not theory |
| D7 | Log caps | small (1 MiB) / chosen (8/40/200 MiB) / large | Small rotates mid-witness (correlation pain); large risks disk/user-data concerns | 8 MiB active / 4 siblings / 200 MiB dir | Fits ≥30-min windows with headroom; bounded and reviewable | Validated by first-witness sizes |
| D8 | E1-A native leg config | (a) autonomy-off only (b) staged OFF→ON windows | Master §21-2: frozen/off trial cannot answer the native side (normative) | (b) staged L0 + autonomy-ON window | Only design that can produce both classes | Native yield unknown → measured |
| D9 | Save-As target | (a) overwrite LAB (b) new-slot fork | Overwrite destroys the lineage baseline; fork preserves origin for step 4 comparison | (b) `LAB_E1_FORK` new slot | Reversibility + interpretability | Owner deletes fork after adjudication (OD-6) |
| D10 | Test runner | (a) pytest (b) stdlib unittest | No-install constraint (§6.4); repo TS uses vitest but probe is Python | (b) stdlib unittest | Zero new dependencies, offline-capable | None |
| D11 | Schema freeze | (a) freeze E3 now (b) version E1/v1 only | Master: BODY_STATE is semantic, not frozen schema; First-Use Law forbids E3 prep | (b) `e1.telemetry/v1` only | Keeps E1 honest, E3 free | None |

## Appendix P-B. Requirement-to-section trace (task §10 A–N + §21 structure)

A scope/authorization → §1. B baseline → §2. C layout → §7. D dependency → §6.
E allowlist/denylist → §9/§10. F observation contract → §11. G logging → §12.
H threading → §13. I packaging/install/remove → §8/§20. J LAB → §14.
K witness A/B/G → §15/§16/§17. L verdicts → §23. M focused tests → §19.
N STOP → §24. First-use law → §11.7 + §25. Lineage/memory/THI-Jev/security →
§5 boundary + §10 + §11 + §25 (no writes, no memory, no inference, no keys).
E0 → §3. MAY → §18. Evidence → §22. Constraints → §25. Owner decisions →
§26. Next step → §27. Required artifact structure items 1–27 map in order to
§1–§27 above (titles adjusted to plan voice; substance fully present).

---

*End of E0/E1 Implementation-Ready Plan V1. No E-stage execution authorized.
No runtime proof claimed. No implementer prompt authored (deferred to the
post-review pass). Next: independent review → Owner authorization gates
(OD-1..OD-4) → bounded E1 build → bounded E1 witness → evidence adjudication.*
