# Ashley Architecture Salvage Map v2

> **STATUS: HISTORICAL DECISION SURFACE**
>
> This document preserves the 2026-08-09 subsystem adjudication. The current
> roadmap and later substrate dispositions are governed by the
> [Canonical Architecture Roadmap](Ashley_Architecture_Roadmap.md).

**Status:** Accepted decision surface

**Date:** 2026-08-09

**Canonical rationale:** [`Ashley_Foundation_Architecture_Decision_v1.md`](Ashley_Foundation_Architecture_Decision_v1.md)

**Baseline:** `0efb0250989e2b67a9b0b3d7e8fce81568ae0975`

## Disposition legend

- **KEEP:** Ashley keeps semantic ownership and the present local implementation;
  only already-owned shared boundaries may carry generic transport.
- **KEEP CORE + WRAP:** Ashley keeps semantic authority; a narrow, already
  isolated mechanical seam is explicitly replaceable. This does not authorize a
  dependency or port.
- **WRAP:** Keep Ashley's decision policy and expose only generic transport,
  dispatch, or wake mechanics behind it.
- **SPIKE:** No production selection; run the named bounded proof first.
- **DEFER / RESEARCH / DELETE:** No implementation in the foundation cycle.
- **Safe before Recall canary:** “Yes” means only under the stated isolated,
  non-production proof. It never authorizes production integration or evidence
  writes.

## Final 31-subsystem decision surface

