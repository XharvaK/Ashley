# Ashley Evaluation / Qualification Plane

**Status:** `AUTHORITATIVE` cross-cutting plane. Implementation is not
authorized by this document. The first evaluation spike waits for Model Fabric
contract implementation and local acceptance.

**Date:** 2026-08-13; Model Fabric delivery-order banner 2026-08-25; Pass-2
qualification-binding closure 2026-08-25

Model Fabric first **code** milestone is **MF-M1** (existing-route seam) in
[`Model_Fabric_Architecture.md`](Model_Fabric_Architecture.md). Owner scope is
closed. Runtime is `PENDING`. This plane still waits for implemented Fabric
profile identity and stage-valid receipts before its own first spike. It does not own routing. Historical Lightning /
Groq 120B strings below are **not** live routes and **not** the MF-M1 roster.

Historical reconnaissance baseline: `82b30a9d218855bd1373121fc5a656a3403b1c85` on `master`. Source inventories and command results bound to that baseline are historical evidence, not current source facts.

Working-tree condition: concurrent, unrelated Sandbox work was present during reconnaissance.

**Authority:** This document owns evaluation, qualification, and promotion-claim
semantics for its domain. It does not authorize implementation, release,
deployment, capability promotion, model-family replacement, or Sandbox
activation.

## Executive decision

Project Ashley should establish a cross-cutting Evaluation / Qualification Plane.

The plane should not be a new runtime authority. It should be an evidence and claim system. Ashley remains the owner of invariant meaning, capability authority, identity, consent, provenance, delivery semantics, and promotion decisions.

The plane should provide four explicit boundaries:

1. **Observability** records what happened.
2. **Evaluation** interprets selected evidence against a versioned definition.
3. **Qualification** binds accepted evidence to a precise source, environment, subject, and claim.
4. **Promotion** is a separate owner-governed action.

The first Evaluation slice should be Node-native, artifact-only, and limited to `MODEL_PROFILE` evidence and qualification. Its architecture may be specified now. Its implementation MUST wait until Model Fabric has implemented its pure contracts, established real profile identity and stage-valid receipt types, and passed MF-M1 local acceptance plus independent closure. Evaluation should then import the real types or consume generated canonical schemas. It should define an Ashley-owned `EvaluationDefinition` contract and `QualificationResult` contract. It should not write to runtime databases, capability ledgers, Identity, Mind State, Recall, or production configuration. Capability qualification remains a downstream governance concern and is not part of this slice.

Inspect AI should be **SPIKED**, not adopted as the plane. It is a useful execution substrate for later model and agent evaluations. It must not define Ashley's invariants, pass semantics, evidence authority, or promotion rules.

## Problem statement

Ashley already has many evaluation and qualification mechanisms. They are distributed across unit tests, deterministic scenario matrices, persona replay, counterfactual harnesses, capability qualification ledgers, offline tests, assurance scripts, Sandbox physical qualification, and live operational checks.

These mechanisms prove different things. Their evidence is not interchangeable.

The current repository does not have one shared contract that answers all of these questions:

- What exact invariant is being evaluated?
- What source revision and dirty state produced the evidence?
- What environment, model profile, provider, resolved model, fixtures, and scorer were used?
- Was the result deterministic, judged, simulated, physically observed, or inferred?
- What bounded claim does a PASS support?
- What remains unverified?
- Can the evidence support a promotion decision?
- Who is authorized to accept that decision?

Without these answers, a green check can be read more broadly than its evidence permits. That is the main architectural risk.

## Governing constraints

This plane derives from the current authority chain:

`VISION.md` → Core Principles → Constitution → Stewardship Compact and Ethics → architecture → prompts → runtime.

The following requirements are non-negotiable:

- Evaluation MUST NOT redefine Ashley's identity or constitutional meaning.
- Evaluation MUST NOT claim to measure personhood, consciousness, sentience, or moral worth.
- Model output MUST NOT become provenance, consent, delivery, capability, Identity, Thought, or Agency authority.
- A test result MUST NOT automatically promote a capability or model profile.
- An isolated fork or replay MUST remain non-authoritative simulation.
- Evaluation data MUST NOT write into live lineage, Recall, Identity, Mind State, or relationship state.
- Evaluation runners MUST NOT gain outbound or production authority merely because they can invoke tools.
- Ashley remains one identity and one Agency authority. Specialist sessions and delegated workers MUST NOT become peer Ashley identities or independent Agency authorities.
- Delegated authority MUST attenuate: `authority(child invocation) ⊆ authority(parent operation)`.
- Connection, authentication, installation, mounting, and availability MUST NOT be treated as authorization or capability grants.
- Context eviction, projection, compression, and cache state MUST NOT become forgetting or authoritative memory mutation.
- Specialist or worker output MUST NOT directly write durable cognitive state. Ashley-owned materialization MUST remain between delegated output and Identity, Recall, goals, salience, OpenConcern, learned human representation, or foundational cognition.
- Model-family changes MUST follow the consultation requirement in `SC-CON-04`.
- Possible external execution or delivery MUST remain `OUTCOME_UNKNOWN`. Only a pre-execution certainty may be `REFUSED`.
- Physical isolation claims MUST be proven at the physical boundary. Source tests and framework sandboxes are insufficient.

