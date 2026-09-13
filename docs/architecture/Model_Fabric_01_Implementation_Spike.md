# Model Fabric — F1-obs Implementation Spike (deferred)

- **Status:** `SUPPORTING / DEFERRED` (historical F1 Thought-observation slice). **Not** the first implementation milestone.
- **Canonical phase name:** Model Fabric; the historical filename is retained for provenance
- **Canonical first code milestone:** **MF-M1** in [`Model_Fabric_Architecture.md`](Model_Fabric_Architecture.md)
- **This slice:** shadow Thought observation on NVIDIA Nemotron 3.5 Lightning 30B-A3B (**F1-obs**, optional later)
- **Default runtime state:** off
- **Activation:** not authorized
- **Sandbox impact:** none permitted
- **Target-policy note (2026-08-25):** owner-selected **post-MF-M1** Thought-observation occupant is Nemotron 3 Ultra (Architecture §12.9), not this file's Lightning F1-obs candidate. This spike remains deferred historical F1-obs. It does not describe live `e36613b` dispatch.

## First implementation spike

Implement the smallest end-to-end **F1-obs** Model Fabric path behind a default-off feature flag. This is **not MF-M1**. Migrate only the transport used by the existing `thought_observation` shadow call.

Do not dual-dispatch. When the flag is off, the current shadow path remains unchanged. When the flag is set to the shadow spike value, the existing shadow dispatch is replaced by the Model Fabric dispatch. The active Thought decision path remains unchanged in both modes.

### Why Thought observation is first

