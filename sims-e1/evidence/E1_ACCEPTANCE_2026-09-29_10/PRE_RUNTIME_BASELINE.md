# E1 2026-09-29_10 — 1.0.11 delta requalification + E1-B — pre-runtime

| Item | Value |
|---|---|
| HEAD / origin/main | `21911d17c7513e5f000b0b5508cc65d209045e60` |
| tree | `4a542929cf4a451177113014af4ce859d8c83caf` |
| internal probe | 1.0.11 (product Embodiment 1.0.0) |
| artifact | `ashley_e1_1.0.11.ts4script`, 25854 bytes, six pycs, magic `420d0d0a` |
| artifact SHA256 | `9C96CB71C406519980D90D31732EA71AE1F4C309D6146A40C401B0322116D81D` |
| verify.ps1 | `VERIFY_PASS all checks` (126 focused tests, CPython 3.7.0 + host) |

Delta vs 1.0.10 (accepted A–M, `_09`): presence attestation = armed
snapshot; `_COUNTERS` reset on accepted ARM; monotonic counter merge in
`_emit`. No scheduler, command, writer, or read-surface change.

Install: Sims closed; `remove.ps1 -Version 1.0.10` REMOVE_PASS;
`install.ps1 -Version 1.0.11` INSTALL_PASS; exactly one Ashley package,
SHA256 `9C96CB71…6D81D`. Saves: all 12 files hash-identical to the `_09`
baseline (Owner quit `_09` without saving).

Delta requalification required (plan §14 applies per candidate): A, B, C, M
fresh; E/G first poll with corrected attestation; D pause continuity + stop;
I redundant start/stop; J re-arm in same process (counter reset live);
L/K sustained via the E1-B windows; H saves after close.
