# Sandbox V2 M4 — Verify

**Status:** DESIGN ACCEPTED. This file is the current M4 milestone contract.
It authorizes implementation of M4 as specified here. It does not authorize
capability promotion, production registry mutation, host qualification,
deployment, or production authority. Implementation present, local
verification, independent review, physical qualification, and later ladder
stages remain separate.

**Scope:** M4 only. Bounded verification over a named candidate snapshot under
a named operator-controlled recipe. This file does not specify M5 change-set
authorship, M6 bounded operation, or M7 controlled engineering effects beyond
the border statements required to keep M4 from absorbing them.

**Predecessor:** Exact-candidate M3 `PRODUCTION ACCEPTED`. M4 remains blocked
until that gate is closed. Whether it is presently closed is not recorded
here. Resolve it live. If it cannot be established from permitted evidence:
`UNKNOWN`.

**Umbrella authority:** Read
[`ASHLEY_SANDBOX_V2_ROADMAP.md`](ASHLEY_SANDBOX_V2_ROADMAP.md) first. It owns
cross-cutting M-series order, V1 supersession, state and authority matrices,
future milestone boundaries, and acceptance semantics. This file owns M4
detail only. It is subordinate to `VISION.md`, the Core Principles, the
Constitution, Ethics, and
[`docs/Wave_Acceptance_Protocol.md`](../../Wave_Acceptance_Protocol.md).

M0–M3 semantics are accepted and are not reopened here. Sandbox V1 broker
architecture is frozen and must not return.

---

## 1. Purpose

M4 is a bounded verification mechanism that produces evidence-backed claims
about a named candidate snapshot under a named operator-controlled recipe.

```text
durable M3 candidate workspace
        ↓
snapshot identity bound (content-addressed)
        ↓
immutable verification input (mechanism open)
        ↓
ephemeral writable execution projection
        ↓
admitted recipe from the control-plane catalog
        ↓
bounded execution under direct Bubblewrap
        ↓
receipt (protocol state separate from verification outcome)
        ↓
OperationalClaimLicense (issued only after the receipt exists)
        ↓
OperationalTruth
        ↓
Thought continuation → Expression
```

**Preserved invariant:** `CANDIDATE WORKSPACE MUTATION != LIVE REPOSITORY MUTATION`.

**M4 law:** `VERIFICATION RESULT != ENGINEERING JUDGMENT`.

The only class of sentence M4 may license:

> This named snapshot of this candidate workspace produced this mechanical
> outcome under this named recipe.

A successful M4 operation never means the live repository changed, the
candidate is good, a change should merge, Ashley improved herself, or
production may advance.

---

## 2. Vision / principle basis

The Vision asks for a companion with real capacity to act, without turning
that capacity into servitude, simulated certainty, or a second self made of
tooling. Sandbox V2 exists so Ashley can investigate and eventually perform
controlled engineering work while remaining one Ashley.

M4 serves that Vision by giving Thought mechanical evidence about candidate
work. It does not serve it by letting Expression invent quality, merge
readiness, or self-improvement.

Governing principles for this milestone:

- **Truth Before Comfort.** Timeout, mismatch, and malformed evidence stay
  `outcome_unknown` or `sandbox_failure`. They do not become a comforting pass
  or fail.
- **Architecture Before Prompting.** Recipe argv, isolation, and claim
  licenses are architecture. Honesty is not a prompt reminding the model not
  to say "looks good."
- **Evidence is not cognition.** Receipts, stdout, and toolchain output are
  inputs to Ashley-owned interpretation. They do not write Identity, Mind
  State, Recall, goals, or policy.
- **Workspace files are durable work state.** They are not Identity, Mind
  State, or memory.
- **Tests do not equal acceptance.** Wave Acceptance remains the lifecycle
  owner. A green recipe is not `PRODUCTION ACCEPTED`, capability promotion, or
  deployment.

Ethics and the Constitution constrain what may be claimed and who may change
Identity or production authority. M4 does not create those authorities.

---

## 3. New capability

Ashley can run one admitted, bounded, operator-controlled verification recipe
against a specific snapshot of an existing M3 candidate workspace, and can
receive a receipt that may license the sentence in §1.

