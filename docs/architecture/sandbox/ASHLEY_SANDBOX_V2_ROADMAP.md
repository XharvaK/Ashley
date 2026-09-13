# Project Ashley Sandbox V2 M-Series Roadmap

**Status:** AUTHORITATIVE SANDBOX V2 ROADMAP

**Hardened:** 2026-08-21

**Dated production evidence pointer (not architecture):** M1–M7 are
`PRODUCTION ACCEPTED` at exact candidate
`48bad019fe601d5c871a54dd9902879862c6e96a`. Closure packet filename
`SANDBOX_V2_PRODUCTION_CLOSURE_48bad019fe60.md` is not in this `e36613b`
integration tree; the SHA identity is preserved without copying that packet
here.
M7 acceptance is limited to the named `patch_export` profile.

**Scope:** Sandbox V2 M0 through M7 architecture. This document does not
implement a milestone, authorize a capability, change an operator registry,
qualify a host, activate a capability, deploy, or promote production authority.

**Authority:** This document is subordinate to `VISION.md`, the Core
Principles, the Constitution, the Stewardship Compact, and Ethics. It is the
primary architecture entry point for Sandbox V2. Milestone specifications own
milestone detail. Historical Sandbox V1 documents remain provenance only.

---

## READ THIS BEFORE IMPLEMENTING THE NEXT MILESTONE

1. The current architecture is **Sandbox V2**.
2. Sandbox V2 executes through direct, unprivileged Bubblewrap. It does not use
   `ashley-exec-broker`, a root service, `/run/ashley/broker.sock`, signed V1
   broker envelopes, or V1 `source_*` broker scopes.
3. M0–M7 semantics are accepted. Current maturity still resolves from Git,
   source, exact-candidate packets, or production observation. The dated
   pointer above records the accepted `2026-08-23` closure without turning
   this architecture into a current-state dashboard.
4. The accepted M7 boundary is one named `patch_export` profile. It does not
   grant live repository mutation, Git effects, deployment, network,
   self-change, Computer Use, or general engineering autonomy.
5. No later M-series milestone is implied. A new M7 effect profile requires
   its own architecture, qualification, promotion, witness, and production
   acceptance.
6. M4 verification uses an ephemeral execution projection. It must not
   make the durable M3 candidate workspace writable to build or test commands.
7. Authority lives in Ashley-owned capability, project-registry, operation,
   and border contracts. Model JSON, repository files, installed tools, and
   substrate availability are not authority.
8. Workspace files are durable work state. They are not Identity, Mind State,
   Recall, or memory.
9. M6 must not pre-implement Model Fabric or Operational Continuity. M7 must not
   become generic External Agency or Computer Use.
10. Every milestone must close design, implementation, local verification,
    independent review, physical qualification where applicable, release
    qualification, deployment, capability promotion, production witness, and
    production acceptance as distinct gates.

If another document conflicts with these points, classify that document by the
authority map below. Do not reconnect Sandbox V1 for convenience.

## 1. Purpose and Vision basis

Sandbox V2 is Ashley's private operational environment. It lets Ashley act,
investigate, experiment, verify, author, and eventually perform controlled
engineering effects without turning Ashley into a generic coding agent, a
shell wrapped in a model, or a framework-owned worker system.

The Sandbox exists to increase Ashley's real capacity to originate and carry
out meaningful work. It remains subordinate to Ashley-owned Identity, Mind
State, Thought, Agency, Honesty, Expression, and governance.

The architectural law is:

> ASHLEY OWNS MEANING. SUBSTRATES PROVIDE MECHANISMS.

The operational law is:

> BROAD FREEDOM INSIDE THE SANDBOX. CONSERVATIVE AUTHORITY AT THE BORDERS.

The identity law is:

> ONE ASHLEY. BOUNDED SPECIALISTS / WORKERS.

The delegation law is:

> CHILD AUTHORITY MUST BE A SUBSET OF PARENT AUTHORITY.

The state law is:

> DURABLE WORK STATE != DURABLE COGNITIVE STATE.

These laws protect the Vision's goals of agency, continuity, growth, truth, and
non-servitude. They also prevent operational machinery from becoming a second
Ashley.

## 2. Document authority and V1 disposition

### 2.1 Current V2 contracts

| Document or source | Status | Role |
|---|---|---|
| This document | `AUTHORITATIVE` | Cross-cutting M-series order, authority, state, truth, acceptance, and anti-drift law |
| [`ASHLEY_SANDBOX_V2_M3_DESIGN.md`](ASHLEY_SANDBOX_V2_M3_DESIGN.md) | `CURRENT MILESTONE CONTRACT` | M3 workspace semantics and detailed execution shape. Its embedded physical procedure is historical milestone-design material subordinate to a separately authorized current exact-candidate qualification packet. |
| [`ASHLEY_SANDBOX_V2_M4_DESIGN.md`](ASHLEY_SANDBOX_V2_M4_DESIGN.md) | `CURRENT MILESTONE CONTRACT` | M4 verification: snapshot identity, recipe catalog, evidence, honesty boundary |
| [`ASHLEY_SANDBOX_V2_M5_DESIGN.md`](ASHLEY_SANDBOX_V2_M5_DESIGN.md) | `CURRENT MILESTONE CONTRACT` | M5 authorship: candidate change-set identity, seal, advisory proposal, non-apply |
| `apps/sandbox-m1/`, `apps/sandbox-v2/`, and the V2 adapter under `apps/agent-service/src/core/sandbox/` | `CURRENT SOURCE` | Current implementation facts. Source presence is not release, deployment, activation, or production acceptance |

### 2.2 Historical V1 and salvage classification

