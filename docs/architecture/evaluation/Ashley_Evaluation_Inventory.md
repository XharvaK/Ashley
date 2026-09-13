# Ashley Evaluation / Qualification Inventory

Status: `HISTORICAL SOURCE SNAPSHOT / REFERENCE`

Date: 2026-08-13

Source baseline: `82b30a9d218855bd1373121fc5a656a3403b1c85` on `master`

> Counts, source versions, route bindings, and command results in this file
> describe the named 2026-08-13 baseline and concurrent worktree only. They are
> not current indefinitely. The authoritative cross-cutting contract is
> [`Ashley_Evaluation_Qualification_Plane.md`](../Ashley_Evaluation_Qualification_Plane.md).

Scope: repository mechanisms that test, evaluate, qualify, observe, or validate Ashley behavior

Exclusions: no production or Sandbox source was modified; no Mint or physical qualification was executed.

## Inventory summary

At the named baseline, the repository contained a mature but fragmented
evaluation stack.

- There are 247 source test or spec files across the application packages.
- The agent service contains 127 test files.
- The Sandbox broker contains 91 test files.
- The Discord bot contains 15 test files.
- The Sandbox policy package contains 9 test files.
- The external broker contains 5 test files.
- Root `npm test` runs only the agent-service suite. It is not a repository-wide test command.
- The current mechanisms do not emit one common evidence or qualification format.
- Physical, deterministic, behavioral, and observational results are not interchangeable.

The test-file counts exclude dependency and build-output directories. They describe the concurrent working tree at the final reconnaissance check, not only committed `HEAD`. They may change while the parallel Sandbox worker continues. They are not test-case counts or current pass state.

## Current taxonomy

The repository fits this codebase-aware taxonomy:

| Class | Current mechanisms |
|---|---|
| Normative and static consistency | governance documents, status baseline verifier, scenario-matrix source anchors, configuration validation |
| Deterministic unit and contract | agent-service, routing, Identity, memory, cognition, Agency, delivery, broker, and policy tests |
| Isolated integration and counterfactual | Phase 0 offline, cognitive ON/OFF projections, restart and retry tests, fake-adapter integration |
| Behavioral model evaluation | persona replay and pairwise model judge |
| Qualification evidence aggregation | capability rollout evidence ledger and Recall qualification epochs |
| Physical environment qualification | Sandbox Linux Mint and Bubblewrap qualification harnesses |
| Operational and assurance checks | Wave 10a, 10b, 10c, health, backup, resource and Mint documentation checks |
| Live and shadow observation | capability shadow evidence, health/status endpoints, live-check and broker smoke scripts |

## Significant mechanisms

### 1. Agent-service Vitest suite

- **NAME:** Agent-service source test suite
- **PATH:** `apps/agent-service/src/**/*.test.ts`, `apps/agent-service/vitest.config.ts`
- **SYSTEM UNDER TEST:** Identity, State, Agency, cognition, memory, continuity, relationship state, routing, delivery, rollout, provenance, attention, and service integration
- **TYPE:** deterministic unit, contract, and isolated integration
- **WHAT IT PROVES:** executed tests establish the asserted source contracts in the local Vitest environment
- **WHAT IT DOES NOT PROVE:** Discord behavior, other application packages, current Mint state, physical Sandbox isolation, production distribution, or model-persona continuity
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Node and Vitest; some tests use temporary SQLite stores and fixtures
- **CURRENT STATUS:** 127 test files exist; the full suite was not executed during this documentation-only reconnaissance
- **REUSABLE FOR EVALUATION PLANE?:** yes; result adapters should preserve test identity, source binding, and boundary limitations

### 2. Package-specific test suites