| Criterion | Evidence |
|---|---|
| No current-turn authority | `enqueueThoughtObservation` records a `live_shadow` comparison only after active Thought has already decided: historical `thought-observation.ts:23-77` (source path not retained in the current tree). |
| Existing strict-shaped output | It reuses `runThoughtModel` and the current Thought proposal validation: historical `thought.ts:145-251` (source path not retained in the current tree). |
| Real route defect to prove | Observation passes purpose `thought_observation`, but `runThoughtModel` forces route `thought`: historical `thought.ts:189-195` (source path not retained in the current tree). |
| Current compatibility route | The current router maps observation to `utility_bulk`, which still binds Groq GPT-OSS-20B: [router.ts:127-145](../../apps/agent-service/src/core/model-routing/router.ts#L127-L145), [registry.ts:38-44](../../apps/agent-service/src/core/model-routing/registry.ts#L38-L44). This is current-source truth, not the target model. |
| Target specialist candidate | The owner-approved target is NVIDIA `nvidia/nemotron-3.5-lightning-30b-a3b`. Its structured-output and transport mechanics remain unqualified until Step 0a completes. |
| Easy rollback | One default-off flag and one caller seam. No schema or active-decision migration. |
| No sandbox dependency | The path is under Agency, routing, and new Model Fabric files only. |

### Why engineering is not first

The engineering seam is attractive but currently shares files with active sandbox work. It also feeds an effect-capable operator, even though the operator and broker correctly retain authority.

The first spike MUST NOT modify:

- `apps/agent-service/src/core/sandbox/engineering-model-adapter.ts`;
- `engineering-types.ts`;
- `engineering-operator.ts`;
- `coordinator.ts`;
- `engineering-runtime.ts`;
- any sandbox-policy, sandbox-broker, Mint, or deploy file.

Engineering migration is a later bounded slice after the sandbox baseline is accepted and frozen.

## Spike objective

Prove all of the following in one shadow-only path:

1. Ashley purpose resolves to the intended route without a caller model override.
2. A capability profile is checked before dispatch.
3. The caller’s messages become a bounded `ContextProjection`.
4. A `SpecialistSession` enforces purpose, deadline, call budget, and output contract.
5. The qualified NVIDIA transport dispatches
   `nvidia/nemotron-3.5-lightning-30b-a3b` with hidden retries disabled.
6. Strict structured output is normalized back through the existing Thought semantic validator.
7. Exactly one provider request is possible.
8. Cancellation, timeout, malformed output, quota, and provider failures produce typed results with stage-valid receipts.
9. Telemetry contains only allow-listed metadata.
10. Existing attention admission and correlation remain in the path.
11. The active Thought decision and recorded shadow-event shape do not change.

This spike does not prove:

- Mistral parity;
- Expression parity;
- streaming;
- image, document, or audio support;
- provider fallback;
- engineering usefulness;
- production telemetry export;
- Mint compatibility;
- capability promotion;
- live deployment readiness.

It also does not enable the later Groq `openai/gpt-oss-120b` fallback. That
fallback requires separate route-specific qualification and a later route policy
with `reliabilityClass = explicit_fallback`.

The first-slice route policy is fixed:

```text
reliabilityClass = single_attempt
fallbackRouteIds = []
```

Provider fallback is prohibited. A timeout, cancellation, ambiguous in-flight result, provider error, or malformed output MUST NOT cause a second provider request. Existing deterministic Thought fail-closed behavior may run locally because it performs no alternate provider dispatch.

## Feature flag

Add one parsed environment value:

```text
ASHLEY_MODEL_FABRIC_MODE=off
```

Allowed values:

| Value | Behavior |
|---|---|
| `off` | Current model transport remains unchanged. This is the default. |
| `thought_observation_shadow` | Only the existing Thought observation dispatch uses Model Fabric. |

Unknown values MUST fail configuration parsing or normalize to `off` according to the repository’s established environment-error policy. They MUST NOT enable Fabric.

The flag does not change the capability contract. Existing `thought` shadow gates remain required. The flag does not activate active Thought influence.

The specification direction is owner-approved: replacement rather than dual dispatch, active Thought unchanged, no durable telemetry exporter, no Phoenix/OpenInference, Vitest plus fixtures for implementation testing, Inspect AI deferred, temporary compatibility resolver, and separate live-provider qualification. This does not authorize implementation.

## Proposed implementation shape

### Compatibility boundary

`runThoughtModel` already accepts an injected `Complete` function: historical `thought.ts:21-24` and `thought.ts:145-151` (source paths not retained in the current tree).

Use that seam:

1. `enqueueThoughtObservation` keeps honoring an explicitly injected `input.complete` for tests.
2. Otherwise, when the feature flag is off, it passes `undefined` and preserves current behavior.
3. Otherwise, it creates a Fabric-backed `Complete` function.
4. That bridge converts the existing Ashley `ChatMessage[]` into `ContextProjection.parts`.
5. The bridge intentionally ignores legacy `options.route` and `options.model`. It resolves purpose `thought.observation` through the Model Fabric registry adapter.
6. The specialist uses strict transport-level object output.
7. Model Fabric validates only the JSON representation and schema.
8. The bridge serializes the transport-valid object to `text` and returns receipt model identifiers through `ThoughtModelResult`.
9. `runThoughtModel` performs its existing Ashley-owned semantic checks after `ModelResult` returns and without modification.

This preserves one semantic validator. The AI SDK schema proves transport shape; `runThoughtModel` still proves allowed decision kinds, delay consistency, motivation IDs, speak/silence consistency, bounded fields, and grounded refusal conditions.

### Legacy route compatibility

The first slice must not attempt the full route-registry consolidation.

Add a narrow compatibility resolver that:

- calls current `resolveRoute("thought_observation")`;
- verifies only that the current semantic compatibility route is
  `utility_bulk` and records the observed current provider/model binding as
  migration evidence;
- refuses to treat the current Groq GPT-OSS-20B binding as the target profile;
- resolves the enabled shadow slice through the first Model Fabric policy entry,
  which binds the `utility_bulk` compatibility concept to Ashley-validated
  `ProviderId("nvidia")`, profile
  `nvidia.nemotron-3.5-lightning-30b-a3b` version 1, and configured model
  `nvidia/nemotron-3.5-lightning-30b-a3b`;
- returns an immutable `ResolvedModelRoute` with a compatibility registry
  version that makes this temporary overlay visible;
- rejects a changed compatibility route or Lightning profile binding as
  `configuration_error`;
- never reads a model identifier from the caller.

This is the smallest default-off migration that does not claim current
production routing already changed and does not redirect active
`exchange_cognition`, `curiosity_consolidation`, or `maintenance` traffic. The
first Model Fabric policy entry is target authority for the enabled shadow slice;
the legacy resolver supplies only route-compatibility evidence. It MUST NOT grow
into a second general route registry. A later, separately reviewed slice must
replace the static registry/config split and temporary overlay with one validated
registry before broader migrations.

`legacy-route-compat.ts` is temporary. It MUST be deleted when all of these exit criteria are satisfied:

1. one validated registry snapshot owns `purpose → route → profile ID/version/fingerprint`;
2. current route IDs and frozen route semantics are preserved;
3. static/config binding drift is eliminated;
4. deterministic registry-conformance tests pass and emit evidence that the Evaluation Plane may consume later.

The compatibility resolver MUST NOT become a second permanent route registry.
Its deletion MUST NOT depend on a running Evaluation service or Evaluation runtime. Evaluation remains a downstream evidence consumer.

### Thought observation output schema

The strict transport schema should require all current model-produced fields:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "kind",
    "delayClass",
    "shouldSpeak",
    "effort",
    "completion",
    "uncertainty",
    "urgency",
    "objective",
    "reason",
    "motivationIds"
  ],
  "properties": {
    "kind": {
      "enum": [
        "speak",
        "silence",
        "delay",
        "ask",
        "revisit",
        "share",
        "challenge",
        "refuse"
      ]
    },
    "delayClass": {
      "anyOf": [
        {
          "enum": ["brief", "standard", "long", "reflection_review"]
        },
        {
          "type": "null"
        }
      ]
    },
    "shouldSpeak": { "type": "boolean" },
    "effort": { "enum": ["low", "medium", "high"] },
    "completion": { "enum": ["complete", "hold"] },
    "uncertainty": { "type": "number", "minimum": 0, "maximum": 1 },
    "urgency": { "type": "number", "minimum": 0, "maximum": 1 },
    "objective": { "type": "string", "maxLength": 500 },
    "reason": { "type": "string", "maxLength": 1000 },
    "motivationIds": {
      "type": "array",
      "items": { "type": "integer" },
      "minItems": 1,
      "maxItems": 12,
      "uniqueItems": true
    }
  }
}
```

The schema does not prove that a motivation ID was supplied, that refusal is grounded, or that `shouldSpeak` matches `kind`. Existing Ashley validation remains required.

### Projection identity

The text-only Thought-observation projection carries two distinct identities:

- `contentBinding` is SHA-256 over the exact canonical bounded projection and evidence references. It is privacy-sensitive, is not exported to general telemetry, and may be consumed by a later `QualificationResult` only under its Evaluation Definition and retention policy.
- `telemetryFingerprint` covers a content-free structural descriptor. It is safe only for operational correlation and does not prove which exact content was evaluated.

The in-memory telemetry adapter receives `telemetryFingerprint` only. Tests MUST prove that `contentBinding`, text, evidence IDs, and exact content lengths are absent from serialized spans.

### First profile

Declare one stable profile definition. The conceptual identity is:

| Field | First-slice value |
|---|---|
| `profileId` | `nvidia.nemotron-3.5-lightning-30b-a3b` |
| `profileVersion` | `1` |
| `provider` | Ashley-validated `ProviderId("nvidia")` |
| `configuredModelId` | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Input | Conservative declaration established by dependency qualification; first slice requests text only |
| Output | Conservative declaration established by dependency qualification; first slice requires strict structured object output, no tools, and no streaming |
| Reasoning | Unknown until the dependency packet and adapter fixture demonstrate exact controls |
| Cancellation | AbortSignal only if the dependency packet and fixture demonstrate it |
| Limits | concrete conservative values established before registration; no unknown limit may enter the canonical profile |
| `profileFingerprint` | deterministic SHA-256 of the completed canonical `ModelCapabilityProfileDefinition` |

The profile contains no mutable `fixtureQualifiedAt`, `liveQualifiedAt`, or `evidenceRef` fields. It declares the stable mechanical contract. Demonstration is separate:

- provider-documented capability;
- local adapter/fixture implementation evidence;
- later exact-provider `QualificationResult`.

Adapter and fixture tests are required for local spike acceptance. They do not mutate profile identity and do not automatically create PASS or promotion. Formal reusable qualification belongs to the Evaluation / Qualification Plane.

A resolved Model Fabric receipt must expose `profileId`, `profileVersion`, `profileFingerprint`, `provider`, and `configuredModelId` so the Evaluation Plane can consume the exact `ModelProfileQualificationBinding` without duplicating the registry. A pre-resolution receipt MUST omit those unresolved facts.

### AI SDK adapter

The dependency packet must select one first-slice mechanism:

1. a suitable official NVIDIA provider for AI SDK 7;
2. an OpenAI-compatible AI SDK provider pointed at NVIDIA's exact serving
   surface; or
3. a tiny Ashley-owned NVIDIA HTTP adapter behind `ModelProviderAdapter`.

Do not select among these without evidence. If AI SDK is selected, the adapter
uses:

- `generateText`;
- `Output.object` with the strict schema;
- only the exact NVIDIA integration accepted by the dependency packet;
- `maxRetries: 0`;
- explicit `abortSignal`;
- Ashley-derived total timeout;
- profile-owned NVIDIA provider options only when individually qualified;
- no streaming;
- no tools;
- no content telemetry.

The adapter MUST normalize `NoObjectGeneratedError` as `malformed_output`. It MUST map provider errors without retaining a raw response body.

The adapter MUST NOT:

- call AI Gateway;
- use an SDK registry to select the route;
- use an SDK fallback provider;
- accept arbitrary provider options;
- expose the SDK response object outside the adapter;
- interpret the result as a Thought decision;
- record prompts or outputs.

### Attention integration

The existing `runAttentiveDispatch` remains the single admission and quota owner.

Preferred first-slice flow:

```text
SpecialistSession
  -> ModelFabric validation
  -> runAttentiveDispatch
  -> qualified NVIDIA adapter
  -> normalized receipt
