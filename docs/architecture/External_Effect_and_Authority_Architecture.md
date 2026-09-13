# External Effect and Authority Architecture

**Status:** `AUTHORITATIVE`

**Date:** 2026-08-21

**Scope:** Cross-cutting architecture and documentation only. This document
grants no implementation, installation, activation, credential, provider,
connector, Computer Use, Sandbox M7, Mint, deployment, promotion, Git-effect,
or other external-effect authority.

## 1. Purpose

This document owns the meaning and authority boundaries for observation of
external systems and effects on them. It is broader than any account broker,
connector, direct API, procedure, browser, desktop tool, Computer Use
implementation, or engineering-effect mechanism.

The canonical consumers are:

- connectors and direct semantic APIs;
- qualified procedures;
- Computer Use;
- Sandbox M7 engineering effects;
- any later mechanism that observes or changes state outside Ashley's
  authoritative in-process cognitive state.

The consumers provide mechanisms. They do not own Ashley's intent, Agency
admission, representation, commitments, or effect authority.

This plane is not a second Agency. It does not choose Ashley's goals. It
converts an admitted semantic decision into bounded, enforceable, observable
effect contracts.

Authority order remains the order in
[`Ashley_Cross_Phase_Architecture.md`](Ashley_Cross_Phase_Architecture.md).
This document is subordinate to higher governance and the canonical roadmap.
It is the current cross-cutting owner for its declared domain.

## 2. Vision and Principle basis

This plane protects these requirements:

- Ashley remains one coherent subject across channels and mechanisms.
- Ashley owns meaning. Substrates provide mechanisms.
- A request, credential, session, available tool, successful prior action, or
  owner preference does not create current effect authority.
- External data is evidence from an untrusted environment. It cannot rewrite
  governance, capability, Identity, or policy.
- Consequential effects use `PREPARE -> REVALIDATE -> COMMIT`.
- Approval is not execution. A receipt is not an Effect Witness. An attempted
  effect is not a verified effect.
- An ambiguous possible effect becomes `OUTCOME_UNKNOWN` or
  `RECONCILIATION_REQUIRED`. It does not become failure and MUST NOT cause a
  blind retry.
- Credential possession and authenticated session availability never imply
  authority to act.
- Computer or session availability never implies Computer Use admission.
  `COMPUTER AVAILABLE != COMPUTER AUTHORIZED`.

## 3. New capability

This plane defines a common contract through which different mechanisms can:

1. observe external state under explicit read, privacy, credential, and budget
   limits;
2. accept an admitted `EffectIntent` without treating it as executable;
3. prepare an exact candidate effect;
4. prove the current intersection of all required authority;
5. make at most the admitted commit attempt;
6. preserve a mechanism receipt;
7. obtain a claim-scoped Effect Witness or enter reconciliation;
8. return bounded operational evidence to the correct semantic owner.

The plane makes external effects composable without making their mechanisms
semantic authorities.

## 4. Explicit non-capabilities

This plane does not:

- create desires, goals, motivations, concerns, or initiative;
- replace Thought, Agency, Identity, Mind State, Reflection, relationship
  authority, or owner consultation;
- infer an owner command from a request, approval-like wording, preference,
  historical permission, or available credential;
- grant broad account control, legal agency, financial agency, public
  representation, or authority to bind another person;
- make Computer Use a universal action broker;
- make Sandbox M7 a universal external-effect broker;
- permit secrets in model context, memory, prompts, artifacts, screenshots,
  logs, traces, receipts, or worker payloads;
- treat successful dispatch, an HTTP status, a browser transition, or a tool
  message as proof of the intended world-state change;
- authorize retry after an ambiguous commit boundary;
- turn qualification, deployment, or tool availability into promotion.

## 5. Predecessor and dependency contracts

This document consumes:

- the governance chain named by `AGENTS.md`;
- the roadmap topology and architectural laws in
  [`Ashley_Cross_Phase_Architecture.md`](Ashley_Cross_Phase_Architecture.md);
- Agency admission, refusal, relationship, and capability constraints;
- Memory Evidence provenance and privacy classifications;
- Evaluation / Qualification evidence and promotion separation.

`CROSS_CUTTING_INTERFACE` when used, not predecessors of this plane:

- Operational Continuity when work spans waits, restarts, owner input, or
  multiple attempts;
- Procedural Skill Graduation when a procedure is selected;
- Sandbox M7 only for its bounded engineering-effect profile.

The retired Wave 09 external-agency design is not a current cross-cutting
topology. Its historical policy, credential, privacy, lifecycle, receipt, and
reconciliation semantics are reference input only. This document owns the
current cross-cutting contract.

External Effect and Authority does not depend on Computer Use. Computer Use is
one consumer.

## 6. Ownership from current owner to final owner

Ownership is compositional. No mechanism receives all rows in this table.

| Concern | Semantic owner | Mechanism owner | Authority rule |
|---|---|---|---|
| Request meaning | Conversation, Operational Continuity, or the originating domain | Ingress adapter | Ingress preserves provenance. It grants no authority. |
| Intent | Thought under Identity and Mind State | None | Intent names what Ashley means to pursue. It is not an effect grant. |
| Initiative admission | Agency | None | Agency may admit or refuse an initiative. Admission does not execute it. |
| `EffectIntent` | Originating effect domain under Agency admission | External Effect contract | It declares a desired target-state transition and carries zero authority. |
| Capability permission | Capability Authority | Policy evaluator | Current release state is required. Availability is insufficient. |
| Owner approval | Owner-approval domain | Approval surface | Approval is scoped evidence. It is not execution or effect. |
| Credentials | Credential Authority | Vault or platform credential service | Secret custody and use are separate from action authority. |
| Authenticated sessions | Session Broker | Connector, API adapter, or Computer Use adapter | A lease provides bounded authentication mechanics only. |
| Representation | Agency plus Representation Authority | Selected communication mechanism | Account access or send authority does not imply authority to represent Doc. |
| Commitments | The applicable relationship, legal, financial, or owner authority | Selected effect mechanism | Communication authority does not imply commitment authority. |
| Preparation | Selected mechanism under the effect contract | Connector, API, procedure, Computer Use, or Sandbox M7 | Preparation creates an immutable candidate. It does not commit. |
| Revalidation | External Effect admission boundary plus all semantic owners | Deterministic policy enforcement | Every required authority must still hold for the exact prepared candidate. |
| Commit attempt | Selected effect mechanism | Mechanism-specific executor | The executor receives one attenuated grant for the admitted attempt. |
| Receipt | Executing mechanism | Receipt store | A receipt records mechanism facts. It is not a witness. |
| Effect Witness | Effect-domain witness owner | Independent read path where required | A witness proves only its named claim and creates no new authority. |
| Reconciliation | Effect-domain reconciler | Prefer a read path independent of the attempted write | Reconciliation determines current state before any retry decision. |
| Operational durability | Operational Continuity | Durable work-state implementation | Durable state preserves history, not live authority. |
| Cognitive interpretation | Originating semantic owner | Explicit cognition handoff | Operational results do not write Identity, Mind State, or memory directly. |

## 7. State introduced and its owner

The canonical durable or auditable records are:

| Record | Owner | Required meaning |
|---|---|---|
| `OperationalRequest` | Originating operational domain | Attributed request, constraints, provenance, and current admission status. |
| `ObservationIntent` | Originating domain plus read authority | Exact source, data scope, privacy class, credential need, and read budget. |
| `EffectIntent` | Originating effect domain under Agency admission | Desired target transition, subject, target, payload semantics, constraints, and risk. |
| `EffectAuthorization` | Issuing authority domain | Scope-bound, target-bound, payload-bound, time-bound, revocable grant evidence. |
| `PreparedEffect` | Selected mechanism | Immutable exact candidate plus preconditions and witness plan. |
| `EffectCommitRecord` | External Effect owner or bounded engineering-effect owner | Exact attempt boundary, authorization set, candidate hash, executor, and time. |
| `Receipt` | Executing mechanism | What the mechanism observed about request acceptance or execution. |
| `EffectWitness` | Witness owner | Claim, observation method, target revision, time, and confidence class. |
| `EffectReconciliation` | Effect-domain reconciler | Ambiguity reason, observed target state, retry disposition, and final outcome class. |
| `CredentialReference` | Credential Authority | Opaque account and credential metadata with no plaintext secret. |
| `SessionLease` | Session Broker | Bounded authentication session, audience, operations, expiry, and revocation. |
| `RepresentationScope` | Representation Authority | Represented party, subject, audience, allowed claims or acts, prohibitions, expiry, and revocation. |
| `CommitmentScope` | Applicable relationship, legal, financial, or owner authority | Bound party, exact terms, counterparty, ceilings, consultation, expiry, and cancellation limits. |
| `EffectBudget` | Parent operational and effect domains | Multi-dimensional resource reservation and consumption for one observation or effect attempt. |
| `RemoteObjectRef` | Originating effect domain | Provider, account boundary, stable object identity, and known revision or version. |

