# Ashley Sims 4 E1 probe

This directory contains the owner-commanded, read-only Sims 4 E1 telemetry
probe described by `PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md`.

The probe observes the single admitted selectable Sim, save identity, clock,
zone fields where exposed, and bounded queue/running presence. It does not
change gameplay, save data, autonomy, selection, UI, tuning, network state, or
the filesystem outside the derived `AshleyE1Telemetry` directory. A game
thread callback copies plain data into a bounded queue. One background writer
owns JSONL file I/O.

Build and verification use the pinned official CPython 3.7.0 x64 compiler:

```powershell
powershell -ExecutionPolicy Bypass -File sims-e1/tools/build.ps1 -Version 1.0.1
powershell -ExecutionPolicy Bypass -File sims-e1/tools/verify.ps1 -Version 1.0.1
```

`install.ps1` and `remove.ps1` are mechanical OD-4 tools. They require an
explicit Owner-confirmed Sims user-data root and a closed game. This task does
not perform installation or runtime witnessing.

Raw telemetry and witness material stay outside Git. The historical
`evidence/STOP_PLAN_HASH_MISMATCH.md` report is retained unchanged.
