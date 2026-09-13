# Project Ashley Observability Plane

**Status:** `AUTHORITATIVE`

**Date:** 2026-08-21

**Scope:** Cross-cutting observability architecture. No exporter, backend,
provider, runtime change, deployment, or telemetry collection is authorized by
this document.

## 1. Purpose

Observability makes Ashley's state, authority, work, effects, and failures
inspectable without becoming a source of meaning, evidence, memory, or
permission.

```text
OBSERVABILITY
  != EVALUATION
  != QUALIFICATION
  != PROMOTION
  != MEMORY
  != EFFECT WITNESS
```

Hard laws:

```text
TELEMETRY IS NOT EVIDENCE.
PROVENANCE IS NOT TRUTH.
TRACE IS NOT RECALL.
LOG PRESENCE IS NOT EVENT AUTHORITY.
SPAN COMPLETION IS NOT SEMANTIC COMPLETION.
RECEIPT IS NOT EFFECT WITNESS.
```

Observability is not the Event Spine. A future spine may carry Observability
correlation IDs. It does not replace owner ledgers or this plane. Historical
“Event Fabric” is not this plane.

## 2. Ownership model

Observability does not create one global event authority. Each semantic owner
owns the facts it emits.

| Layer | Owner | Role | Authority |
|---|---|---|---|
| Semantic ledger | Domain owner: Agency, Memory, Delivery, Capability, Operational Continuity, External Effect, and others | Authoritative domain transitions and exact records | Domain-specific only |
| Evidence record | Evidence or qualification owner | Scope-bound proof material | No automatic promotion |
| Owner diagnostic projection | Domain owner plus owner-authenticated API | Redacted, bounded inspection of current records | Read-only |
| Correlation telemetry | Observability Plane | Links events and attempts across processes | None |
| Export adapter | Generic telemetry mechanism | Transports redacted metrics, logs, or traces | None |
| Backend | Operator-selected mechanism | Stores, queries, and visualizes exported telemetry | None |

A backend may report that a span ended. It may not assert that Ashley decided,
remembered, believed, delivered, forgot, gained authority, completed a concern,
or produced an external effect.

## 3. Current implementation boundary

Current source already provides substantial owner-specific observability:

- minimal public `GET /health` readiness;
- owner-only nuclear health, decision, Reflection, episode, cognition,
  revision, continuity, relationship, capability, identity-review, status,
  engineering, and pending-delivery surfaces;
- durable attention requests and usage records;
- delivery reservations, bubble receipts, and finalization;
- capability events, qualification bindings, promotion, rollback, and cutover
  audit;
- bounded Thought validation telemetry;
- Sandbox V2 operational licenses, observations, receipts, and operational
  truth derivation;
- external-action state and receipt records;
- process logs for diagnosis.

This is `SOURCE-DERIVED CURRENT FACT` for the current worktree. It is not a
claim that one unified trace contract or external exporter is implemented.

## 4. Correlation identities

One identifier must not collapse distinct semantic layers.

| Identity | Meaning | Must not become |
|---|---|---|
| `correlationId` | Bounded diagnostic link across one causal flow | Entity identity, authority, evidence |
| `traceId` / `spanId` | Telemetry transport identity | Concern, attempt, model, worker, or effect identity |
| `entityUuid` | Stable targetable domain entity identity | Trace identity or permission |
| `decisionId` | Agency/Thought decision identity | Work or effect completion |
| `deliveryReservationId` | Delivery transaction identity | Human receipt or semantic success |
| `modelAttemptId` | One Model Fabric attempt | Specialist session, worker, or Thought identity |
| `specialistSessionId` | Bounded specialist-work correlation | Ashley, worker activation, or authority container |
| `workConcernId` | Durable operational container | OpenConcern or goal |
| `workAttemptId` | One bounded operational pass | Model request or effect |
| `workerSessionId` | Durable operational worker identity | SpecialistSession or cognitive identity |
| `workerActivationId` | One live residency epoch | Durable authority after release |
| `effectIntentId` | Proposed consequential effect | Commit, receipt, or witness |
| `effectCommitId` | Commit-boundary record | Verified effect |
| `effectWitnessId` | Claim-specific observation record | General truth beyond its claim |
| `qualificationResultId` | Exact qualification result | Promotion or deployment |

