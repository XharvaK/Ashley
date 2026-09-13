# Project Ashley Operational Continuity Architecture

**Status:** `CURRENT PHASE CONTRACT`

**Date:** 2026-08-21

**Implementation status:** Planned. Current source contains domain-specific
durable jobs, delivery, attention, Sandbox tasks, external actions, leases, and
recovery patterns. It does not implement the general Operational Continuity
contract defined here.

**Scope:** Architecture only. No workflow engine, worker protocol, process,
provider, migration, activation, Sandbox change, or external effect is
authorized.

## 1. Purpose

Operational Continuity lets one bounded Ashley-owned operation remain coherent
across waits, attempts, workers, process loss, restart, cancellation, partial
results, and ambiguous effects.

It answers:

> What operational work exists, what happened during each attempt, what may
> safely continue, and what must remain blocked or reconcile?

It does not answer:

> What does Ashley care about, remember, believe, want, or choose to pursue?

Historical research used “Event Fabric” for incoming-event classification and
a durable inbox. That name is historical. This contract owns the **inbox**
(classification, durable mid-flight input, crash-safe acknowledgement).
`EVENT != INSTRUCTION`. Correlation and reconstruction of committed owner
transitions belong to a future typed Event Spine, which is not this inbox, not
a bus, and not a source of truth. See
[`Ashley_Architecture_Freeze.md`](Ashley_Architecture_Freeze.md).

## 2. Vision and Principle basis

Operational Continuity advances the Vision by letting Ashley sustain bounded
work truthfully without becoming a disposable turn-by-turn tool. It supports
initiative and private activity only when Agency and current authority admit
the work.

It must preserve:

- one Ashley, not a swarm;
- current refusal, withdrawal, and owner authority;
- truthful uncertainty after possible effects;
- continuity without pretending that queued machinery is lived concern;
- bounded specialists and workers as mechanisms;
- cognitive ownership above execution substrates.

## 3. New capability

Operational Continuity adds:

- durable operational concern identity;
- distinct bounded attempts beneath one concern;
- durable input acceptance and disposition;
- current activation ownership and fencing;
- stage-aware restart and resume;
- worker lineage, attenuation, and quiescence;
- artifact and remote-object correlation;
- effect commit and reconciliation correlation;
- parent/child budgets and partial aggregation;
- owner-visible operational recovery state.

## 4. Explicit non-capabilities

Operational Continuity does not add:

- an OpenConcern, goal, motivation, preference, commitment, or Mind State item;
- Agency admission or permission to start work;
- model, provider, tool, network, credential, account, browser, Git, deployment,
  or external-effect authority;
- direct Identity, Recall, Memory Assertion, relationship, or capability writes;
- peer Ashley identities or independent worker goals;
- blind restart of interrupted or ambiguous effects;
- a requirement that one durable-workflow engine own every workload;
- Computer Use, procedure graduation, Context Budget, or Learned Autonomy.

```text
JOB MUST CONTINUE
  != ASHLEY STILL CARES

WORK CONCERN
  != OPEN COGNITIVE ITEM
  != GOAL
  != AGENCY DECISION
  != EXTERNAL EFFECT
```

## 5. Dependencies

### Required contracts

- current governance, Identity, Mind State, Thought, and Agency boundaries;
- capability contracts and authority-at-creation semantics;
- Memory Evidence and Continuity provenance/forgetting boundaries;
- Evaluation / Qualification and Observability planes;
- exact effect semantics from External Effect and Authority for external
  effects, as a `CROSS_CUTTING_INTERFACE`;
- Sandbox V2 contracts for any consumed engineering workspace or receipt, as a
  `CROSS_CUTTING_INTERFACE`.

Operational Continuity does not own model intelligence. Model Fabric profile,
attempt, result, cancellation, privacy, and specialist contracts are a
`CROSS_CUTTING_INTERFACE` for model-backed work only. They are not a semantic
predecessor of Operational Continuity. Current delivery still follows
`OWNER_SELECTED_IMPLEMENTATION_ORDER` after Model Fabric.

### Partial work that may precede full dependencies

- a pure state-machine and crash-corpus proof;
- durable input-ticket and fencing tests with no model or effect;
- minimal-record versus engine comparison using fixtures;
- worker teardown and child-first drain fixtures.

## 6. Relationship to existing continuity domains

