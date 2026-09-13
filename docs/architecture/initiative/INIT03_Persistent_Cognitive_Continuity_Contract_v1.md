# Project Ashley — INIT-03 / Persistent Cognitive Continuity and Motivation Surface

## Contract status

Status: approved for local implementation through Wave 12; INIT-03 Sol
Remediation Round 3 is locally source-qualified. A fresh independent Sol High
closure audit remains required before acceptance.

Scope: repository-local implementation, deterministic offline qualification, and documentation.

This contract does not authorize production writes, production migrations, Mint changes, deployment, promotion, Recall mutation, sandbox execution, MCP execution, provider changes, routing changes, or external publication.

The contract is derived from the supplied INIT-03 implementation text and
current repository evidence inspected on 2026-08-10.

## Purpose

Ashley needs durable continuity for unresolved cognitive material without converting continuity into pressure, engagement optimization, fake relationship scoring, or a second semantic authority.

INIT-03 adds a bounded persistent inventory of unresolved cognitive items and connects that inventory to the existing cognition, agency, Thought, relationship, provenance, forget, delay, and Reflection seams.

The implementation MUST preserve semantic ownership:

- source records remain authoritative for their own facts, commitments, reminders, curiosity, identity, relationship, and state semantics;
- deterministic SQLite materialization is authoritative for persisted Open Cognitive Items;
- Attention Governor scheduling remains operational scheduling;
- motivation projections remain transient per-wake candidates;
- Thought and model output remain advisory and MUST NOT write semantic state directly;
- Forget, provenance, capability, and owner boundaries remain authoritative at their existing owners.

## Governing constraints

The governing authority chain is:

1. VISION.md;
2. Ashley Core Principles;
3. Ashley Constitution;
4. relevant Stewardship, Ethics, and Hierarchy documents;
5. accepted architecture and initiative contracts.

INIT-03 MUST NOT weaken reciprocal relationship constraints, refusal, grounded continuity, source truth, owner authority, withdrawal, consent, provenance, or the existing Thought/material floor.

The initiative MUST NOT:

- lower the proactive score floor or make Ashley more talkative as a shortcut;
- use timers, randomness, or engagement optimization as a substitute for continuity;
- use or repurpose scheduled_proactive_messages as OCI or motivation storage;
- create care, attachment, relationship-health, or engagement scores;
- store raw source text, chain-of-thought, raw model reasoning, prompt fragments, or unbounded conversation history in OCI;
- let an originator, model, plugin, framework, MCP server, or scheduler become persistence authority;
- assert that a mutual commitment was fulfilled by the existence of an OCI;
- rewrite Identity, Recall, relationship truth, provenance, capability state, or external truth;
- turn shadow evidence into live evidence by time passing;
- introduce a production capability, production migration, sandbox/MCP path, provider path, routing path, or Recall promotion path.

## Historical baseline repository evidence before INIT-03

The original INIT-03 baseline record is retained here as historical evidence.
It is not the Round-2 starting state.

- checkout: C:/Users/Xharv/Projects/composer-assistant;
- branch: master;
- HEAD: 7d686f4d384da97b1d4d00fb26dedf95b82bbdce;
- origin/master: 7d686f4d384da97b1d4d00fb26dedf95b82bbdce;
- pre-existing dirty path: AGENTS.md only;
- nuclear schema version: 22;
- current proactive decision/material floor: 25;
- current Attention Governor lanes: interactive, urgent_grounded, exchange_cognition, curiosity_maintenance.

The next schema migration is v23. Existing behavior has no durable OCI inventory.

The current agency motivation reader already reads questions, curiosity takes, facts, opinions, ordinary unfinished material, Mind State items, Identity boundaries, and due reminders. It has additional callback, own-time, relationship, and capability seams elsewhere in the runtime. INIT-03 MUST extend verified seams without creating duplicate semantic records.

The current runtime has atomic proactive reservation and delivery. INIT-03 MUST preserve that transaction boundary and MUST NOT treat delivery success as semantic resolution.

The current Reflection initiative seam learns from proactive outcomes. INIT-03 MAY add bounded unresolved-item review requests to that seam, but MUST NOT replace or weaken existing outcome learning.

## Round-2 starting baseline