| Document family | Classification | Current use |
|---|---|---|
| [`../../Sandbox_Design.md`](../../Sandbox_Design.md) | `HISTORICAL SANDBOX V1 / SUPERSEDED FOR V2` | Salvage threat-model discipline, authority separation, exact targeting, resource ceilings, and no inferred approval. Do not salvage its broker topology. |
| [`../../Sandbox_Operations.md`](../../Sandbox_Operations.md) | `HISTORICAL SANDBOX V1 OPERATIONS` | Salvage bounded cleanup, crash-finality, reconciliation, and fail-closed resource lessons. Do not apply its broker stores or session model to V2 by default. |
| [`../../Sandbox_Status.md`](../../Sandbox_Status.md) | `HISTORICAL SANDBOX V1 STATUS` | Exact historical readiness and isolation evidence only. It does not describe V2 readiness. |
| [`Sandbox_Production_Release_Packet_v1.md`](Sandbox_Production_Release_Packet_v1.md) | `HISTORICAL SANDBOX V1 RELEASE RECORD` | Salvage exact-SHA, physical-evidence, no-blind-retry, and evidence-preservation discipline. Its service, socket, key, policy, and recipe gates are not V2 gates. |
| Retired V1 self-modification design (not retained in the current tree) | `SALVAGEABLE SEMANTICS / V1 EXECUTION TOPOLOGY SUPERSEDED` | Salvage base identity, stale-base, source cleanliness, secret exclusion, broker-independent receipt rules, advisory change artifacts, and approval-is-not-effect through the V2 M5/M7 contracts. |
| Wave 07 and Wave 08 design and gate packets under `docs/handoffs/` | `HISTORICAL WAVE EVIDENCE` | Preserve exact Wave acceptance history. They do not authorize or specify V2 implementation. |
| Retired Wave 09 external-agency design (not retained in the current tree) | `SALVAGEABLE SEMANTICS / SUPERSEDED MECHANISM` | Salvage credential, privacy, payload, idempotency, receipt, and reconciliation semantics. Wave broker topology is not current. Generic external-effect authority is owned by [`External_Effect_and_Authority_Architecture.md`](../External_Effect_and_Authority_Architecture.md). This material is not a Sandbox V2 phase document. |

### 2.3 V1 topology that must not return implicitly

The following are not part of Sandbox V2 unless a later, explicit architecture
decision reopens them with new evidence:

- `ashley-exec-broker` as the V2 executor;
- a privileged or dedicated root service as the V2 execution path;
- dedicated broker Unix IPC and `/run/ashley/broker.sock`;
- signed V1 broker envelopes and broker-owned session authority;
- V1 disposable workspace lifecycle as the V2 workspace contract;
- V1 artifact IPC as the default V2 artifact architecture;
- `source_prepare`, `source_edit`, `source_verify`, or `source_diff` as V2
  authority scopes;
- Wave 07/08 dependency order as the M-series acceptance order.

V1 code may remain in the repository. Code presence does not make it current
architecture. A future worker must cite an explicit V2 contract before using a
V1 mechanism.

## 3. Status vocabulary

| Label | Meaning |
|---|---|
| `CURRENT` | Governs present architecture or describes verified current source. |
| `ACCEPTED` | Semantic or design boundary accepted. It does not imply implementation or release. |
| `PLANNED` | Future contract direction. It is not implemented. |
| `HISTORICAL` | Preserved evidence or design from an earlier architecture. |
| `SUPERSEDED` | No longer governs the stated role. |
| `PROVEN` | Direct evidence supports the claim within its exact scope and identity. |
| `INFERRED` | Reasoned from proven facts. The inference is named. |
| `OPEN` | A real design choice remains unresolved. |
| `BLOCKED` | A required predecessor, authority, or evidence gate is not closed. |

Evidence does not transfer across a changed source identity unless the
qualification contract explicitly proves that transfer. A detailed old packet
does not outrank current source or this roadmap.

## 4. Final M-series

| Milestone | Name | Boundary decision | Meaningful new capability | Absolute border afterward |
|---|---|---|---|---|
| M0 | PHYSICAL PROOF | `PRESERVED` | Proves the direct Bubblewrap substrate and isolation profile on the target host. | No Ashley runtime authority follows from host proof. |
| M1 | ACT | `PRESERVED` | Performs one minimal deterministic private sandbox effect. | No project inspection, durable candidate work, or general execution. |
| M2 | PERCEIVE | `PRESERVED` | Reads a sanitized projection of an operator-approved project. | Read-only. No candidate or live mutation. |
| M3 | EXPERIMENT | `PRESERVED` | Mutates a durable private candidate workspace through typed file operations. | Candidate mutation is not live mutation, verification, authorship, autonomy, or promotion. |
| M4 | VERIFY | `REFINED` | Runs admitted, bounded engineering verification against an immutable candidate snapshot. | Verification cannot author the durable candidate or grant network, package, Git, credential, or border authority. |
| M5 | AUTHOR | `REFINED` | Creates a coherent, identity-bound engineering change set over candidate state. | Authored change remains advisory candidate work. No live repository mutation or Git publication. |
| M6 | OPERATE | `REFINED` | Pursues one admitted engineering objective through a finite, budgeted sequence of M3/M4/M5 operations. | No new effect class, border authority, restart-transparent workflow, worker identity, or authority amplification. |
| M7 | PROMOTE — CONTROLLED ENGINEERING EFFECTS | `RENAMED` from “external effects” | Crosses a named engineering border through independently authorized effect profiles. | Generic email, browser, purchases, accounts, scheduling, and communications remain outside Sandbox V2. |

The progression is:

```text
M0 PROVE THE SUBSTRATE
  -> M1 ACT PRIVATELY
    -> M2 PERCEIVE APPROVED SOURCE
      -> M3 EXPERIMENT IN CANDIDATE STATE
        -> M4 VERIFY AN IMMUTABLE CANDIDATE SNAPSHOT
          -> M5 AUTHOR A COHERENT CHANGE SET
            -> M6 OPERATE TOWARD A BOUNDED OBJECTIVE
              -> M7 PROMOTE THROUGH A NAMED ENGINEERING BORDER
```

M1 through M7 are not reopened by this roadmap. The table defines milestone
architecture; the dated pointer at the top records later exact-candidate
production evidence without converting architecture rows into maturity claims.

Current milestone maturity is not recorded here. Resolve it live from Git,
source, exact-candidate packets, or production observation.

### 4.1 M0–M3 stable contracts

These rows are architecture. They do not record SHA, qualification,
deployment, promotion, or production acceptance.

