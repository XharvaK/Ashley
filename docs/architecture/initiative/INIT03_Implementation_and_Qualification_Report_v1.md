# INIT-03 SOL REMEDIATION ROUND 3 REPORT

VERDICT:
PASS for local source qualification. This is not independent INIT-03 acceptance.

## BASELINE

starting HEAD:
`40892200159c4536cb73379562d4f9d32d80560e`

origin/master:
`7d686f4d384da97b1d4d00fb26dedf95b82bbdce`

branch:
`master`

worktree:
`AGENTS.md` only, modified and unstaged. It was not edited, staged, reverted, or committed.

Audit history: initial Luna PASS; first Sol BLOCKED; first remediation PASS; second Sol BLOCKED; second remediation local PASS; third Sol BLOCKED (Round-2 Sol High); Round-3 remediation local PASS with the evidence below.

Scope remained local. No Mint, production, Recall mutation, capability-state change, promotion, sandbox activation, provider call, routing change, live Discord traffic, deployment, push, rebase, amend, or history rewrite occurred.

## R2-01 — DISPATCH PROVENANCE

status:
FIXED

accepted dispatch provenance:
Contract id and build identity are captured in `attention_requests` at the accepted running transition, before the provider callback. The durable accepted identity also carries request id, dispatch sequence, route alias, model alias, resolved model identity, model epoch, owner id, and cognitive job id into worker materialization.

global build/contract substitution:
NO

A/E1/build-A -> global B/E2/build-B probe:
The real worker accepted build A, changed current global build/contract/model state to B/E2 before materialization, and persisted the accepted A/E1/build-A provenance. Restart reopened the durable accepted ledger identity unchanged.

## R2-02 — GENERATION ORDER

status:
FIXED

ordering authority:
A DB-global monotonic order shared by accepted attention dispatches and non-cognition OCI materialization. Dispatch admission advances after the greatest persisted OCI generation. Non-cognition materialization advances after the greatest accepted dispatch or persisted OCI generation.

established before completion:
YES. Cognition uses the accepted `dispatch_sequence`, assigned before the provider callback completes.

A/E1 -> B/E2 -> A/E3:
The three accepted generations receive increasing order. A/E3 is the sole current OPEN generation.

late A/E1:
A late A/E1 result persists as `SUPERSEDED` with `stale_continuity_generation`. It cannot supersede A/E3.

old A/E1 retry:
The retry converges on the stored A/E1 row and leaves A/E3 as the sole current OPEN generation.

concurrent older/newer:
PASS. Deterministically synchronized SQLite child writers overlap. The newer writer holds the transaction while the older writer waits, then the older writer commits later without displacing the newer generation.

zero-current-generation possible:
NO under the replayed late-arrival, retry, and overlapping-writer cases.

## R2-03 — RAW WAKE BOUND

status:
FIXED

query shape:
Select owner-scoped `OPEN` OCI ids first. Limit each raw page to 32. Apply Attention, source, capability, and defer eligibility only after the raw bound. Scan at most four pages and project at most eight OCI.

index:
`idx_open_cognitive_items_owner_status_id`

10 deferred visits:
10 actual SQLite Attention visits for one raw page.

100 deferred visits:
32 actual SQLite Attention visits for one raw page.

1000 deferred visits:
32 actual SQLite Attention visits for one raw page.

inventory-independent:
YES

eventual fairness:
The durable cursor reaches a valid ninth row after eight blocked rows and reaches a valid row after 100 blocked rows within the 128-row wake bound. Cursor wrap and insertion/deletion cases retain bounded progression.

## R2-04 — REVIEW QUERY

status:
FIXED

owner-scoped access path:
Select at most 32 owner-scoped `OPEN` OCI ids first. Check Attention review metadata by item primary key only for that bounded raw set. No semantic OCI status is duplicated into Attention.

index:
`idx_open_cognitive_items_owner_status_id`, followed by the Attention item primary key.

10-row cross-owner work:
10 actual review-row visits.

100-row cross-owner work:
32 actual review-row visits.

1000-row cross-owner work:
32 actual review-row visits.

quadratic behavior:
NO

No-due, few-due, many-due, invalid-timestamp, other-owner flood, and OPEN/terminal mixtures are covered. `EXPLAIN QUERY PLAN` uses the owner/status/id index and reports no temporary order sort.

## R2-05 — REVIEW RETRIES

status:
FIXED

invalid disposition:
`invalid_transition` and `source_unavailable` are quarantined immediately. `review_requested_at` is cleared. Attempt count and exact disposition remain durable. The OCI semantic status remains authoritative and is not resolved or withdrawn by processing failure.

retry policy:
`adjudicator_failure` and `adjudicator_unprocessable` retry after 15 minutes and 60 minutes. Attempt 3 quarantines the request. Retry times are host-owned and persisted in Attention.

same-eight immediate retry:
NO

valid ninth:
Processed on bounded progression after the first eight invalid rows. The second invocation does not reprocess the same invalid eight.

restart:
PASS. The review cursor, disposition, attempt count, next-eligible time, and quarantine state survive close/reopen.

hot-loop:
NO

Queues containing more than 8 rows and 100 invalid rows converge. Mixed transient, permanent, terminal, forgotten/unavailable, and cross-owner requests remain isolated. Successful KEEP, WITHDRAW, and SUPERSEDE retain their validated behavior.

## R2-06 — QUALIFICATION

status:
FIXED