The verified local Round-2 baseline was:

- checkout: C:/Users/Xharv/Projects/composer-assistant;
- branch: master;
- starting HEAD: 3f105ace68f14bc0e63d94806964b0800f28f8c4;
- origin/master: 7d686f4d384da97b1d4d00fb26dedf95b82bbdce;
- pre-existing dirty path: AGENTS.md only, unstaged;
- local-only scope: no Mint, production, Recall mutation, sandbox activation,
  provider call, Discord traffic, routing change, deploy, or push.

## Round-3 starting baseline

The verified local Round-3 baseline was:

- checkout: C:/Users/Xharv/Projects/composer-assistant;
- branch: master;
- starting HEAD: 40892200159c4536cb73379562d4f9d32d80560e;
- origin/master: 7d686f4d384da97b1d4d00fb26dedf95b82bbdce;
- pre-existing dirty path: AGENTS.md only, unstaged;
- local-only scope: no Mint, production, Recall mutation, sandbox activation,
  provider call, Discord traffic, routing change, deploy, or push.

## As-built local evidence after Wave 12 and Sol Remediation Round 3

The verified local implementation state is:

- checkout: C:/Users/Xharv/Projects/composer-assistant;
- branch: master;
- source and qualification HEAD before remediation documentation: 1f6bb21;
- origin/master: 7d686f4d384da97b1d4d00fb26dedf95b82bbdce;
- pre-existing dirty path preserved: AGENTS.md only;
- nuclear schema version: 25;
- OCI tables: `open_cognitive_items`, `open_cognitive_item_attention`, and `open_cognitive_item_transitions`;
- OCI cursor tables: `open_cognitive_item_wake_cursor` and
  `open_cognitive_item_review_cursor`;
- OCI kinds: `question`, `revisit`, `concern`;
- OCI statuses: `OPEN`, `RESOLVED`, `WITHDRAWN`, `SUPERSEDED`;
- proactive score/material floor: 25, unchanged;
- proactive OCI projection: at most 8 owner-scoped rows per wake; the bounded selector scans at most 128 rows across at most 4 pages of 32; reactive motivation selection remains capped at 12 candidates;
- wake review check: at most 32 owner-scoped OPEN OCI rows are selected through
  `idx_open_cognitive_items_owner_status_id` before Attention review metadata
  is checked by item primary key. Rich OCI enumeration is reserved for
  explicit owner diagnostics;
- model-derived OCI provenance: contract and build identity are captured in
  the durable attention ledger when dispatch becomes running, before provider
  completion. The accepted identity then carries route, resolved model, model
  epoch, contract, build, owner, job, and dispatch sequence through worker
  materialization;
- OCI semantic identity: host-derived semantic identity is separate from
  continuity generation. A DB-global generation order is allocated before
  asynchronous provider completion and shared with non-cognition materializers.
  Late stale generations persist as superseded and cannot displace a newer
  current generation;
- ordinary scheduler preflight: owner-authenticated bounded
  `/initiative/operational-status`; rich `/initiative/status` remains an
  explicit owner-diagnostics surface;
- Reflection review: successful model-backed Reflection is advisory and can
  propose KEEP, WITHDRAW, or SUPERSEDE. Deterministic OCI transition
  validation remains final authority. Invalid/currently permanent requests
  are quarantined without changing OCI semantic status. Transient adjudicator
  failures retry after 15 minutes and 60 minutes, then quarantine on attempt 3;
- migration recovery: v23/v24/v25 target finalization validates schema content,
  including tables, columns, inspectable constraints, required indexes, and
  cursor tables. `PRAGMA user_version` alone is insufficient. Recovery tests
  cover failure before pending, after pending, during DDL, after nuclear
  commit, during and after sidecar update, and before finalization;
- full qualification: `npm test` passed with 118 test files, 864 passed, and
  1 skipped; `npm run phase0:offline` passed with the same result and zero
  external-network attempts;
- focused Round-3 blocker replay: 7 agent test files, 64 tests passed. The
  Discord suite passed 74 tests, including a scheduler-to-local-HTTP-to-real-
  runtime-to-real-SQL integration test. The closed-regression bundle passed
  57 tests;
- agent-service and discord-bot builds: passed;
- production, Mint, Recall promotion, deployment, provider calls, Discord traffic, and push: none.