```

The attention request must receive:

- provider and configured model from `ResolvedModelRoute`;
- quota bucket from the resolved binding;
- purpose `thought_observation`;
- lane `exchange_cognition`;
- decision and owner correlation already available to the caller;
- deadline and AbortSignal;
- estimated and actual tokens;
- resolved provider model ID when safely reported.

Every successfully resolved Fabric receipt MUST record the temporary
compatibility `routeId: "utility_bulk"`, the Lightning profile binding, and the
NVIDIA provider/model facts even if the existing attention schema keeps a
nullable legacy route alias. A `pre_resolution` receipt MUST NOT invent those
facts.

No attention schema migration is required for the first slice. A later migration can make route/profile/registry version first-class durable columns after the contract stabilizes.

### Telemetry

Implement:

- a no-op telemetry adapter for normal default behavior;
- an in-memory telemetry adapter for tests;
- the backend-neutral interface from the contract draft.

Do not add Phoenix, OpenInference, an OTLP exporter, or a Mint collector in the first slice.

The in-memory test adapter must reject or detect any prohibited attribute key or content-bearing value. Test fixtures should use sentinel secrets, prompts, URLs, filenames, and attachment data and assert that none appear in serialized spans.

## Work sequence

### Step 0 — Re-establish baseline

Before implementation:

1. Wait until active sandbox work is finished.
2. Verify the actual checkout and instruction chain.
3. Record `HEAD`, `origin/master`, branch, and full `git status --short --untracked-files=all`.
4. Confirm none of the expected files overlap unrelated user changes.
5. Do not repair or discard unrelated work.
6. Confirm production Node and local Node versions before selecting exact package releases.
7. Complete the dependency qualification packet below before installing anything.

### Step 0a — Dependency qualification packet

This is a small implementation prerequisite. It is not part of this documentation-only reconciliation and does not authorize installation.

Record:

- exact NVIDIA API endpoint or serving surface, authentication mechanism, and
  transport protocol;
- whether AI SDK 7 has a suitable official NVIDIA provider;
- if not, whether an OpenAI-compatible AI SDK adapter is appropriate;
- if not, whether a tiny Ashley-owned NVIDIA HTTP adapter is safer and simpler;
- exact `ai` and provider-package versions if AI SDK is selected;
- local and production Node runtime plus package engine constraints;
- exact structured-output surface and JSON Schema compatibility;
- supported input modalities and media limits;
- context and output limits;
- reasoning controls;
- AbortSignal, cancellation, and timeout behavior;
- one-dispatch behavior, hidden retry behavior, and proof that retries are zero;
- pre-send versus post-send failure distinguishability;
- usage, cached-token, reasoning-token, provider request ID, and resolved-model
  metadata when available;
- API compatibility, rate limits, and quotas;
- dependency tree, licenses or terms, and basic dependency and transport
  security findings.

Stop before installation if the packet cannot establish a supported NVIDIA
transport, exact version set where dependencies are used, strict-output behavior
required by the first slice, one-dispatch enforcement, or supported runtime.
Package versions are intentionally not selected in this specification.

The later Groq `openai/gpt-oss-120b` fallback requires a separate packet and
route-specific qualification. Thought qualification does not satisfy that gate.

### Step 1 — Write failing contract tests

Add tests before implementation for:

- current-source compatibility detection for `utility_bulk` plus target
  resolution to NVIDIA `nvidia/nemotron-3.5-lightning-30b-a3b`;
- deterministic profile version and fingerprint behavior;
- caller route/model values having no effect on the Fabric bridge;
- disabled or drifted binding failing before dispatch;
- `maxCalls: 0` refusing before dispatch;
- schema-valid output reaching existing Thought semantic validation;
- schema-invalid output becoming `malformed_output`;
- exactly one fixture HTTP request;
- cancellation before and during dispatch;
- local attention quota refusal versus received provider quota;
- received 404, 429, and 5xx dispatch truth;
- pre-resolution failures omitting unresolved route/profile/provider facts;
- `resolved_not_sent`, `dispatch_attempted`, and `provider_response` receipt staging;
- failure and receipt `dispatchTruth` equality;
- projection content binding versus telemetry fingerprint separation;
- parent/child authority, explicit context, and budget accounting;
- no provider fallback and no alternate provider request;
- telemetry privacy;
- shadow-only event compatibility.

### Step 2 — Add pure contracts and validators

Implement:

- branded IDs and runtime parsing;
- capability profile;
- route compatibility resolver;
- context projection builder and validator;
- output contract;
- result, stage-discriminated receipt, failure taxonomy;
- session budget state;
- telemetry interface.

`OutputContract` contains transport parsing and schema validation only. This task MUST NOT move any Thought semantic check into Model Fabric.

No provider dependency is needed for this step.

### Step 3 — Add the qualified NVIDIA adapter

After the dependency packet is accepted and installation is separately
authorized, implement only its selected mechanism. If it selects AI SDK, add the
exact-pinned compatible `ai` major 7 and NVIDIA integration packages. If it
selects a tiny Ashley-owned HTTP adapter, add no package unless the packet proves
one is required.

Update only `apps/agent-service/package.json` and its lockfile when the selected
mechanism actually requires dependencies.

Use an injected model or local fixture transport so the adapter test never calls
the internet. Prove zero hidden retries and an exact request count of one.

### Step 4 — Add the Thought observation specialist bridge

Build a `SpecialistSession<ThoughtObservationObject>`.

The bridge:

- maps existing Ashley messages to a text-only Context Projection;
- enforces the current prompt and user-payload bounds;
- resolves `thought.observation`;
- invokes Fabric once;
- returns JSON text and receipt model identity through the existing `Complete` shape;
- exposes no new semantic authority.

### Step 5 — Wire the default-off flag

Modify `enqueueThoughtObservation` only:

```ts
const complete =
  input.complete ??
  (env.modelFabricMode === "thought_observation_shadow"
    ? createThoughtObservationFabricComplete(/* bounded dependencies */)
    : undefined);
