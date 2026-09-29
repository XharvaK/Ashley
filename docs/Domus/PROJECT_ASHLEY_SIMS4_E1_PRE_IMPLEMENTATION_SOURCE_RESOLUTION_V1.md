# Project Ashley — Sims 4 E1 Pre-Implementation Source Resolution V1

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1.md
DOCUMENT_TYPE = PRE-IMPLEMENTATION SOURCE RESOLUTION PACKET (PHASE SR)
ORDERS =
  V7.3.2a master (SHA A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3)
  V1 plan (SHA 10A3E2800C967D2DF0395FC5488C91D23289D951931AE0C1534CFD680064F254)
  Astra HOLD review (8 blockers R1-R8; 8 finite questions Q1-Q8)
PACKET_VERSION = V1
DATE = 2026-09-28 Europe/Istanbul
```

**NOT:** architecture change · E-stage authorization · implementation · probe
creation · game launch/install · save contact · build authorization · V1.1
(this packet is BLOCKED-gated; see §14).

**HOW TO READ.** §§1–2 fix provenance and method. §§3–10 answer Astra Q1–Q8
(SR-1..SR-8). §11 is the mandated API table (REQUIRED rows end only in
RESOLVED or BLOCKING_ABSENCE). §12 is the exit gate. §13 is the exact
blocker list with finite next-evidence steps. §14 states the STOP outcome.
§15 preserves what a future unblocked V1.1 may reuse without re-tracing.

Evidence classes used (Astra binding): `SOURCE_VERIFIED` (byte-content
inspected in this pass) · `EXTERNAL_PRIMARY` (vendor/publisher) ·
`CURRENT_DOC_VERIFIED` (live doc page inspected) · `PRIOR_ART` (maintained
mod source whose vanilla-symbol claims still need target confirmation) ·
`SECONDARY` (community tracker/press) · `INFERENCE` (author reasoning) ·
`UNKNOWN` (not establishable from permitted evidence) · `RUNTIME_UNVERIFIED`
(not yet witnessed on the Owner client).

Packet-local rule, applied throughout: a wrapper's public API is never cited
as proof of underlying game behavior. Every S4CL-derived vanilla-symbol
claim is `PRIOR_ART` until the decompiled 1.128 game source confirms it.

---

## 1. Baseline and provenance (ASHLEY_SOURCE_VERIFIED observations)

```text
V1_SHA256_REVERIFIED = YES (10A3E2800C967D2DF0395FC5488C91D23289D951931AE0C1534CFD680064F254)
MASTER_SHA256_REVERIFIED = YES (A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3)
ASHLEY_HEAD = 60fec11742486b3d6e0fd8cd33912dd6d10d94c2 (main == origin/main, clean tracked tree)
LOCAL_INTERPRETER = CPython 3.14.3 (magic 2b0e0d0a observed; packaging/inspection only, NEVER target compiler)
PYTHON_37_TOOLCHAIN = ABSENT (no python3.7, no conda env; TOOLING_AUTHORIZATION_REQUIRED, §3.6)
GAME_BINARIES = ABSENT (EA/Steam/Origin install paths probed, none present)
SIMS_USER_DATA = ABSENT (Documents and OneDrive-backed Documents roots probed, no Sims 4 folder)
```

No architecture was reopened. No files outside this packet were created or
modified. No game, compiler, or install was touched.

## 2. Source ledger (everything this packet relies on)

| ID | Source | Revision / identity | Evidence class | Supports | Limitation |
|---|---|---|---|---|---|
| L-EA-PY | EA forum "Python Upgrade Coming Soon" (SimGuruModSquad) | historic post; 3.3.5 → **3.7.0**, `.pyo` → `.pyc`, PEP 488 | EXTERNAL_PRIMARY (historic) | 3.7 family; pyc regime | 2018-era; NOT 1.128 verification |
| L-SANJO-README | SanjoSolutions sims4-mod-development-tools README | `main` unpinned (fetched 2026-09-28); "seems to be 3.7 … check `Game/Bin/python*_x64.dll`" | CURRENT_DOC_VERIFIED | 3.7 family; DLL-check procedure | unpinned; not target proof |
| L-SANJO-COMPILE | Same repo `Utility/helpers_compile.py` | `main` unpinned; `py_compile.compile` per `.py` → `PyZipFile(..., ZIP_STORED)` with relative `.pyc` paths | SOURCE_VERIFIED (content) | community packaging shape | tool behavior, not loader proof |
| L-JUNE-LOAD | June Hanabi "Ultimate Loading Guide" | 2020-10-09 author-tested matrix | SECONDARY/PRIOR_ART | zip/ts4script discovery; .py-only=empty; .pyc loaded; .py+.pyc→py wins; wrong-version pyc mostly fails | pre-1.128; single-author tests |
| L-CPY-370 | CPython tag v3.7.0 `Lib/importlib/_bootstrap_external.py` | `MAGIC_NUMBER = 3394 + CRLF`; timestamp/hash header validators | SOURCE_VERIFIED | exact 3.7 magic + header format | interpreter source, not game proof |
| L-PY37-DOCS | docs.python.org/3.7 `compileall` | `-b` legacy placement; `--invalidation-mode`; `-O` for optimize | CURRENT_DOC_VERIFIED | compiler mechanism | mechanism, not loader compat |
| L-ZIP-DOCS | docs.python.org `zipimport` (3.14 page, version-noted) | imports `.py`+`.pyc` from zips; no archive mutation for py-only | CURRENT_DOC_VERIFIED | zip-import capability | generic Python, not Sims layer |
| L-S4CL-REV | DeviantGameMods/Sims4CommunityLibrary commit `db1ca99` 2026-08-27 (= master S4CL-R anchor) + release v3.22 same day | verified via commits + releases APIs | SOURCE_VERIFIED (rev identity) | pre-1.128 reference freeze | pre-patch; 1.128 clearance UNKNOWN |
| L-S4CL-REL | S4CL releases API at 2026-09-28 | latest v3.22 (2026-08-27); NO post-1.128 release exists | SOURCE_VERIFIED | no 1.128-cleared S4CL citable | absence-of-release ≠ broken proof |
| L-S4CL-Q / -PQ / -RUN / -PRE / -START / -OUT / -CXL | S4CL interaction event classes + `common_interaction_event_dispatcher.py` | `main` at/after db1ca99; blob SHAs recorded in §8 | SOURCE_VERIFIED (content) | producer→dispatch→return traces; veto proof | wrapper layer; game symbols via it are PRIOR_ART |
| L-S4CL-ZONE | S4CL zone-spin dispatcher + 6 event classes | same rev basis | SOURCE_VERIFIED (content) | all zone hooks = injection | same wrapper caveat |
| L-S4CL-SAVE | S4CL save dispatcher + `S4CLSaveSavedEvent/S4CLSaveLoadedEvent` + `CommonSaveUtils` | same rev basis | SOURCE_VERIFIED (content) | save/guid/slot/name symbols; injection paths | vanilla symbols PRIOR_ART |
| L-S4CL-TIME | `CommonTimeUtils`, `CommonAlarmUtils`, `CommonAlarmHandle` | same rev basis | SOURCE_VERIFIED (content) | clock/alarm vanilla symbol names | producer semantics UNKNOWN |
| L-S4CL-ZUPD | zone-update dispatcher + `S4CLZoneUpdateEvent` + interval service | same rev basis | SOURCE_VERIFIED (content) | tick-driven callbacks = injection-based | pause/loading skip logic noted |
| L-S4CL-SIM | `CommonSimUtils`, `CommonSimMotiveUtils`, `CommonBuffUtils`, `CommonGameClientUtils`, `CommonIOUtils`, `CommonService`, `CommonEventRegistry`, `CommonInjectionUtils`, console-command service | same rev basis | SOURCE_VERIFIED (content) | sim/motive/buff/client/IO/service call paths | vanilla symbols PRIOR_ART |
| L-PATCH-1128 | EA 9/22/2026 patch notes (PC 1.128.90.1030) + Sept-22 mods safety guide | EXTERNAL_PRIMARY + SECONDARY | build identity; tracker reset (1.128 clearance UNKNOWN for all mods) | no Python-change announcement (INFERENCE only: no news ≠ no change) |
| L-FANDOM | Sims 4 Modding Wiki Python Scripting | CURRENT_DOC_VERIFIED | starter-project convention: Python 3.7.0 + decompiled EA `base/core/generated/simulation` as source roots | community convention, not proof |

Key consistency check: the S4CL HEAD (`db1ca99`, 2026-08-27) independently
matches the master's S4CL-R anchor — the prior-art freeze is intact and no
silent re-grounding occurred.

---

## 3. SR-1 — Target Python / script loader / bytecode (Astra Q1)

### 3.1 Findings

A. Target build: PC 1.128.90.1030 (`EXTERNAL_PRIMARY`, EA 9/22/2026 notes).
B. Embedded interpreter: **3.7 family supported by external evidence; exact
   1.128 runtime NOT VERIFIED.** L-EA-PY pins the migration (3.3.5→3.7.0,
   `.pyo`→`.pyc`). L-SANJO-README + L-FANDOM corroborate 3.7 as the standing
   convention with a concrete check procedure (`Game/Bin/python*_x64.dll`
   inspection). No post-1.128 toolchain confirmation exists anywhere in
   permitted evidence (L-S4CL-REL: no post-1.128 S4CL release; L-PATCH-1128:
   no interpreter note either way). Exact version (3.7.0 vs later 3.7.x) at
   target: `UNKNOWN`.
C. Build compiler: **CPython 3.7.x required; patch-equality unproven either
   way.** Magic compatibility is governed by `MAGIC_NUMBER` (L-CPY-370:
   3394 + `\r\n`, `SOURCE_VERIFIED`); any 3.7-series compiler emitting magic
   3394 satisfies the format gate, but target acceptance of a neighboring
   3.7.x byte stream is `RUNTIME_UNVERIFIED`. Exact compiler identity MUST be
   pinned (recommended: latest CPython 3.7.x patch, hash-recorded) — and that
   compiler is ABSENT here (§1) → `TOOLING_AUTHORIZATION_REQUIRED`.
D. Artifact content: `.pyc` REQUIRED for the approved E1 package
   (L-JUNE-LOAD: `.py`-only treated as empty mod; wrong-version `.pyc`
   mostly fails, sometimes loads unpredictably — either outcome is
   disqualifying for evidence work). Raw `.py` status:
   `UNKNOWN_FOR_TARGET`; raw source MUST NOT be the fallback (dual-ship
   `.py`+`.pyc` makes the loader prefer `.py` per L-JUNE-LOAD — forbidden
   ambiguity). Path form: **legacy adjacent `.pyc`** (`ashley_e1/__init__.pyc`,
   sibling modules beside it — L-SANJO-COMPILE writes exactly this shape;
   L-PY37-DOCS `compileall -b` is the mechanism). `__pycache__` MUST NOT
   ship. Entry module: top-level package import on loader scan
   (`PRIOR_ART` via L-JUNE-LOAD discovery rules; exact bootstrap call
   un-traced → part of §13 blocker B2).
E. Compilation: `optimize=0` (no `-O`; preserves asserts for guard code),
   timestamp invalidation (default; `checked-hash` only under
   `SOURCE_DATE_EPOCH` discipline — deterministic-ZIP policy belongs to V1.1
   build spec), source paths normalized to relative package paths
   (`ddir`/relative form so absolute checkouts never leak into bytecode).
F. Verification (no-recompile inspector): read ZIP central directory →
   assert exact file list → parse each `.pyc` header (magic == 3394/CRLF,
   flags valid per L-CPY-370 `_classify_pyc`) → assert entry module present
   → assert no `__pycache__`, no `.py` → record compiler identity + magic in
   manifest. System Python 3.14 MAY run this inspector (header parsing is
   version-agnostic byte work); it MUST NOT compile game modules.

### 3.2 SR-1 verdict

`BUILD_CONTRACT_RESOLVED = NO` — family + magic + layout pinned, but exact
target-runtime evidence and compiler availability are missing (§13: B2, B3).
V1's "system Python 3.x + compileall" contract is confirmed invalid and MUST
be replaced (Astra R1 stands).

---

## 4. SR-2 — Mod initialization / lifecycle (Astra Q2)

Traced producer→dispatch→return for every S4CL lifecycle path at L-S4CL-REV:

| S4CL event | Patched producer (vanilla symbol, PRIOR_ART) | Return handling | Classification |
|---|---|---|---|
| Zone early load | `Zone.load_zone` | dispatch after original; return ignored | SOURCE_VERIFIED_REQUIRES_PATCH |
| Zone late load | `Zone.do_zone_spin_up` | dispatch after original; sets loaded flags | SOURCE_VERIFIED_REQUIRES_PATCH |
| Zone teardown | `Zone.on_teardown` | dispatch BEFORE original; return ignored | SOURCE_VERIFIED_REQUIRES_PATCH |
| Zone save | `Zone.save_zone` | dispatch before original; return ignored (but fires on transitions WITHOUT actual save — ambiguous, confirms Astra) | SOURCE_VERIFIED_REQUIRES_PATCH |
| Post-load | `Zone.on_loading_screen_animation_finished` | dispatch after original | SOURCE_VERIFIED_REQUIRES_PATCH |
| Zone-manager start | `ZoneManager.start` | dispatch after original | SOURCE_VERIFIED_REQUIRES_PATCH |
| Save saved | `PersistenceService.save_game_gen` (only if `send_save_message`) | dispatch before original | SOURCE_VERIFIED_REQUIRES_PATCH |
| Save loaded | `GameServiceManager.on_all_households_and_sim_infos_loaded` | dispatch after original; guid-change edge detection | SOURCE_VERIFIED_REQUIRES_PATCH |
| Zone update tick | `Zone.update` | dispatch after original | SOURCE_VERIFIED_REQUIRES_PATCH |
| Interaction queued (pre) | `InteractionQueue.append` | **VETO: listener False/None → queue prevented** (`CommonTestResult(False)`) | SOURCE_VERIFIED_REQUIRES_PATCH (+veto) |
| Interaction post-queued | `InteractionQueue.append` (after original) | payload includes vanilla queue result | SOURCE_VERIFIED_REQUIRES_PATCH |
| Interaction pre-run | `InteractionQueue.run_interaction_gen` | **VETO: False blocks run** | SOURCE_VERIFIED_REQUIRES_PATCH (+veto) |
| Interaction run (post) | same | dispatch after original with bool result | SOURCE_VERIFIED_REQUIRES_PATCH |
| Interaction started | `Interaction._trigger_interaction_start_event` | dispatch after original | SOURCE_VERIFIED_REQUIRES_PATCH |
| Interaction outcome | `Interaction.store_result_for_outcome` | dispatch BEFORE original | SOURCE_VERIFIED_REQUIRES_PATCH |
| Interaction cancelled (+mixer/super) | `Interaction.cancel` / `MixerInteraction.cancel` / `SuperInteraction.cancel` | dispatch BEFORE original; pre-cancel semantics | SOURCE_VERIFIED_REQUIRES_PATCH |

Injection mechanism itself (`CommonInjectionUtils.inject_safely_into`,
L-S4CL-SIM): `setattr(target_object, name, wrapper)` — monkeypatching by
construction. **No removal / un-inject / restore path exists anywhere in the
module** (`SOURCE_VERIFIED` absence after full read): injected hooks cannot
satisfy "listener removal"; cleanup would require game restart. This
independently disqualifies injection for E1 (read-only + bounded lifecycle).

Vanilla passive alternatives: `sims4.commands` console-command registration
exists as a vanilla extension point (`PRIOR_ART` via S4CL's command service
wrapping `sims4.commands.register`), but it is Owner-invoked, not a
lifecycle/observation mechanism — insufficient. No passive zone/sim/save
subscription point was verifiable in permitted evidence.

`LOADER_LIFECYCLE_RESOLVED = NO` (hook table: zero `SOURCE_VERIFIED_PASSIVE_HOOK`; §13: B1).

---

## 5. SR-3 — Main-thread sampler (Astra Q3)

Candidates examined:

1. **Sim-timeline alarm** (`scheduling.Timeline` + `alarms.AlarmHandle` via
   `CommonAlarmUtils.schedule_alarm` on `time_service().sim_timeline`,
   L-S4CL-TIME): vanilla-module imports verified as names; producer
   semantics (thread, pause binding, zone-load persistence default
   `persist_across_zone_loads=False` → cancelled on zone change,
   re-registration driver) `UNKNOWN`. Sim-timeline alarms are game-time
   driven — they do NOT advance while paused, so they cannot supply the
   wall-clock 1 Hz sampler E1-B needs. Status: unsuitable as the wall
   sampler; game-time cadence use unproven.
2. **Zone-update tick accumulation** (S4CL interval service on
   `S4CLZoneUpdateEvent`, L-S4CL-ZUPD): tick-driven, explicitly skips paused
   and loading states — wrong time basis for wall sampling AND requires the
   injected `Zone.update` patch. Rejected.
3. **Threading for the writer**: master S-LF prior art (subprocess/threading
   usable; SSL awkward) is carried, not re-proven here; it covers the
   file-I/O thread only, never the game-thread read driver.

`SAMPLER_RESOLVED = NO` (§13: B1-adjacent — no passive wall scheduler verified).

---

## 6. SR-4 — Save identity + authorized save binding (Astra Q4)

Vanilla symbols identified (`PRIOR_ART`, via L-S4CL-SAVE wrappers whose
bodies are thin pass-throughs):

- `services.get_persistence_service().get_save_slot_proto_guid() -> int`
- `services.get_persistence_service().get_save_slot_proto_buff()` →
  proto with `.slot_id`
- `SaveGameData.slot_name -> str`, `SaveGameData.slot_id -> int` (save-event
  payload only)

Read-only justification: pure accessor calls; no setter in the call path
(`SOURCE_VERIFIED` for the wrapper bodies; vanilla side-effect status
`UNKNOWN`, near-trivially passive by shape but honestly labelled).

Gaps that block pinning: transient/sentinel states `UNKNOWN`; post-Save vs
post-Save-As currency points `UNKNOWN` (the only name-bearing payload,
`S4CLSaveSavedEvent`, arrives via injection BEFORE the save completes and
also fires on non-save transitions); no passive save-name read established;
"30 s quiet ⇒ current" rejected as proof (Astra).

Repaired authorization rule (for V1.1, once reads verify):
`AUTHORIZED_E1_SAVE_NAMES = {LAB_E1, LAB_E1_FORK}` — full exact-name
comparison internally, hash in telemetry only, TRUE-only collection,
FALSE/UNKNOWN suspend, no first-seen learning, no save writes. The rule is
fully specified; its **binding read is not yet feasible**.

`SAVE_BINDING_RESOLVED = NO` (§13: B4).

## 7. SR-5 — LAB body / Sim identity (Astra Q5)

Vanilla symbols identified (`PRIOR_ART`, via L-S4CL-SIM):

- `services.sim_info_manager() -> SimInfoManager`; `.get(sim_id)`; `.get_all()`
- `SimInfo.id -> int`; `sim_info.get_sim_instance(allow_hidden_flags=...)`
  (instantiated ⇔ non-None); `Sim.sim_id`; `sim.sim_info`
- `services.client_manager().get_first_client()` → `.active_sim` /
  `.active_sim_info` (selection/active reads; attribute access, `UNKNOWN`
  game-side effects by strict labelling)
- Readiness hint: S4CL treats
  `GameServiceManager.on_all_households_and_sim_infos_loaded` as the
  populated point — reachable only via injection (`SOURCE_VERIFIED`).

Singleton-LAB-household procedure makes selection deterministic by
construction (no search ambiguity). `sim_id` equality MUST NOT gate
admission (E1-G measures it). Optional selectability flags may be
`OPTIONAL_UNAVAILABLE`. Body-identity reads are the best-pinned family in
the packet, but trustworthiness + readiness predicate still need the
decompiled-script check.

`BODY_IDENTITY_RESOLVED = NO` (blocked on target confirmation + lifecycle; §13: B1/B2).

## 8. SR-6 — Interaction observation / E1-A (Astra Q6)

A–I resolution (all lifecycle events §4: `SOURCE_VERIFIED_REQUIRES_PATCH`):

- A/B (current/queue read): queue inspection is a vanilla attribute read in
  principle (`interaction_queue` object carried by every S4CL payload,
  `PRIOR_ART`); exact 1.128 read path, order guarantee, null behavior:
  `UNKNOWN`.
- C (stable handle): no handle-lifetime evidence in permitted sources;
  `UNKNOWN`.
- D/E/F (queued/started/ended-outcome): producers traced exactly (§4 table);
  every path requires injection; pre-queued and pre-run are veto-capable.
  Passive equivalents: none verified.
- G/H (raw source/origin + enum meaning): the `SOURCE_PIE_MENU` /
  `SOURCE_SCRIPT_WITH_USER_INTENT` values rest on pre-patch master lineage
  (B.10, `RUNTIME_UNVERIFIED` on 1.128); autonomy source value still
  unverified; nothing in this pass advances them.
- I (payload lifetime after queue exit): `UNKNOWN`; S4CL `started`/`outcome`
  payloads carry live `Interaction` refs (game objects, not plain-data
  copies — retention would violate the no-live-ref rule until copied).

`E1_A_ALTERNATIVE_READ_ONLY_MECHANISM` (described, NOT adopted): poll-based
queue-diff from the (unresolved) sampler + contemporaneous Owner notes +
optional external screen capture; native candidacy established independently
of `origin_raw` (input ended, prior queues clear, new action during
hands-off autonomy-ON window, competing mods controlled). Explicitly weaker:
disappearance ≠ `ENDED`; subtype (ordinary autonomy vs critical-need
override) stays `UNKNOWN` unless the game exposes override evidence; verdict
semantics would need rewriting and the sampler it depends on is itself
blocked. Recorded so the gap is precise, not so it can be smuggled in.

`E1_A_OBSERVATION_RESOLVED = NO` (§13: B1 + origin-value gaps).

## 9. SR-7 — Clock / E1-B (Astra Q7)

Vanilla symbols identified (`PRIOR_ART`, via L-S4CL-TIME bodies):

- `services.time_service().sim_now -> DateAndTime`;
  `.absolute_ticks()` (ms scale per wrapper docstring — wrapper claim,
  conversion confirmation owed to game source); `.absolute_seconds() /
  absolute_minutes() / absolute_hours() / absolute_days() / absolute_weeks()`;
  `.hour()/.minute()/.second()/.day()/.week()`
- `services.game_clock_service() -> GameClock`; `.clock_speed`
  (`ClockSpeedMode`: PAUSED/NORMAL/SPEED2/SPEED3/INTERACTION_STARTUP_SPEED/
  SUPER_SPEED3 per S4CL enum use); `.current_clock_speed_scale()`
- `clock.interval_in_sim_seconds/minutes/hours/days`;
  `date_and_time.MILLISECONDS_PER_SECOND`, `sim_ticks_per_day`
- Monotonic wall source in the embedded runtime: `UNKNOWN` (stdlib `time`
  presumed present by `INFERENCE` only — not verified; `ssl` probing already
  removed per Astra; no `time` import observed in S4CL time utils, which use
  game time throughout).

Rollover behavior: `UNKNOWN`. Null/missing states: the S4CL dispatcher guards
(`zone.is_zone_running`, paused/loading skips) are `PRIOR_ART` validity hints,
not verified contract. Schema repair (monotonic elapsed + wall pair,
tri-state speed/pause, agreement formula) is fully specified and waiting on
reads, not on design.

`E1_B_CLOCK_RESOLVED = NO` (reads pinned as candidates; delivery needs the
unresolved sampler; monotonic source unverified; §13: B1/B2).

## 10. SR-8 — Motives / buffs / save notification / user-data root (Astra Q8)

- **Motive passive reader** (`PRIOR_ART`): `CommonSimMotiveUtils.get_motive_level /
  has_motive / is_motive_locked` → species-mapped `_map_motive_id` →
  `CommonSimStatisticUtils.get_statistic_value`; all `set_/increase_/decrease_`
  variants are denylisted mutators (exact forbidden set recorded for the V1.1
  guard list). Status: RESOLVED_AS_OPTIONAL.
- **Buff passive reader** (`PRIOR_ART`): `CommonBuffUtils.get_buffs /
  get_buff_ids` via `BuffComponent` iteration; `Buff.guid64`; `has_buff`;
  `add_/remove_` variants denylisted. Status: RESOLVED_AS_OPTIONAL.
- **Save notification**: all three candidates (zone-save pre-event,
  `save_game_gen`, save-loaded) are `SOURCE_VERIFIED_REQUIRES_PATCH`; the
  zone-save event additionally fires without actual saves. Decision (per
  task §10): OMIT. `save_marker` becomes Owner-attested + stable-snapshot
  correlation. Status: `OPTIONAL_UNAVAILABLE` by design.
- **User-data root**: deterministic procedure fully specified (no game
  evidence needed): resolve the configured Windows Documents known folder
  (Known Folder API, not `%USERPROFILE%` string assumption) → validate
  `Electronic Arts\The Sims 4` beneath it → Owner identifies the actual
  directory if absent/ambiguous → same verified root for Mods + telemetry;
  no filesystem scan; no guessed-root creation. Locally observed: neither
  candidate root exists on this machine (game + user data both absent —
  install grant must re-verify on the Owner PC). Status:
  `USER_DATA_ROOT_RESOLVED = YES`.

---

## 11. SR API table (mandated columns)

Status values: `RESOLVED` | `RESOLVED_AS_OPTIONAL` | `OPTIONAL_UNAVAILABLE` |
`BLOCKING_ABSENCE`. REQUIRED rows use only `RESOLVED` or `BLOCKING_ABSENCE`.

| ID | CAPABILITY | REQ/MAY | EXACT API/SYMBOL | SOURCE LOCATION | REV/BUILD | PRODUCER/CALL PATH | THREAD | READ-ONLY JUSTIFICATION | SIDE EFFECT STATUS | VALUE/TYPE | VALIDITY/READINESS | CLEANUP/REMOVAL | FALLBACK IF ABSENT | EVIDENCE | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| API-B1 | Target bytecode magic | REQ | `MAGIC_NUMBER = 3394 + CRLF`; 16-byte header (magic/flags/mtime-or-hash) | CPython `Lib/importlib/_bootstrap_external.py` (`_classify_pyc`, `_validate_*`) | v3.7.0 tag | build-time header check | n/a (build) | n/a | n/a | u16 magic + flags | pinned for 3.7 family; target acceptance RUNTIME_UNVERIFIED | n/a | STOP (B2) | SOURCE_VERIFIED | RESOLVED |
| API-B2 | 3.7 compiler | REQ | CPython 3.7.x (`compile(..., optimize=0)`, legacy `-b` layout) | L-SANJO-COMPILE shape; L-PY37-DOCS mechanism | unpinned main / 3.7 docs | build script | n/a | n/a | n/a | `.pyc` bytes | compiler ABSENT → TOOLING auth | n/a | STOP (B3) | SOURCE_VERIFIED (shape); UNKNOWN (target) | BLOCKING_ABSENCE |
| API-B3 | Archive discovery | REQ | `<ModDir>.ts4script` (zip) at Mods top level or one folder deep; `.pyc`-only loads | L-JUNE-LOAD matrix; install guides | 2020 / current guides | game loader scan | game thread (import) | n/a (load) | import executes module top-level (must be side-effect-free by construction) | files | PRIOR_ART; exact 1.128 bootstrap untraced | remove file + restart | STOP (B2) | PRIOR_ART | BLOCKING_ABSENCE |
| API-L1 | Zone early/late load | REQ | `Zone.load_zone`, `Zone.do_zone_spin_up` | L-S4CL-ZONE dispatcher | db1ca99 | injection wrapper → dispatch | game (INFERENCE) | n/a (hook itself is the problem) | SOURCE_VERIFIED_REQUIRES_PATCH | event objects | no passive hook verified | NO removal path exists | STOP (B1) | SOURCE_VERIFIED | BLOCKING_ABSENCE |
| API-L2 | Zone teardown | REQ | `Zone.on_teardown` | L-S4CL-ZONE dispatcher | db1ca99 | injection, dispatch-before-original | game (INFERENCE) | — | SOURCE_VERIFIED_REQUIRES_PATCH | event | same | none | STOP (B1) | SOURCE_VERIFIED | BLOCKING_ABSENCE |
| API-L3 | Post-load stable point | REQ | `Zone.on_loading_screen_animation_finished`, `ZoneManager.start` | L-S4CL-ZONE dispatcher | db1ca99 | injection | game (INFERENCE) | — | SOURCE_VERIFIED_REQUIRES_PATCH | event | same | none | STOP (B1) | SOURCE_VERIFIED | BLOCKING_ABSENCE |
| API-L4 | Sim-info populated point | REQ | `GameServiceManager.on_all_households_and_sim_infos_loaded` | L-S4CL-SAVE dispatcher | db1ca99 | injection | game (INFERENCE) | — | SOURCE_VERIFIED_REQUIRES_PATCH | event | same | none | STOP (B1) | SOURCE_VERIFIED | BLOCKING_ABSENCE |
| API-S1 | Wall 1 Hz sampler driver | REQ | none verified (alarm/tick candidates rejected §5) | — | — | — | game thread required | read/copy-out only (spec) | UNKNOWN | 1 Hz callbacks | no passive scheduler | must be cancellable (spec) | STOP (B1) | UNKNOWN | BLOCKING_ABSENCE |
| API-G1 | Save-slot guid | REQ | `services.get_persistence_service().get_save_slot_proto_guid()` | L-S4CL-SAVE `CommonSaveUtils` | db1ca99 | direct call (no hook needed IF callable from a passive context) | game thread | pure accessor (wrapper verified; vanilla UNKNOWN) | UNKNOWN (shape-trivial) | int (S4CL annotation) | transient states UNKNOWN; needs target check | n/a (no registration) | record unsupported; G-validity decides | PRIOR_ART | BLOCKING_ABSENCE |
| API-G2 | Slot id | REQ | `get_save_slot_proto_buff().slot_id` | same | db1ca99 | direct call | game thread | same | UNKNOWN | int | same | n/a | same | PRIOR_ART | BLOCKING_ABSENCE |
| API-G3 | Exact save name | REQ | `SaveGameData.slot_name` (payload-only); no passive reader found | `save_saved.py` properties | db1ca99 | save-event payload via injection | game (INFERENCE) | — | SOURCE_VERIFIED_REQUIRES_PATCH (delivery path) | str | currency points UNKNOWN | none | STOP (B4) | PRIOR_ART / SOURCE_VERIFIED | BLOCKING_ABSENCE |
| API-D1 | LAB body lookup | REQ | `services.sim_info_manager().get_all()` + singleton filter | L-S4CL-SIM `CommonSimUtils` | db1ca99 | direct call | game thread | pure read | UNKNOWN | SimInfo list | readiness needs API-L4 | n/a | STOP (B1/B2) | PRIOR_ART | BLOCKING_ABSENCE |
| API-D2 | sim_id + instantiation | REQ | `SimInfo.id`; `sim_info.get_sim_instance(...)` (None ⇔ SIMINFO_ONLY) | L-S4CL-SIM | db1ca99 | direct call | game thread | pure read | UNKNOWN | int / Sim\|None | needs target check | n/a | STOP | PRIOR_ART | BLOCKING_ABSENCE |
| API-D3 | Selection/active | REQ | `services.client_manager().get_first_client().active_sim[_info]` | L-S4CL-SIM + client utils | db1ca99 | attribute read | game thread | attribute read | UNKNOWN | Sim/SimInfo\|None | needs target check | n/a | OPTIONAL_UNAVAILABLE allowed | PRIOR_ART | BLOCKING_ABSENCE |
| API-Q1 | Queue/current read | REQ | `InteractionQueue` contents inspection (exact accessor untraced) | implied by S4CL payloads | db1ca99 | sampler-driven poll (driver blocked) | game thread | read (spec) | UNKNOWN | ordered entries | order/null UNKNOWN | n/a | alternative §8 or STOP | PRIOR_ART | BLOCKING_ABSENCE |
| API-Q2 | Queued/started/ended-outcome lifecycle | REQ | `InteractionQueue.append`, `.run_interaction_gen`, `Interaction._trigger_interaction_start_event`, `.store_result_for_outcome`, `.cancel` (+mixer/super) | L-S4CL interaction dispatcher | db1ca99 | injection; pre-queued/pre-run VETO-capable | game (INFERENCE) | — | SOURCE_VERIFIED_REQUIRES_PATCH | events + live refs | no passive path | none | alternative §8 or STOP (B1) | SOURCE_VERIFIED | BLOCKING_ABSENCE |
| API-Q3 | Raw source/origin + enum | REQ | `SOURCE_PIE_MENU` / `SOURCE_SCRIPT_WITH_USER_INTENT` (master lineage); autonomy value unverified | master B.10 | pre-patch | attribute read (exact field untraced) | game thread | read (spec) | UNKNOWN | enum/str | RUNTIME_UNVERIFIED on 1.128 | n/a | ANSWERED_NEGATIVE only via valid instrument | PRIOR_ART | BLOCKING_ABSENCE |
| API-C1 | Game ticks + calendar | REQ | `services.time_service().sim_now` + `absolute_ticks()` et al.; `MILLISECONDS_PER_SECOND` | L-S4CL-TIME `CommonTimeUtils` | db1ca99 | direct call | game thread | pure getters | UNKNOWN | int ticks + DateAndTime | conversion basis PRIOR_ART; rollover UNKNOWN | n/a | STOP for E1-B | PRIOR_ART | BLOCKING_ABSENCE |
| API-C2 | Speed + paused | REQ | `services.game_clock_service().clock_speed`, `.current_clock_speed_scale()`; `ClockSpeedMode.*` | L-S4CL-TIME | db1ca99 | direct call | game thread | pure getters | UNKNOWN | enum + scale | needs target check | n/a | window INVALID without | PRIOR_ART | BLOCKING_ABSENCE |
| API-C3 | Monotonic wall source | REQ | stdlib `time.monotonic_ns` (presumed; NOT observed in S4CL time path) | — | — | direct call | game thread | pure read | UNKNOWN | int ns | unverified in embedded runtime | n/a | STOP for E1-B | UNKNOWN | BLOCKING_ABSENCE |
| API-M1 | Motive levels | MAY | `CommonSimMotiveUtils.get_motive_level/has_motive/is_motive_locked` → statistic getters | L-S4CL-SIM motive utils | db1ca99 | direct call | game thread | getter chain (`set_*` DENYLISTED) | UNKNOWN | float | omit-if-absent | n/a | OPTIONAL_UNAVAILABLE | PRIOR_ART | RESOLVED_AS_OPTIONAL |
| API-M2 | Buffs/moodlets | MAY | `CommonBuffUtils.get_buffs/get_buff_ids` (`Buff.guid64`) | L-S4CL-SIM buff utils | db1ca99 | direct call | game thread | iteration + id read (`add_/remove_` DENYLISTED) | UNKNOWN | list | omit-if-absent | n/a | OPTIONAL_UNAVAILABLE | PRIOR_ART | RESOLVED_AS_OPTIONAL |
| API-M3 | Save notification | MAY | `Zone.save_zone` / `PersistenceService.save_game_gen` / save-loaded | L-S4CL-ZONE + L-S4CL-SAVE | db1ca99 | injection; ambiguous (fires without saves) | game (INFERENCE) | — | SOURCE_VERIFIED_REQUIRES_PATCH | event | ambiguous by producer admission | none | OMIT by design | SOURCE_VERIFIED | OPTIONAL_UNAVAILABLE |
| API-P1 | Sims user-data root | REQ (procedure) | Windows Documents known folder → validate `Electronic Arts\The Sims 4` → Owner fallback; no scan | this packet §10 | n/a | installer (off-game) | n/a | n/a | n/a | path | procedure complete; value deferred to install grant | n/a | Owner identifies | INFERENCE (procedure) | RESOLVED |

---

## 12. Source-packet exit gate

```text
BUILD_CONTRACT_RESOLVED = NO (family+magic pinned; B2 target evidence + B3 compiler missing)
LOADER_LIFECYCLE_RESOLVED = NO (zero passive hooks; all traced paths REQUIRE_PATCH, no removal path)
SAMPLER_RESOLVED = NO (no passive wall scheduler; tick/alarm candidates rejected with reasons)
SAVE_BINDING_RESOLVED = NO (symbols PRIOR_ART; passive name read + validity points missing)
BODY_IDENTITY_RESOLVED = NO (symbols PRIOR_ART; readiness + target trust missing)
E1_A_OBSERVATION_RESOLVED = NO (lifecycle REQUIRE_PATCH + veto; origin values unverified)
E1_B_CLOCK_RESOLVED = NO (reads pinned as candidates; sampler + monotonic unverified)
USER_DATA_ROOT_RESOLVED = YES (deterministic procedure, §10)
Optional motives/buffs = RESOLVED_AS_OPTIONAL (never blocking)
Save notification = OPTIONAL_UNAVAILABLE (omitted by design, not a gap)
```

Gate rule (task §12): all load-bearing YES required. Result: **gate NOT met.**

## 13. Exact blockers + finite next-evidence steps

No V1.1. No build authorization. No runtime. The five blockers below are the
complete STOP set; each names the missing fact and the bounded inspection
that would supply it (no game contact beyond reading static artifacts):

- **B1 — no passive game-thread observation mechanism.** All 16 traced
  lifecycle/interaction/save/zone paths are `SOURCE_VERIFIED_REQUIRES_PATCH`
  with no removal path. Next evidence: decompiled 1.128 `simulation` scripts
  (via the standing starter-project convention, L-FANDOM) at exactly:
  `Zone.{load_zone,do_zone_spin_up,on_teardown,save_zone,
  on_loading_screen_animation_finished,update}`, `ZoneManager.start`,
  `PersistenceService.save_game_gen`, `GameServiceManager.
  on_all_households_and_sim_infos_loaded`, `InteractionQueue.{append,
  run_interaction_gen}`, `Interaction.{_trigger_interaction_start_event,
  store_result_for_outcome,cancel}` — seek passive registration/subscription
  points or confirm absence. `services`/`scheduling`/`alarms`/`date_and_time`
  module surfaces included for the sampler question.
- **B2 — no target (1.128.90.1030) runtime evidence.** No game install on any
  accessible machine; no post-1.128 toolchain/mod confirmation citable.
  Next evidence (static, no install): Owner-client `Game/Bin/python*_x64.dll`
  version inspection per L-SANJO-README (5-minute read, establishes exact
  embedded family); record `.pyc` magic expectation (3394 family) against it.
- **B3 — no 3.7 compiler available.** Only CPython 3.14.3 present (which MUST
  NOT compile game modules). Next: `TOOLING_AUTHORIZATION_REQUIRED` for one
  pinned CPython 3.7.x release (exact version + hash + source) before any
  build grant.
- **B4 — no pinnable safe-binding read.** `slot_name` passive readability +
  guid/slot currency points unverified. Resolves inside the B1 inspection
  (persistence-service surface) — not a separate expedition.
- **B5 — sampler composite.** Wall-driver (B1) + monotonic source (B2-class
  static check: stdlib `time` in embedded set) + writer-thread coexistence
  (master S-LF prior art, re-confirm at build). No independent step beyond
  B1/B2.

E1-A alternative (§8) and all V1 witness/schema/logging repairs (Astra
R4–R8 policy halves) are specified and waiting — they require no further
research once B1–B5 clear.

## 14. STOP outcome (binding)

```text
SOURCE_RESOLUTION_STATUS = BLOCKED (B1..B5 above; B1 is the root blocker)
V1_1_AUTHORED = NO (correctly — no guessed mechanics)
RUNTIME_REQUIRED_BEFORE_PLAN_ACCEPTANCE = NO (unchanged; static inspection suffices)
FUNDAMENTAL_MASTER_CHANGE_NEEDED = NO (unchanged; mechanics, not architecture)
E0_STATUS = UNAFFECTED (zero-code Owner procedure stands as written in V1 §3)
```

## 15. Reuse ledger (what a future unblocked pass keeps without re-tracing)

- §3 build contract (family/magic/layout/inspector rules; add compiler pin + DLL check).
- §4 hook table (veto + no-removal findings; S4CL permanently excluded as observation path, retained as source-reference only).
- §6–§10 candidate symbol sets (verify-against-decompiled-source checklist, §13-B1 list).
- §10 user-data-root procedure (final).
- Astra R4–R8 policy repairs as specified in the HOLD review (guards, schema, logging, witnesses, install/authority) — design-complete, implementation-pending-SR.

---

*End of SR packet V1. Static resolution only. No implementation, no runtime,
no proof claimed beyond the bytes actually inspected (ledger §2). Next: clear
B1–B5 with the named static evidence, then — and only then — author V1.1.*
