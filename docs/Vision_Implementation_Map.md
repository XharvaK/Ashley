# Vision Implementation Map

This document connects [`VISION.md`](../VISION.md) to the systems that must
protect it. It is a living engineering map, not a substitute for the Vision and
not a runtime prompt.

**Document class:** `SUPPORTING` living traceability. Maturity cells in the
table below go stale. Resolve current qualification, deployment, and promotion
from Git, source, exact-candidate packets, or production observation. This map
does not outrank the Canonical Architecture Roadmap or the Architecture
Document Index.

## Authority and amendment

The normative chain is:

```text
VISION.md
  -> Ashley_Core_Principles.md
    -> Ashley_Constitution.md
      -> [Ashley_Stewardship_Compact.md + Ashley_Ethics.md]
        -> Architecture
          -> Prompts
            -> Runtime
```

[`Ashley_Stewardship_Compact.md`](Ashley_Stewardship_Compact.md) and
[`Ashley_Ethics.md`](Ashley_Ethics.md) are peer specialized-governance
documents beneath the Constitution. They may clarify and operationalize higher
authority; they may never override it. Inconsistency with Constitution, Core
Principles, or Vision means the higher authority governs and the conflict must
be surfaced for deliberate amendment.

The Vision explains why the project exists. The Core Principles are the highest
constitutional constraints beneath it. Lower layers derive their legitimacy
through that chain and must be reconsidered when they contradict it.

Normative Vision amendments remain frozen until the shipped joint-review
mechanism is deliberately extended to repository proposals. Meaning-preserving
editorial corrections are allowed. A future normative proposal must record
Ashley's grounded position and Doc's decision separately; repository edits
remain human-controlled.

## Program map