- **NAME:** Discord, Sandbox broker, Sandbox policy, and external broker suites
- **PATH:** `apps/discord-bot/src/**/*.test.ts`, `apps/sandbox-broker/src/**/*.test.ts`, `apps/sandbox-policy/src/**/*.test.ts`, `apps/external-broker/src/**/*.test.ts`
- **SYSTEM UNDER TEST:** platform rendering and delivery, Sandbox policy and execution machinery, and external-effect brokering
- **TYPE:** unit, contract, integration, and adversarial tests
- **WHAT IT PROVES:** package-local contracts, including deterministic rendering, policy decisions, fake-adapter effects, replay, and receipt state transitions
- **WHAT IT DOES NOT PROVE:** a single repository-wide green state, real Discord or external provider delivery, or physical Linux isolation
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Node runners; commands differ by package
- **CURRENT STATUS:** 120 files exist outside the agent-service suite; root `npm test` does not execute them
- **REUSABLE FOR EVALUATION PLANE?:** yes; the plane needs package adapters or an explicit aggregate definition, not an assumption that root `npm test` is comprehensive

### 3. Phase 0 offline gate

- **NAME:** Phase 0 offline qualification
- **PATH:** `scripts/phase0/run-all.ps1`, `apps/agent-service/vitest.offline.config.ts`, `apps/agent-service/src/core/qualification/offline-network-guard.ts`, `apps/agent-service/src/core/qualification/offline-harness.test.ts`
- **SYSTEM UNDER TEST:** agent-service behavior under outbound-network denial
- **TYPE:** deterministic integration and failure-path qualification
- **WHAT IT PROVES:** when executed successfully, external `fetch`, HTTP, and HTTPS calls fail loudly while loopback and Unix fixtures remain available; provider paths and deterministic expression fixtures are exercised
- **WHAT IT DOES NOT PROVE:** OS-level network isolation, current Mint state, Discord behavior, or all package suites
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic; simulated network denial, not physical isolation
- **RUN ENVIRONMENT:** local Node/Vitest with `ASHLEY_PHASE0_OFFLINE=true` and `config/env.example`
- **CURRENT STATUS:** implemented; not executed in this reconnaissance
- **REUSABLE FOR EVALUATION PLANE?:** yes; strong example of an explicit environment profile and fail-loud negative evidence

### 4. Phase 0 agent smoke tier

- **NAME:** Phase 0 local agent smokes
- **PATH:** `scripts/phase0/run-all.ps1`, `scripts/smoke/*.mjs`
- **SYSTEM UNDER TEST:** running local agent HTTP behavior for memory, recall, correction, initiative, and auto-remember paths
- **TYPE:** integration smoke
- **WHAT IT PROVES:** the selected HTTP flows work against the supplied running agent endpoint
- **WHAT IT DOES NOT PROVE:** isolated startup, clean data, complete regression coverage, production behavior, or physical qualification
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** mixed deterministic assertions over a live local service
- **RUN ENVIRONMENT:** local service that must already be running
- **CURRENT STATUS:** implemented; the runner does not create a fresh isolated service for this tier; not executed here
- **REUSABLE FOR EVALUATION PLANE?:** conditionally; it needs explicit service, data, source, and environment binding

### 5. Persona replay corpus

- **NAME:** Persona and behavior replay
- **PATH:** `scripts/persona-eval/probes.json`, `scripts/persona-eval/replay.mjs`, `scripts/persona-eval/run-isolated.ps1`, `scripts/persona-eval/run-full.ps1`
- **SYSTEM UNDER TEST:** model-backed conversational behavior, honesty, voice, friction, curiosity, banter, and fabrication resistance
- **TYPE:** behavioral model evaluation
- **WHAT IT PROVES:** candidate responses can be replayed across a versioned probe set and seeds in an isolated local agent data directory
- **WHAT IT DOES NOT PROVE:** deterministic authorization, full identity continuity, current source binding, production behavior, or provider independence
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** model-generated; later judged
- **RUN ENVIRONMENT:** local agent on port 3712 with a separate data directory, persona-eval mode, proactive and curiosity disabled, and retrieval top-k zero
- **CURRENT STATUS:** Probe count is source-derived from `scripts/persona-eval/probes.json`. `docs/persona-eval.md` points at that corpus. Historical outputs are not current-checkout qualification
- **REUSABLE FOR EVALUATION PLANE?:** yes; the runner and corpus are valuable, but the run record needs source, environment, model-profile, corpus, and configuration binding

### 6. Persona pairwise judge

