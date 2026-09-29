# Ashley Sims 4 Embodiment probe

This directory contains the owner-commanded, read-only Sims 4 Embodiment
probe described by
`PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md`.

This internal probe build is version `1.0.5`. Product-facing branding remains
`Embodiment 1.0.0`; `E1` is an internal engineering and stage identifier.
Version `1.0.5` is the next OD-4 acceptance candidate after the bounded native
arm-name adapter repair.

The target Sims 1.128 command transport lowercases ordinary string arguments
before the Python callback. Owner command documentation remains
`ashley_e1.arm LAB_E1` and `ashley_e1.arm LAB_E1_FORK`. The adapter accepts
only the closed native tokens `lab_e1` and `lab_e1_fork` and maps them to the
canonical semantic names. It does not apply generic case normalization or
aliases. Mixed-case and lowercase distinctions that the native transport does
not preserve cannot be recovered by the probe.

Build and verification use the pinned official CPython 3.7.0 x64 compiler:

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/build.ps1 -Version 1.0.5
powershell -ExecutionPolicy Bypass -File sims-e1/tools/verify.ps1 -Version 1.0.5
```

`install.ps1` and `remove.ps1` are mechanical OD-4 tools. They require an
explicit Owner-confirmed Sims user-data root and a closed game. This repair
pass does not perform installation or runtime witnessing.

Raw telemetry and witness material stay outside Git. Historical diagnostic
evidence remains preserved under `sims-e1/evidence`.
