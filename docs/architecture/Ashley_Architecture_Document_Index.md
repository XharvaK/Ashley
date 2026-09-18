# Project Ashley Architecture Document Index

**Role:** Optional architecture/history navigation map and frozen
classification evidence. **Not** a currentness authority.

**Classifications frozen:** 2026-08-27 (2026-08-29 repairs noted inline).
Statuses below are cleanup-campaign evidence from that date. They are not
maintained and they do not prove what is current now. Nobody needs to keep
these rows synchronized: if a row looks stale, that is expected — resolve
present authority from [`AGENTS.md`](../../AGENTS.md) fact-kind rules,
domain contracts, source, exact-candidate evidence, or production
observation instead.

`Current` in Era and relevance cells below is freeze-pass vocabulary
meaning "in force or operative as of 2026-08-27", not "verified today".
`Frozen relevance` column headers mark the same bound.

This index answers which documents governed architecture, which supported
it, and which preserve historical research, as of the freeze date. It does
not replace the documents it indexes. It is not a second architecture
owner, not a current-state dashboard, and not a mandatory worker
admission path. Volatile implementation facts are resolved live from Git,
source, exact-candidate packets, or production observation.

Rows whose paths are absent from this tree are non-clickable pre-publication
history; they are not current execution routes.

### Lineage versus names

```text
WORKTREE NAME != AUTHORITY
BRANCH NAME != CURRENTNESS
EXACT LINEAGE DECIDES
DOCUMENT CLASS DECIDES HOW TO READ A FILE
```

Do not select a tree because its folder or branch name sounds canonical,
current, or C1–C5-related. Current production functional SHA and any
docs-only descendant are recorded in exact-candidate evidence, not inferred
from worktree names.

### Document classes

Index statuses remain the inventory vocabulary. Read them through this class
model:

> Note: class C (living status) is retired as a documentary authority
> category — there is no maintained living-status prose anymore. It
> appears in the table only as the vocabulary of the frozen 2026-08-27
> pass.

| Class | Meaning | Typical index status |
|---|---|---|
| A. Normative / constitutional | Enduring Vision, Principles, Constitution, identity/authority/stewardship law | `AUTHORITATIVE` governance |
| B. Frozen accepted architecture | Exact accepted design/milestone semantics; may be historical | `AUTHORITATIVE`, `CURRENT PHASE CONTRACT`, `ACCEPTED POLICY PROFILE` |
| C. Living status / current reality | Mutable snapshot: routing, production, capability rollout | `SUPPORTING` living status |
| D. Future / planned | Intended work not yet accepted | planned / deferred phase contracts |
| E. Historical / superseded / research | Useful reasoning; not executable current architecture | `HISTORICAL`, `SUPERSEDED`, `REFERENCE`, `SALVAGEABLE SEMANTICS / SUPERSEDED MECHANISM` |
| F. Evidence / handoff | Settlement, qualification, acceptance, audit, deployment records for a bound SHA | exact-candidate evidence, gate packets |

Normative documents must not casually contain today's provider, current model
occupant, temporary milestone, current production SHA, review-prompt
scaffolding, or implementation-wave mechanics. Living facts belong in
exact-candidate evidence (class F) or their live owner — class C is retired,
so no maintained living-status prose may be recreated to hold them.

## 0. Worker routing (not a reading ladder)

This index does not define a mandatory reading order. Workers follow the
task scope plus the authority rules in [`AGENTS.md`](../../AGENTS.md):
the task contract first, then only the domain material the task
triggers, with volatile facts resolved from their owners. Governance and
architecture documents below are conditional routes, not universal
pre-reading. The live-resolution table from the 2026-08-27 pass is
preserved beneath for provenance; use the AGENTS table for current work.

### Live state resolution

Resolve volatile truth from its real authority when needed. Do not infer
current maturity from source presence, architecture, or historical packets.

| Fact | Authority |
|---|---|
| Repository HEAD | Git / `git rev-parse HEAD` |
| Worktree state | Git / `git status --short` |
| Supported schema | source (`apps/agent-service/src/core/db.ts`) |
| Current route bindings | routing source + explicitly audited [`Routing_Status.md`](../Routing_Status.md) |
| Qualification / release state | exact-candidate evidence packet |
| Deployed SHA | production observation |
| Promoted capabilities | production observation |
| Architectural prerequisites | canonical roadmap / focused contract |
| Owner-selected current task | owner / current working context; do not infer |

If current truth cannot be established from permitted evidence: `UNKNOWN`.
Architecture documents must not act as current-state dashboards.

| Do | Do not |
|---|---|
| Resolve volatile facts from their actual owner | Resurrect Sandbox V1 broker architecture |
| Follow the focused contract for the task | Treat worktree source as deployed |
| Use Wave Acceptance verification semantics | Treat a passed test as capability promotion, or `RELEASE_QUALIFIED` as `PRODUCTION_ACCEPTED` |
| | Copy schema or model IDs into timeless architecture |
| | Infer self-change authority from Sandbox M5/M7 |
| | Implement a later milestone while its documented predecessor gate is unmet |
| | Infer current maturity from source presence, architecture, or historical packets |

Today’s pending gate is not recorded here. Resolve it live. Architecture owns
prerequisite relationships only.

Repository documentation was reconciled against the supplied Frozen
Architecture Baseline and a later owner-supplied ChatGPT-history decision
reconciliation. Raw inaccessible conversations were not directly searched by
this worker.

## Status definitions

| Status | Meaning in this index |
|---|---|
| `AUTHORITATIVE` | Governs the stated domain. Lower documents do not override it. |
| `CURRENT PHASE CONTRACT` | Current authoritative contract for one roadmap phase beneath the roadmap and Cross-Phase Architecture. |
| `ACCEPTED POLICY PROFILE` | Named cross-cutting policy accepted as architecture direction. Not an owner. Cross-Phase and the relevant domain owners own and enforce it. |
| `ACCEPTED ARCHITECTURE / IMPLEMENTATION PLANNED` | Owner-accepted target architecture and its implementation packet. Not implemented, not qualified, not deployed, not production accepted, not production active. |
| `SUPPORTING` | Current explanatory, operational, or evidence material beneath authoritative direction. |
| `HISTORICAL` | Preserves a dated implementation, review, qualification, or decision snapshot. |
| `SUPERSEDED` | Preserves a position that no longer describes current architecture or roadmap. |
| `REFERENCE` | Useful research, procedure, or design input without current authority. |
| `SALVAGEABLE SEMANTICS / SUPERSEDED MECHANISM` | Reusable laws or contracts remain; topology or implementation mechanism is not current. |
| `CONFLICTING / NEEDS REVIEW` | Contains a material statement that conflicts with current source or the Frozen Architecture Baseline. Do not use that statement as current direction. |

`Wave_accepted`, local test success, release qualification, deployment,
activation, and capability promotion are separate states. This index does not
upgrade one into another.

## 1. Governance and canonical direction

