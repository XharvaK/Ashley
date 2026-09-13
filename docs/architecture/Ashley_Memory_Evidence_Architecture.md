# Ashley Memory Evidence Architecture

**Status:** `ACCEPTED ARCHITECTURE` for the memory evidence model described
below. Implementation status varies by area and is marked throughout
(Section 16 is the phase map). Acceptance of the model does not authorize
promotion or live influence. Resolve C1 delivery from Canonical Architecture
Roadmap §3 and exact-candidate evidence.

**Canonicalized:** 2026-08-27

**Metacognition (accepted 2026-08-25):** Memory / Evidence policy for
owner-model correction, influence eligibility, and the C1 witness. Accepted
in this document's domain. It does not amend the Architecture Freeze owner
map.

**Scope:** Ashley's persistent memory architecture: how evidence, derived
interpretation, retrieval mechanics, and recollection relate; the invariants
that govern them. This is an Ashley architecture document. It results partly
from the MemPalace research salvage
(`docs/architecture/research/MemPalace_Salvage_Map.md`)
but does not make MemPalace terminology central.

**Authority:** Beneath governance and the Canonical Architecture Roadmap.
It does not reorder the roadmap, create a new phase, or authorize code.

**Classification vocabulary used in this document:**

| Term | Meaning |
|---|---|
| `ACCEPTED ARCHITECTURE` | Frozen direction for the stated role. Implementation details may remain open. |
| `CURRENT IMPLEMENTATION` | Present in current source (does not prove deployment or qualification). |
| `FUTURE DESIGN` | Accepted direction, not yet implemented. |
| `SPIKE / NON-DECISION` | Unselected; experiment required. |
| `REJECTED` | Explicitly not accepted. |
| `ACCEPTED MEMORY/EVIDENCE POLICY` | Accepted in this document's domain. Not a Freeze-map amendment. |

---

## 1. Purpose

Ashley is intended to be a persistent social and cognitive entity, not a
disposable function call. Persistent memory must therefore be trustworthy
across months and years: it must preserve what actually happened, distinguish
recorded events from interpretations of them, survive infrastructure failure,
and remain correct when beliefs change.

This document defines the Ashley memory evidence architecture:

- what is canonical and what is derived;
- why source evidence is not world truth;
- how provenance, temporal state, and epistemic status attach to derived
  memory;
- how retrieval mechanics relate to memory authority;
- what happens on contradiction, revision, forgetting, and redaction;
- where each future implementation area lands on the frozen roadmap.

Canonical writing (architecture, Identity, known limits) is not Memory /
Evidence. It may later be projected by Context Budget. It is not lived
evidence, assertion, or belief.

The core architecture is:

```text
                ASHLEY MEMORY AUTHORITY
                         |
                         v
              Canonical Source Evidence
        conversations / experiences / events
        observations / decisions / execution records
                         |
                +--------+---------+
                v                  v
        Memory Assertions     Derived Retrieval
        theories/facts        FTS / vectors
        preferences           adjacency
        temporal state        ranking caches
                |                  |
                | provenance       | candidates
                +--------+---------+
                         v
                    Ashley Recall
                         |
                         v
                       Thought
```

With the accompanying invariants:

```text
delete the vector index
  -> recall quality may degrade
  -> Ashley does not lose her history

delete a graph projection
  -> structured recall may degrade
  -> source evidence remains

change a working theory
  -> evidence remains available
  -> Ashley can remember why the old theory existed

forget canonical evidence
  -> dependent derivations are invalidated or recomputed
```

---

## 2. Governing Principles

The accepted memory invariants. These are frozen.

