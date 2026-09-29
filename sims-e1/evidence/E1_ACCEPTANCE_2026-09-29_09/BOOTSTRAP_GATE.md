# E1 Acceptance 2026-09-29_09 — Bootstrap gate (1.0.10)

Owner: Sims launched, main menu build `1.128.90.1030` confirmed (A), LAB_E1
loaded, stable live play; no Ashley command entered before inspection.
Process `TS4_x64.exe` pid 8092.

## Bootstrap row

- file: `ashley_e1_bootstrap_cf46da36-2b4d-4ac5-b938-35bf0fc70fee.jsonl`
- bytes 1020, SHA256 `847D4B6F1C571F6F66866205B2B33D7E75E8A170AC549F1AC87D5FF129FF35C6`
- wall `1790677112326` (2026-09-29 13:18:32 local)
- `probe_version` 1.0.10, `sims_build` 1.128.90.1030, `event_kind` load_disabled
- python 3.7.0, `perf_counter` true (B)
- required imports 19/19 true, no missing/extra keys (C)
- attestation `UNARMED`, snapshot fields null; no save/body/world/interaction content (M)

## Stable-load saves check

All 11 save files: identical bytes and SHA256 to the pre-runtime baseline.
`steam_autocloud.vdf`: identical hash; LastWriteTime moved to 10:18:13Z
(Steam client touch at launch, content unchanged).
