# E1-A witness — interaction origin visibility (probe 1.0.11)

Question: on APPEAR transitions, does per-entry `context.source` (verbatim
`source_raw`) distinguish Owner pie-menu actions from native autonomy?

Raw: `ashley_e1_88c478dd-a50d-4907-b9a2-18e36b05fa39.jsonl`
SHA256 `0C1F5C39C42F1E8C2F35B18C7E069F33CCF29038CA111D4EBE12FF67B7D6B540`;
615 rows contiguous, 602 presence rows, zero incomplete, all counters 0,
DISARM_CLEAN. One armed session (LAB_E1), two sampling segments.

## Configuration

Both legs: LAB_E1 after Owner setup+save 13:49 (Wants/Fears OFF, aging OFF,
Neighborhood Stories OFF), same lot, same Sim, same probe/build.
Leg 1: autonomy OFF. Leg 2: autonomy ON — the only deliberate change.

Declared deviations: (1) no reload between legs (plan §15.1); (2) Owner
T-times recorded at minute resolution after the fact, not ±2 s before
clicking — correlation is by minute + exact order; (3) Owner reports a possible
single keyboard press ~2 min into Leg 2 with no mouse input; no PIE_MENU
entry appears anywhere in Leg 2. The two `SUPER_SPEED3` intervals
(14:12:38–42, 14:19:16–29) coincide exactly with the Sim falling asleep
(sofa nap, bed sleep): the game's native sleep fast-forward, not an Owner action.

## Leg 1 — Owner input (14:12:10–14:18:05, autonomy OFF)

| Owner note | Root APPEAR (capture) | source_raw | affordance |
|---|---|---|---|
| 14:12 sit on sofa | 14:12:23 | PIE_MENU | seating_Sit |
| 14:12 nap on sofa | 14:12:35 | PIE_MENU | sofa_Nap |
| 14:13 shower | 14:13:09 | PIE_MENU | shower_TakeShower |
| 14:13 cook eggs & toast | 14:13:37 (+14:13:50 re-issue) | PIE_MENU | fridge_CreateTray |
| (fire; not in notes) | 14:14:55 | PIE_MENU | terrain-gohere |
| 14:15 sit on couch | 14:15:25 | PIE_MENU | seating_Sit |

Continuations of an Owner chain also carry PIE_MENU
(`stove_Ico_Transition`, `stove_MakeFood_FryingPan_Staging_Basic`).
Sub-behaviours inside Owner-chosen activities carry AUTONOMY
(`sit_Passive`, `Shower_TakeShower_Passive`, stir/flip/spice cooking mixers).
Engine-derived entries: POSTURE_GRAPH (posture transitions), BODY_CANCEL_AOP,
SCRIPT (`fire_Panic`, `fire_OnFire` — scripted fire reaction).
Control 14:15:50–14:18:05 (no input): only AUTONOMY idles
(`sit_Passive`, `sim_SocialDistress`); zero PIE_MENU.

## Leg 2 — native autonomy (14:18:49–14:23:08, autonomy ON, hands-off)

Autonomy-chosen top-level activities, all `InteractionSource.AUTONOMY`:
sink_Clean 14:18:53, bed_sleep 14:19:07, toilet-use-sitting 14:19:36,
sink_washHands 14:19:59, fridge_CookAutonomously 14:20:05,
sink_Clean_Slotted 14:20:34, fridge_GrabSnackAutonomously 14:20:46,
mirror_SelfPepTalk 14:21:11, shower_TakeShower 14:21:34,
tv_PickChannelAutonomously 14:22:58 (≥10 valid native APPEARs).
Zero PIE_MENU entries in Leg 2. (First two entries at 14:18:49 follow a
sampling gap and are not used.)

## Verdict

`E1-A: ANSWERED_POSITIVE` (bounded to 1.128.90.1030, this LAB, base game,
these opportunity classes).

Observed rule:
- Owner pie-menu actions appear with `InteractionSource.PIE_MENU`, on the
  root interaction and on continuations of that chain.
- Native-autonomy top-level choices appear with `InteractionSource.AUTONOMY`.
- `AUTONOMY` is NOT exclusive to "the game chose this activity": it also
  labels idle mixers (present even with autonomy OFF) and passive/mixer
  sub-behaviours inside Owner-chosen activities.
- Engine-derived entries carry POSTURE_GRAPH, BODY_CANCEL_AOP,
  CARRY_CANCEL_AOP, SCRIPT.

Design consequence (for later attribution, not implemented here): PIE_MENU on
a root entry is a usable positive signal for `OWNER_DIRECT + OWNER_UI`;
AUTONOMY alone is not sufficient for `NATIVE_AUTONOMY` of a top-level
activity — it must be read together with chain/root context. Silence never
implies NATIVE_AUTONOMY.