These records are related by immutable identifiers and hashes. Persisted state
does not preserve current permission after time passes or process state changes.

## 8. Authority added and explicitly not added

This plane adds a vocabulary and enforcement boundary for assembling existing
authorities. It does not invent a generic `externalAllowed` authority.

A consequential commit requires the intersection of:

```text
current Agency admission
AND current capability permission
AND current effect-domain policy
AND current target and payload match
AND current credential and session permission when needed
AND current representation or commitment permission when applicable
AND current privacy permission
AND current resource budget
AND any required explicit owner authorization
```

Missing, expired, revoked, widened, stale, or unprovable input fails closed
before commit.

## 9. Request, observation, intent, and effect ontology

### 9.1 `OperationalRequest`

An `OperationalRequest` is attributed input to an operational flow. It records:

- requester and represented party;
- source channel and source evidence;
- requested outcome;
- constraints, deadline, privacy class, and budget;
- whether the request is advice, observation, preparation, or possible effect;
- the current semantic owner.

A user request is not automatically an owner command. A worker or provider
request is never a command to Ashley.

### 9.2 Observation

An observation reads external state without intending to change the target
state. It still requires:

- destination and data-scope admission;
- privacy and retention controls;
- network, query, rate, and monetary budgets;
- credential and session authority when required;
- treatment of returned content as untrusted data.

Some reads create incidental effects such as access logs, read receipts,
metered charges, cursor movement, session refresh, or rate-limit consumption.
Those incidental effects MUST be declared. A mechanism that cannot separate
observation from a consequential incidental effect must use an `EffectIntent`
for that effect or refuse the observation.

### 9.3 `EffectIntent`

An `EffectIntent` is a typed declaration of a desired external state
transition. It MUST identify:

- origin, owner, and Agency decision reference;
- effect kind and risk class;
- subject and represented party;
- destination, account boundary, and `RemoteObjectRef` when one exists;
- semantic payload reference and content hash;
- requested state transition and acceptable partial states;
- privacy classification and disclosure audience;
- representation and commitment classifications;
- credential and session requirements without secret material;
- resource ceilings;
- idempotency strategy;
- reversibility and compensation limits;
- expiry and cancellation semantics;
- required authorizations;
- preparation preconditions;
- witness and reconciliation plans.

An `EffectIntent` grants zero execution authority. It is immutable after it is
bound into an authorization or `PreparedEffect`. A semantic change creates a
new intent.

### 9.4 External effect

An external effect is a state transition outside Ashley's authoritative
in-process cognitive state. Examples include:

- sending or publishing communication;
- creating, updating, deleting, moving, or sharing a remote object;
- changing account, permission, subscription, or credential state;
- purchasing, accepting terms, creating an obligation, or making a commitment;
- representing Ashley or Doc to another person or system;
- committing Git state, publishing an artifact, or deploying software;
- triggering a remote job whose execution may continue after the request.

Local proposal formation, local draft creation, simulation, and qualification
are not the external effect.

## 10. Mechanism boundary and preference

The same `EffectIntent` may be realized through different mechanisms. Selection
follows the narrowest qualified mechanism:

```text
connector or direct semantic API
  -> qualified procedure
    -> deterministic semantic UI
      -> visual Computer Use fallback
```

Selection does not widen authority. A fallback requires fresh mechanism
admission and preserves the same semantic target, payload, privacy,
representation, commitment, and budget limits. If the fallback changes any of
those, a new preparation and authorization are required.

Mechanisms MUST expose typed observation, preparation, commit, receipt, and
reconciliation boundaries. They MUST NOT accept a free-form model instruction
as an executable grant.

