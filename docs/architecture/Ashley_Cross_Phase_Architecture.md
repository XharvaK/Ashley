# Project Ashley Cross-Phase Architecture

**Status:** `AUTHORITATIVE`

**Date:** 2026-08-21

**Metacognition (accepted 2026-08-25):** Named cross-cutting policy profile.
Cross-Phase remains the owner of cross-phase laws. The Metacognition profile
defines shared constraints and request semantics. Cross-Phase and the
relevant domain owners own and enforce them. Naming the profile is not a
Freeze-map amendment.

**Cognitive reconstruction (accepted 2026-08-29):** Project Ashley Cognitive
Architecture v0.2.1 is `ACCEPTED ARCHITECTURE / IMPLEMENTED IN CURRENT SOURCE`. It
does not add a freeze-map owner. Thought owns semantic judgment. Agency owns
executive mechanics. Table cells below that send **meaning** “through Agency”
are **SUPERSEDED** for cognitive authorship. Effect **admission/dispatch**
may still be described as Agency/kernel mechanics. Focused contract:
[`cognitive/Ashley_Cognitive_Architecture_v0.2.1.md`](cognitive/Ashley_Cognitive_Architecture_v0.2.1.md).
Present implementation status lives in exact source; qualification,
deployment, and production claims live in bound evidence.

**Scope:** Architecture and documentation only. This document grants no
implementation, installation, activation, provider, Mint, deployment,
promotion, Git-effect, or external-effect authority.

## 1. Purpose

This document owns the laws and interfaces that cross Project Ashley roadmap
phases. Phase contracts own their domains. The canonical roadmap owns delivery
direction and current priority. Source and exact-candidate evidence own current
implementation and qualification facts.

This separation prevents a phase, framework, worker, provider, or document from
silently becoming a second owner of Ashley's meaning.

Authority order remains:

```text
VISION.md
  -> Ashley Core Principles
    -> Ashley Constitution
      -> Stewardship Compact + Ethics
        -> Hierarchy + Glossary + Design Patterns
          -> Canonical Architecture Roadmap
            -> this cross-phase contract
              -> cross-cutting planes + phase contracts
                -> implementation plans + source
                  -> exact-candidate evidence
```

When two lower documents conflict, the more specific current contract controls
only within its declared domain. A specific document cannot override higher
governance or widen its own domain.

## 2. Architectural laws

These laws apply across every phase:

```text
ASHLEY OWNS MEANING. SUBSTRATES PROVIDE MECHANISMS.
ONE ASHLEY. BOUNDED SPECIALISTS / WORKERS.
CHILD AUTHORITY MUST BE A SUBSET OF CURRENT PARENT AUTHORITY.
PERSISTED LINEAGE IS NOT LIVE CONTROL AUTHORITY.
CONNECTION / AVAILABILITY IS NOT CAPABILITY.
TOOL PRESENT IS NOT AUTHORITY TO USE IT.
TRUST NEVER EXPANDS AUTHORITY.
OWNER PREFERENCE IS NOT OWNER COMMAND.
LEARNED PREFERENCE IS NOT AUTHORITY.
DURABLE WORK STATE IS NOT DURABLE COGNITIVE STATE.
OPERATIONAL TASK IS NOT COGNITIVE CONCERN.
CONTEXT IS BOUNDED ATTENTION OVER PERSISTENT STATE.
CONTEXT EVICTION IS NOT FORGETTING.
CONTEXT COMPRESSION IS NOT MEMORY MUTATION.
CACHE IS NOT MEMORY AUTHORITY.
SUMMARY IS NOT SOURCE EVIDENCE.
SOURCE EVIDENCE IS NOT WORLD TRUTH.
RETRIEVAL HIT IS NOT BELIEF.
MEMORY EVIDENCE IS NOT MEMORY INTERPRETATION OR RETRIEVAL INDEX.
MODEL OUTPUT AND WORKER OUTPUT ARE CANDIDATE INPUTS, NOT AUTHORITY.
TELEMETRY IS NOT EVIDENCE.
PROVENANCE IS NOT TRUTH.
TRACE IS NOT RECALL.
RECEIPT IS NOT EFFECT WITNESS.
ATTEMPTED EFFECT IS NOT VERIFIED EFFECT.
UNOBSERVED SUCCESS IS NOT FAILURE.
OUTCOME_UNKNOWN MUST NOT CAUSE BLIND RETRY.
PREPARE -> REVALIDATE -> COMMIT FOR CONSEQUENTIAL EFFECTS.
HUMAN HANDOFF BREAKS EPISTEMIC CONTINUITY.
APPROVAL IS NOT EXECUTION, EFFECT, QUALIFICATION, OR PROMOTION.
PASS IS NOT AUTHORITY.
ARCHITECTURE BEFORE PROMPTING.
EMERGENCE BEFORE PRESCRIPTION.
GROWTH BEFORE RANDOMNESS.
TRUTH BEFORE COMFORT.
RUNNING / IMPORTING ASHLEY CODE != PRODUCTION DATA-PLANE AUTHORITY
OPEN != MIGRATE
CONNECT != ACTIVATE
ARBITRARY ASHLEY RUNTIME != PRODUCTION RUNTIME
ORGANIC LEARNING != RUNTIME / SOURCE MODIFICATION
RUNTIME / SOURCE MODIFICATION != FOUNDATIONAL IDENTITY / GOVERNANCE MODIFICATION
SANDBOX M5 AUTHORSHIP != AUTHORITY TO CHANGE ASHLEY
SANDBOX M7 ENGINEERING EFFECTS != AUTHORITY TO CHANGE FOUNDATIONAL IDENTITY / GOVERNANCE
EVENT != TRUTH
EVENT != PERMISSION
EVENT != MEMORY ASSERTION
EVENT != EFFECT WITNESS
EVENT != INSTRUCTION
SPINE ANNOUNCES. OWNER LEDGER DEFINES.
RECONSTRUCT != REPLAY
LOG PRESENCE IS NOT EVENT AUTHORITY
COMPUTER AVAILABLE != COMPUTER AUTHORIZED
DOCUMENTATION != MEMORY ASSERTION
OPERATIONAL INBOX != EVENT SPINE
```