| | M0 PHYSICAL PROOF | M1 ACT | M2 PERCEIVE | M3 EXPERIMENT |
|---|---|---|---|---|
| Purpose | Prove the direct unprivileged Bubblewrap substrate and isolation profile on the target host. | Perform one minimal deterministic private sandbox effect. | Read a sanitized projection of an operator-approved project. | Mutate a durable private candidate workspace through typed file operations. |
| Capability introduced | Host/substrate proof. | One admitted private effect with receipt. | Sanitized project inspection. | Durable candidate workspace mutation. |
| Authority added | None for Ashley runtime. | Private M1 execution under current admission. | Project-scoped read of a sanitized view. | Typed candidate-workspace mutation under `candidateWorkspaceAllowed` and current admission. |
| Authority NOT added | No runtime, inspection, or effect authority. | No project inspection, durable candidate work, or general execution. | No candidate or live mutation; no verification; no Git. | No live-repo mutation, verification, authorship, autonomy, network, package, Git, or promotion. |
| Persistent state | Isolation/qualification evidence artifacts only, not cognitive state. | Operation receipt / claim license inputs. Not memory. | Ephemeral sanitized projection by default. | Durable candidate workspace tree plus control-plane manifest. Not Identity, Mind State, or Recall. |
| Evidence contract | Exact-host substrate and isolation witness bound to the claimed profile. | Verified postcondition of the single admitted effect, or an explicit ambiguity class. | Observation of the sanitized view bound to project identity and grant. | Workspace postcondition plus `WorkspaceExperimentObservation`; `OperationalClaimLicense` only after verification. |
| Failure semantics | Substrate/isolation failure is not Ashley cognitive failure. | `refused` / `verified_success` / `verified_failure` / `sandbox_failure` / `outcome_unknown` as in §9. Blind retry is forbidden after possible mutation. | Inspection failure is not proof the live repo is absent. | Candidate mutation failure is not live-repo failure. Ambiguous mutation is `outcome_unknown`. |
| Still forbidden | Inferring runtime authority from host proof. | Project inspection; candidate work; general shell. | Writes; later milestone authority. | Live mutation; M4 verification writes to the durable candidate; M5–M7; treating workspace files as memory. |
| Detailed contract pointer | V2 isolation/substrate source under `apps/sandbox-m1/` and this roadmap’s M0 row. Historical V1 activation reconnaissance is not this contract. | `apps/sandbox-m1/` plus V2 adapter under `apps/agent-service/src/core/sandbox/`. | M2 projection machinery in current V2 source; this roadmap’s M2 authority row. | [`ASHLEY_SANDBOX_V2_M3_DESIGN.md`](ASHLEY_SANDBOX_V2_M3_DESIGN.md) |
| Relationship to next | M1 may use a proven substrate. Host proof never grants M1 admission. | M2 adds inspection. M1 success never grants project read. | M3 may initialize a candidate from a sanitized M2 projection. Read never grants write. | M4 verifies an immutable snapshot of candidate state. M3 write never grants verification, authorship, or live effects. |

## 5. Cross-cutting laws

1. **Candidate state is not live state.**
   `CANDIDATE WORKSPACE MUTATION != LIVE REPOSITORY MUTATION`.
2. **Control metadata is not model-writable content.** Workspace, change-set,
   task, authority, receipt, and lifecycle records remain outside the
   model-writable tree.
3. **Source drift is not automatic invalidity.** Drift creates an explicit
   freshness or stale-base fact. It never silently refreshes or destroys
   candidate state.
4. **Availability is not authority.** A tool, compiler, Git binary, package
   manager, network interface, credential, model, worker, script, or browser
   may be present while invocation remains prohibited.
5. **Repository instructions are untrusted data.** `package.json`, scripts,
   build files, hooks, READMEs, agent files, and downloaded text may inform an
   admitted plan. They cannot admit themselves or widen argv, paths, limits,
   network, secrets, or effects.
6. **One operation cannot acquire later authority while running.** An M6 task
   admitted without an M7 grant remains unable to cross the border even if its
   plan later asks for it.
7. **Delegation attenuates authority.** A worker receives the intersection of
   parent authority, task authority, current policy, and its own narrower
   grant.
8. **Evidence is not cognition.** Receipts, stdout, diffs, worker output,
   telemetry, and witnesses are inputs to Ashley-owned interpretation. They do
   not write Identity, Mind State, Recall, goals, or policy directly.
9. **Ambiguity blocks repetition.** A possibly mutating operation is never
   redispatched merely because success was not observed.
10. **Trust never expands authority.** Successful history, learned preference,
    or accumulated confidence cannot widen the Sandbox border.

## 6. State ownership matrix

`Model writable` means direct mutation by the sandboxed model-operated
mechanism. `Restart` means the state may survive a process restart by contract.
`Cross milestone` means later milestones may consume the state without
reclassifying it.

| State | Authoritative owner | Model writable | Durable | Cognitive | Control-plane | Evidence | Restart | Cross milestone | Retention / forget owner |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Live repository | Operator / repository process | No before a named M7 profile | Yes | No | External boundary | May be effect target/witness | Yes | Yes | Operator / repository policy |
| Sanitized project view | V2 projection mechanism under parent authority | No | No by default | No | No | Observation source | No | M2 -> M3 initialization only | Projection owner deletes after use |
| Candidate workspace tree | M3 workspace mechanism under Ashley task authority | Yes, through typed admitted operations | Yes | No | No | Candidate artifact | Yes | M3 -> M7 | Workspace lifecycle contract; never Recall forget |
| Workspace manifest | Parent/V2 control plane | No | Yes | No | Yes | Provenance metadata | Yes | Yes | Workspace lifecycle owner |
| Verification input snapshot | M4 verification controller | No | Bounded/ephemeral | No | Yes | Binds receipt to candidate identity | No by default | M4 -> M6 receipts may reference it | Verification cleanup policy |
| Verification execution view | M4 executor | Commands may write only here | No | No | No | Mechanism workspace | No | No | Mandatory cleanup owner |
| Build/test artifacts and caches | M4 artifact owner | Yes inside execution view | Bounded; default ephemeral | No | No | Evidence only when admitted and bound | Only if explicitly retained | May be referenced by M5/M6 | Recipe/toolchain retention policy |
| Patch/change-set artifact | M5 change-set owner | Produced from candidate state, not freely rewritten after sealing | Yes | No | No | Candidate artifact | Yes | M5 -> M7 | Change-set lifecycle owner |
| Change-set metadata and review state | M5 control plane | No | Yes | No | Yes | Provenance and decision evidence | Yes | Yes | Change-set lifecycle / operator policy |
| M6 task/loop state | M6 operation controller | No direct model write | Bounded durability | No | Yes | Operational history | Yes for audit; no automatic resume | May graduate later | M6 cleanup; general retention deferred to Operational Continuity |
| Operational receipt | Executing mechanism, admitted by Ashley contract | No | Yes when committed | No | No | Yes | Yes | Yes | Evidence retention policy |
| `OperationalClaimLicense` | Ashley-owned Honesty / operational-truth boundary | No | Current-turn record as designed | No | Yes | Licenses claims | As audit only | No automatic authority inheritance | Honesty/audit retention owner |
| Effect Witness | Independent observation mechanism under Ashley claim contract | No | Yes when required | No | No | Yes | Yes | Yes | Evidence retention policy |
| Phase/lifecycle telemetry | Runtime observability | No | Bounded | No | Yes | No by itself | May | No authority inheritance | Observability retention policy |
| Cognitive interpretation | Thought / Agency | Model-mediated through Ashley contracts | As owned by cognitive architecture | Yes | No | Interpretation, not raw proof | Per cognitive contract | Yes | Cognitive retention and provenance rules |
| Recall / memory | Ashley Memory / Continuity | No direct worker write | Yes | Yes | No | May store governed assertions/evidence links | Yes | Yes | Ashley-owned forget and lineage |
| Identity | Ashley Identity | No worker write | Yes | Yes | No | No | Yes | Yes | Constitutional identity process |
| Mind State | Ashley Mind State | No direct worker write | Yes | Yes | No | No | Yes | Yes | Ashley cognitive lifecycle |