```

Pass `complete` to the existing `runThoughtModel` call.

Required precedence:

1. Explicit test injection `input.complete`.
2. Enabled shadow Fabric bridge.
3. Existing default transport.

The existing capability checks, duplicate suppression, in-flight set, event source key, fire-and-forget behavior, event detail fields, and catch behavior remain unchanged.

### Step 6 — Verify locally

Run, in order:

```powershell
npm test --prefix apps/agent-service -- src/core/model-fabric/model-fabric.test.ts
npm test --prefix apps/agent-service -- src/core/model-fabric/adapters/nvidia-adapter.test.ts
npm test --prefix apps/agent-service -- src/core/agency/thought-observation.test.ts
npm run build --prefix apps/agent-service
npm test
npm run phase0:offline
npm run eval:deterministic
git diff --check
```

Use the exact test filenames created during implementation. Do not claim a command passed unless it was executed and passed.

External network MUST fail in `phase0:offline`. Provider live qualification is not part of this sequence.

### Step 7 — Independent closure review

The review must confirm:

- no active Thought behavior changed;
- no second shadow call was added;
- no hidden retry exists;
- no provider/model override is possible;
- no prompt or output reaches telemetry;
- no Recall or Perception authority moved;
- no sandbox path changed;
- no deployment or capability promotion occurred.

## Evaluation plan

Vitest and injected/local fixtures remain the first-slice implementation-test mechanism. The general [Ashley Evaluation / Qualification Plane](Ashley_Evaluation_Qualification_Plane.md) owns reusable `EvaluationDefinition` and `QualificationResult` contracts. Model Fabric supplies profile and receipt facts; it does not define a second PASS, qualification, or promotion system.

### Unit matrix

| Case | Setup | Expected result |
|---|---|---|
| Intended route | Purpose `thought.observation`, current compatibility route, and first Fabric policy | Receipt says compatibility route `utility_bulk`, NVIDIA, and `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Forced legacy route | Legacy `Complete` options contain `route: "thought"` | Ignored by bridge; same Lightning receipt |
| Forced model | Legacy options contain a Mistral model | Ignored; same Lightning receipt |
| Registry drift | Utility binding is not expected profile | `configuration_error`; zero provider calls |
| Profile fingerprint | Canonical profile is repeated | Same `profileFingerprint` |
| Profile mutation | Any normative profile field changes | New `profileVersion` and different `profileFingerprint` |
| Qualification reference | `QualificationResult` reference changes | Canonical `profileFingerprint` is unchanged |
| Disabled route | Utility route disabled | `route_disabled`; zero provider calls |
| Pre-resolution receipt | Unknown purpose, disabled route, unknown profile, or binding mismatch | `pre_resolution + not_sent`; no invented route, registry, profile, provider, or model fields |
| Capability mismatch | Request image part against text-only profile | `unsupported_modality` or `capability_mismatch`; zero calls |
| Oversized context | Projection exceeds configured bound | `context_too_large`; zero calls |
| Zero budget | `maxCalls: 0` | `budget_exhausted`; zero calls |
| Expired deadline | Deadline is already past | `timeout`; zero calls |
| Pre-aborted | Signal aborted before admission | `cancelled` and `not_sent` |
| In-flight abort | Fixture observes request, then aborts | `dispatch_attempted`, `cancelled`, and `sent_outcome_unknown` unless transport proves no send |
| Local TPM refusal | Estimate exceeds attention TPM before dispatch | `local_quota_exceeded` and `not_sent`; zero provider requests |
| Resolved pre-send refusal | Resolved route then projection, capability, budget, or attention rejection | `resolved_not_sent + not_sent`; exact resolved facts retained |
| Received 429 | Fixture returns a definitive provider response | `provider_response`, `provider_quota`, and `response_received` |
| Received model 404 | Fixture returns a definitive model-unavailable response | `provider_response`, `provider_model_unavailable`, and `response_received` |
| Received 5xx | Fixture returns a definitive provider response | `provider_response`, `provider_internal`, and `response_received` |
| Post-send reset | Fixture accepts the request then closes without a definitive response | `dispatch_attempted + sent_outcome_unknown` |
| Receipt truth equality | Any typed failure | `failure.dispatchTruth === receipt.dispatchTruth` |
| Valid strict output | Complete object matches JSON Schema | Existing Thought validator receives JSON text |
| Invalid transport output | Missing required field or prose | `malformed_output` |
| Invalid semantics | Valid schema but unknown motivation ID or inconsistent delay | Existing `runThoughtModel` rejects as `invalid_response` |
| Output boundary | Attempt to supply a semantic validator through `OutputContract` | Contract cannot represent it; caller validates after `ModelResult` |
| Projection binding | Exact text changes but structure remains | `contentBinding` changes; `telemetryFingerprint` may remain equal |
| Telemetry projection identity | Serialize a call span | `telemetryFingerprint` may appear; `contentBinding` and content do not |
| Child context | Create a child with a parent ID but no explicit projection | Refused; no hidden context inheritance |
| Child budget | Child reservation exceeds parent remainder | `budget_exhausted`; zero calls |
| Child authority | Parent and child are ordinary Model Fabric sessions | Neither exposes effect authority |
| Hidden retry | Fixture always fails | Request counter equals one |
| No provider fallback | Any failure, timeout, cancellation, or ambiguous outcome | `single_attempt`, empty `fallbackRouteIds`, and request counter never exceeds one |
| Telemetry | Fixture values contain sentinels | No sentinel content in recorded telemetry |
| Flag off | Default environment | Existing injected transport and event behavior unchanged |
| Flag on | Shadow mode | One Fabric call and same event detail keys |

