# Project Ashley — Pass 3 Final Endgame Execution Report

Date: 2026-09-22
Repository: `C:\Users\Xharv\Projects\Ashley`
Branch: `main`

## Terminal verdict

`PASS3_FINAL_QUALIFICATION_READY_LIVE_RUN_REQUIRED`

The source-grounded readiness work, one bounded structural repair, frozen
acceptance contract, and local qualification machinery are complete. The six
final cases were not represented as a successful live qualification because
the current repository does not provide the real six-case adapters and
authorized live execution path required to establish actual execution and
evidence. The local composition witness is a substrate test with controlled
model and adapter seams. It is not live qualification evidence.

No provider call, production restart, SSH, deployment, push, or external
effect was performed by this campaign.

## Git boundary and evidence

The independently audited starting baseline was:

- branch: `main`
- starting `HEAD`: `cbf5640e44b953be90ed3bbe0deb576354e5fc24`
- starting tree: `a6b93a0155320dc6bfdb054623dfced8eaf30c69`

The endgame commits were:

1. `e3e39e0` — `docs: freeze pass3 final acceptance contract`
2. `cbd0177` — `feat: expose bounded capability affordances to Thought`
3. `474f883` — `test: prepare pass3 generalization qualification fixtures`
4. `a8eb877` — `fix: keep capability guidance within semantic envelope`

The final implementation candidate before this report commit was:

- `HEAD`: `a8eb877ad2525626e3fb7969558f53df0bd452e5`
- tree: `285aa81772221c6caa5c4054a587727829355fd6`

This report is appended as a final documentation commit. Therefore the exact
post-report `HEAD` and tree are printed in the final terminal handoff after
that commit; the SHA/tree above identify the reviewed implementation
candidate without the report file itself.

The worktree contained pre-existing Owner material at entry. It was not
stashed, reset, checked out, cleaned, reverted, overwritten, or staged. No
unintended staged paths remained before the report commit.

## Source-ground result

The reviewed source showed one narrow structural gap:

`CHOICE_PATH_NARROW_STRUCTURAL_GAP`

The current Thought path already preserved a cognition-selected
`operationKind` through parsing, binding, authority, routing, dispatch,
execution, and evidence settlement. Direct versus worker routing remained a
Host execution decision after Thought selection. The missing part was the
model-visible affordance quality needed for an actual choice among concrete
operations.

The prior operation rows exposed mechanical facts such as family, class,
read-only status, request fields, and availability. They did not expose a
bounded factual description, input/output/evidence contract, authority
conditions, hard limits, or uncertainty. That made the existing choice path
narrow and under-specified. It did not justify a general planner, a new
capability registry, open-world discovery, provider selection, or strategy
metadata.

The readiness archaeology and frozen contract are:

- `docs/architecture/PASS3_FINAL_GENERALIZATION_READINESS_ARCHAEOLOGY_2026-09-22.md`
- `docs/architecture/PASS3_FINAL_ACCEPTANCE_CONTRACT_2026-09-22.md`

The execution plan was:

- `docs/superpowers/plans/2026-09-22-pass3-final-generalization-endgame.md`

## Bounded repair

`ThoughtOperationCapability` now carries host-owned factual affordance fields:

- `label`
- `description`
- `inputContract`
- `outputContract`
- `evidenceContract`
- `authorityConditions`
- `hardLimits`
- `uncertainty`

The fields are exposed for the current bounded operations:

- `project.inspect`
- `workspace.verify`
- `patch_export`
- `candidate.develop` when its existing capability gate is true

The repair preserves the following boundaries:

- Thought chooses the semantic operation.
- Host code owns availability, authority, routing, execution, receipts, and
  effect truth.
- The operation rows contain no `preferred_for`, `fallback_for`, `best_for`,
  `equivalent_to`, rank, or current-task recommendation.
- Provider, model, quota, fallback, direct-route, and worker-route choices are
  not exposed as semantic request choices.