The schema-23 migration was introduced by the OCI foundation before the final
qualification waves. The v23, v24, and v25 nuclear migrations now use a recognized
pending-migration protocol with startup recovery and fail-closed version and
schema-content handling. The qualification inventory classifies both OCI
cursor tables as control-plane state, not live semantic state.

The Round-3 remediation repaired dispatch-bound contract/build provenance,
pre-completion monotonic generation ordering, raw-first bounded wake selection,
owner-scoped review work, bounded retry/quarantine semantics, and direct
scheduler/database qualification. It also preserved the earlier remediation's
host-owned semantic identity, migration schema-content recovery, and diagnostic
capability classification. These repairs preserve source authority, the existing
Thought/material floor, the four-layer model, and the local-only scope.

## Four-layer model

### Layer 1: source records

Source records are the existing authoritative records:

- questions and question state;
- curiosity takes;
- facts and opinions;
- ordinary unfinished material;
- Mind State items;
- Identity boundaries and curiosity;
- document reminders;
- callbacks and own-time grounded records;
- Ashley self-commitments;
- mutual commitments;
- relational tensions;
- withdrawal records;
- current provenance and forget state.

INIT-03 MUST NOT copy source semantics into a second authoritative table.

### Layer 2: persistent Open Cognitive Items

An OCI is a bounded semantic inventory entry for a source-grounded unresolved question, revisit, or concern.

OCI kinds are exactly:

- question;
- revisit;
- concern.

OCI statuses are exactly:

- OPEN;
- RESOLVED;
- WITHDRAWN;
- SUPERSEDED.

DEFERRED MUST NOT be introduced as an OCI status. Delay is attention metadata.

An OCI MUST be owner-scoped and MUST include:

- owner_id;
- kind;
- bounded semantic_summary;
- source_type;
- source_id;
- entity_uuid;
- deterministic owner-scoped semantic/idempotency key;
- source capability and contract context;
- provenance class and source epoch/version where applicable;
- build identity and model identity/epoch where applicable;
- created_at and updated_at;
- current status;
- attention metadata reference or fields;
- transition reason and bounded transition timestamps.

The semantic summary MUST be sufficient to identify the bounded unresolved conclusion without storing a prompt or raw reasoning trace.

The persisted record MUST NOT contain:

- source_text;
- raw conversation history;
- prompt fragments;
- chain-of-thought;
- raw model reasoning;
- unbounded entities or metadata;
- sensitive plaintext in a logged or indexed semantic key.

### Layer 3: attention metadata

Attention metadata stores operational reconsideration state for an OCI:

- delay class;
- defer_until;
- bounded delay reason;
- reconsideration count;
- review-request state;
- last reconsidered time.

Attention metadata MUST NOT redefine OCI semantic status.

The Attention Governor remains the runtime/model/resource scheduler. Candidate bands introduced for INIT-03 are a separate deterministic selection concept.

### Layer 4: transient motivation projection

Every wake MAY construct bounded motivation projections from source records and eligible OPEN OCI rows.

Motivation projections MUST be transient per wake. They MUST NOT become a second persistent motivation authority.

The existing motivations table MAY retain existing runtime learning/diagnostic behavior. INIT-03 MUST NOT use it as the durable OCI inventory and MUST avoid recording duplicate semantic source rows merely because a projection was built.

## Proposal and materialization contract

Cognition, Reflection, or another accepted origin seam MAY emit an OpenCognitiveItemProposal.

The proposal MUST contain only bounded semantic fields:

- owner_id;
- kind;
- bounded semantic summary;
- source type;
- source id;
- entity_uuid;
- origin metadata;
- provenance;
- source capability context;
- contract/build identity;
- model identity/epoch if the source is model-derived.

Origin is not persistence authority.

`semanticKeyMaterial` is not part of the normative semantic proposal contract.
The retained optional compatibility field is legacy input only. Host code
ignores it when deriving durable identity.

The deterministic materializer MUST validate:

- owner scope;
- exact kind;
- source existence;
- source ownership;
- entity_uuid correspondence;
- source capability and contract state;
- provenance and live/shadow separation;
- forgotten, redacted, or detached source state;
- bounded summary and classification;
- deterministic key construction;
- build and model continuity;
- transaction and uniqueness constraints.

