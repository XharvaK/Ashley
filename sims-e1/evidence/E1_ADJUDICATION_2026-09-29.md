# Sims 4 Embodiment — E1 adjudication (2026-09-29)

Scope: master V7.3.2a §17-E1 MUST questions (a) E1-A, (b) E1-B, (g) E1-G,
via plan V1.2a. Evidence: `E1_ACCEPTANCE_2026-09-29_09/` (1.0.10 first-load
A–M) and `E1_ACCEPTANCE_2026-09-29_10/` (1.0.11 delta requalification +
witnesses). Source: `21911d1` (probe 1.0.11, artifact `9C96CB71…6D81D`).
Sims PC 1.128.90.1030, base game, LAB_E1 / LAB_E1_FORK.

## Instrument

| Item | Verdict | Evidence |
|---|---|---|
| First-load acceptance A–M, probe 1.0.10 | PASS | `_09/acceptance.md` |
| Delta requalification, probe 1.0.11 | PASS | `_10` sessions 566d8314 (bootstrap, first poll, pause, redundant start, stop×2, close), 0d1b76ef (live re-arm counter reset) |
| Writer steady state | KEEPS_UP; 60 s checkpoint lag 1.02–1.08 s across all sessions (~45 min sampling total) | all sessions |
| STOP | PASS in every session (≥9 stops), no failure guards | all sessions |
| Loss | zero drops, zero incomplete rows, every close DISARM_CLEAN | all sessions |
| Persisted-save inertness | probe caused no save change; all save deltas = Owner Save 13:49:16 and Owner Save-As 14:27:30 | saves inventory checks |

## MUST answers

| ID | Verdict | Bounded answer |
|---|---|---|
| E1-A origin visibility | **ANSWERED_POSITIVE** | Owner pie-menu actions carry `InteractionSource.PIE_MENU` (root + chain continuations); autonomy-chosen activities carry `InteractionSource.AUTONOMY`. AUTONOMY also labels idle mixers (even with autonomy OFF) and sub-behaviours of Owner activities, so it is not by itself proof of a native top-level choice. Engine sources: POSTURE_GRAPH, BODY_CANCEL_AOP, CARRY_CANCEL_AOP, SCRIPT. `witness_A.md` |
| E1-B time ratio | **ANSWERED_POSITIVE** | Normal speed: 40.0 game-min per real min (1500 ticks/game-min, 1000 ticks/real-s), six runs within 0.6%. Also observed: the game auto-enters `SUPER_SPEED3` while the Sim sleeps. `witness_B.md` |
| E1-G save identity | **ANSWERED_POSITIVE** | Save and reload preserve guid/slot/sim. Save-As changes `slot_id` but **keeps `save_slot_guid`**, persistently. `sim_id` stable across the fork. `witness_G.md` |

Declared deviations are listed in each witness file (shortened E1-B windows
pooled across sessions; no reload between E1-A legs; minute-resolution Owner
T-times; E1-G origin reload taken last). None changes a verdict; each is a
method shortcut on questions whose answers proved exact/deterministic.

## Findings that change later design

1. **Master §8 assumption falsified in part.** §8 says "a new guid or a
   divergent marker detects fork/foreign saves." Save-As does not produce a
   new guid. Fork detection must come from the in-save marker vs Host mirror
   (plus slot_id), never from guid change. `{save_slot_guid, sim_id}` binds
   origin and fork to the same key — E2 lineage must disambiguate.
2. **Owner-action detection is available** (PIE_MENU), which the master left
   unverified. Native-autonomy attribution needs root/chain context.
3. **Rhythm numbers (§9):** at 40:1 the 4 Thought-calls/hour ceiling equals
   one decision per ~10 game-hours. Quantitative input for E3-B1/E3-B2;
   no decision made here.
4. The game's own sleep fast-forward changes world speed without Owner input
   — relevant to E2-P (pause/speed qualification) and co-play clock ownership.

## Stage state

```text
E1_STAGE = ACCEPTED_BY_EVIDENCE (pending Owner acknowledgment)
E1_MUST_A = ANSWERED_POSITIVE
E1_MUST_B = ANSWERED_POSITIVE
E1_MUST_G = ANSWERED_POSITIVE
E1_MAY (C, D, WF-01, L1-O) = NOT RUN (L1-O partially observed: with autonomy
  OFF, need-distress idles appear as AUTONOMY; no critical-need override observed)
E2 = NOT STARTED; requires a separate implementation-ready E2 plan (master §21 step 4)
```
