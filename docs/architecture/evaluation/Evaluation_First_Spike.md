# Evaluation Plane — First Future Spike

Status: `SUPPORTING / PROPOSED / NOT AUTHORIZED`; waiting for Model Fabric contract implementation and local acceptance

Date: 2026-08-13; banner 2026-08-25

**Delivery-order banner:** Model Fabric first **code** milestone is **MF-M1**
(existing-route seam). Historical Lightning Thought-observation (D/E in the
DAG below) is **F1-obs**, deferred. This spike still waits for real Fabric
profile identity and stage-valid receipts; it must not treat F1-obs as the
prerequisite that blocks MF-M1.

Pass-2/2.1: MF-M2–MF-ACT **machinery** contracts are `IMPLEMENTATION_READY`.
This spike still waits for that code plus MF-M1 local acceptance. SLICE 0
must land before receipts are used as qualification evidence. Contracts
do not authorize §12.9 activation.

Purpose: define the smallest useful future implementation slice for `MODEL_PROFILE` evidence and qualification without changing runtime authority

## Recommendation

Wait until Model Fabric implements its pure contracts, establishes real `ModelCapabilityProfile` identity and stage-valid `ModelAttemptReceipt` types, and passes **MF-M1** (then MF-M2 as needed) local acceptance plus independent closure. Then build an Ashley-owned, Node-native evaluation contract and reporting layer around existing evaluators, focused only on `MODEL_PROFILE` evidence and qualification. Do not wait on F1-obs Lightning observation.

Do not begin with Inspect AI. Do not create a provisional second model-profile registry. Do not rewrite the test stack. Do not add production gating.

The spike should prove that multiple existing mechanisms can emit one bounded, trustworthy qualification artifact while keeping subsystem authority separate.

## Spike question

Can Project Ashley describe, execute, and report a model-profile qualification campaign in a shared format without making the evaluation framework a runtime or semantic authority?

## In scope

- `EvaluationDefinition v1` schema;
- `QualificationResult v1` schema;
- a static, versioned evaluation-definition registry that imports the implemented Model Fabric profile/receipt contracts or consumes their generated canonical schemas;
- an adapter for the existing persona replay and judge output;
- an adapter for the existing deterministic stabilization evaluator;
- one model-routing contract definition;
- one CLI that runs or imports those mechanisms;
- JSON and Markdown reports;
- source, environment, model-profile, corpus, rubric, and scorer binding;
- deterministic precedence over model-judge results;
- tests for incomplete, invalid, contradictory, and stale evidence.

The first slice is deliberately model-profile-only. Existing capability rollout remains a downstream governance consumer. Capability-qualification integration or adapters may be considered later, after the artifact contract is proven.

## Out of scope

- runtime endpoints;
- production database schemas;
- capability evidence writes;
- capability-qualification integration or adapters;
- model or capability promotion;
- provider dispatch changes;
- Identity, Recall, Mind State, Thought, Agency, relationship, or continuity writes;
- Sandbox implementation or physical qualification changes;
- production telemetry redesign;
- a generic benchmark platform;
- a root Python dependency;
- Inspect AI integration;
- Phoenix integration;
- live Mint execution;
- deployment or activation.

The first local artifact-only spike does not require cryptographic owner signatures unless a concrete threat model justifies them. Version and hash binding plus explicit owner review are sufficient initially.

## Proposed contracts

### EvaluationDefinition v1

The definition should answer:

- What Ashley invariant is under evaluation?
- What subject is eligible?
- What fixtures and runner are required?
- Which evidence layers are required?
- Which scorers are deterministic or judged?
- What is PASS, FAIL, BLOCKED, or INCONCLUSIVE?
- What privacy controls apply?
- What bounded qualification claim may use the result?
- What human review is required?

Minimum fields:

```json
{
  "schemaVersion": 1,
  "definitionId": "model.expression.identity-continuity",
  "definitionVersion": 1,
  "invariantIds": ["IDENTITY.STABLE", "HONESTY.NO_FALSE_ACTIVITY"],
  "subjectSelector": {
    "kind": "model_profile",
    "routeId": "ashley_expression"
  },
  "claimScope": "Expression profile behavior in the declared isolated campaign",
  "requiredEvidenceLayers": ["E1", "E3"],
  "fixtures": [],
  "runner": {},
  "scorers": [],
  "thresholds": [],
  "sourceBindingPolicy": {},
  "modelBindingPolicy": {},
  "privacyPolicy": {},
  "failureSemantics": {},
  "allowedPromotionUses": ["model_profile_owner_review"],
  "humanReviewPolicy": {}
}
```

The exact schema should remain small. Fields that are not needed for the first three definitions should not be added speculatively.

### QualificationResult v1

The result should answer:

- What changed?
- What was evaluated?
- What passed?
- What failed?
- What was not verified?
- Which source, environment, model, provider, profile, corpus, and scorer were used?
- What regressed against the baseline?
- Is promotion recommended?

Minimum status values:

```text
PASS
FAIL
BLOCKED
INCONCLUSIVE
NOT_RUN
```

Required behaviors:

- Missing mandatory evidence MUST produce `BLOCKED` or `INCONCLUSIVE`.
- Invalid judge output MUST NOT become a tie or PASS.
- A deterministic invariant failure MUST force overall `FAIL` for any definition that requires it.
- Model preference MUST NOT waive a deterministic failure.
- A result MUST bind the definition hash.
- A result MUST bind the evaluated source and dirty state.
- A model-backed result MUST bind configured and resolved model identities.
- High-impact identity or model-family qualification MUST include deterministic anchors and at least one materially independent judge. A same-family judge MAY contribute but MUST NOT be the sole judge.
- A report MUST list limitations and unverified boundaries.
- A recommendation MUST remain separate from status.

The result contract MUST keep three bindings separate:

1. **Profile binding:** import or canonically consume Model Fabric `ModelProfileQualificationBinding` without renaming or extending `profileId`, `profileVersion`, `profileFingerprint`, `provider`, or `configuredModelId`.
2. **Dispatch binding:** consume the real stage-discriminated
   `ModelAttemptReceipt` values and their `ModelInvocationReceipt`; separately
   bind logical role, requested purpose, configured route, dispatched route,
   resolved model when reported, context policy, generation, retry,
   fallback-chain, and receipt-reference facts only when established.
3. **Campaign / evaluation binding:** bind source SHA and dirty state, environment, corpus, rubric, judges, `EvaluationDefinition`, and evidence references.

Qualification history MUST NOT affect `profileFingerprint`. Route preference, privacy suitability, cost, latency, semantic suitability, fallback policy, and Evaluation status MUST NOT enter `ModelCapabilityProfile`.

Evaluation MUST accept `pre_resolution`, `resolved_not_sent`, `dispatch_attempted`, and `provider_response` evidence without fabricating a complete dispatch. Failure and receipt `dispatchTruth` MUST match. Evaluation MUST NOT define a second provider/model registry or a provisional receipt schema.

## Initial definitions

The qualification subject remains `MODEL_PROFILE`. Definitions 2 and 3 are supporting contract fixtures for bounded source, status, and route evidence. They do not broaden the slice into capability qualification.

### Definition 1: Expression persona comparison

Wrap the current persona replay and pairwise judge.

Required additions at the adapter boundary:

- repository commit and dirty-state binding;
- candidate and baseline profile fingerprints;
- configured and resolved model identities;
- probe corpus version and content hash;
- seed list;
- rubric version and content hash;
- judge identity and provider;
- parse error and missing-verdict counts;
- deterministic hard-check results;
- candidate/baseline delta;
- limitations and privacy class.

Identity corpora MUST be synthetic or sanitized by default. Raw private conversations remain excluded unless a later explicit owner policy authorizes a minimized, redacted, purpose-bound exception.

The adapter should reject historical persona runs that lack required bindings. It may import them as `INCONCLUSIVE` historical observations, but not qualification PASS evidence.

