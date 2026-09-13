# Project Ashley Model Fabric Architecture

**Status:** `CURRENT PHASE CONTRACT`

**Date:** 2026-08-25 (Pass-2 implementation contracts; Constitution `## Model` amended)

**Sole current owner:** this file. Do not add a parallel Model Fabric design.
Execution contracts for MF-M2–MF-ACT:
[`Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md`](Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md).

```text
SOURCE SNAPSHOT
  !=
PROMOTED CANDIDATE
  !=
RUNNING PRODUCTION
```

Exact SHAs own snapshot identity. Branch names such as `master` are not
semantic evidence.

| Identity | SHA | Meaning |
|---|---|---|
| `planningBaselineSha` | `e36613bf805bb0a4f5e95ec11f0b8dd5dfb5857a` | Canonical post-OF integration baseline for the MF-M1 source/caller re-audit. |
| `sourceBaselineSha` | `e36613bf805bb0a4f5e95ec11f0b8dd5dfb5857a` | Source identity for this canonical integration line. **Not** an MF-M1 implementation or candidate-freeze SHA. |
| `productionBaselineSha` | `e36613bf805bb0a4f5e95ec11f0b8dd5dfb5857a` | Exact production-proven runtime baseline. MF-M1 is not production-routed. |
| `implementationStartSha` | `5a05e96e4d5d6afbd6d44e9ca518f141fa8292c6` | Exact integrated baseline requested for autonomous MF-M1 implementation; docs-only on top of the `e36613b` runtime ancestor. |
| `mfM1CandidateSha` | `d918572c7ae01d5b367323692bd6e8fbcf257895` | Local MF-M1 implementation candidate produced from `implementationStartSha`; acceptance and production promotion remain separate. |
| Pass-2 planning HEAD | `d915af86483e2af4f5edf2838023ffe22f875dcc` | Docs/planning worktree for MF-M2–MF-ACT contracts. Not an implementation candidate. |
| Historical MF documentation checkpoint | `7a7883753a7e6e5a002bf23d226645ce85730ee5` | Docs-only MF-M1 checkpoint based on the pre-repair `8eedad8` line; preserved for provenance. |
| Historical pre-repair MF planning baseline | `8eedad8bebbed2d8cd984849a269afe256a3d08a` | Original MF-M1 planning/source snapshot; superseded by `e36613b` for this integration line. |
| Historical routing audit | `04beaf1c21c9f7e0c9580692f57ed533d822f61e` | Inherited Thought NIM→Groq 20B line; superseded as *planning* base |
| Historical Sandbox M-series closure | `48bad019fe601d5c871a54dd9902879862c6e96a` | Predecessor evidence only. **Not** the MF-M1 source baseline |

**Operational Fulfillment status:** Operational Fulfillment M1 is
production-proven at exact SHA
`e36613bf805bb0a4f5e95ec11f0b8dd5dfb5857a`. That SHA is the canonical
runtime integration baseline for MF-M1. The MF documentation checkpoint
`7a7883753a7e6e5a002bf23d226645ce85730ee5` is docs-only, and its
pre-repair `8eedad8` planning identity is historical. The autonomous MF-M1
implementation started from exact `implementationStartSha`
`5a05e96e4d5d6afbd6d44e9ca518f141fa8292c6` and is checkpointed locally at
`mfM1CandidateSha` `d918572c7ae01d5b367323692bd6e8fbcf257895`. Acceptance,
production promotion, and activation remain separate gates.
Resume:
`docs/handoffs/MODEL_FABRIC_MF_M1_IMPLEMENTATION_CHECKPOINT.md`
(pre-publication history).

```text
OWNER-SELECTED TARGET
  !=
CURRENT ROUTING
  !=
QUALIFIED ROUTE
  !=
OWNER APPROVED FOR ACTIVATION
  !=
PRODUCTION ROUTED
```

Live MF-M1 compatibility is §11. Owner-selected **post-MF-M1** direct-provider
targets are §12.9. They MUST NOT leak into MF-M1 characterization tests as
expected current behavior.

**MF-M1 state (do not collapse):**

| Aspect | State |
|---|---|
| Selected first implementation milestone | **MF-M1** |
| Owner scope / design decisions | `OWNER CLOSED` |
| Architecture / documentation | `READY` (this freeze) |
| Runtime implementation | `IMPLEMENTED (LOCAL CANDIDATE)` at `d918572c` |
| Implementation acceptance | `NOT YET EVALUATED` |
| Production status | `NOT IMPLEMENTED` |
| MF-M2–MF-ACT contracts | `IMPLEMENTATION_READY` (machinery). Activation of §12.9 remains owner control-plane. |

`OWNER CLOSED` means the owner has closed **scope and design**. It does **not**
mean MF-M1 is implementation-accepted, promoted, or production-proven. The
local candidate is implemented and internally reviewed; acceptance and
production closure remain separate. Do not write “MF-M1 CLOSED” as if it were
a runtime or production closure.

Current source has Ashley-owned purpose and route logic plus provider adapters.
The local candidate adds the MF-M1 compatibility seam without changing those
routes or their fallback behavior. Sandbox wait is delivery order, not semantic
or authority derivation from Sandbox. That Sandbox delivery-order gate is closed
through named M7 `patch_export`. MF-M1 is implemented locally but remains not
accepted and not production-routed.

**Selected first implementation milestone:** **MF-M1** — a seam around
**existing** production routes with **zero intended** routing, provider,
model, or reasoning behavior change. The original documentation freeze did not
implement MF-M1; the local candidate status is recorded above.

**Not the first implementation milestone:** historical **F1** /
Thought-observation Lightning shadow. Retained as **F1-obs**
(`SUPPORTING` / deferred optional witness). Provenance is preserved. It does
not block MF-M1.

**Scope:** This status reconciliation records the local MF-M1 candidate. It
does not change runtime route selection, providers, `config/models.json`,
OpenCode adapters, Mint, deployment, Operational Fulfillment M1, or
qualification execution. Later slices (elastic backend **mechanics**, catalog records, specialist
resolution, activation **mechanism**) are contracted in
[`Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md`](Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md).
Those contracts do not activate §12.9 occupants. Actual production routing
change still requires owner-created `ActivationRef`.

**Evidence classes used in this revision:**

| Label | Meaning |
|---|---|
| `CONFIRMED FROM SOURCE` | Current repository source or tests |
| `CONFIRMED FROM OFFICIAL PUBLIC DOCUMENTATION` | Vendor docs fetched 2026-08-25 |
| `OBSERVED CURRENT CATALOG` | Point-in-time public catalog; not architecture |
| `OWNER OBSERVATION` | Owner hands-on ranking or scouting prior; not qualification |
| `INFERENCE` | Reasonable reading that is not proven |
| `PROPOSAL` | Recommended architecture, not implemented |
| `UNKNOWN` | Not established from permitted evidence |
| `OWNER CLOSED` | Owner + ChatGPT design decision recorded 2026-08-25 |

**Historical filename note:** Supporting field contracts reconciled for MF-M1 remain in
[`Model_Fabric_01_Contract_Draft.md`](Model_Fabric_01_Contract_Draft.md).
That filename is retained for provenance. The canonical phase name is Model
Fabric. The 2026-08-13 first-slice (default-off Thought-observation shadow,
Lightning, no fallback) is **F1-obs**: supporting, deferred, not the first
code cut.

Living route facts: [`docs/Routing_Status.md`](../Routing_Status.md).
Ephemeral OpenCode roster (pre-publication history; not in current tree):
`research/Model_Fabric_OpenCode_Research_Snapshot_2026-08-25.md`.
Future worker track (pre-publication history; not in current tree; not Model Fabric):
`research/Ashley_OpenCode_Worker_Future.md`.
Owner decisions (pre-publication history; not in current tree):
`../handoffs/MODEL_FABRIC_OWNER_DECISION_PACKET.md`.

## 1. Purpose

Model Fabric is Ashley's semantic dispatch boundary over replaceable provider
mechanisms. It decides which mechanical model capability may serve an Ashley
purpose, under what budget, privacy, reliability, cancellation, and receipt
rules, without letting a provider, SDK, session, or model identifier own
meaning.

It answers:

> Which bounded model attempt may run, for which purpose, with which exact
> projection, and what mechanical facts did that attempt produce?

It does not answer:

> What does Ashley believe, want, remember, or authorize?

Model Fabric is mechanism work, not cognitive advancement. Completing a
Fabric slice does not graduate Thought, Agency, or Learned Autonomy.

## 2. Vision and Principle basis

Model Fabric serves the Vision by keeping Ashley one subject across changing
providers. Continuity, judgment, refusal, and identity cannot be outsourced to
a model family.

It preserves:

- Ashley owns meaning. Substrates provide mechanisms.
- One Ashley. Bounded specialists are not peer identities.
- Connection, availability, and a configured model ID are not capability.
- Context is bounded attention over persistent state.
- Telemetry is not evidence. A receipt is not an Effect Witness.
- Architecture before prompting.

## 3. Laws

```text
MODEL AVAILABLE != MODEL QUALIFIED
MODEL QUALIFIED != MODEL APPROVED FOR ROLE
MODEL CAN GENERATE CODE != MODEL MAY CHANGE THE REPOSITORY
MODEL FABRIC ROUTE != OPERATIONAL AUTHORITY
LOGICAL ROLE != SPECIALIST SEAT != MODEL IDENTITY != DELIVERY TRANSPORT
OWNER PREFERENCE AMONG APPROVED ROUTES OUTRANKS PURE COST
UNKNOWN CAPACITY MUST REMAIN UNKNOWN
OPENCODE WORKER OUTPUT != ASHLEY TRUTH != AUTHORITY TO APPLY
PRODUCER FAMILY MAY DIFFER FROM REVIEWER INDEPENDENCE GROUP
```

A newly discovered catalog model begins as `discovered / unqualified`. It is
never routable by mere presence in a vendor list. A disappearing model must
not require an architecture rewrite: seats persist; occupants change.

Model Fabric is a **specialist portfolio**, not a search for one best model
and not a single permanent utility model.

## 4. New capability

The phase adds:

- provider-neutral `ModelCapabilityProfile` mechanics;
- Ashley-owned purpose and route policy;
- bounded `SpecialistSession` correlation and budget;
- immutable caller-built `ContextProjection` transport;
- stage-valid attempt receipts, ordered invocation receipts, caller fallback
  chains, cancellation, privacy classification, and structured failure;
- explicit fallback policy, including per-role prohibition of model
  substitution;