The materializer MUST be the only normal path that creates or merges durable OCI rows.

## Idempotency and identity

The key is owner-scoped and deterministic.

Semantic identity MUST distinguish:

- source type;
- source id;
- entity_uuid;
- normalized OCI kind;
- normalized bounded semantic conclusion;
- source semantic version or equivalent stable source revision where required.

The persisted/indexed key MUST be a stable digest or otherwise non-sensitive representation. Sensitive semantic plaintext MUST NOT appear in logs, diagnostics, or indexes.

Semantic identity and continuity generation are separate:

- semantic identity represents the unresolved cognitive meaning: owner, source,
  entity, kind, normalized bounded conclusion, and authoritative source
  revision;
- continuity generation represents the valid representation source: contract,
  build identity, host-derived model identity, and model epoch;
- generation order is assigned from a DB-global monotonic order. Cognition uses
  its accepted dispatch order, established before provider completion. Other
  origins allocate after the greatest accepted dispatch or persisted OCI order;
- the durable idempotency key combines both values;
- the same semantic identity and generation converge to one row;
- a newer valid generation creates an explicit current successor and
  supersedes the older generation;
- an old generation MUST NOT regain influence;
- reusing a model identity at a later epoch is a new generation.

Two distinct questions from one source are allowed when their normalized semantic conclusions differ. Repeated creation of the same owner/source/entity/kind/conclusion MUST converge on one OCI under concurrent writers.

The current materializer also requires the authoritative current source revision
where the source contract provides one. A stale open OCI for the same source
identity is atomically superseded rather than returned as a permanently
ineligible row. Model-derived cognition carries a host-derived model identity
and model epoch; human/database-owned source state is not made model-sensitive
without an applicable continuity contract.

## Status transitions and agency

Allowed normal transitions are:

- OPEN to RESOLVED;
- OPEN to WITHDRAWN;
- OPEN to SUPERSEDED.

The implementation MAY define narrowly justified re-opening behavior only if the existing source contract requires it and the transition is explicit, owner-scoped, and tested. Silent re-opening is prohibited.

Ashley may resolve an OCI only through validated local transitions. Ashley MUST NOT use OCI resolution to:

- assert external truth;
- claim that a mutual commitment was fulfilled;
- rewrite relationship state;
- rewrite Identity;
- rewrite Recall;
- rewrite provenance;
- promote a capability;
- bypass withdrawal or owner authority.

Invalid, cross-owner, source-mismatched, forgotten, or stale transitions MUST fail closed.

## Source producer matrix

The matrix is a contract for source adjudication. Each wave MUST record the actual implementation disposition.

| Source | Current evidence | INIT-03 disposition |
| --- | --- | --- |
| Existing questions | Read by current motivation collection | ALREADY WIRED; add OCI linkage without duplicate semantic candidates |
| Curiosity takes | Read by current motivation collection | ALREADY WIRED; preserve decay and curiosity capability |
| Facts and opinions | Read by current motivation collection | ALREADY WIRED; preserve source semantics |
| Ordinary unfinished | Read by current motivation collection | ALREADY WIRED; preserve current bounds |
| Mind State items | Read by current motivation collection | ALREADY WIRED; preserve activation/urgency semantics |
| Identity boundaries | Used as a refusal/boundary source | GATE ONLY unless a verified curiosity source exists |
| Identity curiosity | Not fully represented in current proactive reader | PARTIAL; add only through the owning Identity/source seam |
| Document reminders | Current due-reader exists | ALREADY WIRED; preserve relationship claim and due gate |
| Callbacks | Existing grounded callback/runtime seam exists | PARTIAL; project only verified grounded callbacks |
| Own-time grounded report | Reactive seam exists | PARTIAL; do not manufacture unattended continuity |
| Ashley self-commitments | Schema exists; current proactive reader is absent | DISCONNECTED; add bounded self-owned continuity projection |
| Mutual commitments | Schema and relationship claim seam exist; current proactive reader is absent | DISCONNECTED; add conservative bilateral continuity projection |
| Relational tensions | Schema exists; no proactive reader | DISCONNECTED; concern only with relationship capability and low band/cap |
| Withdrawal records | Existing gate exists | ALREADY WIRED as a gate; never use withdrawal as pressure evidence |
| Reconnection | Relationship source exists only where verified | GATE ONLY or PARTIAL; low-band, bounded, capability-gated |
| scheduled_proactive_messages | Schema exists | SCHEMA ONLY; do not use as OCI or motivation source |
| Attention Governor | Runtime scheduling exists | NOT SEMANTICALLY APPROPRIATE as OCI semantic authority |
| Existing motivations | Transient/projection and learning behavior exists | NOT SEMANTICALLY APPROPRIATE as durable OCI storage |

