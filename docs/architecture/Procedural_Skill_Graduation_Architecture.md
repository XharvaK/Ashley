# Project Ashley Procedural Skill Graduation Architecture

**Status:** `CURRENT PHASE CONTRACT`

**Date:** 2026-08-21

**Implementation status:** Planned. The isolated Agent Plugins parser spike is
accepted as a parser/conformance result only. No production procedure registry,
skill runtime, plugin runtime, MCP runtime, installation path, or invocation
authority exists.

**Scope:** Architecture only. No procedure, skill, plugin, MCP server, tool,
dependency, installation, activation, or execution is authorized.

## 1. Purpose

Procedural Skill Graduation converts sufficiently grounded and repeatable
operational experience into an inspectable, versioned, qualified, reusable
procedure without turning repetition, prose, a package, or a model habit into
authority.

```text
experience
  -> candidate procedure
    -> qualification
      -> registration
        -> availability
          -> current invocation admission
            -> execution
              -> outcome evidence
                -> revision or retirement
```

Each arrow is a separate boundary.

## 2. Vision and Principle basis

Procedures reduce repeated mechanical burden so Ashley can spend more attention
on reasons, judgment, curiosity, and relationship rather than reconstructing
known operations. They support growth from experience while preserving truth,
reviewability, and current authority.

The phase must not turn Ashley into a library of owner-command macros or make
external skill prose part of Identity.

## 3. New capability

This phase adds:

- stable candidate-procedure identity;
- evidence-backed graduation;
- typed inputs, outputs, artifacts, effects, and dependencies;
- environment and account binding;
- deterministic and model-backed procedure classes;
- versioning, compatibility, revision, rollback, revocation, and retirement;
- qualification and registration;
- current invocation admission distinct from availability;
- inert external interchange and import quarantine.

## 4. Explicit non-capabilities

```text
SKILL AVAILABLE IS NOT PERMISSION TO INVOKE.
PROCEDURE IS NOT CAPABILITY GRANT.
PROCEDURE IS NOT IDENTITY.
PROCEDURE IS NOT LEARNED AUTONOMY.
REPEATED SUCCESS IS NOT AUTOMATIC GRADUATION.
INSTALLED IS NOT TRUSTED.
RETRIEVED IS NOT AUTHORIZED.
```

The phase does not add:

- Agency goals, preferences, interests, motivations, or initiative authority;
- model, worker, Sandbox, Computer Use, connector, network, credential, account,
  Git, deployment, or external-effect authority;
- automatic creation after a fixed number of repetitions;
- direct prompt injection from imported procedure prose;
- a generic tool registry that bypasses Capability Authority;
- automatic execution, adaptation, promotion, or self-modification.

## 5. Dependencies