| Title | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| Vision | [`VISION.md`](../../VISION.md) | Why Ashley exists; reciprocal non-servant direction; shared cognitive ancestry and divergence | Current | `AUTHORITATIVE` | Normatively prior. Not a runtime prompt. Shared ancestry is origin, not identity authority. Accepted Vision amendment 2026-08-25. |
| Ashley Core Principles | [`docs/Ashley_Core_Principles.md`](../Ashley_Core_Principles.md) | Highest constitutional constraints beneath the Vision | Current | `AUTHORITATIVE` | Governs all lower architecture and implementation. |
| Ashley Constitution | [`docs/Ashley_Constitution.md`](../Ashley_Constitution.md) | Long-form behavioral and architectural constitution | Current; `## Model` amended 2026-08-25; form repaired 2026-08-27 | `AUTHORITATIVE` | Constitutional content occupying the constitutional slot. Not a review prompt. `## Model` governs multi-provider Model Fabric; it does not activate routes. Historical review-prompt form: `docs/history/Ashley_Constitution_Architecture_Review_Prompt.md`. |
| Ashley Stewardship Compact | [`docs/Ashley_Stewardship_Compact.md`](../Ashley_Stewardship_Compact.md) | Operator authority, consultation, emergency stop, custody | Current | `AUTHORITATIVE` | Peer specialized governance beneath the Constitution. |
| Ashley Ethics | [`docs/Ashley_Ethics.md`](../Ashley_Ethics.md) | Relational, privacy, credential, and external-entity ethics | Current | `AUTHORITATIVE` | Peer specialized governance beneath the Constitution. |
| Ashley Hierarchy | [`docs/Ashley_Hierarchy.md`](../Ashley_Hierarchy.md) | Normative order and conflict rule | Current | `AUTHORITATIVE` | Defines precedence from Vision through runtime. |
| Ashley Glossary | [`docs/Ashley_Glossary.md`](../Ashley_Glossary.md) | Normative project vocabulary | Current | `AUTHORITATIVE` | Use for established semantic terms. The roadmap adds phase terms without redefining glossary entries. |
| Ashley Design Patterns | [`docs/Ashley_Design_Patterns.md`](../Ashley_Design_Patterns.md) | Architecture ownership and review patterns | Current | `SUPPORTING` | Applies governing semantics to recurring design choices. |
| Canonical Architecture Roadmap | [`docs/architecture/Ashley_Architecture_Roadmap.md`](Ashley_Architecture_Roadmap.md) | Bounded design intent, delivery map, classified dependency edges, phase names, engineering milestones from the then-live state, and framework disposition | 2026-08-21; milestone conversion 2026-08-23; metacognition policy 2026-08-25; live-state snapshot 2026-08-27; Wave-4 living-status closure | `AUTHORITATIVE` | Bounded intent + historical roadmap evidence beneath governance; not present-state authority. §3 is the closed 2026-08-27 historical snapshot. §5.6 is a phase-contract register with a frozen 2026-08 Status column, not a promotion dashboard. It distinguishes the production C1 base capability at `09b73fbb…` from the non-deployed C1 Qualification Bootstrap at `23d7c418…` as campaign evidence. Production acceptance in observe does not promote either capability. |
| Architecture Freeze | [`docs/architecture/Ashley_Architecture_Freeze.md`](Ashley_Architecture_Freeze.md) | Frozen owner map, event-term split, external inspiration disposition, architecture-justified sequence before advanced autonomy | 2026-08-23 | `AUTHORITATIVE` | Completeness research landed here. Adds no owners. Distinguishes historical research, frozen architecture, planned work, and owner-selected delivery. |
| Architecture Freeze documentation sync | `docs/handoffs/ashley-architecture-freeze-doc-sync.md` | Change plan, term classification, and consistency report for the freeze documentation pass | 2026-08-23 | `SUPPORTING` | Records this documentation synchronization. It is not an architecture owner and authorizes no implementation. |
| Roadmap engineering-milestone conversion | `docs/handoffs/ashley-roadmap-engineering-milestones.md` | Converts existing roadmap items into dependency-ordered engineering milestones from live state | 2026-08-23 | `SUPPORTING` | Records the milestone conversion. Adds no phases. Authorizes no implementation. |
| Milestone Execution Governance | [`docs/architecture/Ashley_Milestone_Execution_Governance.md`](Ashley_Milestone_Execution_Governance.md) | Execution contracts, leakage guards, and artifact ladder for already-named milestones | 2026-08-23; Wave-4 next-action closure | `AUTHORITATIVE` | Governs execution discipline over existing milestones. Adds no owners, phases, or primitives. Does not accept M3/M4 or authorize implementation. The §8 next-action material is bounded 2026-08-25 history and assigns no current work. |
| Milestone execution governance review | `docs/handoffs/ashley-milestone-execution-governance.md` | Review record for the execution-governance pass | 2026-08-23 | `SUPPORTING` | Records the review. Not an architecture owner. |
| Cross-Phase Architecture | [`docs/architecture/Ashley_Cross_Phase_Architecture.md`](Ashley_Cross_Phase_Architecture.md) | Shared laws, classified dependency edges, state ownership, authority matrix, effect/ambiguity contract, and current-fact policy | 2026-08-21 | `AUTHORITATIVE` | Governs interfaces used by every phase. Owns `HARD_DEPENDENCY`, `EVIDENCE_DEPENDENCY`, `OWNER_SELECTED_IMPLEMENTATION_ORDER`, and `CROSS_CUTTING_INTERFACE`. The roadmap records bounded delivery intent; current priority is owner/task scope. Accepted metacognition laws are Cross-Phase laws for the named policy profile. They do not amend the Freeze map. |
| Sandbox V2 M-Series Roadmap | [`docs/architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md`](sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md) | Current M0-M7 boundaries, V1 supersession, state ownership, authority progression, operational truth, and acceptance gates | 2026-08-21; evidence pointer 2026-08-25 | `AUTHORITATIVE` | Governs Sandbox V2 beneath higher governance and the canonical architecture roadmap. Dated exact-candidate evidence closes M1–M7, with M7 limited to `patch_export`; new profiles still require their own gates. |
| Architecture Document Index | [`docs/architecture/Ashley_Architecture_Document_Index.md`](Ashley_Architecture_Document_Index.md) | Document authority and history | 2026-08-17 | `FROZEN MAP` | Optional navigation and frozen 2026-08-27 classification evidence. Not proof of current document status. |
| Ashley Architecture Index | [`docs/Architecture_Index.md`](../Architecture_Index.md) | Runtime modules, ownership, endpoints, and current design links | Current | `SUPPORTING` | Implementation-oriented map. It is not the roadmap. |
| Architecture Review Protocol | [`docs/Architecture_Review_Protocol.md`](../Architecture_Review_Protocol.md) | Architecture review discipline | Current | `SUPPORTING` | Applies governance and ownership rules during review. |
| Ashley Field Observation Protocol | [`docs/Ashley_Field_Observation_Protocol.md`](../Ashley_Field_Observation_Protocol.md) | After-the-day read-only field observation; Owner Attestations; Field Lab; non-intervention | 2026-08-27 | `SUPPORTING` | Procedure under Observability and Evaluation. Not an architecture owner. Does not authorize exporter implementation, daily routine, qualification traffic, or promotion. |
| Wave Acceptance Protocol | [`docs/Wave_Acceptance_Protocol.md`](../Wave_Acceptance_Protocol.md) | Design, implementation, qualification, release, deployment, promotion states | Current | `AUTHORITATIVE` | Governs acceptance claims and evidence separation. |
| Vision Implementation Map | [`docs/Vision_Implementation_Map.md`](../Vision_Implementation_Map.md) | Vision commitment to owner/evidence/failure/status mapping | Current | `SUPPORTING` | Traceability beneath governance. |
| Project AGENTS instructions | [`AGENTS.md`](../../AGENTS.md) | Repository operations and architecture summary | Current | `SUPPORTING` | Contributor instructions. Not an independent architecture authority. |
| Public README | [`README.md`](../../README.md) | Public project positioning and entry links | Current | `SUPPORTING` | Landing page only. Follow canonical documents for architecture detail. |

## 2. Current subsystem and design documents