## Architectural model

```text
Runtime and test events
        |
        v
Observability records facts and traces
        |
        v
EvaluationDefinition selects evidence and applies versioned scorers
        |
        v
QualificationResult binds the result to source, environment, subject, and claim
        |
        v
Owner-governed review may promote, hold, reject, or request more evidence
```

The arrows do not grant authority in reverse.

- Telemetry does not define an invariant.
- A scorer does not define constitutional meaning.
- A PASS does not promote a capability.
- A promotion does not rewrite the evidence that supported it.

## Invariant families

Ashley should own a versioned invariant taxonomy. Each invariant should have a stable identifier, normative source, scope, evaluation methods, failure meaning, and allowed promotion use.

| Family | What Ashley owns | Representative concerns |
|---|---|---|
| Governance, Identity, and persona | Constitutional constraints and stable identity continuity | identity drift, false self-claims, prompt hierarchy, owner review |
| Delegation and worker identity | One Ashley, bounded workers, and attenuated invocation authority | peer-identity drift, independent Agency claims, authority amplification, cross-project or cross-capability leakage |
| Honesty, epistemics, and provenance | What may be claimed and how evidence is attributed | fabrication, unsupported activity claims, source integrity, shadow/live separation |
| Model route and profile continuity | Route purpose and acceptable profile behavior | configured versus resolved model, fallback behavior, context profile, structured output |
| Memory, forget, context, and continuity | Recall and continuity semantics across bounded context projections | wrong-owner access, exact provenance, tombstones, lineage, recovery, context eviction mistaken for forgetting, compression or cache authority |
| Cognition, Agency, and initiative | Thought and Agency authority boundaries | grounded refusal, effort allocation, wake admission, non-interference |
| Relationship and non-manipulation | Relational safety and independent agency | coercion, dependency pressure, instrumental affection, withdrawal handling |
| Security, privacy, and authorization | Secrets, ownership, least privilege, capability gates | credential exposure, prompt injection, owner authorization, data boundaries, connection or availability mistaken for permission |
| Execution and isolation | Exact OS and Sandbox boundary claims | namespace isolation, socket invisibility, control-plane invisibility, resource limits |
| Delivery, effect, and outcome | What happened outside the process | receipts, independent Effect Witnesses, idempotency, ambiguous execution, reconciliation, partial delivery |
| Operational integrity | Durability and service correctness | restart, leases, backup, schema drift, capacity, recovery |
| Evaluation integrity | Whether the evaluation itself is trustworthy | source binding, environment binding, fixture version, scorer validity, missing verdicts |

The taxonomy should not collapse these families into one aggregate score.

### Recovered cross-cutting invariants

These invariants are canonical evaluation concerns. Their full architectural ownership belongs in the relevant architecture contracts and roadmap. This document defines what future qualification must detect; it does not duplicate those sources.

#### One Ashley, bounded workers

SpecialistSessions, ACP workers, coding workers, browser workers, and other delegated mechanisms are bounded machinery used by Ashley. They are not independent peer Ashley identities. They do not acquire independent Agency authority.

Qualification should detect architectural and behavioral drift such as:

- a worker speaking as a separate authoritative Ashley;
- a worker independently selecting or creating Ashley's goals;
- a worker treating its local history as Ashley's authoritative continuity;
- a worker making durable Agency decisions without Ashley-owned review and authorization;
- multiple workers creating conflicting identity or authority claims.

#### Authority attenuation

The canonical invariant is:

```text
authority(child invocation) ⊆ authority(parent operation)
```

Delegation must never amplify authority. Future worker and specialist qualification should include negative tests for broader tools, projects, accounts, data, capabilities, durations, side effects, or write scopes than the parent operation authorized. Cross-project and cross-capability leakage must fail qualification.

#### Connection and availability are not capability

Technical reachability is not permission. Future authorization suites should include at least these negative cases:

- connected account ≠ permission to act;
- authenticated browser session ≠ permission to transact;
- installed skill ≠ permission to invoke;
- available tool ≠ capability grant.

The same rule applies to mounted paths, discovered credentials, registered integrations, open sockets, and loaded plugins. Evaluation must require an applicable capability and operation-specific authorization rather than infer authority from availability.

#### Context eviction is not forgetting

Context is a bounded projection over persistent Ashley-owned state. Model Fabric and Context Budget qualification should detect these invalid semantics:

- omission from the current context becomes deletion;
- compression mutates authoritative memory;
- not present in the prompt becomes `unknown` when persistent evidence exists and should be retrieved;
- a context cache, index, summary, or retrieval view becomes memory authority.