- a temporary compatibility resolver with explicit removal criteria;
- stable `LogicalModelRole` workloads, replaceable `SpecialistSeat`
  occupants, and owner-approved `ModelRoutePolicy` pools;
- a catalog / qualification / capacity plane that can discover models into
  `unqualified` without promoting them;
- Track A elastic inference (later, after qualification) distinct from
  Track B OpenCode Worker.

## 5. Explicit non-capabilities

```text
MODEL ID IS NOT ARCHITECTURAL IDENTITY.
PROVIDER SDK IS NOT ROUTING AUTHORITY.
SPECIALIST SESSION IS NOT ASHLEY.
CONTEXT PROJECTION IS NOT CONTEXT BUDGET.
RECEIPT IS NOT QUALIFICATION.
FALLBACK IS NOT RELIABILITY BY DEFAULT.
CATALOG DISCOVERY IS NOT AUTHORIZATION.
OPENCODE IS NOT ASHLEY COGNITION.
OPENCODE IS NOT SANDBOX AUTHORITY.
```

Model Fabric does not add:

- Thought, Agency, Identity, Mind State, Recall, or relationship authority;
- Context Budget selection, compression, eviction, or retrieval ownership;
- execution, credential, browser, Git, deployment, or external-effect
  authority;
- automatic promotion of a profile, provider, or fallback;
- a second specialist registry inside Sandbox;
- OpenTelemetry types inside semantic domain contracts;
- operational admission, honesty, evidence truth, curiosity meaning, or
  memory meaning;
- an OpenCode engineering worker.

## 6. Predecessor and dependency contracts

