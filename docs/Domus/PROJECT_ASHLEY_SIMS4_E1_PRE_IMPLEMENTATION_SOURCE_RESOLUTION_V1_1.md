# Project Ashley — Sims 4 E1 Pre-Implementation Source Resolution V1.1

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1_1.md
DOCUMENT_TYPE = PRE-IMPLEMENTATION SOURCE RESOLUTION PACKET, SECOND PASS (V1.1)
SUPERSEDES_FOR_EVIDENCE = PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1.md
V1_SHA256 = BB5A64DBAD55CBB248677235E19D338011ECC7BC45278B8DD09ED50BFC3E80D0
ORDERS =
  V7.3.2a master (SHA A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3)
  V1 plan (SHA 10A3E2800C967D2DF0395FC5488C91D23289D951931AE0C1534CFD680064F254)
  Astra HOLD review (R1-R8; Q1-Q8)
  V1.1 evidence-pass brief (§§1-9: B1/B2/B4/B5, polling-vs-event, no V1.1 yet)
PACKET_VERSION = V1.1
DATE = 2026-09-28 Europe/Istanbul
```

**NOT:** architecture change · E-stage authorization · implementation · probe
creation · game launch/install · save contact · build authorization · V1.1
plan repair (deferred: this pass reports readiness only) · Python
installation (B3 stays tooling-authorization).

**HOW TO READ.** §1 states the source-quality verdict first (no silent
old-dump-as-current). §2 records the local S4CL verification performed in
this pass. §§3–6 resolve B1/B4/B5/B2 with polling-vs-event separation. §7 is
the E1-A feasibility decision. §8 is the updated API table (REQUIRED rows end
only in RESOLVED / RESOLVED_WITH_NARROWER_E1_WITNESS / BLOCKING_ABSENCE).
§9 is the exit gate. §10 is the exact remaining blocker (if any) plus the
smallest next evidence. §11 preserves the V1.1 reuse ledger.

Evidence classes: `SOURCE_VERIFIED` · `EXTERNAL_PRIMARY` ·
`CURRENT_DOC_VERIFIED` · `PRIOR_ART` · `SECONDARY` · `INFERENCE` · `UNKNOWN` ·
`RUNTIME_UNVERIFIED`. Wrapper APIs are never cited as target proof; every
S4CL-derived vanilla symbol stays `PRIOR_ART` until decompiled-target
confirmation, which this pass did not obtain.

---

## 1. Source quality verdict (brief §7 compliance)

```text
EXACT_TARGET_SOURCE (decompiled 1.128.90.1030 simulation scripts) = NOT OBTAINED
NEAR_TARGET_SOURCE (dated post-1.128 script dump with build claim) = NOT OBTAINED
```

What was attempted: web search for 1.128-dated decompiled `simulation`
dumps (`zone.py`, `interaction_queue.py`) returned only tooling repos
(decompilers, workspace templates) and no downloadable build-pinned dump;
no repository with a 1.128 claim was found in permitted evidence. The game
binaries and user-data folders are absent on every accessible machine
(re-verified V1 §1 probes), so no local extraction was possible. No EA
Python-version note for 1.128 exists in the patch record (EA 9/22/2026 notes
+ safety/broken-mods trackers re-checked this pass).

Consequence: all §13-B1 symbols keep their V1 status — `PRIOR_ART` via S4CL
`db1ca99` (2026-08-27, pre-1.128) for the vanilla names, `SOURCE_VERIFIED`
only for the S4CL wrapper/producer traces actually read. Nothing below
promotes prior art to target proof. The advances in this pass are structural
(polling-vs-event separation, one passive callback list, scheduler
correction, monotonic-source confirmation, binding feasibility narrowing),
not a new target dump.

## 2. Local verification performed in this pass (new SOURCE_VERIFIED content)

A full S4CL clone at `db1ca99` (== master S4CL-R anchor, HEAD verified
`db1ca99` locally) was inspected file-by-file (not via web fetch excerpts).
New byte-verified findings beyond V1:

1. **Interaction source enum (vanilla names, PRIOR_ART):**
   `interactions.context.InteractionSource` imported by S4CL; values
   `InteractionContext.SOURCE_PIE_MENU` (player-click; 7 tooltip call sites
   compare `context.source == context.SOURCE_PIE_MENU`) and
   `InteractionContext.SOURCE_SCRIPT_WITH_USER_INTENT` (S4CL's own push
   default in `create_interaction_context`). No `SOURCE_AUTONOMY` value was
   found anywhere in S4CL — autonomy-origin discrimination has no verified
   enum on the S4CL side at all (`UNKNOWN`, harder than V1 stated).
2. **Queue/state poll reads (vanilla attribute paths, PRIOR_ART):**
   `sim.queue` iterated directly (`for interaction in tuple(sim.queue)`,
   None-guarded); running set via `sim.si_state` (`for interaction in
   tuple(sim.si_state)`); per-entry `interaction.guid64`,
   `interaction.context` (`.sim`, `.source`), `interaction.target`,
   `interaction.display_name`/`shortname()`. These are the narrowest
   read-only E1-A/B surface — plain attribute reads, no call, no hook.
3. **Buff callback list (vanilla passive point, PRIOR_ART):**
   `BuffComponent.on_buff_added / on_buff_removed` are pre-existing vanilla
   callback lists; S4CL appends its dispatcher (`if ... not in
   buff_component.on_buff_added: .append(...)`) upon `S4CLSimSpawnedEvent`.
   Appending a listener to an existing list is NOT monkeypatching a game
   method — this is the single passive-subscription-shaped mechanism found.
   Vanilla list semantics on 1.128 still `RUNTIME_UNVERIFIED`.
4. **Monotonic wall source in embedded Python:** `from time import
   perf_counter` used in shipped S4CL (`common_stop_watch.py`:
   `perf_counter()` start/interval/stop) — proves `time.perf_counter` is
   importable and callable in the S4CL-supported embedded runtime
   (`SOURCE_VERIFIED` for the import/call; 1.128 stdlib parity
   `RUNTIME_UNVERIFIED`). `time.monotonic` additionally exists by
   `INFERENCE` (same module, same family) but is NOT cited as verified.
5. **Threading coexistence:** `from threading import Thread` in shipped S4CL
   (`common_loaded_item_registry.py`, background load thread) — proves
   threads can exist in-mod (`SOURCE_VERIFIED`); game-thread safety of
   reads from other threads remains UNPROVEN (reads stay game-thread-only).
6. **Mods-root derivation (no guessing):** `get_mods_location_path()`
   derives Mods from the module's own `__file__`
   (`current_file_path.partition("Mods/")[0] + 'Mods'`) with `''` fallback —
   never `%USERPROFILE%` string assumption. Telemetry root follows the same
   verified-root pattern (V1.1: probe `__file__`-anchored, Owner-confirmed).
7. **Complete injection-target census:** every `inject_safely_into` call in
   S4CL was enumerated — all §13-B1 symbols confirmed injection-only; zero
   passive registration APIs found for zone/save/interaction/sim-init paths.
   Trait/skill/relationship/buff-dispatch producers all patch game methods.
8. **S4CL 1.128 clearance:** releases API re-checked — latest remains v3.22
   (2026-08-27, pre-patch); AllGameMods 1.128 tracker (updated 2026-09-28)
   and theclick 1.128 broken-mods page confirm tracker-reset posture with no
   S4CL-specific clearance citable. S4CL stays source-reference-only.

## 3. B1 — lifecycle vs polling (brief §§1–2)

### 3.1 Lifecycle events (A): no passive mechanism — confirmed, narrowed

All 16 §13-B1 producer paths re-verified as injection-only in the local
clone (exact decorator lines enumerated §2.7), with two veto-capable paths
(`InteractionQueue.append` pre-queue, `InteractionQueue.run_interaction_gen`
pre-run: listener False/None blocks the game action). No `un-inject` /
restore path exists in `CommonInjectionUtils` (full-module read). No vanilla
subscribe/register API for zone/save/interaction/sim events surfaced in any
traced file.

```text
LIFECYCLE_MECHANISM = C (only patch/injection) for every §13-B1 event symbol.
No SOURCE_VERIFIED_PASSIVE_HOOK exists for lifecycle events.
E1 MUST NOT use lifecycle-event observation.
```

### 3.2 Polling / current-state reads (B): source-verified shape, target-unverified

The poll surface (§2.2) requires no hook, no registration, no return-value
interception: iterate `tuple(sim.queue)` / `tuple(sim.si_state)` on the game
thread, copy `{guid64, affordance id, game text, target id, context.source,
phase-by-presence}` to plain data, release all game refs before queue
handoff. Side-effect status: `UNKNOWN` by strict labelling (iteration could
in principle trigger lazy properties — target confirmation owed), but the
shape is the minimal-risk observation primitive available, and it is the
only one that is not disqualified by construction.

```text
POLL_MECHANISM = B (passive polling/read path) at PRIOR_ART confidence.
Covers: current interaction, queue order/contents, source/origin value per
entry, sim/body identity, motives/statistics getters, buff-list iteration,
clock/calendar/speed/paused getters.
Does NOT cover: ended/outcome/cancelled as events (see §3.3).
```

### 3.3 Non-equivalence guard (binding)

Polling disappearance ≠ `ENDED` event. Queue-exit observation establishes
"entry X no longer present at tick T+n" — never which of
completed/cancelled/outcome-failed/superseded occurred, never exact end
time. V1.1 MUST NOT synthesize `phase: ENDED` from absence. The narrowed
E1-A witness (§7) is rewritten to presence/transition language.

## 4. B4 — save binding (brief §4)

Reads (unchanged symbols, `PRIOR_ART`): `get_save_slot_proto_guid()`,
`get_save_slot_proto_buff().slot_id`, `SaveGameData.slot_name/slot_id`
(payload-only). No passive exact-name reader outside the injected save path
was found; currency/transient points stay `UNKNOWN`.

Binding feasibility with polling only: guid + slot are callable from any
passive read context (no hook needed IF the calls themselves verify passive
on target — near-trivially so by shape, honestly `UNKNOWN`). Exact save
name has NO passive read path in evidence. Therefore a name-gated
`lab_match` cannot be computed by the probe alone. Two honest options exist
for V1.1 (decision deferred to V1.1 authoring, both specified here):

- **Option N1 (recommended): Owner-attested binding.** Probe records
  guid/slot/sim triple at every stable point; the Owner's witness table
  attests which save was loaded/saved when (`LAB_E1` vs `LAB_E1_FORK`
  wall-time-anchored). Admission = "stable triple + Owner attestation of
  authorized-save context"; any unattested/ambiguous window suspends
  substantive collection. No name read required; no guid-continuity assumed;
  E1-G answers from the attested sequence.
- **Option N2 (conditional): name read if target confirms.** If the B1
  follow-up inspection finds a passive `slot_name`-equivalent readable from
  poll context, V1.1 adopts full exact-name comparison (`LAB_E1` /
  `LAB_E1_FORK`, TRUE-only collection). Not available today — specified, not
  assumed.

```text
SAFE_BINDING = RESOLVED_WITH_NARROWER_E1_WITNESS (via N1: attested binding;
  N2 upgrades it if target evidence later supplies the name read).