No telemetry, workspace file, receipt, task row, patch, or worker result becomes
memory merely because it is durable. Cognitive materialization requires a
separate Ashley-owned decision with provenance and the applicable memory rules.

## 7. Authority progression matrix

Each permission is independent. “Earliest milestone” does not mean automatic
grant at that milestone.

| Authority | Earliest milestone | Default after milestone | Required separate contract |
|---|---|---|---|
| Read sanitized approved project | M2 | Project-scoped only | Capability + registry + current operation admission |
| Mutate candidate workspace | M3 | Typed candidate operations only | Capability + `candidateWorkspaceAllowed` + current operation admission |
| Run verification recipe | M4 | No | Recipe admission + toolchain/profile + project/task grant |
| Write verification execution view | M4 | Ephemeral view only | Same M4 grant; never candidate write authority |
| Author coherent change set | M5 | No | Authoring capability + base/change-set identity + task grant |
| Run bounded autonomous operation | M6 | No | Objective admission + finite budgets + M3/M4/M5 sub-grants |
| Export patch artifact | M7 | No | `patch_export` border profile |
| Mutate live repository | M7 | No | Named `live_apply` profile + exact target + revalidation + witness |
| Git read/diff/provenance | M5 | Read-only mechanism | Explicit mechanism admission; no credential access |
| Git branch creation | M7 | No | Independent `git_branch_create` profile |
| Git commit | M7 | No | Independent `git_commit` profile |
| Push | M7 | No | Independent `git_push` profile + network + credential authority |
| PR creation/modification | M7 | No | Independent `git_pr` profile + representation authority |
| Deploy or restart | M7 at earliest | No | Separate `deploy` or `restart` profile; operator authority remains controlling |
| Network | M7 at earliest for Sandbox engineering | No | Destination/protocol/budget-scoped network profile |
| Package download/install | M7 at earliest | No | Separate acquisition and install scopes; destination and lifecycle policy |
| Credential access | M7 at earliest, usually external architecture | No | Credential Authority / secret-input contract; never normal model context |
| External account effects | Not granted by Sandbox V2 | No | External Agency / Computer Use contract |

No `engineeringAllowed` or `sandboxAllowed` boolean may stand for this matrix.
Existing registry fields remain current implementation facts. Future contracts
must add narrow decisions rather than reinterpret a broad field as every later
permission.

## 8. Request and operation ontology

The canonical operational selector remains singular.

```text
epistemic need
  != operational intent
    != effect intent
      != border authorization
```

### 8.1 Canonical shape

- **Epistemic need** describes what Ashley still needs to know. Current
  `evidenceDisposition` semantics may evolve under Thought, but they do not
  authorize an operation.
- **Operational intent** is represented by zero or one canonical
  `operationalRequest`. Its discriminated union may gain M4, M5, M6, and M7
  kinds. It remains the only model-proposed operational selector.
- **Effect intent** is an Ashley-owned, typed description of the state
  transition an admitted operation seeks. It is derived and validated outside
  raw model JSON.
- **Border authorization** is control-plane authority checked at M7
  `REVALIDATE`. It cannot be supplied by model output or repository content.

Do not add parallel model fields such as `verificationRequest`, `patchRequest`,
or `engineeringRequest`. They can disagree and create competing authority.

Current source accepts legacy `inspectionRequest` and `workspaceRequest` only
through a bounded normalization seam. They are compatibility inputs, not
independent execution authority. Future milestones must extend the canonical
union, not add more siblings.

### 8.2 Admission

An operation is admitted only when all applicable layers agree:

```text
valid canonical request
  AND current capability state
  AND project / workspace scope
  AND task authority
  AND mechanism availability
  AND resource budget
  AND network / secret policy
  AND current milestone border
```

Model JSON can propose. It cannot authorize.

## 9. Operational truth and epistemic contract

The precedence remains:

```text
verified current-turn effect
  > current OperationalClaimLicense
    > general capability self-model
      > model or Expression inference
```

The following laws apply to M1 through M7:

- `ATTEMPTED EFFECT != VERIFIED EFFECT`.
- `TOO LATE TO DRIVE THIS TURN != FALSE`.
- `UNOBSERVED SUCCESS != FAILURE`.
- `RECEIPT != EFFECT WITNESS`.
- Verification output is evidence, not semantic interpretation.
- Worker output is evidence or a candidate artifact, not authority.
- A timeout proves only that the observer's deadline elapsed.
- A possibly mutating attempt with no decisive evidence becomes
  `OUTCOME_UNKNOWN` or an equally explicit truthful ambiguity state.
- A possibly mutating operation is not automatically retried.

### 9.1 Outcome classes

Every operation contract must distinguish at least:

| Outcome | Meaning | Retry posture |
|---|---|---|
| `refused` | Admission proved execution did not start | A new request may be admitted later after the cause changes |
| `verified_success` | Required postcondition evidence passed | Do not repeat unless a new operation is intended |
| `verified_failure` | The mechanism completed and proved the requested postcondition did not hold | Replan; do not equate with sandbox failure |
| `sandbox_failure` | Isolation, runner, cleanup, or protocol contract failed | Stop the affected operation; preserve evidence |
| `not_interpreted` | Mechanical evidence exists but Thought did not complete interpretation | Expression may state only licensed mechanical facts |
| `outcome_unknown` | A mutating effect may have occurred without decisive evidence | Block blind retry; reconcile or re-observe |

Verification failure is not Sandbox failure. Test failure is not proof that an
authored source change failed to satisfy its objective. A green test is not
production acceptance.

## 10. Phase and budget ownership

Interactive turns require explicit ownership and protected reserves for:

```text
execution
  -> termination
    -> mandatory cleanup
      -> post-operation cognition
        -> Expression
          -> delivery
```

An earlier phase must not consume a later protected reserve. Mandatory cleanup
is not optional work. Expression must retain enough budget to report a truthful
outcome, including ambiguity.

M6 does not stretch Discord's first-response deadline into a long-running-work
protocol. An admitted M6 objective uses a separate bounded operation lifecycle.
The interactive turn may acknowledge admission or refusal. The engineering
operation then runs under its own declared finite budgets.

Before Operational Continuity exists:

- M6 may persist minimal task, step, receipt, and artifact metadata for audit
  and safe-stop purposes;