| Invariant | Status |
|---|---|
| `MEMORY EVIDENCE != MEMORY INTERPRETATION != RETRIEVAL INDEX` | `ACCEPT` |
| `SOURCE EVIDENCE != WORLD TRUTH` | `ACCEPT` |
| `RETRIEVAL HIT != BELIEF` | `ACCEPT` |
| `EXTRACTED FACT != TRUTH` | `ACCEPT` |
| `DERIVED ASSERTION MUST RETAIN PROVENANCE` | `ACCEPT` |
| `DERIVED ASSERTION != DISPOSABLE PROJECTION` | `ACCEPT` |
| `RETRIEVAL FAILURE != MEMORY LOSS` | `ACCEPT` |
| `INDEX AVAILABILITY != MEMORY AUTHORITY` | `ACCEPT` |
| `DERIVED INDEXES MUST BE REBUILDABLE` | `ACCEPT` |
| `INDEX STALENESS MUST BE OBSERVABLE` | `ACCEPT` |
| `MEMORY CONTENT != AUTHORITY` | `ACCEPT` |
| `WORKER OBSERVATION != ASHLEY MEMORY` | `ACCEPT` |
| `BACKGROUND EXTRACTION MAY PROPOSE; IT MAY NOT SILENTLY AUTHOR BELIEF` | `ACCEPT` |
| `FORGETTING SOURCE EVIDENCE MUST INVALIDATE OR RECOMPUTE DEPENDENT DERIVATIONS` | `ACCEPT` |
| `CANONICAL EVIDENCE IS LOSSLESS UNTIL GOVERNED DELETION / REDACTION` | `ACCEPT` (replaces "immutable forever") |
| `DERIVED OBJECTS RETAIN DERIVATION IDENTITY` | `ACCEPT` |

The table above is frozen. The following invariants are accepted Memory /
Evidence policy. They do not amend the Architecture Freeze owner map.

| Accepted policy invariant | Status |
|---|---|
| `OWNER IDENTITY != ASHLEY IDENTITY != OWNER MODEL != INHERITED SEED` | `ACCEPTED MEMORY/EVIDENCE POLICY` |
| `EVIDENTIAL STRENGTH != INFLUENCE CLASS` | `ACCEPTED MEMORY/EVIDENCE POLICY` |
| `OWNER CORRECTION MUST BE REPRESENTABLE WITHOUT DELETING HISTORY` | `ACCEPTED MEMORY/EVIDENCE POLICY` |
| `SIMILARITY != INHERITANCE PROVENANCE` | `ACCEPTED MEMORY/EVIDENCE POLICY` |
| Correction ends current validity and every current or downstream influence derived from the corrected scope, including I1 adaptation, unless a narrower valid replacement is explicitly adjudicated. History and source evidence remain. | `ACCEPTED MEMORY/EVIDENCE POLICY` |

Role relationships, not a single greater-than chain: for provenance questions,
source evidence dominates. For current world-state truth, recent direct
verified observations may dominate old conversational evidence. Operational
Truth remains its own current-turn authority (Section 15). Evidence and
assertion answer different questions; there is no universal
`evidence > assertion > index > model` ordering.

Derived in epistemic origin does not mean disposable. An adjudicated Memory
Assertion is durable Ashley-owned cognitive state: revisable and
provenance-bearing, but not merely an index or cache, and not required to be
deterministically regenerable from raw evidence. Retrieval Projections are
mechanical: disposable and rebuildable. `DERIVED ASSERTION != DISPOSABLE
PROJECTION`.

---

## 3. State Ontology

### 3.1 Canonical Source Evidence

`ACCEPTED ARCHITECTURE` (partially `CURRENT IMPLEMENTATION` in `nuclear.db`).

Canonical Source Evidence = **durable lossless event evidence**.

Lossless recorded events:

- conversations and messages;
- execution observations and decision records;
- user statements;
- relevant system events.

Episode summaries are consolidation products, not canonical source evidence
about the events they summarize; they are classified under Memory Assertions
(Section 3.2).

The governing clarification is mandatory:

> `CANONICAL SOURCE EVIDENCE IS AUTHORITATIVE ABOUT THE RECORDED EVENT, NOT
> AUTOMATICALLY ABOUT THE WORLD DESCRIBED BY THAT EVENT.`

Examples:

- A transcript containing "I hate coffee" is authoritative evidence that the
  statement was made at time T. It is not automatic proof that the speaker
  universally hates coffee forever.
- An old Ashley hallucination ("The repository version is 1.0.0") preserved
  verbatim is evidence that Ashley said that. It is not evidence the
  repository was 1.0.0.

Canonical evidence is lossless until governed deletion or redaction. "Lossless
until governed" replaces any "immutable forever" framing: Ashley has real
forgetting and privacy semantics.

`CURRENT IMPLEMENTATION` notes: `nuclear.db` stores source messages; automatic
facts require an exact literal quote from a stored user message; `/forget`
redacts source material under governance.

