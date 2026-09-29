# E1 First-Load Acceptance 2026-09-29_09 — internal probe 1.0.10

Candidate: HEAD `33b26b2…` / tree `72720ed…`; artifact SHA256
`53436440AC4D48536B58039A1843664FCFDB068AEDDA0FDAE5EC6BE76EF9B60B`.
Sims PC 1.128.90.1030, LAB_E1. Owner performed all in-game actions; no
synthetic input. Times are local (UTC+3) from capture timestamps; Owner-reported
clock times ran ~15–20 s ahead of capture time.

Raw evidence (copied here, originals retained in `AshleyE1Telemetry\`):
- `ashley_e1_bootstrap_cf46da36-….jsonl` SHA256 `847D4B6F…35C6`
- `ashley_e1_ded73238-2483-449c-80ac-8496db32f8c8.jsonl` SHA256
  `09A88F97C4C353F5849E3D9B792FAB199A44E22EFFF42CE4B3DF7CDE7653F852`,
  606 rows, sequence 0..605 contiguous, no bad/torn line.
  Kinds: session_open 1, presence_snapshot 593, session_checkpoint 11
  (10 PERIODIC_60S + PRE_DISARM), session_close 1.

## Command transcript (Owner)

| Owner time | Command | Observed |
|---|---|---|
| ~13:22 | `ashley_e1.start` (UNARMED) | rejected: no session file created |
| ~13:22 | `ashley_e1.arm BADNAME` | rejected: no session file created |
| ~13:22 | `ashley_e1.arm LAB_E1` | session file created 13:22:30, 0 rows |
| ~13:22 | `ashley_e1.start` | session_open + first presence 13:22:37.407, complete triple |
| ~13:24 | `ashley_e1.start` (SAMPLING) | redundant_starts 0→1 at 13:24:13; single 1 Hz stream |
| ~13:24 | `ashley_e1.arm LAB_E1` (SAMPLING) | rejected: no new file, sampling uninterrupted |
| 13:24:30–45 | Owner pause/unpause | 17 PAUSED rows 13:24:29–13:24:46, callbacks continuous, ticks frozen |
| ~13:25:45 | `ashley_e1.stop` | last capture 13:25:43.636; none after |
| ~13:26:20 | `ashley_e1.stop` (ARMED) | no rows, no effect |
| ~13:27:30 | `ashley_e1.start` (restart) | first capture 13:27:11.755 |
| ~13:34 | `ashley_e1.stop` | last capture 13:34:09.413; none after; no further checkpoint |
| ~13:35 | `ashley_e1.disarm` | PRE_DISARM 13:35:11.508, session_close 13:35:12.461 |

## A–M

| Check | Result | Evidence |
|---|---|---|
| A build | PASS | Owner main-menu 1.128.90.1030; rows `sims_build` 1.128.90.1030 |
| B runtime self-report | PASS | python 3.7.0, perf_counter true |
| C imports | PASS | 19/19 true |
| D scheduler | PASS | first 60 s: 59 callbacks; pause continuity; zero callbacks after both stops; dropped_overrun 0; saves unchanged |
| E getters / R2 | PASS | guid/slot/sim, queue, clock/speed/paused present; is_selectable `true` (bool); one eligible Sim; no guard rows |
| F monotonic | PASS | 0 non-increasing presence intervals |
| G identity reads | PASS | single triple `(2773024768, 2, 118245043779534861)` on every row |
| H save inertness (persisted) | PASS | all 12 save files byte/hash-identical before launch, at stable load, and after disarm |
| I command family | PASS | all nine canonical behaviours above |
| J transitions | PASS | UNARMED→ARMED→SAMPLING→ARMED(→SAMPLING→ARMED)→UNARMED; predecessor branch unit-covered |
| K writer/logging | PASS | rotation/cap/torn-tail/non-recursion unit-covered (verify.ps1); live: contiguous, flush cadence, clean close |
| L drop discipline | PASS | dropped_queue/overrun/serialize = 0 throughout and at close |
| M bootstrap/root | PASS | load_disabled UNARMED within stable load; session_open only after arm+start+first poll |

Median presence interval ~1.02 s; rate ~0.98/s (real-time basis).

## Writer throughput

PERIODIC_60S checkpoint lag (write time − last preceding capture):
1.05, 1.05, 1.08 s (segment 1, ~3 min) and 1.03, 1.06, 1.06, 1.06, 1.02, 1.06 s
(segment 2, 13:27:11.8→13:34:09.4, ~418 s continuous hands-off sampling).
(The seq-187 88 s value is the Owner stop→restart gap, not backlog.)
No growth over ~10 min total sampling. Close: PRE_DISARM ~62 s after last
capture (disarm time), session_close +0.95 s, no shutdown-deadline discard.

```text
WRITER_STEADY_STATE              = KEEPS_UP
WRITER_THROUGHPUT_RUNTIME_PROVEN = YES (bounded: ~7 min continuous + ~3 min, 1 Hz, this host/build)
STOP_RUNTIME                     = PASS (2/2, plus redundant stop)
STOP_FAILURE_GUARDS_OBSERVED     = NONE
```

Final close: counters all 0 (redundant_starts 1), writer.state OK,
close_reason DISARM_CLEAN, reason null. No SHUTDOWN_DEADLINE,
QUEUE_SATURATION, SERIALIZE_FAILURE, writer_failed, cap_reached.

## Defects found (not load-bearing for A–M; declared)

1. `observers.py:120` passes the save GUID into `attestation.snapshot_slot`
   and leaves `snapshot_guid` null on every presence row (also in 1.0.8).
   `save{}` and `session_open.attestation` are correct. Contract §11.1
   violated for per-row attestation.
2. `probe._emit` overwrites `_WRITER.counters` with probe-side values each
   emit, which can erase a writer-thread `dropped_serialize` increment
   (unobserved here; loss would still mark the next row incomplete).

## Verdict

```text
SIMS4_E1_FIRST_LOAD_ACCEPTANCE: PASS (A–M) — INTERNAL_PROBE 1.0.10
E1_TARGET_BINDING_CLOSURE_RUNTIME_CONFIRMED: YES
E1_WRITER_CONTRACT_RUNTIME_CONFIRMED: YES
WRITER_THROUGHPUT_RUNTIME_PROVEN: YES (bounded as above)
READY_FOR_E1_WITNESSES: NOT ON 1.0.10 — per-row attestation defect (1) must be
  repaired first; 1.0.11 + bounded delta requalification, then witnesses.
```

Deviation declared: the first sampling segment was ~3 min (Owner stopped
early); the sustained requirement was met by the second segment (~7 min).