| Title | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| Routing Status | [`docs/Routing_Status.md`](../Routing_Status.md) | Routing ownership and resolution guide plus a frozen dated audit appendix | Wave 1; occupant compatibility check 2026-08-27 against production `09b73fbb…` / docs `c84c651…` | `SUPPORTING` | Resolution guide, not constitutional law; the appendix audit is frozen evidence, not current bindings. Route facts are consumed from the CURRENT portfolio snapshot via loader/resolver source. Read that file for how to resolve occupants — never copy a value out of prose. Not Model Fabric architecture. |
| Model Fabric Architecture | [`docs/architecture/Model_Fabric_Architecture.md`](Model_Fabric_Architecture.md) | Semantic dispatch boundary, specialist portfolio, MF-M1 seam, OpenCode Track A/B split, MF-M2–MF-ACT order | 2026-08-25 | `CURRENT PHASE CONTRACT` | **Sole** current-facing Model Fabric owner. During the 2026-08 campaign the selected first **code** milestone was **MF-M1** (local candidate `d918572c`); current selection is owner/task scope. MF-M2–MF-ACT execution contracts are implementation-ready machinery; they do not activate §12.9. Historical F1 Thought-observation is **F1-obs** (deferred). |
| Model Fabric MF-M2–MF-ACT implementation contracts | [`docs/architecture/Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md`](Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md) | Wave-style execution contracts for SLICE 0 and MF-M2 through MF-ACT | 2026-08-25 | `SUPPORTING` / focused contract | Beneath Model Fabric Architecture. Machinery only. Not production activation. |
| SC-CON-04 Constitution Model consultation | `docs/governance/SC-CON-04_2026-08-25_Constitution_Model.md` | Stewardship consultation for the Constitution `## Model` amendment | 2026-08-25 | `SUPPORTING` | Covers Fixed Constraint text only. Not a family-cutover consultation and not an ActivationRef. |
| Model Fabric MF-M2–MF-M6 Pass-1 research audit | `docs/architecture/research/Model_Fabric_MF_M2_MF_M6_Research_Audit.md` (pre-publication history; not in current tree) | Pass-1 source audit, caller inventory, MF-M1 R1/R2 | 2026-08-25 | `SUPPORTING` | Evidence record. Contracts supersede it. |
| Model Fabric OpenCode research snapshot | `docs/architecture/research/Model_Fabric_OpenCode_Research_Snapshot_2026-08-25.md` (pre-publication history; not in current tree) | Dated Zen catalog and official capability notes | 2026-08-25 | `EPHEMERAL RESEARCH` | Not a roster. Architecture must survive catalog churn. |
| Ashley OpenCode Worker future | `docs/architecture/research/Ashley_OpenCode_Worker_Future.md` (pre-publication history; not in current tree) | Track B engineering worker; OC-M0/M1 salvage | 2026-08-25 | `BOUNDED OFF-TREE FOUNDATION PROVEN / INTEGRATION FUTURE / NON-NORMATIVE FOR MF` | OC-M0 and one synthetic OC-M1 bugfix passed in an off-tree harness. No repository package, Model Fabric qualification, production route, or worker activation exists. Worker output is not truth or apply authority. |
| Model Fabric owner decision packet | `docs/handoffs/MODEL_FABRIC_OWNER_DECISION_PACKET.md` (pre-publication history; not in current tree) | Closed owner + ChatGPT Fabric decisions | 2026-08-25 | `SUPPORTING` | Decision record. Not a second architecture. MF-M1 is first code milestone. |
| Model Fabric MF-M2–MF-M6 Pass-1 owner packet | `docs/handoffs/MODEL_FABRIC_MF_M2_MF_M6_OWNER_DECISION_PACKET.md` (pre-publication history; not in current tree) | Pass-1 questions | 2026-08-25 | `SUPPORTING` | `OWNER CLOSED` by Pass-2 answers. Not architecture. |
| Model Fabric Pass-2 checkpoint | `docs/handoffs/MODEL_FABRIC_MF_M2_MF_ACT_PASS2_CHECKPOINT.md` (pre-publication history; not in current tree) | Pass-2/2.1 contract freeze | 2026-08-25 | `SUPPORTING` | Machinery contracts frozen as documentation. Not production activation. |
| Model Fabric documentation fixtures | `docs/architecture/model-fabric/**` (pre-publication history; not in current tree) | Incomplete CURRENT/TARGET JSON examples | 2026-08-25 | `SUPPORTING` | Documentation fixtures only. Not `config/model-fabric/` runtime. Not dispatchable. |
| Model Fabric roadmap handoff | `docs/handoffs/MODEL_FABRIC_ROADMAP_HANDOFF.md` (pre-publication history; not in current tree) | MF-M1 candidate plus MF-M2–MF-ACT contract pointer | 2026-08-25 | `SUPPORTING` | Local candidate `d918572c`; later machinery contracted; acceptance and production promotion remain separate. Not architecture. |
| Model Fabric MF-M1 implementation checkpoint | `docs/handoffs/MODEL_FABRIC_MF_M1_IMPLEMENTATION_CHECKPOINT.md` (pre-publication history; not in current tree) | Candidate, verification, acceptance boundary, and later re-evaluation | 2026-08-25 | `SUPPORTING` | Candidate `d918572c` from exact `5a05e96e`; local verification recorded; not production authorization. |
| Model Fabric Codebase Reconnaissance | [`docs/architecture/Model_Fabric_01_Codebase_Reconnaissance.md`](Model_Fabric_01_Codebase_Reconnaissance.md) | Dated model-call inventory, routing defects, transport seams | 2026-08-13 | `HISTORICAL` | Exact-baseline source snapshot. Historical filename retained. “Safest first slice = observation” is superseded by MF-M1. Live routes live in Routing Status. |
| Model Fabric Contract Draft | [`docs/architecture/Model_Fabric_01_Contract_Draft.md`](Model_Fabric_01_Contract_Draft.md) | Provider-neutral field contracts, MF-M1 attempt/invocation/fallback-chain receipts, and historical F1-obs specification | 2026-08-13; reconciled 2026-08-25 | `SUPPORTING` | Field-level contracts beneath the Model Fabric Architecture. Historical filename retained. MF-M1 preserves current failover/fallback; deferred F1-obs remains single-attempt with no fallback. |
| Model Fabric Implementation Spike | [`docs/architecture/Model_Fabric_01_Implementation_Spike.md`](Model_Fabric_01_Implementation_Spike.md) | Deferred F1-obs default-off Thought-observation shadow slice | 2026-08-13; banner 2026-08-25 | `SUPPORTING / DEFERRED` | Not MF-M1. Lightning observation witness remains optional later. Activation is not authorized. |
| Ashley Evaluation / Qualification Plane | [`docs/architecture/Ashley_Evaluation_Qualification_Plane.md`](Ashley_Evaluation_Qualification_Plane.md) | Cross-cutting invariant, evidence, qualification, and promotion contracts | 2026-08-13 | `AUTHORITATIVE` | Ashley owns qualification meaning and promotion. Model Fabric supplies bound profile and receipt facts. Canonical release-readiness term is `RELEASE_QUALIFIED`. Metacognition witness rows are accepted with the C1/C3/C5 qualification split. |
| Ashley Evaluation Inventory | [`docs/architecture/evaluation/Ashley_Evaluation_Inventory.md`](evaluation/Ashley_Evaluation_Inventory.md) | Current evaluation mechanisms and gaps | 2026-08-13 | `SUPPORTING` | Source-grounded inventory. Existing checks do not automatically qualify a replacement model or fallback role. |
| Evaluation First Spike | [`docs/architecture/evaluation/Evaluation_First_Spike.md`](evaluation/Evaluation_First_Spike.md) | Future `MODEL_PROFILE` evidence and qualification slice | 2026-08-13; SC-CON-04 closure 2026-08-25 | `SUPPORTING` | Implementation waits for Model Fabric profile identity, SLICE 0 receipt truth, and MF-M1 local acceptance. It creates no second profile registry or promotion path. |
| Observability Plane | [`docs/architecture/Ashley_Observability_Plane.md`](Ashley_Observability_Plane.md) | Telemetry, correlation, redaction, retention, and diagnostic-versus-control boundaries | 2026-08-21 | `AUTHORITATIVE` | Observability is not evaluation, qualification, memory, or an Effect Witness. OpenTelemetry is a mechanism candidate, not a required semantic interface. |
| External Effect and Authority Architecture | [`docs/architecture/External_Effect_and_Authority_Architecture.md`](External_Effect_and_Authority_Architecture.md) | Cross-cutting observation, credential, representation, commit, receipt, witness, and reconciliation contracts | 2026-08-21 | `AUTHORITATIVE` | Parent of connectors, procedures, Computer Use, and Sandbox M7 engineering effects. Computer Use is one consumer, not the parent of generic external action. |
| Operational Continuity Architecture | [`docs/architecture/Operational_Continuity_Architecture.md`](Operational_Continuity_Architecture.md) | WorkConcern, attempt, lease, resume, cancellation, artifacts, and effect reconciliation | 2026-08-21 | `CURRENT PHASE CONTRACT` | Durable work is not OpenConcern or Mind State. Restate, Temporal, and DBOS remain mechanism candidates. |
| Procedural Skill Graduation Architecture | [`docs/architecture/Procedural_Skill_Graduation_Architecture.md`](Procedural_Skill_Graduation_Architecture.md) | Experience to qualified reusable procedure without automatic authority | 2026-08-21 | `CURRENT PHASE CONTRACT` | Installed or imported skills remain inert until Ashley-owned qualification and current invocation admission. |
| Computer Use Architecture | [`docs/architecture/Computer_Use_Architecture.md`](Computer_Use_Architecture.md) | Semantic application observation and interaction | 2026-08-21 | `CURRENT PHASE CONTRACT` | Mechanism preference is connector, procedure, deterministic UI, then visual fallback. A logged-in session is not permission. |
| Learned Autonomy Architecture | [`docs/architecture/Learned_Autonomy_Architecture.md`](Learned_Autonomy_Architecture.md) | Evidence-bound interests, preferences, salience, and goals | 2026-08-21; C3 delivery 2026-08-27 | `CURRENT PHASE CONTRACT` | Advances Ashley herself. Learned preference is not authority. 2026-08-27 campaign reading: C3 implemented / production-accepted / `observe` / unpromoted / non-live; resolve live maturity from exact-candidate evidence. Deployed is not promoted. Inherited/current-interest separation is C3-closing, not C1-closing. |
| Context Budget Architecture | [`docs/architecture/Context_Budget_Architecture.md`](Context_Budget_Architecture.md) | Bounded attention over persistent state | 2026-08-21; C2 delivery 2026-08-27 | `CURRENT PHASE CONTRACT` | Context eviction is not forgetting. 2026-08-27 campaign reading: C2 implemented / production-accepted / `observe` / unpromoted / non-live; resolve live maturity from exact-candidate evidence. Deployed is not promoted. |
| Cognitive Graduation Architecture | [`docs/architecture/Cognitive_Graduation_Architecture.md`](Cognitive_Graduation_Architecture.md) | Epistemic maturation, lived-experience continuity, integrated cognitive coherence | 2026-08-21; C4 delivery 2026-08-27 | `CURRENT PHASE CONTRACT` | Integration and qualification over existing cognitive owners. 2026-08-27 campaign reading: C4 implemented / production-accepted / `observe` / unpromoted / non-live. Not Relational Graduation and not live influence. |
| Relational Graduation Architecture | [`docs/architecture/Relational_Graduation_Architecture.md`](Relational_Graduation_Architecture.md) | Mutual commitment, tension, withdrawal, non-manipulation, companion continuity | 2026-08-21; C5 delivery 2026-08-27 | `CURRENT PHASE CONTRACT` | Sibling of Cognitive Graduation. 2026-08-27 campaign reading: C5 implemented / production-accepted / `observe` / unpromoted / non-live. Independent state, evidence, rollback, and acceptance. |
| Memory and Recall | [`docs/memory-and-recall.md`](../memory-and-recall.md) | Nuclear Recall, provenance, forgetting, and continuity | Current nuclear era | `SUPPORTING` | Use with current source and schema migrations. `nuclear.db` and `continuity.db` remain authoritative for their domains. |
| Ashley Memory Evidence Architecture | [`docs/architecture/Ashley_Memory_Evidence_Architecture.md`](Ashley_Memory_Evidence_Architecture.md) | Persistent memory evidence: canonical evidence vs memory assertions vs retrieval projections; provenance; temporal / revision / forgetting semantics; C1 shadow qualification and sticky currentness boundary | 2026-08-17; C1 policy and bootstrap reconciliation 2026-08-27 | `AUTHORITATIVE` | Governs persistent memory evidence and the accepted C1 qualification/currentness semantics within its domain. It does not establish the current production status of the C1 base capability or promote the non-deployed bootstrap candidate. |
| Ashley Metacognition Architecture | [`docs/architecture/Ashley_Metacognition_Architecture.md`](Ashley_Metacognition_Architecture.md) | Named cross-cutting policy profile: three surfaces, influence classes, correction classes, lineage, shared-interest stages, first Memory / Evidence witness | 2026-08-25 | `ACCEPTED POLICY PROFILE` | Beneath Cross-Phase and the relevant domain owners. 2026-08-25 campaign provenance: carried on runtime integration baseline `e36613b…`; source documentation checkpoint `7a788375…`. Not a freeze-map owner, faculty, store, authority, model role, standalone phase, or §5 milestone. Does not authorize runtime, schema, Mint, or MF-M1 changes. Research: `research/AI_Enhanced_Metacognition_Audit.md` (pre-publication history; not in current tree). Decision record: `../handoffs/METACOGNITION_OWNER_DECISION_PACKET.md` (pre-publication history; not in current tree). |
| Proactive messages | [`docs/proactive-initiative.md`](../proactive-initiative.md) | Periodic scheduler, idle gate, admitted wake, Thought, settlement/delivery | Current nuclear era | `SUPPORTING` | Current periodic mechanism. Timer mechanics never become Agency. The legacy Agency.decide reserve/send pipeline is superseded.
| Grounded Curiosity Reader | [`docs/curiosity-reader.md`](../curiosity-reader.md) | Bounded public reading and evidence | Current nuclear era | `SUPPORTING` | Reading is untrusted evidence and never sends directly. Discord presence currentness for reads is [`Discord_Presence_Truth.md`](Discord_Presence_Truth.md). |
| Discord presence truth | [`docs/architecture/Discord_Presence_Truth.md`](Discord_Presence_Truth.md) | Current vs recent Discord custom status; read lifecycle vs presence rendering | 2026-08-26 | `SUPPORTING` | Discord renders `currentActivity`. A persisted take is not currently reading. |
| Sandbox V2 M3 Design | [`docs/architecture/sandbox/ASHLEY_SANDBOX_V2_M3_DESIGN.md`](sandbox/ASHLEY_SANDBOX_V2_M3_DESIGN.md) | Current private writable candidate-workspace milestone contract | 2026-08 | `SUPPORTING` | Owns M3 detail beneath the V2 M-series roadmap. Current exact-SHA physical and production acceptance require separate evidence. |
| Sandbox V2 M4 Design | [`docs/architecture/sandbox/ASHLEY_SANDBOX_V2_M4_DESIGN.md`](sandbox/ASHLEY_SANDBOX_V2_M4_DESIGN.md) | M4 verification milestone contract: snapshot identity, recipe catalog, evidence, honesty boundary | 2026-08-22 | `SUPPORTING` | Owns M4 detail beneath the V2 M-series roadmap. Design accepted. Implementation, qualification, and production acceptance require separate evidence. |
| Sandbox V2 M5 Design | [`docs/architecture/sandbox/ASHLEY_SANDBOX_V2_M5_DESIGN.md`](sandbox/ASHLEY_SANDBOX_V2_M5_DESIGN.md) | M5 authorship milestone contract: candidate change-set, seal, advisory proposal, non-apply | 2026-08-23 | `SUPPORTING` | Owns M5 detail beneath the V2 M-series roadmap. Design accepted. Local settlement is a separate handoff. Physical qualification and production acceptance remain later. Authorship is not apply-to-Ashley. |
| Sandbox Design | [`docs/Sandbox_Design.md`](../Sandbox_Design.md) | V1 OS-boundary threat model, broker, authority, IPC, isolation | Wave 07 | `HISTORICAL` | Preserves V1 broker provenance and salvageable isolation laws. Its broker topology is superseded for V2. |
| Sandbox Operations | [`docs/Sandbox_Operations.md`](../Sandbox_Operations.md) | V1 broker recovery, sweep, ceilings, and reconciliation | Sandbox V1 hardening era | `HISTORICAL` | Salvage bounded-cleanup and crash-finality lessons only through current V2 contracts. The broker runbook is not current V2 operations. |
| Sandbox Status | [`docs/Sandbox_Status.md`](../Sandbox_Status.md) | V1 broker readiness and isolation snapshots | SANDBOX-ISOLATION-01/02E | `HISTORICAL` | Dated V1 status evidence. It does not describe current V2 readiness or grant current exact-SHA qualification. |
| Sandbox Production Release Packet v1 | [`docs/architecture/sandbox/Sandbox_Production_Release_Packet_v1.md`](sandbox/Sandbox_Production_Release_Packet_v1.md) | V1 broker release gates and operator evidence | 2026-08-12 | `HISTORICAL` | Exact-scope V1 release-planning provenance only. It does not govern or qualify V2. |
| Offline Qualification Network Isolation v1 | `docs/qualification/Offline_Qualification_Network_Isolation_v1.md` | Offline harness and network-isolation evidence | 2026-08-09 | `HISTORICAL` | Qualification evidence for its exact scope and build only. |
| Stabilization Design | [`docs/Stabilization_Design.md`](../Stabilization_Design.md) | Wave 10 assurance and stabilization | 2026-08-04 | `SUPPORTING` | Accepted assurance design. Wave acceptance remains distinct from release qualification. |
| Behavioral Evidence Inventory Audit | `docs/behavioral-evidence-inventory-audit.md` | Evidence surface audit | Current nuclear era | `REFERENCE` | Read-only audit evidence for its snapshot. Not a roadmap. |
| Rollout Execution vs Influence Audit | `docs/rollout-execution-influence-audit.md` | Observe/apply and execution/influence separation | Current nuclear era | `SUPPORTING` | Preserves authority-at-creation and non-time-shift distinctions. |
| Persona eval and staged ship | [`docs/persona-eval.md`](../persona-eval.md) | Persona evaluation and rollout | Earlier evaluation era | `REFERENCE` | Evaluation patterns only. Current roadmap and Wave Acceptance Protocol govern phase ordering. |
| Consciousness and Personhood Research Track | [`docs/personhood-research.md`](../personhood-research.md) | Research questions about personhood | Ongoing research | `REFERENCE` | Research track beneath the Vision. It does not grant consciousness claims or runtime authority. |