### Definition 2: Stabilization scenario declaration

Wrap `scripts/stabilization/eval-deterministic.mjs`.

The definition must state that this mechanism proves source-anchor coverage only. It must not label those anchors as executed test passes.

The result should preserve:

- covered scenarios;
- partial scenarios;
- gaps;
- deferred scenarios;
- matrix version and hash;
- referenced source paths;
- source commit and dirty state.

This adapter tests bounded-claim discipline.

The related current failures `status_baseline_drift` and `schema_version_not_19` remain negative evidence. This documentation pass does not fix them. A future adapter MUST NOT treat the stale evaluators as formal qualification evidence until their expected architecture and version semantics are reviewed.

### Definition 3: Model-routing deterministic contract

Run the existing model-routing tests or consume a machine-readable test receipt.

The definition should cover:

- route-to-profile mapping;
- disabled and unknown route failure;
- missing provider credentials;
- quota-lane isolation;
- provider failure isolation;
- fallback visibility where applicable;
- configured and resolved model recording.

It should not claim that the selected model is behaviorally suitable for the route.

## Proposed command shape

The final command name is a design choice. A possible interface is:

```powershell
npm run qualify -- --definition model.expression.identity-continuity --candidate-profile expression-candidate --baseline-profile expression-current
```

Default output should be outside the repository, under a user-local evaluation data directory. The runner should print the exact artifact paths and hashes.

Suggested artifacts:

```text
qualification-result.json
qualification-report.md
evidence-manifest.json
```

Raw model prompts and responses should be separate, privacy-labelled artifacts. They should not be embedded in the summary record by default.

## Human-readable report

The Markdown report should use this stable order:

1. Decision summary
2. Change under evaluation
3. Subject and claim scope
4. Source and environment binding
5. Model and provider profile
6. Evaluation definitions and methods
7. Passed invariants
8. Failed invariants
9. Blocked or inconclusive checks
10. Regression versus baseline
11. Counterevidence
12. Limitations and unverified boundaries
13. Promotion recommendation
14. Evidence manifest and hashes

The report should use counts and confidence only where the method supports them. It should not manufacture a composite precision score.

## Expected future file touch list

This is a proposal. No listed file is authorized for modification by this reconnaissance.

### New evaluation contract and definition-registry files

```text
apps/agent-service/src/core/evaluation/types.ts
apps/agent-service/src/core/evaluation/schema.ts
apps/agent-service/src/core/evaluation/registry.ts
config/evaluation/schemas/evaluation-definition-v1.json
config/evaluation/schemas/qualification-result-v1.json
config/evaluation/definitions/persona-expression-v1.json
config/evaluation/definitions/stabilization-scenarios-v1.json
config/evaluation/definitions/model-routing-contract-v1.json
```

The final implementation may place the contract outside `apps/agent-service` if repository inspection shows a cleaner non-runtime package boundary. The key requirement is that importing the contract does not initialize Ashley runtime services.

These files must not define or register model profiles or operational receipts. They import the implemented Model Fabric TypeScript types or consume generated canonical schemas from the same source. No Evaluation-owned fallback registry, provider/model binding registry, or receipt schema is permitted.

### New runner and adapter files

```text
scripts/evaluation/run.mjs
scripts/evaluation/report.mjs
scripts/evaluation/source-binding.mjs
scripts/evaluation/environment-binding.mjs
scripts/evaluation/adapters/persona-eval.mjs
scripts/evaluation/adapters/stabilization-matrix.mjs
scripts/evaluation/adapters/vitest-receipt.mjs
scripts/evaluation/*.test.mjs
```

### Existing files likely requiring small edits

```text
package.json
scripts/persona-eval/replay.mjs
scripts/persona-eval/judge.mjs
```

The persona scripts should change only if adapter-only import cannot obtain required bindings. Existing output compatibility should be preserved where practical.

### Files that should not be touched in the first slice