Classified dependencies. See
[Cross-Phase Architecture](Ashley_Cross_Phase_Architecture.md#31-dependency-classes).

`EVIDENCE_DEPENDENCY`:

- attributable traces matching the specific procedure's evidence contract.
  General Operational Continuity is required only when that contract needs
  durable attempts, environments, artifacts, effects, or ambiguity. Domain
  receipts may suffice otherwise;
- Sandbox V2 or another qualified execution mechanism for local engineering
  procedures;
- Computer Use only for procedures whose mechanism is UI control, as a
  `CROSS_CUTTING_INTERFACE`.

`CROSS_CUTTING_INTERFACE`:

- Capability Authority and current invocation admission;
- Memory Evidence provenance without treating procedure text as Recall;
- External Effect and Authority for credential, representation, commitment, and
  consequential effect semantics;
- Evaluation / Qualification and Observability planes.

Inert interchange parsing and candidate-schema research may proceed without
those evidence contracts.

## 6. Owners

| Concern | Owner |
|---|---|
| Whether a repeated trace is worth proposing | Ashley semantic owner or explicit owner review flow |
| Candidate procedure identity and lifecycle | Procedure Registry |
| Trace and outcome truth | Origin domain; Operational Continuity when the procedure's evidence contract needs durable attempts |
| Procedure qualification | Evaluation / Qualification Plane with procedure-specific gates |
| Registration and availability | Procedure Registry |
| Current invocation | Capability Authority plus current caller/Agency |
| Execution | Selected qualified mechanism under its own authority |
| External effects | External Effect and Authority or Sandbox M7 engineering-effect owner |
| Learning from outcomes | Reflection / Learned Autonomy through explicit admission |

The Procedure Registry owns procedure semantics. An external package format or
execution substrate does not.

## 7. State model

Canonical lifecycle concepts are:

```text
OBSERVED EXPERIENCE
  -> CANDIDATE
    -> UNDER QUALIFICATION
      -> QUALIFIED
        -> REGISTERED / AVAILABLE
          -> SUSPENDED / REVOKED / RETIRED
```

Revision creates a new immutable version. It does not mutate the qualified
meaning of an old version in place.

### 7.1 CandidateProcedure

A candidate contains the minimum evidence packet:

1. exact trace provenance;
2. typed interface contract;
3. capability and environment dependencies;
4. effect, commitment, representation, and privacy classification;
5. sanitization witness;
6. deterministic positive, negative, and boundary fixtures.

Additional evidence is required where risk or variability demands it. This
six-part minimum is not a guarantee of qualification.

### 7.2 ProcedureDefinition

A qualified definition contains:

- stable procedure ID and immutable version;
- human-reviewable purpose and non-purpose;
- input schema, validation, defaults, and secret-input declarations;
- output schema and artifact contract;
- ordered semantic steps or deterministic operation graph;
- allowed mechanism classes;
- required capabilities and current authority checks;
- environment, project, provider, account, or object bindings;
- model/profile requirements for model-backed steps;
- effect and ambiguity contract;
- resource, timeout, cancellation, and retry policy;
- privacy, retention, provenance, and observability rules;
- qualification binding and known limitations;
- compatibility, supersession, rollback, and retirement metadata.

### 7.3 ProcedureRun

A procedure run is an Operational Continuity concern or attempt bound to one
exact definition version. It does not create a second execution lifecycle.

## 8. Candidate proposal

A candidate may be proposed by:

- deterministic trace analysis;
- Reflection through a bounded proposal;
- Ashley through Thought/Agency when a repeated burden is grounded;
- the owner through an explicit review flow;
- a worker as untrusted candidate input.

No proposer may qualify or register its own output automatically.

The proposer must show why the procedure is reusable across more than one
historical instance. Three successes are neither necessary nor sufficient.

## 9. Deterministic and model-backed procedures

### Deterministic procedure

Every semantic step and parameter transformation is host-defined. Model use is
absent. Qualification focuses on exact behavior, boundaries, effects, and
environment variation.

### Model-backed procedure

The definition may call a named Model Fabric purpose/profile for bounded
classification, extraction, planning, or generation. It must define:

- input and output contracts;
- permitted variability;
- model/profile compatibility;
- validation and bounded repair;
- failure and fallback policy;
- evidence and human-review requirements;
- what the model may not decide.

Model-backed does not mean self-authorizing or semantically opaque.

## 10. Parameterization and binding

Parameters are typed and classified:

- ordinary value;
- owner-private value;
- secret input reference;
- project or source revision;
- provider/account/object reference;
- capability or approval projection;
- artifact reference;
- model/profile selection owned by Model Fabric policy.

A procedure must not embed credentials, transient paths, live session handles,
owner identifiers, exact current SHAs, or environment-specific secrets in its
definition.

Bindings that can drift are revalidated at invocation. A qualified definition
does not make an old environment or account binding current.

## 11. Invocation authority

Invocation requires all of:

1. exact qualified definition and version;
2. current registration and availability;
3. current caller authority;
4. current capability dependencies;
5. valid environment and object bindings;
6. current privacy and secret policy;
7. resource and time budgets;
8. effect-specific authorization and approval;
9. current model/profile compatibility where used;
10. no active revocation, suspension, withdrawal, or emergency stop.

Procedure retrieval only identifies candidates. Deterministic eligibility and
visibility filtering occurs before optional semantic ranking.

```text
available catalog
  -> deterministic authority / visibility filter
    -> optional lexical or semantic ranking
      -> bounded descriptor projection
        -> Thought / caller selection
          -> commit-time revalidation
```

## 12. Execution mechanisms

A procedure may compose qualified mechanisms:

- pure local deterministic code;
- Sandbox V2 operations;
- Operational Continuity workers;
- semantic APIs or connectors;
- Computer Use;
- Model Fabric specialist work;
- owner or human handoff.

The procedure describes how. Each mechanism retains its own authority and
effect boundary. Procedure execution cannot flatten those boundaries into one
generic tool permission.

## 13. Effects and truth

The procedure definition declares each possible effect and its owner. A run
records exact attempts and outcomes through Operational Continuity.

- deterministic local transformation may be retried only under its idempotency
  contract;
- possible external commit follows `PREPARE -> REVALIDATE -> COMMIT`;
- missing observation after possible commit remains `OUTCOME_UNKNOWN`;
- procedure success requires every mandatory result under its completion
  contract;
- a partial result is labeled partial and retains failed or unknown steps;
- executor receipts remain distinct from Effect Witnesses.

## 14. Revision, adaptation, and conflict

Adaptation produces a new candidate version. It does not modify a qualified
version or inherit qualification automatically.

Conflicting versions are resolved by explicit compatibility and selection
policy, not model preference. The registry may designate:

- current recommended version;
- compatible versions;
- suspended or revoked versions;
- supersession reason;
- migration or rollback path.

Project-specific forks remain distinct definitions or bound variants. They do
not silently generalize into a global procedure.

## 15. Revocation, obsolescence, and retirement

Revocation blocks new invocations immediately. In-flight runs follow their
current effect/cancellation contract and may require reconciliation.

Obsolescence signals include:

- dependency contract or model-profile change;
- environment or provider API drift;
- repeated qualification regression;
- privacy or security defect;
- better replacement;
- owner withdrawal;
- no remaining supported consumer.

Retirement preserves versioned provenance and past run identity. It does not
delete source evidence or historical qualification records.

## 16. External interchange

Agent Skills and Agent Plugins may represent or transport inert procedure
metadata. They do not define Ashley's procedure semantics.

The accepted parser spike proves only that Agent Plugins v1.0.0 and Agent
Skills frontmatter can be parsed as bounded, deterministic, inert, untrusted
descriptor data.

Imported content remains:

```text
PARSED
  != ADMITTED
  != QUALIFIED
  != REGISTERED
  != AVAILABLE
  != AUTHORIZED
  != EXECUTED
```

MCP is a possible transport beneath a future Tool Runtime. MCP discovery,
connection, tool metadata, or permission negotiation does not grant Ashley
authority.

## 17. Privacy and security

- Candidate extraction removes credentials, secrets, transient instance data,
  private raw content, and unbounded tool output.
- Imported packages are staged immutably and parsed without process, network,
  placeholder expansion, or prompt injection.
- Capability descriptors exposed to retrieval are sanitized and visibility-
  filtered before ranking.
- Secret inputs use Credential Authority references and never become procedure
  prose or stored defaults.
- Procedure output is untrusted until its owning semantic or effect boundary
  admits it.
- Qualification includes path, package, dependency, prompt, descriptor,
  parameter, and output injection cases.

## 18. Observability

Owner diagnostics expose:

- definition and version;
- lifecycle and availability;
- qualification binding;
- dependency health;
- last bounded invocation outcomes;
- suspension, revocation, and retirement reasons;
- current compatibility warnings.

Run telemetry correlates procedure, Operational Continuity, model attempts,
workers, artifacts, effects, receipts, and witnesses. Telemetry is not
qualification evidence unless a named EvaluationDefinition admits the exact
schema and candidate.

## 19. Evaluation and qualification

Qualification is procedure-specific. It includes:

- interface and schema validation;
- deterministic positive, negative, and boundary fixtures;
- environment and binding variation;
- authority and capability denial;
- secret and privacy non-disclosure;
- resource, timeout, cancellation, and cleanup behavior;
- effect ambiguity and idempotency;
- model variability where applicable;
- rollback and version conflict;
- imported-content quarantine;
- no direct cognitive or capability writes;
- adversarial procedure text and tool output.

A procedure that is safe in one project, account, provider revision, or model
profile is not globally qualified.

## 20. Smallest production witness

One deterministic, non-networked, non-secret, non-effectful procedure must:

1. originate from exact attributed traces;
2. enter candidate review;
3. pass deterministic qualification;
4. register as one immutable version;
5. remain inert until explicit current invocation admission;
6. execute through a bounded Operational Continuity run;
7. emit an attributed local artifact;
8. be revoked and proven unavailable for new invocation;
9. preserve past run provenance.

This witness does not qualify imported skills, MCP, Computer Use, credentials,
external effects, model-backed procedures, or automatic candidate generation.

## 21. Acceptance gate

The phase may be accepted only when:

- procedure identity and lifecycle are independent of package formats;
- candidate evidence is exact and sanitized;
- qualification and registration are separate;
- availability and invocation authority are separate;
- current bindings and capabilities are revalidated;
- execution preserves each mechanism's authority and effect boundaries;
- revision, rollback, revocation, and retirement are proven;
- imported content remains inert until separately admitted and qualified;
- repeated success cannot auto-graduate;
- procedure output cannot directly mutate cognitive owners;
- `RELEASE_QUALIFIED`, deployment, and promotion remain separate.

## 22. Interfaces to later phases

- Computer Use may consume a qualified procedure as one mechanism option.
- External Effect and Authority supplies credentials, representation,
  commitments, and consequential-effect authority.
- Context Budget may retrieve eligible procedure descriptors after
  deterministic filtering when catalog scale justifies it.
- Learned Autonomy may recognize that a repeated burden matters. It does not
  qualify or invoke the procedure.
- Self-improvement governance may consume qualified engineering procedures,
  but procedure availability cannot authorize changes to Ashley.

## 23. Deferred work

- exact schema and storage placement;
- production parser and immutable staging;
- Agent Plugins or Agent Skills version revalidation;
- MCP or Tool Runtime;
- semantic procedure retrieval;
- candidate-generation models;
- connector, Computer Use, or external-effect procedures;
- automatic adaptation;
- production installation and activation.