### 2.1 Additional derived laws

- A durable record may preserve history. It does not preserve current
  permission across a wait, restart, provider change, capability change, owner
  withdrawal, or environment change.
- One logical input stream owns ordering for one worker activation. A framework
  queue, provider session, and Ashley inbox must not become competing FIFOs.
- A framework identifier, model identifier, session identifier, workspace
  identifier, account identifier, URL, or environment fingerprint describes a
  mechanism. It does not establish semantic identity or authority.
- A successful procedure, specialist, worker, model, or tool may reduce
  mechanical cost. It may not silently change Ashley's goals, decision
  criteria, Identity, relationship meaning, or capability ceiling.
- An exact-candidate claim binds its source revision, contracts, environment,
  evidence, and qualification scope. Evidence does not transfer to a later
  candidate by resemblance.
- System hardening is continuous acceptance work. It is not a final phase that
  can repair missing semantic ownership after implementation.
- Historical research that said “Event Fabric” is not current terminology.
  Incoming classification and durable mid-flight input belong to the
  Operational Continuity inbox. Correlation, reconstruction, and observation
  of committed owner transitions belong to a future typed Event Spine, which
  is not a bus, brain, dispatcher, or source of truth. See
  [Architecture Freeze](Ashley_Architecture_Freeze.md).
- Metacognition is a named cross-cutting policy profile under existing
  owners. It is not a freeze-map owner, cognitive faculty, persistence owner,
  or standalone phase. See
  [Ashley Metacognition Architecture](Ashley_Metacognition_Architecture.md).
  The following laws are accepted Cross-Phase laws for this profile. They do
  not amend the Freeze map. The Metacognition profile defines these shared
  constraints and request semantics. Cross-Phase and the relevant domain
  owners own and enforce them.

```text
INHERITANCE != IDENTITY AUTHORITY
OWNER IDENTITY != ASHLEY IDENTITY != OWNER MODEL != INHERITED SEED
SHARED DEVELOPMENT != SHARED IDENTITY
SIMILARITY != INHERITANCE PROVENANCE
EVIDENTIAL STRENGTH != INFLUENCE CLASS
LOCAL PERSISTENCE != LOCAL INFERENCE
ATTENTION ADMITS RESOURCES; IT DOES NOT OWN SEMANTIC SALIENCE
CORRECTION ENDS CURRENT VALIDITY AND EVERY CURRENT OR DOWNSTREAM
INFLUENCE DERIVED FROM THE CORRECTED SCOPE, INCLUDING I1 ADAPTATION,
UNLESS A NARROWER VALID REPLACEMENT IS EXPLICITLY ADJUDICATED.
HISTORY AND SOURCE EVIDENCE REMAIN.
```

### 2.2 Production data-plane authority

These laws are instances of existing availability and child-authority
principles. They are not a new law family.

```text
RUNNING / IMPORTING ASHLEY CODE
  != PRODUCTION DATA-PLANE AUTHORITY

OPEN != MIGRATE

CONNECT != ACTIVATE

ARBITRARY ASHLEY RUNTIME != PRODUCTION RUNTIME
```

Precision:

- Importing modules or constructing Ashley objects without an explicit
  production data plane must not open or migrate `~/.composer-assistant`.
- Opening or connecting an existing database is not migration authority.
  `OPEN != MIGRATE` means migration is not an implicit consequence of generic
  open/connect. An authorized production bootstrap may still pass an explicit
  `migrate: true` under a production plane.
- An isolated runtime must not address the reserved production data directory.
- Production runtime entry is distinct from an arbitrary Ashley runtime.