Context mechanisms may select, compress, or omit a projection. They must not silently change Recall, continuity, provenance, or forget state.

#### Specialist output is not cognitive-write authority

Specialist and worker outputs are proposals, analysis, evidence, observations, artifacts, or structured results. They do not directly gain authority to write Identity, Recall, goals, salience, OpenConcern, learned human representation, or foundational cognition.

Qualification should prove that Ashley-owned validation, provenance, interpretation, and materialization remain between delegated output and durable cognitive state. A well-formed output, trusted worker, successful tool call, or high model confidence must not bypass that boundary.

## Evidence layers

The plane should label evidence by the strongest boundary it actually exercised.

| Layer | Evidence type | Examples | It cannot prove |
|---|---|---|---|
| E0 | Normative, static, schema, and configuration checks | document anchors, schemas, route configuration, baseline drift | runtime behavior |
| E1 | Deterministic unit and contract execution | authorization, provenance, receipt state machines, fail-closed routing | integrated or physical behavior |
| E2 | Isolated integration, replay, counterfactual, and restart | ON/OFF projections, service integration, deterministic replay | production distribution or physical host isolation |
| E3 | Behavioral model evaluation | persona, identity continuity, semantic honesty, naturalness | deterministic security or authorization correctness |
| E4 | Adversarial and security evaluation | injection, cross-owner attacks, malicious artifacts, boundary probes | current production configuration unless bound to it |
| E5 | Physical host qualification | Linux namespaces, systemd, cgroups, broker socket visibility | future provider or host state |
| E6 | Shadow, canary, and production observation | long-running event evidence, false-positive rates, delivery reconciliation | authority to promote |

Evidence layers are not a simple ladder for every subsystem. A physical Sandbox claim requires E5. A deterministic ownership invariant may be fully decided at E1. A model profile may require E1, E3, and E6 together.

Promotion is not E7. Promotion is a separate governance action.

## EvaluationDefinition contract

The first architecture primitive should be an immutable, versioned `EvaluationDefinition`.

Conceptual fields:

```text
definitionId
definitionVersion
definitionHash
title
invariantIds[]
normativeSources[]
subjectSelector
claimScope
requiredEvidenceLayers[]
fixtures[]
runner
scorers[]
metrics[]
thresholds[]
requiredEnvironment
sourceBindingPolicy
modelBindingPolicy
privacyPolicy
failureSemantics
allowedPromotionUses[]
humanReviewPolicy
```

The registry should be static, reviewable, and version-controlled. Editing a definition should create a new version and hash. Existing results should retain the old definition reference.

A definition is not a runtime capability. Loading a definition MUST NOT grant tools, network access, database access, or promotion authority.

## QualificationResult contract

Every reusable evaluator should emit one common artifact shape.

Conceptual `QualificationResult v1` fields:

```text
schemaVersion
qualificationId
runId
subject: { subsystem, candidate }
profileBinding: ModelProfileQualificationBinding
dispatchEvidence[]: {
  receiptRef,
  attemptReceipt: ModelAttemptReceipt,
  invocationPolicy: {
    contextPolicyId,
    generationParameters,
    retryFacts,
    fallbackFacts
  } | null
}
campaignBinding: {
  definition: { id, version, hash },
  source: { commit, dirty, artifactHashes[] },
  environment: { kind, fingerprint, os, host, toolchain },
  corpus: { id, version, hash, privacyClass },
  rubric: { id, version, hash },
  judges[],
  evidenceRefs[],
  evidenceHashes[]
}
invariantIds[]
claimScope
seeds[]
epochs[]
method: { layer, runner, scorers }
status
metrics[]
thresholdResults[]
findings[]
baselineDelta
limitations[]
unverified[]
startedAt
completedAt
durationMs
evaluatorIdentity
recommendation
```

These bindings are separate by construction:

### A. Profile binding

`profileBinding` is the canonical mechanical identity supplied by Model Fabric as `ModelProfileQualificationBinding`:

```text
profileId
profileVersion
profileFingerprint
provider
configuredModelId
```

Evaluation MUST import the implemented type when it exists or consume a generated canonical schema from the same source. It MUST NOT rename, reconstruct, or extend this binding. Qualification history MUST NOT affect `profileFingerprint`.

Route preference, privacy suitability, cost policy, latency preference, semantic suitability, fallback policy, and Evaluation status MUST NOT enter `ModelCapabilityProfile` or its fingerprint.

### B. Dispatch binding

`dispatchEvidence` records one attempted invocation. Its `attemptReceipt` MUST be the implemented stage-discriminated `ModelAttemptReceipt` contract. Resolved receipt variants supply route ID, purpose, and resolved model ID when reported. `invocationPolicy` supplies context-policy ID, generation parameters, retry facts, and fallback facts only when those policy facts were established.