### 3.2 Memory Assertions

`ACCEPTED ARCHITECTURE`; partially `CURRENT IMPLEMENTATION` (episode summaries,
facts/pins); the full model is `FUTURE DESIGN`.

Memory Assertions = **durable but revisable Ashley-owned interpretations**.

Derived interpretations:

- preferences;
- beliefs about the user;
- project-state assertions;
- relationship knowledge;
- working theories;
- historical facts;
- learned patterns.

Memory Assertions are derived in epistemic origin, but an adjudicated assertion
is durable Ashley-owned cognitive state. It is revisable and
provenance-bearing, but it is not merely an index or cache, and it does not
have to be deterministically regenerable from raw evidence.

**Episode summaries.** Current Ashley implementation consolidates completed
exchanges into episodes linked to exact source message IDs; episodes never
replace their source messages. Episode summaries are therefore durable derived
memory / consolidation objects with provenance to source messages. An episode
record may be evidence that the consolidation event itself occurred, but its
summary does not gain source-evidence authority over the underlying
conversation.

Assertions must remain provenance-bearing (Section 4), temporally bounded
(Section 5), epistemically labeled (Section 6), and revisable (Section 11).
An assertion is not Ashley's truth merely because it exists. An assertion that
loses all supporting evidence is marked unsupported.

Owner-model hypotheses, Ashley Identity,
inherited seeds, and shared-culture projections are different objects.
Beliefs about the owner are temporally bounded owner-model assertions. They
are not owner Identity, not Ashley Identity, and not an inherited seed.
Owner correction of an owner-model assertion must not rewrite an inherited
Ashley seed. `SIMILARITY != INHERITANCE PROVENANCE`: an existing Ashley
interest must not be retroactively labeled inherited merely because Alex
shares it. Inheritance requires an explicit seed record, historical source,
or owner designation with honest timing. A live episode summary that
essentializes the owner is a current Mika leak (`CURRENT IMPLEMENTATION`
risk; `FUTURE DESIGN` to bind or expire).

### 3.3 Retrieval Projections

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN` (partial `CURRENT IMPLEMENTATION`:
FTS5 over episode summaries).

Retrieval Projections = **disposable / rebuildable mechanics**.

Derived mechanisms:

- lexical index;
- vector index;
- graph projection;
- adjacency map;
- ranking cache.

Projections have no independent memory authority. They are disposable and
rebuildable from their authoritative upstream state (canonical source evidence
and/or durable accepted Memory Assertions, according to what that projection
indexes), and their freshness must be observable (Section 8). A projection
answers "where might relevant evidence be", never "what is true".

### 3.4 Runtime Recall Context

`ACCEPTED ARCHITECTURE`; `CURRENT IMPLEMENTATION` in part.

Runtime Recall Context = **transient attention**.

The temporary selection of material presented to Thought for a particular
cognitive operation. Runtime recollection does not become persistent truth
automatically. Context is bounded attention over persistent state:

```text
CONTEXT EVICTION != FORGETTING
NOT PRESENT IN THE CURRENT PROMPT != NOT KNOWN
CONTEXT COMPRESSION != MEMORY MUTATION
```

---

## 4. Provenance Model

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN`. Logical contracts are given here; no
finalized database schema is invented by this document. Schema is a `SPIKE`
item.

**EvidenceRef** - a reference into canonical source evidence. It must identify,
at minimum:

- the source kind (conversation, execution record, system event, or other
  canonical source event);
- a stable source entity reference (for example `message_entity_uuid`);
- the recorded time of the event;
- the content scope referenced.

Canonical EvidenceRefs point to canonical source events. References to derived
objects (episode summaries, assertions, projections) are a distinct reference
kind and must remain distinguishable from source-evidence refs. The distinction
is a logical contract (for example a ref-kind or role field), not a finalized
database schema.

**Derivation identity** - every derived object can answer "what produced me?":

```text
embedding:
    model
    dimensionality
    normalization
    created_at
    source generation

memory assertion:
    derivation mechanism / model
    derivation version
    source evidence refs
    generated_at

retrieval projection:
    schema version
    projector version
    canonical source watermark
```

