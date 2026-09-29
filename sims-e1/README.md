# Ashley Sims 4 E1 command-dispatch diagnostic build

This directory contains the owner-commanded, diagnostic-only Sims 4 E1
command-dispatch build described by
`PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md`.

`DIAGNOSTIC_ONLY = YES`
`OD4_ACCEPTANCE_CANDIDATE = NO`

This internal probe build is version `1.0.4`. Product-facing branding remains
`Embodiment 1.0.0`; `E1` is an internal engineering identifier.

This diagnostic does not observe Sims state and does not arm or sample the
probe. It records only bounded command-binding facts in the dedicated
`ashley_e1_command_dispatch_diag_1.0.4.jsonl` file under the already-derived
`AshleyE1Telemetry` directory. Diagnostic writes are synchronous and separate
from the normal `TelemetryWriter`.

Build and verification use the pinned official CPython 3.7.0 x64 compiler:

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/build.ps1 -Version 1.0.4
powershell -ExecutionPolicy Bypass -File sims-e1/tools/verify.ps1 -Version 1.0.4
```

`install.ps1` and `remove.ps1` are mechanical OD-4 tools. They require an
explicit Owner-confirmed Sims user-data root and a closed game. This task does
not perform installation or runtime witnessing.

Raw telemetry and witness material stay outside Git. The historical
`evidence/STOP_PLAN_HASH_MISMATCH.md` report is retained unchanged.
