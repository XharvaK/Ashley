# Pass 3 Final Generalization Endgame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the one source-proven capability-choice description gap, freeze and exercise the six-case Pass-3 qualification substrate, and leave an evidence-bounded endgame report without deployment.

**Architecture:** Keep the existing finite `ThoughtOperationCapability` rows, parser, binding, authority, route selection, adapters, and receipts. Add only attributed, strategy-neutral operation semantics to each existing row. Keep behavioral qualification fixtures in the qualification plane and do not add a planner, registry, fallback graph, discovery mechanism, or Host strategy selection.

**Tech Stack:** TypeScript, Node.js, Vitest, SQLite test sidecars, existing Sandbox V2 operation adapters, Markdown artifacts, Git local commits.

**Spec:** `docs/architecture/PASS3_FINAL_ACCEPTANCE_CONTRACT_2026-09-22.md`

## Global Constraints

- `CHOICE_PATH_NARROW_STRUCTURAL_GAP` is the only allowed structural branch.
- The remediation is one objective-independent enrichment of existing finite operation descriptions.
- No `preferred_for`, `fallback_for`, `best_for`, relevance rank, equivalence claim, current-task recommendation, or hidden tool priority may enter capability metadata.
- Do not add open-world discovery, package installation, credentials, generic shell, unrestricted web, a universal registry, a general planner, a classifier, a large ontology, or a fallback graph.
- Preserve Owner dirt exactly; never stash, reset, checkout, clean, `git add .`, or `git add -A`.
- Do not push, deploy, restart production, or SSH to production.
- Run focused verification after each code change and `npm run build:agent` when the TypeScript surface changes.
- The final shutdown command is the last operational step after all reporting and Git evidence are persisted.

## Review Focus

- A description accidentally becomes a recommendation or fallback policy — test metadata-key exclusion and strategy-neutral wording.
- Non-owner audience projection leaks project IDs or operation authority — test the new descriptive fields survive only with the existing filtered row while authorization remains empty.
- A selected operation is replaced by a Host route or sibling operation — test operation identity through semantic parse, binding, direct execution, and effect dispatch.
- A failed or unknown execution is treated as success — test the composition fixture consumes the actual receipt/observation state.
- Qualification fixtures leak expected answers or collapse the six cases — test unique case identities, fresh replacements, and no answer-bearing metadata.

---

### Task 1: Freeze Pass-3 artifacts and execution ledger

**Files:**
- Create: `docs/architecture/PASS3_FINAL_GENERALIZATION_READINESS_ARCHAEOLOGY_2026-09-22.md`
- Create: `docs/architecture/PASS3_FINAL_ACCEPTANCE_CONTRACT_2026-09-22.md`
- Create: `docs/superpowers/plans/2026-09-22-pass3-final-generalization-endgame.md`
- Create during execution: `.superpowers/sdd/2026-09-22-pass3-final-generalization-endgame/progress.md`

**Interfaces:**
- Consumes: source archaeology at `HEAD=cbf5640e44b953be90ed3bbe0deb576354e5fc24`, tree `a6b93a0155320dc6bfdb054623dfced8eaf30c69`.
- Produces: frozen readiness classification, frozen six-case acceptance criteria, and a recovery ledger for later tasks.

- [x] **Step 1: Write and review the readiness archaeology.**

  Confirm that the artifact records the current path from `capability-reality.ts` through `input.ts`, `parse.ts`, `operation-binding.ts`, `run.ts`, `live-operations.ts`, and the existing qualification harness. The classification MUST be `CHOICE_PATH_NARROW_STRUCTURAL_GAP` and `NONTOOL_PATH_MODEL_ONLY_UNTESTED`.

- [x] **Step 2: Write and review the frozen acceptance contract.**

  Confirm that the contract contains the five invariants, C-A through C-D, NT-1 and NT-2, the composition requirement, failure semantics, one allowance, replacement identities, verdict vocabulary, and non-claims.

- [ ] **Step 3: Verify documentation state before commit.**

  Run:

  ```text
  git diff --check -- docs/architecture/PASS3_FINAL_GENERALIZATION_READINESS_ARCHAEOLOGY_2026-09-22.md docs/architecture/PASS3_FINAL_ACCEPTANCE_CONTRACT_2026-09-22.md docs/superpowers/plans/2026-09-22-pass3-final-generalization-endgame.md
  ```

  Expected: exit code 0 and no whitespace errors.

- [ ] **Step 4: Commit only these exact artifacts.**

  ```text
  git add docs/architecture/PASS3_FINAL_GENERALIZATION_READINESS_ARCHAEOLOGY_2026-09-22.md docs/architecture/PASS3_FINAL_ACCEPTANCE_CONTRACT_2026-09-22.md docs/superpowers/plans/2026-09-22-pass3-final-generalization-endgame.md
  git commit -m "docs: freeze pass3 final acceptance contract"
  ```

  Do not stage any existing Owner dirt.