No lineage writes in any option. No first-seen learning. FALSE/UNKNOWN suspend.
```

## 5. B5 — sampler / clock (brief §5)

### 5.1 Periodic read mechanism

- Sim-timeline alarms (`scheduling.Timeline` + `alarms.AlarmHandle`,
  game-time driven, default non-persistent across zone loads): game-time
  basis — stall while paused. Insufficient as the wall sampler; usable at
  most as a game-time cadence source (not needed for E1).
- Zone-update tick accumulation (`Zone.update` injection + interval
  registry): explicitly skips paused/loading; injection-required. Rejected
  (both wrong time basis and prohibited mechanism).
- **Adopted for V1.1: Owner-paced poll windows, no in-game scheduler.**
  The probe exposes a single dependency-free `poll_once()` read/copy-out
  entry callable from any game-thread context the target inspection approves
  (origin options, in preference order: (i) a verified passive per-tick
  callback if B1-follow-up finds one; (ii) an Owner-invoked console command
  `ashley_e1.poll` writing one snapshot line per invocation — vanilla
  `sims4.commands` extension point, `PRIOR_ART`, Owner-driven, zero
  autonomy of the probe; (iii) zone-event-adjacent poll piggyback ONLY if a
  passive anchor is verified). At minimum (ii) alone suffices for E1-B
  (Owner invokes at 1 Hz by wall timer during the two 15-min windows —
  mechanical, auditable) and for E1-A/G stable-point snapshots. No
  background game-thread timer is invented; no injection is used.

```text
PERIODIC_READ = RESOLVED_WITH_NARROWER_E1_WITNESS (poll-once primitive +
  Owner-paced invocation; game-time alarms rejected for wall sampling).