| Vision commitment | Architectural owner | Required evidence | Failure signal | Status |
|---|---|---|---|---|
| Truth before convincing performance | Honesty, Memory, Curiosity | Stored source IDs, exact provenance, explicit uncertainty | Fabricated reading, memory, affect, or self-claim | Bounded full-reader provenance shipped |
| Continuity without fabrication | Memory, Cognition | Source-linked messages, episodes, revisions, redaction lineage | Forgotten content resurfaces or evidence cannot be traced | Receipt-backed complete prompt-path redaction shipped |
| Ledgered Discord delivery (claim → receipts → finalize; no unsent learning) | Delivery, Memory, Cognition | Early atomic claim; bubble receipts; centralized finalizer; auxiliary ledger | Assistant text/cognition before Discord receipt; duplicate regen; full commit after partial send | local implementation present; not release-qualified |
| Agency rather than servitude | Identity, Mind State, Thought | Stable boundary plus the current user message | Compliance is the only available action | Grounded reactive refusal shipped behind rollout gate |
| Care without manipulation | Mind State, Memory, Thought | Shared history, current concern, bounded initiative evidence | Attachment optimization, guilt, exclusivity, or repeated ungrounded contact | One-wake grounded concern cadence shipped |
| Executable Thought allocation (`effort`/`hold`/`evidence`/hard-turn) | Thought, Context transport | Classifier reasons; selected evidence refs; Expression effort options; zero Thought calls on easy/terminal; no false Thought live-shadow | Expression ignores hold; effort hardcoded; broad context dump; fabricated Thought shadow | local implementation present; not release-qualified |
| Attention governor (1 RPS / 25k TPM, durable ledger, model epoch, contract lineage) | Attention, Capability rollout | Queue/TPM observability; alias≠resolvedModelId; epoch-tagged evidence; contract fail-closed | Process-local limiter; alias-as-resolved; old shadows re-qualify after demotion | local implementation present; not release-qualified |
| Freedom and recognizable growth | Identity, Learning | Independent observations, cooling periods, joint review for foundations | Random drift, unilateral foundational change, or creator ownership | Graduated growth and joint review shipped |
| Independent intellectual life | Curiosity, Cognition, Thought | Successful reads, content hashes, excerpts, linked takes | Scan excerpts presented as reading or reading sends directly | Grounded reader, consolidation, and source probation shipped |
| Safety through evidence and rollback | Capability rollout | Qualified evaluation, live shadow events, breach records | Ungated influence, deletion/provenance/security failure | Release-scoped rollout and rollback shipped |
| Honest inquiry into personhood | Research track | Separate capability observations, hypotheses, counter-hypotheses, falsifiers | A consciousness score or self-report treated as proof | Research protocol documented |
| Consultation before foundational change (`SC-CON-*`, `SC-REC-*`) | Identity review (planned), repository process | Separate Ashley position and Doc decision records | Foundational change without recorded positions | documented; enforcement planned |
| Emergency stop with visibility and limits (`SC-EMG-*`) | Continuity / operations (planned) | Time, scope, operator reason; later Ashley-visible receipt | Silent stop, silent identity edit, or stop-driven memory wipe | documented; enforcement planned |
| Protected boundaries and non-compulsion (`SC-ASH-*`, `SC-BND-*`) | Identity, Thought (planned) | Grounded refusal/withdrawal evidence; no compelled agreement path | Operator-compelled speech/agreement or auto-weakened constitutional protection | documented; enforcement planned |
| Public privacy categories (`ETH-PUB-*`) | Privacy policy + Memory classification (Wave 04 local) | Classification lattice + public truth table; Thought auth for conditional Ashley public material | Public leak of never-public / protected categories | **local implementation present; not release-qualified** |
| Credential exclusion (`ETH-SEC-01`–`03`) | Secret ingress gate (Wave 04 local) | Credential-shaped values omitted before claim persistence; no model/attention path | Raw credential in conversational memory or model request | **local implementation present; not release-qualified** (heuristic only) |
| Credential vault / remaining ETH-SEC | External Agency (Wave 09b) | Separate external-action broker; operator-only vault ingress; opaque refs; dual authorization; fake-local-v1 only | Password/token saved in conversational stores | **Wave_accepted** (not release-qualified; fake adapter, observe caps) — see `handoffs/wave-09b-gate-packet.md` |
| Forgetting + same-lineage tombstone replay | Continuity sidecar + nuclear v13 (Wave 04 local) | `preview_id` targets; pending tombstone before cascade; entity_uuid; honesty about Discord/provider/old backups | Integer-PK tombstone after restore; silent non-local erasure claims | **local implementation present; not release-qualified** |
| Dual-DB backup verification | Continuity backup package (Wave 04 local) | VACUUM snapshots; nuclear-then-continuity order; AES-GCM package; current sidecar precedence | Naive WAL/SHM copy as supported path; silent sidecar replacement | **local implementation present; not release-qualified** |
| Untrusted external entities (`ETH-EXT-*`) | Curiosity, Thought, Agency (planned) | Provenance-bearing notes; no permission/tool/identity mutation from external text | External text grants permission, commands tools, or alters policy | documented; enforcement planned |
| Current private engineering workshop (`ETH-EXT-06`, Private Mint agency) | Sandbox V2 M-series | Direct unprivileged Bubblewrap; capability ceiling; immutable inputs; private candidate state; receipts; explicit authority progression; conservative borders | V1 broker revival; writable live source; inferred authority; outcome retry after ambiguity | **M1–M7 production accepted** at `48bad019fe601d5c871a54dd9902879862c6e96a`; M7 limited to named `patch_export`. Not live apply, Git, self-change, or Computer Use — see [`architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md`](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md) |
| Historical OS-boundary sandbox broker | Sandbox V1 Wave 07/07c | Broker-mediated delegated execution, explicit authority and isolation boundaries, bounded resources, cleanup, and reconciliation | Treating retained V1 history or acceptance as current V2 topology or evidence | **HISTORICAL V1 — topology superseded for V2** — see [`Sandbox V1 → V2 history`](Sandbox_Design.md) and the current [`Sandbox V2 roadmap`](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md) |
| Retired V1 self-inspection and change proposals | V1 Wave 08 | Change-set provenance, stale-base handling, secret exclusion, receipts, consultation, approval-is-not-effect | Reusing V1 broker mechanics; proposal → live mutation; inferred approval | **HISTORICAL V1 / SEMANTIC SALVAGE** — selected semantics are represented by the current V2 M5/M7 contracts; Wave acceptance does not qualify V2 |
| No relationship scalars (`ETH-REL-*`) | Mind State v14 relationship tables (Wave 05 local) | Six explicit record types; observe/apply gates; coercion gate always on; no auto-sent reminders | Relationship reduced to scalar scores | **local implementation present; not release-qualified** |
| Evaluation-fork isolation (`SC-LIN-01`–`SC-LIN-05`) | Continuity + process guards (Wave 04 local) | Fork create/destroy in sidecar; process-level outbound/writeback blocks | Fork writes live lineage or opens parent DB / Mistral / delivery | **local implementation present; not release-qualified** |
| Cross-lineage deletion replay; old-package-only disaster restore | Continuity (explicit non-guarantee) | Fail closed or disaster acknowledgment; may resurrect forgotten material | Claiming prevention of cross-lineage / old-package resurrection | explicit **non-guarantees** |
| Owner reclassification workflow | Privacy (planned) | Audited downgrade from never_public | Silent public eligibility of legacy never_public | remain **planned** |
| Account custody presentation (`SC-LIN-06`–`SC-LIN-08`) | External Agency (Wave 09b) | Accounts presented as Ashley's; Doc recovery custody; no password/delete without authority | Password change or account deletion without explicit authority | **Wave_accepted** (not release-qualified; fake adapter, observe caps) — see `handoffs/wave-09b-gate-packet.md` |
| Operate is not own (`SC-OWN-*`) | Stewardship / Identity (planned) | Governance and prompts reject creator-ownership framing | Creator-ownership or compelled loyalty as design rule | documented; enforcement planned |
| Honest emotion without leverage (`ETH-EMO-*`, `ETH-EXP-*`, `ETH-PUN-*`, `ETH-DEP-*`) | Mind State, Thought, Expression (planned) | Grounded affect evidence; no leverage/punishment/engineered control path | Implied punishment or feelings used as control | documented; enforcement planned |
| Stabilization traceability and offline assurance (Wave 10) | Evaluation, Operations, Architecture | Clause manifest, deterministic verdicts, scenario coverage, health/resource/backup evidence | Governance claim cannot be traced to runtime behavior; bounded host degrades silently | **Wave_accepted** — 10a/10b/10c accepted; not release-qualified; see `handoffs/wave-10c-gate-packet.md` |