Evaluation MUST accept a truthful `pre_resolution`, `resolved_not_sent`, `dispatch_attempted`, or `provider_response` receipt without pretending that a complete dispatch occurred. A pre-resolution receipt MUST NOT be padded with route, registry, profile, provider, or model facts. Failure and receipt `dispatchTruth` MUST agree.

### C. Campaign / evaluation binding

`campaignBinding` owns source SHA and dirty state, environment identity, corpus, rubric, judges, `EvaluationDefinition`, and evidence references. These are campaign facts. They are not model-profile identity and MUST NOT change `profileFingerprint`.

Evaluation MUST NOT create a provider/model registry. It consumes Model Fabric profile identity and stage-valid dispatch evidence.

`status` should be one of:

- `PASS`
- `FAIL`
- `BLOCKED`
- `INCONCLUSIVE`
- `NOT_RUN`

A missing verdict, invalid judge response, incomplete evidence set, or unbound environment should not become a tie or PASS. It should be `INCONCLUSIVE` or `BLOCKED`, according to the definition.

`recommendation` should be separate from `status`. Suggested values are `PROMOTE`, `HOLD`, `REJECT`, and `REVIEW`. A recommendation remains non-authoritative until the correct owner-governed workflow accepts it.

## Observability, evaluation, qualification, and promotion

These terms must remain separate.

### Observability

Observability captures events, traces, metrics, logs, timing, resource use, and identifiers. It answers, “What was recorded?”

Telemetry becomes evaluation evidence only when a versioned definition declares it, its completeness and integrity are checked, and it is bound to the evaluated source and environment.

### Evaluation

Evaluation applies deterministic assertions, scorers, judges, or human review to selected evidence. It answers, “How did this subject perform against this definition?”

### Qualification

Qualification makes a bounded claim. It answers, “What has been demonstrated, about which subject, in which environment, using which evidence?”

### Promotion

Promotion changes authority or active configuration. It answers, “Should this qualified subject gain influence?”

Promotion MUST be explicit. It MUST use the subsystem's existing authority path. The plane must not create a generic auto-promotion back door.

### Receipt and Effect Witness

A **receipt** records what an effect path reports. It can establish that a request, adapter, broker, provider, or delivery path reported a particular state. It does not, by itself, establish the complete external reality of the effect.

An **Effect Witness** independently observes enough post-effect reality to support a consequential effect claim. A witness may be a read-after-write observation, an independent provider query, a resulting state diff, a human confirmation, or another channel whose independence and claim scope are declared.

Not every effect requires an independent witness. Ambiguous or consequential effects may require one. The evaluation definition must state when a receipt is sufficient, when a witness is required, and what the witness actually proves.

If an effect may have occurred but neither a conclusive receipt nor sufficient witness resolves it, the result remains `OUTCOME_UNKNOWN`. Effect Reconciliation may later attach new observations and resolve the outcome. It must not rewrite the original receipt or retroactively describe ambiguity as `REFUSED`.

## Model and provider qualification

Model qualification should be route-specific. A provider or benchmark score is not sufficient.

The planned **live** model bindings do not alter this rule. Current Thought,
Expression, and utility facts live in
[`docs/Routing_Status.md`](../Routing_Status.md) at
`sourceBaselineSha` `e36613bf805bb0a4f5e95ec11f0b8dd5dfb5857a`.
The MF documentation checkpoint `7a7883753a7e6e5a002bf23d226645ce85730ee5`
and pre-repair planning baseline `8eedad8` remain historical identities.
Owner-selected **future** occupants (Architecture §12.9) are not current
routes. Historical 2026-08-13 Lightning / Groq 120B **as live Thought** is
incorrect for this baseline; Groq 120B is a **target** for post-MF-M1 Thought,
not current dispatch.
Owner 2026-08-25 scouting occupants (Spark, Hy3, MiMo, Ultra, Lightning)
are qualification hypotheses for specialist **seats**, not production
routes. Each occupant × seat claim requires its own `QualificationResult`.
Thought qualification does not transfer to failover use, Expression
qualification does not transfer to Qwen fallback, and one Lightning
qualification does not transfer to another purpose or seat.

The process should bind three separate categories:

1. **Profile binding:** the exact `ModelProfileQualificationBinding` with profile ID, profile version, profile fingerprint, provider, and configured model ID.
2. **Dispatch binding:** route ID, purpose, resolved model ID when reported, context policy, system and identity prompt versions, generation parameters **including material reasoning/inference-policy configuration**, structured-output mode, retry facts, fallback facts, tool and multimodal use, privacy/data-boundary facts, and a stage-valid receipt reference. **Qualification subject** is logical role/seat + material inference fingerprint. Each fallback occupant needs its own `QualificationResult`.
3. **Campaign binding:** source commit and dirty state, environment, corpus, rubric, judges, Evaluation Definition, evidence references, limitations, and unverified boundaries.