Classified dependencies. See
[Cross-Phase Architecture](Ashley_Cross_Phase_Architecture.md#31-dependency-classes).

`OWNER_SELECTED_IMPLEMENTATION_ORDER`:

- Sandbox delivery gate is closed through M7 at exact candidate
  `48bad019fe601d5c871a54dd9902879862c6e96a`; M7 is limited to the named
  `patch_export` profile. This is predecessor evidence only. It is **not**
  the MF-M1 source baseline. Model Fabric does not derive authority or
  semantic ownership from Sandbox.

`CROSS_CUTTING_INTERFACE`:

- Evaluation / Qualification Plane for profile qualification meaning;
- Observability Plane for the Ashley-owned telemetry port;
- current Identity, Mind State, Thought, Agency, and privacy boundaries;
- Attention for admission, lifecycle, and request ledger;
- Operational Continuity for long-running work that consumes model attempts
  without transferring job lifecycle into Fabric.

Supporting, not semantic, predecessors:

- [`docs/Routing_Status.md`](../Routing_Status.md) for current route facts;
- Memory Evidence only where a later purpose must cite evidence identity.

MF-M1 package qualification is evidence, not architecture. F1-obs package
qualification, if that slice is ever built, is separately evidence.

Context Budget is a later consumer. Model Fabric must expose the minimal typed
`ContextProjection` envelope and must not pre-implement selection, hierarchy,
compression, or optimization.

## 7. Current owner to final owner

| Concern | Current owner | Final owner |
|---|---|---|
| Semantic purpose | Caller (Thought, Expression, cognition, curiosity, maintenance) | Same caller |
| Desired reasoning | Split / implicit in callers today | `ModelRoutePolicy.reasoningPolicy` |
| Route and model binding | Split among `config/models.json`, `PURPOSE_TO_ROUTE`, and registry dispatch | Ashley `ModelRoutePolicy` plus validated registry snapshot |
| Provider wire conversion | Provider adapters behind `completeChat` | `ModelProviderAdapter` |
| Admission / lifecycle | Attention Governor and `attention_requests` | Same Attention owner |
| Context content | Context Composer and caller | Caller-built `ContextProjection`; later Context Budget selects it |
| Qualification and promotion | Capability / owner decisions | Evaluation Plane plus explicit promotion |
| Telemetry transport | Process logs, Attention usage rows, and owner diagnostics | Observability Plane port with optional adapters |
| Catalog / health | None as a first-class plane | Model Fabric catalog + health, never auto-routing |

## 8. State introduced and its owner

| Record | Owner | Meaning |
|---|---|---|
| `LogicalModelRole` | Model Fabric policy | Ashley workload / why inference is requested. Not a model ID. Not every specialist skill. |
| `SpecialistSeat` | Model Fabric policy (assignment data) | Capability class a request may require (review, bulk, architecture, …). Occupied by models. Not a runtime purpose enum explosion. |
| `SpecialistRequirement` | Caller + route policy | Optional seat (or independence constraint) attached to one attempt. |
| `ModelIdentity` / `ModelRevision` | Model Fabric catalog | Who occupies a seat, including detectable revision. Includes `independence_group`. |
| `DeliveryBackend` / `ProviderIdentity` | Model Fabric | How bytes move (direct Mistral, NIM, Groq, later OpenCode/Zen or another qualified backend). Transport is not architectural identity. |
| `ModelCapabilityProfile` | Model Fabric | Mechanical facts only: context, modalities, structured output, **supported reasoning controls and vocabulary**, cancellation, limits. Does **not** store desired reasoning. |
| `ReasoningPolicy` | Model Fabric (`ModelRoutePolicy`) | Normalized desired reasoning for a role/seat |
| `RouteIdentity` | Model Fabric | One exact binding of role + optional seat + model + backend. Its admission basis is either `existing_compatibility` for a frozen pre-MF-M1 route or an Evaluation-owned qualification reference plus owner approval. |
| `ModelCapabilityProfile` | Model Fabric | Versioned mechanical provider/model facts: binding identity, supported wire capabilities, structured-output mechanics, and provider-options policy. Privacy suitability, reliability policy, route preference, fallback, cost, latency, qualification, and independence policy remain outside its fingerprint. |
| `QualificationResult` / `ModelProfileQualificationBinding` | Evaluation Plane / Model Fabric | Evaluation owns the result and its meaning. Fabric supplies the exact mechanical profile binding and may cite the immutable result. Fabric does not create qualification status. |
| `ResolvedModelRoute` | Model Fabric | Immutable dispatch decision for one attempt. |
| `SpecialistSession` | Model Fabric | Bounded specialist-work correlation, budget, and output contract. Not a worker, Ashley, or authority container. |
| `ContextProjection` | Caller policy plus Context Composer | Immutable model-facing content artifact. Rebuildable. Not memory. |
| `ModelAttempt` / `ModelAttemptReceipt` | Model Fabric | One resolved provider attempt and its stage-valid mechanical outcome, including proof that zero or one provider request was sent. |
| `ModelInvocationReceipt` | Model Fabric | One `completeChat`/Fabric invocation and its ordered zero-or-more attempt receipts. |
| `ModelFallbackChain` | Caller policy + Model Fabric correlation | One caller-owned chain containing one-or-more Fabric invocations, such as Expression primary then fallback. Correlation is not authorization. |
| `ModelRoutePolicy` | Model Fabric | Logical role (+ optional seat) to owner-approved eligible routes. Owner preference among approved routes outranks pure cost. |
| `CapacityLedgerEntry` | Model Fabric | Known / estimated / observed / unknown capacity. Never invented remaining quota. |

Live route values remain policy. They live in source/config and
[`docs/Routing_Status.md`](../Routing_Status.md), not as architectural
identity.

## 9. Authority added and explicitly not added

The phase may add authority to:

- dispatch one admitted model attempt for one purpose;
- bind one exact projection and profile;
- cancel an in-flight attempt;
- record a receipt;
- refuse dispatch when policy, budget, privacy, or profile qualification fails;
- ingest catalog observations into `discovered / unqualified` candidates
  (never into production routes). Any active refresh consumes separately
  admitted Network capability and External Effect authority for the exact
  destination, method, data class, and budget. Model Fabric owns the resulting
  candidate records; it does not self-grant network authority.

It does not add authority to interpret the result, materialize memory, start
initiative, invoke tools, or execute effects. A specialist cannot widen its
purpose, budget, or privacy ceiling.

## 10. Request, intent, and proposal ontology

The dispatch ontology is:

```text
caller purpose and output contract
  -> Attention admission (may this run now?)
    -> Model Fabric route resolution (which approved route?)
      -> ContextProjection
        -> ModelAttempt
          -> ModelAttemptReceipt
            -> caller-owned validation and materialization
```

A model response is a candidate input. It is not a decision, memory, or
authorization.

These identifiers are not interchangeable (`CONFIRMED FROM SOURCE`):

| Identifier | Current meaning |
|---|---|
| `thought_observation` | Attention/routing purpose requested by the observation job |
| `utility_bulk` | Configured compatibility route for that purpose in `config/models.json` |
| `thought` | Route currently forced by `runThoughtModel` (`route: "thought"`) |
| `thought.observation` | Historical F1-obs planned semantic purpose; not MF-M1 |
| `thought_observation_shadow` | Deferred F1-obs feature mode; not MF-M1 |

### 10.1 Three levels (do not collapse)

```text
A. LogicalModelRole     Ashley workload (thought, expression, exchange_cognition, …)
B. SpecialistSeat       capability class (review, bulk throughput, architecture, …)
C. Model + transport    occupant + backend (Spark via Zen, Lightning via NIM, …)
```

Do **not** explode every seat into a runtime purpose enum. MF-M1 records
current workloads truthfully, including the observation configured-vs-dispatched
mismatch. Seats become request `SpecialistRequirement` and assignment data.
Production seat routing waits for MF-M6.

Owner-approved assignment:

```text
stable role (+ optional seat)
  -> qualified candidates
    -> owner-approved pool
      -> current health / capacity among that pool
        -> ResolvedModelRoute
```

Cost and remaining quota may choose only among routes **already approved
for that exact role/seat**. They must not promote an unqualified model.

## 11. Current-state map (`CONFIRMED FROM SOURCE`)

Live compatibility snapshot: `sourceBaselineSha` =
`e36613bf805bb0a4f5e95ec11f0b8dd5dfb5857a` (canonical post-OF integration
baseline for live route facts). The MF-M1 implementation start and local
candidate are tracked separately above. Refresh
[`docs/Routing_Status.md`](../Routing_Status.md) when that source changes.
Routing Status remains living **current** facts. It must not be rewritten as
the §12.9 future target table.

### 11.1 What exists

| Piece | Status | Notes |
|---|---|---|
| `config/models.json` | `CURRENTLY ACTIVE` | Route records, enablement, quota contracts |
| `PURPOSE_TO_ROUTE` in `router.ts` | `CURRENTLY ACTIVE` | Purpose → route alias. JSON `purpose_routes` is parsed and **never used**. |
| `ROUTE_BINDINGS` in `registry.ts` | `CURRENTLY ACTIVE` | **Dispatched** provider + model. `requireRouteEnabled` uses JSON only for `enabled`, then returns this static binding. |
| Mistral / Groq / NIM adapters | `CURRENTLY ACTIVE` | Wire conversion only |
| `completeChat` | `CURRENTLY ACTIVE` | Facade: resolve route → Attention → adapter; Thought NIM→Groq same-model failover |
| Attention Governor | `CURRENTLY ACTIVE` | Admission, **RPS + TPM only**, request ledger. `rpm`/`rpd`/`tpd` exist on quota contracts and are **not enforced**. `foldAttentionDailyUsage` is **test-only**; production does not fold `attention_daily_usage`. |
| Expression Groq fallback | `CURRENTLY ACTIVE` | Different model; policy-gated; not same-model transport failover |
| Disabled sandbox/experimental routes | `FROZEN / DISABLED` | Config present, `enabled: false`, fail-closed |
| OpenRouter | `LEGACY / ABSENT` | No current adapter or route |
| `ASHLEY_MODEL_FABRIC_MODE` | `PROPOSED / DOCS-ONLY` | Named in spike docs; not parsed in current `env.ts` |
| Model Fabric types/runtime | `PROPOSED` | Not implemented in source |
| OpenCode harness (OC-M0/OC-M1) | `BOUNDED OFF-TREE FOUNDATION PROVEN` | OC-M0 and one synthetic OC-M1 bugfix physically passed. Worker-shaped, off-tree, and not a production inference adapter or repository integration |
| OpenCode in production routing | `ABSENT` | No current route uses OpenCode |

### 11.2 Live purpose → route → provider → model

| Purpose | Configured route | Dispatched route | Provider | Model | Quota bucket |
|---|---|---|---|---|---|
| `expression` | `ashley_expression` | `ashley_expression` | Mistral | `mistral-medium-latest` | `mistral:mistral-medium-latest` unless `MISTRAL_MODEL` overrides |
| Expression eligible primary failure | `ashley_expression_fallback` | `ashley_expression_fallback` | Groq | `qwen/qwen3.6-27b` | `groq:qwen/qwen3.6-27b` |
| `thought` | `thought` | `thought` | NIM primary / Groq same-model failover | `openai/gpt-oss-20b` | `nim:openai/gpt-oss-20b` / `groq:openai/gpt-oss-20b` |
| `exchange_cognition` | `utility_bulk` | `utility_bulk` | Groq | `openai/gpt-oss-20b` | `groq:openai/gpt-oss-20b` |
| `curiosity_consolidation` | `utility_bulk` | `utility_bulk` | Groq | `openai/gpt-oss-20b` | same shared Groq 20B bucket |
| `maintenance` | `utility_bulk` | `utility_bulk` | Groq | `openai/gpt-oss-20b` | same shared Groq 20B bucket |
| `thought_observation` | `utility_bulk` in JSON | **forced `thought`** by `runThoughtModel` | NIM / Groq failover | `openai/gpt-oss-20b` | Thought buckets, not the utility mapping |
| Reflection adjudication (`purpose: thought_observation`) | `utility_bulk` by purpose | **forced `thought`** | NIM / Groq route path | caller overrides `env.mistralModel` | mismatched Thought-provider bucket for a Mistral model ID |
| Engineering adapter (purpose omitted, lane omitted) | `ashley_expression` via `mapLegacyLane` default `purpose: expression` | `ashley_expression` | Mistral | caller overrides `env.mistralModel` | shared Expression bucket |

`routeReady("thought")` is true if NIM is enabled and either `NIM_API_KEY` or
`GROQ_API_KEY` is present. That is readiness, not proof of live Mint keys.

`config/env.example` comments that claim NIM is disabled and Thought is Groq
120B are **stale relative to `config/models.json` and `registry.ts`**.

### 11.3 Callers (`CONFIRMED FROM SOURCE`)

| Workload | Source | Purpose / route | Identity sensitivity |
|---|---|---|---|
| Core Thought (Pass 1 / continuation) | `agency/thought.ts` `runThoughtModel` | purpose `thought`, route forced `thought` | Highest |
| Thought observation shadow | `agency/thought-observation.ts` | purpose `thought_observation`, route still forced `thought` | High; currently shares Thought model. **Early-returns if `GROQ_API_KEY` is missing**, even though dispatch is the Thought/NIM path. NIM-only Thought can still run while observation is a no-op. |
| Expression | `conversation/expression.ts` | `expression` / Mistral | Highest voice/identity |
| Expression fallback | `conversation/expression-fallback.ts` | Groq Qwen after eligible Mistral failure | High; reduced identity context |
| Exchange cognition / episode analysis | `cognition/worker.ts` | `exchange_cognition` / `utility_bulk` | Medium; conversation evidence |
| Curiosity consolidation | `curiosity/consolidate.ts` | `curiosity_consolidation` / `utility_bulk` | Medium; untrusted source text |
| Initiative / OCI model adjudicator | `reflection/initiative.ts` | **explicit `route: "thought"`** + `purpose: "thought_observation"` + `model: env.mistralModel` | Medium-high. Quota bucket becomes `nim:<mistral-id>` (no matching contract → Mistral TPM numbers applied to a NIM call). No deadline. |
| Engineering thinking adapter | `sandbox/engineering-model-adapter.ts` | no `route`/`purpose`; `completeChat` defaults to Expression / Mistral TPM | Low prompt identity, **high quota coupling** with live Expression. Internal label `route: "thinking"` is not a `RouteId`. |
| Maintenance purpose | schema + tests | `maintenance` | **No production `completeChat` caller** |
| Eval judge scripts | `scripts/persona-eval/*` | direct Mistral HTTP, **not** Attention | Out of process |

### 11.4 Fallback as implemented

Two different mechanisms exist. They must not be collapsed.

1. **Thought same-model transport failover** (`CONFIRMED FROM SOURCE`):
   NIM `openai/gpt-oss-20b` → Groq `openai/gpt-oss-20b` on
   `rate_limited`, `provider_unavailable`, `agent_not_ready`,
   `request_exceeds_tpm_budget`, when remaining deadline ≥ 2500 ms.
   Abort is not eligible. This is **transport fallback**, not model
   substitution.

2. **Expression model substitution** (`CONFIRMED FROM SOURCE`):
   Mistral Medium → Groq `qwen/qwen3.6-27b` after eligible Mistral
   failure, with a reduced identity/context profile. Missing key, budget,
   route-lifecycle, abort, and deadline failures are **not** eligible.
   Some decision kinds may be pinned `mistral_only`.

Utility purposes have **no** documented second-model fallback. Background
cognition is Groq-only.

The deferred F1-obs contract still says Thought-observation has no
fallback. That is **F1-obs policy**, not current Thought production
behavior, and not MF-M1.

### 11.5 Attention vs routing (`CONFIRMED FROM SOURCE`)

Attention owns:

- whether a request may be dispatched now;
- lane mapping from purpose;
- **RPS (1s) + TPM (60s)** per quota bucket `provider:configuredModelId`;
- request lifecycle in `attention_requests` (estimated and actual prompt/completion tokens; **reasoning tokens are not a DB column** except Thought attempt JSON);
- model-continuity epoch / resolved-id change demotion of model-sensitive
  capabilities.

Attention does **not** choose the model. `completeChat` passes an already
selected provider, alias, and bucket into `runAttentiveDispatch`.
`options.model` may override the binding alias and therefore the bucket.

Routing / `completeChat` owns:

- purpose → route → provider → configured model;
- adapter selection;
- Thought NIM→Groq failover;
- provider error mapping into `AppError` codes.

`PROPOSAL` boundary:

```text
Attention: should / may this cognition request be dispatched now, and what is
its lifecycle?
Model Fabric: which approved model route can satisfy it, and how is it
delivered?
```

Do not duplicate the Attention request ledger inside Fabric. Fabric receipts
may cite `attention_requests.id` / `dispatch_sequence`.

**Source gotchas for MF-M1 (do not “fix” in the seam):**

- Thought failover and `utility_bulk` share `groq:openai/gpt-oss-20b` TPM (8000). A utility storm can starve Thought failover.
- Expression fallback is a **separate** Groq bucket `groq:qwen/qwen3.6-27b` (TPM **6100** in `config/models.json`).
- Groq/NIM gpt-oss adapters coerce `reasoning_effort: "none"` → `"low"` (HTTP 400 otherwise).
- `context_profile` on route bindings is unused at dispatch; Expression fallback builds a reduced prompt in application code.
- Boot does not require Groq or NIM keys; they fail at first dispatch / `routeReady`.

### 11.6 Token-pressure evidence

**What can be measured** (`CONFIRMED FROM SOURCE`):

- reserved vs actual input/output tokens per Attention request;
- TPM window usage per quota bucket (enforced);
- rate-limited / error / timeout outcomes;
- `GET /nuclear/routing` per-route `tpmUsed` / `tpmRemaining`.

**Observability gaps** (`CONFIRMED FROM SOURCE`, Attention audit 2026-08-25):

- `foldAttentionDailyUsage` is called from tests only. Do not assume production
  `attention_daily_usage` is populated.
- `GET /nuclear/attention` `rpsLimit` / `tpmLimit` / `reservedTpm` are **Mistral
  env defaults**, not per-bucket. Multi-provider pressure is invisible there.
- `rpm` / `rpd` / `tpd` on quota contracts are unused by the ledger.
- Output reservation is the full `maxTokens`, so Thought can reserve ~1000
  output tokens for a short JSON answer.
- Proactive Thought, Thought-observation, cognition worker, and curiosity
  consolidation currently pass **no** `deadlineAtMs` (interactive Thought and
  Expression do).

**What this audit did not measure:** production Mint `nuclear.db`
token mix by purpose. Local Windows DBs are not production authority.

**Verdict:** owner hypothesis that token pressure is mostly *not* in core
Thought/Expression is **not yet empirically verified**. It is **plausible**
because four configured purposes share one Groq 20B utility mapping, and
Thought already has a separate NIM/Groq 20B pair. Treat token-savings
percentages as `UNKNOWN` until purpose-tagged usage is observed on Mint.

**Resilience fact that does not require Mint percentages**
(`CONFIRMED FROM SOURCE`): live `utility_bulk` and Thought's Groq
same-model failover share `groq:openai/gpt-oss-20b`. Elastic utility
offload is therefore not merely cost optimization. It can isolate
high-volume expendable work from **core Thought fallback capacity**. That
is a Model Fabric motivation. Do not claim measured savings until
telemetry proves them.

`PROPOSAL` observability before cost claims: emit logical role, route,
backend, model identity, provider, fallback history, tokens, latency,
outcome, and qualification identity on every receipt; query Mint
`attention_daily_usage` and `attention_requests.purpose`. Do not persist
hidden chain-of-thought.

### 11.7 Live source vs historical policy vs owner-selected future target

Do not collapse these layers.

**Live source / MF-M1 `existing_compatibility`** (`CONFIRMED FROM SOURCE` at
`e36613b`; see Routing Status):

- Thought: NIM `openai/gpt-oss-20b` primary, `reasoningEffort: "low"`, eligible
  Groq same-model 20B transport failover (one `completeChat` invocation, two
  attempts).
- Expression: Mistral Medium primary → Groq Qwen 3.6 27B caller fallback
  (`reasoningEffort: "none"` on fallback; Groq gpt-oss adapters coerce
  `none`→`low` only for gpt-oss ids, not this Qwen hop).
- Utility (`exchange_cognition`, `curiosity_consolidation`, configured
  `maintenance`): Groq `openai/gpt-oss-20b`.

These are current facts, not timeless architecture. MF-M1 must wrap this
table with **zero** intended routing/provider/model/reasoning change.

**Historical 2026-08-13 planned target** (F1-obs / older contract; not live;
not MF-M1): `thought.decision` Groq 120B; Lightning specialist/utility;
Thought-observation Lightning `single_attempt` / no fallback. Retained as
provenance. Do not treat Groq 120B as **current** Thought.

**Historical 2026-08-24 routing commit** `90930ae` (on the line inherited by
`04beaf1` then `8eedad8`): moved live Thought from Groq 120B single-dispatch
to NIM 20B + Groq 20B failover. That is **current compatibility**, not a
future target.

**Owner-selected post-MF-M1 direct-provider target** (`OWNER CLOSED` 2026-08-25
as **target policy**, §12.9): includes reversing Expression to Qwen primary /
Mistral fallback and moving Thought to Groq 120B with NIM 120B same-model
failover. **Not current. Not qualified. Not authorized for activation.**
MF-M1 must not implement it.

**Owner-accepted OpenCode specialist-seat portfolio** (§12.4): scouting
occupants for later seats. Not production-routable in MF-M1.

### 11.8 Normalized `ReasoningPolicy` (`OWNER CLOSED` architecture)

Reasoning effort is a first-class route-policy concern. Ashley normalizes
desired effort. Provider adapters translate it. Do not pretend all providers
share one vocabulary.

Ashley-level `ReasoningPolicy` (names may be refined later only if they stay
this coarse):

| Normalized | Intent |
|---|---|
| `disabled` | No extra hidden reasoning / thinking budget |
| `economical` | Light / low when the provider exposes a control |
| `standard` | Default bounded reasoning |
| `high` | Spend more reasoning; interactive Thought uses this as the **target** after qualification |
| `max_supported` | Highest supported control for that profile (background/deep seats) |

Adapter examples (`PROPOSAL` mapping, not live dispatch):

| Family | Mechanical vocabulary |
|---|---|
| Groq GPT-OSS | `low` / `medium` / `high` (illegal `none` coerced to `low` in current adapters) |
| Groq Qwen | `none` / `default` (owner target for Expression primary is **on / default**, not `none`) |
| Nemotron / NIM | thinking enabled/disabled; reasoning budget where supported |
| Other providers | exact supported mechanism only; unknown → fail closed or omit, never invent |

Ownership:

| Object | Owns |
|---|---|
| `ModelCapabilityProfile` | Mechanical support facts only: controls, vocabulary, budget mechanics, restrictions. **Does not** decide desired reasoning |
| `ModelRoutePolicy` | Normalized desired `ReasoningPolicy` for that role/seat |
| `ResolvedModelRoute` | Provider-specific **effective** reasoning after translation |
| `ModelAttemptReceipt` | What was **actually** requested/sent |
| Qualification | Model + **material inference-policy** configuration (see §15) |

Same model id + different material reasoning is not automatically the same
`existing_compatibility` or the same `QualificationResult`. Example: Qwen
`none` ≠ Qwen `default`.

## 12. Portfolio: roles, seats, occupants (`OWNER CLOSED` architecture)

Model Fabric is a specialist **portfolio**. It does not search for “the best
model.” It does not freeze one permanent utility model. Models occupy seats.
Seats persist when models disappear.

### 12.1 Logical workloads (Ashley roles)

These are `LogicalModelRole` values. Keep the set close to real callers.

| Logical role | Current source home | Identity sensitivity | Fabric tier |
|---|---|---|---|
| `thought` | `runThoughtModel` | Extreme | A — core cognition |
| `expression` | `expressSpeak` | Extreme | A |
| `thought_observation` | observation job | High | B — expose mismatch; do not repair in MF-M1 |
| `reflection_initiative` | `reflection/initiative.ts` | High | B |
| `exchange_cognition` | cognition worker | Medium | B / C |
| `curiosity_consolidation` | curiosity consolidate | Medium | B / C |
| `maintenance` | purpose only; no production caller | Lower | C |
| `engineering` | Sandbox adapter today (wrong quota coupling) | Authority coupling | Role + requirement recorded in MF-M1; specialist routing is D later |
| `research` | future / curiosity-adjacent | Medium | C / D later |

Tiers:

| Tier | Roles | Model-switch tolerance | OpenCode Track A |
|---|---|---|---|
| A Core cognition | `thought`, `expression` | Very low | **Not initially.** Dedicated directly-qualified routes. |
| B Cognitive support | observation, reflection, memory/curiosity | Low–medium | Later, after qualification |
| C Elastic utility | summarization, extraction, classification, bulk | Medium among **approved** pool | **First OpenCode target** after MF-M3 qualification + owner approval |
| D Specialist | architecture, implementation, review, audit, debug | Role/seat-specific; review independent | After MF-M6 |

### 12.2 MF-M1 role set (hard)

MF-M1 wraps what already works. It does **not** invent specialist seats as
runtime purposes.

Record every current production inference caller without collapsing semantic
purpose into a route name:

| Current caller | `LogicalModelRole` | `SpecialistRequirement` | Configured route | Dispatched route / current special case |
|---|---|---|---|---|
| `runThoughtModel` for active Thought, including durable Thought | `thought` | none | `thought` | `thought`; preserve NIM → Groq same-model failover |
| `expressSpeak` primary | `expression` | none | `ashley_expression` | `ashley_expression` |
| `expressSpeak` eligible fallback | `expression` | none | `ashley_expression_fallback` | `ashley_expression_fallback`; second Fabric invocation in the same caller fallback chain |
| `enqueueThoughtObservation` | `thought_observation` | none | purpose maps to `utility_bulk` | caller forces `thought`; preserve configured ≠ dispatched and the Groq-key early return |
| `modelReflectionAdjudicator` | `reflection_initiative` | none | purpose maps to `utility_bulk` | caller forces `thought` and overrides `model: env.mistralModel`; preserve and expose the mismatch |
| cognition `analyzeExchange` | `exchange_cognition` | none | `utility_bulk` | `utility_bulk` |
| `consolidateCuriosityRead` | `curiosity_consolidation` | none | `utility_bulk` | `utility_bulk` |
| `createEngineeringThinkingModel` | `engineering` | `complex_orchestration` | omitted purpose/lane resolves to `ashley_expression` (`CONFIRMED FROM SOURCE` at `e36613b`) | current `model: env.mistralModel` and Expression quota coupling remain; seat is recorded but does not select a model in MF-M1 |
| configured maintenance purpose | `maintenance` | none | `utility_bulk` | no current production caller; configuration remains visible |

`utility_bulk` is a current route identity. It MUST NOT replace
`exchange_cognition`, `curiosity_consolidation`, or `maintenance` as their
semantic logical role.

Do not “fix” observation routing, engineering quota coupling, reflection's
`model: env.mistralModel`, or any other current mismatch in MF-M1. Represent
them truthfully.

### 12.3 Specialist seats (capability classes, not purpose enums)

A `SpecialistSeat` is an occupant class. A request may attach a
`SpecialistRequirement` naming one seat. That is not a new top-level
architecture phase and not a 25-value `LogicalModelRole` enum.

Seat identifiers (assignment / qualification data):

| Seat | Character |
|---|---|
| `systems_architecture` | Design / architecture specialist |
| `architecture_critique` | Review of architecture, distinct from producing it |
| `implementation_planning` | Spec / plan design |
| `code_generation` | Produce code |
| `accepted_spec_implementation` | Deep-work executor from an accepted spec |
| `engineering_review` | Defect-finding review |
| `adversarial_audit` | Skepticism, crash windows, authority smuggling |
| `root_cause_debugging` | First causal break |
| `test_counterexample_design` | Tests that could fail the claim |
| `research_synthesis` | Source reconciliation, UNKNOWN preservation |
| `deep_long_context_analysis` | Cross-document retention |
| `multimodal_analysis` | Cross-modal grounding |
| `structured_bulk_extraction` | Schema / JSON fidelity at volume |
| `classification` | Throughput classification |
| `maintenance_bulk` | High-volume maintenance cognition |
| `bulk_summarization` | Routine summarization |
| `high_value_synthesis` | Compression that must not drop the point |
| `routine_validation` | Cheap schema/check passes |
| `routine_subagent` | High-volume sub-agent work |
| `complex_orchestration` | Long-running multi-step model work |
| `general_specialist_overflow` | High-end overflow when a named seat is empty |

Production activation of seats is **MF-M6**. Catalog/qualification (**MF-M3**)
may already name seats as pack targets without routing them.

### 12.4 OpenCode specialist-seat portfolio (`OWNER CLOSED` as accepted scouting identities)

Do not replace or discard this portfolio. Seat identity is architecture.
Model occupancy is replaceable policy. OpenCode roster availability remains
ephemeral. Not production-routable in MF-M1.

Stable occupant **names**. Wire IDs and backends are policy and may churn.

| Occupant | Character | Primary scouting seats | Secondary |
|---|---|---|---|
| Muse Spark 1.2 | Review / audit / debugging champion | engineering_review, adversarial_audit, root_cause_debugging, test_counterexample_design, architecture_critique, code_generation | implementation, architecture/design, research synthesis, general_specialist_overflow |
| Hy3 | Design / architecture specialist | systems_architecture, implementation_planning, code_generation | root_cause_debugging, complex_orchestration, architecture_critique |
| MiMo-V2.5 | Versatile / multimodal / independent second lens | independent second review, adversarial second opinion, multimodal_analysis, long-context adjunct, structured complex extraction | research/document synthesis, code review, high_value_synthesis, schema validation |
| Nemotron 3 Ultra | Deep-work executor / orchestrator | accepted_spec_implementation, complex_orchestration, research_synthesis, deep_long_context_analysis, high_value_synthesis | bulk, classification fallback, routine_subagent fallback |
| Nemotron 3.5 Lightning | Throughput workhorse | maintenance_bulk, classification, structured_bulk_extraction, bulk_summarization, routine_validation, routine_subagent | maximum-throughput fallback |

These are **not** production-qualified, **not** automatically routable, and
**not** Thought/Expression occupants. Free-roster API ids remain in the
ephemeral OpenCode snapshot.

### 12.5 Qualification / assignment hypothesis (replaceable)

Primary / secondary here are scouting order, not runtime weights.

| Seat | Primary scout | Secondary scout |
|---|---|---|
| `systems_architecture` | Hy3 | Spark |
| `architecture_critique` | Spark | MiMo (independence) or Hy3 |
| `code_generation` | Spark | Hy3 |
| `accepted_spec_implementation` | Ultra | Spark |
| `engineering_review` | Spark | MiMo |
| `adversarial_audit` | Spark | MiMo |
| `root_cause_debugging` | Spark | Hy3 |
| `test_counterexample_design` | Spark | MiMo |
| `implementation_planning` | Hy3 | Spark |
| `research_synthesis` | Ultra | Spark |
| `deep_long_context_analysis` | Ultra | MiMo |
| `multimodal_analysis` | MiMo | — |
| `structured_bulk_extraction` | Lightning | MiMo |
| `classification` | Lightning | Ultra |
| `maintenance_bulk` | Lightning | Ultra |
| `bulk_summarization` | Lightning | Ultra |
| `high_value_synthesis` | Ultra | MiMo |
| `routine_validation` | Lightning | MiMo |
| `routine_subagent` | Lightning | Ultra |
| `complex_orchestration` | Ultra | Hy3 |
| `general_specialist_overflow` | Spark | MiMo |

If Spark disappears tomorrow, `engineering_review` remains. Assignment data
changes. Architecture does not.

### 12.6 Owner hands-on rankings (`OWNER OBSERVATION`)

Human prior for **qualification order** only. Not qualification evidence,
not production authorization, not automatic route weights.

| Concern | Order |
|---|---|
| Coding | Spark = Hy3 > MiMo 2.5 > Ultra > Lightning |
| Architecture | Hy3 = Spark > MiMo 2.5 > Ultra > Lightning |
| Implementation | Ultra = Spark > Hy3 > MiMo 2.5 > Lightning |
| Review / audit | Spark > MiMo 2.5 > Hy3 > Ultra > Lightning |
| Bulk | Lightning = Ultra |

Evidence hierarchy (do not collapse):

```text
owner hands-on experience     = scouting prior
vendor benchmark              = supporting evidence
Ashley qualification result   = purpose/seat-specific evidence
owner approval                = route authorization
runtime health / capacity     = selection among approved routes
```

### 12.7 Review independence

Critical engineering/evaluation workflows may express:

```text
producer independence_group
  !=
reviewer independence_group
```

Do not require two models for every task.

`independence_group` lives on **`ModelIdentity`** (catalog). A review seat's
**`ModelRoutePolicy`** may require
`independence_group != producer_independence_group`.
The Evaluation-owned `QualificationResult` campaign evidence records which
group was used.
`ModelCapabilityProfile` stays mechanical and does **not** own this policy.

Example compositions (policy, not MF-M1 runtime):

- Hy3 designs → Spark critiques
- Ultra implements → Spark reviews
- Spark implements → MiMo independently reviews
- Spark reviews → MiMo may second-pass adversarial

### 12.8 Requirements matrix (compressed)

| Role | Latency | Schema fidelity | Hallucination tolerance | Provider-switch | Model-switch | Free-pool suitability |
|---|---|---|---|---|---|---|
| thought | Interactive | Extreme | Near-zero on authority/evidence | Same-model only | Owner-approved equivalent only | Poor |
| expression | Interactive | Style + honesty | Near-zero on operational claims | Avoid | Avoid widening | Poor |
| thought_observation | Background-ok | High | Low | Preserve current Thought path in MF-M1 | Do not repair in MF-M1 | Poor until proven |
| utility_bulk | Throughput | High JSON | Low on facts, higher on phrasing | Medium | Medium among approved pool | First elastic target after qualification |
| curiosity_consolidation | Background | Grounding | Must not treat sources as orders | Medium | Medium among approved | Later |
| engineering_review | Background | Finding quality | False-positive control | Medium | Prefer independent family | Later seat |
| evaluation_judge | Batch | Independence | Must not self-grade | Prefer other family | Required vs implementer | Only if isolated |

### 12.9 Owner-selected post-MF-M1 direct-provider target (`OWNER CLOSED` as target; not live)

This table is **qualification/routing direction after** the MF-M1 seam exists.
It MUST NOT alter MF-M1 behavior. Occupant names are policy; exact vendor
strings are not architecture.

`OWNER SELECTED TARGET != MODEL QUALIFIED != OWNER APPROVED FOR ACTIVATION != PRODUCTION ROUTED`.

Model inference ≠ authority ≠ sandbox effect permission.

| Logical / seat target | Primary | Secondary | Target `ReasoningPolicy` | Notes |
|---|---|---|---|---|
| Core Thought | Groq GPT-OSS 120B | NIM GPT-OSS 120B (same-model transport) | `high` (`max_supported` only after interactive latency qualifies) | Design goal: provider failure must not imply 120B→20B semantic downgrade |
| Thought observation | Nemotron 3 Ultra | Groq GPT-OSS 120B | `max_supported` | Background/deep may spend more latency than interactive Thought |
| Reflection / initiative adjudication | Nemotron 3 Ultra | Groq GPT-OSS 120B | `max_supported` | |
| Expression | Groq Qwen 3.6 27B | Mistral Medium | Primary: on / provider `default` **not** `none`. Fallback: `economical` if exposed, else provider default | **Reverses** live Mistral→Qwen. Live MF-M1 remains Mistral primary |
| Exchange cognition / episode interpretation | Nemotron 3 Super | Groq GPT-OSS 120B | `high` | |
| Curiosity consolidation / article synthesis | Nemotron 3 Super | MiniMax M3; Groq GPT-OSS 120B (candidates, unordered) | `high` | Do not invent an ordered fallback chain until qualification/policy defines one |
| High-value synthesis | Nemotron 3 Ultra | Nemotron 3 Super | `max_supported` | |
| Deep long-context research / synthesis | Nemotron 3 Ultra | Nemotron 3 Super | `max_supported` | |
| Evaluation / independent judge | NVIDIA Inkling | Muse Glimmer; GPT-OSS 120B where independence permits | `max_supported` | Producer/reviewer independence constraints |
| Adversarial second judge | Muse Glimmer | Inkling | `high` / `max_supported` | |
| Multimodal analysis | Muse Glimmer | Inkling; MiniMax M3 | `high` | |
| Direct engineering cognition (when OpenCode is not the worker) | Nemotron 3 Ultra | Muse Glimmer; Nemotron 3 Super | `max_supported` | Does **not** grant engineering effect authority |
| Routine maintenance cognition | Nemotron 3.5 Lightning | Groq GPT-OSS 20B | `standard` / bounded | |
| Bulk summarization | Nemotron 3.5 Lightning | Groq GPT-OSS 20B | `economical`–`standard` | |
| Structured extraction / normalization | Groq GPT-OSS 20B | Nemotron 3.5 Lightning | `economical` | |
| Classification / tagging / screening | Nemotron 3.5 Lightning | Groq GPT-OSS 20B | `disabled` / `economical` | Escalate ambiguous cases; do not max-reason every tag |
| Routine validation | Nemotron 3.5 Lightning | Groq GPT-OSS 20B | `economical`–`standard` | |

Consequential OpenCode specialist seats (architecture, implementation,
engineering review, adversarial audit, root-cause debugging, research
synthesis, complex orchestration) target `max_supported`. Bulk/throughput
seats may use lower reasoning.

## 13. Identity design (`OWNER CLOSED` for M2–MF-ACT identity grain)

Canonical identities. Do not collapse them into one config string.

Exact field contracts:
[`Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md`](Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md)
§1–§3.

```text
PortfolioRevisionId     mfp_…
PolicyRowId             mfr_<logicalRole>_<occupancyKey>_<rev>
OccupantId              mfo_…
LogicalModelRole        thought | expression | …
occupancyKey            interactive | durable_proactive | default | seat id
SpecialistSeat          data, not 25 purposes
QualificationSubject    role/seat + material inference fingerprint
AdmissionBasis          existing_compatibility | qualification + OwnerApprovalRef
ActivationRef           distinct owner act; required for production-routed target rows
```

```text
LogicalModelRole        thought | expression | thought_observation | exchange_cognition | engineering | …
SpecialistSeat          engineering_review | maintenance_bulk | …   (data, not 25 purposes)
SpecialistRequirement   optional seat + optional independence constraint
ModelIdentity           vendor-stable occupant id + independence_group
ModelRevision           observed resolved id / version / digest if any
DeliveryBackend         mistral_direct | nim | groq | opencode_zen_http | opencode_agent | …
ProviderIdentity        mistral | nvidia | groq | opencode_zen | …
RouteIdentity           thought/nim/openai-gpt-oss-20b
AdmissionBasis          existing_compatibility | qualification result id + owner approval
```

Operator mapping is data, not architecture:

```text
Model X:
  approved_roles: [utility_bulk]
  approved_seats: [maintenance_bulk, classification]
  denied_roles: [thought, expression]
  independence_group: nvidia_nemotron
  candidate_only: false
```

Owner preferences override automatic cost/capacity chasing among **approved**
routes. Capacity may inform **which approved route is healthy**, not **which
unqualified model to try**.

## 14. Capability card (`PROPOSAL`)

A card is evidence, not authorization.

Minimum fields: identity, independence_group, provider, transport, context
window, output limit, latency observations, schema fidelity, **mechanical
reasoning controls** (not desired effort), coding quality, review quality,
instruction adherence, hallucination notes, tool/vision if relevant, known
quirks, quota/capacity class (`known` / `estimated` / `observed` /
`unknown`), qualification timestamp, corpus/version.

Where providers only expose moving aliases, record `revision_detectable:
false` and require periodic re-qualification rather than silent drift
authorization.

## 15. Qualification (`OWNER CLOSED` subject grain; Evaluation still owns meaning)

Evaluation Plane owns qualification meaning and promotion recommendation.
Model Fabric supplies bound profile and receipt facts and **binds** a
`QualificationResult` to a role/seat + material inference fingerprint +
policy-row identity. Each fallback occupant requires its own
`QualificationResult`. Chains and portfolios are not transferable
qualification blobs.

`RELEASE_QUALIFIED` remains the canonical release-readiness term.
A local adapter test is not qualification.
A green test is not owner approval.
Owner approval is not activation.
Same model under a materially different reasoning or inference-policy
configuration may require separate qualification evidence. Target occupants
in §12.9 tell Evaluation **which configurations to qualify first**. They do
not bypass `QualificationResult`, `ModelProfileQualificationBinding`, owner
promotion, enablement, deployment, or production observation.

Lifecycle:

```text
discovered
  -> unqualified
    -> qualifying
      -> qualified          (evidence exists; still not routable)
        -> owner_approved   (named role and/or seat)
          -> routable_while_healthy
degraded | unavailable | retired
```

MF-M1 also defines one non-transferable compatibility state for routes that
were already active before the seam:

```text
existing_compatibility
  = exact pre-MF-M1 logical role
    + configured route
    + explicit requested route (if any)
    + dispatched route
    + provider
    + configured and effective model
    + fallback/failover topology
    + material inference-policy fingerprint
```

The inference-policy fingerprint MUST include, when materially relevant:

- normalized and provider-effective reasoning mode/effort;
- temperature;
- top_p;
- max-output policy;
- structured-output mode;
- other semantic provider options that change output identity.

Same model id + different material reasoning does **not** inherit this
tuple. Qwen reasoning `none` ≠ Qwen reasoning `default`.

`existing_compatibility` permits only preservation of that exact binding. It
MUST NOT authorize a new provider, model, route, role, seat, fallback, or
privacy class. Any normative change leaves compatibility and fails closed
until an exact `QualificationResult` exists and the owner separately approves
the route. MF-M1 must not fabricate historical qualification for current
routes.

Automatic **catalog discovery** into `discovered / unqualified` is allowed
only through separately admitted Network capability and External Effect
authority. Offline or caller-supplied catalog import needs no network grant.
Automatic **promotion** is not.

No runtime "pick whatever free model exists."

Ashley-specific packs (not generic LMSYS scores). This pass designs
categories; it does not run them.

| Pack | Must probe |
|---|---|
| Thought | Decision schema, evidence disposition, bounded ops, authority-smuggling resistance, instruction hierarchy |
| Expression | Natural communication, no operational-claim inflation, style, medium awareness, floor preservation |
| Architecture | Architectural consistency, boundary preservation, dependency reasoning, avoids whack-a-mole |
| Implementation | Spec fidelity, minimal diff, test awareness, recovery handling |
| Review | Real defect discovery, false-positive control, independence from supplied framing |
| Adversarial / skeptic | Challenges happy path, crash windows, concurrency, authority smuggling, incorrect assumptions |
| Debugging | Identifies first causal break; avoids random retries |
| Bulk utility | Structured accuracy, throughput, JSON/schema fidelity |
| Research synthesis | Source reconciliation, contradiction handling, UNKNOWN preservation |
| Long context | Important-fact retention, cross-document consistency |
| Multimodal | Faithful cross-modal grounding |
| Judge | Independence, rubric stability, no self-preference |
| Multilingual | Turkish/English owner context without identity drift |

Thought/Expression packs remain mandatory before any later attempt to change
those production routes. Seat packs apply before a scouting occupant becomes
`owner_approved` for that seat.

## 16. Dynamic availability (`OWNER CLOSED` for M5 machinery)

Required predicates: `configured`, `available`, `ready`, `qualified`,
`owner_approved`, `active`, `degraded`. These are distinct. Unhealthy ≠
unqualified. Recovery does not re-qualify.

Process-local cooldown is reconstructable and is not qualification
authority. No periodic Fabric catalog/qualification daemon in M2–M6.

If today's free model disappears, core Thought and Expression remain on
their **active** approved occupants or, if none remain, fail closed per
the role. Outage MUST NOT rewrite canonical target policy. Unqualified
substitution never runs live.

Required states: route health, unavailable, cooldown, transient vs durable
unavailability, provider/model-not-found, rate-limit, quota exhaustion,
retirement, catalog refresh, owner-visible status.

If today's free model disappears, core Thought and Expression must remain
functional on their direct routes. Specialist seats remain; assignments
empty or fail closed to an approved overflow occupant.

Catalog refresh may be automated into `discovered` only through the exact
Network/External Effect admission described above. Role/seat assignment must
not be automated.

## 17. Capacity ledger (`PROPOSAL`)

Respect provider terms. No circumvention, no account rotation.

Owner 2026-08-25: **service-use / unattended-agent terms are
non-blocking for this architecture**. That does **not** mean every model
may receive every private Ashley prompt. Route-level privacy classification
and data-boundary remain. NVIDIA trial “no confidential data” is a
**privacy** constraint, not an architecture-ToS blocker.

Ledger fields must distinguish:

| Kind | Meaning |
|---|---|
| known | Vendor-published remaining quota for this credential |
| estimated | Derived from contracts (RPS/TPM) not remaining daily free |
| observed | 429/quota errors, measured TPM |
| unknown | Default for OpenCode free remaining allowance |

OpenCode Zen free remaining quota is **not published** and must stay
`unknown` (`CONFIRMED FROM OFFICIAL PUBLIC DOCUMENTATION` + GitHub issues
as secondary: silent 429 / `FreeUsageLimitError`, opaque caps).

Current Ashley quota contracts in `config/models.json` are **local
admission ceilings**, not vendor remaining-balance oracles.

Shared live bucket `groq:openai/gpt-oss-20b` (utility + Thought failover)
is the concrete resilience motivation for later elastic utility offload.

## 18. Fallback semantics (`OWNER CLOSED` distinction)

Never: keep trying random free models until one responds.

| Class | Variance | Allowed when |
|---|---|---|
| Transport failover | Same model, other provider | Role policy allows; Thought already does NIM→Groq 20B |
| Semantic model substitution | Different model | Role-specific owner authorization among **approved** candidates |
| Unqualified substitution | Highest | **Never.** No emergency unqualified availability exception. |

Per-role default:

| Role | Transport failover | Model substitution |
|---|---|---|
| thought | Same-model only (preserve NIM→Groq 20B in MF-M1) | Owner-approved equivalent only; never automatic shopping; not OpenCode initially |
| expression | Prefer none | Existing Groq Qwen is a current `existing_compatibility` exception; do not widen in MF-M1 |
| exchange / curiosity / maintenance on `utility_bulk` | Later, among approved pool | Later, among owner-approved utility models (elastic) |
| engineering + specialist requirement | Role-specific later pools | Never unqualified |
| engineering review seat | Prefer independent family | Never the implementer model |

JSON parse failure is a **semantic validation** error, not a reason to
change models inside Fabric.

## 19. Request and result contracts (`PROPOSAL`)

Request (no operational authority inside):

```text
logicalRole
specialistRequirement?     (record-only for current engineering in MF-M1; no seat-based selection)
deadline
maxInputTokens / maxOutputTokens
requiredContext / requiredCapabilities
structuredOutputSchema
priority
background | interactive
preferredRoute
fallbackPolicy
privacy class
reasoningPolicy            (normalized; route policy, not capability card)
```

Result:

```text
logicalRole, requestedPurpose, configuredRouteIdentity, dispatchedRouteIdentity
modelIdentity, providerIdentity, deliveryBackend
specialistSeat? / independence_group
startedAt, endedAt, latencyMs
finishReason
usage (or unknown)
raw structured payload (untrusted)
error classification + provider detail
fallbackClass (transport_failover | model_substitution | none) + ordered history
admissionBasis (existing_compatibility | qualificationResultId)
invocation identity / attempt identity / fallback-chain identity / attention request id
requestedReasoningPolicy / effectiveReasoning / inferencePolicyFingerprint
```

Receipt levels are distinct:

1. `ModelAttemptReceipt` records one resolved provider attempt and whether zero
   or one provider request was sent.
2. `ModelInvocationReceipt` records one Fabric invocation and its ordered
   attempt receipts. Current Thought NIM → Groq failover is two attempts in
   one invocation.
3. `ModelFallbackChain` correlates caller-owned invocations. Current
   Expression Mistral → Qwen fallback is two Fabric invocations in one chain.

No aggregate may erase an attempt or reconstruct unresolved provider facts.

Attention may observe the receipt. Model-produced content is not
authoritative because Fabric delivered it.

## 20. Error taxonomy (`PROPOSAL`, compared to source)

Current adapter/`AppError` codes include `rate_limited`,
`provider_unavailable`, `agent_not_ready`, `request_exceeds_tpm_budget`,
`operator_disabled`, `route_disabled`. Attention outcomes include
`completed`, `cancelled`, `timeout`, `rate_limited`, `error`, `aborted`.

Unify without erasing provider detail:

| Class | Typical owner |
|---|---|
| `rate_limited` / `quota_exhausted` | transport/provider |
| `provider_unavailable` / `authentication` / `model_not_found` | provider |
| `deadline` / `aborted` | caller / Attention |
| `network` | transport |
| `invalid_response` / `schema_error` / `context_overflow` | model or semantic validation |
| `configuration` | operator |

Fabric normalizes the class and retains the provider status/body class.

## 21. Durable work (`PROPOSAL`)

Not every model request is a durable job.

| Mode | Deadline source | Fabric owns job? |
|---|---|---|
| Interactive Thought/Expression | Discord/Attention deadline | No |
| Background cognition | Attention lane + job timeout | No |
| Durable bounded work | Work concern deadline passed in | No; Fabric only consumes deadline |

Fabric must accept a deadline and cancellation signal. Operational
Continuity keeps lease, resume, and artifact lifecycle.

## 22. OpenCode — two tracks

### Track A — inference backend (**MF-M4** transport closed: Zen HTTP chat-completions)

```text
Ashley cognitive owner
  -> Model Fabric
    -> qualified DeliveryBackend adapter (Zen HTTP, isolated OpenCode server, or other)
      -> owner-approved occupant for that role/seat
        -> text/JSON
```

Zero Ashley operational authority. Intended environment:

```text
TOOLS DENIED, FILESYSTEM DENIED, SHELL DENIED, WEB DENIED,
SUBAGENTS DENIED, MCP DENIED, SKILLS DENIED, PROJECT CONTEXT DENIED
```

### Track B — engineering worker (not Model Fabric)

```text
Agency -> Authority -> Durable Work -> Engineering Work Request
  -> controlled OpenCode Worker -> candidate workspace
    -> verification/evidence -> Ashley evaluates
```

Historical OC-M0/OC-M1 belong here. See
`research/Ashley_OpenCode_Worker_Future.md`.

## 23. OpenCode official capability research

Fetched 2026-08-25 from `https://opencode.ai/docs/` and GitHub
`anomalyco/opencode` default prompt. Classes below.

### 23.1 What OpenCode can do (`CONFIRMED FROM OFFICIAL PUBLIC DOCUMENTATION`)

- Non-interactive: `opencode run` / `opencode run --format json`
- Headless HTTP: `opencode serve` (default `127.0.0.1:4096`)
- SDK: `@opencode-ai/sdk`, `session.create`, `session.prompt`, abort
- Model list: `opencode models`, `GET /config/providers`, Zen
  `https://opencode.ai/zen/v1/models`
- Structured output: session `format: json_schema` (uses a StructuredOutput
  **tool** in official SDK docs)
- Sessions: create, continue, fork, delete, summarize, abort
- Permissions: `allow` / `ask` / `deny` per tool, including `*`
- Custom agents with custom prompts
- Env: `OPENCODE_DISABLE_AUTOCOMPACT`, `OPENCODE_PERMISSION`,
  `OPENCODE_DISABLE_DEFAULT_PLUGINS`, `OPENCODE_DISABLE_CLAUDE_CODE*`

Ashley OC-M0/M1 off-tree packets (`CONFIRMED FROM PACKET`, not in-tree runtime):
OpenCode **v1.18.18** linux-x64; host Unix-socket gateway; empirical
`permission: { "*": "deny" }` strips tools (that pin **ignored** the `tools`
JSON block); openai adapter required `POST /v1/responses` in addition to
chat completions. There is **no** OpenCode source, npm dependency, or
Bubblewrap profile under `apps/`. Groq TPM/`max_tokens`/tool-interceptor
hacks from OC-M1 PASS are **Track B / provider patches**, not Track A.

### 23.2 Contamination (`CONFIRMED FROM OFFICIAL PUBLIC DOCUMENTATION` + upstream source)

Default system prompt (`packages/opencode/src/session/prompt/default.txt`)
identifies the model as **OpenCode, an interactive CLI coding agent**,
injects tool-use policy, coding conventions, GitHub issue URLs, and
"before answering about OpenCode, WebFetch the docs."

`SystemPrompt.environment` injects cwd, worktree, git yes/no, platform, and
date even when tools are denied.

Hidden agents exist: compaction, title, summary.

Skills/MCP text is omitted when those permissions are disabled; environment
and coding-agent ontology are **not** shown to be fully removable by
permission flags alone.

**Verdict:** OpenCode-the-agent is **not** a clean
Ashley-system → model → raw result pipe for core Thought or Expression.

A custom agent prompt can replace the coding-agent persona (`PROPOSAL` /
`INFERENCE` from agents docs) but environment injection and compaction
remain residual risks unless proven otherwise with a golden-session test.

### 23.3 Cleaner inference sub-option: Zen HTTP (`CONFIRMED FROM OFFICIAL PUBLIC DOCUMENTATION`)

OpenCode Zen is an OpenAI-compatible gateway (`/zen/v1/chat/completions` and
provider-specific endpoints). Docs say it can be used with **any agent**,
not only the OpenCode TUI.

That is **not** "local inference." It is hosted US inference. Free models
are limited-time, several **use prompts to improve models**, and NVIDIA free
endpoints forbid personal/confidential data.

Distinguish:

| Mechanism | Contamination | Data plane |
|---|---|---|
| OpenCode agent (`run`/`serve`) | High (coding ontology + env) | Local client + remote model |
| Zen HTTP as just another adapter | Low (Ashley owns messages) | Remote Zen + upstream |
| Direct NIM/Groq/Mistral | Lowest | Current production |

### 23.4 Suitability by workload

| Workload | OpenCode agent | Zen HTTP adapter |
|---|---|---|
| Core Thought | Unsuitable | Not initially; dedicated direct routes |
| Expression | Unsuitable | Not initially |
| Utility / summarization / extraction | Possible if tools denied + empty cwd + custom prompt | **Better** |
| Research | Possible; web tools must stay denied unless explicitly a research worker | Better for pure synthesis |
| Code analysis | Natural for agent; still not authority | Weaker without files |
| Engineering worker | Track B | N/A as the worker itself |

### 23.5 Adapter options (first Track A transport `OWNER CLOSED`; remaining options `PROPOSAL`)

| Option | Latency | Isolation | Complexity | First MF inference? |
|---|---|---|---|---|
| A. Spawn-per-request `opencode run` | High startup | Good if empty cwd | Medium | No |
| B. Persistent `opencode serve` | Lower | Session hygiene required | Medium-high | Only if golden tests pass |
| C. ACP | Editor protocol | Wrong shape | High | No for inference |
| D. Reuse OC-M0/M1 harness | Worker-shaped | Strong isolation | High | **No** for Track A |
| E. Zen HTTP as provider adapter | Similar to Groq adapter | Ashley-owned prompts | Lowest | Preferred Track A candidate; transport is not identity |
| F. Another qualified hosted/direct API | Adapter-shaped | Ashley-owned prompts | Lowest | Allowed if it meets privacy + qualification |

Owner Q17 closed **option E** as the first Track A transport. Options A–D
and F remain later research, not competing first-implementation choices.

**Recommended first OpenCode-related implementation (after MF-M1, MF-M2, and
MF-M3 qualification records):** a **utility-only** Track A adapter using
**OpenCode Zen HTTP chat-completions** (`POST https://opencode.ai/zen/v1/chat/completions`).
Isolated `opencode serve` remains future research, not the first transport.
Do not wrap the coding agent for Thought or Expression. Do not put OpenCode in MF-M1.
The adapter MAY ship dark. Live utility cutover still requires
`QualificationResult` + `OwnerApprovalRef` + `ActivationRef`.

If a session-shaped path is used later, fail closed:

- isolated empty directory, no git, no `AGENTS.md`
- `permission: { "*": "deny" }`
- disable compact, plugins, MCP, skills, subagents
- new session per call
- process containment (Bubblewrap) still required because config is not a
  security boundary (`INFERENCE` from Ashley OC-M0 ADR + OpenCode defaults
  being permissive)

### 23.6 Terms and privacy (`OWNER CLOSED` for architecture blocker)

Owner 2026-08-25: service-use / unattended-agent terms are **resolved /
non-blocking** for this architecture. Do not treat legal ToS review as a
gate that blocks Model Fabric design or MF-M1.

Hosted Services terms (`https://opencode.ai/legal/terms-of-service`,
fetched 2026-08-25) still exist as **privacy/data-classification** input:

- OSS CLI vs hosted Services / Zen;
- unpaid Content may be used to improve Services;
- several free Zen models log or train on prompts;
- NVIDIA free endpoints: trial; no personal/confidential data.

Terms resolution does **not** mean every model is suitable for every private
Ashley prompt. Core Thought and Expression must not ride promotional free
endpoints. Route-level privacy ceilings remain.

## 24. Security / privacy (`PROPOSAL`)

For every route record: which service receives the prompt, which
provider/model, what metadata, whether the client adds telemetry, whether
retention is known.

Do not conflate local OpenCode client with local inference.

Free NVIDIA Zen endpoints: trial use only — no personal or confidential
data (`CONFIRMED FROM OFFICIAL PUBLIC DOCUMENTATION`).

Core Thought and Expression prompts contain owner conversation, identity,
and mind state. They must not ride promotional free endpoints.

## 25. Configuration ownership (`PROPOSAL`)

| Layer | Lives in | Contains |
|---|---|---|
| Architectural registry | source + this document | Role names, laws, error classes |
| Operator routing preferences | non-secret config (evolve `config/models.json`) | Role → approved routes |
| Secrets | `~/.composer-assistant/.env` only | API keys |
| Runtime health/capacity | `nuclear.db` / process | Health, cooldowns, unknown quotas |

No model API secrets in committed config.

Boot dependency tiers:

| If missing | Boot |
|---|---|
| OpenCode / Zen | Continue; elastic backend optional |
| Utility OpenCode routes | Continue; core Ashley up |
| Thought route with no valid provider | Fail closed for Thought (current `routeReady` / `agent_not_ready` pattern) |
| Expression Mistral key | Current: `agent_not_ready` before Attention reservation |

## 26. Observability and admin (`PROPOSAL`)

Retrospective questions Fabric must answer: logical role, route, model,
backend, provider, tokens, fallback class, latency, outcome, qualification
identity.

Do not persist hidden chain-of-thought.

Proposed read-only surfaces (not implemented): owner-scoped analogs of
`GET /nuclear/routing` such as `/nuclear/models` and `/nuclear/model-routes`
showing logical role, configured route, active model, provider, backend,
health, qualification, last success/failure, cooldown, capacity class.
Observation, not authority.

Current surface: `GET /nuclear/routing?owner_id=` (`CONFIRMED FROM SOURCE`).

## 27. Mechanism boundary

AI SDK remains a bounded mechanism spike only. It may not own routes,
fallback, budgets, agents, tools, or authority.

OpenCode SDK/CLI is the same class of mechanism: a delivery adapter
candidate, not a cognition owner.

## 28. Privacy and secret policy

Every attempt binds a privacy classification and disclosure ceiling. Prompts,
outputs, credentials, private paths, raw memory, and chain of thought are
denied to telemetry by default.

A lower-trust profile receives only the projection authorized for that exact
request. Compatibility shims must not copy a higher-trust prompt into a
lower-trust provider (including free Zen models).

## 29. Resource and budget policy

Each attempt and specialist session has ceilings for tokens, time, cost,
retries, and output size.

The deferred F1-obs Thought-observation slice remains `single_attempt`
with `fallbackRouteIds = []` if that slice is ever built.

**MF-M1** must **preserve** current Thought transport failover and
Expression model-substitution behavior. It must not "fix" them by removing
fallback under a Fabric flag. It must not repair `thought_observation`
dispatch.

Budget exhaustion fails closed. It does not select an unqualified provider
or widen privacy.

## 30. Evidence, evaluation, rollback

Unchanged: receipts prove mechanical facts only. Evaluation Plane owns
qualification meaning. Profiles can be disabled independently. Changing a
model ID updates versioned policy, not architecture, when purpose, privacy,
reliability, output contract, and authority remain unchanged.

## 31. MF-M1 implementation contract (`OWNER CLOSED` **scope**; local candidate)

Owner scope for this witness is closed. The implementation is checkpointed as
a local candidate at `d918572c7ae01d5b367323692bd6e8fbcf257895`, started from
exact `5a05e96e4d5d6afbd6d44e9ca518f141fa8292c6`. It is not accepted and not
production. Do not read this heading as “MF-M1 CLOSED” in the Wave Acceptance
sense.

**F1-obs (historical, deferred):** one default-off Thought-observation
shadow attempt, Lightning, no fallback, active Thought unchanged. Not the
first code milestone.

**MF-M1 witness (first implementation milestone):**

1. All current production inference callers still go through `completeChat`
   / Attention (eval scripts remain out of process).
2. A Fabric seam records requested purpose, logical role, configured route,
   **dispatched** route, backend, provider, model identity, usage, error
   class, fallback class/history, latency, outcome, and admission basis.
3. Every resolved provider attempt has one stage-valid `ModelAttemptReceipt`.
   No attempt can send more than one provider request. Every
   Fabric invocation has one `ModelInvocationReceipt` containing its ordered
   attempts. Caller-level fallback uses an explicit `ModelFallbackChain`.
4. Current routes use `existing_compatibility`; MF-M1 does not fabricate
   qualification. Any new binding requires an Evaluation-owned
   `QualificationResult` plus owner approval.
5. **Zero intended** routing, provider, model, **or reasoning** behavior
   change. Characterization tests must assert **live** §11 facts, not §12.9
   targets.
6. Thought NIM `openai/gpt-oss-20b` + `reasoningEffort: "low"` → Groq
   same-model 20B failover eligibility is unchanged.
7. Expression Mistral primary → Groq `qwen/qwen3.6-27b` fallback eligibility
   is unchanged (including current fallback `reasoningEffort: "none"`). The
   owner-selected Qwen-primary reversal is **not** MF-M1.
8. `thought_observation` remains configured as `utility_bulk` and still
   **forces** `route: "thought"`; Groq-key early return remains. Receipts
   must show configured ≠ dispatched. Do not repair it.
9. Shared `groq:openai/gpt-oss-20b` between utility and Thought failover
   remains. Do not split the bucket in MF-M1.
10. The exact caller map in §12.2 is covered, including
    `logicalRole = engineering` plus a recorded `SpecialistRequirement` that
    does not select a specialist model in MF-M1.
11. MF-M1 adds no provider package and does not wait on the deferred F1-obs
    NVIDIA/transport dependency packet.
12. No OpenCode. No catalog auto-route. No Lightning cutover. No specialist
   seats as new purposes. No Mint routing change. No engineering specialist
   models.

Out of MF-M1: catalog UI, qualification runner, OpenCode adapter,
observation-route repair, OCI mistral-id-on-NIM repair, engineering adapter
quota decoupling.

## 32. Acceptance gate

Model Fabric (phase) may be accepted only when:

- this file remains the sole semantic owner;
- frozen field contracts still match or are explicitly owner-superseded;
- the accepted milestone meets its own witness (MF-M1 ≠ F1-obs);
- Evaluation binds profile identity without owning routing;
- Observability remains a port;
- `RELEASE_QUALIFIED`, deployment, and promotion remain separate;
- OpenCode worker authority is not smuggled into Fabric;
- a model can appear without becoming routable;
- a model can disappear without an architecture rewrite.

## 33. Interfaces to later phases

Unchanged: Context Budget, Operational Continuity, Procedural Skill
Graduation, Computer Use, Learned Autonomy, Cognitive/Relational Graduation
consume results only through existing semantic owners.

OpenCode Worker consumes Fabric for models and Sandbox/Authority for
effects. It does not become Fabric. Track B is not MF-M1, MF-M2, or MF-M3.

## 34. Implementation roadmap (`OWNER CLOSED` order)

Critical principle: **MF-M1 preserves existing production behavior.** Do
not redesign providers and add OpenCode in one cut.

**Qualification records before production OpenCode routing.** The 2026-08-25
research numbering put an optional elastic backend (old MF-M3) before
catalog (old MF-M4). That contradicts
`discovered → qualified → owner-approved → routable`. Numbers below correct
the dependency while preserving IDs' provenance in notes.

| ID | Name | Behavior change? | OpenCode? |
|---|---|---|---|
| MF-M0 | Architecture / research / current-state freeze | Docs only | No |
| MF-M1 | Seam around **existing** routes; typed identity; receipts | **Zero intended** | **No** |
| SLICE 0 | MF-M1 R1/R2 receipt-truth repairs | Receipt metadata only | No |
| MF-M2 | Unified CURRENT policy snapshot; replace split route authority | No intended user-visible routing change | No |
| MF-M3 | Catalog + qualification **minimum**: occupancy records, packs, lifecycle states, independence_group. Discovery may create `unqualified`. **No production OpenCode route.** | Records only | No production activation |
| MF-M4 | First Track A backend: Zen HTTP chat-completions, utility-only, fail-closed if absent, dark until owner activation | Adapter only unless owner activates | Track A utility only |
| MF-M5 | Dynamic availability among already-approved occupants | Health among approved; still not Thought/Expression cutover | Capacity among approved |
| MF-M6 | Generic specialist-seat resolution; first vertical candidate `routine_validation` / Lightning, dark | Mechanics only | After packs + owner activation |
| MF-ACT | Activation mechanism: `OwnerApprovalRef`, `ActivationRef`, atomic pointer, per-role rollback | None until owner creates records | N/A |
| F1-obs | Historical Thought-observation Lightning shadow | Separate optional witness | Not MF-M1 |

MF-M0 is **COMPLETE as documentation** with this reconciliation.

OC-M0 and OC-M1 have bounded off-tree physical evidence: OC-M0 passed the
ephemeral OpenCode transport/isolation spike, and OC-M1 passed one synthetic
bugfix with a temporary standalone Groq upstream. This is Track B foundation
evidence only. There is no OpenCode package under `apps/`, no Ashley repository
integration, no Model Fabric qualification, no production route, and no worker
activation. Further Track B work remains on the worker roadmap, not
MF-M1–MF-M4.

## 35. Deferred work

Closed in Pass-2 contracts (do not reopen as architecture holes):

- schema / Git vs local control-plane placement;
- Track A first transport = Zen HTTP chat-completions;
- independence_group as training-lineage data;
- no periodic Fabric daemon;
- unqualified substitution never live;
- MF-ACT as the activation mechanism, not M5/M6 core cutover.

Still deferred / out of this program:

- exact Evaluation numeric thresholds and corpora (Evaluation-owned);
- live Ashley SC-CON-04 position for **future family cutovers** (blocks
  those activations, not machinery);
- **actual** activation of §12.9 occupants (owner `ActivationRef` only);
- Inspect AI / OpenInference / Phoenix trials;
- production exporter configuration;
- OpenCode worker (Track B);
- isolated `opencode serve` as Track A transport;
- moving Thought or Expression onto OpenCode;
- F1-obs Lightning observation slice.

## 36. Document map

| Layer | Owner document | Status |
|---|---|---|
| Semantic architecture | This file | `CURRENT PHASE CONTRACT` (sole owner) |
| MF-M2–MF-ACT execution contracts | [`Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md`](Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md) | `IMPLEMENTATION_READY` machinery; not production activation |
| Frozen fields / F1-obs spec | [`Model_Fabric_01_Contract_Draft.md`](Model_Fabric_01_Contract_Draft.md) | `SUPPORTING`; delivery order superseded |
| Current routes | [`docs/Routing_Status.md`](../Routing_Status.md) | `SUPPORTING / LIVING SOURCE STATUS` — live facts; **not** the §12.9 target table |
| Post-MF-M1 target occupants | This file §12.9 | `OWNER CLOSED` as target policy only |
| Constitution `## Model` | [`../Ashley_Constitution.md`](../Ashley_Constitution.md) | Amended 2026-08-25 to multi-provider Fabric governance |
| SC-CON-04 consultation | `../governance/SC-CON-04_2026-08-25_Constitution_Model.md` | Constitution-text consultation; not family-cutover consultation |
| F1-obs mechanism spike | [`Model_Fabric_01_Implementation_Spike.md`](Model_Fabric_01_Implementation_Spike.md) | `SUPPORTING / DEFERRED` |
| Historical reconnaissance | [`Model_Fabric_01_Codebase_Reconnaissance.md`](Model_Fabric_01_Codebase_Reconnaissance.md) | `HISTORICAL SOURCE SNAPSHOT` |
| Ephemeral catalog | `research/Model_Fabric_OpenCode_Research_Snapshot_2026-08-25.md` (pre-publication history; not in current tree) | `EPHEMERAL RESEARCH` |
| Worker future | `research/Ashley_OpenCode_Worker_Future.md` (pre-publication history; not in current tree) | `FUTURE / NON-NORMATIVE FOR MF` |
| Owner decisions (2026-08-25) | `../handoffs/MODEL_FABRIC_OWNER_DECISION_PACKET.md` (pre-publication history; not in current tree) | Prior closed packet |
| Pass-1 questions | `../handoffs/MODEL_FABRIC_MF_M2_MF_M6_OWNER_DECISION_PACKET.md` (pre-publication history; not in current tree) | `OWNER CLOSED` by Pass-2 answers |
| Roadmap handoff | `../handoffs/MODEL_FABRIC_ROADMAP_HANDOFF.md` (pre-publication history; not in current tree) | Supporting status |
| MF-M1 implementation checkpoint | `../handoffs/MODEL_FABRIC_MF_M1_IMPLEMENTATION_CHECKPOINT.md` (pre-publication history; not in current tree) | Candidate, verification, and acceptance boundary |
| Evaluation meaning | [`Ashley_Evaluation_Qualification_Plane.md`](Ashley_Evaluation_Qualification_Plane.md) | Sibling plane |

### Policy layers (not live routing)

**Live routes:** Routing Status + source at `sourceBaselineSha`. MF-M1 wraps those.

**Future occupants:** this file §12.4 (OpenCode seats) and §12.9 (direct-provider
targets). Neither is production routing.

**Historical 2026-08-13 F1-obs targets:** Groq 120B Thought primary;
Lightning observation `single_attempt`; 20B retired from *future* utility.
Provenance only.

**Owner 2026-08-25 scouting occupants:** Spark, Hy3, MiMo-V2.5, Ultra,
Lightning for specialist/utility seats after qualification. Not Thought or
Expression. Not production.

Current Expression Groq Qwen fallback is present-source Expression policy.
It is not F1-obs fallback policy and must be preserved in MF-M1.