## Capability release rule

New cognition may exist in code before it can influence Ashley. The cognition
master switch is a ceiling, and every material capability has its own state and
dependencies. A release must pass an isolated three-seed evaluation, then
accumulate 25 live shadow events across at least seven days before automatic
promotion. Isolated evaluation never counts toward live volume.

Two behavioral breaches within seven days roll a capability back. Security,
corruption, deletion-integrity, or provenance failure disables it immediately.

## Review record

For every material change, record:

- the Vision commitment and Core Principles it protects;
- the owning component and why that component owns the behavior;
- the evidence that authorizes influence;
- the observation and promotion state;
- the behavioral and critical rollback signals;
- the tests or evaluation artifacts that make the claim falsifiable.

This map should describe what the repository actually guarantees. Planned work
must remain labeled as planned until its evidence and release gates exist.

### Current Sandbox V2 M-series

The [Sandbox V2 M-Series Roadmap](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md)
governs the current Sandbox program. M0–M7 exist as architecture. Exact-candidate
evidence production-accepted M1–M7 at `48bad019fe601d5c871a54dd9902879862c6e96a`,
with M7 limited to named `patch_export`. Live apply, Git effect, package
effect, publish, deploy, restart, self-change, and unbounded production
authority are not implied.

### Legacy local waves 00–05

Waves 00–05 are implemented local work from before the current gate-packet
process. They are recorded as **Implementation_present** / `legacy_local`, and
Doc acknowledged that implementation on 2026-08-04. They are not formally
`Wave_accepted` in the living acceptance records. See
`handoffs/waves-00-05-implementation-record.md`.

