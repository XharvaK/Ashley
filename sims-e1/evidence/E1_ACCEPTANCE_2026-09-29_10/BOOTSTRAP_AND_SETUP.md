# _10 — LAB setup (Owner) + bootstrap gate (1.0.11)

## Owner LAB setup (Owner facts, not probe actions)
Before this session the LAB had autonomy ON, Wants/Fears ON (default), aging
default (ON). Owner changed in-game options to: autonomy OFF, Wants/Fears OFF,
auto-aging OFF, Neighborhood Stories OFF (per agreed L0 posture; Owner reported
"done"), then performed ONE Owner UI Save of LAB_E1 at 13:49:16 local, before
any Ashley command. Sim state at setup: sitting on couch watching TV
(pre-existing interaction).

## Bootstrap (launch at 13:45:35, before the Owner setup/save)
`ashley_e1_bootstrap_685eea96-8b2b-4665-ac9f-995969a6f263.jsonl`, SHA256
`985702BB86C3019900CDFA8FC6D723BA024CFB93F081BA853D02BCEC015CC373`:
probe 1.0.11, build 1.128.90.1030, load_disabled, UNARMED/null snapshot,
python 3.7.0, perf_counter true, required imports 19/19 true. PASS (B, C, M).

## Save re-baseline after Owner save (reference for H)
Owner save rotated Slot_00000002 versions. New baseline:
Slot_00000002.save 1109146 BB49B5027675339A5DA70D9FD3D562477E6C1631F8B764F61247B9A2A29C70FA;
.ver0 = previous .save (CACEA170…); .ver1 = prev .ver0; .ver2 = prev .ver1;
.ver3 = prev .ver2 (FE92E44A…); .day.ver0 unchanged; all Slot_ffffffff.* and
steam_autocloud.vdf hash-unchanged.
