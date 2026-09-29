# E1 Acceptance 2026-09-29_09 — Pre-runtime baseline (1.0.10)

## Candidate

| Item | Value |
|---|---|
| HEAD | `33b26b22414192759863f6f50e04d4e2eeb218a5` |
| tree | `72720edf2325a96e4933aaff5d134dc5abd80e88` |
| origin/main | `33b26b22414192759863f6f50e04d4e2eeb218a5` |
| internal probe | `1.0.10` (product: Embodiment 1.0.0) |
| artifact | `sims-e1/build/ashley_e1_1.0.10.ts4script`, 25792 bytes |
| artifact SHA256 | `53436440AC4D48536B58039A1843664FCFDB068AEDDA0FDAE5EC6BE76EF9B60B` |
| master V7.3.2a SHA256 | `A06C2454…E4178F3` (verified) |
| plan V1.2a SHA256 | `CBF47BF6…130F683` (verified) |
| verify.ps1 (this session) | `VERIFY_PASS all checks` (CPython 3.7.0 + host focused tests, AST guards, artifact layout/magic/hashes/manifest/source digest) |

## Install gate

- Sims process before gate: absent.
- Previously installed: `ashley_e1_1.0.8.ts4script` SHA256 `E0E1CB04…73709240` (matches last run; 1.0.9 was never installed).
- `remove.ps1 -Version 1.0.8`: `REMOVE_PASS exact artifact absent; saves untouched`.
- `install.ps1 -Version 1.0.10`: `INSTALL_PASS`.
- Ashley packages under Mods: exactly one, `Mods\AshleyE1\ashley_e1_1.0.10.ts4script`, SHA256 `53436440…F9B60B`.
- Historical telemetry in `AshleyE1Telemetry\` untouched (17 files).

## Saves baseline (before launch)

12 files; every per-file SHA256 identical to the `_07`/`_08` baseline
(`Slot_00000002.*`, `Slot_ffffffff.*`, `steam_autocloud.vdf`).
Inventory digest (name|bytes|sha, sorted): `956CEC74118DB2B67D90A61AB8EFBEA93EBEB224A4516CC2BD45DF6E3FD59170`.

## Retest method notes

See `../E1_STOP_READJUDICATION_2026-09-29/report.md`: STOP is judged from
capture timestamps vs the recorded stop wall time and from checkpoint gating,
never from file growth. Writer steady state is judged from PERIODIC_60S
checkpoint lag (write time minus preceding presence capture time) over the
sustained window.
