# Ashley Architecture Index

Nuclear-only Discord runtime.

Current architectural direction and roadmap status are canonicalized in
[`architecture/Ashley_Architecture_Roadmap.md`](architecture/Ashley_Architecture_Roadmap.md).
Document authority and historical status are indexed in
[`architecture/Ashley_Architecture_Document_Index.md`](architecture/Ashley_Architecture_Document_Index.md).
This file remains the implementation-oriented module and observability map.
Volatile schema integers, model IDs, and milestone maturity are not owned
here. Resolve them live from [`apps/agent-service/src/core/db.ts`](../apps/agent-service/src/core/db.ts),
routing source plus audited [`Routing_Status.md`](Routing_Status.md),
exact-candidate packets, or production observation.

## Governance docs

Authority flows:

```text
VISION.md
  -> Ashley_Core_Principles.md
    -> Ashley_Constitution.md
      -> [Ashley_Stewardship_Compact.md + Ashley_Ethics.md]
        -> Architecture
          -> Prompts
            -> Runtime
```

| Document | Ownership note |
|---|---|
| [`../VISION.md`](../VISION.md) | Why Ashley exists; not a runtime prompt |
| [`Ashley_Core_Principles.md`](Ashley_Core_Principles.md) | Highest constitutional constraints beneath the Vision |
| [`Ashley_Constitution.md`](Ashley_Constitution.md) | Long-form behavioral and architectural direction |
| [`Ashley_Stewardship_Compact.md`](Ashley_Stewardship_Compact.md) | Peer specialized governance: operator authority, consultation, emergency stop, lineage/custody |
| [`Ashley_Ethics.md`](Ashley_Ethics.md) | Peer specialized governance: emotion/leverage, public privacy, credentials, external entities |
| [`Ashley_Hierarchy.md`](Ashley_Hierarchy.md) | Normative order and conflict rule |
| [`Vision_Implementation_Map.md`](Vision_Implementation_Map.md) | Commitment → owner → evidence → failure → status |
| [`Wave_Acceptance_Protocol.md`](Wave_Acceptance_Protocol.md) | Historical Wave ladder plus current M-series acceptance mapping |
| [`architecture/Ashley_Architecture_Freeze.md`](architecture/Ashley_Architecture_Freeze.md) | Frozen owner map, event-term split, and architecture-justified sequence; not a dashboard |
| [`architecture/Ashley_Architecture_Roadmap.md`](architecture/Ashley_Architecture_Roadmap.md) | Canonical direction. §5 converts existing items into engineering milestones from live state. It does not add architecture. |
| [`architecture/Ashley_Milestone_Execution_Governance.md`](architecture/Ashley_Milestone_Execution_Governance.md) | Execution discipline for those milestones. Does not add architecture. |
| [`architecture/Ashley_Cross_Phase_Architecture.md`](architecture/Ashley_Cross_Phase_Architecture.md) | Shared state, authority, evidence, and current-fact laws |
| [`architecture/Ashley_Memory_Evidence_Architecture.md`](architecture/Ashley_Memory_Evidence_Architecture.md) | Accepted memory/evidence semantics, C1 shadow qualification boundary, and sticky currentness rules; current lifecycle status remains in the canonical roadmap and exact-candidate evidence |
| [`architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md`](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md) | Current Sandbox V2 M0-M7 authority, state, truth, and acceptance contracts |
| [`Sandbox_Design.md`](Sandbox_Design.md) | Historical V1 broker threat model, IPC, and hardening; topology superseded for V2 |
| [`architecture/External_Effect_and_Authority_Architecture.md`](architecture/External_Effect_and_Authority_Architecture.md) | Current cross-cutting owner for observation and external effects |
| [`architecture/Ashley_Observability_Plane.md`](architecture/Ashley_Observability_Plane.md) | Telemetry, correlation, redaction, and diagnostic-versus-control boundaries |
| [`Stabilization_Design.md`](Stabilization_Design.md) | Wave 10 pre-release traceability, deterministic evaluation, health, resource, and backup assurance (**10c Wave_accepted; not release-qualified**) |

Stewardship Compact and Ethics are peers beneath the Constitution. They clarify
higher authority; they do not override it.

## Model routing and Model Fabric