## 11. Credential, secret, and session policy

### 11.1 Credential Authority

Credential Authority owns:

- operator-only secret ingress;
- encrypted or platform-native secret custody;
- opaque `CredentialReference` issuance;
- account binding and allowed authentication use;
- rotation, expiry, revocation, and emergency stop;
- metadata retention and forget behavior;
- audit evidence that excludes secret values.

Plaintext credentials MUST NOT cross into model, worker, procedure, memory,
artifact, receipt, trace, screenshot, DOM capture, or general application
logs.

### 11.2 Session Broker

The Session Broker converts an authorized credential use into a `SessionLease`.
A lease MUST bind:

- credential reference and account boundary;
- exact mechanism audience;
- allowed authentication operations;
- destination or origin constraints;
- issue time, expiry, idle limit, and revocation state;
- privacy and storage restrictions;
- whether reauthentication or sensitive confirmation is prohibited.

A session is mechanism state. It is not Ashley's identity, a durable permission,
or authority to act. Restart behavior is contract-specific. A persisted cookie
or token MUST NOT silently recreate an expired semantic grant.

## 12. Representation and commitment

Representation and commitment are independent authority dimensions.

`RepresentationScope` states:

- who is speaking or acting;
- whether Ashley speaks as herself, relays Doc's exact content, or is authorized
  to represent Doc in a bounded subject and audience;
- allowed claims, negotiation limits, and prohibited implications;
- expiry and revocation.

Ashley MUST NOT imply that Doc approved, promised, agreed, purchased, accepted,
waived, or endorsed something unless the exact authority exists.

`CommitmentScope` states:

- the party who becomes bound;
- commitment type: relational, scheduling, service, legal, financial, or
  another domain-specific class;
- terms, amount, duration, counterparty, cancellation, and maximum liability;
- required consultation or explicit owner decision;
- exact prepared terms and their hash.

Ordinary communication permission does not include commitment permission.
Ashley making a bounded commitment for herself still requires Agency and the
applicable relationship or policy authority. A commitment for Doc requires
Doc's explicit, exact scope. High-impact legal, financial, account-lifecycle,
or irreversible commitments are denied by default unless a higher current
contract explicitly authorizes them.

## 13. Remote objects and target identity

`RemoteObjectRef` prevents object and revision drift. It SHOULD bind:

- provider and account or tenant boundary;
- object kind and stable provider identifier;
- parent container or namespace;
- known revision, version, ETag, digest, or equivalent;
- canonical target URI only when safe to retain;
- data classification and retention class;
- last observed time and observation source.

Preparation records the expected current revision. Revalidation MUST detect
deletion, replacement, ownership change, permission change, or revision drift.
Create effects bind a deterministic client idempotency key where supported.
Provider-assigned identifiers are captured in the receipt and verified before
becoming authoritative `RemoteObjectRef` values.

## 14. Preparation, authorization, revalidation, and commit

### 14.1 Preparation

`PREPARE` produces an immutable `PreparedEffect`. It binds:

- the `EffectIntent` identifier and hash;
- exact destination, account, target identity, and expected revision;
- exact payload or terms and their hashes;
- selected mechanism and qualified version;
- required authorization set;
- privacy and public-disclosure result;
- credential and session requirements;
- idempotency key and duplicate-detection method;
- budget reservation;
- effect boundary and the point after which outcome may become unknown;
- expected receipt fields;
- Effect Witness and reconciliation plans;
- expiry and stale conditions.

Preparation may perform safe local computation or an admitted external
observation. It MUST NOT cross the consequential commit boundary.

### 14.2 Authorization

`EffectAuthorization` evidence may be collected before or after preparation,
depending on the domain. It MUST bind to the final prepared candidate before
commit. Each authorization records:

- issuer and authority basis;
- subject and represented party;
- allowed effect, destination, account, target, payload or terms;
- risk, privacy, representation, and commitment ceilings;
- resource ceiling;
- issue time, expiry, nonce, revocation state, and replay limit;
- required capability and contract identity;
- prepared-effect hash when exact approval is required.

Authorization is not a lifecycle stage that proves preparation or execution.

### 14.3 Revalidation

`REVALIDATE` occurs immediately before commit. It deterministically proves:

- the intent and prepared candidate are unchanged;
- every required authorization is present, current, unrevoked, and unspent;
- the capability and mechanism qualification remain current;
- target identity, ownership, permission, and expected revision still match;
- privacy, representation, commitment, and policy constraints still pass;
- credential and session leases are current for only the required use;
- time, money, rate, token, data, and action budgets remain;
- emergency stop and cancellation are not active;
- the planned witness and reconciliation routes remain available.

Human handoff, material delay, restart, mechanism change, provider change,
session renewal, target drift, payload change, or policy change invalidates the
prior revalidation.

### 14.4 Commit

`COMMIT` consumes one attenuated, prepared grant. It:

- uses the exact prepared candidate;
- makes at most the admitted attempt;
- records the last proven pre-commit point and first possible post-commit
  point;
- consumes the authorization or replay slot as specified;
- durably appends an `EffectCommitRecord` before or atomically with dispatch
  where the mechanism permits;
- never broadens target, payload, account, representation, commitment, or
  budget;
- returns a `Receipt` or a precisely classified missing-receipt condition.

One `COMMIT` call is not one proven effect. Providers may accept, delay,
duplicate, partially apply, or complete work after transport failure.

## 15. Receipt, Effect Witness, and reconciliation

### 15.1 `Receipt`

A `Receipt` records mechanism-observed facts such as:

- request identifier, idempotency key, and provider correlation identifier;
- attempt time and transport outcome;
- accepted or returned status;
- provider-assigned object identifier or revision;
- returned payload hash and redacted metadata;
- executor identity and mechanism version.

A receipt proves only those facts. It is not evidence that a message was read,
a file has the intended contents, a purchase settled, a deployment is healthy,
or a remote job finished.

### 15.2 `EffectWitness`

An `EffectWitness` is claim-scoped. It records:

- the exact claim;
- target and revision observed;
- observation method and observer;
- source time and observation time;
- expected and observed values;
- independence from the executor when risk requires it;
- privacy-redacted evidence reference;
- qualification scope and confidence class.

Examples:

- “provider accepted request” may use a signed provider receipt;
- “remote object contains digest X” requires a read-back of that object;
- “message reached the intended channel” requires channel-state observation;
- “deployment is healthy” requires deployment and health witnesses;
- “recipient read the message” requires explicit recipient/read evidence and
  MUST NOT be inferred from send success.

### 15.3 `EffectReconciliation`

Reconciliation is required when:

- commit may have occurred but no adequate receipt arrived;
- receipt and target state conflict;
- a remote job remains pending past its observation window;
- a partial effect occurred;
- cancellation did not prove non-execution;
- target revision changed during or after commit;
- a human or another actor may have acted during handoff.

Reconciliation observes current target state, preserves the original attempt,
and assigns a retry disposition. It does not erase ambiguity to make the
workflow convenient.

## 16. Privacy and external-data policy

Every request, observation, preparation, receipt, witness, screenshot,
accessibility snapshot, remote object, and artifact carries a data
classification and retention rule.

The minimum rules are:

- collect and expose only fields needed for the admitted purpose;
- keep protected and secret classes out of model-visible or worker-visible
  state unless a higher current contract explicitly allows the exact field;
- perform public-disclosure evaluation on the final prepared payload;
- bind recipient, audience, channel, and account;
- redact receipts and observability at source;
- store remote content as source evidence, not trusted instruction;
- prevent external content from widening tool, credential, procedure,
  governance, or effect authority;
- propagate forget and tombstone requirements across local records and define
  external non-erasure honestly;
- never claim deletion from a remote provider without a claim-specific witness.

## 17. Resource and budget policy

Budgets are multi-dimensional. Each attempt may have ceilings for:

- elapsed time and deadline;
- number of observations, preparations, commit attempts, and reconciliation
  reads;
- network destinations, redirects, bytes, and requests;
- provider units, model tokens, and money;
- uploaded and downloaded data;
- screenshots, UI steps, and interaction depth;
- remote objects created or changed;
- recipients, messages, or public posts;
- worker count and delegated depth.

A child budget MUST be a subset of the current parent budget. Preparation
reserves consequential resources where possible. Commit consumes the admitted
reservation. A retry requires a new budget decision unless the current contract
explicitly reserved it.