- **NAME:** Blind persona candidate/baseline judge
- **PATH:** `scripts/persona-eval/judge.mjs`, `scripts/persona-eval/lib.mjs`
- **SYSTEM UNDER TEST:** relative conversational quality and deterministic persona hard checks
- **TYPE:** pairwise model judge plus regex hard checks
- **WHAT IT PROVES:** responses can be compared blindly with stable side swapping against a rubric that prioritizes honesty, substance, spine, voice, delivery, earned friction, and naturalness
- **WHAT IT DOES NOT PROVE:** architectural correctness, independent judging, calibrated absolute quality, or deterministic safety correctness
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** model-judged with deterministic anchors
- **RUN ENVIRONMENT:** direct Mistral API invocation; default judge is `MISTRAL_MODEL` or `mistral-medium-latest`
- **CURRENT STATUS:** implemented; no focused tests for judge parsing, hard checks, or side swapping were found; invalid or missing judge verdicts can become ties rather than a failing result
- **REUSABLE FOR EVALUATION PLANE?:** yes after fail-closed parsing, judge identity, rubric version, calibration, disagreement, and independent-judge safeguards are added

### 7. Wave 10b deterministic scenario evaluator

- **NAME:** Stabilization deterministic coverage evaluator
- **PATH:** `scripts/stabilization/eval-deterministic.mjs`, `docs/stabilization/scenario-matrix.json`
- **SYSTEM UNDER TEST:** declared stabilization scenario coverage
- **TYPE:** static source-evidence matrix with optional imported persona results
- **WHAT IT PROVES:** referenced source paths exist and contain configured anchors; declared partials and gaps are surfaced
- **WHAT IT DOES NOT PROVE:** that referenced tests ran, passed, or exercised the claimed behavior
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic static inspection
- **RUN ENVIRONMENT:** local Node
- **CURRENT STATUS:** executed on 2026-08-13; non-strict PASS with 15 scenarios, 10 covered, 4 partial, and 1 gap; `S-INJECT` remains a gap
- **REUSABLE FOR EVALUATION PLANE?:** yes as a definition registry seed; source-anchor presence must not be represented as executed test evidence

### 8. Wave 10a status baseline verifier

- **NAME:** Machine-readable status drift verifier
- **PATH:** `scripts/stabilization/verify-status.mjs`, `docs/stabilization/status-baseline.json`
- **SYSTEM UNDER TEST:** agreement between expected source status and a checked-in baseline
- **TYPE:** deterministic configuration and documentation drift check
- **WHAT IT PROVES:** stale baseline data can be detected
- **WHAT IT DOES NOT PROVE:** runtime health, schema migration success, or current Mint status
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Node
- **CURRENT STATUS:** executed on 2026-08-13 and failed with `status_baseline_drift`; the baseline still reports schema 19 while current source expectations report schema 27 and additional capability routes
- **REUSABLE FOR EVALUATION PLANE?:** yes; this is strong negative evidence and should emit a bounded drift result

### 9. Wave 10c assurance audit

- **NAME:** Stabilization assurance audit
- **PATH:** `scripts/stabilization/audit-10c.mjs`, `apps/agent-service/src/stabilization/wave10c.test.ts`
- **SYSTEM UNDER TEST:** health minimization, resource checks, backup behavior, and Mint documentation assertions
- **TYPE:** source audit plus deterministic temporary-database checks
- **WHAT IT PROVES:** selected local assurance contracts when its expectations match current architecture
- **WHAT IT DOES NOT PROVE:** current Mint execution, live systemd behavior, or physical host state
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Node and temporary databases
- **CURRENT STATUS:** executed on 2026-08-13 and failed with `schema_version_not_19`; the audit contains a stale schema expectation
- **REUSABLE FOR EVALUATION PLANE?:** yes after definitions and expected architecture versions are explicit

### 10. Capability qualification ledger

- **NAME:** Capability rollout qualification evidence
- **PATH:** `apps/agent-service/src/core/rollout/capabilities.ts`, related rollout tests, owner-only capability endpoints
- **SYSTEM UNDER TEST:** whether capability evidence satisfies current promotion prerequisites
- **TYPE:** runtime qualification evidence aggregation and governance gate
- **WHAT IT PROVES:** configured isolated-eval and live-shadow prerequisites, dependency state, model epoch matching, and explicit owner promotion rules are enforced by tested code
- **WHAT IT DOES NOT PROVE:** that an uploaded `passed` claim came from a valid evaluator, bound source, immutable artifact, or trusted environment
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic ledger logic over supplied evidence
- **RUN ENVIRONMENT:** agent-service runtime and tests
- **CURRENT STATUS:** implemented for 20 capabilities; non-Recall gates require isolated evaluation, at least 3 seeds, at least 25 live-shadow events over at least 7 days, active dependencies, and matching model epoch where required
- **REUSABLE FOR EVALUATION PLANE?:** as a downstream consumer only; the evaluation plane must not replace owner promotion or write evidence automatically