| Domain | Owns | Operational Continuity relationship |
|---|---|---|
| Continuity sidecar | Lineage, forgetting, sessions, backup watermarks | Supplies current lineage and deletion constraints; does not become a workflow store |
| INIT-03 / OCI | Unresolved cognitive questions, revisits, and concerns | May propose work through Agency; never mirrors work state |
| Delivery ledger | Message reservation, bubbles, receipts, finalize | Remains delivery authority; a work attempt may correlate to it |
| Attention | Model admission, quotas, deadlines, provider dispatch ledger | Remains model-attempt authority |
| Sandbox V2 M6 | One finite bounded Ashley operation in the engineering workshop | May later supply one operation adapter; must not pre-implement general continuity |
| External actions | Credential-separated effect lifecycle | Remains external-effect authority; Operational Continuity coordinates but does not own effect meaning |
| Cognitive jobs | Domain-specific asynchronous cognition | May remain specialized; generalization requires parity and ownership proof |

## 7. State ontology

### 7.1 WorkConcern

A `WorkConcern` is the durable operational container for one admitted body of
multi-step work.

It contains:

- stable owner-scoped identity;
- bounded purpose and origin reference;
- current operational status;
- cumulative budgets and deadlines;
- current authority and contract lineage references;
- semantic environment requirements;
- attempt lineage;
- cancellation and input policy;
- result and settlement summary;
- retention and classification.

Its status is operational only. Candidate states are:

```text
OPEN -> RUNNING -> WAITING / RECONCILING -> SETTLED
  \-> CANCEL_REQUESTED -> SETTLED
  \-> ABORTED
```

Exact names remain phase-design details. The contract requires distinct open,
running, waiting, reconciling, settled, and definitively aborted meanings.

### 7.2 WorkAttempt

A `WorkAttempt` is one bounded operational pass under a WorkConcern. A new
attempt never erases or rewrites an old attempt.

It records:

- attempt identity and ordinal;
- admission and current authority snapshot references;
- start and terminal stage;
- environment observation;
- worker activations and input tickets;
- model attempts, capability uses, artifacts, and effect records by reference;
- budget reservation and consumption;
- result class and ambiguity;
- settlement evidence.

```text
WorkAttempt
  != ModelAttempt
  != ProviderRequest
  != CapabilityUse
  != WorkerActivation
  != EffectAttempt
```

### 7.3 Step / stage record

A step record may describe a bounded unit within an attempt. It is optional
when the workload has no meaningful step boundary. A workflow framework's step
identifier may map to it, but cannot define its semantic state.

Every effect-capable step must expose whether interruption occurred:

- provably before dispatch or commit;
- after dispatch but before observation;
- after a verified effect;
- at an unknown boundary.

### 7.4 WorkerSessionRecord

A `WorkerSessionRecord` is durable operational worker identity. It contains
lineage, delegation depth, reconstruction inputs, and current lifecycle facts.
It is not Ashley, a SpecialistSession, Recall, a cognitive concern, or live
control authority.

### 7.5 WorkerActivation

A `WorkerActivation` is one live residency epoch for a WorkerSession.

- At most one current activation may control one WorkerSession.
- A lease and fencing token are required when single-process ownership cannot
  be proven.
- Activation is process-local even when its lease is durable.
- Releasing an activation does not delete the session.
- Persisted session lineage does not authorize a new activation.

### 7.6 WorkerInboxTicket

A `WorkerInboxTicket` records durable acceptance of one input for a worker.
There is one logical FIFO for accepted worker input.

Required stages distinguish:

```text
QUEUED -> CLAIMED -> ADMITTED -> EXECUTED -> SETTLED
```

A model/session log, provider message, and framework queue may record mechanics.
They must not become additional ordering authorities.

### 7.7 SemanticEnvironmentIdentity

The semantic environment identity describes the conditions under which work
may continue:

- project or account identity;
- source/base revision;
- workspace and artifact contracts;
- tool/capability surface version;
- provider/model profile where material;
- policy, schema, build, and platform compatibility;
- privacy and classification ceiling.

It describes. It does not authorize.

### 7.8 ResumeGuard

`ResumeGuard` is a deterministic current-state decision that returns one of:

- safe to resume;
- safe only as a new attempt;
- reconciliation required;
- blocked pending owner input;
- refused because authority or environment no longer permits work.

It evaluates current state. It does not grant missing authority.

## 8. Authority contract

### 8.1 Authority at creation

WorkConcern creation requires an admitted Agency or owner-authorized origin.
The record binds:

- governing capability and release;
- parent principal;
- allowed operations and effect classes;
- data and privacy scope;
- environment scope;
- model, tool, network, and worker budgets;
- deadline and cancellation policy;
- child delegation depth and attenuation rules.

### 8.2 Authority at resume

Resume revalidates:

- current capability and master mode;
- owner pause, withdrawal, cancellation, and emergency stops;
- current parent control capability;
- environment identity and base revision;
- remaining budgets and deadlines;
- model/profile/contract compatibility;
- unresolved effect or reconciliation state;
- current privacy and credential policy.

