# Project Ashley Stabilization Master Mechanical Implementation Plan

Status: execution index for the 2026-09-06 overnight stabilization programme.

This file is not a new architecture design. The current semantic authority is
[`ASHLEY_SPARSE_THOUGHT_CONTRACT_VNEXT_DESIGN.md`](ASHLEY_SPARSE_THOUGHT_CONTRACT_VNEXT_DESIGN.md).
Current committed source outranks that design when the source has legitimately
moved. Older freeze, acceptance, and milestone documents are historical
evidence only unless the current design explicitly incorporates a detail.

## Execution authority

- Source edits and test edits are permitted only in the dedicated isolated
  worktree.
- Local commits and a normal push of the dedicated stabilization branch are
  authorized. Force-push, shared-history rewrite, and main/master mutation are
  prohibited.
- Live NVIDIA calls are authorized only after local provider-failure capture is
  verified.
- Production deployment, service restart, bounded sidecar metadata transition,
  and bounded rollback are authorized only after the exact-candidate gates.
- No provider number changes, fallback redesign, new cognitive architecture,
  generic event system, broad runtime refactor, or unrelated cleanup is in
  scope.

## Authority and evidence anchors

| Anchor | Value |
|---|---|
| Execution base | `7bae7eaafedc2e7e859218d340920ea3958b1515` |
| Execution base tree | `5a1fd8c04ced30f1fd0764ea7b7b667285ce4170` |
| Dedicated branch | `codex/stabilization-sparse-vnext-overnight-20260906` |
| Frozen design SHA-256 | `1A66E1C55AF90380EAE0196FEC99DF29A4FEB7C19A59C7A7398E38BC5CE02D57` |
| Current identity owners | `thought/types.ts` plus `model-fabric/dispatch-contract.ts` for contract/schema IDs, as established by current source |

## Programme order

| Stage | Mechanical scope | Completion gate | Current disposition |
|---|---|---|---|
| S0 safe implementation base | Preserve original dirty checkout; isolated worktree; exact design artifact; locked dependencies; focused baseline | `SAFE_IMPLEMENTATION_BASE` | In progress; source drift is none; focused cognitive baseline is 68 passing; committed Sandbox Broker build defect is pre-existing and unrelated |
| S1 Sparse VNext implementation | Optional settlement domains; omission/presence law; reference-shape reconciliation; dead authoring removal; canonical/wire separation; parser, validator, authority, materialization, publication, expression, feedback coherence | `SPARSE_VNEXT_CORE_IMPLEMENTED` | Pending |
| S2 Core D0 | Execute the 20 local witnesses through schema → wire → fixture → parser → validator → authority → materialization → persistence | `CORE_D0_20_OF_20` | Pending; no provider calls |
| S3 minimal provider failure capture | Add bounded failure-oriented metadata at the smallest existing provider boundary; no full prompt or hidden-reasoning retention | `PROVIDER_FAILURE_CAPTURE` | Pending; mandatory before NVIDIA |
| S4 controlled NVIDIA current-vs-sparse diagnostic | Use the frozen scenario set and exact accepted controls; record bounded per-call evidence and allowed conclusions only | `NVIDIA_DIAGNOSTIC` | Pending; live calls authorized only after S3 |
| S5 blocking P1 stabilization repairs | Evidence reliance carry-through; future-trigger Thought-seen-state binding; pending speech-outbox recovery; broad prose/fidelity guard repair | `BLOCKING_P1_REPAIRS` | Pending; broad fidelity guard closure is required before the stability window |
| S6 release/version mechanics | V2 settlement and contract identities; r5/r6 sidecar transition/rollback mechanics; compatibility and fencing | `BEFORE_PRODUCTION_DEPLOYMENT` | Pending; production mutation remains gated |
| S7 exact immutable candidate qualification | Exact SHA/tree/parent; all relevant local and physical witnesses; forward transition and rollback rehearsal | `RELEASE_QUALIFIED` | Pending; never call a dirty worktree a candidate |
| S8 production deployment | Deploy the exact candidate to `/home/xarvak/project-ashley` after pre-deployment gates | `DEPLOYED` | Pending; no opportunistic production edits |
| S9 production acceptance | Verify deployed identity, readiness, continuity, Sparse operation, operational truth, recovery, and provider behavior | `PRODUCTION_ACCEPTED` | Pending |
| S10 protected stability window | Freeze engineering and use Ashley normally | `STABILITY_WINDOW` | Not started; must remain incomplete in this run's final report |
| S11 companion evaluation | Evaluate lived companion evidence under the applicable qualification contract | Separate owner gate | Deferred until the stability window is complete |
| S12 stabilization closure / next-programme decision | Record evidence and decide whether another programme is warranted | Owner decision | Deferred |

## Frozen design implementation surfaces

The primary source surfaces are the files named by the current design's §37
map. Contract and schema IDs are updated at their actual current owner in
`apps/agent-service/src/core/model-fabric/dispatch-contract.ts`; the current
source owner takes precedence over the map's `types.ts` shorthand. Evidence
reliance carry-through remains the later S5 witness, not an S1/D0 shortcut.

The exact 20 D0 witnesses and later SW-1 through SW-6 witnesses are defined by
the current design §32. This index references them and does not duplicate their
semantic definitions.

## Stop conditions

Stop and preserve evidence at a source contradiction that makes the current
design unsafe to apply, an unseparable failure, an unresolved consequential
security/safety issue, missing required access, or a production state that
cannot be safely reconciled or rolled back. Do not bypass an authority gate.

