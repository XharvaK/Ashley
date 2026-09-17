# Async Operation Recovery and Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the post-`1c4ececc950cf36d0e8bdbd835a3d7cb0a1ce376` async-operation campaign, finish the uncommitted cancellation/recovery/availability wave, and leave a locally committed, focused-tested, terminal-verified implementation without push, deployment, production restart, or Mint mutation.

**Architecture:** Preserve the existing three committed slices: durable `project.investigate` ownership, detached typed execution with interim publication ownership, and exactly-once terminal completion with fresh Thought-B context. Complete Wave 4 with cancellation truth, crash recovery, conversational availability, and the smallest same-sidecar cognition claim. A detached completion wake may queue behind an already-held claim; that exception is admitted only from the exact live claim and pending detached-completion evidence, so an Owner successor still invalidates the older Thought.

**Tech Stack:** TypeScript, Node `node:sqlite`, Vitest, npm scripts, Git.

**Spec:** `C:\Users\Xharv\.codex\attachments\80c2315e-9b62-4644-b23e-3bfb54c214a7\pasted-text.txt`

## Global Constraints

- Preserve all pre-existing untracked Owner artifacts; never use `git clean`, `git reset --hard`, broad staging, or unknown-work deletion.
- Do not push, deploy, restart production, mutate Mint production, force-push, or alter production environment.
- Async V1 remains Owner-private, read-only, `project.investigate` only, Mode-B/OpenCode, max 8 typed reads, with no generic shell, Git, network, effects, public operation, proactive background investigation, or M6 promotion.
- Keep `project.inspect`, `project.read_file`, `project.list_directory`, and `project.search_text` synchronous and keep `canOfferBoundedOperation = false` and project-inspection rollout unchanged.
- Keep the four Thought roots unchanged; interim hold remains optional on `observation_intent` and is never settlement or evidence.
- Persist terminal operation truth before creating exactly one `observation_or_receipt` completion; never blindly rerun ambiguous work.
- Preserve `operation_pending` and `detached_operation:<operation_id>` until valid Thought-B settlement, valid supersession/currentness, or valid silence resolves the Owner obligation.
- Distinguish `cancel_requested`, `cancelled`, `stopped`, `outcome_unknown`, missing receipt, and nonexecution.
- Run focused and adjacent tests during packets; run one terminal current/full gate only after the major wave is complete.
- The final machine-changing action is exactly `shutdown /s /t 120`, after the complete final report has been prepared.

---

### Task 1: Recovery characterization and provenance lock

**Files:**
- Read: `C:\Users\Xharv\.codex\attachments\80c2315e-9b62-4644-b23e-3bfb54c214a7\pasted-text.txt`
- Read: `AGENTS.md`
- Read: committed descendants of `1c4ececc950cf36d0e8bdbd835a3d7cb0a1ce376`
- Preserve: all current tracked modifications and untracked files outside the exact implementation paths

**Interfaces:**
- Consumes: Git branch, HEAD/tree, status, diffs, reflog, commit history, and focused test output.
- Produces: a recovery matrix for P0 and Waves 1-5, a list of exact current implementation paths, and a classification of uncommitted work as Muse work or preserved Owner material.

- [x] **Step 1: Capture the recovery boundary.** Record `main`, `HEAD`, `HEAD^{tree}`, `git status --short`, recent commit metadata, `git diff`, `git diff --cached`, `git diff --check`, and `git reflog -20`.
- [x] **Step 2: Map committed waves.** Bind `ccfbee7`, `5235b80`, `7475ab5`, and `49c63f2` to P0 and Waves 1-3 from their changed files and focused tests.
- [x] **Step 3: Run the current focused campaign tests.** Preserve the observed failure in `thought/conversation-availability.test.ts` as the red reproduction for Task 2.

### Task 2: Add a precise completion-queue claim witness

**Files:**
- Modify: `apps/agent-service/src/core/cognitive-v021/cycle/cognition-claim.ts`
- Modify: `apps/agent-service/src/core/cognitive-v021/cycle/cognition-claim.test.ts`

**Interfaces:**
- Consumes: `cognition_claims`, `cycle_records`, and `inbox_events` in the same sidecar.
- Produces: `activeThoughtMayFinishWhileDetachedCompletionQueued(sidecar, { conversationId, cycleId, generation, nowMs? }): boolean`.

- [x] **Step 1: Write the failing unit test.** Create one same-sidecar fixture that acquires a claim for an active Owner cycle, appends a pending `observation_or_receipt` event whose payload contains `detachedOperationId`, and asserts the witness is `true`; add a second assertion for a newer `owner_message` cycle asserting `false`.
- [x] **Step 2: Run the claim test and verify the expected missing-export failure.** Run `npm test --prefix apps/agent-service -- src/core/cognitive-v021/cycle/cognition-claim.test.ts`. Expected: FAIL because the new witness is not implemented.
- [x] **Step 3: Implement the smallest witness.** Require a live claim whose `cycle_id` and conversation match the older Thought, require a strictly newer current cycle with trigger kind `observation_or_receipt`, and require a nonterminal inbox row on that wake with a nonempty `detachedOperationId`. Return `false` for missing, expired, mismatched, owner-successor, or malformed evidence.
- [x] **Step 4: Run the claim test and verify it passes.** Re-run the same command and require all assertions to pass.

### Task 3: Preserve an active Owner Thought while completion is queued

**Files:**
- Modify: `apps/agent-service/src/core/cognitive-v021/thought/run.ts`
- Modify: `apps/agent-service/src/core/cognitive-v021/settlement/publish.ts`
- Modify: `apps/agent-service/src/core/cognitive-v021/thought/conversation-availability.test.ts`