Writer thread (file I/O only, threading PRIOR_ART §2.5) unchanged.
```

### 5.2 Monotonic source

`time.perf_counter` import-and-call verified in shipped S4CL (§2.4):
`SOURCE_VERIFIED` (supported-runtime evidence) / `RUNTIME_UNVERIFIED`
(1.128 parity). V1.1 schema carries both `wall_timestamp_ms`
(`time.time()*1000`, Owner correlation) and `monotonic_ns`
(`time.perf_counter_ns()` with `perf_counter()` fallback) — ratio math uses
the monotonic channel; agreement formula unchanged.

```text
MONOTONIC_SOURCE = RESOLVED (perf_counter cited as verified import/call;
  1.128 parity confirmed at first instrumented load via runtime self-report).
No network probing. No ssl import.
```

### 5.3 Clock reads

`services.time_service().sim_now` + `absolute_ticks()` (ms scale per wrapper
docstring — conversion reconfirmed at witness against G0/G1 wall truth) +
calendar fields; `services.game_clock_service().clock_speed`
(`ClockSpeedMode`) + `current_clock_speed_scale()`; `MILLISECONDS_PER_SECOND`,
`sim_ticks_per_day`. All `PRIOR_ART` (S4CL bodies verified; vanilla producer
semantics target-unverified). Rollover `UNKNOWN` (windows are 15 min —
rollover risk negligible and detectable via tick-monotonicity check).

## 6. B2 — target Python (brief §6)

No static artifact online establishes the 1.128.90.1030 embedded patch
version (EA notes silent; no DLL listing; no post-1.128 toolchain release).
Standing evidence still bounds the family at 3.7 (EA migration post +
S4CL/Python-3.7-only workspace requirements + 3.7-targeted decompiler
submodules `unpyc37`/`pycdc` in the active workspace template —
`CURRENT_DOC_VERIFIED`/`PRIOR_ART` corroboration, not target proof).

```text
TARGET_PYTHON = 3.7 family (unchanged); exact 1.128 patch UNKNOWN.
OWNER_STATIC_CHECK_REQUIRED = YES (one read, ≤1 minute):
  On the Owner PC, in the installed game folder (.../The Sims 4/Game/Bin/),
  report the exact filename matching python*_x64.dll (e.g. python37_x64.dll)
  AND its File-Version property (right-click > Properties > Details).
  Expected shape: 3.7.x. That single value pins the compiler (CPython 3.7.x,
  magic 3394) and closes B2 without further research.