| ID | Subsystem | Final disposition | Semantic owner | Replaceable machinery | Selected candidate | Accepted seam | Principal risk | Proof required | Timing | Safe before Recall canary? |
|---|---|---|---|---|---|---|---|---|---|---|
| S01 | Governance and constitution | KEEP | Governance authority chain | NONE | NONE | Document review only | Framework/prompt outranks constitution | Precedence review on every foundational change | Continuous | Yes, docs only |
| S02 | Identity and foundational review | KEEP | Identity + owner review authority | Shared HTTP serialization only (S17) | NONE | Existing store/revision/review boundary | Model or wrapper mutates foundational identity | Exact revision ID, provenance, owner action, atomic apply | Keep current | N/A |
| S03 | Mind State, affect, own-time | KEEP | Mind State | Shared job invocation only (S14) | NONE | Existing state transactions | Shadow/technical state becomes lived condition | Capability/provenance and atomic state tests | Keep current | N/A |
| S04 | Thought and Agency | KEEP | Thought + Agency | Provider envelope already in S11/S13 | NONE | `decide` -> validated Thought -> authorized Decision | Replay duplicates or framework owns decision | Deterministic floor, refusal, evidence, authorization tests | Keep current | N/A |
| S05 | Context composition | KEEP | Evidence resolver + ContextComposer | NONE | NONE | Transport-only assembly | Retrieval leaks or reconstructs Thought | Source/provenance and no-new-decision tests | Keep current | N/A |
| S06 | Expression and rendering | KEEP | Expression; Rendering mechanics | Typography/bubble mechanics only | NONE | Decision in, language/bubbles out | Expression gains refusal/authorization authority | Decision-intent and delivery-boundary tests | Keep current | N/A |
| S07 | Recall and redaction | KEEP | Recall + MemoryAuthority | Optional derived query index later | Current SQLite/FTS | Exact source/entity/tombstone APIs | False continuity or incomplete erasure claim | Natural Recall qualification; exact provenance/redaction | Current rollout | No production changes |
| S08 | Reflection and learning | KEEP | Reflection + revision authority | Shared invocation only (S14) | NONE | Bounded post-outcome callback | Replay applies calibration twice/current turn | Provenance, exact revision, mode, idempotency tests | Keep current | N/A |
| S09 | Relationship state | KEEP | Relationship State | Shared route formatting only | NONE | Typed relationship records/motivations | Engagement metric replaces reciprocal meaning | Observe/apply gate and grounded claim tests | Keep current | N/A |
| S10 | Curiosity and public reading | KEEP CORE + WRAP | Curiosity policy + EvidenceResolver | Public HTTP/feed transport | Current bounded Node transport | `fetchValidatedResource` returns untrusted bounded bytes | SSRF, source influence, provenance loss | Redirect/DNS/size/time/evidence parity | Keep current; replace only on need | Yes, isolated transport proof only |
| S11 | Model routing | KEEP | Ashley routing policy | Provider SDK transport | Current Mistral client | `completeChat` behind attention/capability policy | Framework fallback changes semantics/cost | Route and capability contract regression tests | Done/keep current | N/A |
| S12 | Capability/provenance authority | KEEP | CapabilityAuthority | NONE | NONE | Explicit influence check/cutover/rollback APIs | Observe evidence time-shifts into influence | Contract/model epoch/provenance/cutover proofs | Keep current | N/A |
| S13 | Attention admission | WRAP | AshleyAttentionPolicy | Queue dispatch/storage mechanics if proven | NONE | Admission decision before provider call | Generic queue owns priority or bypasses budget | Lane/quota/deadline/restart parity and exact diff | Later, not foundation | Yes, isolated proof only |
| S14 | Cognitive jobs and worker | SPIKE | Cognition semantic callback + CapabilityAuthority | Claim, retry, recovery, loop | Current baseline; Mastra + LangGraph comparator only | Candidate-neutral `AshleyWorkflowRuntime` around atomic callback | Duplicate model/materialization; split completion truth | P-01A then real P-01B parity/failure/host-cost matrix | First foundation cycle | Yes, temp DB/stores only |
| S15 | Delivery ledger | KEEP | DeliveryLedger | Attempt transport only | NONE | Claim/reserve/bubbles/receipts/finalize | Draft or partial send becomes memory | Duplicate/partial/restart/receipt tests | Keep current | N/A |
| S16 | Discord boundary | KEEP | Discord adapter + DeliveryLedger | Gateway library transport | Current discord.js | Merge/dedup input and ledgered output | Duplicate turn/send; non-Discord revival | Fragment/idempotency/receipt parity | Keep current | N/A |
| S17 | HTTP/API boundary | WRAP | Owner auth + semantic service owners | HTTP routing/serialization | Current Express | Versioned owner-authenticated service interfaces | Wrapper bypasses auth/redaction | Route manifest, owner scope, lifecycle, redaction tests | Later, only on measured burden | Yes, isolated adapter proof only |
| S18 | Nuclear SQLite schema | KEEP | MemoryAuthority + subsystem repositories | NONE | `node:sqlite` | Ashley-owned repositories/transactions | Split source of behavioral truth | Migration, transaction, backup, capability proofs | Keep current | N/A |
| S19 | Continuity sidecar | KEEP | ContinuityAuthority | NONE | `node:sqlite` | Strict lineage/tombstone/session APIs | False forget or lineage mismatch | Fail-closed lineage, exact preview, replay, backup tests | Keep current | N/A |
| S20 | Privacy/classification | KEEP | Classification + EvidenceResolver | Parser helpers only | NONE | Fail-closed class/quote/public-read boundary | Secret/private data crosses model/tool boundary | Classification, secret omission, quote/evidence tests | Keep current | N/A |
| S21 | Sandbox client and policy | KEEP CORE + WRAP | Capability/approval/tombstone policy | Unix framing, serialization, copy helpers | Current typed client; no replacement | `SandboxBrokerClient` and signed request contracts | Scope widening or second execution path | Protocol, signature, path, replay, recovery parity | Keep current; future security spike only | Yes for isolated proof; no activation |
| S22 | Sandbox broker | KEEP CORE + WRAP | OS execution broker authority | Existing process runner/workspace/frame interfaces | Current broker; no replacement | Fixed recipe + disposable workspace behind signed broker | Substrate weakens containment/receipts | Independent threat model, Mint host, rollback, exact diff | Keep current; no early port | Yes for read-only/local proof; no activation |
| S23 | Self-modification proposals | DEFER | Change-proposal governance + broker | Future workflow caller | NONE | Existing design and accepted local implementation remain gated | Premature self-change/live repo access | Separate release qualification and approval evidence | After prerequisites/use case | No |
| S24 | External agency broker | KEEP | Separate external-action authority | Provider transports | Current broker design/implementation | Vault/dispatch sibling, never sandbox credential path | Public action or credential leakage | Exact approval, vault, receipt, rollback, release gate | Keep gated | No production changes |
| S25 | Initiative scheduling | WRAP | Agency | Timer/jitter/health wake mechanics | Current scheduler | Wake event only; Agency re-evaluates | Timer becomes personality or auto-send | Pause/idle/urgent/reservation/commit parity | Later, low value | Yes, isolated scheduler proof only |
| S26 | Qualification/evaluation | KEEP | Ashley acceptance protocol | Generic test runner/report formatting | Current Node tests/scripts | Deterministic gates + evidence packets | Demo/test mistaken for release | Gate ladder, counterevidence, live/local distinction | Continuous | Yes, local evidence only |
| S27 | Observability/diagnostics | KEEP | Semantic record owners | Additive redacted exporter only (S17 seam) | NONE | Owner-only diagnostic contracts | External trace leaks data or becomes truth | Auth/redaction/status-semantic parity | Keep current | N/A |
| S28 | Retired legacy surface | DELETE | Current architecture/governance | Obsolete desktop/voice/live residue | NONE | Exact reference-audit deletion set | Deletes compatibility tombstones or archival tests | Tracked-reference/build/package/route audit first | Separate cleanup after foundation decision | Yes for audit; deletion separately authorized |
| S29 | Plugin/tool interoperability | SPIKE | CapabilityAuthority + ToolRuntime + EvidenceResolver | Package parsing and MCP transport | Agent Plugins parser after P-01; runtime NONE | Inert descriptor -> admission -> transport -> broker -> evidence | Installed becomes trusted; path/secret/tool injection | P-02 schema/path fixtures; runtime waits maturity | After P-01 | Yes, parser fixture only |
| S30 | Learned autonomy/CSM | DEFER | Future reviewed governance path | Future research tooling | NONE | No runtime seam accepted | Self-description becomes self-authority | Separate falsifiable design, rollback, owner review | Later | No |
| S31 | Unresolved external research | RESEARCH | Architecture research ledger | NONE | Monoma unresolved | Authoritative evidence before candidacy | Marketing/unknown system influences foundation | Official docs, source, license, releases; bounded recheck | On new evidence only | Yes, read-only research |

## Foundation selection summary

| Category | Decision |
|---|---|
| Accepted now | Ashley semantic core; `nuclear.db`; `continuity.db`; current cognition loop; current delivery, capability, privacy, HTTP, Discord, and signed sandbox boundaries |
| Comparator only | Real pinned Mastra and LangGraph.js packages in P-01B, after P-01A |
| Derived store permission | Disposable candidate checkpoint store in isolated P-01B only |
| Deferred | Memory projection; Agent Plugins runtime; MCP tools; OpenHands; AgentFS; self-modification activation; learned autonomy/CSM |
| Rejected as foundation | Restate, Temporal, BullMQ, Trigger.dev, XState, writable external memory, framework routing/identity/agency, OpenHands/AgentFS authority |
| First gate | P-01A dependency-free `consolidate_thread` characterization harness |