**Interfaces:**
- Consumes: the Task 2 witness and the existing `KernelDeps.renewConversationCognition` live claim renewal.
- Produces: active Thought continuation through the detached-completion queue, while normal stale-generation and Owner-preemption behavior remains unchanged.

- [x] **Step 1: Add the lifecycle regression assertion before implementation.** Keep the existing red integration path that blocks Thought B, completes the worker, probes the completion while B owns the claim, then requires B to publish and the completion to run afterward with current context.
- [x] **Step 2: Run the integration test and verify the current red result.** Run `npm test --prefix apps/agent-service -- src/core/cognitive-v021/thought/conversation-availability.test.ts`. Expected: the active Owner turn returns `published: false` because the completion wake advanced the generation.
- [x] **Step 3: Apply the witness to `currentLifecycleIs`.** When the original cycle is no longer the max generation, allow it to continue only when the live same-store claim proves the pending detached completion exception. Keep all other stale lifecycle results unchanged.
- [x] **Step 4: Apply the same witness to the publication fence.** Add a narrow publication option used by the cognitive kernel; accept the older settlement only when the witness validates inside the existing transaction fences. Do not weaken ordinary `stale_generation` rejection.
- [x] **Step 5: Run the integration regression and adjacent completion tests.** Run `npm test --prefix apps/agent-service -- src/core/cognitive-v021/thought/conversation-availability.test.ts src/core/cognitive-v021/thought/thought-b-completion.test.ts src/core/cognitive-v021/operation/completion.test.ts`. Expected: PASS with the active Owner turn publishing and the queued completion resuming afterward.

### Task 4: Complete and commit Wave 4

**Files:**
- Existing current Wave 4 paths only: `apps/agent-service/src/core/cognitive-v021/cycle/owner-coverage.ts`, `apps/agent-service/src/core/cognitive-v021/dispatch/live.ts`, `apps/agent-service/src/core/cognitive-v021/operation/completion.ts`, `apps/agent-service/src/core/cognitive-v021/operation/detached.ts`, `apps/agent-service/src/core/cognitive-v021/sidecar/db.ts`, `apps/agent-service/src/core/cognitive-v021/sidecar/schema.ts`, `apps/agent-service/src/core/cognitive-v021/thought/run.ts`, `apps/agent-service/src/core/cognitive-v021/types.ts`, and their exact Wave 4 tests.
- Do not stage: `_Internal/` or unrelated untracked Owner reports and artifacts.

**Interfaces:**
- Consumes: the recovered committed Waves 1-3 and the Task 2-3 correction.
- Produces: a coherent Wave 4 commit with cancellation/recovery truth, conversational availability, and same-sidecar max-one-Thought protection.

- [x] **Step 1: Run the complete focused async-operation set.** Include detached ownership, detached dispatch, completion, recovery matrix, cognition claim, cognition turn, conversation availability, detach-investigate, Thought-B completion, and schema V21 migration tests.
- [x] **Step 2: Run the affected agent-service build.** Run `npm run build:agent` and record the exact result.
- [ ] **Step 3: Check whitespace and stage only audited Wave 4 paths.** Run `git diff --check`, inspect `git diff --cached --name-status`, and do not use `git add .` or `git add apps/agent-service/src/`.
- [ ] **Step 4: Commit the coherent wave.** Use a focused commit subject such as `feat(cognition): preserve availability during detached work`; do not amend or rewrite accepted history.
- [ ] **Step 5: Re-read the commit and verify its tree and focused evidence.** Record SHA, tree, changed files, tests, build, and diff-check results.

### Task 5: Terminal qualification and final report

**Files:**
- Read-only verification across the repository and Git state.
- No source changes after the terminal gate unless a failure is directly caused by this wave and receives a focused correction commit.

**Interfaces:**
- Consumes: all committed campaign waves, current focused evidence, and the project current/full gate.
- Produces: the required recovery certificate, wave matrix, source-local corrections, P8 decision, terminal verification matrix, final Git state, final verdict, and shutdown record.

- [ ] **Step 1: Run the complete focused terminal matrix.** Prove success, failure, outcome-unknown, cancellation, conversational availability, max-one-Thought, P0 system notices, fresh Thought-B budget, interim-delivery independence, Mode-B typed-only scope, and architecture boundaries.
- [ ] **Step 2: Run one terminal current/full gate.** Run `npm run test:full-current`; classify exact pre-existing failures separately from wave regressions and repair only wave regressions.
- [ ] **Step 3: Capture final branch/HEAD/tree/status and untracked-artifact preservation.** Record exact output after all commits and tests.
- [ ] **Step 4: Prepare the complete final report before any shutdown command.** Choose exactly one required verdict and include all requested fields.
- [ ] **Step 5: Schedule the final machine action.** Run exactly `shutdown /s /t 120`, then append `WINDOWS_SHUTDOWN = SCHEDULED_120_SECONDS`, `SHUTDOWN_COMMAND = shutdown /s /t 120`, and the matching reason to the final response. Do not run any further machine-changing action.

## Self-review

- The plan covers recovery, the observed Wave 4 failure, cancellation/recovery, P8 serialization, focused verification, build/diff checks, commit discipline, the terminal full gate, and the required shutdown boundary.
- No generic workflow engine, background cognition, new Thought root, broader operation scope, or production action is introduced.
- The only new interface is a narrow boolean witness whose conditions are checked from the same durable sidecar; later tasks use the exact name and arguments defined in Task 2.