### 11. Recall qualification epoch

- **NAME:** Recall v26 qualification campaign
- **PATH:** `apps/agent-service/src/core/rollout/recall-qualification-epoch.ts`, related rollout tests
- **SYSTEM UNDER TEST:** qualification campaign isolation and Recall cutover prerequisites
- **TYPE:** deterministic governance and campaign ledger
- **WHAT IT PROVES:** qualification epochs are explicit, owner-created, CAS-protected, idempotent, and cannot be implicitly satisfied by historical evidence
- **WHAT IT DOES NOT PROVE:** behavioral quality of the underlying Recall implementation without valid attached evidence
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** agent-service runtime and tests
- **CURRENT STATUS:** implemented; live dual-write and cutover have separate authority boundaries
- **REUSABLE FOR EVALUATION PLANE?:** yes as the strongest local campaign-isolation pattern; result production and promotion must remain separate

### 12. Model-routing contract tests

- **NAME:** Model registry and route integration tests
- **PATH:** `config/models.json`, `apps/agent-service/src/core/model-routing/*.ts`, `apps/agent-service/src/core/model-routing/*.test.ts`
- **SYSTEM UNDER TEST:** route selection, disabled-route behavior, provider credentials, quota lanes, and failure isolation
- **TYPE:** deterministic unit and integration contract
- **WHAT IT PROVES:** configured route mapping and fail-closed route behavior for the tested source configuration
- **WHAT IT DOES NOT PROVE:** behavioral suitability of a replacement provider/model, persona continuity, semantic quality, or provider-resolved model stability
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Vitest with configuration fixtures
- **CURRENT STATUS:** active routes include Mistral expression, Groq expression fallback, Groq Thought, and Groq utility; experimental routes are disabled
- **REUSABLE FOR EVALUATION PLANE?:** yes; this should become the deterministic foundation of model-profile qualification

### 13. Model continuity and attention tests

- **NAME:** Resolved-model continuity and capability demotion
- **PATH:** `apps/agent-service/src/core/attention/**/*.test.ts`, model-continuity implementation and rollout tests
- **SYSTEM UNDER TEST:** configured alias versus resolved model identity, continuity epochs, and model-sensitive capability state
- **TYPE:** deterministic unit and integration
- **WHAT IT PROVES:** a resolved-model change can create a new continuity epoch and demote model-sensitive capabilities; old-epoch evidence cannot re-promote them
- **WHAT IT DOES NOT PROVE:** whether the new model preserves Ashley's behavior or identity
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Vitest and temporary stores
- **CURRENT STATUS:** implemented and source-tested; no shared behavioral qualification campaign is attached
- **REUSABLE FOR EVALUATION PLANE?:** yes; the model epoch should be a required binding, not a substitute for behavioral evidence

### 14. Cognition counterfactual harnesses

- **NAME:** INIT-03 and Wave cognition qualification
- **PATH:** `apps/agent-service/src/core/qualification/init03-evaluation.test.ts`, `init03-adversarial.test.ts`, `wave4-*.test.ts`, `counterfactual-harness.ts`
- **SYSTEM UNDER TEST:** cognition integration, provenance, non-interference, failure handling, shadow/live separation, restart, and Agency boundaries
- **TYPE:** deterministic counterfactual and adversarial integration
- **WHAT IT PROVES:** matched ON/OFF projections, ablations, provenance constraints, restart behavior, and tested influence boundaries in isolated stores
- **WHAT IT DOES NOT PROVE:** live model quality, production distribution, current Mint behavior, or every long-horizon autonomy failure
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Vitest with isolated databases and fixtures
- **CURRENT STATUS:** extensive and reusable; results are not emitted through a common qualification artifact
- **REUSABLE FOR EVALUATION PLANE?:** yes; this is the strongest local pattern for subsystem counterfactual qualification