Implementation presence, commit identity, deployment, and production
acceptance are not recorded here. Resolve them live from Git, source,
exact-candidate evidence, or production observation. If they cannot be
established from permitted evidence: `UNKNOWN`.

## 2.3 Frozen owner map

The architecture owner map is frozen. Completeness research did not add a
kernel, faculty, boundary, or infrastructure primitive. Current-facing
category membership:

```text
COGNITIVE OWNERS
Identity, Mind State, Thought, Agency, Reflection, Relationship, Curiosity

BOUNDARY / CONTROL
Authority, Capability, Sandbox, Honesty, Evaluation, Stewardship,
External Effect, Attention (resource)

PERSISTENCE / EVIDENCE
Memory / Evidence, Continuity

INFRASTRUCTURE
Operational Continuity, Context Budget, Model Fabric, Observability,
future typed Event Spine (design later; not a phase)
```

Do not mix categories. Do not treat Recall as a peer cognitive owner (it is
the retrieval surface of Memory / Evidence). Computer Use is a later
mechanism phase under External Effect, not a cognitive owner and not
Authority. Full freeze, event split, and architecture-justified sequence:
[Architecture Freeze](Ashley_Architecture_Freeze.md).

Do not add Metacognition to this map. The existence of a metacognitive
feature is not proof of an independently owned lifecycle.

## 3. Roadmap topology

The roadmap drawing preserves owner-selected delivery order. It is not a
hard-dependency ladder. A later phase may appear under an earlier phase
because that is the current implementation sequence, not because the later
phase derives state, authority, or meaning from the earlier one.

Classify every edge before treating a later phase as blocked.

```text
CURRENT DELIVERY GATE
Sandbox V2
  -> Model Fabric

OPERATIONAL CAPABILITY SPINE
Model Fabric
  -> Operational Continuity
    -> Procedural Skill Graduation
      -> Computer Use

COGNITIVE GROWTH TRACK
Memory Evidence maturation
  -> Learned Autonomy -----------\
  -> Context Budget --------------+-> Cognitive Graduation
                                   \-> Relational Graduation

Cognitive Graduation
  + Relational Graduation
  -> integrated long-horizon hardening gate

Metacognition policy is consumed across this track. It is not a node, phase,
or freeze-map owner. The first visible
metacognitive proof is Memory Evidence maturation. Shared-interest and
shared-culture proofs belong to later consumers, not to C1 closure.

ATTENTION TRACK
Memory Evidence contracts
  + Model Fabric minimal ContextProjection
  + current Context Composer ownership
  -> Context Budget
  -> later Operational Continuity integration

CROSS-CUTTING PLANES
Security / Authority
Memory / Evidence
Evaluation / Qualification
Observability
External Effect and Authority
```

This graph does not authorize parallel implementation. Delivery currently
follows the drawing. Conceptual existence follows the classifications below.

### 3.1 Dependency classes

| Class | Meaning |
|---|---|
| `HARD_DEPENDENCY` | The consumer cannot fulfill its semantic contract without producer-owned state, authority, or contracts. Absence of the producer makes the consumer architecturally incomplete. |
| `EVIDENCE_DEPENDENCY` | The consumer's architecture can exist without the producer. Specific qualification, graduation, or acceptance claims need producer-owned evidence, receipts, or witnesses. Missing producer evidence blocks those claims, not the consumer's existence. |
| `OWNER_SELECTED_IMPLEMENTATION_ORDER` | Owner-chosen delivery sequencing. Useful for gate protection, contention, or risk. The later phase could conceptually exist without the earlier phase. The current delivery order remains in force until the owner changes it. |
| `CROSS_CUTTING_INTERFACE` | Not a serial predecessor. A shared plane or contract consumed when the consumer's work enters that domain. Consumption does not make the producer the parent of the consumer. |

An edge has one primary class. Notes record a secondary interface or evidence
need that must not be misread as a hard predecessor.

Preserved laws for this classification:

```text
MODEL FABRIC DOES NOT DERIVE AUTHORITY OR SEMANTIC OWNERSHIP FROM SANDBOX.
OPERATIONAL CONTINUITY DOES NOT OWN MODEL INTELLIGENCE.
PROCEDURAL SKILL GRADUATION DOES NOT REQUIRE GENERAL WORKFLOW DURABILITY
  UNLESS ITS SPECIFIC EVIDENCE CONTRACT DOES.
COMPUTER USE DEPENDS ON EXTERNAL EFFECT/AUTHORITY FOR CONSEQUENTIAL ACTION
  SEMANTICS, NOT THE REVERSE.
```

### 3.2 Classified dependency edges

