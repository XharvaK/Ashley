# Project Ashley — Sims 4 E1 Pre-Implementation Source Resolution V1.2

```text
DOCUMENT =
  PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1_2.md
DOCUMENT_TYPE = PRE-IMPLEMENTATION SOURCE RESOLUTION PACKET, NARROW CORRECTION PASS (V1.2)
SUPERSEDES_FOR_EVIDENCE =
  PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1_1.md
V1_1_SHA256 = 4DA1A480F68D8D0649C7513C8910F8A8FEB075E8D6970530581051B843D9110B
V1_SHA256 = BB5A64DBAD55CBB248677235E19D338011ECC7BC45278B8DD09ED50BFC3E80D0
SCOPE = TWO NARROW CORRECTIONS ONLY:
  (1) replace/verify the Owner-paced 1 Hz design with a real-time scheduler;
  (2) make Owner-attested save binding enforceable via a volatile arm mechanism.
ORDERS = V7.3.2a master; V1 plan; Astra HOLD; V1.1 evidence-pass brief.
PACKET_VERSION = V1.2
DATE = 2026-09-28 Europe/Istanbul
```

**NOT:** architecture change · E-stage authorization · implementation · probe
creation · game launch/install · save contact · build authorization · V1.1
plan repair (still deferred) · Python installation.

**HOW TO READ.** §1 corrects the 1 Hz design with the real-time alarm
candidate. §2 makes the arm/disarm binding enforceable. §3 carries forward
unchanged V1.1 resolutions by reference. §4 is the updated exit gate. §5 is
the remaining-prerequisite list (Owner/tooling only). New byte-verified
evidence in this pass is marked `SOURCE_VERIFIED (V1.2 local read)`; prior
labels otherwise unchanged.

---

## 1. Real-time scheduler correction (replaces V1.1 §5.1 Owner-paced design)

### 1.1 The V1.1 design is withdrawn

V1.1 §5.1 ("Owner-paced poll_once", ~900 manual `ashley_e1.poll` invocations
per 15-minute window) is WITHDRAWN as mechanically unacceptable for exactly
the brief's reasons: Owner burden, hands-off contamination of the E1-A
native leg, and measurement of command entry rather than game/wall behavior.
It MUST NOT be carried into V1.1. No fallback to manual polling is adopted;
had no scheduler qualified, this packet would have stayed BLOCKED.

### 1.2 Candidate evidence (PRIOR_ART, honestly labelled)

- **MTS thread "Script mod to run in interval" (2021-01-18,
  `db.modthesims.info/showthread.php?t=651671`, `SECONDARY` author-tested
  report): directs to `simulation > alarms.py`, states `add_alarm_real_time`
  runs callbacks by real seconds while `add_alarm` follows the in-game clock,
  and gives a complete `add_alarm_real_time(self, TimeSpan(
  interval_in_real_seconds(seconds)), self._tick, repeating=True,
  use_sleep_time=True, cross_zone=False)` + `cancel_alarm(handle)` pattern
  explicitly "chopped up" from EA's `simulation > simulate_to_time.py`
  (`PRIOR_ART`, untested by its own author, pre-1.128).
- **S4CL local clone (`db1ca99`, `SOURCE_VERIFIED (V1.2 local read)`):**
  `import alarms` + `alarms.add_alarm(self, time_span, _on_end,
  repeating=False, use_sleep_time=False)` in live use
  (`classes/effects/common_visual_effect.py:10,160`) with
  `alarms.cancel_alarm(handle)` teardown (`:164`); `AlarmHandle.__init__`
  signature `(owner, callback, timeline, when, repeating, repeat_interval,
  accurate_repeat, cross_zone)` confirmed via `CommonAlarmHandle` super-call
  (`classes/time/common_alarm_handle.py:56-65`); `CommonAlarmUtils.
  schedule_alarm` documents `persist_across_zone_loads=False` → alarm
  cancelled on zone change. `add_alarm_real_time` itself is NOT called
  anywhere in S4CL — its existence/signature on 1.128 is therefore
  `PRIOR_ART` (MTS + EA-pattern lineage), not S4CL-verified.
- **Negative grep results (recorded, not hidden):** `add_alarm_real_time`
  and `interval_in_real_seconds` return zero hits in S4CL and in the
  code-search index available to this pass; no decompiled 1.128
  `alarms.py`/`simulate_to_time.py` was obtainable (same source-quality
  verdict as V1.1 §1: no EXACT/NEAR_TARGET_SOURCE).

### 1.3 Qualification verdict for V1.1 authoring

The real-time alarm is ADOPTED as the V1.1 scheduler on a
`PRIOR_ART + first-load acceptance` basis (not as target proof):