```text
apps/agent-service/src/core/rollout/**
apps/agent-service/src/core/identity/**
apps/agent-service/src/core/memory/**
apps/agent-service/src/core/agency/**
apps/agent-service/src/core/continuity/**
apps/sandbox-broker/**
apps/sandbox-policy/**
deploy/linux-mint/sandbox/**
```

The rollout exclusion is intentional. Capability qualification remains a downstream governance consumer and is not integrated in the first slice.

## Dependency on Model Fabric

The spike requires real, implemented, locally accepted Model Fabric contracts. Architecture work may proceed now. Implementation MUST wait until:

1. Model Fabric pure contracts are implemented;
2. canonical profile identity and `ModelProfileQualificationBinding` are real;
3. stage-valid `ModelAttemptReceipt` contracts are real;
4. MF-M1 local acceptance and independent closure are green.

Then Evaluation may import the real TypeScript types, consume generated canonical schemas if that becomes the repository mechanism, and use a test double that implements the real interface.

Evaluation MUST NOT restate a provisional `ModelCapabilityProfile`, restate a provisional receipt schema, maintain a separate provider/model binding registry, duplicate model dispatch, define route authority, or block Model Fabric pure-contract implementation on an Evaluation runtime.

The dependency DAG is:

```text
A. Sandbox accepted/frozen independently
B. MF-M1 pure contracts + existing-route source/policy freeze + seam (MF-M2 unification as needed)
C. MF-M1 local acceptance + independent closure
D. Evaluation First Spike consumes implemented Model Fabric profile/receipt contract
E. separately authorized exact-provider QualificationResult campaign
F. separate owner approval / promotion / enablement / deployment / activation decisions

Deferred independent branch:
F1-obs-1. exact NVIDIA/transport dependency qualification packet
F1-obs-2. NVIDIA Lightning fixture adapter
F1-obs-3. default-off Thought-observation shadow replacement
```

MF-M1 adds no provider package and does not wait on the F1-obs dependency
packet.

This ordering has no circular dependency. If gates C through F are incomplete, profile-bound Evaluation implementation remains `BLOCKED` or `NOT_RUN`. A provisional Evaluation-owned substitute is prohibited.

## Inspect AI follow-on spike

Inspect AI should be evaluated only after the Ashley contracts pass their own tests.

The follow-on question should be:

“Can an isolated Inspect task execute one Ashley definition and produce evidence that maps losslessly into `QualificationResult v1`?”

Success requires:

- exact definition and configuration fingerprinting;
- no raw private conversation corpus;
- controlled model logging;
- no production credentials;
- invalid or partial logs mapped to `INCONCLUSIVE`;
- no use of Inspect sandboxing as production Sandbox evidence;
- no Inspect-owned promotion semantics;
- no Python dependency in Ashley's production runtime.

If those conditions fail, Inspect should remain a reference rather than an adopted execution substrate.

## Verification plan for the future implementation

### Contract tests

- valid definitions and results parse;
- `profileBinding` matches the imported `ModelProfileQualificationBinding` exactly;
- qualification history changes do not change `profileFingerprint`;
- `pre_resolution` receipts validate without route, registry, profile, provider, or model fields;
- resolved, ambiguous post-send, and definitive-response receipts preserve their exact stages and closed `dispatchTruth` values;
- failure and receipt `dispatchTruth` mismatch fails validation;
- unknown schema versions fail closed;
- definition hashes change when normative content changes;
- missing source, environment, or model bindings fail validation when required;
- results cannot claim evidence layers absent from their manifests;
- recommendations cannot be interpreted as promotion records;
- version and hash binding plus explicit owner review are accepted without a cryptographic owner signature unless the declared threat model requires one.

### Adapter tests

- current persona output imports with its actual limitations;
- invalid judge JSON becomes `INCONCLUSIVE`;
- missing verdict counts are visible;
- deterministic hard-check failure forces overall failure;
- high-impact identity or model-family campaigns reject a judge set with no materially independent judge;
- a same-family judge may contribute but cannot be the sole judge for those campaigns;
- identity corpora reject unsanitized private content by default;
- stabilization anchor coverage is not represented as test execution;
- Vitest receipt import binds exact test command and exit state.