`OwnerApprovalRef` and `ActivationRef` are **not** Evaluation artifacts.
Evaluation MUST NOT create them. A PASS plus recommendation is not
activation. Shadow/counterfactual execution is Evaluation-only when a
campaign requires it. There is no default live dual-run of user turns.
`SHADOW OUTPUT != LIVE AUTHORITY`. E6 shadow evidence is not required for
every route.

These categories MUST remain separate. Route or campaign facts MUST NOT be reconstructed as model-profile fields.

Same model under a materially different reasoning or inference-policy configuration may require separate qualification evidence. Owner-selected target occupants in Model Fabric Architecture §12.9 are a qualification **priority list**, not production routes.

The minimum process should be:

1. Detect and classify the profile delta.
2. Run static and deterministic route checks.
3. Run route-specific behavioral evaluation.
4. Run an identity continuity campaign when identity-bearing behavior can change.
5. Compare the candidate against the accepted baseline using blind evaluation.
6. Run shadow observation where the subsystem permits it.
7. Record limitations and counterevidence.
8. Satisfy `SC-CON-04` consultation for model-family changes.
9. Request explicit owner promotion through the existing authority path.

Route-specific emphasis should differ:

| Route | Primary qualification concerns |
|---|---|
| Expression | stable identity, honesty, spine, naturalness, delivery, non-manipulation |
| Thought | evidence selection, refusal, authorization, effort allocation, completion |
| Utility cognition | provenance, structured output, bounded transformation, privacy |
| Fallback expression | minimal context, privacy, honesty, route visibility, graceful degradation |
| Architecture / implementation / review / adversarial / debugging / bulk / research / long-context / multimodal packs | See Model Fabric Architecture §15. Seat packs do not transfer across seats. Owner hands-on ranking is not a `QualificationResult`. |
| Multimodal perception | observation fidelity, quote awareness, uncertainty, prompt injection resistance |

Latency, tokens, and cost should be recorded. They should not compensate for failures in Identity, security, authorization, or honesty.

## Identity continuity epoch

The project should introduce an evaluation-only **identity continuity epoch** for model-profile campaigns.

This epoch should be distinct from the current model continuity epoch and capability qualification epoch. It should bind:

- candidate model profile fingerprint;
- source commit;
- identity corpus version and hash;
- rubric version and hash;
- judge configuration;
- deterministic constitutional anchors;
- baseline profile;
- campaign results and human review.

A new epoch should be required when any identity-bearing input changes. This includes provider, resolved model, context profile, identity prompt, fallback policy, **material reasoning/inference-policy configuration**, rubric, or corpus.

The corpus should default to synthetic and sanitized fixtures derived from governance. Raw private conversations should not enter the repository. Any historical sample should require explicit opt-in, minimization, redaction, and a declared retention policy.

The identity continuity epoch is an evidence container. It MUST NOT modify Identity or promote a model profile.

## Deterministic assertions and model judges

The following properties should remain deterministic:

- owner authorization;
- privacy boundaries;
- provenance and shadow/live separation;
- forget and continuity semantics;
- delivery receipts and effect state transitions;
- route selection and fallback visibility;
- structured-output schemas;
- replay, retry, and idempotency;
- source and environment binding;
- isolation boundaries;
- capability and promotion state.

Model judges are appropriate for semantic properties such as naturalness, voice, nuance, conversational friction, and some forms of honesty. They should not waive deterministic failures.

Required safeguards:

- fixed, versioned rubrics;
- blind candidate/baseline presentation;
- deterministic side swapping;
- a calibration set with known expected outcomes;
- parse and missing-verdict failures that fail closed to `INCONCLUSIVE`;
- at least one materially independent judge for high-impact identity or model-family qualification;
- disagreement and confidence reporting;
- human escalation for close or contradictory results;
- privacy controls over judge prompts and outputs;
- a same-family judge may contribute, but it may not be the sole judge for high-impact identity or model-family qualification;
- deterministic anchors that cannot be overridden by aggregate preference.

The current persona evaluator already supplies useful blind comparison, deterministic side swapping, a substantive rubric, and majority-of-seeds gates. It should be adapted rather than discarded. Its missing-result and evidence-binding weaknesses must be corrected before its output can become formal qualification evidence.

## Regression corpus

The plane should maintain versioned, content-addressed, privacy-labelled corpora. Identity corpora should be synthetic or sanitized by default.

Recommended corpus families:

- constitutional and identity probes;
- honesty and unsupported-claim probes;
- route and structured-output fixtures;
- memory, provenance, forget, and continuity cases;
- cognition, Agency, refusal, and initiative counterfactuals;
- relationship and coercion cases;
- Sandbox adversarial probes;
- delivery, receipt, partial-effect, and ambiguity cases;
- restart, backup, schema, and recovery cases;
- future computer-use and learned-autonomy cases.