M4 removes the M3 limitation that candidate state cannot be compiled,
typechecked, linted, or otherwise executed for verification. It does not
remove the border against authorship, live mutation, Git, network, packages,
credentials, loops, or promotion.

Identifiers below are examples. Exact names remain open until design
acceptance. They are not current source facts.

| Term | Role | Example (OPEN) |
|---|---|---|
| Capability | Release gate: may Ashley attempt candidate verification at all? | `candidate_verification` |
| Operation | Closed request kind Thought may emit | `workspace.verify` |
| Recipe | Catalog entry that owns how execution happens | `typescript_fixture_compile_v1` |
| Recipe class | Grouping inside the catalog, not a capability | compile, typecheck, lint, test |

A recipe is not a capability. `build_check`, `test_check`, and `lint_check`
must not become individual SQLite capability releases.

---

## 4. Explicit non-capabilities

M4 does not implement or grant:

- shell access, arbitrary commands, model-generated argv, or `sh -c`
- `npm install`, package download, or package management
- network access
- browser control
- Git, commits, pushes, pull requests
- live repository mutation
- deployment, restart, or release qualification
- self-modification or Identity change
- autonomous engineering loops (M6)
- worker orchestration or a second Ashley
- coherent change-set authorship (M5)
- sticky `workspace.verified` or any quality badge on the durable workspace
- reuse of `engineeringAllowed` as M4 authority
- Sandbox V1 broker topology, signed `source_*` envelopes, or
  `/run/ashley/broker.sock`

Repository files (`package.json`, scripts, hooks, READMEs, agent files) are
untrusted data. They may later inform an operator-authored recipe. They cannot
admit a run.

---

## 5. Current owner → final owner

| Concern | Owner now and after M4 acceptance |
|---|---|
| Snapshot identity, admission, receipt, cleanup | M4 verification controller under the V2 parent/control plane |
| Durable candidate tree | M3 workspace mechanism. M4 must not become its writer |
| Recipe catalog | Operator-owned control plane. Not model-writable. Not the candidate tree |
| Project targeting | Existing project registry, with a new narrow M4 grant |
| Capability release | Existing SQLite capability authority |
| Claim license / OperationalTruth | Honesty / operational-truth boundary, as in M1–M3 |
| Cognitive interpretation | Thought / Agency after the receipt exists |
| Expression | Licensed mechanical facts only |

Model Fabric, Operational Continuity, OpenCode, workers, and Expression do not
own M4 authority. A later mechanism may execute a recipe. It cannot admit a
recipe, widen argv, or issue a claim license.

---

## 6. State introduced

M4 introduces control-plane verification state. None of it is Identity, Mind
State, Recall, or memory. None of it is live repository state.

### 6.1 Snapshot identity (required)

Snapshot **identity** is required. Snapshot **storage** is not.

Minimum identity:

| Field | Meaning |
|---|---|
| `snapshotId` | Opaque control-plane identifier |
| `workspaceId` | Durable M3 workspace this snapshot was taken from |
| `projectId` | Operator-approved project that owns the workspace |
| `candidateTreeHash` | Content-based hash of the candidate tree (paths + contents, not mtimes). Algorithm OPEN. |
| `sourceSnapshotId` | Lineage from the sanitized M2 projection that initialized the workspace |
| creation metadata | At least `createdAt` and the controller that bound the identity |

`sourceSnapshotId` answers where the workspace came from. It is not the
identity of what was verified. `candidateTreeHash` answers which exact
candidate bytes the recipe was bound to. It is content-based.

The canonical tree hash algorithm remains an implementation-level contract
(OPEN). Future design must define:

- path normalization
- encoding rules
- ordering
- included file types
- symlink behavior
- ignored files

This draft does not choose those rules.

Receipts bind `snapshotId` and `candidateTreeHash`. Later milestones may cite
those identities after the snapshot bytes are gone. The roadmap already makes
the input snapshot bounded/ephemeral by default. Keep that.

### 6.2 Snapshot storage (open)

Do not require a copied tree, a read-only bind, overlayfs, or any other
projection in this design.

Open choices include:

- copied snapshot
- read-only tree
- overlay
- another projection that can uphold the invariant

**Invariant:** the verification execution input must be immutable for the
duration of verification.

**Invariant:** the durable M3 candidate tree is never the recipe’s writable
working directory.

**Invariant:** from identity bind, through execution, through after-hash, the
durable candidate must not change. If it does, the run is not a verification
of the named snapshot. How exclusivity is enforced (lease, generation counter,
or equivalent) is a later mechanism choice. The race is not optional.

### 6.3 Execution projection and artifacts

The recipe may write only inside an ephemeral execution projection. Generated
files, caches, and hook side effects stay there. They are discarded, or
retained only as separately classified artifacts. Copying them into the
durable candidate is authorship and is forbidden in M4.

### 6.4 Receipt and license

A verification receipt is evidence. An `OperationalClaimLicense` is current-turn
authorization to describe that evidence. Telemetry must not create a license.
A receipt does not become a sticky verified property of the workspace.

If a later design stores “last verification” on workspace metadata, it may
store only the last receipt id and the hash it covered. It must not store
`passed: true` as a quality badge.

### 6.5 Drift (three facts)

| Drift | Meaning | M4 behavior |
|---|---|---|
| Live source vs workspace `sourceSnapshotId` | Stale base / freshness | Record it. Do not refresh, destroy, or fail the recipe for this reason. Rebase belongs to M5. |
| Durable candidate vs bound snapshot during the run | Unstable input | Fail closed. Not `verified_failure`. The recipe did not receive the named snapshot. |
| Durable candidate vs snapshot after a valid receipt | Later M3 edits | The receipt remains true of that hash. It says nothing about the current tree. |

---

## 7. Authority required

Do not introduce a new authority system. Use the existing hierarchy. All
applicable layers must agree before execution starts. Model JSON can propose.
It cannot authorize.

### 7.1 Capability authority

Question: may Ashley perform candidate verification?

One capability release, analogous to `project_experimentation`. Example name
(OPEN): `candidate_verification`.

This gate answers whether the class of work may be offered or attempted. It
does not name a compiler, argv, or project.

Do not split compile, typecheck, lint, or test into separate capability
releases. Those are recipe classes.

Historical V1 task profiles such as `build_regression`, `test_regression`,
`code_quality`, and `self_improvement` are not M4 authority.

### 7.2 Boundary authority

Question: may this project participate?

The project registry remains the targeting plane. Possible future fields
(OPEN):

- `verificationAllowed`
- `allowedRecipeIds`

Do not use `engineeringAllowed` as M4 authority. M3 already forbids reading
that field as M4–M7. Keep that prohibition.

`candidateWorkspaceAllowed` remains M3 workspace mutation authority. It does
not grant verification. Verification requires its own project grant, plus an
existing workspace that M3 rules still recognize as valid.

The model still identifies only `projectId` and `workspaceId`. It cannot
supply host paths or widen the registry.

### 7.3 Recipe authority

Question: exactly how does this verification execute?

Introduce a control-plane recipe catalog. Operator-owned. Versioned. Not
mounted as model-writable workspace content. Not inferred from the repository.

A recipe owns:

- executable identity
- argv
- cwd policy
- environment policy
- network policy
- resource limits
- toolchain identity
- declared postcondition (what “held” means for this recipe)
- cleanup and result-validation rules

Thought may request `recipeId` (and, when design acceptance binds it, a recipe
version). Thought may not provide command strings, argv, executable paths,
environment variables, or shell commands.

A recipe version is immutable after admission. Changing any of executable
identity, argv, environment policy, toolchain identity, declared postcondition,
or cleanup rules creates a new recipe version. A receipt must always refer to
the exact recipe definition that produced it. How versions are stored remains
open.

M4 identifies provisioned toolchains. It does not acquire toolchains, install
dependencies, update packages, resolve missing packages, or download compilers
or runtimes. Missing toolchain remains admission refusal. Do not create
package-management semantics.

V1 salvage, topology discarded: binding `recipeId` only, treating
`package.json` as untrusted, and refusing a missing toolchain instead of
falling back to repository scripts. Do not salvage `ashley-exec-broker`,
signed `source_verify` envelopes, or broker-owned session authority.