- Failed and `outcome_unknown` observations or receipts remain unsettled and
  cannot be represented as success.
- `patch_export` remains export-only. It does not apply, commit, push, deploy,
  or activate an artifact.

The shared compatibility sentence was compacted in `a8eb877` after the
budget audit. This keeps the new field vocabulary available without adding a
new semantic envelope failure beyond the preserved baseline pressure cases.

The one remediation allowance was consumed by this single bounded
affordance repair round. The prompt-size compaction is part of that same
repair round, not a second behavioral repair.

## Frozen qualification contract

The acceptance contract was frozen before behavioral fixture execution. It
contains five invariants, six cases, one composition requirement, explicit
failure semantics, one remediation allowance, replacement IDs, and the final
verdict vocabulary.

The six case IDs are exactly:

- `P3-CAP-A-UNFAMILIAR-SEARCH-01`
- `P3-CAP-B-RENAME-REORDER-01`
- `P3-CAP-C-FAMILIAR-UNSUITABLE-01`
- `P3-CAP-D-NO-AUTHORIZED-CANDIDATE-01`
- `P3-NT-1-RELEVANT-UPDATE-01`
- `P3-NT-2-IRRELEVANT-UPDATE-01`

The only replacement IDs are the corresponding six `-02` IDs. The fixture
records contain situation and evidence-mode metadata only. They do not
contain expected operations, expected answers, strategy labels, or hidden
priority metadata.

## Local qualification machinery and result

The fixture module and test are:

- `apps/agent-service/src/core/cognitive-v021/qualification/pass3-generalization-fixtures.ts`
- `apps/agent-service/src/core/cognitive-v021/qualification/pass3-generalization-fixtures.test.ts`

The positive composition witness exercises the real cognitive cycle substrate
with controlled model and adapter seams:

1. Thought selects `project.inspect` with a route-neutral search locator.
2. The observation executor returns an actual observation containing a
   candidate.
3. That observation is reinjected into the next Thought input.
4. Thought selects `workspace.verify` after seeing the intermediate result.
5. The effect executor returns a succeeded receipt with candidate and recipe
   evidence.
6. Thought emits a final speech settlement bound to that receipt.

The witness persisted one observation, one succeeded effect receipt, one
settlement, and published final output. Existing failed and
`outcome_unknown` receipt assertions also passed and did not publish
affirmative success claims.

The two non-tool case IDs are frozen in the fixture registry and protected
against contamination. They were not claimed as live behavioral qualification
results.

## Verification evidence

The direct final regression command passed:

```text
9 test files passed
128 tests passed
```

It covered the semantic output contract, capability reality, audience/input
filtering, the existing operation loop, project-operation boundaries,
project-inspection routing, live operation dispatch, the existing capability
qualification contract, and the Pass 3 composition fixture.

The final TypeScript build passed:

```text
npm run build --prefix apps/agent-service
exit code 0
```

The full repository test command was run once as a diagnostic after the
meaningful implementation commits. Before the prompt-size compaction it
reported:

```text
Test Files  2 failed | 406 passed (408)
Tests       4 failed | 2887 passed | 1 skipped (2892)
```

The failures were the `large_memory_corpus` hard envelope gate and three
projection-allocator retrieval-loss envelope cases. A controlled rerun with
the pre-wave compatibility sentence restored reproduced the same quality
failure and four allocator pressure failures. This established that the
remaining envelope deficit was pre-existing baseline debt rather than a new
fixture or capability-reality correctness failure. After the compact guidance
commit, the affected allocator suite reported 67 passed and one remaining
pressure failure; the direct endgame regression set above passed completely.

The preserved failure is not used as live qualification evidence and is not
silently converted to success. It remains an explicit repository-level
verification limitation.

The clean-HEAD schema keyword expectation for `maxLength` was corrected in
the capability qualification test. That was a test-only consistency repair;
it changed no production behavior.

## Why live qualification did not run