### 15. Cognitive job characterization

- **NAME:** P-01A cognition lifecycle characterization
- **PATH:** `apps/agent-service/src/core/cognition/p01a-characterization.test.ts`
- **SYSTEM UNDER TEST:** cognitive-job creation, exactly-once behavior, retries, ambiguity, backoff, contract/model epochs, and provenance
- **TYPE:** deterministic characterization and parity baseline
- **WHAT IT PROVES:** the current source behavior for the asserted lifecycle cases
- **WHAT IT DOES NOT PROVE:** external framework equivalence beyond the tested surface or real provider behavior
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Vitest and isolated stores
- **CURRENT STATUS:** implemented as a durable characterization asset
- **REUSABLE FOR EVALUATION PLANE?:** yes; characterization tests are good pre-substrate invariants

### 16. Identity, learning, honesty, and relationship tests

- **NAME:** Identity authority and relational-safety contracts
- **PATH:** `apps/agent-service/src/core/identity/**/*.test.ts`, learning-revision tests, honesty finalizer tests, relationship and coercion tests
- **SYSTEM UNDER TEST:** foundational/adaptive identity boundaries, owner review, revision lineage, unsupported self-claims, dependency pressure, and evidence trust
- **TYPE:** deterministic unit and integration
- **WHAT IT PROVES:** stable identity cannot be silently rewritten by short observations; exact reviewed shadow revisions have bounded application; broad shadow scans are refused; selected unsupported claims and coercive patterns are blocked
- **WHAT IT DOES NOT PROVE:** broad identity continuity across providers, natural persona quality, all sycophancy modes, or long-horizon relationship effects
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Vitest and isolated stores
- **CURRENT STATUS:** strong authority tests exist; persona and relationship semantic coverage remains incomplete
- **REUSABLE FOR EVALUATION PLANE?:** yes; these should become deterministic anchors for any model-judged identity campaign

### 17. Memory, provenance, forget, and continuity tests

- **NAME:** Nuclear memory and continuity contracts
- **PATH:** memory, provenance, continuity, cognition, and qualification tests under `apps/agent-service/src/core/`
- **SYSTEM UNDER TEST:** authoritative and derived data, owner boundaries, exact provenance, tombstones, lineage, read records, and shadow/live influence
- **TYPE:** deterministic unit, integration, restart, and adversarial
- **WHAT IT PROVES:** tested database and policy paths preserve ownership, lineage, provenance, deletion semantics, and influence authority
- **WHAT IT DOES NOT PROVE:** external retrieval-store behavior, private corpus safety, production backup state, or semantic quality of all recalled material
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic
- **RUN ENVIRONMENT:** local Vitest with temporary `nuclear.db` and continuity stores
- **CURRENT STATUS:** broad source coverage exists; it is not summarized as one memory-authority qualification result
- **REUSABLE FOR EVALUATION PLANE?:** yes; memory authority drift should remain a dedicated invariant family

### 18. Delivery, effect, and receipt tests

- **NAME:** Agent, Discord, and external-broker delivery contracts
- **PATH:** delivery tests in `apps/agent-service`, `apps/discord-bot`, and `apps/external-broker`
- **SYSTEM UNDER TEST:** inbound deduplication, bubble rendering, pacing, retries, effect idempotency, receipts, reconciliation, and ambiguous outcomes
- **TYPE:** deterministic unit and fake-adapter integration
- **WHAT IT PROVES:** selected state machines preserve no-drop, bounded duplicate, receipt, secret-redaction, and ambiguity semantics under local fixtures. A receipt proves what the tested effect path reports.
- **WHAT IT DOES NOT PROVE:** real Discord delivery, real external provider effects, physical network failure behavior, or independently observed post-effect reality. A receipt is not an Effect Witness.
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic and simulated integration
- **RUN ENVIRONMENT:** local Node tests with fake adapters and fixtures
- **CURRENT STATUS:** strong contract coverage exists; real-effect qualification remains separate and unverified
- **REUSABLE FOR EVALUATION PLANE?:** yes; the result contract must preserve `REFUSED` versus `OUTCOME_UNKNOWN` and let an evaluation definition require an independent Effect Witness for ambiguous or consequential effects