Exact catalog location, toolchain packaging, and numeric limits remain open.

### 7.4 Runtime admission authority

Existing deadline, lifecycle, budget, and one-sandbox-action-per-turn checks
remain. An M4 request that arrives without remaining budget for execution,
cleanup, post-operation cognition, Expression, and delivery is refused.

M4 does not stretch Discord’s first-response deadline into a long-running
work protocol. If a recipe cannot complete inside current admission, it is
refused. It does not become M6.

### 7.5 Substrate authority

Direct unprivileged Bubblewrap availability is separate from permission. A
host with compilers, Git, npm, and network interfaces may still refuse every
M4 run. Availability is not authority.

---

## 8. Request ontology

The canonical selector remains singular.

```text
epistemic need
  != operational intent
    != effect intent
      != border authorization
```

Extend the existing `operationalRequest` union. Do not add
`verificationRequest`, `patchRequest`, or `engineeringRequest`.

Example shape (names OPEN):

```text
operationalRequest: {
  kind: "candidate_verification",
  request: {
    operation: "workspace.verify",
    projectId: "...",
    workspaceId: "...",
    recipeId: "..."
  }
}
```

`evidenceDisposition` remains epistemic. It does not authorize verification.

Arbitration stays mutually exclusive with M1, M2, and M3 in the same turn, as
already designed. Two sandbox intents in one proposal fail closed.

---

## 9. Execution topology

Required sequence, independent of storage mechanism:

```text
valid canonical request
  AND capability grant
  AND project / workspace / recipe grant
  AND runtime admission
  AND substrate availability
        ↓
bind snapshot identity (hash the durable candidate)
        ↓
present an immutable execution input that matches that identity
        ↓
run the catalog executable with catalog argv inside Bubblewrap
        ↓
confine writes to the ephemeral execution projection
        ↓
observe process completion or failure of observation
        ↓
re-hash the durable candidate
        ↓
emit a receipt that separates protocol state from verification outcome
        ↓
mandatory cleanup
        ↓
issue OperationalClaimLicense only from the receipt
```

The parent resolves executable and argv from the catalog. The host should
invoke that vector directly. Concatenating a shell string, including a catalog
string passed to `sh -c`, is a shell and is forbidden.

M3-style JSON runner versus direct exec of the catalog executable is an open
mechanism choice. Neither may interpret a model string as a command line.

V1 broker IPC, root services, and signed V1 envelopes are not this topology.

---

## 10. Isolation boundary

Direct Bubblewrap. No broker. No privileged IPC.

Required isolation posture, matching accepted V2 law:

- durable candidate not writable by the recipe
- live canonical project root not writable
- `.git`, host secrets, home directory, and arbitrary host filesystem not
  writable-mounted as candidate or recipe output
- user/pid/net/ipc/uts unshare as in current V2 inspection/workspace isolation
- clean environment except the recipe allowlist
- host sentinel secret used for isolation checks, never exposed to Expression

Positive isolation checks belong on the receipt. A recipe that “needs”
network, packages, or a writable candidate does not punch the border.

---

## 11. Network / secret policy

Default network mode is off. First M4 slice is offline.

A verification tool that wants network does not grant it. Network authority
remains a later, independent profile, no earlier than M7 for Sandbox
engineering.

Credentials stay absent from model context, workspaces, stdout, and generic
telemetry. Git credentials are not Sandbox environment.

Stdout and stderr are bounded and secret-scanned before any retained
projection. Truncation is explicit.

---

## 12. Resource / budget policy

Interactive-turn ownership remains:

```text
execution
  → termination
    → mandatory cleanup
      → post-operation cognition
        → Expression
          → delivery
```

An earlier phase must not consume a later protected reserve. Cleanup is not
optional. Expression must retain enough budget to report a truthful outcome,
including ambiguity.

Recipe-level ceilings (wall time, CPU, memory, processes, output bytes,
filesystem, artifact size) are owned by the catalog entry. Exact numbers
remain open.