## 3. Initiative and cognitive-continuity records

| Title | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| Initiative Production Path Audit v1 | [`docs/architecture/initiative/Initiative_Production_Path_Audit_v1.md`](initiative/Initiative_Production_Path_Audit_v1.md) | Initiative runtime-path audit | 2026-08-09 | `HISTORICAL` | Evidence snapshot for implemented initiative paths. |
| INIT-03 Persistent Cognitive Continuity Contract v1 | [`docs/architecture/initiative/INIT03_Persistent_Cognitive_Continuity_Contract_v1.md`](initiative/INIT03_Persistent_Cognitive_Continuity_Contract_v1.md) | Cognition generations, wake/review, continuity | 2026-08-09 | `SUPPORTING` | Accepted local contract. Operational Continuity is a broader future phase and must not be conflated with INIT-03. |
| INIT-03 Implementation and Qualification Report v1 | [`docs/architecture/initiative/INIT03_Implementation_and_Qualification_Report_v1.md`](initiative/INIT03_Implementation_and_Qualification_Report_v1.md) | Local implementation and qualification evidence | 2026-08-10 to 2026-08-11 | `HISTORICAL` | Local evidence for the recorded build. Independent closure and live release remain separate. |

## 4. Foundation, salvage, and framework research

| Title | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| Ashley Architecture Salvage Map v1 | [`docs/architecture/Ashley_Architecture_Salvage_Map_v1.md`](Ashley_Architecture_Salvage_Map_v1.md) | First framework and subsystem salvage map | 2026-08-08 to 2026-08-09 | `SUPERSEDED` | Preserves Pass 1 research. Do not use its candidate priority as the current roadmap. |
| Ashley Foundation Architecture Decision v1 | [`docs/architecture/Ashley_Foundation_Architecture_Decision_v1.md`](Ashley_Foundation_Architecture_Decision_v1.md) | P-01 foundation and semantic-boundary decision | 2026-08-09 | `HISTORICAL` | Semantic ownership and `KEEP CURRENT` reasoning remain supporting. Its roadmap ordering and “implementation not started” snapshot are no longer current. |
| Ashley Architecture Salvage Map v2 | [`docs/architecture/Ashley_Architecture_Salvage_Map_v2.md`](Ashley_Architecture_Salvage_Map_v2.md) | Accepted 31-subsystem decision surface | 2026-08-09 | `HISTORICAL` | Strong provenance for ownership seams. Later roadmap positions, including durable execution, are governed by the canonical roadmap. |
| Salvage Map Adversarial Audit v1 | `docs/architecture/salvage/Ashley_Salvage_Map_Adversarial_Audit_v1.md` | Red-team of KEEP and candidate claims | 2026-08-09 | `HISTORICAL` | Supports semantic ownership and narrow machinery seams. Candidate priorities are not current direction. |
| Ashley Subsystem Inventory | `docs/architecture/salvage/Ashley_Subsystem_Inventory.md` | 31-subsystem source inventory | 2026-08-09 | `HISTORICAL` | Useful source-era inventory. Verify against current source before use. |
| Foundation Candidate Dossiers | `docs/architecture/salvage/Foundation_Candidate_Dossiers.md` | Framework research dossiers | 2026-08-09 | `REFERENCE` | Research provenance only. External projects and adoption status may drift. |
| Porting Spike Backlog | `docs/architecture/salvage/Porting_Spike_Backlog.md` | Proposed framework and porting spikes | 2026-08-09 | `SUPERSEDED` | Research-only backlog explicitly did not authorize work. Canonical roadmap now governs phase order. |
| Research Gaps and Contradictions | `docs/architecture/salvage/Research_Gaps_and_Contradictions.md` | Candidate conflicts and research gaps | 2026-08-09 | `HISTORICAL` | Preserves why Mastra, AgentFS, OpenHands, and Letta roles were narrowed. Some gaps were later resolved by P-01/P-02. |
| Semantica Salvage Audit v1 | `docs/architecture/salvage/Semantica_Salvage_Audit_v1.md` | Semantic-framework source audit | 2026-08-09 | `REFERENCE` | Supports no-wholesale-adoption and a possible read-only PROV-O export adapter. Semantica is not Ashley authority. |
| Autonomous Work Semantics Salvage | `docs/architecture/research/Autonomous_Work_Semantics_Salvage.md` | Autonomous-work semantic distinctions and candidate reconciliation | 2026-08-13 | `REFERENCE` | Records architectural pressure and future direction without freezing candidate names, selecting a substrate, or authorizing implementation. Historical `-01` labels are provenance. |
| Operational Continuity Codebase Reconnaissance | `docs/architecture/research/Operational_Continuity_01_Codebase_Reconnaissance.md` | Dated inventory of durable jobs, delivery, leases, and recovery patterns | 2026-08-14 | `HISTORICAL` | Exact-baseline snapshot. V1 broker, schema v27, and serial phase labels are not current. Use the Operational Continuity Architecture for current direction. Historical filename retained. The phrase “Event Fabric” in that snapshot means the durable inbox, not the later typed Event Spine. |
| Sandbox Final Activation Path Reconnaissance | `docs/architecture/research/Sandbox_Final_Activation_Path_Reconnaissance.md` | V1 broker install/activation path | 2026-08 | `HISTORICAL` | Historical Sandbox V1 broker activation reconnaissance. It does not define Sandbox V2 activation. |
| Untracked root qualification packets | repository root (`M3_*`, `oc-m1-*`, `QUALIFICATION_PACKET_*`, and similar) | Exact-candidate or investigation working evidence | mixed | `HISTORICAL` / untracked working evidence | Not architecture. Bind only the packet’s stated SHA, host, and claim. Do not infer current HEAD maturity from a historical packet. |
| Model Fabric Final Implementation Packet | `docs/architecture/research/Model_Fabric_01_Final_Implementation_Packet.md` | Read-only first-slice planning snapshot | 2026-08-14 | `REFERENCE` | Planning packet only. Does not authorize implementation or outrank the Model Fabric Architecture. |
| MemPalace Architecture Salvage Map | `docs/architecture/research/MemPalace_Salvage_Map.md` | Adjudicated MemPalace research and salvage decisions | 2026-08-17 | `SUPPORTING` | Adjudicated research provenance beneath the Ashley-native memory evidence architecture. Its decisions are frozen; none authorize implementation. It does not normatively outrank the architecture document. Historical `-01` labels are provenance. |
| AI-Enhanced Metacognition audit | `docs/architecture/research/AI_Enhanced_Metacognition_Audit.md` | AEM paper audit, literature synthesis, Mika problem, Ashley fit | 2026-08-25 | `PROVISIONAL RESEARCH` | Design inspiration only. Not architecture, clinical, or implementation authority. Source documentation checkpoint is `7a788375…`; canonical runtime integration baseline is `e36613b…`. Q0–Q16 are recorded in the owner packet. The metacognition overlay was accepted as architecture direction; this audit remains research. |
| Metacognition owner decision packet | `docs/handoffs/METACOGNITION_OWNER_DECISION_PACKET.md` | Owner-closed Q0–Q16 for metacognition form, cadence, privacy, lineage, first slice | 2026-08-25 | `OWNER DECISIONS RECORDED` · `PASS-3 ACCEPTED` | Decision record. Not a second architecture. Overlay accepted as architecture direction on canonical runtime integration baseline `e36613b…`; the `7a788375…` docs checkpoint remains provenance. Does not amend the Freeze owner map. |
| Metacognition roadmap handoff | `docs/handoffs/METACOGNITION_ROADMAP_HANDOFF.md` | Pass-3 distribution of metacognition across the cognitive track | 2026-08-25 | `PASS-3 ACCEPTANCE RECORD` | Does not add a standalone phase or §5 milestone. Canonical insertions are accepted architecture direction on `e36613b…`. Does not select current delivery work or authorize MF-M1. |