B3 = TOOLING_AUTHORIZATION_REQUIRED (unchanged; DO NOT INSTALL).
```

## 7. E1-A feasibility decision (brief §3)

```text
E1_A_FEASIBILITY = FEASIBLE_WITH_NARROWER_READ_ONLY_WITNESS (no patching)
```

Narrowed mechanism (poll-only, `RESOLVED_WITH_NARROWER_E1_WITNESS`):

1. `poll_once()` snapshots at Owner-paced 1 Hz during staged windows keep
   `{queue contents in order, current/running set, per-entry guid64 +
   context.source verbatim + target id, wall + monotonic stamps}`.
2. Owner-input leg (autonomy OFF or Full — recorded): each click at written
   wall time T; correlation = entry APPEARS within tolerance carrying
   `SOURCE_PIE_MENU` (player-click value; `PRIOR_ART` — if 1.128 exposes a
   different click stamp, record verbatim and map conservatively; if no
   distinct stamp exists, that IS the negative finding).
3. Native leg (autonomy ON, hands-off): candidacy established WITHOUT
   `origin_raw` — input ended + prior Owner queues verifiably clear in
   consecutive polls + NEW entry appears during hands-off + competing script
   mods controlled/documented. Its `context.source` value (whatever 1.128
   exposes, possibly no distinct autonomy value — S4CL side has none) is the
   finding.
4. Verdict semantics (rewritten, honest): POSITIVE = Owner-leg entries and
   native-leg entries separate by source value/absence-pattern across ≥2
   instances each with lossless poll capture of the APPEAR transitions;
   NEGATIVE = both classes captured yet indistinguishable (same stamp or both
   absent) — first-class success; INCONCLUSIVE = zero native appearances;
   INVALID/INSTRUMENTATION_FAILURE per loss/deviation rules. No ENDED claim
   is made or needed — the MUST question is source discrimination, which
   appear-transitions + raw source values answer.

What it cannot establish: exact end/outcome/cancel attribution, queue-exit
causality, subtype (ordinary autonomy vs critical-need override — stays
`UNKNOWN` unless override evidence exposed). V1.1 drops all such claims.

## 8. Updated API table (mandated columns; deltas vs V1 packet marked ★)

| ID | CAPABILITY | REQ/MAY | EXACT API/SYMBOL | SOURCE LOCATION | REV/BUILD | PRODUCER/CALL PATH | THREAD | READ-ONLY JUSTIFICATION | SIDE EFFECT STATUS | VALUE/TYPE | VALIDITY/READINESS | CLEANUP/REMOVAL | FALLBACK IF ABSENT | EVIDENCE | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| API-B1 | Target magic 3394/CRLF + header | REQ | `MAGIC_NUMBER`, `_classify_pyc` | CPython v3.7.0 `_bootstrap_external.py` | v3.7.0 tag | build-time check | n/a | n/a | n/a | u16+flags | pinned (family) | n/a | STOP | SOURCE_VERIFIED | RESOLVED |
| API-B2 | 3.7 compiler pin | REQ | CPython 3.7.x, optimize=0, `-b` legacy | workspace/toolchain docs | unpinned | build script | n/a | n/a | n/a | `.pyc` | compiler ABSENT; Owner DLL check pending | n/a | TOOLING auth | CURRENT_DOC_VERIFIED; UNKNOWN target patch | BLOCKING_ABSENCE |
| API-B3 | Archive discovery | REQ | `.ts4script` zip ≤1 folder deep; `.pyc`-only | loading guide + install guides | 2020/current | loader scan | game import | top-level must be side-effect-free | import executes code | files | PRIOR_ART; bootstrap untraced | remove + restart | STOP | PRIOR_ART | BLOCKING_ABSENCE |
| API-L1..L4 | Zone/save lifecycle events | REQ | `Zone.*`, `ZoneManager.start`, `GameServiceManager.*` | S4CL dispatchers (local clone) | db1ca99 | injection, no removal path | game | — (disqualified) | SOURCE_VERIFIED_REQUIRES_PATCH | events | NO passive hook | none | NOT USED (poll instead) ★ | SOURCE_VERIFIED | BLOCKING_ABSENCE (as events; superseded by API-P0) |
| API-P0 ★ | poll_once() read/copy-out | REQ | `tuple(sim.queue)` / `tuple(sim.si_state)` + per-entry `{guid64, context.source, target, text}` | S4CL `common_sim_interaction_utils` getters (shape) | db1ca99 | Owner-paced invocation (console cmd or verified tick) | game thread only | attribute reads; immediate plain-data copy; no hook | UNKNOWN (minimal-risk shape) | ordered entries | needs target confirmation; loss rules in witness | n/a (no registration) | STOP if target denies | PRIOR_ART | RESOLVED_WITH_NARROWER_E1_WITNESS |
| API-S1 | Wall 1 Hz driver | REQ | Owner-paced `ashley_e1.poll` (console cmd) or verified passive tick | `sims4.commands` ext. point (PRIOR_ART); tick TBD | db1ca99 | Owner wall timer → invoke → poll_once | game (cmd) | read-only command body | UNKNOWN (vanilla dispatch) | 1 snapshot/invoke | sufficient for B/A/G windows | command unregisters on unload | STOP if denied | PRIOR_ART | RESOLVED_WITH_NARROWER_E1_WITNESS |
| API-G1/G2 | guid + slot id | REQ | `get_save_slot_proto_guid()`; `get_save_slot_proto_buff().slot_id` | S4CL `CommonSaveUtils` | db1ca99 | direct call in poll context | game | pure accessor shape | UNKNOWN | int/int | transient UNKNOWN; stable-point rule | n/a | attest + record | PRIOR_ART | RESOLVED_WITH_NARROWER_E1_WITNESS ★ |
| API-G3 | Exact save name | REQ | `SaveGameData.slot_name` (payload-only; no passive reader found) | S4CL `save_saved.py` | db1ca99 | injection delivery | game | — (delivery disqualified) | SOURCE_VERIFIED_REQUIRES_PATCH | str | currency UNKNOWN | none | N1 attested binding ★ | PRIOR_ART/SOURCE_VERIFIED | BLOCKING_ABSENCE (as probe read; N1 covers) |
| API-D1/D2 | Body lookup + sim_id/instantiation | REQ | `sim_info_manager().get_all()` + singleton filter; `SimInfo.id`; `get_sim_instance()` | S4CL `CommonSimUtils` | db1ca99 | direct call in poll context | game | pure reads | UNKNOWN | SimInfo/int/Sim\|None | readiness = populated-manager check at stable point | n/a | STOP | PRIOR_ART | RESOLVED_WITH_NARROWER_E1_WITNESS ★ |
| API-D3 | Selection/active | MAY | `client_manager().get_first_client().active_sim[_info]` | S4CL client utils | db1ca99 | attribute read | game | attribute read | UNKNOWN | Sim\|None | omit-if-absent | n/a | OPTIONAL_UNAVAILABLE | PRIOR_ART | RESOLVED_AS_OPTIONAL |
| API-Q3 | Raw source/origin values | REQ | `InteractionContext.SOURCE_PIE_MENU` (verified name); `SOURCE_SCRIPT_WITH_USER_INTENT` (S4CL push default); NO autonomy value in S4CL | local clone grep (7 tooltip sites + context factory) | db1ca99 | per-entry `interaction.context.source` read | game | attribute read | UNKNOWN | enum/int | click value PRIOR_ART; autonomy UNKNOWN (narrower than V1) | n/a | verbatim-record + negative-capable | PRIOR_ART (names); UNKNOWN (1.128 values) | RESOLVED_WITH_NARROWER_E1_WITNESS ★ |
| API-C1/C2 | Ticks/calendar/speed/paused | REQ | `time_service().sim_now.*`; `game_clock_service().clock_speed/scale`; `ClockSpeedMode.*` | S4CL `CommonTimeUtils` | db1ca99 | direct call in poll context | game | pure getters | UNKNOWN | ints/enum | conversion reconfirmed at witness | n/a | STOP for E1-B | PRIOR_ART | RESOLVED_WITH_NARROWER_E1_WITNESS ★ |
| API-C3 | Monotonic wall | REQ | `time.perf_counter[_ns]` | S4CL `common_stop_watch.py` (import+call shipped) | db1ca99 | direct call | game | pure read | SOURCE_VERIFIED (supported runtime); parity RUNTIME_UNVERIFIED | float/int ns | self-report at session_open | n/a | `time.time` fallback (correlation only) | SOURCE_VERIFIED | RESOLVED ★ |
| API-M1/M2 | Motives/buffs | MAY | motive getters; `BuffComponent` iteration + `guid64`; buff callback-list append (passive-shaped) | S4CL motive/buff/sim-dispatcher files | db1ca99 | direct call / list append | game | getters; list-append (no method patch) | UNKNOWN (getters); PASSIVE-SHAPED (buff list, target-unverified) | floats/lists | omit-if-absent | list removal on unload (spec) | OPTIONAL_UNAVAILABLE | PRIOR_ART | RESOLVED_AS_OPTIONAL |
| API-M3 | Save notification | MAY | `Zone.save_zone` / `save_game_gen` paths | S4CL dispatchers | db1ca99 | injection; ambiguous | game | — | SOURCE_VERIFIED_REQUIRES_PATCH | event | ambiguous | none | OMIT by design | SOURCE_VERIFIED | OPTIONAL_UNAVAILABLE |
| API-P1 | User-data root | REQ (procedure) | `__file__`-anchored Mods derivation + Owner confirmation; no scan | S4CL `common_log_utils` pattern (verified) | db1ca99 | installer (off-game) | n/a | n/a | n/a | path | procedure final | n/a | Owner identifies | SOURCE_VERIFIED (pattern) | RESOLVED |

## 9. Exit gate

```text
BUILD_CONTRACT_RESOLVED = NO (B2 Owner check + B3 tooling grant outstanding; compiler/magic/layout pinned)
LOADER_LIFECYCLE_RESOLVED = N/A-BY-DESIGN (lifecycle events abandoned; poll primitive replaces them)
SAMPLER_RESOLVED = YES-NARROWED (Owner-paced poll_once; no in-game scheduler invented)
SAVE_BINDING_RESOLVED = YES-NARROWED (N1 attested binding; N2 conditional upgrade)
BODY_IDENTITY_RESOLVED = YES-NARROWED (singleton + stable-point poll reads)
E1_A_OBSERVATION_RESOLVED = YES-NARROWED (§7 appear-transition witness, no ENDED claims)
E1_B_CLOCK_RESOLVED = YES-NARROWER (reads + perf_counter + Owner-paced 1 Hz; conversion reconfirmed at witness)
USER_DATA_ROOT_RESOLVED = YES (unchanged)
Optional motives/buffs = RESOLVED_AS_OPTIONAL; save notification = OPTIONAL_UNAVAILABLE (omitted)
```

```text
LOAD_BEARING_SOURCE_RESOLUTION_COMPLETE = CONDITIONAL-YES:
  YES for authoring V1.1 with the narrowed poll-only design, CONDITIONAL on
  (a) one Owner static check (B2: python*_x64.dll name + File version, §6) and
  (b) TOOLING_AUTHORIZATION for one pinned CPython 3.7.x before any build grant.
  Target-confirmation of the PRIOR_ART poll/clock/identity reads happens at first
  instrumented load (loader self-report + stable-point checks) and is written into
  V1.1 as STOP-gated acceptance, not as assumed truth.