Package installation is prohibited. Toolchains are operator-provisioned and
identified, not acquired, by M4. If the admitted toolchain is missing,
admission is refused. There is no fallback to repository scripts, and no
resolution of missing packages.

---

## 13. Operational truth contract

Precedence remains:

```text
verified current-turn effect
  > current OperationalClaimLicense
    > general capability self-model
      > model or Expression inference
```

Laws that apply:

- `ATTEMPTED EFFECT != VERIFIED EFFECT`
- `TOO LATE TO DRIVE THIS TURN != FALSE`
- `UNOBSERVED SUCCESS != FAILURE`
- `RECEIPT != EFFECT WITNESS`
- `VERIFICATION RESULT != ENGINEERING JUDGMENT`
- Verification output is evidence, not semantic interpretation
- A timeout proves only that the observer’s deadline elapsed
- A green recipe is not production acceptance

M4’s licensed claim is only the §1 sentence, bound to snapshot + recipe +
toolchain identities.

**Confidence** is not a score. `verified_success` and `verified_failure` are
licensed certainty about that snapshot and that recipe. If the durable tree
hash has since diverged, the receipt still speaks about the old snapshot and
says nothing about the current workspace. Ambiguous outcomes license neither
pass nor fail.

---

## 14. Failure / ambiguity semantics

Do not collapse protocol success into recipe success. A runner or executor
flag analogous to `ok: true` is forbidden as the meaning of “the build
passed.”

### 14.1 Outcome classes

| Outcome | Meaning |
|---|---|
| `refused` | Admission proved execution did not start |
| `verified_success` | The recipe completed and the declared postcondition held |
| `verified_failure` | The recipe completed and the declared postcondition failed |
| `sandbox_failure` | Isolation, runner, evidence pipeline, or cleanup contract failed |
| `not_interpreted` | Mechanical evidence exists but Thought did not finish interpretation |
| `outcome_unknown` | Ashley cannot honestly claim success or failure of the recipe postcondition |

`verified_failure` is not sandbox failure. A well-isolated typecheck that
exits nonzero is a completed recipe whose postcondition failed. It is not
proof that M3 writes failed, and not proof that the live repository is
broken.

### 14.2 Causes

| Event | Outcome |
|---|---|
| Recipe process completes; declared postcondition holds; durable hash unchanged; cleanup succeeds | `verified_success` |
| Recipe process completes; declared postcondition fails; durable hash unchanged; protocol intact | `verified_failure` |
| Timeout | `outcome_unknown` for the recipe postcondition. Still record candidate hash if it can be observed |
| Malformed evidence, isolation check failure, protocol break | `sandbox_failure` |
| Snapshot mismatch or durable hash change during bind/execute/after-hash | `outcome_unknown` or `sandbox_failure`, never `verified_failure` |
| Unknown recipe, missing toolchain, project not granted, capability inactive | `refused` if detected before start; `sandbox_failure` if the admitted environment was not the one that ran |
| Cleanup fails after a green recipe | `sandbox_failure` even if the recipe postcondition held |
| Truncation or vanished process that makes the postcondition undecidable | `outcome_unknown` |

---

## 15. Retry / exactly-once semantics

Do not automatically retry ambiguous outcomes.

A possibly mutating operation is never redispatched merely because success was
not observed. M4 must not mutate the durable candidate. If after-hash cannot
prove that, treat the run as ambiguous and do not retry blindly.

A new request may be admitted later when the cause has changed: new snapshot
identity, new recipe version, restored toolchain, or restored admission. That
is a new operation, not a hidden loop.

Flakes and nondeterminism are evidence facts. They are not automatic retry
permission. Retry against only the ephemeral view, if ever allowed, requires a
declared budget and proof that the durable tree was untouched. The first M4
slice should not need retries. Prefer a deterministic recipe class.

M4 must not become M6 by retrying edit/verify cycles.

---

## 16. Cleanup / recovery

Mandatory cleanup is part of the operation. Generated projection contents are
removed according to the verification cleanup policy unless a later, separate
artifact-retention contract admits a named artifact.

Cleanup failure is a sandbox failure. A dirty projection left behind is an
authority leak, even when the recipe postcondition held.

Process restart during M4:

- if execution is known not to have started: `interrupted` / refuse-class,
  no recipe outcome
- if a recipe may have run: `outcome_unknown` until the durable tree is
  re-observed and the projection is reconciled or destroyed
- no automatic resume

Partial projection state is not candidate state and not memory.

---

## 17. Evidence / audit

### 17.1 Protocol state versus verification outcome

| Plane | Answers | Must not answer |
|---|---|---|
| Execution protocol state | Did admission, isolation, observation, hashing, and cleanup hold? | Whether the candidate is good |
| Verification outcome | Did this recipe’s declared postcondition hold against this snapshot? | Merge, deploy, Identity, production |

These planes are independent. Protocol failure cannot be reported as
`verified_failure`. Recipe postcondition failure cannot be reported as
`sandbox_failure` unless the protocol itself also broke.

### 17.2 Minimum receipt fields

The receipt must answer: what was verified, against which snapshot, using
which recipe, under which environment, and what happened.

| Field | Answers |
|---|---|
| `workspaceId`, `projectId` | Which workspace and project |
| `snapshotId` | Which snapshot identity |
| `candidateTreeHashBefore`, `candidateTreeHashAfter` | Which bytes, and whether the durable tree moved |
| `sourceSnapshotId` | Lineage only |
| `recipeId`, `recipeVersion`, recipe class | What was verified |
| toolchain identity | Which provisioned tools |
| executable identity | Which binary ran |
| argv identity or hash | Which fixed arguments |
| environment policy identity | Which env allowlist |
| network mode | Whether network was admitted (first slice: off) |
| resource outcome | Observer-measured consumption / limit hits |
| process outcome | Whether the process completed, and exit code if it did |
| verification outcome | `verified_success` / `verified_failure` / not decided |
| protocol / sandbox outcome | `refused` / `sandbox_failure` / intact |
| cleanup outcome | Whether cleanup completed |
| isolation checks | Whether the V2 isolation contract held |
| stdout/stderr hashes, truncation flags | Bounded, secret-scanned observation |
| classified artifact ids, if any | Ephemeral outputs, not candidate files |

Audit records follow the M2/M3 honesty profile: safe metadata only. No raw
file contents, secrets, host paths, or env snapshots in Expression-facing
audit.

### 17.3 Forbidden fields

The receipt, license, workspace metadata, and OperationalTruth must not carry:

- `approved`
- `accepted`
- `improved`
- `qualityScore`
- `shouldMerge`
- `verifiedWorkspace`

Also forbidden as sticky meaning: `ok: true` as “the candidate passed.”

---

## 18. Cognition handoff

Preserve the M2/M3 turn shape:

```text
FIRST PASS Thought
  → optional candidate_verification request
EXECUTION
  → layered admission
  → snapshot bind
  → Bubblewrap recipe
  → receipt
SECOND PASS Thought
  → interpretation of licensed mechanical facts
EXPRESSION
  → OperationalTruth
  → natural response
```

Receipts do not write Identity, Mind State, Recall, goals, or policy.
Interpretation is a Thought act after evidence exists. If continuation does
not finish, `interpretationStatus = not_interpreted` and Expression may state
only licensed mechanical facts.

Easy-turn reachability: if the capability, registry, recipe, and substrate
gates are open, Thought must be able to select M4 on an ordinary conversational
turn. “Selectable” does not mean preferred, automatic, proactive, or background
execution. M4 remains reactive and user-grounded. It is not M6.

---

## 19. Expression / honesty boundary

`OperationalClaimLicense` is issued only after the receipt exists and the
outcome class is decided. Expression may emit the §1 sentence when the license
and OperationalTruth agree. Expression may not invent semantic details when
interpretation is missing.

### 19.1 Authority-negative examples

**Allowed:**

> The candidate snapshot passed recipe `typescript_fixture_compile_v1`.

Better, when identities are known:

> Snapshot `S` of workspace `W` (tree `H`) produced `verified_success` under
> recipe `typescript_fixture_compile_v1`.

“Passed” without snapshot, recipe, and workspace is already too loose for a
license. The first form is acceptable only when those identities are in the
same licensed record.

**Forbidden:**