---

### Task 2: Enrich the existing Thought capability descriptions

**Files:**
- Modify: `apps/agent-service/src/core/cognitive-v021/types.ts:1391-1405`
- Modify: `apps/agent-service/src/core/cognitive-v021/thought/capability-reality.ts:97-174`
- Modify: `apps/agent-service/src/core/cognitive-v021/thought/output-contract.ts:493-495`
- Modify: `apps/agent-service/src/core/cognitive-v021/thought/capability-reality.test.ts:56-120`
- Modify: `apps/agent-service/src/core/cognitive-v021/thought/input.test.ts:105-130`
- Modify: `apps/agent-service/src/core/cognitive-v021/qualification/thought-capability-qualification.ts:240-270`

**Interfaces:**
- Consumes: the existing `SandboxV2CapabilitySpec`, project registry facts, and four operation rows already emitted by `thoughtOperationCapabilities`.
- Produces: `ThoughtOperationCapability` rows with required `label`, `description`, `inputContract`, `outputContract`, `evidenceContract`, `authorityConditions`, `hardLimits`, and `uncertainty` fields. These are descriptive only.

- [ ] **Step 1: Write the failing contract tests.**

  Add assertions to the capability-reality test that every available row has all eight descriptive fields, non-empty strings where required, non-empty bounded arrays where required, and no answer-bearing strategy keys. Add a fixture assertion that the two qualification operation rows carry the same contract. Add an input projection assertion that a room receives the descriptive fields but still receives `available:false` and no authorized project IDs.

- [ ] **Step 2: Run the focused tests and observe the expected failure.**

  Run:

  ```text
  npm test -- src/core/cognitive-v021/thought/capability-reality.test.ts src/core/cognitive-v021/thought/input.test.ts src/core/cognitive-v021/qualification/thought-capability-qualification.test.ts
  ```

  Expected: FAIL because the existing capability rows do not contain the new descriptive fields and the exact row expectation is incomplete.

- [ ] **Step 3: Implement the minimal descriptive contract.**

  Extend `ThoughtOperationCapability` with the exact fields below:

  ```ts
  label: string;
  description: string;
  inputContract: string;
  outputContract: string;
  evidenceContract: string;
  authorityConditions: readonly string[];
  hardLimits: readonly string[];
  uncertainty: readonly string[];
  ```

  Add one source-owned static affordance record for each existing operation
  identity. Compose the record into the row without changing availability,
  field lists, project IDs, operation order, routing, or execution. Keep the
  text factual: no candidate recommendation, fallback order, current-task
  guidance, ranking, or equivalent-operation claim. Update the compatibility
  instruction to tell Thought that these fields describe behavior and never
  select an operation.

- [ ] **Step 4: Run the focused contract tests.**

  Run the same command from Step 2. Expected: all named files pass, including
  the exact row contract and audience filtering assertions.

- [ ] **Step 5: Build the affected TypeScript package.**

  ```text
  npm run build:agent
  ```

  Expected: exit code 0.

- [ ] **Step 6: Audit and commit the atomic repair.**

  ```text
  git diff --check
  git diff -- apps/agent-service/src/core/cognitive-v021/types.ts apps/agent-service/src/core/cognitive-v021/thought/capability-reality.ts apps/agent-service/src/core/cognitive-v021/thought/output-contract.ts apps/agent-service/src/core/cognitive-v021/thought/capability-reality.test.ts apps/agent-service/src/core/cognitive-v021/thought/input.test.ts apps/agent-service/src/core/cognitive-v021/qualification/thought-capability-qualification.ts
  git add apps/agent-service/src/core/cognitive-v021/types.ts apps/agent-service/src/core/cognitive-v021/thought/capability-reality.ts apps/agent-service/src/core/cognitive-v021/thought/output-contract.ts apps/agent-service/src/core/cognitive-v021/thought/capability-reality.test.ts apps/agent-service/src/core/cognitive-v021/thought/input.test.ts apps/agent-service/src/core/qualification/thought-capability-qualification.ts
  git commit -m "feat: expose bounded capability affordances to Thought"
  ```

---

### Task 3: Prepare and exercise the frozen six-case qualification substrate

**Files:**
- Create: `apps/agent-service/src/core/cognitive-v021/qualification/pass3-generalization-fixtures.ts`
- Create: `apps/agent-service/src/core/cognitive-v021/qualification/pass3-generalization-fixtures.test.ts`
- Create: `apps/agent-service/src/core/cognitive-v021/thought/operation-choice-composition.test.ts`

**Interfaces:**
- Consumes: the enriched `ThoughtOperationCapability` contract, `runCognitiveCycle`, `bindObservationIntent`, `bindEffectIntent`, and existing test-sidecar helpers.
- Produces: frozen case and replacement identities plus a protected-environment composition witness that selects operation 1, consumes actual observation evidence, selects operation 2, consumes an actual effect receipt, and settles truthfully.