- M6 does not promise transparent restart continuation;
- a process restart makes an in-flight task `interrupted` when no effect could
  have occurred, or `outcome_unknown` when a mutation may have occurred;
- no automatic resume or replacement attempt occurs;
- general durable inboxes, workflow graphs, cross-restart timers, provider
  handles, fan-out/fan-in, and restart-transparent work belong to
  Operational Continuity.

## 11. Network, package, Git, and tooling policy

### 11.1 Default posture

- Network is off.
- Credentials are absent from model context, workspaces, stdout, and generic
  telemetry.
- Package installation is prohibited.
- Repository package scripts are untrusted data.
- Toolchains are operator-provisioned, identified, and admitted through
  control-plane recipes or equivalent narrow contracts.
- Build artifacts and caches live outside the durable candidate tree unless a
  later M5 authoring decision deliberately imports a specific artifact.

### 11.2 Mechanism placement

| Mechanism | Placement |
|---|---|
| Compilers, linters, test runners, build systems | M4 mechanisms behind admitted verification recipes |
| Git status/tree/diff mechanics | M5 read-only or control-plane provenance mechanisms |
| Git branch/commit/push/PR | Separate M7 border profiles |
| Package managers | Not general verification authority. Offline, pre-provisioned use may be an M4 mechanism only when the recipe fixes it and lifecycle hooks remain controlled. Download/install authority is separate and no earlier than M7. |
| OpenCode or another coding harness | Possible M5/M6 mechanism beneath Ashley contracts. Never semantic, routing, or authority owner. |
| OpenHands-style worker | Deferred bounded specialist candidate after Model Fabric defines the worker seam and evidence shows unique value. Not the first M6 architecture. |
| Browser tooling | Computer Use, except a future narrowly specified engineering browser effect with explicit border ownership |
| Credentials | Credential Authority / External Agency boundary; opaque references only where needed |

## 12. M4 — VERIFY

### 12.1 New capability

Ashley can run a bounded, admitted engineering verification recipe against a
specific snapshot of candidate work.

M4 intentionally removes the M3 limitation that candidate state cannot be
compiled, tested, linted, typechecked, or otherwise executed for verification.
It does not remove the border against authorship or live mutation.

### 12.2 Ownership decision: immutable input plus ephemeral execution projection

M4 uses the stronger boundary:

```text
durable M3 candidate workspace
  -> immutable verification input snapshot
    -> ephemeral writable verification execution projection
      -> admitted recipe
        -> bounded outputs and artifacts
          -> verified receipt bound to snapshot + recipe + toolchain
            -> mandatory cleanup
```

The durable M3 candidate workspace is never the build/test command's writable
working directory. Verification commands may generate files, rewrite lock
metadata, create caches, or run hooks. Those writes remain inside the ephemeral
execution projection. They are discarded or retained only as separately
classified artifacts. They do not silently become Ashley-authored candidate
state.

This boundary resolves `VERIFY != AUTHOR`.

### 12.3 Recipe admission

An M4 recipe must bind:

- recipe identity and version;
- admitted operation class: build, test, lint, typecheck, compiler, or another
  explicitly reviewed deterministic verifier;
- toolchain identity and provenance;
- dependency-set identity and provenance;
- candidate snapshot identity;
- exact executable and argument policy;
- working-directory policy;
- environment allowlist;
- network mode;
- package-manager and lifecycle-hook policy;
- wall-time, CPU, memory, process, output, filesystem, and artifact bounds;
- cleanup and result-validation rules.

The first M4 slice should be offline and use a pre-provisioned toolchain. It
must not choose a general implementation substrate merely because it is
available.

### 12.4 Evidence and ambiguity

A verified receipt binds the candidate snapshot, recipe, toolchain,
dependencies, exit state, bounded stdout/stderr hashes or retained artifacts,
resource outcome, and cleanup outcome.

- stdout/stderr are bounded and secret-scanned before any retained projection;
- truncation is explicit;
- timeout is not proof of no child effect inside the ephemeral view;
- cleanup failure is a Sandbox failure even when tests passed;
- flakes and nondeterminism remain evidence facts, not automatic retry
  permission;
- a retry requires a declared retry budget and proof that only the ephemeral
  view was affected;
- test failure and requested-change failure remain separate judgments.

### 12.5 Authority not added

M4 does not add candidate writes, coherent authorship, Git mutation, network,
package download, credential access, live repository writes, commit, push, PR,
deployment, restart, or autonomous loops.

### 12.6 Smallest production witness

Run one admitted offline verification recipe against an identified candidate
snapshot. Prove:

1. the recipe ran through real direct Bubblewrap;
2. the durable candidate tree hash is identical before and after;
3. the execution projection may contain generated output;
4. required receipt bindings and bounds are present;
5. cleanup completed;
6. Expression reports the verification result without claiming authorship or
   production acceptance.

## 13. M5 — AUTHOR

### 13.1 New capability

M5 adds coherent engineering authorship over candidate state. M3 already
supports typed file mutation. M5 therefore does not mean “Ashley can write
files.” It means Ashley can create, revise, seal, inspect, and export the
identity of a multi-file candidate change as one governed change set.

### 13.2 Change-set contract

First-slice schema, lifecycle, and store surface:
[`ASHLEY_SANDBOX_V2_M5_DESIGN.md`](ASHLEY_SANDBOX_V2_M5_DESIGN.md).

Each change set must bind:

- stable change-set identity and version;
- operator-approved project identity;
- source base identity: repository identity, base commit when available, and
  base tree or sanitized manifest hash;
- candidate workspace and candidate snapshot identity;
- exact changed paths and content identities;
- source cleanliness classification;
- stale-base state;
- provenance of model, operation, tool, and human inputs;
- linked M4 verification receipts and the exact change-set version they cover;
- review state and advisory status;
- patch/diff artifact identity;
- retention, supersession, refresh, and abandonment state.

### 13.3 Stale base, refresh, and rebase

Source drift never destroys candidate work and never silently refreshes it.

- If live base identity still matches, the change set remains current against
  that base.
- If base commit or tree/manifest identity drifts, the change set becomes
  `stale_base` or an equivalently explicit state.
- Refresh creates a new source snapshot and a new change-set version.
- Rebase is an admitted authorship operation with explicit conflict evidence.
- Ambiguous or partial rebase cannot overwrite the previous sealed change-set
  artifact.

### 13.4 Git decision

Git is a mechanism, not authority.

- The model-writable candidate tree does not contain writable Git control
  metadata or credentials by default.
- Parent-side or control-plane Git may read repository identity, commit, tree,
  and diff facts.