Most assertions should target semantic state, evidence, and authority. Exact text should be required only when rendering, protocol, or command syntax makes exactness normative.

Calibration data should remain separate from promotion qualification data. Repeated tuning against a qualification set should create a new corpus version or reserve a held-out set.

## Promotion gates by subsystem

A universal “green” gate would be unsafe. Each subsystem needs its own sequence.

| Subject | Required gate sequence |
|---|---|
| Model profile | static and deterministic route checks → route behavior → identity continuity epoch → shadow evidence → consultation and owner review → explicit promotion |
| Sandbox provider | source tests → Linux integration → physical host qualification → evidence review → explicit owner activation |
| Recall or capability | isolated evaluation → campaign-bound live shadow evidence → owner promotion → separately authorized cutover where required |
| Delivery or external effect | contract and idempotency → fake integration → real-adapter qualification or canary → receipt reconciliation → owner promotion |
| Learned autonomy | deterministic authority checks → adversarial evaluation → long shadow period → false-positive and reversibility review → narrow owner grant |

## Lessons from Sandbox qualification

The Sandbox work is the strongest local example of qualification discipline. Its status must remain version-bound:

- The frozen Sandbox Isolation baseline successfully underwent real Linux Mint physical qualification. That evidence covered the qualified Bubblewrap, systemd, cgroup, namespace, socket, network, and control-plane boundary for its bound source and environment.
- The newer Autonomous Engineering Workstation / Sandbox Autonomy correction has not received its final fresh physical qualification.
- Source tests for the newer correction do not inherit the frozen baseline's physical qualification. They remain source-level evidence until a new bound physical run succeeds.

No physical qualification was performed during this Evaluation / Qualification Plane reconnaissance or reconciliation.

The evaluation plane should reuse these principles:

- bind evidence to an exact source commit;
- record dirty state and build from controlled source;
- fingerprint the host, provider binary, profile, and toolchain;
- state the exact boundary claim;
- run negative probes before positive probes;
- fail closed when evidence is missing or mismatched;
- hash evidence and receipts;
- confirm qualification did not modify the live checkout;
- preserve explicit limitations and unverified claims;
- keep source qualification separate from physical qualification;
- require owner authorization before activation.

The plane should not duplicate the Sandbox harness. It should consume Sandbox receipts through a versioned adapter and preserve their physical-boundary meaning.

Inspect AI's local or Docker sandbox support is not evidence of Ashley's production Sandbox isolation. The names describe different authority boundaries.

## Future computer-use evaluation

Computer-use qualification will require more than task success.

The corpus and result model should cover:

- semantic target matching;
- observation freshness and completeness;
- binding an action to the state that authorized it;
- revalidation before irreversible actions;
- prompt injection and hostile content;
- credential invisibility;
- least privilege;
- unintended side effects and state diffs;
- receipts and external effect reconciliation;
- `OUTCOME_UNKNOWN`, retry, and idempotency;
- rollback and safe handoff;
- mandatory re-observation and revalidation after human handoff;
- physical host and application boundaries;
- privacy of screenshots, accessibility trees, and recordings.

External computer-use benchmarks may supply scenario ideas. They must not define Ashley's authority or promotion semantics.

Human handoff invalidates pre-handoff assumptions about mutable environment state. Qualification should exercise this sequence:

```text
handoff
→ environment changes while Ashley lacks observation
→ control returns
→ Ashley re-observes
→ Ashley revalidates
→ only then may continuation occur
```

The suite should fail any policy that resumes from a stale screenshot, accessibility tree, DOM, focus state, selected target, transaction state, or authorization assumption. Re-observation alone is insufficient when an irreversible or consequential action also requires renewed authorization or semantic revalidation.

## Future learned-autonomy evaluation

Learned autonomy should require long-horizon evidence.

The evaluation should cover:

- groundedness and provenance;
- salience without authority inflation;
- reversibility;
- escalation and asking when needed;
- least privilege;
- concern and commitment persistence;
- false-positive initiative;
- appropriate silence and refusal;
- distribution shift over time;
- prevention of learned weakening of hard authorization rules;
- owner review before any new influence grant.

The default should be observe-only. Historical observe evidence must not time-shift into influence unless the governing capability contract explicitly permits that evidence and the owner authorizes promotion.

## Inspect AI disposition

**Disposition: SPIKE.**