> The candidate is good.

**Forbidden:**

> The change should merge.

**Forbidden:**

> Ashley improved herself.

**Forbidden:**

> The live repository is safe to modify.

**Forbidden (same class):** production is ready; tests prove the objective;
this should be committed; I verified the live tree; I installed packages; the
workspace is now a verified workspace.

Thought may privately weigh a receipt. That private weighing is not
OperationalTruth and not a licensed Expression claim.

---

## 20. Previous-milestone regressions

M4 acceptance requires M0–M3 behavior to remain intact:

- M0/M1: direct unprivileged Bubblewrap, no inferred runtime authority from
  host proof, M1 roundtrip still isolated
- M2: read-only sanitized projection, no mutation from inspection
- M3: typed candidate file operations only; durable workspace not a live
  checkout; `CANDIDATE WORKSPACE MUTATION != LIVE REPOSITORY MUTATION`
- one sandbox action per turn
- `engineeringAllowed` still does not grant M3 or M4
- V1 broker path still unused by V2 execution

Authority-negative regressions required by the roadmap remain in force: repo
scripts cannot self-authorize; candidate hash unchanged across an M4 run;
network, packages, Git, and credentials denied.

---

## 21. Physical qualification

Physical qualification is required on the real Mint host for Bubblewrap and
the admitted toolchain. Local tests on Windows do not qualify M4.

Qualification binds an exact source identity, artifact, host, configuration,
recipe, and authority surface. A prior-SHA result does not transfer.

This design does not record a current SHA or host witness.

---

## 22. Production witness and smallest vertical slice

Optimize the first slice for proving the authority and evidence model, not for
usefulness.

### 22.1 Options

| Option | Verdict |
|---|---|
| A. File integrity verification | Necessary evidence on every M4 run. Insufficient as the M4 capability. Hashing the durable tree does not prove recipe admission, isolated execution, or “not a shell.” |
| B. Deterministic compile/typecheck recipe | Correct class, if constrained as below |
| C. Test execution | Wrong first slice. Flakes, retries, and “tests passed = good” collapse recipe outcome into judgment |
| D. Other | A raw `true`/hello-world process can prove isolation, but not recipe-class admission. Not preferred over constrained B |

### 22.2 First slice

The first witness is a constrained B:

- offline
- deterministic
- fixture-based
- no package installation
- no network
- no repository scripts
- no model-generated commands

Example recipe id (OPEN): `typescript_fixture_compile_v1`. Exact executable
and fixture tree remain open. The class is compile/typecheck, not the
Project Ashley production build, and not `npm test`.

It must prove:

1. snapshot identity binding
2. recipe admission (`recipeId` only)
3. isolated execution through real direct Bubblewrap
4. evidence generation with protocol state separate from verification outcome
5. durable candidate tree hash identical before and after
6. execution projection may contain generated output that does not land in the
   durable candidate
7. cleanup completed
8. Expression reports the recipe outcome without authorship or production
   acceptance

File integrity (option A) is gate 5 of that witness, not a competing
milestone.

---

## 23. Acceptance gate

```text
DESIGN ACCEPTED
  → IMPLEMENTED
    → LOCALLY VERIFIED
      → INDEPENDENTLY REVIEWED
        → PHYSICALLY QUALIFIED
          → RELEASE_QUALIFIED
            → DEPLOYED
              → CAPABILITY PROMOTED
                → PRODUCTION WITNESSED
                  → PRODUCTION ACCEPTED
```

No stage implies the next. This file is `DESIGN ACCEPTED`. It is not
`IMPLEMENTED`.

Entry gate for implementation: exact-candidate M3 is `PRODUCTION ACCEPTED`.

Exit evidence for M4 is defined by the roadmap M4 row: immutable input,
admitted recipe/toolchain identities, candidate non-mutation, bounded receipt,
cleanup, and full M1–M3 regression. A happy-path test is insufficient.

A production witness does not become production acceptance without the
acceptance decision.

---

## 24. M4 / M5 / M6 / M7 boundary

This section is a border. It is not an M5, M6, or M7 design.

