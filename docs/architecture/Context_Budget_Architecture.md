# Context Budget Architecture

**Status:** `CURRENT PHASE CONTRACT`

Implementation, deployment, and promotion are living facts, not this contract.
Resolve them from Canonical Architecture Roadmap §3 and exact-candidate
evidence. This document does not authorize activation, promotion, or live
influence.

**Scope:** Accepted architecture contract for the named C2 phase.

**Authority chain:** VISION.md -> Core Principles -> Constitution -> Stewardship
Compact and Ethics -> Ashley Hierarchy -> this phase contract.

**Governing law:** Ashley owns meaning. Substrates provide mechanisms.

## Contract boundary

Current source already has a Context Composer, a bounded recent-message window,
Thought-selected evidence, and retrieval mechanisms. Model Fabric defines a
planned immutable ContextProjection transport contract. These are source and
accepted predecessor facts. They are not a qualified Context Budget.

The accepted target below governs attention allocation. It does not create a
new memory or semantic authority.

## 1. Purpose

Context Budget gives Ashley a bounded, observable policy for deciding which
eligible evidence and state enter a model-facing context. It preserves
continuity under finite tokens without confusing selection, compression, or
eviction with memory, belief, forgetting, or authority.

## 2. Vision and principle basis

The Vision requires attention and continuity grounded in actual memory and
shared history. Context Budget serves that goal by making limited attention
explicit.

The phase preserves:

- Memory Evidence as the owner of durable evidence and assertions;
- Identity and Mind State as joint inputs to Thought;
- Thought as the owner of relevance and effort-allocation decisions;
- Model Fabric as model access and transport, not cognition;
- Context Composer as composition mechanism, not semantic owner;
- provenance, privacy, least privilege, and auditable continuity.

Canonical documents (Identity, principles, architecture, known limits) may
later be projected into a turn as bounded, inspectable context. That is
Context Budget work, not a Knowledge layer. Documentation is not memory and
not belief. External “docs for agents” products (for example Mintlify-style
Markdown/`llms.txt` projection) inspire this projection pattern only.

## 3. New capability

The phase adds:

- typed context requests;
- per-section and total budgets;
- eligibility filtering before ranking;
- priority and diversity policy;
- temporal, lexical, vector, graph, and adjacency retrieval where qualified;
- progressive search, inspect, and fetch;
- lossy compression with source bindings;
- an immutable ContextProjection and allocation receipt;
- explicit omission, truncation, and degradation records.

## 4. Explicit non-capabilities

Context Budget does not:

- store canonical memory;
- author beliefs, preferences, identity, goals, relationship meaning, or
  permission;
- make a retrieval hit true or influential;
- make a summary authoritative;
- forget evidence when context is evicted;
- alter evidence because a token limit was reached;
- give Model Fabric access to databases or retrieval callbacks;
- grant models, workers, or specialists semantic or effect authority;
- depend on Learned Autonomy or Computer Use;
- treat local persistence of a hypothesis as
  permission to include it in a remote projection;
- own semantic salience or metacognitive
  trigger policy (Attention admits resources; Thought owns relevance among
  eligible inputs).

## 5. Predecessor and dependency contracts