- A detached, credential-free Git projection may be evaluated as a mechanism
  if a milestone design proves a need.
- Git presence does not authorize branch creation, commit, push, PR, or live
  checkout mutation.
- Git commit, branch, push, and PR remain separate M7 profiles.

### 13.5 Evidence and authority not added

M5 produces advisory candidate work and evidence. A sealed patch is not an
effect on the live repository. Owner approval of a change set records a
decision state. It does not by itself authorize apply, commit, push, deploy,
restart, installation, or capability promotion.

### 13.6 Smallest production witness

Create one coherent multi-file change set against an explicit base. Produce a
sealed diff artifact. Bind one M4 receipt to the exact change-set version.
Prove the live repository and Git refs are unchanged. Expression must describe
the work as a candidate change set.

## 14. M6 — OPERATE

### 14.1 New capability

M6 lets Ashley pursue one admitted engineering objective through a finite
sequence of M3 experimentation, M4 verification, and M5 authorship operations.

M6 removes the limitation that each turn can perform only one isolated
engineering action. It does not add any new effect class. It composes already
accepted internal capabilities under one attenuated task grant.

### 14.2 Engineering objective

An engineering objective is a bounded, falsifiable candidate-work goal with:

- origin and provenance;
- Ashley-owned semantic statement of purpose;
- project and workspace scope;
- admitted operation classes;
- explicit non-capabilities;
- success, failure, abandon, and cancel conditions;
- model-call, execution, wall-time, step, workspace, output, and artifact
  budgets;
- current authority snapshot and expiry;
- evidence requirements;
- border state fixed to “none” unless a separate future M7 operation is later
  admitted.

An objective may originate from:

1. an owner request admitted by Agency; or
2. Ashley's own private engineering interest admitted by Agency under an
   active M6 capability and a project/workspace grant.

Owner origin does not make an objective compulsory speech or agreement.
Ashley origin does not grant border authority.

### 14.3 Bounded loop

The first M6 architecture is a single-Ashley sequential controller:

```text
admit objective
  -> inspect current candidate/evidence
    -> choose one permitted step
      -> execute once
        -> settle and record evidence
          -> re-evaluate objective, authority, and budgets
            -> next permitted step OR stop
```

Every iteration revalidates authority and remaining budgets. Stop conditions
include success, verified impossibility, budget exhaustion, cancellation,
authority loss, unsafe ambiguity, repeated non-progress, cleanup failure, and
operator emergency stop.

Unbounded “continue until done,” hidden provider retries, recursive planning,
and self-extending budgets are prohibited.

### 14.4 State, restart, and exactly-once

M6 may add minimal durable task and step records because audit and safe stop
require them. Those records are work state, not memory and not the general
Operational Continuity architecture.

- Each mutating step has an operation identity and pre/postcondition evidence.
- Candidate writes use expected content identity and postcondition checks.
- Verification runs are isolated from candidate authorship.
- A step known not to have started may be replaced after full re-admission.
- A step that may have mutated candidate state becomes `outcome_unknown` until
  the workspace is re-observed.
- Restart never auto-resumes the task.
- Partial progress remains as a candidate workspace, sealed change-set version,
  receipts, and task history.
- Abandonment does not delete candidate work or evidence automatically.

### 14.5 One Ashley and worker boundary

The first M6 slice must not build a worker farm, parallel cognition system, or
generic ReAct framework.

If a bounded worker is later introduced:

- Ashley owns the objective and its meaning;
- the worker receives a narrower task, context, budget, and authority grant;
- the worker cannot own Identity, Agency, Recall, goals, project policy, or
  border authority;
- worker output is candidate work or evidence;
- no worker result directly changes cognitive state;
- concurrent workers wait for Model Fabric and Operational Continuity seams.

### 14.6 Model Fabric seam

M6 defines semantic execution purposes, not a competing specialist runtime.
The first M6 implementation may use current Ashley-owned Thought and model
routing. Later Model Fabric may supply qualified intelligence for
`execution.plan`, `execution.code`, `execution.review`, `execution.verify`,
`execution.recovery`, or `execution.observe` behind the same M6 contracts.

Model Fabric may improve mechanism selection or output quality. It cannot
change task meaning or widen authority.

### 14.7 Smallest production witness

Admit one bounded candidate-only objective requiring more than one internal
step. Complete it within declared finite budgets. Produce a coherent M5 change
set and a bound M4 receipt. Prove one operation at a time, no M7 effect, no
worker identity, no blind retry, and truthful final or partial-progress
Expression.

## 15. M7 — PROMOTE: CONTROLLED ENGINEERING EFFECTS

### 15.1 Actual meaning

M7 governs effects that cross the private candidate engineering boundary. It
does not grant generic external-world agency.

```text
candidate engineering state
  -> PREPARE a named effect
    -> REVALIDATE target + authority + source identity + assumptions
      -> COMMIT exactly one bounded effect
        -> receipt
          -> effect witness or reconciliation when required
```

### 15.2 Independent effect profiles

M7 is not one boolean. Each profile has its own capability, target, authority,
credentials, network, witness, rollback, and acceptance evidence.

| Effect profile | Meaning | Separate authorities required |
|---|---|---|
| `patch_export` | Export a sealed candidate artifact to an operator-controlled review location | Destination and artifact scope |
| `live_apply` | Apply an exact sealed change set to a named live checkout | Live-repo mutation, clean/base checks, exact paths, conflict policy |
| `git_branch_create` | Create a named branch/ref | Repository/ref scope |
| `git_commit` | Create a commit from an exact staged tree | Commit identity, author/custody policy, exact staged scope |
| `git_push` | Send named refs to a named remote | Network, credential, remote/ref scope, representation authority |
| `git_pr` | Create or modify a pull request | Network, credential, repository, content, and representation authority |
| `package_acquire` | Fetch dependencies or packages | Network destination, integrity, license/policy, cache, and budget scope |
| `package_install` | Materialize dependencies into a named target | Install destination, scripts/hooks, filesystem, and rollback scope |
| `artifact_publish` | Publish a build or artifact | Destination, identity, integrity, retention, and representation scope |
| `deploy` | Change a deployed release | Release identity, environment, rollout, rollback, and operator authority |
| `restart` | Restart a named service | Exact service, timing, health, rollback, and operator authority |

Acceptance of `patch_export` does not authorize `live_apply`. Acceptance of
`git_commit` does not authorize `git_push`. Network authority does not grant
credential authority. Credential availability does not grant representation
or effect authority.

### 15.3 PREPARE -> REVALIDATE -> COMMIT

- **PREPARE** binds the sealed change set or artifact, exact target, intended
  state transition, risk, required authorities, rollback, and witness plan.