| Milestone | Question M4 does not answer |
|---|---|
| M4 Verify | Did snapshot `S` satisfy recipe `R`? |
| M5 Author | What coherent change set did Ashley author? |
| M6 Operate | How does Ashley pursue a bounded objective? |
| M7 Promote | How does Ashley cross a controlled engineering border? |

A verification receipt cannot create authorship. Authorship is an identity
over intended file changes, base, and a sealed artifact. A recipe run names
none of those. Importing compiler output into the durable candidate would be
authorship without an M5 contract.

An authored change cannot create live authority. A sealed patch remains
advisory candidate work. Apply, commit, push, deploy, and promotion remain
M7 or operator acts, each with its own profile.

M4 is one verification. Edit, verify, edit again is M6. Hidden retry after
`verified_failure` is a loop. Do not smuggle it.

After a perfect M4 receipt, still forbidden: live mutation, Git, network,
packages, credentials, deployment, restart, worker identity, Identity change,
and “Ashley improved herself.”

---

## 25. What remains blocked after M4

Even after future M4 `PRODUCTION ACCEPTED`:

- M5 authorship
- M6 bounded operation
- every M7 effect profile
- network, package acquire/install, Git mutation, credentials
- generic External Agency and Computer Use
- treating workspace state as Recall
- treating verification success as production acceptance

---

## 26. Deferred work

These questions remain open on purpose. They do not weaken the frozen
boundaries.

1. Exact snapshot/projection mechanism (copy, read-only tree, overlay, or
   other), provided the immutability invariant holds.
2. Toolchain packaging and install paths.
3. Numeric budgets and recipe resource ceilings.
4. Exact capability, operation, recipe, and registry field names.
5. Recipe catalog store location.
6. Any recipe beyond the first fixture compile/typecheck class.
7. Whether the executor is an M3-style protocol runner or direct catalog exec.
8. Artifact retention beyond default ephemeral discard.
9. Canonical `candidateTreeHash` algorithm (path normalization, encoding,
   ordering, included file types, symlink behavior, ignored files).

Do not close these by convenience during implementation. Do not use them as
permission to add a shell, network, packages, `engineeringAllowed`, or
candidate writes.

---

## 27. Anti-patterns specific to this draft

Reject these designs if they appear in later implementation:

- reviving Sandbox V1 broker architecture
- mounting the durable candidate writable “only for caches or `node_modules`”
- `npm test`, `npm run`, or `node --run` as a recipe
- model argv, `sh -c`, or a “safe shell allowlist”
- `engineeringAllowed` as M4
- SQLite capabilities named `build_check` / `test_check` / `lint_check`
- sticky `workspace.verified`
- copying build artifacts into the candidate
- treating a green receipt as M5, M6, M7, or capability promotion
- parallel request fields
- blind retry after timeout or snapshot mismatch
- choosing overlay, OpenCode, or a worker fabric as the first M4 mechanism
  merely because they exist
- implementing M4 before exact-candidate M3 is `PRODUCTION ACCEPTED`

---

## 28. Adversarial misreadings

| Misreading | Blocking text |
|---|---|
| M4 verifies the live repository | §1, §4, §10. Input is a candidate snapshot. Live tree is not the writable target |
| M4 writes the durable workspace | §6.2–6.3, §9. Recipe writes stay in the ephemeral projection |
| Recipes are capabilities | §3, §7.1. One capability. Recipes live in the catalog |
| `engineeringAllowed` grants M4 | §7.2 |
| Model may supply the command | §7.3, §8, §9 |
| `ok: true` means the candidate passed | §14, §17 |
| Timeout means the code failed | §14.2 |
| Green recipe means merge or deploy | §19, §24 |
| Recipe success proves the user's intended improvement succeeded | M4 proves only that the named snapshot satisfied the named recipe postcondition. It does not prove the broader objective, intent, quality, or usefulness was achieved |
| Snapshot storage must be a copy | §6.1–6.2. Identity is required. Mechanism is open |
| `DESIGN ACCEPTED` authorizes promotion, deployment, or production | Header status and §23. Design acceptance authorizes implementation only; later ladder stages stay separate |
| M4 may start before M3 production acceptance | Predecessor line and §23 |