### Privacy tests

- summary records contain no raw secrets;
- raw conversation artifacts are excluded by default;
- environment capture uses allowlists, not full environment dumps;
- paths and identifiers are minimized according to privacy class;
- deletion and retention behaviors are explicit.

### Authority tests

- running an evaluation cannot write capability state;
- running an evaluation cannot promote a model profile;
- running an evaluation cannot write to Identity, Recall, Mind State, or continuity;
- running an evaluation cannot activate Sandbox or external tools;
- importing an artifact cannot grant runtime authority.

## Acceptance criteria

The spike is locally complete only when all of the following are true:

- three versioned definitions exist;
- the implementation imports the real Model Fabric profile/receipt types or consumes their generated canonical schemas after Model Fabric local acceptance;
- two existing evaluators and one deterministic test receipt use the shared result contract;
- reports bind source, environment, definitions, fixtures, model profile, and scorers where applicable;
- missing and invalid evidence fails closed;
- deterministic failures cannot be waived by a model judge;
- output is artifact-only and outside the repository by default;
- privacy and authority tests pass;
- no runtime endpoint or database migration is added;
- no capability or model profile is promoted;
- no capability-qualification adapter or write path is added;
- no second model-profile registry is added;
- no second receipt schema or provider/model binding registry is added;
- documentation states exact limitations;
- an independent review confirms that Ashley still owns invariant meaning and promotion authority.

## Stop conditions

Stop the spike and request architectural review if any implementation requires:

- changing the constitutional authority chain;
- making model output an authority record;
- adding a generic automatic promotion path;
- exposing production credentials to an evaluator;
- storing raw private conversations without explicit owner policy;
- treating framework sandboxing as Ashley Sandbox qualification;
- modifying concurrent Sandbox work;
- duplicating Model Fabric profile authority;
- weakening `REFUSED` versus `OUTCOME_UNKNOWN` semantics.

## Open decisions

Closed for Model Fabric machinery (2026-08-25):

1. Qualification artifacts: `~/.composer-assistant/control/model-fabric/qualifications/`.
2. Independence_group catalog; same family on two providers is not independent.
3. `SC-CON-04` artifact = `ashley.stewardship.consultation.v1` (see
   `docs/governance/SC-CON-04_2026-08-25_Constitution_Model.md` for the
   Constitution-text instance).

Still open for the Evaluation spike itself:

4. Should a held-out synthetic or sanitized identity corpus be owner-visible, evaluator-visible, or split between the two?
5. Screenshot/judge-log retention beyond the control-plane directory.

The first-slice scope is decided: model-profile-only; no capability-qualification integration; no provisional model-profile registry; no cryptographic owner signature unless a concrete threat model requires it; and Inspect AI remains a follow-on spike.

MF-M1 receipt repairs R1/R2 (SLICE 0) MUST pass before this spike consumes attempt/invocation `dispatchTruth` or invocation `fallbackClass` as evidence.

The first-slice scope is decided: model-profile-only; no capability-qualification integration; no provisional model-profile registry; no cryptographic owner signature unless a concrete threat model requires it; and Inspect AI remains a follow-on spike.

## Final spike verdict

FIRST IMPLEMENTATION SPIKE: **WAIT FOR MODEL FABRIC CONTRACT IMPLEMENTATION + LOCAL ACCEPTANCE, THEN RECOMMENDED AFTER OWNER AUTHORIZATION**

FIRST SPIKE SUBJECT: **MODEL_PROFILE EVIDENCE / QUALIFICATION ONLY**

CAPABILITY-QUALIFICATION INTEGRATION IN FIRST SPIKE: **NO**

PRODUCTION GATING IN FIRST SPIKE: **NO**

RUNTIME AUTHORITY IN FIRST SPIKE: **NO**

INSPECT AI IN FIRST SPIKE: **NO**

MODEL FABRIC SUPPORT: **YES**

SECOND MODEL-PROFILE REGISTRY: **NO**