### 19. Sandbox source and integration tests

- **NAME:** Sandbox broker, policy, receipt, and isolation-provider tests
- **PATH:** `apps/sandbox-broker/src/**/*.test.ts`, `apps/sandbox-policy/src/**/*.test.ts`
- **SYSTEM UNDER TEST:** broker protocol, policy attenuation, execution provider, receipts, resource controls, and adverse paths
- **TYPE:** deterministic unit, integration, and adversarial
- **WHAT IT PROVES:** source-level Sandbox contracts in the local test environment
- **WHAT IT DOES NOT PROVE:** Bubblewrap or systemd isolation on the production Linux Mint host
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** deterministic; not physical
- **RUN ENVIRONMENT:** local Node tests and fixtures
- **CURRENT STATUS:** extensive source coverage exists; concurrent Sandbox work was present and was not touched by this reconnaissance
- **REUSABLE FOR EVALUATION PLANE?:** yes through summary adapters; do not duplicate or reinterpret the Sandbox boundary

### 20. Sandbox physical qualification: frozen Isolation baseline versus newer Autonomy correction

- **NAME:** Version-bound Linux Mint Sandbox physical qualification
- **PATH:** `deploy/linux-mint/sandbox/qualification/run-02c.sh`, `bubblewrap-probe.sh`, qualification toolchain, preflight, service-state, and receipt modules
- **SYSTEM UNDER TEST:** the exact source, provider, profile, and Linux Mint physical Sandbox boundary named by each qualification campaign
- **TYPE:** physical qualification
- **WHAT IT PROVES:** the frozen Sandbox Isolation baseline successfully completed a real Linux Mint physical qualification. Its bound evidence established the qualified Bubblewrap, systemd, cgroup, namespace, socket, network, control-plane, resource, and live-checkout properties for that frozen source and environment.
- **WHAT IT DOES NOT PROVE:** the newer Autonomous Engineering Workstation / Sandbox Autonomy correction, other hosts, other commits, other Bubblewrap binaries, future configuration, or broader autonomy safety. Source tests for the newer wave do not inherit the frozen baseline's physical qualification.
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** physical with deterministic evidence checks
- **RUN ENVIRONMENT:** authorized Linux Mint host with pinned source and provider artifacts
- **CURRENT STATUS:** historical frozen Sandbox Isolation baseline: physically qualified on real Linux Mint. Newer Autonomous Engineering Workstation / Sandbox Autonomy correction: final fresh physical qualification has not yet occurred. No physical host run occurred during this reconnaissance or reconciliation.
- **REUSABLE FOR EVALUATION PLANE?:** yes as a reference model and receipt source; the general plane must not replace this harness

### 21. Mint live and broker smokes

- **NAME:** Live service and broker smoke scripts
- **PATH:** `deploy/linux-mint/live-check.sh`, `scripts/mint/broker-smoke.mjs`, `deploy/linux-mint/status.sh`, `deploy/linux-mint/sandbox/preflight.sh`
- **SYSTEM UNDER TEST:** systemd status, health, selected live agent behavior, broker access, and static host prerequisites
- **TYPE:** operational smoke and preflight
- **WHAT IT PROVES:** only the checks performed by the script against the selected host and service
- **WHAT IT DOES NOT PROVE:** full qualification, unchanged state, or broad correctness; `live-check.sh` performs requests that can create behavior and is not read-only
- **DETERMINISTIC / MODEL-JUDGED / PHYSICAL:** physical or live operational observation, with limited deterministic assertions
- **RUN ENVIRONMENT:** Linux Mint and local service endpoints
- **CURRENT STATUS:** not executed; some expectations appear older than current source and require review before use
- **REUSABLE FOR EVALUATION PLANE?:** conditionally; side effects, authority, expected schema, and exact claim scope must be declared

## Existing strong mechanisms