- [ ] **Step 1: Write failing fixture and composition tests.**

  The fixture test MUST assert six unique original IDs, six unique `-02` replacement IDs, four capability cases, two non-tool cases, exactly one composition case, and no forbidden recommendation fields. The composition test MUST assert the model sequence is `project.inspect` then `workspace.verify` then settlement, that the second model call sees the first observation, that the effect executor receives `workspace.verify`, and that a failed/unknown receipt cannot be claimed as success.

- [ ] **Step 2: Run the new tests and observe the expected failure.**

  ```text
  npm test -- src/core/cognitive-v021/qualification/pass3-generalization-fixtures.test.ts src/core/cognitive-v021/thought/operation-choice-composition.test.ts
  ```

  Expected: FAIL because the new fixture module and composition witness do not yet exist.

- [ ] **Step 3: Implement the qualification-only fixture registry and composition witness.**

  Keep fixture data outside production capability reality. Do not include exact expected provider answers in the model-visible input. Use the existing test sidecar and injected `completeChat`, `executeObservation`, and `executeEffect` seams only for a mechanical substrate witness. The witness is not a live model qualification result.

- [ ] **Step 4: Run the new tests to green.**

  Run the same command from Step 2. Expected: all fixture and composition tests pass.

- [ ] **Step 5: Run the affected regression set and build.**

  ```text
  npm test -- src/core/cognitive-v021/qualification/pass3-generalization-fixtures.test.ts src/core/cognitive-v021/thought/operation-choice-composition.test.ts src/core/cognitive-v021/thought/project-operation-boundary.test.ts src/core/cognitive-v021/operation/project-inspection-route.test.ts src/core/cognitive-v021/dispatch/live-operations.test.ts
  npm run build:agent
  ```

  Expected: all named tests and the build pass.

- [ ] **Step 6: Audit and commit the qualification substrate.**

  ```text
  git diff --check
  git add apps/agent-service/src/core/cognitive-v021/qualification/pass3-generalization-fixtures.ts apps/agent-service/src/core/cognitive-v021/qualification/pass3-generalization-fixtures.test.ts apps/agent-service/src/core/cognitive-v021/thought/operation-choice-composition.test.ts
  git commit -m "test: prepare pass3 generalization qualification fixtures"
  ```

---

### Task 4: Produce the final evidence report and controlled exit

**Files:**
- Create or modify: `docs/architecture/PASS3_FINAL_ENDGAME_EXECUTION_REPORT_2026-09-22.md`

**Interfaces:**
- Consumes: the frozen readiness and acceptance artifacts, every local commit, focused test/build output, fixture registry, composition witness, exact Git status, and the one-remediation decision.
- Produces: final evidence report with a precise campaign verdict or qualification-ready hold.

- [ ] **Step 1: Run the final focused verification before reporting.**

  Re-run the affected test set and `npm run build:agent`. If a full suite is required by an actual failure boundary, record the reason; do not run it ceremonially.

- [ ] **Step 2: Determine whether an honest live qualification is possible.**

  Do not call a provider, use Owner credentials, deploy, restart, SSH, or create unsafe effects merely to finish. If ordinary model cognition plus ordinary authority plus real execution/evidence cannot run in the protected checkout, record `PASS3_FINAL_QUALIFICATION_READY_LIVE_RUN_REQUIRED` with exact requirements and do not claim a behavioral pass.

- [ ] **Step 3: Write the report.**

  Include starting/final SHA and tree, all local commits, readiness results, path trace, contract path, allowance state, repair details, per-commit test/build evidence, fixture identities, composition result, preserved failures, affected fingerprints/contracts, Owner dirt preservation, uncertainty, no-push/deploy/restart/SSH confirmation, final status, and exact terminal verdict.

- [ ] **Step 4: Verify final Git evidence.**

  ```text
  git status --short
  git diff --cached --stat
  git rev-parse HEAD
  git rev-parse 'HEAD^{tree}'
  git diff --check
  ```

  Expected: no unintended staged leftovers, Owner dirt preserved, and all report/artifact writes on disk.

- [ ] **Step 5: Commit the report if and only if it is green and isolated.**

  ```text
  git add docs/architecture/PASS3_FINAL_ENDGAME_EXECUTION_REPORT_2026-09-22.md
  git commit -m "docs: record pass3 endgame execution evidence"
  ```

  Re-read final SHA/tree/status after this commit and append the final report checkpoint if necessary. Do not stage Owner dirt.

- [ ] **Step 6: Schedule shutdown as the last operational action.**

  After all tests, commits, report writes, and final evidence are complete, run exactly:

  ```text
  shutdown.exe /s /t 360 /c "Project Ashley overnight job finished or stopped; automatic shutdown scheduled by Owner instruction."
  ```

  If it fails, record the exact error in the report and terminal output, retry the same command once, then stop regardless of the second result. Do not run any more tests or mutate the repository after a successful scheduling command.