This distinguishes "memory is current", "index is stale", "graph was produced
by an old extractor", and "embedding set needs rebuilding" without mistaking
infrastructure freshness for cognitive truth. Derivation identity is
`Tier S`.

**Assertion-to-evidence relationships** - an assertion may be:

- supported by multiple sources;
- contradicted by other sources (recorded, not hidden);
- neutral with respect to a source.

Precedent in `CURRENT IMPLEMENTATION`: automatic facts require exact-quote
provenance; write-time `shadow` / `live` provenance labels distinguish
proposals from influence-bearing material. The provenance model generalizes
that discipline to all derived objects.

**Boundary:** background extraction may propose an assertion with evidence
refs. It may not silently author an authoritative belief (Section 10).

---

## 5. Temporal Semantics

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN`. Derived from the MemPalace temporal
graph evidence and adapted to Ashley semantics.

Required distinctions:

| Concept | Meaning |
|---|---|
| `observed_at` | When the underlying event was recorded. |
| `asserted_at` | When the assertion was created or revised. |
| `valid_from` / `valid_to` | The half-open validity interval of the assertion as a description of the world. |
| `superseded` | A newer assertion ended this one's validity. |
| `invalidated` | Validity ended without a direct replacement (for example, evidence withdrawn or contradicted). |
| as-of query | Historical reconstruction: which assertions were valid at time T. |

Design rules:

- Supersession ends validity; it does not delete history. The old assertion
  remains inspectable with its `valid_to`.
- Validity intervals are half-open: `valid_from <= t < valid_to`.
- A preference change over time is modeled by ending the old assertion's
  validity and starting a new one, both provenance-bearing.
- `Temporal Memory Assertions` are more foundational than a graph
  representation:

  - a graph is one projection over assertions, rebuildable from them;
  - assertions can carry content richer than triples (values, preferences,
    working theories, scalar facts);
  - provenance and derivation identity attach at the assertion level, not at
    an edge level;
  - the graph can be deleted without losing the assertions.

The graph itself remains a `DEFERRED` projection.

---

## 6. Epistemic Semantics

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN`. Minimum status set; do not
over-design a large epistemic ontology:

| Status | Meaning |
|---|---|
| `observed` | Applies when the assertion describes the evidenced event itself, or when the asserted proposition was established by an appropriate direct authoritative observation. |
| `derived` | Produced by a derivation mechanism from evidence. |
| `uncertain` | Derived but with low confidence or conflicting support. |
| `superseded` | Replaced by a newer assertion. |
| `contradicted` | Directly contradicted by newer or stronger evidence. |

Example: from a source message "I hate coffee",

- `OBSERVED`: the person said "I hate coffee" (the assertion describes the
  evidenced event itself);
- `DERIVED`: the person dislikes coffee (an interpretation beyond the event).

`OBSERVED` status never upgrades an utterance into eternal world-state truth:
`SOURCE EVIDENCE != WORLD TRUTH` still holds.

Confidence is assertion metadata, not authority. Epistemic status is part of
the assertion record so that Ashley can remember having believed something
(Section 11). Status labels never elevate an assertion into an authorizing
object (Section 14).

Evidential strength is not influence class.
Influence eligibility (`I0`–`I4`) is recorded separately from confidence. I0
has no direct behavioral influence; Thought may evaluate I0 evidence when
forming a new I1/I2 candidate. There is no unconfirmed I3: an interpretation
approaching I3 remains I2 until confirmation or an explicit, current owner
statement. Repeated behavior, calibration history, or model confidence cannot
by themselves authorize `I3`. `I4` (diagnosis, consent, owner Identity,
relationship obligation, external-action authority, self-modification
authority) is forbidden. See
[Ashley Metacognition Architecture](Ashley_Metacognition_Architecture.md).

---

### 6.1 C1 Qualification, Shadow Evidence, and Currentness Boundary

`ACCEPTED MEMORY/EVIDENCE POLICY`; current candidate, deployment, and lifecycle
status are resolved from the Canonical Architecture Roadmap and exact-candidate
evidence.

C1 qualification uses a dedicated owner-bound qualification epoch. Generic
capability events are not C1 qualification authority. The epoch binds the
owner, build identity, capability contract, predecessor epoch, deterministic
evaluation definition, live-shadow evidence, blockers, and release seal.