```

## 10. Remaining blocker and smallest next evidence

No further web/static pass can close the two conditionals — both are
single facts on the Owner PC, neither is research:

1. **B2-final:** Owner static check (§6, one DLL read). Closes the compiler pin.
2. **B3:** tooling authorization (pinned CPython 3.7.x + hash + source). No install in any planning grant.
3. **Target-confirmation (runtime-acceptance, NOT plan-acceptance):** first
   instrumented load proves or kills the PRIOR_ART reads (poll shape, clock
   conversion, guid/slot currency, source-stamp values, `perf_counter`
   parity) under V1.1 STOP rules. This is witness evidence, not a plan
   blocker — V1.1 is authorable now because every load-bearing mechanism has
   a specified read path plus a fail-closed absence rule.

If the Owner DLL check contradicts the 3.7 family, this packet's build
contract is void and resolution returns to BLOCKED (exact new evidence: the
reported version string).

## 11. V1.1 reuse ledger (what the plan-repair pass takes from here)

- Poll-only observation doctrine (§3): no lifecycle subscriptions, no
  injection, no veto surfaces; `poll_once()` + Owner-paced invocation as the
  sole game-thread read driver; disappearance≠ENDED as a normative rule.
- Narrowed E1-A witness (§7): appear-transitions + verbatim source values +
  hands-off candidacy; negative-capable; no end/outcome claims.
- Attested binding N1 (§4) with N2 upgrade condition; TRUE-only collection;
  FALSE/UNKNOWN suspend.
- Sampler/clock package (§5): Owner-paced 1 Hz; monotonic `perf_counter`
  channel + wall channel; conversion reconfirmed at witness; pause/speed
  tri-state validity.
- B2 Owner check text (§6) + B3 tooling-grant text (exact package pin at
  V1.1 authoring).
- Guard lists: exact forbidden mutators (`set_*` motive/statistic, `add_/
  remove_buff`, clock setters, push/enqueue/cancel, save APIs, injection
  helper, `sims4.commands` registration EXCEPT the single approved
  `ashley_e1.poll` command), approved poll/getter set from §8.
- Installer: `__file__`-anchored root resolution + Owner confirmation; cache
  deletion as installer action; no Mods backup restore-over-changes.
- Manifest: master/V1/SR-V1.1 SHAs, compiler pin + magic 3394, target build,
  consulted S4CL `db1ca99`, per-symbol evidence classes, source-content
  digest discipline.

---

*End of SR packet V1.1. Static resolution only. V1.1 PLAN REPAIR NOT AUTHORED
in this pass (awaits V1.1-plan grant after review of this packet + Owner DLL
check + tooling decision). E0 unaffected. No implementation, no runtime, no
proof beyond the bytes actually inspected.*