### Behavioral comparison

Use a fixed offline corpus of representative Thought inputs:

- reactive speak;
- grounded refusal candidate;
- silence;
- delay;
- proactive share;
- conflicting motivations;
- high uncertainty;
- invalid motivation selection.

Compare:

- parse success;
- Ashley semantic-validator acceptance;
- proposed kind;
- selected motivation IDs;
- uncertainty and urgency bounds;
- latency and token use;
- failure class.

This is shadow usefulness evidence. It is not a formal `QualificationResult` and is not promotion evidence.

### Live qualification, separately authorized

If later authorized, run a bounded exact-model qualification:

- source SHA and dirty-state binding;
- `profileId`, `profileVersion`, and `profileFingerprint`;
- provider and configured model ID;
- resolved model ID when reported;
- one harmless strict-output request;
- no private user content;
- no Recall;
- no attachment;
- one dispatch;
- captured provider model ID and usage;
- prompt and output excluded from telemetry;
- no retry;
- exact request count;
- normalized failure and dispatch-truth semantics;
- explicit cost ceiling.

The run MUST map losslessly into the general `QualificationResult` format once that contract exists. Live qualification MUST NOT enable the runtime feature flag on Mint. Local first-slice acceptance does not establish exact-provider production qualification, Mint compatibility, profile promotion, or production feature enablement.