Recall is a hard predecessor. C1 campaign evidence counts only after Recall is
active and the owner's Recall live cutoff exists. Recall qualification and C1
qualification are separate campaigns.

During C1 collection, `mem_facts` remains the live currentness authority. A
qualifying shadow witness evaluates this read-only counterfactual:

> What would assertions-based C1 policy have done to the exact governed memory
> material presented to this real Expression attempt?

The witness is bound to:

- a persisted positive Decision;
- final provider-bound Context and selected-motivation identifiers;
- an admitted reactive or proactive Expression attempt; and
- the point immediately before `expressSpeak(...)`.

It is not produced from debug composition, cancelled or terminal paths,
provider/model output, arbitrary administrative insertion, or a caller-chosen
witness identity. The live-shadow source key is
`c1-shadow:v1:decision:<persisted-decision-id>`. The witness is a bounded,
text-free, provider-independent receipt.

Shadow evaluation MUST NOT alter the Decision, selected motivations, Context,
provider-bound content, memory rows, user-visible behavior, or provider call
count. It does not change `currentness_authority`.

The C1 policy preserves these epistemic boundaries:

- Owner self-description outranks an Ashley-derived owner-model interpretation
  for current influence.
- Recorded event evidence may contradict either participant's recollection of
  what was recorded, but proves the recorded event only, not current world
  truth.
- Ashley's cognitive history may contradict the owner's recollection of
  Ashley's historical belief, but proves the historical belief only, not its
  truth.
- Model confidence is metadata. It never substitutes for evidence, provenance,
  an authority interval, or influence eligibility.
- Disagreement affecting influence is proof-carrying or explicitly uncertain.
- Corrections preserve source and history, terminate affected current
  influence, and do not revive superseded or corrected claims.

The dedicated readiness threshold is a rollout contract, not proof that a
campaign has run. It requires a current owner-bound epoch; exact build and
capability-contract matches; `memory_evidence` in `observe`; `mem_facts` as
currentness authority; Recall active with the owner cutoff; all six
deterministic evaluation seeds passing; at least 25 qualifying real
live-shadow Decisions spanning at least seven days; at least one reactive and
one proactive witness; zero blocking witness or integrity events; and
dependency readiness at promotion time. Synthetic traffic cannot be used only
to satisfy these thresholds.

Promotion and currentness cutover are different authority operations.
Promotion changes the C1 capability release from `observe` to `active` and
atomically seals the exact qualified epoch to that release. Promotion does not
change currentness. Changing `currentness_authority` from `mem_facts` to
`memory_assertions` changes real memory-reader semantics even when global
cognition is `observe`.

Guarded cutover requires global `observe`, a paused AgentManager, a trusted
host-state proof that the owner Expression plane is quiesced, Recall active
with its cutoff, an active exact release, an exact sealed epoch, exact build
and contract identity, `mem_facts` still current, and passing C1 writer and
consistency checks. It runs only through the existing atomic cutover
primitive.

Cutover is sticky. Generic capability rollback suppresses capability release
influence but does not restore `memory_assertions` to `mem_facts`, and no
reverse cutover exists. Semantic safety filtering, barriers, terminations, and
corrections remain active independently of capability release state. If the
post-cutover source is unsafe, pause or observe it and repair forward under a
new exact source candidate; do not restore legacy currentness.

---

## 7. Retrieval Architecture

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN` (main work is Context Budget).
Conceptual pipeline:

```text
canonical evidence
  -> lexical / vector candidate retrieval
    -> hybrid ranking
      -> contextual adjacency
        -> Ashley recall policy
          -> Thought
```

Rules:

- `RETRIEVAL HIT != BELIEF`. Candidates are data for Thought to weigh against
  evidence, not findings.
- Hybrid lexical + semantic retrieval is accepted as an architecture. The
  fusion algorithm, vector engine, embedding model, and index configuration
  are explicitly not locked (Section 17).
- Contextual adjacency uses Ashley-native source structure:
  `message_entity_uuid`, conversation/thread identity, turn ordering, and
  episode membership. It does not reuse an external file-line expansion
  algorithm.
- Retrieval is budgeted; graduated recall selects how much and how deep to
  present, weighted by importance and recency.
- A retrieval failure degrades recall quality; it does not lose memory.

---

## 8. Derived State and Recovery

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN` (infrastructure laws owned by
Operational Continuity).