### 4.1 Cross-process propagation

A propagation envelope may contain only the minimum identifiers required for
correlation and current policy enforcement. It must be versioned, bounded, and
sanitized.

It may carry:

- correlation and parent correlation identifiers;
- exact domain identifiers already authorized for the recipient;
- contract, build, profile, and capability-release references;
- privacy classification;
- sampling decision;
- bounded origin and attempt type.

It must not carry:

- raw prompts, messages, source evidence, credentials, secrets, chain of
  thought, or unbounded tool output;
- an authority grant inferred from a trace field;
- a generic serialized Ashley state snapshot;
- owner-private identifiers when the receiving mechanism does not need them.

The recipient must revalidate current authority. Correlation propagation does
not preserve permission across a process boundary or restart.

## 5. Event and span ownership

The component that owns a semantic transition writes the semantic record. A
telemetry adapter may observe the committed result and emit a derived span or
metric.

```text
DOMAIN TRANSITION
  -> AUTHORITATIVE DOMAIN RECORD
    -> REDACTED DIAGNOSTIC PROJECTION
      -> OPTIONAL TELEMETRY EXPORT
```

The order must not be reversed. An exported span cannot be the sole commit
record for delivery, memory materialization, capability promotion, effect
commit, or reconciliation.

Partial work may emit telemetry. Partial telemetry must remain explicitly
partial and may not imply a committed model result, worker output, artifact,
delivery, or effect.

## 6. Lifecycle correlation

The target causal chain is:

```text
incoming event
  -> Agency / Thought decision
    -> Model Fabric specialist attempt
      -> Operational Continuity concern / attempt
        -> worker session / activation
          -> capability use
            -> artifact or prepared effect
              -> commit record
                -> receipt
                  -> Effect Witness or reconciliation
```

Not every flow includes every stage. Missing stages must remain absent rather
than synthesized. Correlation joins records; it does not invent lifecycle
facts.

## 7. Privacy, redaction, and sanitization

Observability uses a stricter disclosure posture than the underlying semantic
store because telemetry is easier to aggregate and export.

- Public health remains minimal.
- Rich diagnostics remain owner-only.
- Export allowlists are closed and schema-versioned.
- Raw message text, prompt content, source documents, tool output, credentials,
  secrets, private relationship content, and identity-review prose are denied
  by default.
- Error messages are mapped to bounded error classes before export. Raw
  provider bodies, process command lines, environment variables, file content,
  and URLs containing query secrets are not exported.
- Hashes may support correlation. A hash does not automatically anonymize
  low-entropy or owner-identifying data.
- Sampling must never be used to decide whether an authoritative event is
  recorded. Only derived telemetry may be sampled.

## 8. Retention, sampling, and cardinality

| Concern | Contract |
|---|---|
| Semantic retention | Owned by the semantic domain and Continuity. Telemetry retention cannot delete or preserve semantic state. |
| Telemetry retention | Operator policy, bounded by privacy classification and incident needs. |
| Sampling | Deterministic or policy-driven for derived telemetry only. Error and ambiguity sampling may be higher, but still bounded. |
| Cardinality | Unbounded owner text, URLs, artifact paths, model output, stack traces, and external IDs are not metric labels. |
| Aggregation | Aggregates must retain enough scope to avoid mixing candidates, environments, releases, owners, or qualification campaigns. |
| Forgetting | Forgetting targets semantic and derived data through their owning contracts. Expiring telemetry alone is not forgetting. |

## 9. Relationship to current contracts

### 9.1 OperationalClaimLicense

`OperationalClaimLicense` is current-turn cognitive authorization to describe a
bounded operational result. It is not telemetry. Observability may correlate
its identifiers and outcome class after privacy checks. A trace must not create
or widen a license.

### 9.2 Evaluation and Qualification

Evaluation may consume exported telemetry as one input when the
`EvaluationDefinition` names the source, schema, candidate, completeness, and
known sampling. Qualification must bind primary evidence, not rely on a
dashboard screenshot or backend success state.

