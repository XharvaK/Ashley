# Ashley Foundation Architecture Decision v1

> **STATUS: HISTORICAL FOUNDATION DECISION**
>
> The semantic-ownership decision remains supporting evidence. The current
> roadmap, completed P-01 status, and later substrate dispositions are governed
> by the [Canonical Architecture Roadmap](Ashley_Architecture_Roadmap.md).

**Status:** Accepted architecture decision; implementation not started

**Decision date:** 2026-08-09

**Baseline:** `0efb0250989e2b67a9b0b3d7e8fce81568ae0975` (`HEAD` = `origin/master`)

**Authority:** Derived from `VISION.md`, the Core Principles, Constitution,
Stewardship Compact, Ethics, Hierarchy, and Architecture Review Protocol. This
document is not a runtime prompt.

## 1. Executive Architecture Decision

Ashley remains an Ashley-owned semantic system with two authoritative stores:
`nuclear.db` for behavioral state and `continuity.db` for lineage, forgetting,
sessions, and backup watermarks. No external agent framework, workflow engine,
memory system, plugin format, transport, or sandbox substrate becomes an
authority source.

The accepted foundation is deliberately small:

1. Keep the current SQLite cognition loop as the production baseline.
2. Characterize that loop before designing any framework adapter.
3. Then compare real, pinned Mastra and LangGraph.js packages in isolated
   parity spikes. Neither is accepted for production.
4. Permit each real-package spike a disposable, derived technical store so its
   actual recovery model can be tested. The store cannot write or supersede
   Ashley's authoritative records.
5. Keep the existing sandbox client, signed policy, and broker. Recognize their
   already-isolated mechanical seams, but do not replace them with OpenHands or
   AgentFS.
6. Defer Agent Plugins runtime adoption, external memory projections, coding
   specialists, and workspace substrates. A pure Agent Plugins conformance
   spike follows P-01.
7. Do not activate the Mint sandbox until the natural Recall canary has
   completed. Read-only release planning may continue earlier.

What is externalizable now is narrow machinery, not meaning: workflow job
lifecycle if a real candidate proves parity; public HTTP transport; API
transport; attention dispatch mechanics; initiative wake mechanics; plugin
package parsing later; MCP transport later; process/workspace mechanics only
behind the signed broker boundary.

What remains undecided is empirical, not architectural: whether Mastra or
LangGraph can beat the current loop under the same fixture, their exact pinned
versions at spike time, their measured dependency/host cost, and whether the
uninspectable Monoma candidate ever produces authoritative evidence.

## 2. Evidence Reviewed

### 2.1 Governing and current architecture documents

The review read the following in the mandated authority order:

- `VISION.md`
- `docs/Ashley_Core_Principles.md`
- `docs/Ashley_Constitution.md`
- `docs/Ashley_Stewardship_Compact.md`
- `docs/Ashley_Ethics.md`
- `docs/Ashley_Hierarchy.md`
- `docs/Architecture_Review_Protocol.md`
- `docs/Architecture_Index.md`
- `docs/Sandbox_Design.md`
- `docs/Wave_Acceptance_Protocol.md`
- `docs/Stabilization_Design.md`

The controlling rules are: architecture before prompting; ownership belongs to
the module making the decision; move a decision exactly once; do not reconstruct
Thought downstream; framework authentication is not Doc's consent; external
content is untrusted; wave acceptance is not release qualification or
deployment.

### 2.2 Luna research provenance

All six artifacts were read in full:

- Pass 1: `docs/architecture/Ashley_Architecture_Salvage_Map_v1.md`
- Inventory: `docs/architecture/salvage/Ashley_Subsystem_Inventory.md`
- Dossiers: `docs/architecture/salvage/Foundation_Candidate_Dossiers.md`
- Spike backlog: `docs/architecture/salvage/Porting_Spike_Backlog.md`
- Gaps: `docs/architecture/salvage/Research_Gaps_and_Contradictions.md`
- Pass 2: `docs/architecture/salvage/Ashley_Salvage_Map_Adversarial_Audit_v1.md`

### 2.3 Current source seams

Representative source evidence was traced rather than inferred from folder
names:

- Cognition identity, unique source keys, atomic claim, retry, and restart
  recovery: `apps/agent-service/src/core/cognition/jobs.ts:17-127`.
- Model/curiosity work outside the transaction and authority-bearing
  materialization plus job completion inside one `BEGIN IMMEDIATE` transaction:
  `apps/agent-service/src/core/cognition/worker.ts:283-559`.
- Cognition loop startup: `apps/agent-service/src/index.ts:23-30` and
  `apps/agent-service/src/core/cognition/worker.ts:560-661`.
- Attention lane policy, quotas, budgets, deadlines, admission, and recovery:
  `apps/agent-service/src/core/attention/ledger.ts:52-621`.
- Capability influence, dependency, contract, provenance, cutover, and rollback
  gates: `apps/agent-service/src/core/rollout/capabilities.ts:1-823`.
- Reactive delivery claim before Thought and receipt-backed finalization:
  `apps/agent-service/src/core/runtime.ts:423-1077` and
  `apps/agent-service/src/core/delivery/`.
- Proactive eligibility, motivation, Thought, reservation, and commit:
  `apps/agent-service/src/core/runtime.ts:1079-1473`.
- Deterministic Thought safety floor and model-proposal validation:
  `apps/agent-service/src/core/agency/decide.ts` and
  `apps/agent-service/src/core/agency/thought.ts`.
- Public-only URL/DNS validation and bounded retrieval:
  `apps/agent-service/src/core/curiosity/network.ts:68-263`.
- Reflection is bounded post-outcome calibration, not a generic background
  workflow owner: `apps/agent-service/src/core/reflection/initiative.ts:72-309`.
- Continuity sidecar and exact forget previews:
  `apps/agent-service/src/core/continuity/db.ts` and
  `apps/agent-service/src/core/continuity/forget-preview.ts`.
- Agent-side broker transport is injected at the service entrypoint:
  `apps/agent-service/src/index.ts:13-20`; the typed Unix client is
  `apps/agent-service/src/core/sandbox/unix-broker-client.ts:293-568`.
