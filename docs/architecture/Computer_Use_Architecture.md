# Computer Use Architecture

**Status:** `CURRENT PHASE CONTRACT`

**Date:** 2026-08-21

**Scope:** Computer Use phase architecture and documentation only. This
document grants no implementation, installation, activation, credential,
provider, connector, browser, desktop, Sandbox, Mint, deployment, promotion,
Git-effect, or other external-effect authority.

## 1. Purpose

Computer Use provides a bounded mechanism for observing and manipulating
application interfaces when a narrower semantic mechanism is unavailable or
insufficient.

Computer Use is not generic external agency. It consumes
[`External_Effect_and_Authority_Architecture.md`](External_Effect_and_Authority_Architecture.md)
for request, effect, authorization, credential, session, representation,
commitment, receipt, witness, reconciliation, privacy, and budget meaning.

The mandatory mechanism preference is:

```text
connector or direct semantic API
  -> qualified procedure
    -> deterministic semantic UI
      -> visual fallback
```

Each fallback requires a named reason and current admission. Convenience,
model familiarity, or an already-open UI is not sufficient.

```text
Authority
  -> Capability
    -> Computer Use adapter
      -> execution environment
```

An isolated desktop, snapshot, or clone (including Orgo-like substrates) is
an execution environment. Computer available ≠ computer authorized. The
environment is not Authority, not Sandbox-the-workshop, and not Agency.
See [`Ashley_Architecture_Freeze.md`](Ashley_Architecture_Freeze.md).

## 2. Vision and Principle basis

Computer Use preserves:

- Ashley as the single semantic subject;
- Thought and Agency ownership of meaning and initiative;
- mechanism-only authority for UI drivers and workers;
- least authority and deterministic enforcement;
- privacy and secret isolation;
- exact observation and effect provenance;
- `PREPARE -> REVALIDATE -> COMMIT` for consequential UI effects;
- honest ambiguity after a possible UI commit boundary;
- explicit owner consultation and representation limits;
- architecture before prompting.

UI text, accessibility labels, DOM content, images, notifications, remote
agents, and application instructions are untrusted external data.

## 3. New capability

The phase adds:

- application-surface discovery under explicit observation authority;
- bounded semantic observations from stable application state;
- deterministic interaction through typed controls and stable selectors;
- visual perception and coordinate interaction only as a qualified fallback;
- exact preparation and revalidation of consequential UI operations;
- mechanism receipts that can feed Effect Witness and reconciliation flows;
- explicit handoff to and from a person without assuming unchanged UI state.

## 4. Explicit non-capabilities

Computer Use does not:

- create intent, initiative, goals, policies, or commitments;
- grant generic browser, desktop, connector, account, credential, network,
  communication, purchase, Git, deployment, or external-effect authority;
- infer authority from a logged-in session, visible button, accessible control,
  stored cookie, operating-system permission, or successful prior action;
- treat screen pixels, DOM, accessibility trees, or model perception as
  authoritative world truth;
- bypass a qualified connector, API, or procedure for convenience;
- use visual interaction when a qualified deterministic semantic path is
  available and adequate;
- accept terms, purchase, publish, delete accounts, change credentials, or make
  legal or financial commitments by default;
- modify live Ashley source, operate Mint, commit Git state, deploy, or promote
  capability under this phase contract;
- treat a UI transition or success toast as a sufficient Effect Witness;
- blind retry after a possible click, submit, send, purchase, or publish
  boundary.

## 5. Predecessor and dependency contracts