```text
TELEMETRY AVAILABLE
  != EVALUATION COMPLETE
  != QUALIFICATION PASS
  != RELEASE_QUALIFIED
```

### 9.3 Memory and evidence

Trace records are operational observations. They are not Memory Source
Evidence, Memory Assertions, Retrieval Projections, or Recall Context by
default. A semantic owner may admit a bounded fact through the normal evidence
and provenance contract. The trace itself remains telemetry.

### 9.4 Effect reconciliation

Correlation must preserve the chain from effect intent through commit attempt,
receipt, witness, and reconciliation. A complete trace does not resolve
`OUTCOME_UNKNOWN`. Only current target-state observation or another accepted
claim-specific witness can do that.

### 9.5 Model Fabric receipts

Model Fabric receipts are mechanical facts. Observability may correlate them.
They must be able to answer, after the fact: logical role, route, model,
backend, provider, tokens, fallback class, latency, outcome, qualification
identity. They must not persist hidden chain-of-thought. A receipt is not
qualification or promotion.

Current Attention surfaces cannot yet answer total token pressure by Ashley
workload (`GET /nuclear/attention` is Mistral-default TPM/RPS;
`foldAttentionDailyUsage` is test-only). Fabric should make retrospective
accounting possible without claiming Mint percentages in advance.

## 10. Mechanism dispositions

| Mechanism | Architectural role | Disposition |
|---|---|---|
| OpenTelemetry API / SDK | Candidate standard for trace, metric, log, context-propagation, and exporter mechanics | `MECHANISM CANDIDATE`; not a required semantic interface and not selected by this contract |
| OpenInference | Candidate convention for model, retrieval, and tool telemetry fields | `REFERENCE / SPIKE REQUIRED`; must be reduced to Ashley's privacy and identifier contract |
| Phoenix | Candidate local analysis and visualization backend | `OPTIONAL BACKEND`; no semantic, evaluation, or qualification authority |
| Current owner-only JSON endpoints | Current diagnostic projections | `CURRENT IMPLEMENTATION`; remain Ashley-owned |
| Current domain ledgers | Current semantic records | `CURRENT IMPLEMENTATION`; not replaceable by telemetry |

Ashley should expose a small internal telemetry port only when a concrete
consumer and privacy contract justify it. That port should use Ashley-owned
event classes and accept optional adapters. It must not require OpenTelemetry
types inside semantic domain contracts.

## 11. Failure semantics

- Telemetry emission failure must not roll back an already committed semantic
  transition unless the phase contract explicitly makes audit durability part
  of the safety commit.
- When audit durability is safety-critical, the domain owns that audit record.
  It is not an optional exporter event.
- Export failure is surfaced as observability degradation, with bounded local
  accounting. It does not trigger automatic repetition of a model, tool,
  delivery, or external effect.
- Cross-process propagation loss starts a new telemetry root with a link to any
  safely known domain identity. It must not fabricate parentage.
- Backend unavailability must not select a different model, provider, worker,
  effect path, or capability policy.

## 12. Evaluation and qualification

An Observability implementation must prove:

1. semantic ledgers remain authoritative when export is disabled;
2. no exported field grants authority or changes behavior;
3. owner/private content and secrets are absent from allowed exports;
4. sampling changes telemetry volume only;
5. cross-process correlation preserves distinct domain identities;
6. restarts and partial spans do not claim semantic completion;
7. cardinality is bounded under adversarial identifiers and errors;
8. `OUTCOME_UNKNOWN` remains unresolved by trace completion;
9. public health remains minimal and owner diagnostics remain authenticated;
10. Evaluation and Qualification bind the exact telemetry schema and candidate
    when telemetry is used.

The smallest production witness is one owner-authorized, redacted causal flow
correlated across the agent service and one local mechanism, with semantic
records independently proving every claimed transition. A backend display is
supporting evidence only.

## 13. Deferred work

- exporter and backend selection;
- trace retention durations and sampling rates;
- deployment topology;
- an OpenTelemetry conformance spike;
- OpenInference field mapping;
- Phoenix or another backend trial;
- production alerting and incident-response policy.