The matrix MUST be updated only with current evidence. A source marked DISCONNECTED is not permission to invent a new authority table.

## Capability and relationship boundaries

The initial design uses existing source capability composition:

- source capability contract;
- apply/observe mode;
- active capability state;
- direct dependency state;
- provenance and shadow predicates;
- withdrawal and owner gates.

No new OCI capability is required for the initial implementation.

Relationship-originated candidates MUST remain conservative:

- self-commitments may represent Ashley-owned continuity;
- mutual commitments may represent an unresolved bilateral continuity object, not fulfillment;
- tensions may produce only a bounded concern under the relationship contract;
- reconnection may produce only a low-band bounded candidate;
- withdrawal suppresses relationship initiative;
- no candidate may create pressure, guilt, escalation, or repeated unwanted contact.

## Candidate selection

Candidate selection MUST be deterministic and bounded.

It MUST:

- preserve current eligibility and material floors;
- cap candidate count and summary length;
- deduplicate source and OCI representations;
- preserve source diversity where eligible;
- prefer current source truth over stale projections;
- select at most one proactive candidate per wake;
- keep model selection advisory and validate returned identifiers.

Candidate bands MUST NOT be interpreted as care, attachment, relationship health, or engagement scores.

The current proactive OCI selector uses indexed owner-scoped raw pages of 32
rows before Attention filtering, at most 4 pages and 128 scanned rows per wake,
a persistent id cursor, and a maximum of 8 returned items. Eligibility is
checked before final selection, and
the cursor wraps to preserve deterministic fairness. `EXPLAIN QUERY PLAN`
confirms use of the owner/status/id index without a whole-population temporary
sort. Review-due existence/count starts from at most 32 owner-scoped OPEN OCI
rows through the same owner/status/id index, then checks Attention by item
primary key. Cross-owner inventories therefore cannot multiply the work. This
bound is separate from the Attention Governor, which remains the
runtime/model/resource scheduler.

The ordinary Discord scheduler uses bounded operational status. It MUST NOT
call rich owner status as ordinary preflight, including a no-material wake.
Rich owner status remains available when explicitly requested by the owner.

## Delay and reconsideration

Delay is a semantic decision with bounded operational classes.

The host MUST map each class to a fixed duration. The mapped defer_until MUST be persisted.

Restart MUST preserve defer_until and reconsideration count.

Repeated delay MUST remain bounded. Prolonged unresolved material MUST eventually request bounded Reflection review. The implementation MUST NOT silently expire, delete, demote, or reinterpret an unresolved OCI.

The existing Reflection owner consumes pending review requests through a
persistent newest-to-oldest cursor with an intake cap of 8 requests per run.
Each invocation examines at most four owner-scoped raw pages of 32 OPEN OCI
rows. Invalid transitions and unavailable sources are quarantined immediately.
Unprocessable or failed adjudication retries after host-owned delays of 15
minutes and 60 minutes, then quarantines on attempt 3. These dispositions alter
only operational Attention state; the OCI remains semantically OPEN. KEEP OPEN
clears the review request and applies bounded delay. WITHDRAW and SUPERSEDE
remain validated OCI-owned lifecycle actions. The consumer cannot mutate
relationship truth, Identity, Recall, capability state, or external truth.

## Forget, redaction, and provenance

Forget is authoritative for source availability.

When a source is forgotten, redacted, or detached:

- OCI semantic content MUST become unavailable;
- the current tombstone/redaction convention MUST be used;
- raw sensitive text MUST NOT be retained in the OCI or diagnostics;
- attached attention state MUST NOT resurrect source meaning;
- relationship target cleanup MUST remain atomic where current conventions require it.