| Producer | Consumer | Class | Why | What is not implied |
|---|---|---|---|---|
| Governance + current Ashley foundation | Sandbox Autonomy | `HARD_DEPENDENCY` | The workshop needs current capability, identity, admission, and governance. | Sandbox does not become cognition or generic external agency. |
| Sandbox Autonomy | Model Fabric | `OWNER_SELECTED_IMPLEMENTATION_ORDER` | Current delivery waits so the active Sandbox gate is not competing with Model Fabric implementation. | Model Fabric does not derive authority or semantic ownership from Sandbox. Routing, profiles, and dispatch could exist without Sandbox. |
| Sandbox Autonomy | Operational Continuity | `OWNER_SELECTED_IMPLEMENTATION_ORDER` | Delivery currently places durable-work generalization after the workshop gate. | Operational Continuity can exist without Sandbox. Workspace and receipt use is a `CROSS_CUTTING_INTERFACE`, not a parent. |
| Model Fabric | Operational Continuity | `OWNER_SELECTED_IMPLEMENTATION_ORDER` | Delivery currently sequences model-dispatch contracts before general durable work. | Operational Continuity does not own model intelligence. Pure lifecycle, crash, lease, and cancellation machines need no provider. Model-backed attempts consume Model Fabric as a `CROSS_CUTTING_INTERFACE`. |
| Operational Continuity | Procedural Skill Graduation | `EVIDENCE_DEPENDENCY` | A procedure graduates only from attributable traces matching its evidence contract. | General workflow durability is not a semantic predecessor. Domain receipts may suffice. Inert interchange parsing does not wait for Operational Continuity. |
| Procedural Skill Graduation | Computer Use | `OWNER_SELECTED_IMPLEMENTATION_ORDER` | The preferred mechanism ladder may use a qualified procedure. | Computer Use can exist through connector or semantic API without a procedure. Procedure availability is not Computer Use authority. |
| External Effect and Authority | Computer Use | `HARD_DEPENDENCY` | Consequential observation and action consume admission, credentials, prepare, revalidation, commit, witness, and reconciliation. | External Effect and Authority does not depend on Computer Use. Computer Use is one consumer. |
| Operational Continuity | Computer Use | `EVIDENCE_DEPENDENCY` | Multi-step, restart-sensitive, owner-wait, or ambiguous computer work needs durable attempt, cancellation, and reconciliation evidence. | One-shot non-persistent observation does not require Operational Continuity. |
| Model Fabric | Computer Use | `CROSS_CUTTING_INTERFACE` | Perception or specialist dispatch, when models are used. | Deterministic Computer Use does not require Model Fabric. |
| Sandbox Autonomy | Procedural Skill Graduation | `EVIDENCE_DEPENDENCY` | Local engineering procedures need a qualified execution mechanism and receipts. | General procedure architecture does not wait for Sandbox. Other qualified mechanisms may supply evidence. |
| Computer Use | Procedural Skill Graduation | `CROSS_CUTTING_INTERFACE` | Only for procedures whose mechanism is UI control. | Computer Use is not a predecessor of Procedural Skill Graduation. |
| Memory Evidence maturation | Learned Autonomy | `HARD_DEPENDENCY` | Learned influence requires attributed, revisable, temporally bounded assertions. Retrieval hits and prompt residue are insufficient. | Learned Autonomy does not own Recall or world truth. Owner-model hypotheses are not Ashley Identity. |
| Identity + Mind State + Thought + Agency + Reflection + OCI | Learned Autonomy | `CROSS_CUTTING_INTERFACE` | Learned Autonomy extends existing owners. It must not replace them. Inherited seeds remain Identity. | Those owners are not a serial roadmap phase. |
| Operational Continuity | Learned Autonomy | `EVIDENCE_DEPENDENCY` | Unattended, restart-surviving, or resumable learning witnesses need durable work evidence. | Interests, preferences, goals, and motivations can be defined without Operational Continuity. |
| Learned Autonomy | Cognitive Graduation | `HARD_DEPENDENCY` | Cognitive Graduation integrates qualified learned interests, preferences, goals, concerns, and governed development. | Learned Autonomy does not authorize Cognitive Graduation promotion. |
| Memory Evidence maturation | Cognitive Graduation | `HARD_DEPENDENCY` | Epistemic maturation needs attributed, revisable assertions and forgetting. | Retrieval indexes are not beliefs. |
| Context Budget | Cognitive Graduation | `EVIDENCE_DEPENDENCY` | Long-horizon at-scale attention witnesses need bounded, inspectable projection. | Semantic Cognitive Graduation can exist with current composition. |
| Operational Continuity | Cognitive Graduation | `EVIDENCE_DEPENDENCY` | Unattended or restart-safe cognition witnesses need durable work evidence. | Cognitive meaning does not wait for a workflow engine. |
| Memory Evidence maturation | Relational Graduation | `HARD_DEPENDENCY` | Relationship development needs attributed bilateral evidence and dependent forgetting. | Duration and engagement are not consent. |
| Current relationship-state governance | Relational Graduation | `HARD_DEPENDENCY` | Typed records, coercion checks, withdrawal, capability lineage, and delivery evidence already own relationship state. | Relational Graduation does not create a second relationship core. |
| Learned Autonomy | Relational Graduation | `CROSS_CUTTING_INTERFACE` | Learned preference, salience, and opinion must not become relational authority, consent, loyalty, or engagement optimization. | Relational Graduation can exist without Learned Autonomy. The current drawing is not a hard predecessor. |
| Context Budget | Relational Graduation | `EVIDENCE_DEPENDENCY` | Long-horizon privacy-aware shared-history evaluation needs bounded selection. | Relational semantics do not wait for Context Budget. |
| Operational Continuity | Relational Graduation | `EVIDENCE_DEPENDENCY` | Restart-safe reminders, durable scheduling, and delivery reconciliation witnesses. | Mutual commitment meaning does not wait for a workflow engine. |
| Memory Evidence maturation | Context Budget | `HARD_DEPENDENCY` | Bounded attention requires source, assertion, projection, eligibility, and forgetting contracts. | Context Budget does not own Recall or forgetting. |
| Model Fabric | Context Budget | `CROSS_CUTTING_INTERFACE` | Context Budget consumes the typed `ContextProjection` envelope. | Context Budget does not require Model Fabric profiles, specialists, or the first production slice. Model Fabric does not implement selection, compression, or eviction. |
| Operational Continuity | Context Budget | `EVIDENCE_DEPENDENCY` | Resumable multi-step projection identity, source-range provenance, and restart behavior. | Single-turn Context Budget can exist without Operational Continuity. |
| Cognitive Graduation | Relational Graduation | none | Siblings. Shared foundations do not merge owners. | Neither gate authorizes the other. |
| Cognitive Graduation + Relational Graduation | Integrated long-horizon hardening | `EVIDENCE_DEPENDENCY` | Shared campaigns test joint coherence. | Not a merged phase, shared owner, or shared promotion gate. |
| Evaluation / Qualification | Every phase | `CROSS_CUTTING_INTERFACE` | Domain-specific closure evidence. | Evaluation does not grant runtime authority. |
| Observability | Every phase | `CROSS_CUTTING_INTERFACE` | Correlation and diagnostics designed with each lifecycle. | Telemetry is not evidence, memory, or authorization. |
| Security / Authority | Every phase | `CROSS_CUTTING_INTERFACE` | Global authority matrix. Phases narrow it. | No giant trusted or tool-allowed boolean. |
| External Effect and Authority | Connectors, procedures, Computer Use, Sandbox M7, effectful Operational Continuity | `CROSS_CUTTING_INTERFACE` | Effect meaning, credentials, representation, commit, witness, and reconciliation. | Not a child of Computer Use. Not owned by Sandbox. |