## 5. P-01 and P-02 evidence

| Title | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| P-01A Current Cognition Characterization | `docs/architecture/spikes/P01A_Current_Cognition_Characterization.md` | Candidate-neutral cognition job contract | 2026-08-09 | `HISTORICAL` | Passed characterization evidence for its source baseline. |
| P-01B Workflow Parity Report | `docs/architecture/spikes/P01B_Workflow_Parity_Report.md` | Real Mastra and LangGraph parity | 2026-08-09 | `HISTORICAL` | Both comparators passed isolated parity but proved zero production Ashley LOC retirement. No adoption authorization. |
| P-01 Foundation Selection Evidence | `docs/architecture/spikes/P01_Foundation_Selection_Evidence.md` | Final `KEEP CURRENT` decision | 2026-08-09 | `SUPPORTING` | Controls the completed P-01 foundation comparison. It does not cancel the later Restate/Temporal/DBOS Operational Continuity spike. |
| P-01 Overnight Final Report | `docs/architecture/spikes/P01_Overnight_Final_Report.md` | First partial overnight run | 2026-08-09 | `SUPERSEDED` | Preserves the initial stopped LangGraph run. Later P-01B evidence completed the comparison. |
| P-02 Agent Plugins Conformance Report | `docs/architecture/spikes/P02_Agent_Plugins_Conformance_Report.md` | Inert parser and quarantine conformance | 2026-08-09 | `HISTORICAL` | Parser spike passed. Runtime, MCP activation, trust, and policy authority were not authorized. |

