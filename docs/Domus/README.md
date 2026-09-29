# Domus — Sims 4 embodiment documents

Domus is the programme that gives Ashley a body in The Sims 4 (stages E0–E7).
Frozen constraints: one world, one Ashley; E1 is observe-only; the action path
is engine script only, never keyboard or mouse emulation.

## Governing documents

| Document | Role |
|---|---|
| [`PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md`](PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md) | Master design: laws, programme E0–E7, open-item ledger |
| [`PROJECT_ASHLEY_SIMS4_EMBODIMENT_E2_IMPLEMENTATION_READY_PLAN_V1.md`](PROJECT_ASHLEY_SIMS4_EMBODIMENT_E2_IMPLEMENTATION_READY_PLAN_V1.md) | Current stage plan: E2 actuation experiment |
| [`PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md`](PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md) | E0/E1 plan; E1 is complete, and E0 is the Owner's to redo |

Supporting: [`PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1_2.md`](PROJECT_ASHLEY_SIMS4_E1_PRE_IMPLEMENTATION_SOURCE_RESOLUTION_V1_2.md)
(source evidence for E1).

The probe lives in [`sims-e1/`](../../sims-e1/README.md) (version 2.0.0).

## Superseded drafts

Kept for provenance only; each is replaced by the governing document of the
same family above. They move to the Domus repository when it exists.

- Master design V7, V7.1, V7.2, V7.3, V7.3.1, V7.3.2
- E0/E1 plan V1, V1.1, V1.2
- E1 source resolution V1, V1.1

## Owner decisions recorded 2026-09-29

- Sims cognition uses a **separate embodiment budget** with its own fuse,
  active only while a session is armed (master §9, §20 E3-B1; Growth V1 §5.6,
  §5.7).
- Reasoning effort for in-world decisions is chosen from the CA-03 benchmark,
  not in advance.
- Domus runtime work (E2 gate and trials) runs on the Owner's Windows dev PC.