Classified dependencies. See
[Cross-Phase Architecture](Ashley_Cross_Phase_Architecture.md#31-dependency-classes).

`HARD_DEPENDENCY`:

1. Memory Evidence contracts MUST define canonical evidence, Memory Assertions,
   retrieval projections, provenance, eligibility, invalidation, and
   forgetting.
2. Thought and the current Context Composer MUST retain relevance and
   composition ownership.

`CROSS_CUTTING_INTERFACE`:

- Model Fabric MUST provide the minimal immutable ContextProjection transport
  and exact content binding needed to carry caller-built context. Context
  Budget does not require Model Fabric profiles, specialists, or the first
  production slice.

Learned Autonomy is not a predecessor.

Operational Continuity is not needed to define or locally qualify one
request-to-projection decision. It is an `EVIDENCE_DEPENDENCY` for durable
summary jobs, asynchronous re-indexing, crash recovery, and long-running
context maintenance.

## 6. Current owner to final owner

| Concern | Current owner | Final owner |
|---|---|---|
| Canonical evidence and assertions | Memory Evidence | Memory Evidence |
| Eligibility and influence gates | Capability and evidence policy | Capability and evidence policy |
| Relevance and effort allocation | Thought | Thought |
| Composition mechanics | Context Composer | Context Composer |
| Budget policy and receipts | Fixed limits and local logic | Context Budget policy |
| Immutable model-facing transport | Current provider request path | Model Fabric ContextProjection |
| Model execution | Provider path | Model Fabric |

Context Budget coordinates these owners. It does not absorb them.

## 7. State introduced and owner

The phase may introduce:

- ContextRequest, owned by the caller and Thought policy;
- ContextBudgetPlan, owned by Context Budget policy;
- ContextCandidateRef, a reference to eligible source or state;
- ContextSelectionDecision, owned by Thought policy;
- ContextProjection, an immutable caller-built artifact transported by Model
  Fabric;
- ContextAllocationReceipt, an operational record of included, omitted,
  compressed, and truncated material;
- projection caches and search indexes, owned by retrieval infrastructure and
  always rebuildable.

No introduced record is canonical memory.

## 8. Authority added and authority not added

The phase adds authority to allocate a caller-approved finite context among
already eligible inputs. It may omit or compress eligible material for this
model call.

It does not add authority to change source state, promote shadow evidence,
override privacy, widen a capability, infer consent, authorize effects, or
declare selected material true. Selection changes attention, not meaning.

## 9. Request, intent, proposal, and state ontology

The ontology is:

1. ContextRequest - task, audience, capability lineage, privacy scope, model
   class, and maximum budget.
2. Eligible candidate set - references admitted by source policy.
3. Budget plan - deterministic reservations and limits by context section.
4. Selection proposal - ranked candidate references with reasons.
5. Thought decision - accepted selection and required causal or counterevidence
   pairs.
6. ContextProjection - immutable content sent to Model Fabric.
7. Allocation receipt - exact inclusion, omission, compression, and binding
   facts.

A selection proposal is not a cognitive assertion or action authorization.

## 10. Mechanism boundary

Retrieval engines, embeddings, graph traversal, lexical search, rerankers, and
summarizers provide candidate mechanisms. Context Composer renders the selected
structure. Model Fabric transports the completed immutable projection.

Thought owns task relevance, evidence sufficiency, and tradeoffs among eligible
inputs. Deterministic policy owns hard budgets, privacy, capability,
provenance, and required-section constraints.

No provider receives database access or a callback that can expand context
after dispatch.

## 11. Privacy and secret policy

Eligibility filtering MUST occur before ranking, summarization, and model
dispatch. A lower-trust model or specialist receives only the minimum
projection authorized for that exact request.

`LOCAL PERSISTENCE != LOCAL INFERENCE`.
Durable psychological or owner-pattern hypotheses are local by default.
Sending them, or the evidence behind them, to a remote model is data egress
even when the output will be stored locally. Ineligible, `I4`, or
privacy-blocked material MUST NOT enter remote projections. `I2` or `I3`
material requires explicit, scope-bound egress approval and an approved
remote route. A candidate lacking `I3` approval remains `I2`. Every
permitted projection remains minimized to its approved purpose.

Receipts SHOULD retain stable references and hashes rather than duplicate
private content. Logs MUST NOT contain secrets or unrestricted prompt bodies.
Forgotten, redacted, or ineligible material MUST be excluded from new
projections and invalidate affected caches.

## 12. Resource and budget policy

Every projection MUST declare:

- a hard total token or byte ceiling;
- reserved budgets for Identity, Mind State, current interaction, evidence,
  counterevidence, instructions, and output headroom as applicable;
- candidate, retrieval, graph-expansion, and summarization limits;
- model, latency, and cost ceilings;
- truncation and degradation policy.

Hard constitutional and safety context cannot be displaced by relevance
ranking. Budget exhaustion causes explicit omission, deterministic fallback,
or refusal. It never causes hidden authority widening.

## 13. Evidence contract

Every selected evidence item MUST preserve:

- canonical source or assertion identity;
- provenance and capability lineage;
- temporal and epistemic metadata needed by the task;
- eligibility disposition;
- selection reason;
- exact content binding between the receipt and ContextProjection.

A lossy summary MUST identify its source range, creation policy, model or
mechanism attribution, time, and limitations. It is a projection, not source
truth.

## 14. Operational truth and cognitive truth

Operational truth records what the budgeter selected, compressed, omitted, and
sent. Cognitive truth remains in Memory Evidence, Identity, Mind State, and
Ashley's governed cognition.

The projection receipt can prove exposure to content. It cannot prove the model
used it, Ashley accepted it, or an external outcome occurred.

## 15. Failure and ambiguity

The phase fails closed on:

- missing source bindings;
- privacy or capability uncertainty;
- stale or invalidated indexes;
- content-binding mismatch;
- budget arithmetic failure;
- required-section overflow;
- summary provenance loss;
- provider limits below the safe minimum.

Retrieval or index failure degrades recall. It does not delete memory. If safe
minimum context cannot be constructed, the request is refused or deferred.

## 16. Retry and reconciliation

A retry MUST create a new attempt receipt and bind the exact projection used.
It may reuse immutable eligible artifacts only when their source, freshness,
privacy, and capability bindings remain valid.

Reconciliation records whether a prior dispatch occurred and whether a result
was received. Ambiguous provider completion remains OUTCOME_UNKNOWN. It MUST
NOT be treated as a cognitive outcome.

## 17. Persistence and restart

Canonical memory does not live in Context Budget.

Durable receipts, summary provenance, index checkpoints, and incomplete build
state may persist. Projection caches may be discarded and rebuilt. After
restart, incomplete projections are not dispatched, stale indexes are marked
degraded, and summaries are revalidated against source invalidation.

Operational Continuity mechanisms are required before claiming crash-safe
background rebuild or compaction.

## 18. Delegation and worker semantics

Workers or specialists may retrieve, summarize, or rank only within an exact
request scope and budget. Their output is a candidate projection component.

They cannot broaden eligibility, inspect unrestricted stores, change canonical
memory, decide belief, or authorize action. Parent and child budgets MUST be
accounted separately and MUST NOT exceed the original ceiling.

## 19. Cognition handoff

Context Budget receives typed needs from Thought and returns an immutable
ContextProjection plus an allocation receipt. Thought and later cognition
interpret the model result.

The handoff preserves omitted-evidence notices, uncertainty, provenance, and
counterevidence. A model result cannot write back through Context Budget.

## 20. Memory and materialization boundary

This is a hard invariant:

> Context Budget is not memory.

Canonical evidence and Memory Assertions survive context eviction. Retrieval
indexes, embeddings, caches, summaries, rankings, and projections are
disposable or revisable materializations. Repetition in context does not
promote a projection into belief. Compression does not mutate its sources.

Only the Memory Evidence forgetting path may govern forgetting and dependent
invalidation.

## 21. Observability

Owner-authorized diagnostics MUST expose:

- requested and effective budgets;
- selected, omitted, truncated, and compressed counts;
- budget use by section and source class;
- required-section failures;
- eligibility rejections by reason;
- retrieval and index degradation;
- summary freshness and invalidation;
- content-binding and model-profile identity;
- latency, cost, retry, and OUTCOME_UNKNOWN counts.

Diagnostics MUST distinguish source identity from projection identity and
content-bearing bindings from content-free telemetry fingerprints.

## 22. Evaluation and qualification

Qualification includes:

1. deterministic budget arithmetic, ordering, privacy, eligibility, and
   content-binding tests;
2. invariants proving eviction is not forgetting and summaries cannot become
   canonical evidence;
3. adversarial prompt-injection and retrieval-poisoning tests;
4. semantic tests for relevance, counterevidence preservation, causal-pair
   preservation, temporal fidelity, and useful degradation;
5. model-profile and token-seam tests;
6. crash and stale-index tests where persistence is claimed;
7. long-horizon evaluation of continuity, omission bias, and bounded cost;
8. independent review.

Deterministic privacy and authority failures cannot be averaged away by quality
scores. Source qualification, physical-host qualification, activation,
deployment, and production effect remain separate.

## 23. Rollback, demotion, revision, and retirement

Context Budget MUST support:

- per-policy demotion to the current fixed composition path;
- disabling a retrieval or summarization mechanism;
- invalidating projections and derived summaries by exact lineage;
- rebuilding disposable indexes;
- retaining receipts needed for audit;
- retiring a budget policy without changing canonical memory.

Rollback MUST fail closed if the prior composition path cannot meet current
privacy or capability contracts.

## 24. Smallest production witness

The smallest witness is one text-only request using:

- current Identity and Mind State inputs;
- one recent interaction;
- two eligible Memory Evidence items, including one counterevidence item;
- a hard budget that forces one explicit omission;
- one immutable ContextProjection;
- one exact allocation receipt.

The witness proves bounded construction, provenance, content binding,
deterministic omission, no memory mutation, and safe degradation without any
external effect.

## 25. Acceptance gate

The phase is accepted only when:

- Memory Evidence contracts are an accepted `HARD_DEPENDENCY`. The Model Fabric
  `ContextProjection` envelope is the required `CROSS_CUTTING_INTERFACE`. The
  full Model Fabric production slice is not a predecessor;
- all introduced state has a single owner;
- privacy, eligibility, budget, and binding invariants pass;
- context eviction and compression are proven not to mutate memory;
- semantic and long-horizon evaluations meet their independent thresholds;
- the smallest witness is bound to the exact source and candidate;
- independent review closes all material findings;
- activation and promotion remain separately authorized.

Learned Autonomy, Computer Use, and complete Operational Continuity are not
general acceptance prerequisites.

## 26. Interfaces to later phases

Context Budget supplies bounded, evidence-bound projections to Learned Autonomy,
Cognitive Graduation, Relational Graduation, Procedural Skills, and Computer
Use without inheriting their authority.

Operational Continuity may later provide durable scheduling, checkpoint, and
reconciliation mechanisms. Model Fabric continues to transport only the
caller-built immutable projection.

Cognitive Graduation and Relational Graduation consume Context Budget through
independent gates. Neither receives authority from the other's acceptance.

## 27. Deferred work

Deferred decisions include:

- exact token allocations and model-profile ceilings;
- vector engine, embedding model, fusion, and reranking choices;
- graph and temporal expansion algorithms;
- summary formats and refresh thresholds;
- exact cache and sidecar topology;
- multimodal projection formats;
- provider-specific prompt caching;
- distributed context stores;
- any mechanism that treats context as canonical memory;
- owner-invoked deep-reflection projection
  envelopes (later; explicit owner request; not first Context Budget slice).

Each requires separate measurement and authorization.