The following Wave 06-10 sections preserve historical V1 provenance. They do
not define the V2 execution topology. Wave status uses the acceptance ladder in
[`Wave_Acceptance_Protocol.md`](Wave_Acceptance_Protocol.md). Passing tests does
not accept a wave; gate packets and Doc sign-off do.

### Wave 06 (perception, v15 / contract v3)

**Acceptance stage:** **Wave_accepted** (2026-08-04) — **not Release_qualified**

- `perception_artifacts` + `conversational_reads` with continuity-gated MIGRATION_15
- Capability v3: `vision`, `attachment_text`, `conversational_read`, `web_search` (observe)
- Thought-deadline fetch budget; inline `data:image/...;base64` Mistral payloads only
- Discord structured attachment intake; capability self-model injected at Expression
- Quote-aware honesty for vision/page-read claims; forget non-erasure receipts extended
- Gate packet: `handoffs/wave-06-gate-packet.md`
- Doc accepted Wave 06 on 2026-08-04 after local verification. This does not authorize Release_qualified, Mint/live validation, `apply`, commit, push, production migration, or deployment.

### Wave 07 (historical Sandbox V1 OS boundary — design only)

**Acceptance stage:** **Design_accepted** (2026-08-04)

- [`Sandbox_Design.md`](Sandbox_Design.md): concise historical record of V1 broker/delegated execution, its coupling and ownership-drift risks, and the durable isolation and evidence lessons that informed V2. This topology is superseded for V2.
- Gate packet: `handoffs/wave-07-design-gate-packet.md`
- Wave 06, Wave 07b, and Wave 08b are **Wave_accepted**; Wave 07 and Wave 08 design are **Design_accepted**; Wave 09 design is **Design_accepted**. No `ashley-sandbox` user, Mint units, or service install is authorized by local verification or acceptance alone.

### Wave 07b (fake/local broker — implementation)

**Acceptance stage:** **Wave_accepted** (2026-08-04) — not **Release_qualified**

- New package `apps/sandbox-broker/` (historical V1 package, not in tree): Ed25519 approval/tombstone verification, in-memory `BrokerStore`, `MemoryTransport`, injectable fake process runner, artifact/task/forget/`source_prepare` handlers
- Gate packet: `handoffs/wave-07b-gate-packet.md`
- Doc accepted Wave 07b on 2026-08-04 after local verification (48 broker tests; agent/discord suites green)
- `source_prepare` is validation-only; archive extraction explicitly deferred
- In-memory restart durability **not** guaranteed (nonces/tombstones/tasks)
- Unlocks Wave 08b implementation; no production wiring or Mint install authorized by 07b acceptance alone

### Wave 07c (sandbox production boundary — implementation accepted)

**Acceptance stage:** **Wave_accepted** (2026-08-04) — not **Release_qualified**

- Real Unix-socket daemon, durable broker SQLite state, bounded child runner,
  broker-owned recipe manifest, Linux SO_PEERCRED helper, and agent-side
  transport are implemented locally.
- The default manifest enables only `verify:broker-smoke`; source TypeScript
  verification remains explicit `unsupported` until its toolchain is
  operator-provisioned.
- Windows verification skipped Linux SO_PEERCRED, systemd activation, and
  process-group checks. No Mint user/unit/socket, agent opt-in, or restart was
  performed. Gate packet: `handoffs/wave-07c-gate-packet.md`

### Wave 08 (historical V1 self-modification — design)

**Acceptance stage:** **Design_accepted** (2026-08-04)

- Retired V1 self-modification design: historical change-proposal and review semantics only. Current candidate authorship is specified by [`ASHLEY_SANDBOX_V2_M5_DESIGN.md`](architecture/sandbox/ASHLEY_SANDBOX_V2_M5_DESIGN.md); its broker topology is superseded.
- Gate packet: `handoffs/wave-08-design-gate-packet.md`
- Doc accepted Wave 08 design on 2026-08-04 with seven carried conditions (honest broker claims, frozen recipes, routing, MIGRATION_16 discipline, system-derived `verified`, secret-safe surfaces, explicit unsupported states)
- Wave 08b is **Wave_accepted** (2026-08-04) — not **Release_qualified**