dispatch mismatch test:
STRONG. Real attention admission, provider callback seam, worker materialization, global continuity change, durable ledger, and SQLite reopen.

late stale generation test:
STRONG. Real accepted dispatch identities and real OCI materialization.

old retry test:
STRONG. Real durable generation lookup and idempotent retry.

true ordered concurrency test:
STRONG. Overlapping child processes and competing SQLite writers with deterministic synchronization.

deferred row-visit test:
STRONG. Production SQL shape with real SQLite UDF row-visit instrumentation at 10, 100, and 1000 rows.

cross-owner review test:
STRONG. Production count SQL with real SQLite row-visit instrumentation and paired cross-owner inventories at 10, 100, and 1000 rows.

real scheduler/database test:
STRONG. Discord scheduler cycle -> local HTTP health and operational preflight -> real `/initiative/tick` -> `AshleyCore.tickProactive` -> real SQLite wake and review queries. Actual 1000-row database fixtures cover no material, all deferred, review due, and large blocked inventory. The observed bounds are at most 32 review raw rows, 128 wake raw rows, four wake pages, and one review-count query. No live Discord or provider call occurs.

invalid review retry test:
STRONG. Eight invalid rows, valid ninth, restart, exact attempt/disposition assertions, delayed transient retries, attempt-3 quarantine, 100 invalid rows, and mixed isolation.

test quality:
All critical Round-3 reproduction tests are STRONG. No critical test is WEAK or VACUOUS.

## CLOSED REGRESSIONS

R06 migration content recovery:
PASS. Schema v25 extends the recognized pending-migration protocol. The 57-test closed-regression bundle includes v25 failure phases, v23/v24 compatibility, schema-content recovery, sidecar failures, restart, and hostile migration checks.

F01 semantic identity:
PASS. Model-supplied `semanticKeyMaterial` has zero durable identity authority.

F08 diagnostic truth:
PASS. Capability-blocked OCI is not reported as diagnostic-available.

## NON-INTERFERENCE

Source authority:
PASS. Source records and deterministic OCI transitions retain semantic authority.

OCI ontology:
PASS. Kinds remain `question`, `revisit`, `concern`. Statuses remain `OPEN`, `RESOLVED`, `WITHDRAWN`, `SUPERSEDED`. Delay and review disposition remain Attention metadata.

Thought floor:
PASS. The proactive material floor remains 25.

Relationship:
PASS. No commitment, tension, consent, withdrawal, or relationship truth authority changed.

Forget:
PASS. Forgotten/unavailable source review is quarantined operationally and cannot regain semantic influence.

Shadow/live:
PASS. No shadow evidence becomes live through time, retry, or local processing.

Attention:
PASS. Attention remains operational scheduling and review metadata, not OCI semantic authority.

Reservation/delivery:
PASS. Existing proactive reservation and delivery boundaries remain intact.

Privacy:
PASS. No raw source text, raw chain-of-thought, provider reasoning, prompts, tokens, secrets, or sensitive key material were added to OCI persistence or diagnostics.

## FULL QUALIFICATION

focused:
PASS. Exact blocker suite: 7 agent files and 64 tests. Discord suite: 74 tests, including the real scheduler/database integration. Closed-regression bundle: 10 files and 57 tests.

npm test:
PASS. 118 test files passed. 864 tests passed. 1 platform-specific test skipped. Exit code 0.

phase0:offline:
PASS. Agent build passed. Offline Vitest passed 118 files and 864 tests, with 1 skip. The script ended with `OK offline tier`.

external network:
0. The offline guard emitted no `offline_external_network_blocked` event and the guarded command exited 0.

agent build:
PASS. `npm run build:agent`.

discord build:
PASS. `npm run build:discord`.

git diff --check:
PASS after the documentation changes.

## DOCUMENTATION

contract:
Corrected to schema v25, accepted dispatch contract/build provenance, pre-completion monotonic generation order, raw-first wake bounds, owner-scoped review work, retry/quarantine semantics, exact row-work evidence, and real scheduler/database integration.

report:
Corrected to Sol Remediation Round 3 evidence. It does not claim independent final acceptance.

audit history preserved:
YES

## LOCAL COMMITS

Round-3 commits only:

1. `a1fb760` — `fix(db): add INIT-03 round 3 ordering metadata`
2. `5099ede` — `fix(cognition): preserve accepted dispatch provenance`
3. `8abdcf9` — `fix(cognition): order OCI continuity generations monotonically`
4. `45541fb` — `fix(cognition): bound raw OCI wake retrieval`
5. `a5dd91a` — `fix(cognition): index OCI review work by owner`
6. `b93c064` — `fix(cognition): bound failed OCI review retries`
7. `ea6a491` — `test(qualification): cover final INIT-03 blockers`
8. `1f6bb21` — `test(qualification): align schema and clock fixtures`
9. Documentation publication commit: this contract/report commit.

## PRODUCTION

Mint:
UNTOUCHED

Recall:
UNTOUCHED

sandbox:
UNTOUCHED

providers:
NO LIVE CALLS

Discord:
NO LIVE TRAFFIC

push:
NO

deploy:
NO

## WORKTREE

AGENTS.md:
UNCHANGED / UNSTAGED relative to the starting state.

other:
After the documentation commit, no Round-3 path remains modified or untracked. Final status inspection is required before shutdown.

## HUMAN NEXT GATE

FRESH INDEPENDENT SOL HIGH CLOSURE AUDIT REQUIRED BEFORE INIT-03 ACCEPTANCE.

STOP.