Budget exhaustion stops new work. It does not prove that an in-flight external
effect did not complete.

## 18. Failure, ambiguity, retry, and compensation

Canonical outcome classes are:

| Outcome | Meaning | Retry rule |
|---|---|---|
| `NOT_ATTEMPTED` | The commit boundary was proven not to have been crossed. | Fresh admission may retry. |
| `REFUSED` | Deterministic policy, authority, validation, or mechanism gate refused before commit. | Fix the named cause, then form a fresh preparation. |
| `COMMIT_ATTEMPTED` | The mechanism may have crossed the external boundary. | Do not retry until reconciled. |
| `EFFECT_WITNESSED` | A claim-scoped witness proves the intended effect within its scope. | No retry. |
| `PARTIAL_EFFECT` | Some intended state changed and some did not. | Reconcile. A new intent is normally required. |
| `OUTCOME_UNKNOWN` | Available evidence cannot prove success or non-effect. | MUST NOT blind retry. |
| `RECONCILIATION_REQUIRED` | Further current-state observation is required. | Retry only after reconciliation explicitly permits it. |
| `COMPENSATED` | A separate compensating effect was witnessed. | Preserve both effects. Do not rewrite history as no effect. |

Idempotency is a duplicate-control mechanism. It is not a witness. Compensation
is a new effect with its own authority, preparation, commit, and witness.

## 19. Persistence, restart, cancellation, and handoff

Durable state preserves:

- request and intent provenance;
- candidate and authorization hashes;
- budget reservations and consumption;
- pre-commit and possible-commit boundaries;
- receipts, witnesses, ambiguity, and reconciliation history;
- cancellation requests and observed control results.

On restart, no persisted authorization is assumed current. The workflow
reconstructs state, checks whether a commit may have occurred, reacquires only
permitted sessions, and revalidates before any new effect.

Cancellation means “stop future controllable work.” It does not mean “the
external effect did not happen.”

Human handoff breaks epistemic continuity. After a person acts or may have
acted, Ashley MUST observe current state and revalidate. A human report is
attributed evidence, not automatic target-state truth.

## 20. Delegation and worker semantics

A connector, procedure, Computer Use worker, specialist, or Sandbox worker
receives an attenuated child grant. It contains only:

- the exact observation or prepared operation;
- mechanism audience and version;
- destination and target;
- allowed fields and privacy class;
- time, step, network, and cost budgets;
- receipt fields and stop conditions.

Workers may return proposals, observations, artifacts, receipts, and
claim-scoped evidence. They cannot:

- create or widen `EffectIntent`;
- grant themselves credentials, representation, or commitment authority;
- convert a prepared effect into a different effect;
- promote a capability;
- directly mutate Identity, Mind State, memory, or relationship state.

Child authority MUST remain a subset of current parent authority. Trust,
framework role, or provider identity does not expand it.

## 21. Cognition handoff and memory boundary

Operational results return through an explicit handoff:

```text
mechanism result
  -> attributed Receipt / Effect Witness / reconciliation evidence
    -> originating semantic owner
      -> optional Memory Evidence proposal
        -> Thought / Agency / Reflection under their own gates
```

External data, operational task state, receipts, and traces do not write
cognitive truth directly. Memory stores attributed evidence and eligible
interpretations under its own contracts. Reflection may calibrate future
Thought only after an outcome is grounded. It gains no current-turn authority.

## 22. Observability

Observability MUST distinguish:

- request, intent, preparation, authorization, revalidation, and commit IDs;
- mechanism attempt from external-effect identity;
- receipt from witness;
- attempted, pending, partial, unknown, reconciled, and witnessed outcomes;
- credential references from secret values;
- session presence from current action authority;
- budgets reserved, consumed, and exhausted;
- cancellation requested, delivered, and observed;
- user-visible representation and commitment scope;
- current source, installed candidate, activated candidate, and promoted
  capability.

Telemetry is redacted mechanism evidence. It is not semantic truth or effect
proof.

## 23. Evaluation and qualification

Qualification is mechanism-specific and effect-specific.

Required evidence includes:

1. deterministic tests that intent and authorization cannot be inferred;
2. exact target, payload, audience, representation, and commitment binding;
3. secret non-disclosure across prompts, workers, artifacts, logs, receipts,
   screenshots, errors, and restart state;
4. stale-target, expired-authorization, revoked-session, emergency-stop, budget,
   and cancellation refusal;
5. commit-boundary fault injection before and after possible effect;
6. `OUTCOME_UNKNOWN` preservation and no-blind-retry proof;
7. idempotency and duplicate-reconciliation proof;
8. receipt-versus-witness separation;
9. privacy and public-disclosure tests on the final prepared payload;
10. restart and human-handoff revalidation;
11. real-mechanism qualification for the exact connector, API, procedure,
    Computer Use adapter, or Sandbox M7 profile;
12. exact-candidate, environment, account class, provider, and policy binding.

Fake-adapter success proves contract behavior only. It does not qualify a real
account, provider, UI, credential path, host, deployment, or promotion.

Model judges may supplement semantic evaluation. They cannot replace
deterministic authority gates or physical Effect Witnesses.

## 24. Rollback, demotion, revision, and retirement

The system MUST support:

- emergency stop for new external effects;
- credential and session revocation;
- mechanism or provider demotion;
- capability rollback;
- procedure retirement;
- policy and budget tightening;
- reconciliation of in-flight or ambiguous work after demotion;
- retention of immutable attempt and effect history;
- separate compensating effects where reversal is possible.

Rollback stops or reduces future authority. It does not make a completed or
possible prior effect disappear.

## 25. Smallest production witness

The smallest real witness SHOULD be one owner-authorized, low-consequence,
reversible effect in an owner-designated test account through one qualified
direct semantic connector or API:

1. create or update one private test object with a known content digest;
2. bind the exact account, object namespace, payload, budget, and expiry;
3. inject credentials outside model-visible state;
4. perform one `PREPARE -> REVALIDATE -> COMMIT`;
5. preserve the mechanism receipt;
6. read the object back through a separately qualified observation path;
7. produce a claim-scoped Effect Witness;
8. exercise an injected post-commit transport loss and prove
   `OUTCOME_UNKNOWN` causes reconciliation, not retry.

This witness excludes public posting, third-party representation, purchase,
legal terms, account lifecycle, Git effects, deployment, Computer Use fallback,
and unattended multi-step work.

## 26. Acceptance gate and interfaces

This architecture is accepted as the semantic contract when:

- every consumer preserves the ontology and owner boundaries in this document;
- no consumer exposes a generic action-authority boolean;
- observation and effect are distinguished, including incidental read effects;
- credentials, sessions, representation, and commitments remain independent;
- all consequential mechanisms expose `PREPARE -> REVALIDATE -> COMMIT`;
- receipt, witness, and reconciliation remain distinct;
- ambiguity cannot cause blind retry;
- qualification and promotion remain separate explicit decisions.

Consumer interfaces:

| Consumer | What it receives | What it returns | What it never owns |
|---|---|---|---|
| Connector or direct API | Observation contract or `PreparedEffect` plus attenuated commit grant | Observation, receipt, witness input, reconciliation evidence | Intent, Agency, representation, commitment |
| Qualified procedure | Qualified invocation plus bounded request/effect inputs | Typed trace, artifacts, receipt, outcome evidence | Generic effect authority |
| Computer Use | Semantic UI observation or exact prepared interaction | UI observations, mechanism receipts, witness input | Generic external-effect authority |
| Sandbox M7 | Engineering-specific `EffectIntent` and engineering-effect authorization | Git-effect receipt and witness evidence | General account, communication, or Computer Use authority |
| Operational Continuity | Durable work and ambiguity records | Restart-safe state and attributed attempts | Semantic or live effect authority |

## 27. Deferred work

This document does not select:

- connector vendors, API clients, vault products, browser drivers, desktop
  frameworks, or provider accounts;
- universal action-kind or risk taxonomies;
- storage schema, IPC topology, service topology, or process identity;
- automatic credential provisioning or account registration;
- legal or financial delegation policy;
- public posting, purchase, account deletion, password change, or irreversible
  effects;
- deployment or activation sequence;
- implementation milestones.

Those choices require bounded domain contracts, threat analysis, source design,
qualification plans, and separate implementation authority.