- Broker socket/peer boundary: `apps/sandbox-broker/src/server.ts`; broker
  execution and workspace seams:
  `apps/sandbox-broker/src/execution/fixed-recipe-execution-service.ts` and
  `apps/sandbox-broker/src/workspace/workspace-create.ts`.
- Retired surface is not entirely absent: `apps/desktop/` still targets a voice
  service, while explicit `410 Gone` routes in `server.ts:1559-1561` are current
  compatibility truth rather than automatic deletion targets.

The Luna LOC figures were useful for orientation but are not acceptance facts.
Current physical line counts use different conventions and have drifted. No
decision below depends on an estimated retirement ratio; candidate retirement
must be demonstrated by an exact post-spike diff.

### 2.4 External authoritative verification

Verified on 2026-08-09 using official documentation or official repositories:

| Subject | Verified fact that affects this decision | Authority |
|---|---|---|
| Mastra | Workflow snapshots persist suspended execution state and remaining retries to configured storage; LibSQL is a supported local default. Schedules and wider framework surfaces overlap with Ashley policy. | [Snapshots](https://mastra.ai/en/reference/workflows/snapshots), [repository](https://github.com/mastra-ai/mastra), [license](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md) |
| LangGraph.js | Checkpoints are written per super-step; replay re-executes nodes after the selected checkpoint, including model/API calls; a separate SQLite checkpointer exists for local workflows. | [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence), [interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts), [repository](https://github.com/langchain-ai/langgraphjs), [MIT license](https://github.com/langchain-ai/langgraphjs/blob/main/LICENSE) |
| Restate | Applications require a Restate Server plus SDK services; the server owns durable state in its embedded store (RocksDB in current self-hosted docs). The server license is BSL 1.1 with an additional-use grant. | [Workflows](https://docs.restate.dev/tour/workflows), [self-hosting](https://docs.restate.dev/server/overview), [server license](https://github.com/restatedev/restate/blob/main/LICENSE) |
| Temporal | A separate Temporal Service is required for self-hosting; it remains a durability reference, not a Mint foundation. | [Temporal documentation](https://docs.temporal.io/) |
| Agent Plugins | v1.0.0 is a Working Draft for packaging/discovery of skills and MCP servers. Schema conformance does not confer trust or execution authority. | [Specification](https://agent-plugins.org/specification) |
| MCP | MCP is host/client/server transport and capability negotiation. Its HTTP authorization is transport-level OAuth; the host still owns consent and security policy. | [Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture), [authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) |
| OpenHands | Its runtime is a Docker-based client/server execution environment with its own action server, plugins, mounts, and operational surface. | [Runtime architecture](https://docs.openhands.dev/openhands/usage/architecture/runtime) |
| AgentFS | It is a beta SQLite-backed filesystem/tool-call substrate with FUSE/NFS and an experimental sandbox; it is not a memory or authorization authority. | [Official repository](https://github.com/tursodatabase/agentfs) |
| Monoma | One bounded attempt to inspect `https://usemonoma.com/#faq` did not return inspectable authoritative content. | Research gap; excluded from selection |

## 3. Pass 1 vs Pass 2 Adjudication

### 3.1 Pass 1 verdict

Pass 1 correctly established the semantic-core boundary, rejected wholesale
framework replacement, and identified cognition lifecycle as the highest-value
proof seam. It also correctly kept current SQLite, continuity, delivery truth,
privacy, and capability authority local.

Its weaknesses were a framework scorecard ahead of parity evidence, rough LOC
retirement estimates treated too optimistically, and a fake
“Mastra-shaped/LangGraph-shaped” comparison that could characterize Ashley but
could not validate either package.

### 3.2 Pass 2 verdict

Pass 2 correctly attacked false KEEP absolutism, separated semantic core from
machinery, exposed dual-store failure modes, and refused to call a candidate a
winner from documentation. It also correctly rejected writable external memory
as authority and treated OpenHands/AgentFS as substrates rather than governance.

Its main error was assigning machinery to the wrong subsystem. Job triggering
belongs to S14, not Mind State; model transport belongs to attention/routing,
not Thought; route serialization belongs to S17, not Identity or observability.
It also overstated plausible sandbox retirement before exact dependency and
security proof. Five of its eight KEEP refinements are therefore rejected, and
three are accepted only as narrow existing seams.

### 3.3 Individual audit of the eight refinements

#### S02 — Identity

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | Deterministic classification/store modules plus owner-only revision/review routes; generic HTTP is already S17. |
| Semantic core | Stable/adaptive classification, foundational review, exact revision approval, provenance. |
| Generic machinery | JSON and route serialization only; not meaningfully part of S02. |
| Can machinery be isolated? | Already isolated at the HTTP boundary. A second identity adapter would duplicate that seam. |
| Would isolation reduce maintenance? | No demonstrated reduction. |
| Would an adapter increase complexity? | Yes: two places could appear to own review state. |
| Sol verdict | **REJECT refinement; KEEP.** |
| Confidence | High |

#### S03 — Mind State

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | State writes, urgent-wake leases, own-time sessions, affect, and capability gates share semantic transactions. Generic cognition lifecycle is in S14. |
| Semantic core | Dynamic condition, grounded affect, commitments/concerns, absence and return. |
| Generic machinery | Timestamps and CRUD; job retry/trigger is not owned here. |
| Can machinery be isolated? | Only by moving it to S14, where it already belongs. |
| Would isolation reduce maintenance? | Not for S03. |
| Would an adapter increase complexity? | Yes: it would split transaction ownership. |
| Sol verdict | **REJECT refinement; KEEP.** |
| Confidence | High |

#### S04 — Thought and Agency

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | Deterministic safety floor selects kind/evidence/refusal/authorization; model Thought is a validated proposal; provider calls already pass through routing/attention. |
| Semantic core | Effort, evidence, refusal, initiative, authorization, completion. |
| Generic machinery | Model envelope and timeout, already owned by S11/S13. |
| Can machinery be isolated? | Yes at the existing model boundary, not by replaying Thought. |
| Would isolation reduce maintenance? | No additional reduction inside S04. |
| Would an adapter increase complexity? | High: replay could repeat a semantic decision or influence write. |
| Sol verdict | **REJECT refinement; KEEP.** |
| Confidence | High |

#### S08 — Reflection and learning

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | Initiative reflection is synchronous bounded event processing; revision eligibility and application are provenance- and approval-sensitive. Shared cognition lifecycle remains S14. |
| Semantic core | Post-outcome interpretation and bounded future calibration; never current-turn authority. |
| Generic machinery | A small caller lifecycle only. |
| Can machinery be isolated? | A future S14 runtime may call a pure reflection callback; no S08 wrapper is needed now. |
| Would isolation reduce maintenance? | No independent savings. |
| Would an adapter increase complexity? | Yes if it creates a replayable second reflection owner. |
| Sol verdict | **REJECT refinement; KEEP.** |
| Confidence | High |

#### S10 — Curiosity and public reading

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | `network.ts` already isolates bounded public HTTP/DNS mechanics; consolidation owns evidence and live/shadow provenance. |
| Semantic core | Scan/rank/choose/evidence/probation/take/consolidate/motivate; reading never sends. |
| Generic machinery | HTTP transport, feed parsing, retry/wake mechanics. |
| Can machinery be isolated? | Yes; the transport is already narrow. Consolidation must remain Ashley-owned. |
| Would isolation reduce maintenance? | Modestly, only if the existing transport can be replaced without re-proving policy elsewhere. |
| Would an adapter increase complexity? | A workflow adapter now would; the existing network seam does not. |
| Sol verdict | **ACCEPT WITH MODIFICATION: KEEP CORE + WRAP existing transport seam; no framework port.** |
| Confidence | High on ownership; medium on future replacement value |

#### S21 — Sandbox client and policy

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | Signed policy and proposal/approval semantics are distinct from a typed Unix broker client and serialization transport. |
| Semantic core | Capability scope, signatures, consent, tombstones, paths/recipes, session authority. |
| Generic machinery | Framing, socket lifecycle, serialization, bounded copy helpers. |
| Can machinery be isolated? | Yes; `SandboxBrokerClient`/Unix transport are already the seam. |
| Would isolation reduce maintenance? | The current isolation improves proof; external replacement value is unproven. |
| Would an adapter increase complexity? | A new substrate adapter would until it retires the existing path exactly. |
| Sol verdict | **ACCEPT WITH MODIFICATION: KEEP CORE + WRAP current client transport; candidate NONE.** |
| Confidence | High on boundary; low on retirement value |

#### S22 — Sandbox broker

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | Socket/peer checks, signatures, sessions, fixed-recipe policy, workspaces, process runner, receipts, and audit are separated into modules. The generic runner is small; workspace mechanics remain policy-coupled. |
| Semantic core | Host authority, fail-closed policy, exact signed scope, UID/socket boundary, receipts, cleanup and forget. |
| Generic machinery | Direct process execution, bounded output, workspace copying/storage, frame dispatch. |
| Can machinery be isolated? | Yes behind existing runner/workspace interfaces, but not safely removed by documentation. |
| Would isolation reduce maintenance? | Possibly; exact value is **TOO UNCERTAIN** until a security-gated spike produces a diff. |
| Would an adapter increase complexity? | Yes if it creates another execution path, store, daemon, or containment model. |
| Sol verdict | **ACCEPT WITH MODIFICATION: KEEP CORE + WRAP current mechanical interfaces; no replacement dependency.** |
| Confidence | High on authority; low on replacement economics |

#### S27 — Observability

| Required question | Adjudication |
|---|---|
| Pass 1 | KEEP |
| Pass 2 | KEEP CORE + WRAP MACHINERY |
| Actual source structure | Owner-only semantic evidence views are routes over Ashley records; generic route mechanics already belong to S17. |
| Semantic core | Distinguishing shadow, influence, decision, reservation, receipt, delivery, continuity, and rollout state. |
| Generic machinery | HTTP export, trace correlation, optional metrics. |
| Can machinery be isolated? | Yes at S17 or an additive exporter, not as S27 ownership. |
| Would isolation reduce maintenance? | No current evidence. |
| Would an adapter increase complexity? | Yes if external telemetry becomes a competing evidence record or leaks owner data. |
| Sol verdict | **REJECT refinement; KEEP.** |
| Confidence | High |

## 4. Final Semantic Core

The following remain indivisibly Ashley-owned:

- Governance and constitutional precedence.
- Stable Identity and foundational change authority.
- Dynamic Mind State, relationship state, grounded affect, and own-time meaning.
- Thought, evidence selection, refusal, initiative, and authorization.
- Recall truth, exact message provenance, redaction, forgetting, and lineage.
- Capability contracts, model-continuity epochs, live/shadow provenance,
  promotion, cutover, and rollback.
- Delivery truth: inbound claim, decision, reservation, bubbles, receipts,
  commit, and finalization.
- Privacy/classification and public-read policy.
- Sandbox and external-action consent, signed scope, execution authority, and
  receipts.
- Model-routing semantics and attention policy.
- Qualification language and owner-visible evidence semantics.

Framework state may describe that technical work is pending or replayable. It
may never assert that Ashley believed, remembered, consented, decided,
delivered, forgot, or gained authority.

## 5. Final Generic Machinery Map

| Machinery | Ashley decision owner | Accepted seam | Candidate now | Timing |
|---|---|---|---|---|
| Cognition claim/retry/recovery | Cognition callback + capability authority | `AshleyWorkflowRuntime` | Current baseline; Mastra/LangGraph comparator only | P-01 |
| Attention dispatch mechanics | `AshleyAttentionPolicy` | Admission result to model dispatch | NONE | Later, only if measured |
| Public HTTP | Curiosity public-read policy | Bounded fetch transport | Current Node HTTP | Keep current |
| API transport | Owner auth and semantic services | Versioned request/response adapters | Current Express | Later, not foundation |
| Initiative wake | Agency | Wake event only | Current scheduler | Later, not foundation |
| Plugin packaging | Capability/tool admission | Parser output as untrusted descriptor | Agent Plugins spec | After P-01 |
| Tool transport | ToolRuntime | MCP client transport | MCP | Wait for runtime decision |
| Process/workspace mechanics | Signed broker authority | Existing runner/workspace interfaces | NONE | Keep current; future security spike only |
| Telemetry export | Semantic diagnostics | Redacted additive exporter | NONE | Only on a concrete need |

## 6. Final Subsystem Dispositions

| ID | Subsystem | Final disposition | Core reason |
|---|---|---|---|
| S01 | Governance and constitution | KEEP | Highest local authority chain |
| S02 | Identity and foundational review | KEEP | Review and revision meaning cannot move |
| S03 | Mind State, affect, own-time | KEEP | State transactions are semantic |
| S04 | Thought and Agency | KEEP | Decision/authorization owner |
| S05 | Context composition | KEEP | Assembles authorized evidence only |
| S06 | Expression and rendering | KEEP | Preserves intent/layer boundary |
| S07 | Recall and redaction | KEEP | Truth, provenance, forget authority |
| S08 | Reflection and learning | KEEP | Bounded post-outcome semantics |
| S09 | Relationship state | KEEP | Cannot become engagement state |
| S10 | Curiosity and public reading | KEEP CORE + WRAP | Existing bounded HTTP seam only |
| S11 | Model routing | KEEP | Smart routing already done and policy-owned |
| S12 | Capability/provenance authority | KEEP | Observe must never time-shift into influence |
| S13 | Attention admission | WRAP | Keep policy; mechanical dispatch replaceable |
| S14 | Cognitive jobs and worker | SPIKE | Highest-value recovery proof seam |
| S15 | Delivery ledger | KEEP | Receipt-backed delivery truth |
| S16 | Discord boundary | KEEP | Discord-only merge/dedup contract |
| S17 | HTTP/API boundary | WRAP | Keep auth/semantics; transport replaceable |
| S18 | Nuclear SQLite schema | KEEP | Authoritative behavioral store |
| S19 | Continuity sidecar | KEEP | Authoritative lineage/forget store |
| S20 | Privacy/classification | KEEP | Fail-closed disclosure policy |
| S21 | Sandbox client/policy | KEEP CORE + WRAP | Existing typed transport seam only |
| S22 | Sandbox broker | KEEP CORE + WRAP | Existing process/workspace seams only |
| S23 | Self-modification proposals | DEFER | Design/accepted local work is not foundation activation |
| S24 | External agency broker | KEEP | Separate credential/action authority |
| S25 | Initiative scheduling | WRAP | Wake only; Agency decides |
| S26 | Qualification/evaluation | KEEP | Local deterministic acceptance language |
| S27 | Observability/diagnostics | KEEP | Semantic evidence, not generic telemetry |
| S28 | Retired legacy surface | DELETE | Remove verified residue after exact reference audit |
| S29 | Plugin/tool interoperability | SPIKE | Parser proof after P-01; runtime not adopted |
| S30 | Learned autonomy/CSM | DEFER | No bounded authority design accepted |
| S31 | Unresolved external research | RESEARCH | Monoma remains unverified and non-influential |

Counts: KEEP 19; KEEP CORE + WRAP 3; WRAP 3; SPIKE 2; DEFER 2;
DELETE 1; RESEARCH 1; PORT/REPLACE 0.

## 7. Workflow Architecture Decision

### Current Ashley loop

**Accepted production baseline.** It already has a unique source key, atomic
claim, bounded retry, recovery of `running` work, and a single atomic
materialization/complete transaction. It is simple and inspectable. P-01A must
also expose its weaknesses: all `running` jobs are blindly reset on restart,
there is no expiring claim lease, and model work can repeat before the atomic
materializer.

### Mastra

**Accepted for P-01B comparator only.** It is included because the actual
TypeScript workflow/snapshot path and local LibSQL storage can test
suspend/recovery without a separate workflow service.

- Must prove: no duplicate model/materializer effects, exact retry accounting,
  restart parity, atomic Ashley callback, stable job mapping, no authority leak.
- Reject if: snapshot state is treated as provenance; resume repeats committed
  influence; it needs broader agent/memory/routing surfaces; or measured host
  and adapter cost exceeds the current loop without a demonstrated recovery win.
- Could retire: only generic claim/retry/recovery/loop code proven by an exact
  diff—not Thought, materializers, tables, routes, or diagnostics.
- Expected cost: npm dependencies, LibSQL snapshot file, adapter/proof code, and
  upgrade/backward-compatibility work; no extra service in the isolated spike.

### LangGraph.js

**Accepted for P-01B comparator only.** It is included because explicit
checkpoints, tasks, pending writes, replay, interrupts, and a local SQLite
checkpointer test a materially different recovery model.

- Must prove: non-deterministic model work is encapsulated once, replay never
  repeats committed Ashley effects, checkpoint IDs cannot become lineage, and
  the same atomic callback remains authoritative.
- Reject if: node replay or time travel can duplicate effects; local SQLite is
  unsuitable for the tested concurrency; required server/LangSmith surfaces
  enter the design; or adapter/proof cost is larger than the current loop
  without a demonstrated reliability win.
- Could retire: the same narrow cognition lifecycle as Mastra, and nothing
  semantic.
- Expected cost: core/checkpointer dependencies, a derived checkpoint store,
  graph/task mapping, replay guards, and checkpoint migration discipline.

### Restate

**Excluded from P-01B.** Its server and durability store create a separate
runtime, operational lifecycle, backup surface, and license review for a
single-user 4 GB Mint host. Those costs test a distributed service hypothesis,
not the smallest embedded foundation. Reconsider only if both embedded
comparators fail and an actual workload requires service-level durable
messaging.

### Temporal

**Reference only; rejected as current foundation.** Its durability semantics
remain a useful benchmark. A self-hosted Temporal Service, persistence,
visibility, security, and operations are disproportionate to this seam and
host.

### Comparator selection

**Option A: CURRENT + MASTRA + LANGGRAPH.** Documentation does not select a
winner. Current Ashley remains the default unless a real package proves a
material reliability or maintenance advantage.

## 8. P-01 Final Design

The two-stage split is adopted.

### P-01A — `AshleyWorkflowRuntime` characterization

P-01A is candidate-neutral and dependency-free. It does **not** create fake
Mastra- or LangGraph-shaped adapters. It records current behavior before an
interface is frozen.

Fixture: one synthetic owner/thread, exact synthetic user and assistant
messages, one `consolidate_thread` job, fixed model output, a temporary Ashley
SQLite database, observe-mode capability state, and no provider/network calls.

Required injection points and assertions:

1. Duplicate enqueue: one job for one `source_key`.
2. Claim then process death: restart recovery is explicit and attempts are
   counted.
3. Failure before model completion: no semantic rows or completed run.
4. Model result obtained, failure before materialization transaction: no
   partial episode/fact/state/revision/evidence rows.
5. Failure inside materialization: full rollback, retryable job, no influence.
6. Commit succeeds, caller dies before observing return: completed job/run and
   semantic rows appear exactly once on restart.
7. Repeated failure: exact backoff and terminal attempt ceiling.
8. Capability-contract/model-epoch mismatch: no influence.
9. Shadow provenance stays shadow and cannot become later influence.
10. Exact message/entity provenance is preserved.

Output is a normalized trace and table snapshot contract, not a production
runtime interface chosen in advance. It distinguishes technical run state from
Ashley semantic outcome.

### P-01B — real candidate parity

Only after P-01A locks the observable contract:

- create isolated spike workspaces;
- pin then-current exact Mastra and LangGraph.js/checkpointer packages;
- implement the smallest real adapter for the same fixture;
- use fixed callbacks, never Mistral or production data;
- run the identical failure matrix, including real process restart;
- measure installed dependency tree, startup time, peak RSS, on-disk state,
  adapter/proof LOC, and migration surface;
- produce exact keep/retire/add diffs;
- make no production integration.

Acceptance requires semantic parity **and** a material net reliability or
maintenance gain. Feature richness, a dashboard, suspend/resume in a tutorial,
or fewer lines in `jobs.ts` is insufficient.

## 9. Technical Workflow State Decision

**Option B: allow a derived/ephemeral second store in the isolated P-01B spike
only.** A real persistence package cannot be meaningfully tested while forbidding
its persistence model. This is experimental permission, not architectural
acceptance.

Consistency rules:

1. Each candidate gets its own disposable path under the spike temp directory.
2. It stores only checkpoints, task results, timers, and technical trace state.
3. Every row/run maps to Ashley job ID, `source_key`, owner, lineage ID,
   capability contract ID, and model-continuity epoch where applicable.
4. It never opens production `nuclear.db` or `continuity.db` and never becomes a
   backup, Recall, provenance, delivery, or authority source.
5. Candidate store commits but Ashley transaction fails: quarantine/discard the
   candidate run; no semantic outcome occurred; retry from Ashley's pending job
   with a new candidate run identity.
6. Ashley transaction commits but candidate completion fails: Ashley is
   authoritative; reconcile the candidate run to completed/orphaned and never
   rerun the materializer.
7. Candidate store unavailable: the spike fails closed. There is no silent
   in-memory or production fallback.
8. Deleting the temp directory must remove all candidate state without changing
   an Ashley assertion.

A second durable production workflow store is not accepted.

## 10. Agent Plugins Decision

**Parser/conformance: SPIKE AFTER P-01.** The Working Draft is precise enough for
a pure fixture, but Ashley has no current packaging code to retire. P-01 is the
only current high-value foundation uncertainty and should define stable tool/
workflow seams first.

The parser spike may validate only local fixtures against recognized schema
identifiers, reject traversal/symlink/unknown-version hazards, discover skills
and MCP descriptors without execution, and emit an untrusted normalized
descriptor. It is safe during natural Recall qualification.

**Runtime interoperability: WAIT FOR SPEC MATURITY.** “Parser conforms” does not
mean package installation, skill prompt inclusion, MCP launch, secret access,
tool registration, or execution. Runtime adoption needs a mature spec, an
Ashley tool authority, credential policy, result quarantine, and a real use
case.

## 11. MCP Boundary

Canonical layering:

```text
Agent Plugins package bytes (untrusted packaging)
  -> AshleyPluginParser (schema/path validation; inert descriptor)
  -> Ashley capability proposal (not registration)
  -> CapabilityAuthority + owner/tool policy admission
  -> AshleyToolRuntime (read/mutate class, scope, credentials, budgets)
  -> MCP client transport when appropriate
  -> AshleyExecutionBroker for every host mutation
  -> untrusted result + transport receipt
  -> classification/provenance/evidence resolver
  -> Thought may use authorized evidence
```

- **Packaging:** Agent Plugins describes where components are. Installation is
  not trust.
- **Transport:** MCP negotiates and carries tool/resource messages. Connectivity
  is not authorization.
- **Authorization:** Ashley capability contracts, Doc's exact consent, secret
  policy, and tool scope remain local. OAuth authenticates an MCP resource; it
  does not express Ashley's permission to act.
- **Execution:** read-only network tools stay bounded; host mutation goes only
  through the signed broker; external public action goes through the separate
  external-action broker.
- **Evidence:** all results are untrusted, classified, provenance-bound, and
  admitted by the evidence resolver before Thought.

## 12. Memory Foundation Decision

**RESEARCH READ-ONLY PROJECTION LATER**, after Recall, Mind State, and Thought
rollout are complete. Current SQLite/FTS remains the only accepted memory
foundation.

Any later projection must be rebuildable, tombstone-aware, lineage-aware,
classification-filtered, provenance-preserving, and keyed to immutable Ashley
entities and source evidence. It may improve retrieval but may not write facts,
Identity, Mind State, relationship state, episodes, revisions, or Recall
authority. No writable agent-memory platform is accepted.

## 13. OpenHands Decision

**DEFER OPTIONAL SPECIALIST.** OpenHands is not a foundation, sandbox authority,
workflow runtime, or host policy. It would add Python, Docker/container images,
an action server, plugin/runtime operations, and a second workspace model while
retiring no proven Ashley authority code.

Reconsider only for an approved coding-agent use case after the existing broker
is release-qualified and active. OpenHands would sit behind a fixed signed
broker recipe over a sanitized disposable source copy and return untrusted
artifacts. It would never receive live secrets, repositories, or approval keys.

## 14. AgentFS Decision

**DEFER.** AgentFS is beta and would add another SQLite state file plus
FUSE/NFS/SDK and snapshot semantics. Ashley's broker already isolates workspace
creation, revalidation, cleanup, limits, receipts, and exact artifact identity.
The supposedly retireable share is too uncertain, and AgentFS does not replace
policy, signatures, network isolation, UID separation, or forget authority.

Reconsider only when a real approved workload needs durable portable workspace
snapshots and an exact security-gated spike can retire more code than its
adapter/proof/operations add.

## 15. Sandbox Activation Ordering

**Option D: SANDBOX ACTIVATION AFTER RECALL CANARY.**

- **Architectural dependency:** None on P-01 or Agent Plugins. Read-only release
  planning and qualification review can proceed independently.
- **Production risk:** Activation installs/enables an OS-boundary service,
  signing material, policy artifacts, socket access, workspaces, and a new live
  authority path. Wave acceptance does not qualify or deploy it.
- **Recall contamination:** The natural canary should observe the current
  production runtime without a simultaneous service/restart/configuration
  change. Sandbox activation after the canary preserves causal clarity.
- **Operational benefit:** It enables bounded, signed execution and is the
  correct prerequisite for future self-modification or coding specialists.
  There is no currently authorized production task that needs execution.
- **Missing capability:** Ashley lacks live sandbox execution, but she does not
  currently lack a capability she *should already have*. Discord companionship,
  Recall qualification, curiosity, and relationship behavior do not depend on
  host execution; premature activation would expand authority without a present
  semantic need.

No sandbox activation, Mint change, key generation, release qualification, or
deployment is authorized here.

## 16. Recall Qualification Compatibility

| Future work | Classification | Constraint |
|---|---|---|
| P-01A characterization | SAFE DURING RECALL NATURAL QUALIFICATION | Temp DB, fixed callback, no provider, no production writes |
| P-01B Mastra/LangGraph parity | SAFE DURING RECALL NATURAL QUALIFICATION | Isolated workspace/stores; no production integration |
| P-01 decision analysis | SAFE DURING RECALL NATURAL QUALIFICATION | Documentation and local fixture evidence only |
| Agent Plugins parser fixture | SAFE DURING RECALL NATURAL QUALIFICATION | Inert local packages; no execution or prompt load |
| Sandbox release-plan review | SAFE DURING RECALL NATURAL QUALIFICATION | Read-only; no Mint/config/key/service change |
| Selected workflow production integration | WAIT UNTIL RECALL CANARY | Changes runtime/recovery and must preserve a clean canary baseline |
| Any production second workflow store | WAIT UNTIL RECALL CANARY | Not accepted; would require a new ADR even after canary |
| Sandbox release qualification/activation | WAIT UNTIL RECALL CANARY | Separate authorization and gate packet required |
| Read-only memory projection | WAIT UNTIL RECALL/MIND STATE/THOUGHT ROLLOUT COMPLETE | Must be tested against settled provenance and forget semantics |
| Agent Plugins runtime and MCP tools | WAIT UNTIL RECALL/MIND STATE/THOUGHT ROLLOUT COMPLETE | Needs capability/tool authority and result quarantine |
| OpenHands or AgentFS | WAIT UNTIL RECALL/MIND STATE/THOUGHT ROLLOUT COMPLETE | Deferred until a concrete post-broker use case |
| Learned autonomy/CSM | WAIT UNTIL RECALL/MIND STATE/THOUGHT ROLLOUT COMPLETE | Separate governance and authority design required |

No foundation experiment may write or manufacture production Recall evaluation,
promotion, canary, or cutover evidence.

## 17. Final Stable Ashley Interfaces

These names describe stable ownership seams, not required new files or classes:

- `AshleyWorkflowRuntime`: technical job invocation/recovery around an
  Ashley-owned atomic callback.
- `MemoryAuthority`: `nuclear.db` plus exact Recall/provenance rules; continuity
  is a separate authoritative sidecar.
- `CapabilityAuthority`: observe/influence, dependencies, contracts, model
  epochs, provenance, promotion, rollback.
- `AshleyAttentionPolicy`: lane, quota, deadline, admission, and budget decision.
- `AshleyToolRuntime`: descriptor admission, scope, credentials, execution class,
  budgets, and receipt requirements.
- `AshleyExecutionBroker`: signed host-mutation boundary; external actions use a
  separate sibling broker.
- `EvidenceResolver`: classification, source, provenance, read records, and
  admissibility before Thought.
- `DeliveryLedger`: inbound claim through receipt-backed finalization.
- `AshleyPluginParser`: future inert package validation only.
- Versioned owner-authenticated service interfaces: transport around semantic
  services, never semantic owners.

## 18. Dependencies Explicitly Rejected

- Restate in P-01B; Temporal, BullMQ, Trigger.dev, and XState as the cognition
  foundation.
- Mastra or LangGraph agent, memory, routing, scheduler, observability UI, or
  tool authority surfaces. Only their smallest workflow/checkpointer packages
  may be tested.
- OpenHands as sandbox/foundation; AgentFS as memory/continuity/authority.
- Writable Graphiti/Zep, Letta, Mem0, LangMem, or other agent-memory authority.
- Early Agent Plugins runtime adoption; “installed means trusted.”
- MCP authentication as Ashley consent or execution authority.
- External telemetry as the authoritative audit/evidence record.
- Any external service whose value is only feature breadth or LOC speculation.

## 19. Implementation Sequence

### Phase A — characterize current cognition

- **Goal:** Implement P-01A exactly as Section 8 specifies.
- **Why now:** Every candidate claim depends on a truthful current contract.
- **Dependencies:** None beyond current test helpers and temporary SQLite.
- **Safe during Recall qualification?** Yes.
- **Decision enabled:** Whether the current loop has a material recovery gap and
  the candidate-neutral parity contract.
- **Stop condition:** All injection points produce deterministic normalized
  traces; no dependency or runtime rewiring has occurred.

### Phase B — real package parity

- **Goal:** Run the same fixture through pinned Mastra and LangGraph adapters in
  separate isolated spike workspaces.
- **Why now:** Fake shapes cannot validate package replay, persistence, or cost.
- **Dependencies:** Accepted P-01A trace/table contract.
- **Safe during Recall qualification?** Yes, under Section 16 constraints.
- **Decision enabled:** Keep current, or select at most one workflow adapter for
  a later integration proposal.
- **Stop condition:** Parity, failure, host-cost, dependency, and exact diff
  reports exist for current + both candidates. No production integration.

### Phase C — foundation selection checkpoint

- **Goal:** Adjudicate P-01 evidence; default to current unless a comparator
  demonstrates material net value.
- **Why now:** Avoid framework accretion before the proof is interpreted.
- **Dependencies:** Phase B.
- **Safe during Recall qualification?** Yes; decision documentation only.
- **Decision enabled:** Close S14 or authorize a separately scoped integration
  design after the Recall canary.
- **Stop condition:** One explicit verdict, no tie-by-accumulation and no more
  than one external workflow dependency proposed.

### Phase D — plugin parser conformance

- **Goal:** Run P-02 as an inert Agent Plugins schema/path/discovery fixture.
- **Why now:** Stable foundation seams are known; the parser can prevent future
  bespoke packaging without distracting from P-01.
- **Dependencies:** Phase C; current Working Draft schema pinned in fixtures.
- **Safe during Recall qualification?** Yes.
- **Decision enabled:** Whether a future `AshleyPluginParser` is cheap and safe.
- **Stop condition:** Parser proof only; no runtime loading, MCP launch, prompt
  injection, credential access, or tool execution.

Sandbox release-plan review may occur as read-only parallel work. Actual release
qualification/activation remains after the Recall canary and requires its own
authorization. No additional foundation phase is approved by this record.

## 20. First Engineering Move

**Implement P-01A: the repository-local, dependency-free
`consolidate_thread` characterization harness.**

Exact scope: temporary SQLite only; synthetic messages and owner; fixed model
callback; current enqueue/claim/recover/retry/worker path; failure injection at
the ten Section 8 points; normalized job/run/semantic/provenance output; zero
production wiring; zero new package; zero Mistral, network, Mint, Recall
evidence, schema, capability, or sandbox changes.

The harness must describe current behavior before declaring the
`AshleyWorkflowRuntime` interface. It must not implement fake Mastra or
LangGraph adapters.

## 21. Decision Queue Remaining

Only empirical questions remain:

1. Which exact Mastra and LangGraph.js package versions are current and mutually
   compatible when P-01B starts? Pin them in the spike evidence, not this ADR.
2. Does either real package pass the P-01A contract with lower total maintenance
   and acceptable Mint cost? Until measured, current Ashley wins by default.
3. What exact code can a passing candidate retire? Only an implementation diff
   may answer; prior LOC ranges are non-authoritative.
4. Can Monoma provide inspectable official documentation, source, license, and
   release evidence? Until then it remains S31 and cannot enter a comparator.

There is no open decision about semantic ownership, authoritative stores,
candidate set, P-01 structure, plugin timing, MCP layering, memory timing,
OpenHands, AgentFS, sandbox ordering, Recall compatibility, or tomorrow's gate.

## 22. Deferred Work

- Learned autonomy, latent-structure/CSM experiments, and substrate-independent
  self-modeling require separate governance, falsifiability, rollback, and
  authority designs.
- Self-modification and external-agency designs remain governed by their own
  wave/release gates; they are not activated by foundation selection.
- Durable human-waiting workflows, generalized schedulers, telemetry exporters,
  read-only memory projections, plugin runtime, MCP tools, coding specialists,
  and portable workspace stores wait for a concrete need and the gates above.
- Retired-surface deletion requires an exact reference audit distinguishing
  obsolete desktop/voice residue from intentional compatibility tombstones,
  archival evaluation fixtures, and honest capability-denial text.

## Appendix A — Significant decision records

### ADR-A1 — Semantic core and stores

- **DECISION:** Keep all semantic authority in Ashley and retain two
  authoritative SQLite stores.
- **STATUS:** Accepted.
- **ACCEPTED OPTION:** `nuclear.db` behavioral authority plus `continuity.db`
  lineage/forget authority.
- **REJECTED OPTIONS:** Framework state as authority; writable external memory;
  merged or replacement store.
- **SOURCE EVIDENCE:** Cognition, capability, continuity, delivery, Recall, and
  provenance modules cited in Section 2.
- **RESEARCH EVIDENCE:** Every candidate provides machinery, not Ashley's
  semantic contracts.
- **RATIONALE:** Truth, consent, forgetting, and influence need one auditable
  owner each.
- **SEMANTIC BOUNDARY:** All belief/memory/decision/consent/delivery meaning is
  local.
- **IMPLEMENTATION BOUNDARY:** Adapters receive IDs and invoke callbacks; they do
  not write semantic tables.
- **RISKS:** Bespoke lifecycle maintenance.
- **REVERSIBILITY:** Machinery can be replaced behind stable seams.
- **CONFIDENCE:** High.
- **NEXT PROOF:** P-01A current contract.

### ADR-A2 — Workflow comparison and P-01

- **DECISION:** Adopt P-01A characterization then P-01B real Mastra/LangGraph
  parity.
- **STATUS:** Accepted for spike, not production.
- **ACCEPTED OPTION:** Comparator set A: current + Mastra + LangGraph.
- **REJECTED OPTIONS:** Fake candidate shapes as parity proof; Restate in first
  comparison; no real-package spike; documentation winner.
- **SOURCE EVIDENCE:** `jobs.ts` and `worker.ts` transaction/recovery seams.
- **RESEARCH EVIDENCE:** Mastra snapshots and LangGraph replay/checkpointers;
  Restate server/store burden.
- **RATIONALE:** Characterization and implementation proof answer different
  questions.
- **SEMANTIC BOUNDARY:** Candidate hosts a callback; Ashley owns its meaning and
  atomic commit.
- **IMPLEMENTATION BOUNDARY:** Isolated fixed fixture, no production wiring.
- **RISKS:** Framework churn, replay effects, dependency growth.
- **REVERSIBILITY:** Delete spike workspace/store.
- **CONFIDENCE:** High on design; candidate outcome unknown.
- **NEXT PROOF:** P-01A.

### ADR-A3 — Technical workflow store

- **DECISION:** Permit a disposable derived store only in P-01B.
- **STATUS:** Accepted for isolated experiment.
- **ACCEPTED OPTION:** Option B.
- **REJECTED OPTIONS:** Artificially storeless real-package test; durable
  production second store.
- **SOURCE EVIDENCE:** Ashley materialization and job completion share one local
  transaction.
- **RESEARCH EVIDENCE:** Mastra and LangGraph persistence features require
  technical storage for meaningful restart tests.
- **RATIONALE:** Test real behavior without conceding authority.
- **SEMANTIC BOUNDARY:** Framework store records technical execution only.
- **IMPLEMENTATION BOUNDARY:** One temp store per candidate with explicit Ashley
  ID mapping and failure reconciliation.
- **RISKS:** False equivalence between checkpoint and semantic completion.
- **REVERSIBILITY:** Delete store and adapter.
- **CONFIDENCE:** High.
- **NEXT PROOF:** Dual-commit failure matrix in P-01B.

### ADR-A4 — Agent Plugins and MCP

- **DECISION:** Parser after P-01; runtime waits for spec maturity; MCP remains
  transport only.
- **STATUS:** Accepted.
- **ACCEPTED OPTION:** `SPIKE AFTER P-01` / `WAIT FOR SPEC MATURITY`.
- **REJECTED OPTIONS:** Early runtime adoption; installed-as-trusted; OAuth as
  Ashley consent.
- **SOURCE EVIDENCE:** Current capability, privacy, sandbox, and evidence gates.
- **RESEARCH EVIDENCE:** Agent Plugins Working Draft and MCP host-owned security
  architecture.
- **RATIONALE:** Capture future interoperability without manufacturing a new
  authority path.
- **SEMANTIC BOUNDARY:** Capability/tool/evidence authority remains Ashley-owned.
- **IMPLEMENTATION BOUNDARY:** Parser emits inert descriptors; runtime later
  passes through ToolRuntime and broker.
- **RISKS:** Spec churn, path injection, prompt/tool trust confusion.
- **REVERSIBILITY:** Parser fixture is removable and side-effect free.
- **CONFIDENCE:** High.
- **NEXT PROOF:** P-02 after P-01.

### ADR-A5 — Memory and optional substrates

- **DECISION:** Research read-only memory projection later; defer OpenHands and
  AgentFS.
- **STATUS:** Accepted.
- **ACCEPTED OPTION:** Current SQLite/FTS now; later rebuildable projection;
  optional specialist/substrate only on a concrete use case.
- **REJECTED OPTIONS:** Writable external memory authority; OpenHands/AgentFS as
  foundation or broker replacement; early spikes.
- **SOURCE EVIDENCE:** Recall, continuity, classification, sandbox workspace and
  receipt semantics.
- **RESEARCH EVIDENCE:** OpenHands Docker runtime and AgentFS beta SQLite/FUSE
  substrate.
- **RATIONALE:** Neither retires proven core today; both add operational and
  authority ambiguity.
- **SEMANTIC BOUNDARY:** Recall and execution consent stay local.
- **IMPLEMENTATION BOUNDARY:** Future components, if any, sit behind read-only
  projection or signed broker interfaces.
- **RISKS:** Forgone near-term feature breadth.
- **REVERSIBILITY:** Fully reconsiderable on a bounded use case.
- **CONFIDENCE:** High now; medium for future economics.
- **NEXT PROOF:** None until rollout/use-case prerequisites are met.

### ADR-A6 — Sandbox ordering and Recall

- **DECISION:** Activate only after the natural Recall canary; allow read-only
  planning earlier.
- **STATUS:** Accepted ordering; activation unauthorized.
- **ACCEPTED OPTION:** Option D.
- **REJECTED OPTIONS:** Before spikes, parallel activation, immediately after
  P-01.
- **SOURCE EVIDENCE:** Sandbox is Wave-accepted but not release-qualified or
  deployed; boot flags default disabled; current client/broker seams exist.
- **RESEARCH EVIDENCE:** No external framework is needed for activation.
- **RATIONALE:** Preserve canary causal clarity and avoid expanding live
  authority without a current execution need.
- **SEMANTIC BOUNDARY:** Sandbox executes only exactly authorized work.
- **IMPLEMENTATION BOUNDARY:** Separate release-qualification and deployment
  gate after canary.
- **RISKS:** Delayed availability of safe host execution.
- **REVERSIBILITY:** Ordering can be revisited only with new operational need and
  explicit authorization.
- **CONFIDENCE:** High.
- **NEXT PROOF:** Natural Recall canary, then an authorized sandbox release gate.

## Appendix B — Adversarial self-critique

The final draft was attacked against the Goal's questions before acceptance:

- No framework is selected because of popularity or feature breadth. The two
  included packages are comparator-only and test distinct local persistence and
  replay claims. Current Ashley wins by default.
- The review did not preserve every bespoke mechanism: S10, S13, S17, S21, S22,
  and S25 expose narrow machinery seams. Conversely, it rejected wrappers whose
  supposed machinery was already owned by another subsystem.
- The cognition materialization transaction remains visible and authoritative;
  no adapter may hide, split, or replay it.
- Restate and Temporal were excluded precisely because a new service/store would
  solve a scale/reliability hypothesis not yet demonstrated by this SQLite
  workload.
- Framework checkpoints are technical records only. The dual-store matrix makes
  Ashley completion authoritative in both asymmetric failure directions.
- Agent Plugins stays inert at parsing; MCP OAuth stays transport
  authentication; OpenHands stays behind the signed broker; external memory
  stays read-only and non-authoritative.
- Recall-safe work uses only synthetic inputs and disposable stores. Production
  workflow integration and sandbox activation wait for the natural canary.
- No production dependency is accepted. Candidate packages are temporary spike
  inputs and must justify themselves by measured reliability/maintenance value
  plus an exact retire/add diff.
- P-01A can change a decision: it may show that the current loop already meets
  the needed contract, expose a missing lease/recovery guarantee, or invalidate
  the proposed comparator interface before dependencies are added.

Corrections made because of this pass: fake framework-shaped adapters were
removed from P-01A; Restate was removed from P-01B; five misplaced Pass-2
wrappers were rejected; sandbox replacement LOC ranges were marked
non-authoritative; and live sandbox activation moved behind the Recall canary.