### 3.3 Non-dependencies

- Learned Autonomy does not depend on Computer Use. Serializing Ashley's
  cognitive growth behind browser or connector mechanics has no architectural
  basis.
- Learned Autonomy does not require complete Operational Continuity to define
  interests, preferences, goals, concerns, or motivation. Operational work may
  later produce candidate evidence through an explicit cognitive handoff.
- Context Budget does not depend on Learned Autonomy.
- External Effect and Authority does not depend on Computer Use. Connectors,
  semantic APIs, qualified procedures, Computer Use, and engineering effects
  consume its contracts.
- Model Fabric `ContextProjection` does not implement Context Budget. It is only
  the typed, bounded transport artifact that Context Budget later selects and
  constructs.
- Model Fabric does not wait semantically on Sandbox. Current delivery order is
  owner-selected. The first **code** milestone is **MF-M1** (existing-route
  seam), not historical Thought-observation Lightning (F1-obs). MF-M1 owner
  scope is closed; the canonical post-OF runtime integration baseline is
  `e36613bf805bb0a4f5e95ec11f0b8dd5dfb5857a`. A local MF-M1 candidate is
  checkpointed at `d918572c` from exact `5a05e96e`; implementation acceptance
  and production promotion remain separate.
- Operational Continuity does not wait semantically on Model Fabric. It does
  not own model intelligence.
- Procedural Skill Graduation does not wait on general Operational Continuity
  unless a specific procedure's evidence contract requires that durability.
- Computer Use does not wait semantically on Procedural Skill Graduation.
- Relational Graduation does not wait semantically on Learned Autonomy.

## 4. Phase contract minimum

Every major phase contract must answer these questions. A section may be `N/A`
only with a reason.

1. Purpose.
2. Vision and Principle basis.
3. New capability.
4. Explicit non-capabilities.
5. Predecessor and dependency contracts.
6. Current owner to final owner.
7. State introduced and its owner.
8. Authority added and explicitly not added.
9. Request, intent, or proposal ontology.
10. Mechanism boundary.
11. Privacy and secret policy.
12. Resource and budget policy.
13. Evidence contract.
14. Operational or cognitive truth contract.
15. Failure and ambiguity semantics.
16. Retry and reconciliation semantics.
17. Persistence and restart semantics.
18. Delegation and worker semantics.
19. Cognition handoff.
20. Memory and materialization boundary.
21. Observability.
22. Evaluation and qualification.
23. Rollback, demotion, revision, or retirement.
24. Smallest production witness.
25. Acceptance gate.
26. Interfaces to later phases.
27. Deferred work.