- Indexes are disposable. Deleting any projection never deletes canonical
  evidence or durable accepted assertions.
- Index generation and freshness are observable: every projection carries
  schema version, projector version, and a canonical source watermark
  (Section 4).
- Retrieval may degrade without memory loss; degraded mode is explicit, not
  silent.
- Retrieval projections must rebuild from their authoritative upstream state:
  canonical source evidence and/or durable accepted Memory Assertions,
  according to what that projection indexes. A projection must not depend on
  another opaque projection as its only authoritative source.
- Failed or stale projections must not silently present themselves as current.
  A stale index is detectable and reported.
- Projector checkpoints and rebuild semantics belong to Operational Continuity
  infrastructure, not to the retrieval feature phase.
- Maintenance is a single-writer concern: bounded writer ownership as
  concurrency grows, so projection and canonical writes cannot race.

---

## 9. Background Memory Processing

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN` for most of it (canonical capture is
`CURRENT IMPLEMENTATION`).

```text
canonical capture
  -> background candidate / projection work
    -> Ashley-owned adjudication
```

- Canonical capture happens at the point of the event.
- Candidate extraction, indexing, and projection work run in the background,
  never in conversational Expression.
- Background work is bounded and queued; it may propose but not silently
  author belief.
- Failures in background work do not corrupt or lose canonical evidence; work
  can be retried or rebuilt later.
- Writer ownership: maintenance work is queued through a single writer so
  canonical and projection writes remain ordered.

---

## 10. Memory Consolidation and Learning

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN` (primary owner: Experience /
Cognitive Graduation).

Candidate lifecycle:

```text
source evidence
  -> candidate memory assertion
    -> Ashley-owned cognitive adjudication
      -> accepted | rejected | uncertain | superseded
        -> optional human review where authority / risk requires it
```

- Ashley owns normal memory cognition. The owner is not Ashley's database
  administrator for every memory she forms.
- Human review is conditional, not universally mandatory. It applies to
  sensitive identity changes, consequential claims about the owner,
  governance changes, and uncertain high-impact assertions.
- Extraction may propose candidates with evidence refs. It may not write
  authoritative belief by itself.
- Rejected candidates are not deleted history; their source evidence remains.
  Superseded assertions remain inspectable (Section 11).

---

## 11. Contradiction and Revision

`ACCEPTED ARCHITECTURE`; `FUTURE DESIGN` (primary owner: Experience /
Cognitive Graduation).

- New evidence may contradict or supersede old assertions.
- Old interpretations remain historically inspectable: Ashley can remember
  having previously believed something, and why the old theory existed.
- Preference changes over time are modeled temporally (Section 5): old
  validity ends, new validity begins, both provenance-bearing.
- Contradiction is recorded as an epistemic status, not silently resolved by
  overwrite.
- Revisions are themselves derived objects: they carry derivation identity,
  evidence refs, and timestamps.
- Owner correction of an owner-model interpretation uses one of four classes
  (`FUTURE DESIGN` mechanism; accepted Memory / Evidence policy):
  `TEMPORAL_SUPERSESSION`, `INTERPRETATION_INVALIDATION`, `SOURCE_DISPUTE`,
  `SCOPE_REFINEMENT`. Correction ends current validity and every current or
  downstream influence derived from the corrected scope, including I1
  adaptation, unless a narrower valid replacement is explicitly adjudicated.
  History and source evidence remain inspectable. Correction class and
  calibration consequence remain distinct. If classification is ambiguous,
  stop that current and downstream influence first.
- Future retrieval MUST see the correction and MUST NOT silently revive the
  corrected interpretation as current.
- Independently verifiable external facts are not rewritten by owner
  self-description. Owner self-description outranks a model-derived trait
  label about the owner.

---

## 12. Forgetting and Redaction

`ACCEPTED ARCHITECTURE`; `CURRENT IMPLEMENTATION` in part (`/forget` performs
governed forgetting with dependent reconciliation).

- `CANONICAL EVIDENCE IS LOSSLESS UNTIL GOVERNED DELETION / REDACTION`.
- Forgetting is an explicit Ashley-owned memory and lineage operation; it is
  not the same as context eviction or index deletion.