Shadow evidence MUST remain shadow. Time, delivery, or successful local processing MUST NOT promote it to live evidence or time-shift it into live continuity.

Model identity, model epoch, build identity, and source revision MUST be
checked where model-derived semantic continuity depends on them. Dispatch
identity is historical provenance; current global model identity at persistence
time is not historical provenance. If continuity changes before persistence, the
accepted result remains attributed to its original dispatch and is non-influential
when stale. Stale proposals MUST be rejected, quarantined, or explicitly
superseded according to the owning contract.

## Diagnostics and qualification

Diagnostics are owner-only.

They MAY report bounded counts, source classes, OCI status, delay/reconsideration state, provenance class, model/build continuity, and transition reasons.

Current owner diagnostics include bounded `unavailableByReason` counts for
deferred, shadow, capability-blocked, source-unavailable, and withdrawn
relationship cases. The diagnostic path uses read-only capability and contract
predicates and does not bootstrap or mutate capability state.

They MUST NOT report raw source plaintext, raw reasoning, prompt fragments, or sensitive key material.

Qualification MUST be deterministic and offline. It MUST cover:

- baseline;
- capability ON/OFF;
- OCI-only;
- source-only;
- isolated shadow;
- offline network refusal;
- forgotten/redacted source;
- withdrawal;
- delay and restart;
- resolution and invalid transitions;
- concurrent duplicate creation;
- dispatch/model continuity mismatch;
- semantic identity versus continuity generation succession;
- indexed SQL `EXPLAIN QUERY PLAN` and bounded row work;
- real scheduler operational-status preflight;
- real scheduler -> operational preflight -> agent tick -> runtime -> SQLite
  wake/review integration with actual database inventory;
- Reflection KEEP/WITHDRAW/SUPERSEDE and invalid-first-page fairness;
- migration target-version/schema-content mismatch;
- adversarial owner/source/entity/capability/key inputs;
- unchanged Thought/material floor.

Local qualification is not production qualification.

## Wave execution and stop gates

Waves are executed in order:

0. contract and plan;
1. OCI schema;
2. proposal/materializer;
3. safe source projections;
4. relationship producers;
5. candidate selection;
6. delay/reconsideration/resolution;
7. provenance/forget/model continuity;
8. diagnostics;
9. offline qualification;
10. adversarial hardening;
11. regression/build verification;
12. qualification report.

The completed Round-2 remediation record is separate from the original Wave
0-12 architecture sequence:

- R2-Wave 1: dispatch-bound model provenance;
- R2-Wave 2: semantic identity plus continuity generations;
- R2-Wave 3: bounded indexed SQL and real scheduler operational status;
- R2-Wave 4: Reflection adjudication and fair review intake;
- R2-Wave 5: schema-content migration recovery;
- R2-Wave 6: qualification truth, regression coverage, and documentation.

The audit history is preserved: initial Luna PASS, first Sol BLOCKED, first
remediation PASS, second Sol BLOCKED, second remediation local PASS, third Sol
BLOCKED (Round-2 Sol High), and this Round-3 remediation's new local evidence.

The completed Round-3 remediation record is:

- R3-Wave 1: dispatch-accepted contract/build provenance;
- R3-Wave 2: pre-completion monotonic generation order;
- R3-Wave 3: raw-first bounded wake retrieval;
- R3-Wave 4: owner-scoped bounded review work;
- R3-Wave 5: bounded review retry/quarantine semantics;
- R3-Wave 6: exact blocker and real scheduler/database qualification;
- R3-Wave 7: full offline qualification and documentation correction.

After each wave:

1. run focused tests;
2. inspect the diff;
3. run git diff --check;
4. verify AGENTS.md is not staged;
5. verify only the named wave paths are changed;
6. create the authorized local commit;
7. stop if a required check fails or authority is unclear.

The initiative MUST STOP before production, Mint, deployment, Recall promotion, sandbox/MCP execution, provider use, or external publication.

## Human gate

After local implementation and qualification, one human gate remains: a fresh
independent Sol High closure audit. INIT-03 acceptance requires that audit.
Any future production or Mint work also requires separate explicit
authorization. INIT-03 itself does not provide that authorization.

STOP.