## 5. Cross-phase state ownership matrix

`Model-writable` and `worker-writable` mean direct authoritative writes. A
model or worker may emit a bounded proposal where stated.

| State | Owner | Cognitive | Durable | Model-writable | Worker-writable | Evidence | Authority | Rebuildable | May create initiative | Restart | Forget / retention owner | Introduced or matured by |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Identity | Identity + owner review | Yes | Yes | No | No | May cite | Governs meaning, not execution permission alone | No | Through Thought/Agency only | Yes | Identity + Continuity | Existing; later bounded graduation |
| Mind State | Mind State | Yes | Yes | Proposal only | No | Interpreted state | No independent effect authority | No | Through Agency | Yes | Mind State + Continuity | Existing |
| Memory Source Evidence | Source domain + Memory Authority | Yes | Yes | No | No | Yes | No | No | No direct initiative | Yes | Memory + Continuity | Existing Memory Evidence |
| Memory Assertion | Memory Authority with semantic owner | Yes | Yes | Proposal only | Proposal only | Derived, attributed | No | No | Through eligible cognitive owners | Yes | Memory + Continuity | Memory Evidence maturation |
| Retrieval Projection | Memory projection owner | No | Yes or cached | No | No | No; points to evidence | No | Yes | No | Optional | Projection retention + Continuity tombstones | Memory Evidence / Context Budget |
| ContextProjection | Context policy + Context Composer | No | Usually transient | No | No | Carries cited inputs | No | Yes | No | Rebuilt after restart | Source retention remains with source | Model Fabric transport; Context Budget selection |
| OpenConcern / OCI | Cognition semantic owner | Yes | Yes | Proposal only | No | Source-grounded interpretation | No effect authority | No | Yes, through Agency admission | Yes | Cognition + Continuity | Existing; Learned Autonomy may mature inputs |
| Goal | Mind State / future Learned Autonomy contract | Yes | Yes | Proposal only | No | Requires provenance | No effect authority | No | Yes, through Agency | Yes | Owning cognitive domain | Learned Autonomy |
| Motivation | Agency projection | Yes | Usually transient | No | No | Uses eligible inputs | No | Yes | It is an initiative input, not admission | Recomputed | Source owners | Existing; Learned Autonomy broadens grounded inputs |
| Learned preference | Learned Autonomy under Identity/Agency boundaries | Yes | Yes | Proposal only | No | Revisable assertion | No | No | Through Agency only | Yes | Learned Autonomy + Continuity | Learned Autonomy |
| Procedure | Procedural Skill Graduation | No | Yes | Candidate proposal only | Candidate proposal only | Qualification-bearing artifact | No invocation authority | Versioned, not casually rebuilt | No | Yes | Procedure owner + artifact retention | Procedural Skill Graduation |
| SpecialistSession | Model Fabric | No | Yes when required for audit | No | No | Dispatch provenance | Attenuated mechanical grant only | No | No | Contract-specific | Model Fabric retention | Model Fabric |
| Worker task / Work Attempt | Operational Continuity | No | Yes | No | Bounded state proposal only | Operational provenance | Attenuated work authority | No | No | Yes | Operational Continuity | Operational Continuity |
| ExecutionWorkspace | Sandbox or execution provider under phase contract | No | Bounded | No | Bounded within grant | Artifact source | Workspace grant only | Disposable or reconstructable per contract | No | Contract-specific | Execution owner | Sandbox / Operational Continuity |
| Artifact | Artifact Registry + creating domain | No | Yes | No | Candidate bytes within grant | May become evidence only after admission | No | Content-addressable materialization may rebuild | No | Yes | Artifact owner + Continuity | Sandbox / Operational Continuity |
| Operational Work Concern | Operational Continuity | No | Yes | No | No | Correlates attempts | No cognitive or effect authority | No | No | Yes | Operational Continuity | Operational Continuity |
| EffectCommitRecord | External Effect owner or bounded engineering-effect owner | No | Yes | No | No | Commit-boundary record | Records exercised authority; does not grant it | No | No | Yes | Effect domain | External Effect / Sandbox M7 |
| Credential reference | Credential Authority | No | Yes | No | No | Metadata only | No action authority | No | No | Yes | Credential Authority | External Effect and Authority |
| Authenticated session state | Session Broker / provider adapter | No | Bounded | No | No | Mechanism metadata | No action authority | No | No | Contract-specific | Session Broker | External Effect mechanisms |
| ApprovalProjection | Approval owner | No | Yes | No | No | Approval evidence | Scoped approval only | No | No | Yes | Approval owner | External Effect / governance domains |
| Effect Witness | Witness owner independent of executor where required | No | Yes | No | No | Yes | No new authority | No | No | Yes | Effect domain | Evaluation / effect domains |
| Telemetry | Emitting semantic owner; Observability governs transport | No | Bounded | No | Bounded emission only | No | No | Often disposable | No | Optional | Observability retention | Observability Plane |
| QualificationResult | Evaluation / Qualification Plane | No | Yes | No | No | Yes, scope-bound | No promotion authority | No | No | Yes | Qualification owner | Evaluation / Qualification |