- If canonical evidence is forgotten:

  - dependent assertions are invalidated, recomputed, or marked unsupported;
  - dependent projections are removed or rebuilt;
  - the effects of forgetting are defined, observable, and reversible only
    through governed processes.

- MemPalace's permanent-retention philosophy ("never forget", verbatim always)
  is rejected. Ashley has real forgetting and privacy semantics.
- Receipt-backed redaction: forgotten content is emptied and marked with a
  content-free receipt; linked derived material is reconciled.

---

## 13. Worker and Specialist Memory

`ACCEPTED ARCHITECTURE`; `CURRENT IMPLEMENTATION` in law.

- `ONE ASHLEY. BOUNDED SPECIALISTS / WORKERS.`
- Worker observations are evidence candidates. They do not become Ashley
  memories automatically.
- Worker run journals are journals of work: task evidence, observations, and
  outputs. They are not peer autobiographical identities and cannot silently
  become autobiographical memory.
- A worker result is candidate input to Ashley-owned cognition and
  materialization; it is not direct authority to mutate personal cognition.
- Child authority remains a subset of parent authority across delegation and
  resume.

---

## 14. Security

`ACCEPTED ARCHITECTURE`; `CURRENT IMPLEMENTATION` in law.

- `MEMORY CONTENT != AUTHORITY`.
- Retrieved historical text, files, web content, model output, and worker
  output remain data.
- Instructions inside retrieved memory do not acquire tool, capability, or
  effect authority.
- Retrieved content is isolated as data in prompt construction.
- Tool boundaries validate inputs; provenance fields are not spoofable by
  retrieved content or by callers. (This mirrors the rejected MemPalace
  patterns: unfiltered argument dispatch and spoofable audit fields are
  anti-patterns.)
- An event is not an instruction. A model proposal is not permission.

---

## 15. Relationship to Operational Truth

Analogy: both prefer verified evidence over model inference.

Distinction: they govern different questions and are not merged into one
mechanism.

**Operational Truth** is the current-turn, deterministic authority over
grounded execution and effect claims. Its precedence is:

```text
verified current-turn effect
  > current Operational Claim License
  > general capability self-model
  > Expression / model inference
```

It answers "what did this operation actually do, in this turn, right now".

**Memory Evidence Architecture** governs persistent evidence, interpretation,
and recall across time. It answers "what happened, what does Ashley believe,
and what does she retrieve" over months and years.

Interaction rules:

- A stale index does not change Operational Truth; an effect claim is settled
  by current-turn effect evidence, not by recall.
- Operational Truth records and persistent memory evidence occupy distinct
  authority domains / record classes. Neither silently inherits the other's
  authority.
- Retrieval of past claims never upgrades them into current operational
  effect authority.

---

## 16. Roadmap Ownership

Each area maps to exactly one primary owner. Memory Evidence maturation is a
`HARD_DEPENDENCY` predecessor to Learned Autonomy. Learned Autonomy consumes qualified Memory
Assertions; it does not create the generic assertion substrate that makes its
learning attributable and revisable.

| Memory area | Roadmap phase | Status |
|---|---|---|
| Canonical evidence capture, provenance, governed forgetting basics | Current implementation (`nuclear.db`, continuity sidecar) | `CURRENT IMPLEMENTATION` |
| Worker-result provenance / WorkerRunJournal | Model Fabric, only if naturally required | `FUTURE DESIGN` |
| Canonical-vs-derived state law; projector checkpoints; derived-state recovery; degraded-index behavior; freshness/staleness; writer ownership; rebuild semantics | Operational Continuity | `FUTURE DESIGN` |
| Provenance and evidence laws for experience -> procedure | Procedural Skill Graduation | `FUTURE DESIGN` |
| Temporal Memory Assertions; evidence references; epistemic status; contradiction; supersession; consolidation and adjudication; confidence; revision; dependent forgetting. Owner-model temporal validity; correction classes; influence eligibility; first metacognitive owner-correction witness; dedicated C1 qualification epochs; real pre-influence shadow witnesses; promotion/cutover separation; sticky currentness. Shared-interest and shared-culture recompute are later-consumer compatibility, not C1 closure. | Memory Evidence maturation | `ACCEPTED ARCHITECTURE` for the C1 policy and qualification boundary; broader Temporal Memory Assertions maturation remains `FUTURE DESIGN` |
| Provenance-bearing learned interest, preference, opinion, salience, concern, and goal assertions | Learned Autonomy, consuming Memory Evidence maturation | `FUTURE DESIGN` |
| FTS5; vector mechanism spike; hybrid retrieval; RRF or fusion benchmark; contextual adjacency; graduated recall; retrieval budgeting | Context Budget, consuming Memory Evidence contracts and Model Fabric ContextProjection | `SPIKE` / `FUTURE DESIGN` |
| Working beliefs and theories; cognitive model of the human; evidence-bound lived-experience continuity; constitutionally permitted identity development | Cognitive Graduation, consuming Memory Evidence maturation, Learned Autonomy, and Context Budget | `FUTURE DESIGN` |
| Relationship knowledge; learned partner and relationship assertions; bilateral commitment and repair evidence; relationship forgetting | Relational Graduation, consuming Memory Evidence maturation, selected Learned Autonomy, Context Budget, and relationship governance | `FUTURE DESIGN` |