Current production routing is the living snapshot in
[`Routing_Status.md`](Routing_Status.md). Model IDs are policy, not Model
Fabric architecture. Semantic ownership of future dispatch is
[`architecture/Model_Fabric_Architecture.md`](architecture/Model_Fabric_Architecture.md).
MF-M2–MF-ACT execution contracts live in
[`architecture/Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md`](architecture/Model_Fabric_MF_M2_MF_ACT_Implementation_Contracts.md).
Those contracts do not make §12.9 live. SLICE 0 and MF-M2 through MF-ACT
are `IMPLEMENTATION_READY` machinery only. Frozen field contracts and bounded
implementation planning remain in
[`architecture/Model_Fabric_01_Contract_Draft.md`](architecture/Model_Fabric_01_Contract_Draft.md)
and
[`architecture/Model_Fabric_01_Implementation_Spike.md`](architecture/Model_Fabric_01_Implementation_Spike.md).
Qualification meaning remains owned by
[`architecture/Ashley_Evaluation_Qualification_Plane.md`](architecture/Ashley_Evaluation_Qualification_Plane.md).
No Model Fabric implementation, provider activation, or deployment is authorized
by these documents. Planned or current model IDs belong in routing source and
an explicitly audited Routing Status snapshot, not in this implementation map.

## Production (Mint)

Two processes: `agent-service` (:3710) + `discord-bot` (gateway).

CURRENT SOURCE TOPOLOGY (resolve live state from source and bound evidence,
not from this map):

```
Discord → POST /chat/ingress → inbox → wake/cycle → runLiveCognitiveTurn → Thought → settlement → speech outbox → delivery projector/pump → receipt/finalize
Periodic: scheduler → POST /initiative/idle → schedule/inquiry gate → wake only when admitted → Thought → normal settlement/delivery
Due commitments: commitment store → `commitment_due` wake → Thought projection → normal settlement/delivery (gated by RA_COMMITMENTS)
Engineering: Thought-visible typed project operations are capability-bound; the generic M6 Thought offer remains hard false
```

Reflection owns post-outcome interpretation/calibration; it has no
current-turn authority and has no live calibration consumer in Thought.
The following are gone or superseded — do not treat them as current:
`POST /chat/text`; the Agency.decide proactive pipeline (draft → reserve →
send; the module is source-present but no non-test source reaches it);
the nuclear cognition-job endpoints; the old urgent-wake poll path and its
send pipeline.

SQLite: `~/.composer-assistant/conversations/nuclear.db`.

## Module tree

`apps/agent-service/src/core/` — identity, state, memory, cognition, learning,
curiosity, agency, reflection, honesty, conversation, writers, runtime.

Current supported nuclear schema is declared in
[`apps/agent-service/src/core/db.ts`](../apps/agent-service/src/core/db.ts)
(`NUCLEAR_SUPPORTED_VERSION`). Do not copy the integer here.

Cognition integration is atomic: a completed job produces one complete episode
and all of its derived state, or none of them.
`ASHLEY_COGNITION_MODE=observe` records evidence and proposals without allowing
behavioral influence. `apply` is the master ceiling; release-scoped capability
states, dependencies, evaluation qualification, live-shadow thresholds, and
rollback still govern the full loop. Gated `own_time_report` (deps: `thought`,
`curiosity_consolidation`) can share ≤3 owner-scoped grounded takes from a
completed own-time window when Doc asks and the capability may influence.

Reactive refusal is a distinct Thought decision. It is valid only when the
selected evidence contains the current user message and a persisted stable
boundary, and only while the `refusal` capability may influence behavior.
Silence, delay, challenge, and refusal remain separate decisions.

Feed scans store attention candidates only. `cur_reads` is the sole evidence
source for claims that Ashley read an article. Owner-confirmed forgetting
redacts matching source messages, removes FTS and evidence paths, reconciles
derived state, and records content-free receipts.

Full reading uses public-network validation on every DNS resolution and
redirect, bounded retrieval, deterministic extraction, hashed read records,
and restart-safe `consolidate_curiosity` jobs. Consolidation treats retrieved
text as untrusted evidence and may create only evidence-linked takes,
questions, interests, opinions, and source proposals. Source proposals require
three successful probation parses before activation. Agency alone decides
whether grounded material deserves an interruption.