## Expected file touch list

The names below are the preferred first-slice shape. Implementation MAY adjust a new filename when repository conventions require it. Scope categories MUST remain.

### New, safe Model Fabric files

- `apps/agent-service/src/core/model-fabric/contracts.ts` — Core IDs, profiles, route, projection, output, result, receipt, and failure types.
- `apps/agent-service/src/core/model-fabric/capability-profiles.ts` — First conservative Lightning profile plus runtime validation.
- `apps/agent-service/src/core/model-fabric/legacy-route-compat.ts` — Narrow current-router resolver and drift checks.
- `apps/agent-service/src/core/model-fabric/context-projection.ts` — Immutable projection builder, size measurement, and validation.
- `apps/agent-service/src/core/model-fabric/model-fabric.ts` — Validation, attention integration, one-dispatch orchestration, and receipt construction.
- `apps/agent-service/src/core/model-fabric/specialist-session.ts` — Cumulative call/token/deadline enforcement.
- `apps/agent-service/src/core/model-fabric/telemetry.ts` — No-op interface and sanitized facts.
- `apps/agent-service/src/core/model-fabric/adapters/nvidia-adapter.ts` — Dependency-packet-selected NVIDIA transport conversion and error normalization.
- `apps/agent-service/src/core/model-fabric/specialists/thought-observation.ts` — Strict schema and legacy `Complete` compatibility bridge.
- `apps/agent-service/src/core/model-fabric/index.ts` — Deliberate public exports.
- `apps/agent-service/src/core/model-fabric/model-fabric.test.ts`
- `apps/agent-service/src/core/model-fabric/specialist-session.test.ts`
- `apps/agent-service/src/core/model-fabric/adapters/nvidia-adapter.test.ts`
- `apps/agent-service/src/core/model-fabric/specialists/thought-observation.test.ts`