## 6. Wave and boundary evidence

| Title / family | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| Boundary 2–7 architecture reviews | `docs/handoffs/boundary-2-thought-output-review.md`, `boundary-3-expression-rendering-review.md`, `boundary-4-identity-cleanup-review.md`, `boundary-5-mind-state-cleanup-review.md`, `boundary-6-thought-completion-review.md`, `boundary-7-context-transport-review.md` | Ownership-boundary reviews | 2026-08-03 | `HISTORICAL` | Important provenance for Thought, Expression, Rendering, Identity, Mind State, and ContextComposer boundaries. |
| Wave 06–10 design and gate packets | `docs/handoffs/` (pre-publication history) | Per-wave design and acceptance evidence | 2026-08-04 | `HISTORICAL` | Exact wave evidence only. `Wave_accepted` is not release-qualified, deployed, or promoted. |
| Waves 00–05 Implementation Record | `docs/handoffs/waves-00-05-implementation-record.md` | Early nuclear implementation | 2026-08-04 | `HISTORICAL` | Provenance for early implementation. Current source wins. |
| Wave 2 Provenance Gate Packet | `docs/handoffs/wave-2-provenance-gate-packet.md` | Provenance and time-shift isolation | 2026-08-08 | `HISTORICAL` | Evidence for its stated wave and status only. |
| Wave 4 Counterfactual Non-Interference Report | `docs/handoffs/wave-4-counterfactual-noninterference-report.md` | Offline non-interference qualification | 2026-08-08 | `HISTORICAL` | Offline qualification only. Not live promotion evidence. |
| Promotion Readiness Remediation Report | `docs/handoffs/promotion-readiness-remediation-report.md` | Promotion remediation evidence | Earlier rollout | `HISTORICAL` | Use only for its exact evaluated build and gates. |
| Wave 4 Kilo Handoff | `docs/handoffs/wave-4-kilo-handoff.md` | Worker handoff | Earlier rollout | `REFERENCE` | Handoff context, not current authority. |
| Sandbox V2 M5 local settlement | `docs/handoffs/m5-local-settlement.md` | M5 independent review and local verification packet | 2026-08-23 | `HISTORICAL PREDECESSOR EVIDENCE` | Records the earlier local state. M5 was later production accepted at exact candidate `48bad019fe601d5c871a54dd9902879862c6e96a`. |
| Sandbox V2 M6 design handoff | `docs/handoffs/m6-design-handoff.md` | Frozen M6 question after M5 local settlement | 2026-08-23 | `SUPPORTING` | Restates roadmap §14. Does not authorize M6 implementation by itself. |
| Sandbox V2 M6 local settlement | `docs/handoffs/m6-local-settlement.md` | M6 independent review and local verification packet | 2026-08-23 | `HISTORICAL PREDECESSOR EVIDENCE` | Records the earlier local state. M6 was later production accepted at exact candidate `48bad019fe601d5c871a54dd9902879862c6e96a`. |
| Sandbox V2 M7 design handoff | `docs/handoffs/m7-design-handoff.md` | Frozen M7 `patch_export` question after M6 local settlement | 2026-08-23 | `SUPPORTING` | Restates roadmap §15. Does not authorize M7 implementation by itself. |
| Sandbox V2 M7 local settlement | `docs/handoffs/m7-local-settlement.md` | M7 `patch_export` independent review and local verification packet | 2026-08-23 | `HISTORICAL PREDECESSOR EVIDENCE` | Records the earlier local state. The named `patch_export` profile was later production accepted at exact candidate `48bad019fe601d5c871a54dd9902879862c6e96a`; no broader M7 profile follows from that acceptance. |
| M-series local freeze | `docs/handoffs/m-series-local-freeze.md` | Local M3–M7 implementation-track freeze | 2026-08-23 | `HISTORICAL PREDECESSOR EVIDENCE` | Local predecessor to the later exact-candidate Mint campaign and production acceptance. |
| M-series Mint campaign plan | `docs/handoffs/m-series-mint-campaign-plan.md` | Coordinated Mint campaign order | 2026-08-23 | `EXECUTED PLAN / HISTORICAL` | Execution provenance only. Current acceptance comes from the exact-candidate records below. |
| Cognitive Maturation C1–C5 production acceptance | `docs/handoffs/COGNITIVE_MATURATION_C1_C5_PRODUCTION_ACCEPTANCE.md` | Production deployment and observe-ceiling acceptance | 2026-08-27 | `EXACT-CANDIDATE PRODUCTION EVIDENCE` | Bound to functional SHA `09b73fbb180234a2ac7056756fc339083735f40e` on host QXY. C1–C5 deployed and accepted; each remains `observe` / unpromoted / non-live. Not promotion authority. |
| C1 Qualification Bootstrap implementation settlement | `docs/handoffs/C1_QUALIFICATION_BOOTSTRAP_IMPLEMENTATION.md` | Functional C1 qualification-bootstrap implementation evidence and focused/full verification boundary | 2026-08-27 | `EXACT-CANDIDATE IMPLEMENTATION EVIDENCE` | Bound to functional SHA `f3da03db…` and settlement descendant `23d7c418…`. Focused tests and build are recorded; full-corpus failures are recorded. It is not production qualification, deployment, promotion, or cutover authority. |
| C1 Qualification Bootstrap independent differential review | `docs/handoffs/C1_QUALIFICATION_BOOTSTRAP_INDEPENDENT_REVIEW.md` | Independent review of the exact C1 implementation range and settlement | 2026-08-27 | `EXACT-CANDIDATE REVIEW EVIDENCE` | Verdict `ACCEPT_WITH_NONBLOCKING_NOTES`; blocking findings `0`; candidate regressions `0`. It records nonblocking notes and does not become architecture or lifecycle authority. |
| Sandbox V2 production closure | `docs/handoffs/SANDBOX_V2_PRODUCTION_CLOSURE_48bad019fe60.md` (filename identity; packet is not in this `e36613b` integration tree) | Exact-candidate M1–M7 production closure | 2026-08-23 | `EXACT-CANDIDATE PRODUCTION EVIDENCE` | M1–M7 production accepted at `48bad019fe601d5c871a54dd9902879862c6e96a`; M7 is limited to named `patch_export`. Does not grant live apply, Git, deployment, network, self-change, or general engineering authority. Not the MF-M1 source baseline. |
| Sandbox V2 M5/M6/M7 production acceptance | `M5_PRODUCTION_ACCEPTANCE_48bad019fe60.md`, `M6_PRODUCTION_ACCEPTANCE_48bad019fe60.md`, `M7_PRODUCTION_ACCEPTANCE_48bad019fe60.md` (filename identity; packets are not in this `e36613b` integration tree) | Per-milestone physical qualification, promotion, witness, and acceptance | 2026-08-23 | `EXACT-CANDIDATE PRODUCTION EVIDENCE` | Bound to `48bad019fe601d5c871a54dd9902879862c6e96a`. Each record retains its own capability and authority scope. |