```text
REAL_TIME_SCHEDULER = RESOLVED (for V1.1 authoring; target confirmation at first load)
EXACT_SYMBOL = alarms.add_alarm_real_time(owner, TimeSpan(interval_in_real_seconds(1)),
  callback, repeating=True, use_sleep_time=False, cross_zone=False)
THREAD = game thread (INFERENCE from alarm-callback convention: callbacks execute
  in the scheduler's game-thread dispatch like all S4CL-wrapped alarm/zone callbacks;
  V1.1 writes the assumption down and the first-load acceptance proves re-entrancy safety
  by construction — callback does read/copy-out + try_put only, never blocks)
PAUSE_BEHAVIOR = runs on REAL seconds independent of game-time pause (PRIOR_ART claim
  from the MTS thread: add_alarm_real_time vs game-clock add_alarm; E1-B windows
  REQUIRE paused=false separately — the scheduler running through a pause does not
  validate a paused window, it only guarantees sampler continuity)
CANCELLABLE = YES: alarms.cancel_alarm(handle) (SOURCE_VERIFIED call shape in S4CL live
  use) + handle-None discipline (single-instance guard: start cancels existing first,
  MTS pattern) + cross_zone=False (alarm dies on zone change; V1.1 re-arms explicitly
  rather than persisting silently)
PATCH_REQUIRED = NO (direct vanilla module call `import alarms`, same import shape as
  S4CL's live `import alarms` use — no setattr patching, no wrapper, no return-value veto)
E1_READ_ONLY_COMPATIBLE = YES (scheduling/cancelling mutates only instrumentation
  scheduler state — the alarm registry entry owned by the probe — never Sims world
  state: no interaction, no motive, no clock, no save, no selection, no household,
  no object. V1.1 states this boundary explicitly and the callback body is
  poll_once-read-only by construction.)
```

Preferred E1 design (binding on V1.1): Owner issues ONE `ashley_e1.start`
(console command) → probe creates ONE repeating 1-real-second alarm →
callback runs `poll_once()` (read/copy-out + `try_put`, never file I/O, never
blocks; overrun skips, counted) → Owner is fully hands-off for native
windows → Owner issues ONE `ashley_e1.stop` → `cancel_alarm` + handle
cleared. Start/stop are the ONLY Owner inputs during a window (2 commands
per window, not ~900). `start` while armed is idempotent-restart (cancel +
recreate, counted); `stop` while idle is a no-op success.

First-load acceptance (STOP-gated, written into V1.1): (a) `import alarms`
resolves with `add_alarm_real_time` + `cancel_alarm` present and the MTS
signature accepted; (b) a 60-second pre-witness alarm test shows 60±2
callbacks with the game unpaused AND continued callbacks across a pause
toggle (pause-behavior proof) AND zero callbacks after `stop` (cancellation
proof); (c) callback re-entrancy safe (no game mutation observed, drop
counters clean). Any failure → `INSTRUMENTATION_FAILURE`, no witness runs.
If `add_alarm_real_time` is absent on 1.128, V1.1 falls back to a
STOP-blocked state (no silent substitution by game-time alarms or manual
polling — both already rejected with reasons).

## 2. Enforceable Owner-attested binding (makes V1.1 §4-N1 mechanical)

### 2.1 Command contract (volatile instrumentation state only)

```text
ashley_e1.arm LAB_E1 | ashley_e1.arm LAB_E1_FORK   (exactly one argument; exact full-name match)
ashley_e1.disarm
ashley_e1.start   (requires armed; creates the §1 alarm; snapshots identifiers)
ashley_e1.stop    (cancels the alarm; retains arm until disarm or zone change)
```

Probe-local state (volatile, in-memory ONLY, never persisted, never written
to any save):

```text
armed_name: None | "LAB_E1" | "LAB_E1_FORK"
armed_snapshot: {guid, slot_id, sim_id, wall_time, monotonic_ns} | None
sampling_active: bool (alarm handle non-None)
```

Rules (binding):