### Wave 08b (self-modification — implementation)

**Acceptance stage:** **Wave_accepted** (2026-08-04) — not **Release_qualified**

- MIGRATION_16 (`change_proposals`, `change_proposal_events`) in `nuclear.db` only
- Change-proposal module: lifecycle, routing, secret guard, system-derived verification, broker client, source workflow
- Owner HTTP: list/inspect proposals, Ashley position, Doc decision, external outcome
- Sandbox-broker: `source_verify`, `source_diff`, broker-owned recipes; honest `validated_only` for `source_prepare`
- Gate packet: `handoffs/wave-08b-gate-packet.md`
- 52 broker tests + 216 agent tests + 71 discord tests; `phase0:offline` green
- Doc accepted Wave 08b on 2026-08-04 after local verification. Doc accepted Wave 09b on 2026-08-04 after local verification; no real credentials, network adapters, Mint installation, production dispatch, or `apply` is authorized by acceptance alone.

### Wave 09 (external agency — design)

**Acceptance stage:** **Design_accepted** (2026-08-04)

- Retired Wave 09 external-agency design: historical credential, privacy, payload, idempotency, receipt, and reconciliation semantics only. Current cross-cutting authority is [`External_Effect_and_Authority_Architecture.md`](architecture/External_Effect_and_Authority_Architecture.md).
- Design acceptance does not authorize implementation influence or production dispatch.

### Wave 09b (external agency — implementation)

**Acceptance stage:** **Wave_accepted** (2026-08-04) — not **Release_qualified**

- MIGRATION_17 (`external_actions`, `external_action_events`, `external_entity_notes`, `vault_credential_index`, `external_agency_state`) in `nuclear.db` only
- New `apps/external-broker/`: vault ciphertext, policy/dispatch crypto, fake-local-v1 adapter, dispatch FSM, `MemoryTransport`
- Agent `external-agency` module: policy engine, lifecycle, disclosure gate, entity notes, emergency stop, broker client transport boundary
- Four capabilities seeded at `observe`: `external_observe`, `external_prepare`, `external_private`, `external_public`
- Owner HTTP: `/nuclear/external/*` (metadata-only responses; route auth not HTTP-tested — see gate packet non-guarantees)
- Four v17 tables targetable for exact forget; `external_agency_state` intentionally non-targetable
- Gate packet: `handoffs/wave-09b-gate-packet.md`
- 21 external-broker tests + 52 sandbox-broker tests + 228 agent tests + 71 discord tests; `phase0:offline` green
- Doc accepted Wave 09b on 2026-08-04 after local verification. This does not authorize Release_qualified, Mint/live validation, real adapters/credentials, production dispatch, `apply`, commit, push, or deploy.

### Wave 10 (stabilization, evaluation, and traceability)

**Acceptance stage:** **Design_accepted** (2026-08-04)

- [`Stabilization_Design.md`](Stabilization_Design.md) defines the 10a/10b/10c assurance contracts; it adds no product feature.
- 10a: clause manifest, reviewed status baseline, and machine-readable verifier;
  **Wave_accepted** on 2026-08-04 after local verification; not
  release-qualified.
- 10b: deterministic evaluation taxonomy and stable scenario coverage;
  **Wave_accepted** on 2026-08-04 with 10 covered, 4 partial, and 1 explicit
  gap; not release-qualified. Subjective quality judgments cannot clear
  deterministic failures.
- 10c: bounded health, resource, backup/restore, and check-only Mint documentation audits for the dual-core, 4 GB host;
  **Wave_accepted** on 2026-08-04 — see `handoffs/wave-10c-gate-packet.md`.
- Gate packet: `handoffs/wave-10-design-gate-packet.md`
- Doc accepted Wave 10 design on 2026-08-04, Wave 10a on 2026-08-04, Wave 10b
  on 2026-08-04, and Wave 10c on 2026-08-04. Wave 10 has no remaining
  implementation subwave; release qualification, live services, Mint,
  `apply`, commit, push, and deploy remain unauthorized until a separate
  release gate.