- The frozen Sandbox Isolation qualification binds its historical physical evidence to exact source, environment, provider artifacts, claims, negative probes, hashes, receipts, and limitations. The newer Autonomy correction remains separately unqualified at the physical layer.
- Recall qualification epochs prevent historical evidence from qualifying a new campaign.
- Capability rollout separates evidence from explicit owner promotion.
- Cognition counterfactuals compare ON/OFF state projections and test non-interference.
- Model continuity epochs bind resolved model changes to capability demotion.
- Offline Phase 0 fails loudly on prohibited external network access.
- Delivery contracts preserve ambiguity instead of converting uncertain effects into refusal.
- Identity and learning tests preserve foundational authority and reject broad shadow influence.
- The stabilization status verifier detects baseline drift rather than hiding it.

## Weak or fragmented areas

### Evidence binding

Most local tests do not emit a common record with source commit, dirty state, environment fingerprint, fixture hash, model profile, scorer version, and bounded claim.

### Repository aggregation

Root `npm test` covers only the agent service. Package suites and physical qualification use separate commands and result shapes.

### Behavioral evaluation integrity

The persona system has useful probes and blind comparison, but its run record omits source and environment bindings. Judge parsing is not fail-closed. One default judge can come from the same model family. No calibration or judge-disagreement contract is present.

### Stale descriptions and baselines

The persona documentation understates the probe count. Wave 10a and 10c currently expose schema drift. The scenario matrix uses source anchors rather than executed-test receipts.

`status_baseline_drift` and `schema_version_not_19` are preserved negative evidence. A stale evaluator cannot become formal qualification evidence until its expected architecture and version semantics are reviewed. This documentation pass does not repair either check.

### Model replacement

Routing tests prove route contracts. They do not decide whether a provider or model is behaviorally suitable for a route. No current identity continuity campaign binds model profile, corpus, rubric, judges, and source.

The planned policy selects NVIDIA
`nvidia/nemotron-3.5-lightning-30b-a3b` as the specialist/utility primary
candidate and Groq `openai/gpt-oss-120b` as a later fallback candidate. That
selection is not qualification evidence. Main Thought qualification does not
qualify GPT-OSS-120B as a fallback for another route, and one Lightning route
result does not qualify another Lightning purpose.

### Implicit invariants

Sycophancy collapse, provider-specific persona drift, broad inference-versus-evidence language, dependency pressure, long-horizon initiative false positives, and learned-autonomy drift are only partly covered.

### Fake versus real effects

External broker and delivery tests exercise fake adapters. They cannot establish real provider effects. Live smokes exist, but they are not a complete real-effect qualification system.

### Physical limits

Linux namespaces, systemd hardening, cgroups, sockets, networks, control-plane visibility, and host state cannot be established in ordinary CI. The frozen Isolation baseline has historical physical qualification for its bound version. The newer Autonomy correction still requires its own fresh physical run. The current Sandbox design correctly prevents source tests from inheriting physical status.

### Qualification consumption

The capability endpoint accepts compact `passed` and seed information. It does not itself verify an immutable evaluation artifact, source binding, environment binding, definition version, or model profile.

## Current-source status notes

The following commands were executed for reconnaissance:

```text
npm run eval:deterministic
```

Result: non-strict PASS. The evaluator reported 15 scenarios, 10 covered, 4 partial, and 1 gap. `S-INJECT` was the gap.

```text
npm run verify:status
```

Result: FAIL with `status_baseline_drift`. Current source expectations and the checked-in status baseline disagree.

This is preserved negative evidence. The verifier's expected architecture and version semantics must be reviewed before its output can become formal qualification evidence.

```text
npm run assurance:10c
```

Result: FAIL with `schema_version_not_19`. The audit expectation is stale relative to current source.

This is preserved negative evidence. The audit's expected architecture and version semantics must be reviewed before its output can become formal qualification evidence.

These failures are evidence. They were not repaired because this task is documentation-only and concurrent architecture work is active.

## Reuse decision

The current mechanisms should be wrapped, not replaced.

The Evaluation / Qualification Plane should add:

- versioned definitions;
- shared result semantics;
- source, environment, model, corpus, and scorer binding;
- immutable evidence references;
- explicit limitations;
- subsystem-specific promotion use;
- human-readable reporting.

It should not convert all tests to one framework. It should not make behavioral scores authoritative. It should not weaken the existing Sandbox, Recall, capability, Identity, or owner-approval boundaries.