- `arm <name>` validates the argument against the two authorized names
  (anything else → error, state unchanged), sets `armed_name`, clears any
  prior snapshot, does NOT start sampling. Requires no game read to succeed
  (attestation is the Owner's claim, recorded with wall/monotonic stamps).
- `start` requires `armed_name is not None` (else error, no alarm). On
  start: snapshot current guid/slot/sim triple read-only into
  `armed_snapshot` (values recorded, continuity NEVER required), create the
  §1 alarm, set `sampling_active`. Substantive telemetry emits ONLY while
  `armed_name is not None AND sampling_active`.
- Save-As step REQUIRES explicit re-arm: after the Owner performs Save-As,
  they MUST `ashley_e1.disarm` + `ashley_e1.arm LAB_E1_FORK` + `ashley_e1.
  start` before the fork window counts. Telemetry between disarm and re-arm
  is inert by construction.
- Zone change with `cross_zone=False` kills the alarm; the probe detects
  dead-handle on next command/poll, sets `sampling_active=False`, and
  refuses further substantive records until explicit `start` (no silent
  resume, no first-seen trust).
- `stop`/`disarm` cancel the alarm if live (`cancel_alarm`, best-effort,
  handle cleared); `disarm` additionally clears `armed_name` + snapshot.
  Unrelated/unknown saves remain unarmed because arming names only the two
  authorized saves and sampling requires an explicit arm→start sequence the
  Owner performs only in the witnessed save.
- Game restart clears everything (in-memory only); re-arm is mandatory.
  No lineage/marker write exists anywhere in this contract.

```text
OWNER_ATTESTED_BINDING = ENFORCEABLE
ARM_MECHANISM = sims4.commands console commands (arm/disarm/start/stop;
  single approved command family; argument-validated; error-closed on misuse)
VOLATILE_ONLY = YES (in-memory dict + alarm handle; no file, no save, no pickle)
WORLD_MUTATION = NONE (command bodies: validate strings, set/clear locals,
  snapshot read-only triple, create/cancel own alarm; no game-state call)
CLEANUP = stop/disarm cancels alarm + clears state; console-command registration
  itself has NO unregister path in evidence (S4CL service shows _add_command only;
  no remove/deregister found) → restart-required cleanup stated truthfully:
  commands persist until game restart, which is harmless (they do nothing while
  disarmed) and MUST NOT be misrepresented as hot-unregistered in V1.1.
```

`sims4.commands.register` as an extension point is ACCEPTABLE for E1: it is
the vanilla console-command mechanism (S4CL's verified `register(alias,
...)` call shape, `SOURCE_VERIFIED` wrapper use of the vanilla entry), adds
no pie-menu/UI surface, shows no dialog, patches no game method, vetoes
nothing. V1.1 registers exactly four Owner commands and no others; command
bodies are allowlisted (validate → set/clear locals → snapshot reads →
alarm create/cancel → bounded telemetry write path only).

## 3. Carried-forward resolutions (V1.1 §§2–11, unchanged except §§5.1/4)

- Build contract: 3.7 family, magic 3394/CRLF, `.pyc`-only legacy layout,
  no-`__pycache__`, no-`.py`-fallback (V1.1 §3).
- Lifecycle events abandoned; poll-only doctrine with disappearance≠ENDED
  normative (V1.1 §§3–4).
- Narrowed E1-A (appear-transitions + verbatim source + hands-off candidacy;
  no end/outcome claims) — now AUTOMATIC at 1 Hz via §1 (stronger than the
  Owner-paced variant, same honesty bounds).
- Clock reads + `perf_counter` monotonic channel (V1.1 §5.2–5.3); agreement
  formula; pause/speed tri-state validity.
- Motives/buffs OPTIONAL; save notification OMITTED; user-data root
  `__file__`-anchored + Owner-confirmed (V1.1 §10).
- Guards/schema/logging/installer/evidence disciplines per Astra R4–R8 as
  already specified in the HOLD review and queued for the V1.1 repair pass.

## 4. Exit gate (updated)

```text
REAL_TIME_SCHEDULER = RESOLVED (PRIOR_ART + STOP-gated first-load acceptance; §1.3 tests a/b/c)
OWNER_ATTESTED_BINDING = ENFORCEABLE (§2 command contract; volatile-only; restart cleanup truthful)
B2 (exact embedded patch) = OWNER_STATIC_CHECK (unchanged: Game/Bin/python*_x64.dll name + File version)
B3 (3.7 compiler) = TOOLING_AUTHORIZATION_REQUIRED (unchanged; DO NOT INSTALL)
Target-confirmation of PRIOR_ART reads = first-load acceptance inside V1.1 (STOP-gated, not assumed)

LOAD_BEARING_SOURCE_RESOLUTION_COMPLETE = YES (for authoring the V1.1 plan repair;
  pre-build prerequisites B2-check + B3-grant identified as Owner/tooling gates,
  not architecture gaps)
```

## 5. Pre-build prerequisites (exact, finite — not blockers on plan authorship)

1. **Owner static check (≤1 min, no diagnostics beyond it):** report
   `.../The Sims 4/Game/Bin/python*_x64.dll` exact filename + Details-tab
   File version. Pins CPython 3.7.x compiler + magic 3394 expectation.
2. **Tooling authorization:** one pinned CPython 3.7.x release (version +
   hash + source). No install under any planning grant.
3. **V1.1 review + build-grant + runtime-grant sequence** per the standing
   authorization chain (plan authorizes nothing by itself).

If the Owner DLL check contradicts the 3.7 family, this packet's build
contract is void and resolution returns to BLOCKED on the reported string.
If `add_alarm_real_time` is absent at first load, V1.1's scheduler clause
fails closed to INSTRUMENTATION_FAILURE (specified, not improvised).

---

*End of SR packet V1.2. Static resolution only. V1.1 PLAN REPAIR NOT AUTHORED
in this pass. E0 unaffected. No implementation, no runtime, no proof beyond
the bytes and pages actually inspected.*