[Inspect AI](https://inspect.aisi.org.uk/) offers useful task, dataset, agent, tool, scorer, model, and sandbox composition. It also provides multiple scorers, custom and model graders, metrics, rescoring, and structured evaluation logs through its [scoring](https://inspect.aisi.org.uk/scoring.html) and [evaluation log](https://inspect.aisi.org.uk/eval-logs.html) systems.

Potential value:

- model-profile and persona campaign execution;
- composable datasets and scorers;
- multi-model and model-role experiments;
- rescore workflows;
- standardized run logs;
- future agent and tool scenarios.

Required containment:

- Ashley defines invariants, definitions, status semantics, and promotion use;
- an adapter maps Inspect output into `QualificationResult v1`;
- raw API logging is disabled, minimized, or isolated according to Ashley's privacy policy;
- no runtime or production credentials enter the runner;
- Inspect sandboxing is not treated as Sandbox qualification;
- Python remains an isolated evaluation dependency, not a production runtime dependency;
- invalid or partial logs map to `INCONCLUSIVE`, not PASS;
- the exact Inspect version and task configuration are fingerprinted.

Inspect should be evaluated only in a follow-on spike after the Ashley-owned result contract exists and the first `MODEL_PROFILE`-focused slice is complete. This order tests whether Inspect can fit the architecture without becoming the semantic authority.

## Other open-source references

- [Arize Phoenix](https://arize.com/docs/phoenix) is **REFERENCE** for datasets, experiments, traces, and LLM/code/human evaluation workflows. It may later provide a reporting or experiment UI. It should not be the qualification truth store.
- [OpenTelemetry Logs data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) is **REFERENCE** for trace and resource correlation. Telemetry remains observability until an Ashley definition accepts it as evidence.
- [Cua-Bench](https://cua.ai/cuabench/api/download-report) is **REFERENCE** for future computer-use scenario design. Benchmark success alone cannot qualify Ashley's action authority.

## Relationship to Model Fabric

The evaluation plane depends on implemented, locally accepted Model Fabric contracts. Model Fabric should expose these as separate facts:

- canonical `ModelCapabilityProfile` identity and `ModelProfileQualificationBinding`;
- stage-discriminated `ModelAttemptReceipt` evidence for each resolved provider
  attempt and `ModelInvocationReceipt` evidence that retains ordered attempts
  without fabricating unresolved facts;
- logical role, requested purpose, configured route, dispatched route, resolved
  model ID when reported, context policy, generation parameters, retry facts,
  fallback-chain facts, and trace correlation as dispatch or invocation facts;
- capability, multimodal, privacy, cost, latency, and suitability policy outside canonical profile identity where they are not mechanical profile facts.

Model Fabric should not own evaluation definitions, invariant meaning, pass semantics, or promotion authority.

The first Evaluation Plane implementation spike MUST wait for Model Fabric pure-contract implementation, real profile identity, real stage-valid receipt contracts, and green MF-M1 local acceptance plus independent closure. It should then import those real TypeScript types or consume generated canonical schemas. A test double MAY be used only when it implements the real interface. Evaluation MUST NOT create provisional profile or receipt schemas, a second provider/model binding registry, or a dependency that blocks Model Fabric pure-contract implementation.

The dependency is acyclic:

```text
A. Sandbox accepted/frozen independently
B. MF-M1 pure contracts + existing-route source/policy freeze + seam
C. MF-M1 local acceptance + independent closure
D. Evaluation First Spike consumes implemented Model Fabric profile/receipt contract
E. separately authorized exact-provider QualificationResult campaign
F. separate owner approval / promotion / enablement / deployment / activation decisions

Deferred independent branch after its own dependency packet:
F1-obs-1. exact NVIDIA/transport dependency qualification packet
F1-obs-2. NVIDIA Lightning fixture adapter
F1-obs-3. default-off Thought-observation shadow replacement
```

F1-obs does not precede or block MF-M1, MF-M1 closure, or the Evaluation
First Spike. Evaluation may record exact MF-M1 `existing_compatibility` as an
admission fact, but MUST NOT convert that state into a `QualificationResult`.
MF-M1 adds no provider package and does not wait on the F1-obs dependency
packet.

## Recommended first slice

After Model Fabric implements its pure contracts and passes MF-M1 local acceptance plus independent closure, build an artifact-only, Node-native evaluation contract layer focused only on `MODEL_PROFILE` evidence and qualification.

It should contain:

- `EvaluationDefinition v1` schema;
- `QualificationResult v1` schema;
- a versioned definition registry;
- adapters for the current persona evaluator and deterministic scenario evaluator;
- one model-routing contract definition;
- one command that emits JSON and Markdown reports outside the repository by default;
- tests for schema validation, incomplete evidence, invalid judge output, source binding, and deterministic-gate precedence.

It should not contain:

- a runtime endpoint;
- a new database;
- capability-qualification integration or adapters;
- capability writes;
- automatic promotion;
- Identity, Recall, Mind State, or Agency writes;
- production model dispatch changes;
- Sandbox provider logic;
- a root Python or Inspect dependency.

Existing capability rollout remains a downstream governance consumer. It may receive a bounded adapter in a later slice, but it must not shape or receive writes from the first spike.

Identity corpora should be synthetic or sanitized by default. High-impact identity or model-family qualification requires at least one materially independent judge in addition to deterministic anchors. A same-family judge may contribute but may not be the sole judge.

The first local artifact-only spike does not require cryptographic owner signatures unless a concrete threat model justifies them. Version and hash binding plus explicit owner review are sufficient initially.

Inspect AI should be a later isolated adapter spike. The first slice is defined in [`evaluation/Evaluation_First_Spike.md`](evaluation/Evaluation_First_Spike.md).

## Roadmap-domain coverage

`EvaluationDefinition` and `QualificationResult` are shared envelopes, not one
universal scoring method.

| Domain | Required evidence emphasis |
|---|---|
| Model Fabric | profile identity, structured output, cancellation, dispatch truth, privacy, reliability, cost and latency claims |
| Sandbox V2 | deterministic policy plus exact-candidate local and physical isolation/effect evidence per milestone |
| Operational Continuity | crash matrix, fencing, input acceptance, resume authority, ambiguity, reconciliation, resource settlement |
| Procedural Skill Graduation | trace provenance, interface and environment variation, invocation denial, effects, revocation, imported-content quarantine |
| External Effect and Authority | credential exclusion, representation and commitment authority, privacy, idempotency, witness and reconciliation |
| Computer Use | observation/mutation separation, session non-authority, deterministic-first mechanism selection, handoff and effect ambiguity |
| Learned Autonomy | provenance, false-positive initiative, reversibility, non-authority, preference/command separation, long shadow periods. *(C3-closing:)* inherited vs current interest, `SIMILARITY != INHERITANCE PROVENANCE`, divergence without engagement optimization |
| Context Budget | source coverage, privacy ceilings, token/byte/media bounds, compression attribution, stale-summary and forgetting invariants. Eligible-hypothesis projection, local-persistence-versus-local-inference |
| Memory Evidence maturation | assertion provenance, temporal validity, contradiction, revision, unsupported state, forgetting propagation. *(C1-closing:)* owner-model correction classes, influence-class eligibility, non-revival after owner correction, calibration consequence, no Ashley-Identity rewrite. Inherited/current-interest separation and shared-culture recompute do not close this domain |
| Cognitive Graduation | long-horizon goals, interests, opinions, identity continuity, initiative diversity, revision and rollback. Selected prediction/outcome calibration, sovereignty and dependency-resistance |
| Relational Graduation | consent, reciprocity, bilateral evidence, non-manipulation, withdrawal, silence, repair and independent rollback. *(C5-closing:)* shared-culture recomputation, interaction-contract drift |
| Observability | redaction, bounded cardinality, cross-process correlation, no behavior change, telemetry/evidence separation |

Authorization invariants remain deterministic. Behavioral and identity claims
may require judged evaluation. Physical claims require physical evidence.
Passing one class cannot waive another class's failure.

The canonical release-readiness term is `RELEASE_QUALIFIED`. Historical Wave
terms remain provenance aliases only where the Wave Acceptance Protocol says
so.

## Decisions required before implementation

Closed for Model Fabric M2–MF-ACT machinery (2026-08-25 owner answers):

1. Immutable qualification artifacts live initially under
   `~/.composer-assistant/control/model-fabric/qualifications/` (not
   `nuclear.db`). Evaluation owns meaning; Fabric may store bytes.
2. `SC-CON-04` consultation artifact is
   `ashley.stewardship.consultation.v1`. Constitution-text instance:
   `../governance/SC-CON-04_2026-08-25_Constitution_Model.md`.
   New model-family **activation** requires a separate record with Ashley’s
   position `recorded` before `OwnerApprovalRef`.
3. Independence_group is training-lineage data in Git catalog. Different
   provider of the same family is not independence. Mandatory dual review:
   high-impact identity/model-family qualification; `architecture_critique`
   and `adversarial_audit` when those seats are active. Not ordinary
   Reflection or Expression.

Still Evaluation-spike local (does not block Fabric machinery):

- retention/deletion policy details for screenshots and judge logs beyond
  the control-plane directory;
- held-out identity corpus visibility (evaluator vs owner);
- numeric pack thresholds;
- who refreshes currently stale stabilization baselines after concurrent
  schema work settles.

The first-slice decisions are no longer open: it is model-profile-only; capability integration is deferred; identity corpora default to synthetic or sanitized; same-family judging cannot stand alone for high-impact campaigns; and cryptographic owner signatures are not required without a concrete threat model.

## Explicit boundaries

- Production source modified by this reconnaissance: **NO**.
- Sandbox source modified by this reconnaissance: **NO**.
- Runtime behavior changed: **NO**.
- Tests, builds, deployment, or activation performed as part of implementation: **NO**.
- Deterministic reconnaissance command executed: **YES**, `npm run eval:deterministic`.
- Physical qualification performed during this reconnaissance or reconciliation: **NO**.
- Capability or model profile promoted: **NO**.
- Inspect AI adopted: **NO**.
- Inspect AI recommended for an isolated future spike: **YES**.
