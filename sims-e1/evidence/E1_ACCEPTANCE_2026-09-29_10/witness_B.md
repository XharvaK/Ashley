# E1-B witness — game time / wall time (probe 1.0.10 + 1.0.11)

Question: ratio of game time to real time at normal (1x) speed.

Method (declared deviation from plan §17): instead of two dedicated 15-min
windows, every contiguous unpaused NORMAL-speed presence run (sample gap <2 s)
across three independent sessions was measured from the monotonic channel and
the calendar field. Owner stopped the dedicated window after ~6.3 min on
engineering judgement that more samples of an exactly-constant ratio add no
information. Owner clock notes (window start 14:03:30ish ↔ game 8:41pm) agree
with probe capture (14:03:49 ↔ 20:41:52) within the known ~15–20 s Owner-clock offset.

| Session (probe) | Run start | Δwall (monotonic) | Δgame (calendar) | r = game-min / real-min |
|---|---|---|---|---|
| ded73238 (1.0.10) | 13:22:37 | 1.86 min | 74.26 min | 39.93 |
| ded73238 (1.0.10) | 13:24:47 | 0.94 min | 37.57 min | 40.15 |
| ded73238 (1.0.10) | 13:27:11 | 6.96 min | 278.49 min | 40.01 |
| 566d8314 (1.0.11) | 13:50:51 | 1.12 min | 44.98 min | 40.00 |
| 566d8314 (1.0.11) | 13:52:17 | 3.77 min | 150.62 min | 40.00 |
| 0d1b76ef (1.0.11) | 14:03:48 | 4.79 min | 191.68 min | 40.00 |

Ticks: exactly 1500 ticks per game-minute in every run. Max sample gap 1.14 s.
Every row `clock_speed=NORMAL`, `paused=false`; zero drops; zero incomplete rows.
Short runs deviate by ≤0.4% (1 s sampling quantization over <2 min).

Raw: `_09/ashley_e1_ded73238-….jsonl` (SHA256 09A88F97…F852),
`_10/ashley_e1_566d8314-….jsonl` (SHA256 9BC1C2F3…F4D7),
`_10/ashley_e1_0d1b76ef-….jsonl` (SHA256 690E4D9D…B459).

## Verdict

`E1-B: ANSWERED_POSITIVE` (bounded) — at normal speed on this LAB lot/PC/build,
game time advances at **40.0 game-minutes per real minute** (1 game-minute per
1.5 real seconds; 1500 ticks/game-minute ⇒ 1000 ticks per real second), with
runs agreeing within 0.6% (plan bar 10%).

Not covered: speeds 2x/3x, heavily loaded lots (sim-time slowdown under load),
LAB dilation values. These remain passive measurements from any later telemetry.