## 6. Cross-phase authority matrix

No `autonomyAllowed`, `agentAllowed`, `toolAllowed`, or `trusted` boolean may
stand for these distinct authorities.

| Authority | Semantic owner | Required admission | What it does not imply |
|---|---|---|---|
| Cognitive proposal | Origin semantic owner | Schema, provenance, current contract | Materialization, belief, memory, initiative, effect |
| Memory materialization | Memory Authority + source owner | Source validity, provenance, capability, continuity | World truth, Identity change, initiative |
| Initiative admission | Agency / Thought | Current motivations, refusal, relationship and capability gates | Delivery or external effect |
| Project read | Sandbox V2 project-inspection authority | Current project grant, path policy, budget | Mutation, verification, Git, external action |
| Candidate mutation | Sandbox V2 experimentation/authoring authority | Candidate workspace, scope, resource limits | Live-source mutation, verification, Git, promotion |
| Verification | Verification profile owner | Exact candidate, command/profile, evidence contract | Acceptance, release qualification, deployment |
| Procedure invocation | Capability Authority + current caller | Qualified procedure, dependencies, current scope | Procedure availability alone is insufficient |
| Worker delegation | Operational Continuity parent | Current parent authority, attenuated child grant, budget | Peer identity, authority amplification, cognitive write |
| Network access | Network capability owner | Destination, method, data-classification, budget | Credential use, representation, commitment |
| Credential use | Credential Authority | Account scope, session grant, current effect intent | Action or representation authority |
| Browser observation | Computer Use + External Effect admission | Session, target, read scope, privacy | Mutation, communication, purchase, commitment |
| Browser mutation | Computer Use mechanism + External Effect authority | Prepared effect, current revalidation, action scope | Representation, purchase, irreversible commitment |
| External representation | Agency + External Effect policy + owner scope where required | Represented party, bounded subject/action scope | General communication or account access is insufficient |
| Communication | Agency + destination capability | Content, recipient, channel, privacy, effect intent | Agreement, owner representation, human receipt |
| Purchase or commitment | External Effect policy + explicit owner authority | Terms, amount/obligation, target, revalidation, witness plan | Browser access, credential access, prior similar approval |
| Git effects | Sandbox M7 engineering-effect profile | Exact repository, operation, branch, current qualification and owner scope | Deploy, publish, external representation |
| Deployment | Deployment authority profile | Exact artifact, environment, rollback, owner authorization | Capability promotion or production acceptance |
| Account lifecycle | Credential/Account Authority + owner | Exact account action and explicit high-risk authorization | Ordinary account use |
| Capability promotion | Capability Authority + owner | QualificationResult, release/contract identity, explicit promotion | Deployment, model result, test pass |
| Identity change | Identity revision and owner-review authority | Exact revision, provenance, constitutional review | Self-improvement proposal or model confidence |

### 6.1 Model catalog refresh composition

Model Fabric owns normalized catalog observations and
`discovered / unqualified` candidate records. It does not own network
authority.

An active catalog refresh composes:

```text
Model Fabric refresh request
  + Network capability admission
      (exact destination + method + data classification + budget)
  + External Effect preparation / revalidation where required
  -> bounded catalog observation
  -> discovered / unqualified candidate record
```

Catalog presence, transport success, or a discovery score cannot produce
qualification, owner approval, promotion, enablement, or routing authority.
Offline import of an owner-supplied catalog artifact does not consume network
authority, but it remains unqualified discovery evidence.

### 6.2 Self-change composition

Organic learning is not runtime or source modification. Runtime or source
modification is not foundational Identity or governance modification.

```text
Sandbox M5 authorship
  != authority to change Ashley

Sandbox M7 engineering effects
  != authority to change foundational Identity or governance
```

Current owners compose the boundary. There is no separate Self-Change file or
roadmap phase unless later research proves an independently owned lifecycle:

- Sandbox V2 (candidate authorship and named engineering-effect profiles)
- Stewardship Compact (consultation, emergency stop, owner authority)
- Identity (foundational revision and owner review)
- Continuity (lineage, forgetting, rollback surfaces)
- Evaluation / Qualification (exact-candidate claims)
- owner authority and rollback

Roadmap §11 remains `HIGH-VALUE NEXT RESEARCH`. The retired V1
self-modification design is not a current contract. Current candidate
authorship is governed by the
[`Sandbox V2 M5 contract`](sandbox/ASHLEY_SANDBOX_V2_M5_DESIGN.md), and
engineering-effect boundaries remain in the
[`Sandbox V2 roadmap`](sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md).