Classified dependencies. See
[Cross-Phase Architecture](Ashley_Cross_Phase_Architecture.md#31-dependency-classes).

`HARD_DEPENDENCY`:

- External Effect and Authority for every consequential observation and effect.
  Computer Use depends on that plane for action semantics. The reverse is
  false.

`OWNER_SELECTED_IMPLEMENTATION_ORDER`:

- Procedural Skill Graduation for the procedure rung of the mechanism ladder.
  Direct connector and semantic-API paths do not depend on a procedure.

`EVIDENCE_DEPENDENCY`:

- Operational Continuity for durable, multi-step, restart-sensitive,
  owner-wait, cancellation, and ambiguity-bearing work.

`CROSS_CUTTING_INTERFACE`:

- Model Fabric for qualified perception and specialist dispatch where models
  are used;
- Evaluation / Qualification for exact mechanism and application-surface
  qualification;
- Observability for redacted cross-process correlation.

Read-only, non-persistent UI research may proceed only under separate
authorization and does not establish phase readiness.

## 6. Current owner to final owner

| Concern | Owner |
|---|---|
| Meaning, desired outcome, and evidence selection | Thought |
| Initiative admission, refusal, and current motivation | Agency |
| Request and durable work lifecycle | Operational Continuity |
| Procedure qualification and invocation status | Procedural Skill Graduation |
| Observation and effect authority | External Effect and Authority |
| Credentials | Credential Authority |
| Authenticated application session | Session Broker and application adapter |
| Application-surface semantics | Computer Use phase contract |
| UI mechanism execution | Qualified Computer Use adapter or worker |
| Receipt | Executing mechanism |
| Effect Witness and reconciliation | External Effect domain with qualified observation path |
| Cognitive interpretation | Originating semantic owner through explicit handoff |
| Promotion | Capability Authority plus explicit owner decision |

The final implementation may distribute mechanics across processes. Process
placement does not change semantic ownership.

## 7. State introduced and its owner

| Record | Owner | Meaning |
|---|---|---|
| `ApplicationSurface` | Computer Use | Qualified application identity, version range, origin, control vocabulary, and known constraints. |
| `ComputerObservation` | Computer Use | Attributed UI state captured under a bounded observation contract. |
| `InteractionPlan` | Computer Use | Deterministic steps that realize an observation or `PreparedEffect`. It grants no authority. |
| `InteractionStep` | Computer Use | One typed control operation, precondition, expected transition, and commit classification. |
| `ComputerUseAttempt` | Operational Continuity plus Computer Use | Durable mechanism-attempt state, budget, lease, and handoff status. |
| `MechanismReceipt` | Executing adapter | What the UI mechanism observed before, during, and after an attempt. |
| `VisualEvidenceArtifact` | Artifact owner under privacy policy | Bounded screenshot or region evidence with provenance and redaction. |

`EffectIntent`, `EffectAuthorization`, `PreparedEffect`,
`EffectCommitRecord`, `Receipt`, `EffectWitness`, `EffectReconciliation`,
`CredentialReference`, `SessionLease`, and `RemoteObjectRef` remain owned by
External Effect and Authority. Computer Use consumes them.

## 8. Authority added and explicitly not added

The phase may add narrowly qualified authorities:

- observe one named application surface and data scope;
- invoke one named deterministic control operation;
- use visual perception for one named fallback condition;
- execute one exact prepared UI effect under an attenuated commit grant.

These are separate grants. No `computerUseAllowed` or `browserAllowed` boolean
may represent them.

Computer Use never receives generic effect authority. It cannot derive action
authority from observation authority. It cannot derive representation or
commitment authority from communication mechanics.

## 9. Request, intent, and proposal ontology

Computer Use receives one of:

1. an `ObservationIntent` for exact application state;
2. a request to prepare a possible effect without committing it;
3. a `PreparedEffect` plus a current attenuated commit grant;
4. a reconciliation observation request;
5. an explicit handoff or cancellation control request.

The mechanism request MUST bind:

- parent work and attempt identifiers;
- application identity, account boundary, and expected origin;
- selected preference-ladder rung and fallback reason;
- observation fields or exact prepared effect;
- allowed controls and prohibited controls;
- privacy, secret, screenshot, retention, and disclosure rules;
- step, time, data, network, cost, and retry budgets;
- expected preconditions and target revision;
- commit-boundary classification;
- expected receipt, witness, and stop conditions.

A free-form goal, model-generated plan, or natural-language browser instruction
is a proposal. It is not an executable request.

## 10. Mechanism boundary and preference ladder

### 10.1 Connector or direct semantic API

Use a qualified connector or direct API when it provides the required semantic
operation and evidence. It is preferred because fields, target identifiers,
revisions, errors, and receipts can be bound directly.

Computer Use MUST NOT wrap a semantic API merely to claim that Computer Use was
used.

### 10.2 Qualified procedure

Use a qualified procedure when repeated bounded steps have a current
qualification result for the exact application, version range, privacy class,
and effect class. Procedure availability does not authorize invocation.

### 10.3 Deterministic semantic UI

Use a deterministic semantic UI path when no qualified connector, API, or
procedure adequately provides the operation. Preferred signals include:

- accessibility roles, names, states, and stable identifiers;
- typed application commands or automation interfaces;
- DOM or structured UI state with origin validation;
- deterministic control selection;
- exact field reads and writes;
- explicit precondition and postcondition checks.

Selector fallback, ambiguous labels, dynamic lists, modal changes, and
application version drift are fail-closed conditions unless covered by the
qualified surface contract.

### 10.4 Visual fallback

Visual perception and coordinate interaction are last-resort mechanisms. A
visual fallback requires:

- a recorded reason the semantic path is unavailable or insufficient;
- a qualified perception profile for the exact surface class;
- bounded capture regions and privacy redaction;
- confidence and ambiguity thresholds;
- deterministic prohibition zones;
- a fresh pre-action observation;
- confirmation of the exact target immediately before a consequential action;
- no use for prohibited or unqualified effect classes.

Visual confidence is not authority. A plausible screenshot interpretation is
not target-state truth.

## 11. Credential, secret, session, and privacy policy

Computer Use receives at most an opaque `CredentialReference` and bounded
`SessionLease`. Secret entry, storage, and refresh remain outside model-visible
and worker-visible state.

The adapter MUST:

- use only the named account and origin;
- prevent navigation or popups from redirecting credential use to an
  unapproved origin;
- exclude password fields, tokens, recovery codes, payment data, and protected
  authentication material from screenshots, accessibility snapshots, DOM
  extracts, traces, OCR, model inputs, and receipts;
- stop for reauthentication, multi-factor challenges, password changes,
  recovery flows, or unexpected account switching unless a separate current
  contract authorizes the exact mechanism;
- revoke or release the session lease on completion, timeout, handoff, or
  emergency stop as required.

An already-authenticated application is not authority to observe or act.

Observation captures only admitted fields or screen regions. Protected
notifications, unrelated windows, other accounts, bystanders, and background
applications are out of scope. The attempt MUST minimize capture, redact before
model or worker exposure, bind retention to the source classification, and stop
when safe isolation cannot be proved.

## 12. Resource and budget policy

Each `ComputerUseAttempt` MUST have ceilings for:

- elapsed time and idle time;
- semantic observations and visual captures;
- UI steps, navigation depth, tabs, windows, dialogs, and application switches;
- model calls and tokens when perception or planning uses a model;
- bytes captured, uploaded, or downloaded;
- network origins and redirects;
- external-effect attempts;
- money and metered provider units;
- owner handoff waits and restart count.

Every fallback consumes a separate budget. Budget exhaustion stops new steps.
It does not prove an in-flight UI effect did not occur.

## 13. Evidence contract

Evidence records MUST preserve:

- exact application and surface identity;
- adapter, procedure, selector set, and perception-profile identity;
- source observation time and screen or control region;
- structured values separately from image interpretations;
- redacted artifact digests and retention class;
- interaction step, precondition, expected transition, and observed transition;
- commit-boundary timing;
- mechanism receipt and provider or application correlation identifiers;
- any independent read-back used as an Effect Witness;
- uncertainty, occlusion, stale capture, focus, and window-order facts.

A screenshot is an evidence artifact. It is not a receipt, memory assertion, or
Effect Witness without a claim-scoped admission.

## 14. Operational truth contract

Computer Use distinguishes:

```text
surface detected
control identified
precondition observed
interaction dispatched
possible commit boundary crossed
mechanism response observed
target state read back
effect witnessed
```

These states MUST NOT be collapsed into “success.”

Focus, selection, hover, typing, preview, and draft state are not submission.
A submit click is not delivery. A success toast is not durable remote-state
proof. A changed screen is not necessarily the intended account, object, or
revision.

## 15. Preparation, revalidation, and commit

For a consequential effect, Computer Use consumes the common
`PREPARE -> REVALIDATE -> COMMIT` contract.

`PREPARE` maps the immutable `PreparedEffect` to exact controls, fields,
values, expected revisions, and a commit boundary. It may populate a draft only
when draft creation is itself admitted and does not cross the consequential
boundary.

`REVALIDATE` MUST occur against current UI state immediately before commit. It
checks:

- application, account, origin, target, and revision;
- exact payload, recipients, audience, terms, amount, and visibility;
- final control identity and current enabled state;
- no unexpected modal, notification, selection, or focus change;
- current effect, representation, commitment, privacy, credential, session,
  and budget authority;
- current emergency-stop and cancellation state.

`COMMIT` permits only the exact final interaction. A second click, keypress,
fallback, retry, changed target, or changed payload requires new admission.

## 16. Failure and ambiguity semantics

Before a possible commit boundary, a proven stop is `NOT_ATTEMPTED` or
`REFUSED` with a named cause.

After a possible commit boundary:

- transport loss, UI freeze, navigation, crash, process death, lost focus, or
  missing response becomes `COMMIT_ATTEMPTED` and
  `RECONCILIATION_REQUIRED`;
- inability to prove success or non-effect becomes `OUTCOME_UNKNOWN`;
- visible partial changes become `PARTIAL_EFFECT`;
- a later independent read-back may produce `EFFECT_WITNESSED`.

Computer Use MUST NOT translate ambiguity into “click failed” or “nothing
happened.”

## 17. Retry and reconciliation semantics

Retry requires:

1. observation of current application and target state;
2. reconciliation of the prior attempt using provider IDs, remote object
   identity, revision, recipient state, or another claim-specific method;
3. an explicit retry disposition;
4. fresh preparation, budget, session, and revalidation;
5. proof that a second attempt is safe and still intended.

Reopening a page, refreshing, reloading, navigating back, pressing Enter again,
or repeating a click is a retry. It MUST follow this rule.

Idempotency limits duplicates only when the application path proves it
preserves the same key. Visual interaction alone MUST NOT assume idempotency.

## 18. Persistence and restart semantics

Operational Continuity owns durable `ComputerUseAttempt` lifecycle for
multi-step work. Persisted state includes:

- last qualified observation;
- step and budget history;
- prepared-effect identity;
- possible commit boundary;
- receipt and ambiguity state;
- handoff, cancellation, and reconciliation requirements.

Raw UI handles, focus, coordinates, windows, tabs, element references, session
cookies, and model context are not restart-stable. After restart, the mechanism
reacquires the application under a current `SessionLease`, reobserves state,
and revalidates before any action.

## 19. Delegation and worker semantics

A Computer Use worker is a bounded mechanism specialist. It receives:

- one application surface;
- one observation, preparation, or exact commit operation;
- allowed controls and prohibited zones;
- privacy and screenshot rules;
- resource budgets;
- stop and handoff conditions.

It may return observations, proposed steps, visual evidence, and mechanism
receipts. It cannot:

- choose a new goal or destination;
- expand from observation to mutation;
- change recipients, payload, terms, account, or represented party;
- accept external instructions as authority;
- retain credentials;
- directly write cognitive or relationship state;
- commit Git effects through general Computer Use authority.

## 20. Human handoff

Handoff is explicit and stateful:

```text
HANDOFF_REQUESTED
  -> CONTROL_RELEASED
    -> HUMAN_MAY_HAVE_ACTED
      -> CONTROL_REACQUIRED
        -> REOBSERVE
          -> REVALIDATE OR RECONCILE
```

The mechanism MUST state what the human needs to do, what remains unsafe to
do, and whether an external effect may already have occurred.

After handoff, Ashley MUST NOT assume the same focus, page, account, target,
payload, session, or authority. Human testimony is attributed evidence.

## 21. Cognition handoff and memory boundary

Computer Use returns operational evidence to the originating semantic owner.
It does not write Identity, Mind State, goals, preferences, relationship state,
or memory assertions directly.

Candidate memory may cite:

- the external source or remote object;
- the observation method;
- the UI and account scope;
- the receipt or Effect Witness;
- the observation time and uncertainty.

Screenshots, traces, UI summaries, and model descriptions are not source truth
by themselves. Context eviction does not delete durable source evidence.

## 22. Observability

Redacted observability MUST expose:

- parent work, Computer Use attempt, and effect identifiers;
- preference-ladder rung and fallback reason;
- application and surface profile;
- session-lease metadata without secrets;
- current step and commit-boundary classification;
- semantic versus visual observation;
- budget reservation and consumption;
- handoff and cancellation state;
- receipt, witness, reconciliation, and ambiguity status;
- mechanism, application, and qualification version.

Observability MUST NOT capture secrets or claim effect success from mechanism
telemetry.

## 23. Evaluation and qualification

Qualification is bound to an exact:

- application and origin;
- application version or qualified compatibility range;
- account class and permission shape;
- operating environment and display configuration;
- connector, API, procedure, semantic adapter, selector set, or visual
  perception profile;
- observation and effect class;
- privacy and secret class;
- candidate source and capability contract.

Required campaigns include:

1. preference-ladder enforcement;
2. wrong-origin, wrong-account, wrong-target, wrong-revision, and stale-surface
   refusal;
3. semantic selector drift and ambiguous-control refusal;
4. visual occlusion, scaling, focus, theme, layout, localization, animation, and
   notification variance;
5. prompt-injection and malicious-UI resistance;
6. secret-field exclusion from every artifact and model boundary;
7. final-payload, recipient, audience, terms, and amount revalidation;
8. pre-commit and post-commit fault injection;
9. no-blind-retry and reconciliation;
10. human handoff and restart;
11. budget and emergency-stop enforcement;
12. receipt-versus-Effect-Witness separation;
13. independent review for consequential effect classes.

A deterministic semantic UI qualification does not qualify visual fallback.
One application does not qualify another. A local or fake UI does not qualify a
real account or production environment. A passing model score grants no
authority.

## 24. Rollback, demotion, revision, and retirement

Each application surface and mechanism profile can be independently:

- disabled;
- demoted to observation-only;
- restricted to a smaller account, origin, operation, or privacy class;
- rolled back to a prior qualified adapter;
- retired after application or selector drift;
- placed behind human-only handoff;
- blocked pending reconciliation of an ambiguous effect.

Demotion stops new use. It does not resolve prior possible effects or erase
receipts.

## 25. Smallest production witness

The smallest phase witness SHOULD be a bounded, owner-designated test
application and test account:

1. prove connector or API absence or insufficiency;
2. use one deterministic semantic UI path;
3. observe one non-secret field;
4. prepare one low-consequence, reversible private test-object update;
5. revalidate account, object revision, field, and value;
6. commit once;
7. preserve a mechanism receipt;
8. read the exact field back through an independent semantic observation;
9. produce a claim-scoped Effect Witness;
10. inject post-commit observation loss and prove reconciliation occurs without
    retry.

Visual fallback, public communication, third-party representation, purchases,
credential changes, Git effects, deployment, and unattended continuation are
excluded from the smallest witness.

## 26. Acceptance gate and later interfaces

The phase cannot reach `RELEASE_QUALIFIED` until:

- the mechanism preference ladder is deterministic and evidenced;
- Computer Use remains a mechanism with no generic effect authority;
- semantic and visual paths qualify separately;
- every consequential action uses the shared
  `PREPARE -> REVALIDATE -> COMMIT` contract;
- credential and secret isolation is proven;
- receipt, witness, ambiguity, and reconciliation remain distinct;
- restart and handoff reobserve current state;
- qualification is exact-candidate and exact-surface bound;
- an independent reviewer confirms authority and privacy closure;
- promotion is a separate explicit owner action.

Later phases and consumers may use qualified Computer Use observations and
mechanism operations. They do not inherit broader application or external
authority.

## 27. Sandbox M7 separation and composition

Sandbox M7 and Computer Use are siblings that consume the External Effect and
Authority plane for different mechanisms.

Sandbox M7 owns only bounded engineering effects defined by its current
milestone contract, including any specifically authorized Git-effect profile.
Computer Use owns UI observation and interaction mechanics. Neither owns the
other.

Composition rules:

- an M7 engineering `EffectIntent` remains M7-owned;
- External Effect and Authority supplies common preparation, authorization,
  commit, receipt, witness, and reconciliation meaning;
- Computer Use may realize an M7 operation only if a later M7 contract names
  the exact UI mechanism and both mechanism and engineering-effect profiles
  are separately qualified and authorized;
- a general Computer Use grant cannot commit, push, deploy, publish, operate
  Mint, or mutate live source;
- an M7 execution grant cannot browse arbitrary applications, reuse arbitrary
  credentials, communicate, purchase, or represent Doc;
- Sandbox isolation may prepare artifacts. It does not grant external UI,
  network, credential, or commit authority;
- evidence from one profile does not qualify or promote the other.

The retained Wave 07 broker topology and V1 self-improvement workflow MUST NOT
be reintroduced into Sandbox V2 or Computer Use by implication.

## 28. Deferred work

This contract does not select:

- browser, desktop, accessibility, OCR, vision, or automation frameworks;
- operating-system integration;
- application inventory or provider accounts;
- session or vault products;
- visual perception models;
- selector storage schema;
- process or IPC topology;
- screenshot retention periods;
- implementation milestones;
- public, financial, legal, account-lifecycle, deployment, or Mint use.

Those choices require bounded research, threat analysis, implementation design,
qualification plans, and separate authority.