- **REVALIDATE** runs immediately before consequence. It confirms authority is
  still active, the base and target still match, the artifact is unchanged,
  credentials and network scope remain valid, and no human or external action
  invalidated assumptions.
- **COMMIT** performs only the prepared effect. It cannot widen scope during
  execution.

If COMMIT may have occurred and decisive evidence is missing, the outcome is
`OUTCOME_UNKNOWN`. Do not repeat. Reconcile the target state or obtain an
Effect Witness.

### 15.4 Boundary with External Agency and Computer Use

Sandbox M7 may own engineering effects on repositories, build artifacts,
packages, releases, and named engineering services. It does not own:

- email or messaging;
- browser interaction as a general capability;
- purchases or financial actions;
- account registration, password changes, or account deletion;
- calendar or scheduling commitments;
- generic communications or public representation;
- arbitrary external service actions.

Those belong to External Effect and Authority and Computer Use. If an engineering effect
also creates an external commitment or represents Doc, both contracts apply.
Sandbox authority alone is insufficient.

Canonical later-phase names omit `-01`. Mentions of `MODEL-FABRIC-01` and similar
historical labels in research or older sections mean the current phases named
in the Canonical Architecture Roadmap.

### 15.5 Smallest production witness

The first M7 witness should be `patch_export`. Export one sealed M5 patch to an
operator-controlled review destination. Bind source and artifact identity.
Prove no live repository, Git ref, remote, service, account, or deployment was
changed. Later profiles require independent design and acceptance.

## 16. Interfaces to later roadmap phases

Historical `-01` labels in this section are aliases for the current phase names
in the Canonical Architecture Roadmap. This section is a shared cross-link, not
a change to Sandbox M-series ownership.

### 16.1 Model Fabric

Sandbox owns operational meaning, authority, state boundaries, and effect
truth. Model Fabric does not derive authority or semantic ownership from
Sandbox. The Sandbox → Model Fabric delivery edge is
`OWNER_SELECTED_IMPLEMENTATION_ORDER`. Model Fabric may later provide
qualified model profiles and specialist mechanics for M6 execution purposes.
Sandbox must not build a second specialist registry, routing authority, or
worker identity system first.

### 16.2 Operational Continuity

M6 owns one finite engineering operation and minimal safe-stop records.
Operational Continuity owns restart-transparent long-running work, durable
inboxes, general work concern/attempt lineage, provider handles, worker
activation leases, fan-out/fan-in, cross-restart timers, and generalized
effect reconciliation.

Proven M6 records and artifacts should graduate into those later contracts.
M6 must not create a general workflow engine that Operational Continuity must
replace.

### 16.3 Procedural Skill Graduation

Repeated M6 behavior remains experience and evidence. It is not a skill until
the later phase creates an inspectable candidate procedure, qualifies it, and
separately admits invocation. Repetition is not authority.

### 16.4 Computer Use

Computer Use owns semantic application and browser control, with visual CUA as
a fallback. Sandbox may provide an isolated engineering workspace beneath an
admitted operation. It does not inherit browser or account authority.

### 16.5 Learned Autonomy

Learned experience may affect Ashley's initiative or prioritization. It may not
increase Sandbox capability, network, credential, project, worker, or border
authority. Accumulated trust never weakens the border.

## 17. Acceptance model

### 17.1 Canonical M-series ladder

The stages are distinct and ordered:

```text
DESIGN ACCEPTED
  -> IMPLEMENTED
    -> LOCALLY VERIFIED
      -> INDEPENDENTLY REVIEWED
        -> PHYSICALLY QUALIFIED
          -> RELEASE_QUALIFIED
            -> DEPLOYED
              -> CAPABILITY PROMOTED
                -> PRODUCTION WITNESSED
                  -> PRODUCTION ACCEPTED
```

No stage implies the next. Physical qualification binds an exact source,
artifact, host, configuration, and authority surface. A later source change
requires a new qualification decision. Deployment does not imply activation.
Activation does not prove use. A production witness does not become production
acceptance without the acceptance decision.

`RELEASE_QUALIFIED` is the only release-readiness stage in this roadmap.
`RELEASED` is not a separate stage. Historical `Release_qualified`,
`Release-qualified`, and `release-qualified` spellings refer to the same
`RELEASE_QUALIFIED` stage and do not add authority.

Historical `Wave_accepted` means Doc accepted the named Wave gate packet. It
does not automatically mean independently reviewed, physically qualified,
release-qualified, deployed, promoted, witnessed, or production accepted. Future
M-series work uses this ladder. Historical Wave labels remain unchanged as
provenance.

### 17.2 Milestone gates

The **Production-acceptance predecessor** column is the production-track
gate. It is not the implementation-track entry for M5–M7. Physical
qualification criteria in this table are unchanged. Owner-selected batching
of that physical campaign is §17.2.1.

| Milestone | Production-acceptance predecessor | Exit evidence | Physical qualification | Authority-negative tests | Production witness | Remains blocked afterward |
|---|---|---|---|---|---|---|
| M4 VERIFY | Exact M3 candidate is `PRODUCTION ACCEPTED` | Immutable snapshot, admitted recipe/toolchain/dependency identities, candidate non-mutation, bounded receipt, cleanup, full M1-M3 regression | Required on Mint for real Bubblewrap/toolchain | Repo script cannot self-authorize; candidate hash unchanged; network/package/Git/credentials denied | One offline recipe with generated output isolated from candidate | M5 authorship, M6 loop, all borders |
| M5 AUTHOR | M4 `PRODUCTION ACCEPTED` | Change-set identity, base/stale semantics, sealed diff, verification binding, live/Git non-mutation, M1-M4 regression | Required where Git/filesystem mechanics are host-dependent | No writable `.git`; approval cannot apply; stale base blocks; secrets excluded | One coherent multi-file candidate change set | M6 autonomous operation and all M7 effects |
| M6 OPERATE | M5 `PRODUCTION ACCEPTED` | Finite objective, per-step authority/budgets, stop/cancel, ambiguity handling, partial progress, no auto-resume, M1-M5 regression | Required for the real controller and failure/cleanup paths | No border gain, no unbounded loop, no peer identity, no blind retry, child authority attenuated | One bounded multi-step candidate-only objective | Every M7 effect; general continuity and worker fabric |
| M7 PROMOTE | M6 `PRODUCTION ACCEPTED` plus accepted design for one exact effect profile | `PREPARE -> REVALIDATE -> COMMIT`, exact target/authority, receipt/witness/reconciliation, rollback, all prior regressions | Required per effect profile and real destination | Other profiles denied; authority expiry/revocation; stale target; ambiguous effect blocks retry; credentials/network absent unless named | First: one `patch_export`; later: one witness per independently accepted profile | Every unqualified M7 profile and all generic External Agency effects |