### Existing files expected to change

- `apps/agent-service/src/env.ts` — Parse `ASHLEY_MODEL_FABRIC_MODE` with default `off`.
- `apps/agent-service/src/core/agency/thought-observation.ts` — Select the Fabric-backed `Complete` only in shadow mode. Preserve all existing gates and event behavior.
- `apps/agent-service/src/core/agency/thought-observation.test.ts` — Prove flag precedence and unchanged shadow recording.
- `apps/agent-service/package.json` — Change only if the accepted NVIDIA transport mechanism requires exact-pinned dependencies.
- `apps/agent-service/package-lock.json` — Change only when required to lock that accepted dependency graph.
- `config/env.example` — Document the default-off flag if this is the current environment-template path.

### Files that SHOULD NOT change in the first slice

- `apps/agent-service/src/core/agency/thought.ts` — Reuse its injected `Complete` seam and existing validator.
- `apps/agent-service/src/mistral-client.ts`
- `apps/agent-service/src/core/model-routing/router.ts`
- `apps/agent-service/src/core/model-routing/registry.ts`
- `config/models.json`
- `apps/agent-service/src/core/attention/**`
- `apps/agent-service/src/core/perception/**`
- any SQLite migration;
- any capability contract;
- any Expression, cognition, curiosity, or Reflection caller.

If implementation proves one of these files must change, stop and review the expanded scope before editing. Do not silently enlarge the spike.

The compatibility resolver remains on the touch list only until the explicit deletion criteria in this document pass.

### Prohibited and wait-listed files

- `apps/sandbox-policy/**`
- `apps/sandbox-broker/**`
- `apps/agent-service/src/core/sandbox/**`
- `scripts/mint/**`
- `deploy/linux-mint/sandbox/**`

No file in these paths is part of the first implementation slice.

## Rollback

Rollback must be mechanical:

1. Set `ASHLEY_MODEL_FABRIC_MODE=off` or omit it.
2. The existing Thought observation transport is used.
3. No database down-migration is needed.
4. No capability contract changes are needed.
5. No attention or Perception data migration is needed.
6. New Model Fabric files and dependencies can be removed in a later scoped revert if the spike is rejected.

The flag-off path must be covered by tests. “The new code is not called in practice” is not enough.

## Acceptance criteria

The spike passes local acceptance only when:

- the resolved route receipt proves `thought_observation → utility_bulk` compatibility and target binding `nvidia → nvidia/nemotron-3.5-lightning-30b-a3b`;
- the resolved route receipt includes the exact profile ID, version, and fingerprint;
- the active Thought decision path is byte-for-byte or behaviorally unchanged outside any necessary import formatting;
- the existing shadow event retains its current source key and detail fields;
- the strict schema and existing Thought semantic validator both run;
- one invocation creates no more than one provider request;
- provider SDK retries are explicitly zero;
- all failures use the closed taxonomy and a stage-valid receipt whose `dispatchTruth` matches the failure;
- pre-resolution failures contain no invented route, registry, profile, provider, or model facts;
- no first-slice failure uses `retryability = policy_may_fallback`;
- local attention quota rejection is not labeled `provider_quota`;
- definitive provider 429, 404/model-unavailable, and 5xx responses use `response_received`;
- pre-dispatch failures perform zero network calls;
- `reliabilityClass` is `single_attempt`, `fallbackRouteIds` is empty, and timeout, cancellation, ambiguity, or any other failure does not cause provider fallback;
- deterministic local fail-closed behavior is not counted as provider fallback because it performs no additional provider request;
- telemetry privacy sentinel tests pass;
- no prompt, output, media, secret, URL, filename, or raw exception is traced;
- exact projection `contentBinding` is absent from general telemetry;
- semantic validation remains in `runThoughtModel` after `ModelResult` returns;
- parent/child sessions inherit no hidden context, provider choice, Recall access, authority, or unaccounted budget;
- Model Fabric emits no `QualificationResult` and performs no promotion;
- no schema, Recall, capability, sandbox, Mint, deploy, or production configuration changes occur;
- targeted tests, agent build, full tests, offline Phase 0, and deterministic evaluation pass;
- an independent review confirms scope and authority preservation.

Local acceptance is not live provider qualification, deployment readiness, capability promotion, or Mint release.

## Later migration order

If the spike is accepted, use this order:

1. Consolidate the route registry into one validated authority.
2. Migrate exchange cognition.
3. Migrate curiosity consolidation and add missing correlations.
4. Correct and migrate Reflection review.
5. Qualify the Mistral AI SDK adapter.
6. Migrate Expression primary while preserving its explicit minimal fallback.
7. Add image support through the existing Perception seam.
8. Consider document-page support after Perception design.
9. After sandbox freeze, re-audit and migrate engineering `ThinkingModel`.
10. Add independent engineering review/verification only after the first engineering proposal seam is qualified.

Each item is a separate acceptance slice. No item inherits live qualification or activation from a previous item.

## Sandbox dependencies and things to wait for

Before any engineering migration:

- accepted sandbox SHA is known;
- the working tree is clean or unrelated work is explicitly isolated;
- `ThinkingModel`, coordinator budgets, operator validation, approval envelope, and broker port are re-read from that SHA;
- the zero-call budget finding is owned by the sandbox workstream;
- isolation readiness and offline qualification remain valid after any provider/systemd change;
- no Mint access or service change is assumed;
- owner authorizes the exact engineering slice.

The invariant remains:

```text
MODEL PROPOSAL
  != ENGINEERING ACTION VALIDATION
  != APPROVAL
  != BROKER EXECUTION
  != EXECUTION RECEIPT
  != ASHLEY SEMANTIC INTERPRETATION
```

## Open questions for Doc/GPT

The first-slice decisions above are resolved. Remaining implementation-time questions are:

1. Which NVIDIA mechanism passes the dependency qualification packet: official AI SDK provider, OpenAI-compatible AI SDK adapter, or tiny Ashley-owned HTTP adapter, and what exact versions apply?
2. What exact Node version is running on the production Mint host?
3. What conservative context/output limits should enter profile version 1 after adapter qualification?
4. Should the route registry consolidation follow immediately after the shadow slice, or wait until the Evaluation Plane can emit a reusable route-resolution `QualificationResult`?

## Preparation disposition

The implementation spike is bounded, reversible, shadow-only, and independent of sandbox work. It is ready for review. It is not authorized for implementation by this document.
