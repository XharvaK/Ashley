# E1 1.0.8 STOP evidence — re-adjudication addendum

Date: 2026-09-29 (Europe/Istanbul). Read-only analysis. No source, artifact,
install, or Sims action. Historical `_08/BLOCKED_STOP_COMMAND.md` and
`E1_RUNTIME_BOUNDARY_CLOSURE_2026-09-29/report.md` are preserved unchanged;
this note adds evidence they did not use.

## Question

Did the two 1.0.8 `ashley_e1.stop` submissions actually have no effect, or was
the "rows kept appending" observation produced by writer backlog?

## Evidence

Raw session `_08/ashley_e1_0cfeefbe-...jsonl`
(SHA256 `C8282A64B3E969C85D95AE89B81703C8F894B9BEC418D46806EC855B5E5139D0`),
t0 = first presence capture wall `1790671187842` = `2026-09-29T08:39:47.842Z`.

| Fact | Value |
|---|---|
| last physical presence row: capture time | t0 + 414.4 s |
| last physical checkpoint (seq 294, PERIODIC_60S): write time | t0 + 517.2 s (lag 226.5 s) |
| rows physically written after seq 294 | 121 (seq 295..415), zero checkpoints among them |
| original file LastWriteTimeUtc (telemetry root) | `2026-09-29T08:52:44.020Z` = t0 + 776.2 s |

Writer source at 1.0.8/1.0.10: a `PERIODIC_60S` checkpoint is written by
`_write_row` whenever `self._sampling` is true and ≥60 s have passed since
the last checkpoint. `_sampling` is set false only by `_set_writer_sampling
(False)`, which runs only after `_cmd_stop` passed the `cancel_alarm` call
(or disarm, which was not entered).

The writer kept physically writing for ~259 s after seq 294 (flush cadence
≤5 s, so the last write is within ~5 s of the file mtime) and emitted no
checkpoint. Had `_sampling` still been true, a checkpoint was due at the first
row processed after t0 + 577.2 s.

## Classification

```text
WRITER_SAMPLING_FLAG_FALSE_BEFORE_QUIT        = YES (by t0+~578 s)
STOP_TRANSITION_EXECUTED_1_0_8                = PROBABLE (only in-source path
                                                to _sampling=False without disarm
                                                is the post-cancel stop path)
OBSERVATION_BASIS_OF_BLOCKED_STOP             = FILE GROWTH DURING ~230 s WRITER BACKLOG
STOP_COMMAND_NO_EFFECT (as recorded in _08)   = NOT SUPPORTED BY PHYSICAL EVIDENCE
STOP_ROOT_CAUSE (revised)                     = LIKELY OBSERVATION ARTIFACT OF WRITER
                                                BACKLOG; UNCONFIRMED UNTIL 1.0.10 RETEST
```

Rows captured between t0+414.4 s and the stop were still queued when Sims was
quit and were lost with the process; the exact stop time is not recoverable
(no Owner timestamps were recorded).

## Consequences for the 1.0.10 retest

- File growth after `stop` is not evidence that callbacks continue. STOP is
  judged from **capture** timestamps (`wall_timestamp_ms`/`monotonic_ns` of
  presence rows) against a recorded stop wall time, after the writer drains,
  plus the absence of further `PERIODIC_60S` checkpoints while ARMED.
- Record the Owner's stop submission wall time explicitly.

## Writer throughput note (hypothesis, not proof)

1.0.7 (flush every row) and 1.0.8 (buffered) both fell behind (checkpoint lag
grew to 113 s / 226 s) while isolated host timing of every writer operation
was sub-millisecond. Both versions performed two full directory scans
(~2N+2 filesystem syscalls) per row. One consistent explanation is that the
writer thread only reacquires the GIL when the Sims main thread executes
Python, so each GIL-releasing syscall costs a main-thread wait; host timing
cannot reproduce that. 1.0.10 removes per-row scans (reconciliation every
≤5 s only). This hypothesis is untested; the 1.0.10 run measures it via
checkpoint lag.