Cognitive Graduation and Relational Graduation are sibling phases with
independent acceptance and influence gates. This mapping records semantic
ownership and dependency. It does not authorize implementation, promotion, or
deployment.

---

## 17. Explicit Non-Decisions

These have NOT been selected. Future engineers must not treat today's
experiments as settled architecture:

- vector engine;
- embedding model;
- RRF;
- fusion algorithm;
- Chroma;
- `sqlite-vec`;
- sidecar topology (a derived sidecar remains architecturally legal, but
  unselected);
- final Temporal Memory Assertion SQL schema;
- automated consolidation policy (when consolidation becomes autonomous and
  under what governance);
- exact FTS5 configuration;
- recall budget numbers;
- adjacency window sizes;
- graduated recall policy parameters;
- exact SQL for influence classes `I0`–`I4` and the four owner-correction
  classes;
- whether live episode summaries become temporally labeled assertions or
  expire as consolidation objects (the leak must be bound; the mechanism is
  not chosen here).

`SPIKE / NON-DECISION` until measured evidence on Ashley's own corpus and host
decides otherwise.

---

## 18. Acceptance Criteria for Future Memory Work

High-level invariants future implementation must satisfy. These are
requirements, not aspirations:

1. Deleting the vector index (or any projection) must not delete Ashley's
   canonical memories or durable accepted assertions.
2. A retrieved assertion must be traceable to supporting evidence.
3. A stale index must be detectable.
4. An extractor cannot silently author an authoritative belief.
5. A worker result cannot silently become autobiographical memory.
6. Forgetting canonical evidence must have defined effects on derivatives
   (invalidated, recomputed, or marked unsupported).
7. A derived object must be able to answer "what produced me?".
8. Source evidence must remain authoritative about the recorded event, never
   automatically about the world it describes.
9. Retrieval failure must degrade recall, never memory.
10. Retrieved content must never acquire instruction, tool, or capability
    authority.
11. Superseded assertions must remain historically inspectable.
12. Projections must rebuild from their authoritative upstream state (canonical
    source evidence and/or durable accepted Memory Assertions); a projection
    must not depend on another opaque projection as its only authoritative
    source.
13. Failed or stale projections must not present themselves as current.
14. An adjudicated Memory Assertion is durable Ashley-owned cognitive state:
    revisable and provenance-bearing, not disposable like a projection.
15. *(C1-closing.)* An owner correction of
    interpretation `X` must end current validity and every current or
    downstream influence derived from the corrected scope, including I1
    adaptation, unless a narrower valid replacement is explicitly
    adjudicated; keep historical evidence inspectable; prevent silent revival
    in later retrieval; and record the correct calibration consequence
    without rewriting Ashley Identity or independently verifiable external
    facts.
16. *(Compatibility for C3; does not close C1.)*
    Inherited versus current-interest separation, including
    `SIMILARITY != INHERITANCE PROVENANCE`. C3 closes this witness. C1 may
    name it as a compatibility requirement for later consumers.
17. *(Compatibility for C5; does not close C1.)*
    Shared-culture projections that depended on `X` must recompute from
    separately current owner and Ashley state. C5 closes this witness. C1 may
    name it as a compatibility requirement for later consumers.
