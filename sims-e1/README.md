# Ashley Sims 4 Embodiment probe

This directory contains the owner-commanded Sims 4 Embodiment probe.

## Current build: 2.0.0 (E2)

The source is version `2.0.0` (`src/ashley_e1/__init__.py`,
`src/ashley_e1/schema.py`; observation schema 2). It is no longer read-only:
it carries the E2 actuation experiment described by
`docs/Domus/PROJECT_ASHLEY_SIMS4_EMBODIMENT_E2_IMPLEMENTATION_READY_PLAN_V1.md`.
2.0.0 has not yet passed its E2 first-load gate or trials; those run on the
Owner's Windows dev PC.

Owner commands (all Owner-typed; the probe issues nothing on its own):

| Command | Stage | What it does |
|---|---|---|
| `ashley_e1.arm LAB_E1` / `ashley_e1.arm LAB_E1_FORK` | E1 | Arm an observation session |
| `ashley_e1.start` / `ashley_e1.stop` | E1 | Start and stop observation |
| `ashley_e1.disarm` | E1 | Disarm the session |
| `ashley_e2.prepare <object_id>` | E2 | Prepare one sit experiment on an object |
| `ashley_e2.sit <token>` | E2 | Admit and push one prepared sit experiment |
| `ashley_e2.pause` | E2 | Push the probe's pause request |
| `ashley_e2.release` | E2 | Remove the probe's pause request |

Build and verification (pinned official CPython 3.7.0 x64):

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/build.ps1 -Version 2.0.0
powershell -ExecutionPolicy Bypass -File sims-e1/tools/verify.ps1 -Version 2.0.0
```

E1 evidence (acceptance, adjudication and repairs) is under
`sims-e1/evidence/`; it moves to the Domus repository when that repository
exists.

## History: E1 read-only builds (1.0.x)

The E1 read-only probe was described by
`PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md`.
Its last internal build was version `1.0.11`. Product-facing branding remains
`Embodiment 1.0.0`; `E1` is an internal engineering and stage identifier.
Version `1.0.11` is a bounded telemetry-truth correction on 1.0.10, which
passed first-load acceptance A-M
(`evidence/E1_ACCEPTANCE_2026-09-29_09/acceptance.md`). Presence rows now carry
the probe-owned armed snapshot in `attestation` (1.0.10 and earlier wrote the
save GUID into `snapshot_slot` and left `snapshot_guid` null); per-session
counters reset on every accepted ARM; and the game thread never lowers a
writer-owned counter. 1.0.11 itself still requires runtime requalification.

The 1.0.10 repair preserves the closed command, scheduler, callback, and
writer contracts while making the alarm owner weak-referenceable, passing the
approved `objects.ALL_HIDDEN_REASONS` constant, handling transient save-slot
and interaction-view absence without fabrication, and fail-closing before
`session_open` until the complete save GUID/slot/Sim identity triple exists.
It adds writer-owned logical cap accounting with bounded reconciliation and
failure-only stop/cancel observability. Product-facing branding remains
`Embodiment 1.0.0`.
Attended-session filesystem setup, inventory, active-file creation, writes,
flushes, reconciliation, rotation, and close are owned by the writer thread;
ARM remains nonblocking and does not treat the post-construction writer state
as a readiness proof; worker startup state is authoritative.

The V1.2a expression `TimeSpan(interval_in_real_seconds(1))` was falsified by
exact Sims 1.128 bytecode: `interval_in_real_seconds(1)` already returns a
`TimeSpan`, and the nested constructor raises `TypeError: must be real number,
not TimeSpan`. The corrected binding passes `interval_in_real_seconds(1)`
directly as the `time_span` argument. Architecture and bootstrap semantics are
unchanged; the `date_and_time.TimeSpan` required-import key remains closed and
is still recorded in the 19-key summary.

The target Sims 1.128 command transport lowercases ordinary string arguments
before the Python callback. Owner command documentation remains
`ashley_e1.arm LAB_E1` and `ashley_e1.arm LAB_E1_FORK`. The adapter accepts
only the closed native tokens `lab_e1` and `lab_e1_fork` and maps them to the
canonical semantic names. It does not apply generic case normalization or
aliases. Mixed-case and lowercase distinctions that the native transport does
not preserve cannot be recovered by the probe.

The 1.0.11 build used the same tooling with `-Version 1.0.11`.

`install.ps1` and `remove.ps1` are mechanical OD-4 tools. They require an
explicit Owner-confirmed Sims user-data root and a closed game. This repair
pass does not perform installation or runtime witnessing.

Raw telemetry and witness material stay outside Git. Historical diagnostic
evidence remains preserved under `sims-e1/evidence`.