An old authorization record is provenance, not timeless permission.

### 8.3 Child authority

```text
child authority
  = explicit subset of current parent authority
    constrained by child task, environment, budget, time, and depth
```

A child cannot delegate a right it does not currently hold. Aggregation cannot
amplify authority.

## 9. Owner input and cancellation

Owner input arriving during work is an event, not an automatic instruction.
After authentication and concern association, its operational disposition is:

- `QUEUED`: persisted for evaluation at the next safe boundary;
- `APPLIED`: evaluated and incorporated;
- `SUPERSEDED`: replaced before application;
- `TOO_LATE`: conflicts with an effect whose commit may already have started.

`TOO_LATE` must trigger replan or reconciliation. It must not claim that a
possible effect was cancelled.

Cancellation has distinct outcomes:

- request rejected or inapplicable;
- accepted before work admission;
- cooperative stop requested;
- live control stopped;
- effect cancellation confirmed;
- effect outcome unknown.

Stopping a process is not proof that its external effect did not occur.

## 10. Restart and recovery

Recovery is stage-aware:

| Interruption | Required result |
|---|---|
| Proven before durable input acceptance | Input was not accepted; caller may submit under current authority |
| After durable acceptance, before execution | Recover ticket or start a new fenced attempt after revalidation |
| During model work with no external effect | Preserve attempt truth; retry only under Model Fabric reliability policy |
| Before effect commit, proven | New attempt may proceed after fresh authority and environment validation |
| Possible effect commit | `OUTCOME_UNKNOWN` / reconciliation required; no blind retry |
| Verified effect | Continue from observed post-effect state after revalidation |
| Inconclusive reconciliation | Remain blocked; do not relabel as failure |

Exactly-once execution is not a general promise. The architecture uses:

- exactly-once durable state transitions where one Ashley-owned transaction can
  prove them;
- at-most-once dispatch where duplication would be harmful;
- idempotent retry only where the target contract proves it;
- reconciliation for ambiguous possible effects.

## 11. Effects and reconciliation

Operational Continuity correlates but does not redefine:

- `EffectIntent`;
- prepared payload and target identity;
- current authorization and approval;
- `EffectCommitRecord`;
- executor receipt;
- independent Effect Witness;
- `EffectReconciliation`.

Remote persistent objects require provider/namespace identity, stable object
identity, observed revision, mutation base, scope, provenance, and post-write
observation. A URL or provider job handle is a locator, not durable object
identity.

A transient provider polling handle may expire without erasing local attempt
history or proving provider failure.

## 12. Artifacts

An artifact record binds:

- immutable local entity identity;
- content digest and classification;
- concern and attempt origin;
- creator principal and capability;
- source/base and environment identity;
- local materialization reference;
- optional remote-object identity and revision;
- effect and witness references;
- retention, redaction, and forgetting behavior.

```text
ARTIFACT
  != RECALL
  != MEMORY ASSERTION
  != EFFECT WITNESS
  != AUTHORITY
```

## 13. Fan-out and fan-in

Fan-out/fan-in is one workload shape under one Ashley operation. It is not
multi-agent cognition.

The contract requires:

- bounded child count, concurrency, depth, time, model, tool, and effect budgets;
- per-child authority and provenance;
- sibling failure containment;
- child timeout and cancellation-race handling;
- duplicate completion detection;
- child-first drain and whole-process-tree settlement;
- partial aggregate policy;
- unresolved-child preservation;
- aggregator non-authority.

If 97 children succeed, 2 fail definitively, and 1 has an unknown possible
effect, the aggregate may expose a qualified partial result. It must retain the
unknown child and must not claim complete success or blindly retry it.

## 14. Worker output and cognition handoff

Worker output passes through:

```text
bounded worker result
  -> schema and provenance validation
    -> parent aggregation
      -> Ashley semantic-owner admission
        -> optional cognitive or memory proposal
```

No worker directly writes Identity, Mind State, Recall, Memory Assertions,
relationship state, capabilities, goals, preferences, or motivations.

Operational completion may create candidate evidence that an OCI or goal owner
reviews. It must not automatically create or resolve cognitive concern.

## 15. Resource and budget policy

Budgets exist at concern, attempt, worker, model, tool, artifact, network,
effect, time, and retention levels. Child reservation reduces parent remaining
budget. Failed or ambiguous operations do not automatically refund budget.

Settlement reserves bounded time for:

- cancellation observation;
- child-first drain;
- whole-process-tree exit proof;
- artifact and receipt finalization;
- effect reconciliation handoff;
- durable terminal publication.

Cleanup is part of the operation contract, not best-effort work after the
budget is exhausted.

## 16. Observability and evidence

Owner diagnostics must expose bounded metadata for:

- concern and attempt status;
- current owner/lease/fence;
- accepted and pending input;
- budget reservation and use;
- worker/session/activation lineage;
- artifacts and effect correlations;
- cancellation and drain;
- failure class and ambiguity;
- reconciliation need;
- current ResumeGuard result.

Telemetry correlates these records but is not evidence. Engine history,
provider logs, ACP events, or process exit may support diagnosis. They do not
replace Ashley-owned state or Effect Witnesses.

## 17. Mechanism boundary and candidates

Operational Continuity defines a `DurableExecutionProvider` mechanism seam only
after the Ashley state machine and crash corpus are fixed.

| Candidate | Role | Current disposition |
|---|---|---|
| Minimal Ashley-owned SQLite record/lease implementation | Baseline and possible sufficient mechanism for small workloads | `SPIKE REQUIRED` |
| Restate | Durable execution mechanism comparator | `SPIKE REQUIRED`; no semantic ownership |
| Temporal | Durable execution mechanism comparator | `SPIKE REQUIRED`; no semantic ownership |
| DBOS | Durable execution mechanism comparator | `SPIKE REQUIRED`; no semantic ownership |
| ACP | Worker protocol candidate | `SPIKE REQUIRED`; session and permission are not Ashley authority |
| DeepSeek Harness | Lifecycle-mechanics reference | `REFERENCE / SALVAGE MECHANISMS`; no package-family adoption |
| XState | State-machine modeling candidate | `REFERENCE / SPIKE` only if it reduces lifecycle defects |
| BullMQ | Redis queue | `REJECTED FOR CURRENT LOCAL ROLE` |

One engine need not own every workload. Selection is per workload and must
prove lower complexity, failure transparency, recovery correctness, and
operational fitness on Linux Mint.

## 18. Evaluation and qualification

The minimum deterministic corpus covers:

- every crash boundary from admission through settlement;
- durable input acceptance and deduplication;
- two-process activation races and fencing;
- stale parent control and authority revalidation;
- cancellation before and after possible commit;
- owner input at every effect stage;
- transient provider-handle expiry;
- model/profile/contract changes across restart;
- environment and source-base drift;
- artifact identity and remote revision conflict;
- fan-out/fan-in partial, failure, unknown, and drain cases;
- no worker-to-cognition direct write;
- no engine state interpreted as cognitive concern;
- no blind retry after possible effect;
- bounded resource and cleanup behavior;
- owner-only redacted diagnostics.

The comparative substrate spike must run the same workload and crash corpus
against the minimal baseline and each serious engine candidate.

## 19. Smallest production witness

One owner-authorized, non-consequential WorkConcern must:

1. accept one durable input;
2. start a bounded attempt;
3. cross a real process restart before any external effect;
4. pass ResumeGuard under current authority;
5. continue without duplicate input or work;
6. create one attributed local artifact;
7. settle all activations and resources;
8. publish a truthful terminal result and owner diagnostic record.

This witness does not qualify external effects, worker fan-out, Computer Use,
procedures, or cognitive influence.

## 20. Acceptance gate

Operational Continuity may be accepted only when:

- the Ashley-owned ontology and state machine are independently reviewed;
- authority-at-creation and current resume revalidation pass deterministic
  adversarial tests;
- the crash corpus passes for the selected first-slice mechanism;
- ambiguous effects remain blocked and reconcile correctly;
- worker output cannot mutate cognitive owners directly;
- retention, privacy, budgets, cleanup, and diagnostics pass;
- exact-candidate local and physical claims are separately qualified;
- `RELEASE_QUALIFIED`, deployment, and capability promotion remain separate.

## 21. Interfaces to later phases

- Procedural Skill Graduation has an `EVIDENCE_DEPENDENCY` on attributed traces,
  environments, outcomes, artifacts, and ambiguity when its evidence contract
  needs them. General workflow durability is not a predecessor.
- Computer Use has an `EVIDENCE_DEPENDENCY` on durable work, input,
  cancellation, artifact, and effect coordination for multi-step or restart-
  sensitive claims.
- Context Budget has an `EVIDENCE_DEPENDENCY` on durable active-work identity
  and source-range provenance for restart-safe projections.
- Learned Autonomy may consume admitted candidate evidence through existing
  cognitive owners, never operational state directly.
- External Effect and Authority supplies effect, credential, representation,
  commitment, witness, and reconciliation meaning.

## 22. Deferred work

- exact schemas and storage placement;
- engine or protocol selection;
- lease duration and fencing transport;
- remote worker authentication;
- provider-specific remote-object adapters;
- retention durations;
- production deployment topology;
- any Model Fabric, Computer Use, procedure, or cognitive implementation.