Shared utils: `apps/agent-service/src/lib/` (feed-parse, typography, metadata-echo, strip-markers).

Retired: voice, Telegram, habits, Moltbook, skills, legacy ChatService / `index.db` writers.

## Sandbox V2 (current work)

The current V2 execution path uses direct, unprivileged Bubblewrap under
`apps/sandbox-m1/` and `apps/sandbox-v2/`. It does not use the V1
`ashley-exec-broker`, Unix socket, signed broker envelopes, or `source_*`
scopes. M4 remains blocked until exact-candidate M3 is `PRODUCTION ACCEPTED`.
Do not infer current qualification, deployment, or promotion from source
presence. Full current authority:
[`architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md`](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md).

The historical `apps/sandbox-broker/` package and Wave 07 gate packets, together
with [`Sandbox_Design.md`](Sandbox_Design.md), preserve historical V1 source and
evidence. The retained `apps/sandbox-policy/` package is used by current V2
source for deterministic policy; it does not restore the V1 broker topology.
Historical V1 material is not a V2 dependency and MUST NOT be reconnected by
implication.

## Engineering authoring (V2 M5 / later M7)

V2 M5 is specified by
[`architecture/sandbox/ASHLEY_SANDBOX_V2_M5_DESIGN.md`](architecture/sandbox/ASHLEY_SANDBOX_V2_M5_DESIGN.md).
It introduces a coherent, reviewable candidate change-set contract. It does
not use the V1 broker source workflow. Base identity, stale-base handling,
system-derived receipts, secret exclusion, and approval-is-not-effect remain
useful reference semantics for the current
[`Sandbox V2 M5 contract`](architecture/sandbox/ASHLEY_SANDBOX_V2_M5_DESIGN.md)
and later named M7 profiles.
Branch, commit, push, pull request, package, publish, deploy, restart, and
apply-to-Ashley are not M5. M7 owns named engineering-border profiles. None is
implied by authoring.

## External effect and authority (cross-cutting)

Current observation and effect meaning is owned by
[`architecture/External_Effect_and_Authority_Architecture.md`](architecture/External_Effect_and_Authority_Architecture.md).
Connectors, qualified procedures, Computer Use, and Sandbox M7 consume that
plane. Computer Use is not the parent of generic external action.

Historical Wave 09 semantics are not a current architecture. Current
observation and effect meaning is owned by
[`External_Effect_and_Authority_Architecture.md`](architecture/External_Effect_and_Authority_Architecture.md).
The retained local fake-adapter source is in
`apps/agent-service/src/core/external-agency/` and `apps/external-broker/`.
That machinery is undeployed and not qualified for a real adapter, account, or
host.

## Observability

Current owner-authenticated GET projections and process logs are diagnostic
surfaces. They are not the Observability Plane. Plane architecture is
[`architecture/Ashley_Observability_Plane.md`](architecture/Ashley_Observability_Plane.md).
Owner-authenticated POST endpoints are control or effect paths, not telemetry.

- `GET /health` → minimal public liveness/readiness and provider state
- `GET /nuclear/health?owner_id=` → owner-only bounded diagnostics (metadata only)
- `GET /nuclear/decisions?owner_id=` → recent `decision_log` rows
- `GET /nuclear/reflections?owner_id=` → immutable evidence + current proactive calibration
- `GET /nuclear/episodes?owner_id=&query=` → grounded episodic recall
- `GET /nuclear/cognition?owner_id=` → affect, urgency, jobs, and runs
- `GET /nuclear/capabilities?owner_id=` → release gates, evidence, and rollback
- `GET /nuclear/revisions?owner_id=` → proposed/applied identity and opinion growth
- `GET /nuclear/identity/reviews?owner_id=` → separate Ashley and Doc positions

Control paths, not diagnostics:

- `POST /nuclear/revisions/revert` → restore the prior value for one applied revision
- `POST /nuclear/identity/reviews/ashley` → evidence-grounded Ashley position
- `POST /nuclear/identity/reviews/doc` → owner-authorized Doc decision

## Review

- [Architecture Review Protocol](Architecture_Review_Protocol.md) — informational mirror; binding audit plan is normative