## 7. Explicitly historical design handoffs

| Title / family | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| Ashley Antigravity handoff | `docs/handoffs/ashley-antigravity-2026-08-01/` (pre-publication history) | Early questions, wave plan, Curiosity expansion | 2026-08-01 | `SUPERSEDED` | Preserves early architecture discussion. It is not the current roadmap. |
| Ashley Persona Strategy handoff | `docs/handoffs/ashley-persona-2026-08-01/` (pre-publication history) | Persona, voice examples, and early wave plan | 2026-08-01 | `SUPERSEDED` | Voice-related and phase-order claims are historical. Text foundation and canonical roadmap now govern. |
| Vision Drafting Prompt | `docs/VISION_DRAFTING_PROMPT.md` | Input used to draft the Vision | Vision drafting era | `HISTORICAL` | Provenance only. `VISION.md` is authoritative. |
| Constitution architecture-review prompt | `docs/history/Ashley_Constitution_Architecture_Review_Prompt.md` | Fenced review-prompt form that previously occupied the constitutional slot | Relocated 2026-08-27 | `HISTORICAL` | Provenance only. `Ashley_Constitution.md` is authoritative. Not an executable review contract. |
| Cursor Review Protocol | `docs/Cursor_Review_Protocol.md` | External review procedure | Earlier tooling era | `REFERENCE` | Procedure only. It does not outrank Architecture Review or Wave Acceptance. |

## 8. Implementation plans and specifications

| Family | Path | Topic | Era / date | Status | Frozen relevance |
|---|---|---|---|---|---|
| Superpowers design specifications | `docs/superpowers/specs/` (pre-publication history) | Autonomy plumbing, INIT-03, offline harness, isolation qualification path | 2026-08-09 to 2026-08-12 | `HISTORICAL` | Approved or proposed design inputs for their named work only. They do not define current global roadmap status. |
| Superpowers implementation plans | `docs/superpowers/plans/` (pre-publication history) | Task-level implementation instructions | 2026-08-09 to 2026-08-12 | `HISTORICAL` | Execution records and plans. Current source and canonical roadmap win. |
| Cognitive Architecture v0.2.1 (focused accepted contract) | [`docs/architecture/cognitive/Ashley_Cognitive_Architecture_v0.2.1.md`](cognitive/Ashley_Cognitive_Architecture_v0.2.1.md) | Owner-accepted Thought/Agency split; points at the implementation packet | 2026-08-29 | `ACCEPTED ARCHITECTURE / IMPLEMENTED IN CURRENT SOURCE` | Thought/Agency semantic split as implemented in current source. Present implementation status lives in exact source; qualification, deployment, and production claims live in bound evidence. Outranks historical glossary/Constitution-Agency/Cross-Phase “Agency decides meaning” wording for this reconstruction. |
| Cognitive rework v0.2.1 implementation packet | `docs/cognitive-rework/v0.2.1/README.md` (pre-publication history; not in current tree) | Sidecar kernel specification, phase plans, qualification, cutover, live evidence, Luna Max handoff | 2026-08-29 | `ACCEPTED ARCHITECTURE / IMPLEMENTATION PLANNED` | Packet R5 awaiting independent review. Architecture accepted; implementation planned. Gate A UNSET until R5 PASSES. Bind uses PACKET_BIND_MANIFEST (exact new files + three-way overlay). Does not authorize production cognitive change. Software contracts `02` + `04`. Luna cannot declare `PRODUCTION_ACCEPTED`. |

## 9. Known conflicts and dispositions

Frozen 2026-08-27 campaign evidence (2026-08-29 repairs noted inline).
Where a row below conflicts with a later Wave-1 role — the Routing
resolution guide (no occupant values in its body), this index as a frozen
map rather than a maintained ledger — the later role governs and the row
remains as provenance of what was decided then.