## 7. Effect and ambiguity contract

Every effectful phase must expose these boundaries without collapsing them:

```text
INTENT
  -> PREPARED
    -> AUTHORIZED
      -> REVALIDATED
        -> DISPATCH ATTEMPTED
          -> RECEIPT OBSERVED
            -> EFFECT WITNESSED / RECONCILIATION REQUIRED
```

- Before a possible external commit boundary, a proven interruption may be
  retriable after fresh admission.
- After a possible external commit boundary, missing observation produces
  `OUTCOME_UNKNOWN` or a domain-specific reconciliation-required state.
- Cancellation reports the control result. It does not prove non-execution.
- Idempotency limits duplicates. It does not prove the intended effect or make
  blind retry safe.
- Reconciliation must use current target-state observation or another
  claim-specific Effect Witness. The executor's receipt is preserved
  separately.

## 8. Current-fact documentation policy

Architecture documents must not become stale operational dashboards.

| Fact class | Canonical home | Architecture-document rule |
|---|---|---|
| Schema version, route binding, configured model ID, capability list | Source/config | Link to source. Duplicate only as `CURRENT SOURCE SNAPSHOT AS OF <date> / <SHA>`. |
| Enabled/disabled route or capability state | Source/config or owner-only live status | Never infer deployment or activation from defaults. Living status must name observation time and scope. |
| Current SHA, test count, benchmark, host measurement | Exact-candidate evidence packet | Bind to SHA, command, environment, time, and outcome. Do not copy into timeless architecture prose. |
| Deployment, installation, service state | Operator or production evidence | State `NOT VERIFIED IN THIS DOCUMENT` unless directly evidenced for the named host and time. |
| Architecture law, semantic owner, authority boundary | Authoritative architecture contract | May be stated without a source snapshot. Changes require architecture review. |
| Planned provider, framework, model, or first slice | Phase contract or implementation packet | Label `PLANNED TARGET` or `MECHANISM CANDIDATE`. Never call it current. |
| Old source inventory or qualification result | Historical snapshot | Preserve original facts and add a dated banner. Do not update the snapshot to current source. |

### 8.1 Drift controls

- `docs/Routing_Status.md` is a human-readable routing snapshot. Source remains
  authoritative. A document-reviewed revision is not a route-table audit.
  Record an audit SHA only after comparing the tables to source.
- Current-facing indexes should avoid hand-copied schema numbers, model IDs,
  test counts, and host measurements unless the value is necessary to explain
  a mismatch.
- Schema version, probe count, model ID, and current SHA are living-status or
  exact-candidate evidence. They are not architectural metrics. Do not copy
  them into the canonical roadmap, Cross-Phase Architecture, phase contracts,
  or the document index as if they defined the architecture.
- The Architecture Document Index must distinguish semantic authority from a
  document's implementation or qualification status.
- A phase contract may freeze field meaning without freezing the current value
  of a model, provider, budget, or policy binding.
- Verification should compare every duplicated living fact with its canonical
  source and fail the documentation audit on drift.

## 9. Document status vocabulary

Use the minimum status that explains current authority:

| Status | Meaning |
|---|---|
| `AUTHORITATIVE` | Current semantic or cross-cutting architecture owner. |
| `CURRENT PHASE CONTRACT` | Current authoritative contract for one roadmap phase or milestone beneath the roadmap. |
| `SUPPORTING` | Current explanation, implementation map, runbook, or evidence guide that does not own architecture. |
| `REFERENCE` | Useful research or mechanism input with no current authority. |
| `HISTORICAL` | Exact record of an earlier state, decision, or evidence scope. |
| `SUPERSEDED` | Replaced for its former role; retained for provenance. |
| `SALVAGEABLE SEMANTICS / SUPERSEDED MECHANISM` | Contains reusable laws or contracts, but its topology or implementation mechanism is not current. |
| `CONFLICTING / NEEDS REVIEW` | Current-looking conflict not yet adjudicated. This status blocks reliance. |

Research maturity, implementation presence, qualification, release readiness,
deployment, and promotion are separate dimensions. An `AUTHORITATIVE` phase
contract may describe planned work. A historical evidence packet may prove an
exact old candidate. Neither label upgrades the other dimension.

## 10. Acceptance and change control

Each phase uses the canonical ladder from
[`Wave_Acceptance_Protocol.md`](../Wave_Acceptance_Protocol.md). The only
canonical release-readiness term is `RELEASE_QUALIFIED`.

Cross-phase completion requires:

1. domain-specific deterministic authority and state invariants;
2. semantic evaluation where identity, relationship, judgment, or lived
   continuity claims require it;
3. physical evidence for physical claims;
4. exact-candidate evidence binding;
5. independent review appropriate to risk;
6. separate explicit promotion, deployment, or external-effect authority.

No phase may implement a later phase silently. A necessary interface may be
defined early. Its owner, non-capabilities, and deferred behavior must be
explicit.
