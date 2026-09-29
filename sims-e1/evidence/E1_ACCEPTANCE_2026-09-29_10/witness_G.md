# E1-G witness — save / body identity across Save, Save-As, reload

Probe performs no save. Owner performed all UI saves/loads. Each point is a
separate attended session (new UUID), `stop`+`disarm` before every load,
re-arm only after Owner-confirmed live play, ≥30 s quiet, ≥40 consecutive
COMPLETE observations, zero loss, DISARM_CLEAN.

| Point | Owner transition before it | Session (probe) | Rows | guid | slot | sim_id |
|---|---|---|---|---|---|---|
| G0 origin | load LAB_E1 (process start) | `ded73238` (1.0.10, `_09`) | 593 presence | 2773024768 | 2 | 118245043779534861 |
| G1 after Owner Save | Owner UI Save 13:49:16 (no reload) | `566d8314`, `0d1b76ef`, `88c478dd` (1.0.11) | 306/372/602 | 2773024768 | 2 | 118245043779534861 |
| G3 after Save-As | Owner Save-As → new slot `LAB_E1_FORK` (Slot_00000003.save written 14:27:30) | `42b2b614` | 47 | **2773024768** | **3** | 118245043779534861 |
| G4 fork reload | Owner loads LAB_E1_FORK | `84ca2d16` | 62 | 2773024768 | 3 | 118245043779534861 |
| G2/G5 origin reload | Owner loads LAB_E1 (the 13:49 save) | `e446e1ee` | 43 | 2773024768 | 2 | 118245043779534861 |

Every row in every session: one identity triple, `observation_complete=true`,
counters 0, attestation == armed snapshot.

Raw SHA256: `42b2b614` 1CEDC5EA…6303, `84ca2d16` A63043BE…42E6,
`e446e1ee` AB7F39C8…8123 (others in witness_A/B and `_09`).

Declared deviations: G1 was not followed by an intermediate origin reload
before Save-As; the origin reload (G2) was taken at the end (G5), after the
fork steps. The loaded origin file is the 13:49 Owner save, so G5 still
witnesses Save→reload. Slot-list screenshot not captured. Autonomy was ON
for G1's last session (E1-A leg 2) and OFF from G3 onward (irrelevant to
identity reads).

## Verdict

`E1-G: ANSWERED_POSITIVE` (bounded to this sequence/build):

- **Save** preserves guid, slot, sim_id.
- **Save-As** to a new slot changes `slot_id` (2 → 3) but **does NOT change
  `save_slot_guid`**; the fork file carries the origin's guid across reload.
- **Reload** (fork and origin) returns the persisted values unchanged.
- **sim_id** stable across G0–G5, including across the fork.

Consequences for E2 binding/lineage (design input, not implemented):
- `save_slot_guid` alone cannot distinguish an origin from its Save-As fork;
  `(save_slot_guid, slot_id)` distinguishes them only while slots differ.
- `PERSISTED_HOST_BODY_BINDING = {save_slot_guid, sim_id}` (master §7) is
  therefore ambiguous between origin and fork: both resolve to the same body
  key. World-lineage detection (E2-L) cannot rely on these identifiers and
  needs its own marker — exactly the master's §8 requirement.