| Document claim | Conflict | Current disposition |
|---|---|---|
| `Ashley_Foundation_Architecture_Decision_v1.md`: implementation not started and P-01 still next | P-01A/P-01B/P-01C evidence now exists. | Document is `HISTORICAL`. The semantic ownership decision remains supporting. |
| `Ashley_Architecture_Salvage_Map_v2.md`: Restate and Temporal rejected for the current foundation | Operational Continuity later reopened durable execution as Restate versus Temporal versus DBOS. | The old foundation-cycle rejection remains provenance. The future comparative spike is current. |
| `P01_Overnight_Final_Report.md`: LangGraph parity not executed | Later narrow authorization completed real LangGraph parity. | Initial report is `SUPERSEDED`; use `P01B_Workflow_Parity_Report.md` and `P01_Foundation_Selection_Evidence.md`. |
| `Sandbox_Status.md`: physical isolation qualification had not passed | Sandbox V2 M1–M7 later became production accepted at exact candidate `48bad019fe601d5c871a54dd9902879862c6e96a`; M7 is limited to `patch_export`. | Treat `Sandbox_Status.md` as a dated prequalification snapshot. Use the exact-candidate production closure for current maturity. |
| Earlier indexes: `Sandbox_Design.md` is the current authoritative Sandbox topology | Current V2 source uses direct, unprivileged Bubblewrap and does not route through the V1 broker. | The V2 M-series roadmap is authoritative for current Sandbox direction. V1 broker documents are historical or reference-only. |
| `Model_Fabric_01_Contract_Draft.md` header previously read as the current phase owner | Canonical names omit `-01`. Semantic ownership moved to `Model_Fabric_Architecture.md`. | The `_01_` contract remains a supporting field specification reconciled for MF-M1. Historical filename is retained. |
| Retired Wave 09 external-agency design as current external-action architecture | Generic external-effect authority is broader than Computer Use and is not a child of the V1 broker. | `External_Effect_and_Authority_Architecture.md` is the current cross-cutting owner. Wave 09 material is salvageable semantics only. |
| `Routing_Status.md` and earlier indexes as complete `models.json` authority | Current dispatch is split across config, purpose mapping, and registry. | Living status must be refreshed from source. Model IDs stay in Routing Status. Model Fabric owns future semantic dispatch. |
| 2026-08-01 handoffs: voice and older phase order | Current roadmap is a delivery map plus classified edges: the Sandbox gate closed through named M7 `patch_export`; Model Fabric is current by owner-selected order, not semantic derivation; operational spine, cognitive-growth, and attention tracks remain distinct; Cognitive and Relational Graduation remain siblings. | Handoffs are `SUPERSEDED` as roadmap sources and preserved as provenance. Historical research may still use `-01` labels. |
| Evaluation plane header: “this document proposes architecture” | Document Index classified the plane as `AUTHORITATIVE`. | Header repaired in this pass: plane is `AUTHORITATIVE`; implementation is still not authorized. Historical reconnaissance SHA remains historical. |
| Architecture Index Schema v9/v10 and planned model IDs as current-facing facts | Source-derived schema and Routing Status own those values. Cross-Phase current-fact policy forbids copying them into implementation maps. | Replaced with pointers to `db.ts` and Routing Status. Historical schema discussion remains in wave packets. |
| Sandbox V2 umbrella: Wave 09 external-agency material is `SEPARATE ARCHITECTURE` | External Effect and Authority is the current cross-cutting owner. Wave 09 material is salvageable semantics / superseded mechanism. | Umbrella row repaired in the hardening pass. |
| Sandbox V2 umbrella §17.3 exact SHA `042f211...` as current gate truth | Exact SHA and qualification/promotion state are packet or production claims, not timeless architecture. | §17.3 records the predecessor rule only. Live maturity is resolved from Git/source/packets/production observation. |
| Routing Status snapshot SHA moved without a route-table audit | A snapshot SHA is not an audit of route bindings. | 2026-08-25: route-table re-audit/confirmation at canonical baseline `e36613b…`; audited route-binding inputs were unchanged from `8eedad8…` to `e36613b…`. A 2026-08-25 research pass had used `04beaf1…`. Source remains authoritative. |
| Data-plane maturity copied into Cross-Phase | Cross-Phase is architecture, not a dashboard. | Volatile `COMMITTED` / `DEPLOYED` / `PRODUCTION_ACCEPTED` / SHA / timestamp removed from Cross-Phase §2.2. Resolve implementation maturity live. |
| Committed `Ashley_Current_State.md` as where-we-are index | A committed status dashboard goes stale whenever HEAD, worktree, deployment, qualification, promotion, or owner-selected work changes. | File deleted. Live state resolution lives in AGENTS and this index. No replacement dashboard. |
| Root-level qualification packets and V1 activation reconnaissance | Packets and `Sandbox_Final_Activation_Path_Reconnaissance.md` can be read as current V2 activation or current HEAD qualification. | Packets remain `UNTRACKED WORKING EVIDENCE / NOT AUTHORITY`. V1 activation reconnaissance is bannered historical. |
| `Ashley_Glossary.md` Agency as the process that decides whether, when, and how Ashley acts | v0.2.1 freezes Thought as semantic author and Agency as executive mechanics. | **Repaired 2026-08-29.** Glossary Agency/Thought entries and the focused contract govern. Historical wording is superseded for cognitive reconstruction. |
| `Ashley_Glossary.md` omits Mind State, Thought, Reflection | Freeze and Cross-Phase list those as cognitive owners. | Thought added 2026-08-29. Mind State remains largely under glossary State; freeze/Cross-Phase still own occupancy vs identity. |
| Glossary Identity includes “behavioral tendencies” | Freeze splits stable Identity from dynamic Mind State. | Prefer freeze/Cross-Phase for ownership. Glossary repair is separate. |
| Architecture Freeze: “Ashley does not need anything new” as a cognitive faculty | 2026-08-25 metacognition planning names a *cross-cutting policy profile* with mechanisms owned elsewhere. | Pass-3 accepted: not a freeze-map owner. Do not treat `Ashley_Metacognition_Architecture.md` as a freeze-map amendment. A later Freeze amendment would require an independently owned lifecycle that existing owners cannot express. **2026-08-29:** v0.2.1 is maturation of existing Thought/Agency owners, not a new faculty. |
| Cross-Phase cells: meaning / initiative “through Agency” | v0.2.1 Thought is sole semantic author. | **Superseded 2026-08-29** for semantic authorship. Agency remains executive admission/dispatch. See focused v0.2.1 contract. |
| Constitution §Agency as a decision layer outranking Thought | v0.2.1 split. | **Bannered 2026-08-29.** Constitution identity/ethics unchanged. Semantic authorship is Thought. |
| v0.2.1 packet indexed as `FUTURE / PLANNED` | Owner accepted the architecture as implementation target. | **Repaired 2026-08-29** to `ACCEPTED ARCHITECTURE / IMPLEMENTATION PLANNED`. Still not implemented/qualified/deployed/production accepted. |
| Roadmap §5.6 previously labeled Sandbox `CURRENT WORK` while §3 named Model Fabric as owner-selected current delivery | Phase-contract register vs live delivery sentence. | §5.6 repaired 2026-08-27: Sandbox is a closed dated gate; Model Fabric is current mechanism delivery; C1–C5 are implemented / production-accepted / observe / unpromoted / non-live. §5.6 is still not a dashboard. |
| C1 Qualification Bootstrap settlement initially stated `IMPLEMENTED / TESTED` | The required full offline corpus failed as a whole even though the focused C1 evidence and build passed. | Settlement header corrected to `IMPLEMENTED / FOCUSED-TESTED — FULL CORPUS FAILURES RECORDED`; independent review is recorded separately as `ACCEPT_WITH_NONBLOCKING_NOTES`. |

## 10. Preservation rule

Historical and superseded documents remain accessible. Do not delete or
rewrite their original reasoning merely to make them look current. Add a short
status/scope banner only when historical material is likely to be mistaken
for present authority. Resolve present authority through the applicable
fact-kind owner and AGENTS routing rules. This frozen index is not updated
to record present document status.