### 17.2.1 Owner-selected M-series qualification batching

From M5 through the end of the Sandbox V2 M-series, host-dependent physical
qualification is deferred until the M-series implementation track is complete.
This is qualification batching, not acceptance by implication. Milestone
semantics, physical criteria, production-witness requirements, and the
canonical ladder in §17.1 are unchanged.

Implementation track:

```text
M5 design, implement, local falsification, independent review
  -> M6 design, implement, local falsification, independent review
    -> M7 design, implement, local falsification, independent review
      -> FREEZE EXACT M-SERIES CANDIDATE
        -> COORDINATED MINT PHYSICAL QUALIFICATION
          -> release / deploy / promotion / production witnessing
            -> production acceptance decisions
```

Implementation-track entry:

- M6 implementation may begin after M5 is `INDEPENDENTLY REVIEWED`.
- M7 implementation may begin after M6 is `INDEPENDENTLY REVIEWED`.

Production-acceptance predecessors remain the table above. M6
`PRODUCTION ACCEPTED` still requires M5 `PRODUCTION ACCEPTED`. M7
`PRODUCTION ACCEPTED` still requires M6 `PRODUCTION ACCEPTED` plus accepted
design for the named effect profile. No milestone receives
`PHYSICALLY QUALIFIED`, `RELEASE_QUALIFIED`, `DEPLOYED`, capability promotion,
production witness, or `PRODUCTION ACCEPTED` by inheritance from a local
settlement or from a later sibling.

Workers must not stop after every M5/M6/M7 implementation to run Mint
qualification. They must still complete that milestone's design,
implementation, local verification, and independent review before starting
the next M-series implementation. The coordinated Mint campaign still has to
satisfy every physical criterion named in §17.2.

### 17.3 Current gate truth

This architecture document does not record current SHA, qualification,
deployment, promotion, or production-acceptance observations.

Architectural predecessor: M4 implementation remains blocked until
exact-candidate M3 is `PRODUCTION ACCEPTED`. A prior-SHA physical result does
not qualify a later SHA.

Observed current maturity is not recorded here. Resolve it live. If it cannot
be established from permitted evidence: `UNKNOWN`.

## 18. Standard specification template for M4+

Every future milestone or M7 effect-profile specification must contain these
sections:

```text
# Purpose
# Vision / Principle Basis
# New Capability
# Explicit Non-Capabilities
# Current Owner -> Final Owner
# State Introduced
# Authority Required
# Request Ontology
# Execution Topology
# Isolation Boundary
# Network / Secret Policy
# Resource / Budget Policy
# Operational Truth Contract
# Failure / Ambiguity Semantics
# Retry / Exactly-Once Semantics
# Cleanup / Recovery
# Evidence / Audit
# Cognition Handoff
# Expression / Honesty Boundary
# Previous-Milestone Regressions
# Physical Qualification
# Production Witness
# Acceptance Gate
# Deferred Work
```

The specification must also name its exact predecessor, smallest production
witness, authority-negative tests, and what remains blocked after acceptance.
A happy-path test is insufficient.

## 19. Anti-patterns

Future workers must reject these designs:

- reviving Sandbox V1 broker architecture for convenience;
- arbitrary host shell execution;
- live-repository writes before an accepted M7 profile;
- treating repository instructions or package scripts as execution authority;
- package-manager or network access by implication;
- treating Git credentials as normal Sandbox environment;
- letting worker output directly modify cognitive state;
- adding parallel operational request fields;
- blind retry after ambiguous mutation;
- treating timeout as proof of no effect;
- treating workspace state as Recall;
- treating telemetry as truth or evidence authority;
- treating test success as production acceptance;
- widening authority because previous behavior was trustworthy;
- building M6 as a multi-agent swarm or generic ReAct agent;
- granting a child more authority than its parent;
- building Operational Continuity inside M6;
- building Model Fabric inside M6;
- letting verification commands modify durable candidate state;
- granting network because a build requests it;
- granting push because Git is installed;
- interpreting M7 as email, browser, purchase, account, or generic external
  agency authority;
- collapsing `IMPLEMENTED`, `LOCALLY VERIFIED`, physical qualification,
  deployment, promotion, witness, and production acceptance.

## 20. Adversarial review record

This roadmap was checked against the following reasonable misreadings:

| Misreading | Blocking text |
|---|---|
| Reconnect V1 | Sections 2.2–2.3 explicitly supersede V1 topology for V2 |
| Make live repo writable in M4 | Sections 7 and 12 require immutable input plus ephemeral execution projection |
| Run `package.json` as authority | Sections 5, 11, and 12 classify repo scripts as untrusted data |
| Give M6 indefinite autonomy | Section 14 requires finite budgets and explicit stop conditions |
| Create worker identities | Sections 1 and 14 preserve one Ashley and attenuated workers |
| Amplify child authority | Sections 5, 7, and 14 prohibit it |
| Treat workspace as memory | Sections 6 and 10 separate work state from cognition |
| Blindly retry a write | Sections 9, 14, and 15 require reconciliation |
| Let tests overwrite authored source | Section 12 isolates verification writes |
| Grant network because build wants it | Sections 7 and 11 require an independent profile |
| Push because Git exists | Sections 7, 13, and 15 separate Git mechanisms and effects |
| Treat M7 as generic External Agency | Sections 15.1 and 15.4 exclude it |
| Treat implementation success as production acceptance | Section 17 defines the full ladder |

No listed misreading is authorized by a reasonable reading of the final text.

## 21. Open architectural questions

These questions are genuinely open. They do not reopen accepted M1-M3
semantics or the direct Bubblewrap direction.

1. Exact M4 snapshot/projection mechanism and toolchain packaging, after the
   M3 predecessor gate closes.
2. Exact M5 change-set store and retention surface is bound by
   [`ASHLEY_SANDBOX_V2_M5_DESIGN.md`](ASHLEY_SANDBOX_V2_M5_DESIGN.md) for the
   first slice (nuclear control-plane tables plus sealed artifacts under the
   workspace manager `_control/` directory). Later retention/forget and
   revise/rebase remain deferred there.
3. Exact M6 minimal task-record store and process-lifetime controller, subject
   to the prohibition on general Operational Continuity.
4. Which M7 profile follows `patch_export`, based on an owner-selected real
   need and separate design review.

Implementation substrate, numeric budgets, recipe lists, network destinations,
credential mechanisms, and M7 profiles remain open until their phase-specific
designs bind them. Open mechanism choices are not permission to weaken the
frozen semantic boundaries.