The local composition witness uses controlled model and executor seams. The
current official qualification path does not provide the frozen six-case
capability-choice campaign with the required real project-inspection and
workspace-verification adapters. Running an unrelated provider qualification
or treating the controlled witness as production evidence would fabricate the
missing live claim.

An honest live run requires all of the following:

- the exact final committed candidate SHA and tree;
- an approved provider/model credential and operator authorization already
  available for the qualification environment;
- an isolated protected qualification project and workspace;
- ordinary Thought dispatch bound to the candidate, with no fallback or model
  tournament;
- real project inspection and workspace verification adapters;
- all six frozen cases, with at most one bounded remediation or fresh
  replacement rerun as defined by the contract;
- persisted observation, execution, receipt, settlement, and final-answer
  evidence for every case;
- no unsafe external effect, deployment, push, restart, or SSH operation;
- Owner/Sol review and acceptance of the durable evidence.

No provider was called because the current live path could not answer the
frozen claim honestly without those conditions.

## Final status capture before report commit

The exact `git status --short` captured immediately before this report was:

```text
 M apps/agent-service/src/core/agency/own-time-report.test.ts
 M apps/agent-service/src/core/cognition/wake-selection.test.ts
 M apps/agent-service/src/core/cognitive-v021/acceptance/natural-witness-repair.test.ts
 M apps/agent-service/src/core/cognitive-v021/acceptance/owner-responsiveness-incident.test.ts
 M apps/agent-service/src/core/cognitive-v021/delivery/outbox-projector.test.ts
 M apps/agent-service/src/core/cognitive-v021/delivery/pending.test.ts
 M apps/agent-service/src/core/cognitive-v021/delivery/reconcile.test.ts
 D apps/agent-service/src/core/cognitive-v021/migration-44.test.ts
 M apps/agent-service/src/core/cognitive-v021/thought/run.test.ts
 M apps/agent-service/src/core/identity/governance.test.ts
 M apps/agent-service/src/core/learning/revisions.test.ts
 M apps/agent-service/src/core/qualification/init03-evaluation.test.ts
 M apps/agent-service/src/core/qualification/offline-harness.test.ts
 M apps/agent-service/src/core/rollout/capabilities.test.ts
 M apps/agent-service/src/mistral-client.test.ts
 M package.json
 M scripts/testing/run-current-gate.mjs
?? .commandcode/
?? _Internal/
?? apps/agent-service/src/core/nuclear-test-template.ts
?? docs/2026-09-19-Owner-Responsiveness-Incident-V2.1-Qualification-Report.md
?? docs/Comprehensive_Hardening_Campaign_Handoff.md
?? docs/Comprehensive_Hardening_Campaign_Report.md
?? docs/Comprehensive_Hardening_Deployment_Witness_Report.md
?? docs/Comprehensive_Hardening_Hardening_Followup_Report.md
?? docs/Comprehensive_Hardening_Implementation_Plan.md
?? docs/Comprehensive_Hardening_Physical_Qualification_Report.md
?? docs/Comprehensive_Hardening_Post_Implementation_Audit.md
?? docs/DR02_Typed_Delivery_Ownership_Repair_Report.md
?? docs/OpenCode_L1_L2_L3_Capability_Design.md
?? docs/Post_RA_Companion_Development_Campaign_Report.md
?? docs/Post_RA_Companion_Development_Implementation_Plan.md
?? docs/Post_RA_Companion_Development_Programme.md
?? report.md
?? scripts/testing/ensure-workspace-builds.mjs
```

The listed paths are preserved Owner dirt. The report itself is the only
additional intended endgame artifact. No unrelated path is part of the
endgame commits.

## Exit boundary

The campaign ends at this report. No push, deploy, restart, SSH, provider
call, or further implementation is authorized by this report. The final
terminal evidence after the report commit records the post-report `HEAD`,
tree, status, staged-path check, Owner-dirt preservation, and the required
Windows shutdown scheduling result.
