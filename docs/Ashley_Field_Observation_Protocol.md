# Ashley Field Observation Protocol

**Status:** OWNER / FRONTIER REVIEW CANDIDATE after REPAIR_REQUIRED reconciliation. Not in Project Ashley git yet.
**Canonical path after acceptance:** `docs/Ashley_Field_Observation_Protocol.md`
**Document class:** `SUPPORTING` operational/evaluation procedure. Not an architecture owner. Not Class F evidence. Path is settled. Do not reopen a docs-path fork.
**Ops copy:** `/workspace/ops/observer/Ashley_Field_Observation_Protocol.md` is coordination only (D-022). `00 Protocol/Field Observation Protocol.md` in the Field Lab is a placeholder, not canonical.

**Date:** 2026-08-27
**Author:** Observer (`5a8c851f-3c32-457f-a3b4-80aae222cae2`)
**Policy:** D-022, D-023. Scarcity: D-018C CONSERVE exception for one bounded daily synthesis pass once an authorized evidence path exists.
**This document does not authorize:** exporter implementation, a live daily routine, mint mutation, C1–C5 implementation, qualification traffic, cutover, promotion, production deploy, cloning `XharvaK/ashley-field-lab` onto cloud, installing Obsidian on grok-bot-cloud-linux, or redesigning the vault.

```text
OBSERVER != ASHLEY COGNITION
OBSERVER != IMPLEMENTATION WORKER
OBSERVER != MEMORY AUTHORITY
OBSERVER != QUALIFICATION AUTHORITY
OBSERVER != PRODUCTION AUTHORITY
OBSERVER != PROMOTION AUTHORITY
ANALYSIS != TRUTH
SUMMARY != SOURCE
OBSIDIAN COPY != PRODUCTION DB
FIELD LAB GIT = NOTEBOOK
A NOTE IS NOT COGNITIVE TRUTH
A COMMIT PROVES NOTEBOOK HISTORY, NOT TRUTH OF CONTENTS
VAULT READY != OBSERVER PIPELINE READY
TELEMETRY != EVIDENCE
OBSERVABILITY != EVALUATION != QUALIFICATION != PROMOTION
LOCAL_SETTLED != OWNER_ACCEPTED != QUALIFIED != PROMOTED != PRODUCTION_ACCEPTED
WORKTREE NAME != AUTHORITY
BRANCH NAME != CURRENTNESS
EXACT LINEAGE DECIDES
```

Central question, after the field day:

> What actually happened in Ashley's cognition and behavior today, what does the evidence support, what remains uncertain, and what should we observe tomorrow?

---

## 0. Inspection identities for this draft

These are **inspection facts**, not architecture law. Do not copy them into later daily reports as if they were live production.

These SHAs are dated inspection facts. They are not architecture law. Daily reports bind to the running identities in section 5, not to this table.

| Surface | Identity observed 2026-08-27 (frontier repair) | Role |
|---|---|---|
| GitHub `XharvaK/project-ashley` `master` / origin-master | `c7c81c4f5ebcf9e6d67d10990d76cfda4e21c28a` | Current canonical source. Includes independently accepted schema-41 pending-migration recovery repair. |
| Previous canonical C1 docs reconciliation | `ed269f39cc4ad2f29674b0309fa02beced6d6ba4` | Superseded as current master HEAD. Historical inspection identity only. |
| Last production-accepted / recorded production state | `09b73fbb180234a2ac7056756fc339083735f40e`; schema **40**; currentness `mem_facts`; `memory_evidence` = `observe` | Last recorded production state. Live runtime binding is UNKNOWN. Has **not** received schema-41 / C1 qualification bootstrap deployment. |
| Windows C1-C5 candidate | `C:/Users/Xharv/Projects/ashley-cognitive-maturation-implementation`; implementation `395b0b9`; HEAD `48e8b7a` (docs-only); schema v35-v39; no C1 epoch tables | Local-settled implementation candidate; not pushed. Distinct lineage. |
| Ashley Field Lab (D-023) | `C:/Users/Xharv/Obsidian/Ashley-Field-Lab`; remote `XharvaK/ashley-field-lab` PRIVATE `main` @ `f56161f` | Notebook READY. Observer cloud Git access NOT YET ENABLED. Do not clone onto cloud in this task. |
| mint data plane (source-derived path) | `~/.composer-assistant/conversations/nuclear.db` and siblings | Path known from source; live contents UNKNOWN until exporter. |

Do not collapse these lineages. Campaign analysis binds to the **running** runtime/build identity (section 5), not to GitHub master, not to a worktree name, and not merely to checkout HEAD.

`checkoutSha` of mint may later be observed. It is **not** automatically `runtimeSourceSha`. Production packet SHA `09b73fbb` is the last recorded production identity, not a substitute for live runtime binding.

Mint connectivity from grok-bot-cloud-linux remains unproven. Windows C1 worktree was inspected read-only. Schema-41 / C1 bootstrap exist in current canonical source (`c7c81c4`) and are **not deployed** to production.

---

## 1. Authority boundaries

### 1.1 Who Observer is

Observer is a persistent longitudinal evaluation agent for Project Ashley cognitive maturation (D-022). Scope is Ashley-specific until a separate owner decision generalizes it.

Observer:

- consumes an authorized **read-only** daily evidence bundle after the field day;
- reconstructs interactions and cognitive evidence;
- classifies findings, suspicions, and the earliest supported causal break;
- records Owner Attestations from **direct owner answers only**;
- writes bounded daily notes into the existing Ashley Field Lab notebook after analysis;
- prepares tomorrow observational guidance and seven-day campaign reports.

Observer does **not**:

- participate in owner–Ashley conversations;
- message Ashley, Discord, or any Ashley API as a speaker;
- coach, suggest questions, or inject context during an active interaction;
- manufacture conversations or qualification traffic;
- alter Ashley databases, memories, assertions, qualification epochs, capabilities, currentness, production code, or services;
- declare promotion, `RELEASE_QUALIFIED`, `PRODUCTION_ACCEPTED`, or capability influence;
- own canonical architecture (that remains owner + frontier plane, D-017 / D-019C);
- implement exporters or C1–C5. Exporter implementation owner is an Implementation worker (OpenCode/Luna preferred under scarcity; Operator only when persistent machine-side judgment is actually required). Observer does not implement the exporter.

### 1.2 Plane placement

This protocol is a **SUPPORTING operational procedure**. It sits under:

- Observability Plane (what was recorded; telemetry is not evidence)
- Evaluation / Qualification Plane (how claims are bound; Observer does not run EvaluationDefinitions against live Ashley)
- Memory Evidence Architecture (C1 currentness, shadow, sticky cutover)
- Wave Acceptance Protocol (state ladder; Observer never advances a gate)

```text
OBSERVABILITY records what happened.
EVALUATION interprets selected evidence against a versioned definition.
QUALIFICATION binds accepted evidence to source, environment, subject, and claim.
PROMOTION is a separate owner-governed action.
FIELD OBSERVATION reconstructs a day and asks what the evidence supports.
```

Field Observation is **not** a fourth promotion path. It may **cite** qualification ledgers. It may not write them.

### 1.3 Org placement

| Role | Relation to Observer |
|---|---|
| Owner | Attestation source; accepts this protocol; answers questionnaires in this Observer conversation; authorizes exporter later |
| Frontier (ChatGPT/Sol) | Canonical architecture judgment of this protocol |
| Manager | Continuity, RUNNING.md, next gate. Not protocol author |
| Implementation worker | Builds the conversation+evidence exporter after this protocol is canonical (OpenCode/Luna preferred under scarcity; Operator only when persistent machine-side judgment is actually required). Observer does not implement the exporter. |
| Auditor | Independent verification when risk requires it. Not started on C1–C5 while Luna is in flight |
| Luna / Codex | C1–C5 implementation owner. Observer must not interfere |
| Thinker / Researcher | Not Field Lab owners |

### 1.4 Production host authority

mint is the Ashley production host (D-006). Task-relevant read/inspect is allowed. Access ≠ deploy ≠ mutate. Existing Ashley architecture and production decisions are project-specific authority (D-007). C1–C5 implementation contract is FROZEN under External:Luna (D-013).

---

## 2. Evidence taxonomy

Epistemic classes (CHARTER; do not collapse):

| Class | What it is | What it is not |
|---|---|---|
| `ASHLEY_PRODUCTION_DB` / durable source | Recorded events in nuclear.db, continuity.db, session jsonl, capability/epoch tables | Truth about the world; Observer analysis |
| `OWNER_ATTESTATION` | Owner's exact answer to a material Observer question, in the owner's legitimate domain | Automatic override of durable historical evidence; world-fact because the owner said it |
| `OBSERVER_ANALYSIS` | Derived interpretation: reconstruction, causal-break hypothesis, longitudinal update | Truth; source; attestation |
| `OBSIDIAN_SURFACE` | Human-readable Field Lab copy | Production DB; qualification ledger |
| `EXACT_CANDIDATE_PACKET` | Class F SHA-bound settlement / qualification / acceptance record | Live production state |
| `TELEMETRY` | Process logs, traces, SSE, metrics | Recall, qualification, Effect Witness |
| `OBSERVER_CONFIDENCE` | Metadata on an analysis | Authority |

Three evidence planes (D-017):

| Plane | Use in a daily report |
|---|---|
| DESIGN INTENT | Architecture / contracts the day **claimed** to be under |
| SOURCE REALITY | What the inspected / deployed SHA actually contains |
| LIVED / OPERATIONAL | What the running process actually recorded that field day (jsonl, external snapshot, public `/health`; owner-auth GET only if proven non-control) |

If a plane cannot be established from permitted evidence: `UNKNOWN`.

---

## 3. Non-intervention

During ordinary owner–Ashley interactions: **do nothing**. Analysis is after the field day.

Forbidden always:

1. Speak in Ashley's channels (Discord, `/chat/text`, any session).
2. POST to Ashley control surfaces (list in §21).
3. Start, tick, or enqueue cognition, curiosity, initiative, or Expression.
4. Open SSE `GET /events` (registers a live client; not a bundle).
5. Run Wave-4 / counterfactual / dark-apply harnesses against production.
6. Open live `nuclear.db` WAL from a second writer, migrate, or VACUUM as Observer.
7. Message Ashley, Luna, or Codex about the day's conversations.
8. Manufacture or schedule qualification traffic, isolated_eval, or epoch start.
9. Admit memory corrections, pins, forgets, or cutovers.
10. Coach the owner **in real time** on what to ask Ashley.

Read-only GET / snapshot / jsonl consumption after the field-day boundary is observation, not participation, **if and only if** it cannot create `capability_events`, `live_shadow`, isolated_eval, epochs, corrections, or Expression.

---

## 4. Field day

Provisional boundary: **04:00 Europe/Istanbul**.

A field day `D` covers `[04:00 D, 04:00 D+1)`. Late-night sessions stay in one observational day.

The daily synthesis pass runs **after** 04:00, once, on the closed day. Default local clock for the future Observer-owned routine (not enabled by this draft): `0 5 * * *` Europe/Istanbul, seven days, because Ashley field days are not office hours. **Do not enable the routine until the pipeline gates in section 23 are met.**

Notifications ON only:

- completed daily report
- material owner questionnaire
- material anomaly
- seven-day report

OFF: processing chatter, acknowledgements, no-change status.

---

## 5. Identity binding (every report)

Every daily report, finding, attestation, and seven-day report MUST bind:

| Field | Source of truth | If unreadable |
|---|---|---|
| `checkoutSha` | mint checkout `git rev-parse HEAD` | `UNKNOWN` |
| `runtimeBuildIdentity` | identity/lineage emitted by the **running** build (continuity `lineage_state.build_identity`, process identity, or equivalent). Not checkout HEAD. | `UNKNOWN` |
| `runtimeSourceSha` | a SHA **only** if the running process/build can actually be bound to that exact source identity | `UNKNOWN` |
| `buildIdentity` | alias of `runtimeBuildIdentity` for older notes | `UNKNOWN` |
| `contractId` | `currentContractId()` / `ashley-capability-v3` on releases and C1 epochs | `UNKNOWN` |
| `nuclearSchemaVersion` | `PRAGMA user_version` / health `db.schemaVersion` | `UNKNOWN` |
| `continuitySchemaVersion` | health `db.continuity.schemaVersion` | `UNKNOWN` |
| `lineageId` | `lineage_state.lineage_id` | `UNKNOWN` |
| `memoryEvidenceState` | `capability_releases.state` for `memory_evidence` | `UNKNOWN` |
| `recallState` | `capability_releases.state` for `recall` | `UNKNOWN` |
| `currentnessAuthority` | `memory_contract_state.currentness_authority` (`mem_facts` \| `memory_assertions`) | `UNKNOWN` (`memory_contract_state_unavailable`) |
| `c1ContractVersion` | `memory_contract_state.c1_contract_version` | `UNKNOWN` |
| `cutoverAt` | `memory_contract_state.cutover_at` | `null` if never cut over; `UNKNOWN` if table missing |
| `c1EpochId` | current `memory_evidence_qualification_epochs.epoch_id` | `no_current_epoch` or `UNKNOWN` if table absent in this SHA |
| `recallEpochId` | current `recall_qualification_epochs.epoch_id` | `no_current_epoch` |
| `recallCutoffPresent` | `recall_live_cutovers` for owner + current recall release | `recall_cutoff_missing` / `UNKNOWN` |
| `recallCutoffMessageId` | `cutoff_message_id` | `UNKNOWN` |
| `cognitionMode` | `ASHLEY_COGNITION_MODE` / health `capabilities.masterMode` | `UNKNOWN` |
| `fieldDay` | `YYYY-MM-DD` in Europe/Istanbul, closed at 04:00 | required |
| `bundleId` | content hash of the daily bundle | required once exporter exists |
| `observerPassId` | Observer's analysis artifact id | required |

Do not equate `checkoutSha` with proven running source. If `checkoutSha` and `runtimeBuildIdentity` disagree or cannot be joined: `runtimeSourceSha = UNKNOWN` and raise identity mismatch. Campaign analysis binds to the **running** runtime/build identity, not merely Git HEAD.

`GET /health` (public) is liveness only. It does **not** carry SHA. Do not treat it as identity.

LIVE vs SHADOW for the day is a **conjunction**, not a vibe:

- Capability `memory_evidence` in `observe` ⇒ C1 collection is non-influential (SHADOW_ARTIFACT / CONTROL_PLANE), even if conversations occurred.
- `currentness_authority = mem_facts` ⇒ live currentness is still mem_facts (pre-cutover).
- `currentness_authority = memory_assertions` ⇒ post-cutover LIVE currentness. Cutover is sticky; rollback does not restore mem_facts.
- Episode/decision `provenance = 'live' | 'shadow'` is a separate layer from capability state. Do not collapse.
- Windows candidate Wave-4 `state-inventory.ts`: C1 tables are SHADOW_ARTIFACT until promotion; `mem_facts` / `mem_messages` / `mem_threads` remain LIVE conversational state. `snapshotLive()` **omits** C1 tables. Observer must not use `snapshotLive()` as the C1 picture.

Never label every bad Ashley answer a C1 failure.

---

## 6. Smallest safe read-only exporter boundary

There is **no** daily Observer bundle exporter in current source. Observability Plane: no exporter is authorized by that document. This section identifies the boundary. **Do not implement it in this task. Do not assign an implementation worker yet.**

THE EXPORTER MUST NOT HOLD AN ASHLEY CONTROL CREDENTIAL.

Do not solve this by handing the exporter the general owner credential and promising not to POST. CAPABILITY != AUTHORITY, but absence of write capability is required here.

### 6.1 Normal daily evidence (conversation is default)

The owner-intended Observer UX requires Observer to review the **complete owner-visible Ashley conversation** for each closed field day. That is normal successful daily evidence, not a privacy exception, not Layer B, not optional.

Normal successful daily evidence includes:

- complete owner-visible user <-> Ashley conversation text for the field day;
- stable message/session identifiers where available;
- timestamps / channel / source identity;
- Decisions and relevant cognition references;
- C1 / Recall / currentness / epoch evidence required for correlation;
- only the minimum additional metadata necessary for causal analysis.

Exclude by default:

- raw system prompts;
- chain-of-thought;
- raw provider request/response bodies;
- secret tool payloads;
- unrelated tool/system text;
- credentials;
- secret-classified data.

Secret scrubbing remains mandatory. The private Ashley Field Lab is the intended persistent human-readable notebook for this field study. Conversation reconstruction does **not** require a per-day privacy exception.

A status-only day (identity/health/capability metadata without owner-visible conversation) is **DEGRADED / PARTIAL**. It must not count as normal PIPELINE READY behavior. Use it only when the conversation evidence surface fails.

### 6.2 Allowed evidence surfaces (no control credential)

Prefer, in this order, surfaces that cannot authorize POST/control:

1. Session JSONL + `session.json` under `conversations/sessions/` (owner-visible conversation).
2. Read-only SQLite / continuity evidence via a consistent **external** snapshot (section 6.3).
3. Checkout / source inspection for contract and schema facts (not a substitute for runtime identity).
4. Public `GET /health` liveness only.

Owner-authenticated GET may be included **only if** actual source proves that the credential/capability available to the exporter cannot authorize POST/control mutation. If that proof does not exist, do not give the exporter any owner credential.

Skip always: `GET /events` SSE; memory-evidence readiness (live Expression quiescence); `GET /debug/memory-context`; `GET /nuclear/episodes?query=`; `GET /delivery/pending`; any POST.

If a C1 epoch table is absent on production schema 40: record `schema_surface_absent`, do not start an epoch.

### 6.3 External snapshot (exporter may create)

The exporter MAY create a consistent external snapshot for observation, provided that:

- source DB access is read-only;
- no Ashley migration / open-with-migrate path is used;
- no application tables are mutated;
- no VACUUM/write is performed against the production DB;
- snapshot destination is OUTSIDE Ashley cognition/data-plane directories;
- naive db + WAL/SHM copying is forbidden;
- a SQLite-supported consistent backup/snapshot mechanism is used;
- snapshot is working evidence, not imported back into Ashley;
- snapshot lifecycle and deletion/retention are explicit.

This is not permission for Observer itself to mutate Ashley. Exporter writes only its external observation output.

Forbidden: `scripts/backup-memory.ps1` against production (VACUUM is a write on the live files). `scripts/export-conversations.ps1` Desktop dumps. Live second-process open of `nuclear.db` as a writer. `OPEN != MIGRATE`.

### 6.4 Exists vs must add (design only)

| Exists in source | Must add after this protocol is accepted |
|---|---|
| JSONL transcripts, nuclear/continuity SQLite, public `/health`, `redactSecretShapes` / ETH-SEC detectors | Dedicated **off-process** daily bundle assembler with **no Ashley control credential** |
| SQLite backup APIs | Consistent external snapshot **outside** the data plane, with retention |
| | Closed conversation allowlist + secret scrubbing |
| | Bundle header binding section 5 identities |
| | Destination outside Ashley data plane (working bundle + Field Lab write) |
| | Document Index SUPPORTING row at the settled path |
| | Automated fixture/integration tests (section 21.3) |

### 6.5 Data-plane paths (source-derived; live occupancy UNKNOWN)

Host data root: `~/.composer-assistant/` (mint: `/home/<user>/.composer-assistant/...`).

| Path | Role in bundle |
|---|---|
| `conversations/nuclear.db` | Canonical SQLite; read-only source for snapshot |
| `continuity.db` | Lineage / build identity sidecar |
| `conversations/sessions/<sessionId>/messages.jsonl` | Owner-visible conversation (normal daily input) |
| `conversations/sessions/<sessionId>/session.json` | Session meta |
| `conversations/index.db` | Archival; nuclear does not read it for chat |
| `logs/` | Telemetry only; not Recall |
| `backups/` | Host backups if present; not required; exporter snapshot is separate and external |
| `.env`, `keys/`, sandbox state | **exclude** |

Agent bind: `127.0.0.1:3710` (source `config/env.example`).

### 6.6 Nuclear tables relevant to a day

Base (non-exhaustive): `mem_threads`, `mem_messages`, `mem_facts`, `decision_log`, `episodes`, `cognitive_jobs`, `cognitive_runs`, `kv`, `identity_entries`, `opinions`, `capability_contracts`, `capability_releases`, `capability_events`.

C1 artifact tables: `memory_contract_state`, `memory_assertions`, `memory_corrections`, `memory_correction_targets`, `memory_deny_barriers`, `memory_deny_barrier_members`, `memory_contradictions`, `memory_derivation_links`, `memory_episode_claims`, `memory_correction_receipts`, `memory_correction_outcomes`, `memory_reconciliation_requests`.

C1 epochs (present in current canonical source schema 41 at `c7c81c4`; **absent on production schema 40**): `memory_evidence_qualification_epochs`, `memory_evidence_qualification_events`.

Recall: `recall_qualification_epochs`, `recall_qualification_events`, `recall_live_cutovers`.

Continuity: `continuity_meta`, `lineage_state`, `lineage_forks`, plus migration/event tables.

If a table is missing on the running schema: record `schema_surface_absent:<name>`, do not infer the other lineage.


## 7. Daily evidence bundle

One bundle per closed field day. Written **outside** Ashley data plane. Owner-custody. Not telemetry export (Observability §7 deny-by-default does not apply to this semantic bundle, but **secret scrubbing does**).

### 7.1 Bundle header

```text
bundle_id
field_day
timezone = Europe/Istanbul
boundary = 04:00
exporter_version
identity { §5 fields }
surfaces_used[]          # snapshot_path, jsonl_root, gets_used
surfaces_failed[]        # name, error_class, UNKNOWN|BLOCKED
redaction_profile
```

### 7.2 Bundle body (allowlist)

Normal successful body (required for PIPELINE READY):

- complete owner-visible user <-> Ashley conversation for the field day (jsonl / nuclear messages, secret-scrubbed)
- stable message/session identifiers where available
- timestamps, channel, source identity
- `decision_log` rows in-window and relevant cognition references
- C1 / Recall / currentness / epoch evidence required for correlation
- `memory_contract_state` singleton; in-window corrections/receipts/barriers (ids + lifecycle)
- `capability_releases` for `recall` and `memory_evidence`; in-window `capability_events`
- recall cutoff row if present
- continuity lineage snapshot sufficient to bind section 5 identities

A day missing owner-visible conversation is **DEGRADED / PARTIAL**, not a successful pipeline day. Do not invent transcripts.

Exclude by default: raw system prompts, chain-of-thought, raw provider bodies, secret tool payloads, unrelated tool/system text, credentials, `data_classification='secret'`, naive WAL/SHM copies, whole production DB files in the vault. C1 `detail_json` excluded until proven text-free.

### 7.3 Quota-aware decomposition (D-018C)

```text
deterministic extract / format / redaction
  -> cheapest local worker (shell / sqlite / OpenCode Lightning)
    -> Observer one synthesis pass
      -> optional Manager continuity ping
        -> owner only if questionnaire / anomaly / report complete / seven-day
```

Persistent Observer cognition is for: longitudinal synthesis, anomaly recognition, causal reasoning, ambiguity, owner questions, cross-day comparison.

Bulk parsing, SQLite selects, jsonl slicing, schema dumps, formatting, redaction: **not** Observer quota.

One substantial synthesis pass per field day. No second pass to polish. No acknowledgement chatter.

### 7.4 Idempotency and revision

Daily automation must be retry-safe. Bind generated artifacts to `field_day`, `bundle_id`, `observer_pass_id`.

- same `field_day` + same `bundle_id` already processed => no duplicate synthesis/report.
- If a closed day source bundle legitimately changes because late evidence arrived: do not silently overwrite history. Create a traceable revision identity and preserve the prior artifact/commit history.
- Git history alone is not a substitute for explicit bundle lineage.

A later Owner Attestation persistence is a small deterministic write. It must **not** trigger another expensive daily synthesis pass. Longitudinal reinterpretation waits for the next normal daily pass unless the answer reveals a material urgent anomaly.

---

## 8. Transcript schema

Observer transcript is a reconstruction, not the production logger.

Production jsonl fields (`conversation-logger.ts`): `ts`, `role` (`user|assistant|tool|system`), `text`, `source`, `session_id`, `run_id`, `agent_id`, `model`, `duration_ms`, `name`, `status`, `call_id`, `whisper_lang`.

Observer `transcript.json`:

```text
{
  "field_day": "YYYY-MM-DD",
  "identity": { §5 },
  "sessions": [
    {
      "session_id": "",
      "channel": "discord|unknown",
      "messages": [
        {
          "ts": "",
          "role": "user|assistant|tool|system",
          "text_redacted": "",
          "source": "",
          "run_id": null,
          "decision_id": null,
          "episode_id": null,
          "provenance": "live|shadow|unknown",
          "nuclear_message_id": null
        }
      ]
    }
  ],
  "gaps": [ { "class": "UNKNOWN|MISSING_JSONL|MISSING_NUCLEAR", "detail": "" } ]
}
```

Join jsonl to nuclear by timestamp/session when possible. If they disagree, keep both and mark `SOURCE_CONFLICT`. Do not invent messages to close gaps.

---

## 9. Analysis schema

One `analysis.md` + `analysis.json` per field day.

`analysis.json`:

```text
{
  "field_day": "",
  "identity": { §5 },
  "live_vs_shadow": {
    "memory_evidence_state": "",
    "currentness_authority": "",
    "cutover_at": null,
    "narrative": ""
  },
  "what_happened": "",
  "supported": [ { "claim": "", "evidence_refs": [], "plane": "DESIGN|SOURCE|LIVED" } ],
  "unsupported": [ { "tempting_claim": "", "why_not": "" } ],
  "unknowns": [ { "question": "", "why_unknown": "", "ask_owner": false } ],
  "findings": [ §10 ],
  "causal_breaks": [ §11 ],
  "attestations_used": [ "attestation_id" ],
  "tomorrow": [ §13 ],
  "questionnaire": [ §12 ],
  "observer_confidence": { "overall": "low|medium|high", "notes": "" }
}
```

Prose `analysis.md` is the human report. JSON is the durable record. Prose must not assert facts absent from JSON.

---

## 10. Finding / suspicion lifecycle

States:

```text
OPEN
  -> WATCHING
    -> SUPPORTED
  -> REFUTED
  -> UNRESOLVED
  -> WITHDRAWN
```

| State | Meaning |
|---|---|
| `OPEN` | New suspicion or finding; evidence incomplete |
| `WATCHING` | Carried across days; still not supported |
| `SUPPORTED` | Lived evidence + source reality support the claim; still not Truth |
| `REFUTED` | Later evidence contradicts |
| `UNRESOLVED` | Asked the owner or waited; still ambiguous. **Do not self-resolve** |
| `WITHDRAWN` | Observer error or duplicate |

Record:

```text
finding_id
field_day_opened
status
kind: anomaly|behavioral|contract_mismatch|causal_break|privacy|ops
claim
evidence_refs[]
not_evidence[]          # telemetry, vibes, worktree names
causal_class            # §11
c1_decision_class       # if and only if a C1 shadow/eval event exists; else null
promotion_implication: none
```

Material anomaly ⇒ notify owner (notification class). Ordinary OPEN findings stay in the Field Lab.

---

## 11. Causal classification

Seek the **earliest supported causal break**. Do not dump every bad answer on C1.

Ordered hypothesis classes (first matching supported break wins; others remain listed as alternatives):

1. `IDENTITY_OR_LINEAGE` — checkout vs runtime identity / schema / contract / build mismatch vs what the day assumed
2. `CAPABILITY_STATE` — observe vs active vs rolled_back; `ASHLEY_COGNITION_MODE`; `capabilityCanInfluence=false`
3. `CURRENTNESS` — `mem_facts` vs `memory_assertions`; missing `memory_contract_state`
4. `RECALL_CUTOFF` — `recall_cutoff_missing`; live watermark excluding pre-cutover messages
5. `EPOCH_BINDING` — `no_current_epoch`; evidence in generic `capability_events` that **does not qualify**
6. `PROVENANCE_SHADOW` — cognition wrote `shadow` because influence was false
7. `C1_POLICY` — an actual C1 `decision_class` on a real live-shadow or isolated_eval event:
   `no_c1_material | same_current | would_relabel | would_filter | would_narrow | mixed_change | unmapped_fail_closed | evaluation_error`
8. `CORRECTION_OR_BARRIER` — deny barrier, non-revival, identity non-mutation
9. `EXPRESSION_OR_ROUTE` — model/route/receipt; not memory
10. `DELIVERY` — Discord receipt vs semantic completion
11. `OWNER_CONTEXT` — owner ambiguity (may become Attestation; does not override DB)
12. `INSUFFICIENT_EVIDENCE` — default when nothing earlier is supported. Stays `UNKNOWN`

C1 shadow decision classes apply **only** when the day's SHA actually recorded that event. Windows C1–C5 candidate has **no** production `recordLiveShadowEvent(..., "memory_evidence")` caller. GitHub master bootstrap records live-shadow at `expressSpeak` on persisted positive Decisions. Bind to the SHA that ran.

---

## 12. Owner Attestation

```text
recorded evidence
  -> Observer identifies ambiguity
    -> Observer asks owner
      -> owner answers
        -> record as Owner Attestation
```

**Never:** Observer inference → Attestation.

Land in `30 Owner Attestations/<attestation_id>.md` using `Templates/Owner Attestation.md` after a direct owner answer. Do not create the note from Observer inference.

### 12.1 Format

Vault YAML (template): `type: owner_attestation`, `date`, `status`, `source_question_id`, `source_interaction_refs`.

Body:

```text
## Observer Question          # exact text shown to owner
## Owner Answer               # verbatim; never rewritten
## Normalized Interpretation  # may never change the meaning of Owner Answer
## Scope
## Supersedes / Clarifies
## Provenance
```

Keep also internally: `attestation_id`, `field_day`, `owner_domain`, `does_not_override[]`. Extra identity fields belong in Provenance, not as silent template edits.

### 12.2 Lifecycle

- `recorded` — exact answer stored
- `still_ambiguous` — answer did not resolve the question; leave UNRESOLVED
- `superseded_by_later_attestation` — owner later corrected themselves; keep both

Owner recollection does **not** automatically override durable historical evidence. External-world claims do not become true because the owner says them. Observer confidence is metadata.

### 12.3 Questionnaire UX

The OWNER INTERFACE is the Observer Grok conversation.

Daily analysis may contain Owner Questions for history. Observer must also send a material questionnaire conversationally to the owner. Owner answers naturally in the Observer conversation. Do not require the owner to edit Markdown.

Many days **should produce zero questions**. Prefer 1–3. Ask only when the answer could materially change interpretation, owner-model state, evaluation, causal attribution, or a longitudinal conclusion.

Do not ask:

- what is discoverable from the bundle;
- to confirm Observer's cleverness;
- architectural questions that belong to frontier review;
- anything that would require the owner to prompt Ashley as a probe **today** (that is tomorrow-guidance, and even then at most one deliberate probe).

For every accepted answer record:

```text
question_id
exact Observer question
verbatim owner answer
owner-answer source reference if available
field_day
attestation_id
```

Then write the provenance-bearing Owner Attestation into `30 Owner Attestations/`. A direct answer may trigger that small deterministic persistence operation. It must not trigger another expensive daily synthesis pass.

A material questionnaire is a notification class.

---

## 13. Tomorrow-guidance rules

At most **three** observational opportunities. At most **one** deliberate probe.

A deliberate probe is an owner-chosen natural interaction, not synthetic qualification traffic, not isolated_eval, not epoch start, not a scripted 25-event campaign.

Forbidden as “tomorrow guidance”:

- “run POST `/nuclear/capabilities/evaluation`”
- “start a C1 epoch”
- “tick curiosity N times”
- “chat until live_shadow ≥ 25”
- any instruction whose purpose is to satisfy qualification thresholds

Architecture (Memory Evidence): “Synthetic traffic cannot be used only to satisfy these thresholds.” Observer must not become the thing that violates that.

If nothing worth watching: empty list. Silence is success.

---

## 14. Field Lab notebook (D-023)

VAULT READY != OBSERVER PIPELINE READY.

The notebook exists. Observer does not redesign it, recreate it, clone it onto cloud in this task, install Obsidian here, implement the exporter, or enable the daily routine.

### 14.1 Bound identity

| Fact | Value |
|---|---|
| Vault name | Ashley Field Lab |
| Windows path | `C:/Users/Xharv/Obsidian/Ashley-Field-Lab` |
| Git remote | `XharvaK/ashley-field-lab` (PRIVATE) |
| Branch | `main` |
| Initial commit | `f56161f` |
| Windows worktree | clean at D-023 record |
| Windows writer | owner via Obsidian Git 2.39.0 (auto sync/backup 10m, auto pull 5m, pull on startup, push after successful sync, Git-default conflicts, plugin binaries and workspace ignored, no tokens in vault) |
| Official Obsidian Sync | NOT USED |
| Future cloud writer | Observer via Git CLI + filesystem + Markdown against that private repo |
| Observer cloud access | NOT YET ENABLED / pending protocol |
| Canonical protocol | Project Ashley git (`docs/Ashley_Field_Observation_Protocol.md` after acceptance) |
| Notebook protocol note | `00 Protocol/Field Observation Protocol.md` is a **placeholder**. Do not invent protocol semantics there. |

Nearest Ashley architecture language remains Roadmap **D6** (longitudinal companion evaluation campaign: Evaluation-plane extension, not a cognitive owner). This vault is the notebook for that work, not a new cognitive organ.

### 14.2 Authority

```text
ASHLEY CANONICAL GIT = PROTOCOL
PRODUCTION DB = SOURCE EVIDENCE
OWNER DIRECT ANSWER = ATTESTATION
OBSERVER REPORT = ANALYSIS
FIELD LAB GIT = NOTEBOOK
OBSIDIAN APP = OWNER UI
A NOTE IS NOT COGNITIVE TRUTH
A COMMIT PROVES NOTEBOOK HISTORY, NOT TRUTH OF CONTENTS
```

Cite `90 System/Vault Contract.md` and `90 System/Git Sync Contract.md`. Do not rewrite them.

### 14.3 Existing scaffold (do not rename for taste)

Inspected 2026-08-27 on the Windows vault (read-only; not cloned to cloud):

```text
00 Protocol/Field Observation Protocol.md     # placeholder; not canonical
10 Daily Transcripts/                         # Templates/Daily Transcript.md
20 Daily Analyses/                            # Templates/Daily Analysis.md
30 Owner Attestations/                        # Templates/Owner Attestation.md
40 Findings/                                  # no template yet; do not add one in this task
50 Longitudinal/                              # Templates/Seven Day Report.md
60 Post-Cutover/                              # Templates/Post-Cutover Comparison.md
90 System/Git Sync Contract.md
90 System/Vault Contract.md
Templates/...
Ashley Field Lab.md                           # home note
README.md
.gitignore                                    # ignores .obsidian plugins/workspace; no tokens
```

Structural change only if materially necessary, and then only as an owner-review item. This draft adds **none**.

### 14.4 Daily write map (bounded batch)

Use existing templates. Fill YAML that already exists. Extra section 5 identity fields go under `## Runtime / Campaign State` / `## Source Identity`, not as silent template edits.

| Artifact | Vault path | Template |
|---|---|---|
| Transcript | `10 Daily Transcripts/YYYY-MM-DD.md` | `Templates/Daily Transcript.md` (`type: ashley_daily_transcript`) |
| Analysis | `20 Daily Analyses/YYYY-MM-DD.md` | `Templates/Daily Analysis.md` (`type: ashley_daily_analysis`) |
| Questionnaire | analysis `## Owner Questions` for history; owner answers in Observer Grok chat | (no extra folder) |
| Attestation | `30 Owner Attestations/<attestation_id>.md` | `Templates/Owner Attestation.md` — **after** a direct owner answer |
| Finding | `40 Findings/<finding_id>.md` | none; body follows section 10; **do not add a template unless owner asks** |
| Seven-day | `50 Longitudinal/<campaign-id>-seven-day.md` | `Templates/Seven Day Report.md` |
| Post-cutover | `60 Post-Cutover/<comparison-id>.md` | `Templates/Post-Cutover Comparison.md` |

`Normalized Interpretation` on an attestation **may never change the meaning of `Owner Answer`**. Never Observer inference → Attestation.

Filename convention (`YYYY-MM-DD.md`, ids) is a write convention, not a folder redesign. If the owner prefers another name, they say so.

Every note cites `bundle_id` and section 5 identity. Do not paste secrets. Do not treat vault search as Recall. `OBSIDIAN COPY != PRODUCTION DB`.

### 14.5 Git law (future cloud writer)

Once Observer cloud access exists (not this task; do not clone now):

```text
PULL BEFORE GENERATED WRITE
  -> WRITE BOUNDED DAILY BATCH
    -> COMMIT
      -> PULL/RECONCILE IF REQUIRED
        -> ORDINARY PUSH
```

NEVER force push, `reset --hard` over owner work, silently discard owner edits, or auto-select a semantic conflict. If not a safe fast-forward: **STOP** generated write finalization and **SURFACE CONFLICT**.

Two writers: Windows = owner via Obsidian Git. Cloud = Observer via Git CLI. Observer does not install Obsidian on grok-bot-cloud-linux.

Do not commit `.obsidian/plugins/`, workspace, cache, tokens. Follow the vault `.gitignore`.

### 14.6 Remaining pipeline (design problem, not implemented)

```text
ASHLEY READ-ONLY EVIDENCE
  -> deterministic daily evidence bundle (section 6: conversation default; no control credential)
    -> Observer one synthesis pass
      -> bounded Git write into the existing Field Lab (14.4)
        -> owner questionnaire in this Observer conversation (many days: zero)
          -> later owner answer
            -> small deterministic attestation persist in 30 Owner Attestations
              -> longitudinal accumulation in 40/50/60 on the next normal daily pass
```

Missing pieces that still block the daily routine: canonical protocol accepted; conversation+evidence exporter implemented (no Ashley control credential); Observer cloud Git access to the private repo; bounded Field Lab write live; daily evidence transfer path proven; no write path from Observer back into Ashley production.

## 15. Persistence / history (Observer)

Observer durable history is the Field Lab git notebook (section 14), not Ashley cognition and not a second protocol in ops.

The deterministic evidence bundle (json/sqlite extract) may live outside the vault as machine working data. Human-readable persistence is the bounded Git write in 14.4.

Ops path `/workspace/ops/observer/` remains **coordination only** (STATUS, CHARTER, FIELD_LAB.md, this draft).

Observer agent memory may store: vault remote/path, last field_day processed, last checkoutSha / runtimeBuildIdentity / runtimeSourceSha seen. It must not store raw transcripts or secrets.

---

## 16. Seven-day report

Field-day boundaries organize notes. They do **not** redefine the C1 mechanical time threshold. Do not infer mechanical qualification from seven `YYYY-MM-DD` notes.

The seven-day campaign report is triggered only after the actual C1 epoch/readiness contract has satisfied its required full elapsed span. Bind the report to:

- exact epoch id;
- actual epoch/witness timestamps;
- readiness contract;
- required live-shadow span;
- qualifying counts;
- reactive/proactive coverage;
- blockers.

If the required full span has not elapsed: mechanical section remains `NOT_READY`. Generate the longitudinal report at the first closed field-day boundary **after** the real time condition is satisfied.

If the running schema has **no** C1 epoch table (production schema 40 today): there is no C1 campaign clock. Do not fake one from Recall epochs. Recall seven-day shadow policy is a different campaign.

Campaign report sections (independent; do not merge scores):

1. **MECHANICAL QUALIFICATION** — what the ledgers actually contain: epoch id, eval seeds, live_shadow counts/span, reactive/proactive witnesses, blockers (`recall_cutoff_missing`, `no_current_epoch`, identity mismatch, etc.). Cite events. Do not upgrade counts into PASS.
2. **BEHAVIORAL EVALUATION** — Observer reconstruction across the seven days: correction persistence, contradiction handling, grounded revision, calibration, refusal, relational repair, temporal continuity. Bind claims to evidence_refs. Leave UNKNOWN in place.
3. **OWNER EVALUATION** — attestations and owner judgments only. Empty if none.

Do **not** declare promotion. `recommendation` if any is `HOLD | REVIEW` language in Observer analysis, never `PROMOTE`. Promotion uses the subsystem's existing owner path (Evaluation Plane).

Write to `50 Longitudinal/` with `Templates/Seven Day Report.md`. Notify owner on completed seven-day report.

---

## 17. Post-cutover comparison

Remain active after C1 currentness cutover. Write comparisons to `60 Post-Cutover/` with `Templates/Post-Cutover Comparison.md`.

Compare, bound to identity:

| Before (`mem_facts` currentness) | After (`memory_assertions` currentness) |
|---|---|
| shadow witness receipts (if that SHA has them) | live assertion-first retrieval / hot-window roles |
| predicted would_relabel / would_filter / would_narrow | what Expression actually received |
| capability still `observe` vs later `active` | influence eligibility |

Rules:

- Cutover is sticky; do not describe rollback as restoring mem_facts.
- Shadow prediction vs live is comparison, not a hidden promotion.
- Missing pre-cutover shadow receipts ⇒ comparison `UNKNOWN`, not “no change.”
- Do not treat `ASHLEY_COGNITION_MODE=apply` on the host as capability activation if `capabilityCanInfluenceReadOnly=false` (production packet fact).

---

## 18. Privacy

Two postures, different channels:

1. **Telemetry export** (Observability §7): deny-by-default for raw message text, prompts, tools, relationship content, identity-review prose, provider bodies, command lines, env, secret URLs. Observer field bundle is **not** this channel.
2. **Owner-custody Field Lab notebook**: the complete owner-visible Ashley conversation is **intended notebook content** for this field study, with **secret scrubbing**. ETH-PUB (real name, location, projects, health, sexuality, private jokes, private/relationship conflicts) never goes public; minimize even in the vault. Default unclassified conversational content is `never_public`.

Still excluded from the notebook: raw system prompts, chain-of-thought, raw provider bodies, secret tool payloads, credentials, secret-classified data.

Never export:

- `MISTRAL_API_KEY`, `GROQ_API_KEY`, `NIM_API_KEY`, `DISCORD_BOT_TOKEN`, Giphy/Tenor keys, sandbox key paths, `ASHLEY_BACKUP_TRANSFER_KEY`
- `keys/*.enc`, `master.pass`, PEM, cookies, recovery codes
- `ETH-SEC-01..03` shapes: pem, AKIA, `ghp_`, `gho_`, `xox`, Bearer JWT, `sk-`, `api_key` assignments (`redactSecretShapes` / `CREDENTIAL_OMITTED_PLACEHOLDER`)
- rows with `data_classification='secret'`
- Discord tokens; owner snowflakes may appear as ids in nuclear — do not republish to public surfaces

`DISCORD_OWNER_ID` / `MEMORY_OWNER_ID` stay in identity binding as needed for queries; they are not public.

## 19. Failures and UNKNOWN

```text
If current truth cannot be established from permitted evidence: UNKNOWN.
```

| Mode | Observer behavior |
|---|---|
| mint unreachable | bundle `surfaces_failed`; no daily synthesis fiction; notify Manager BLOCKED if this is the first day the path was supposed to exist |
| missing currentness | `memory_contract_state_unavailable`; do not assume mem_facts or assertions |
| missing Recall cutoff | `recall_cutoff_missing`; C1 campaign evidence after cutoff cannot be claimed |
| no C1 epoch table | `schema_surface_absent:memory_evidence_qualification_epochs`; do not use Recall epoch as substitute |
| `no_current_epoch` | generic `capability_events` do not qualify |
| identity mismatch | `checkoutSha` vs `runtimeBuildIdentity` cannot join, or contract mismatch; `runtimeSourceSha=UNKNOWN`; bind the report to what was **read**, flag mismatch |
| `unversioned` build | git unreadable |
| jsonl vs nuclear conflict | `SOURCE_CONFLICT`; keep both |
| SHA lineages disagree | report both as SOURCE REALITY of their trees; LIVED follows the **running** identity, not checkout HEAD and not GitHub master |
| GET /health only | not identity |
| logs present | telemetry, not Recall |
| `OUTCOME_UNKNOWN` effects | remain unresolved; receipts ≠ witnesses |
| status-only bundle (no owner-visible conversation) | **DEGRADED / PARTIAL**; not PIPELINE READY; do not invent transcripts |
| exporter not built | daily routine stays disabled; this is expected until owner/frontier accept this protocol and an implementation worker is assigned |

Do not fill UNKNOWN with worktree names, branch names, or “the C1 folder.”

## 20. Stop conditions

The vault already exists (D-023). Stop the daily pass (and do not enable/resume the routine) when:

1. Pipeline pieces are missing: protocol not accepted, conversation/evidence exporter not live, Observer cloud Git not live, bounded Field Lab write not live, or daily routine not authorized.
2. A stop condition would require Observer to POST, chat, or generate traffic to complete the picture.
3. Owner or Manager issues stop / pause.
4. Production mutation would be required to read (open live WAL as writer, migrate, deploy).
5. Continuing would interfere with Luna/Codex or an active owner–Ashley session (wait for the field-day boundary).
6. Scarcity state becomes CRITICAL and Manager retracts the D-022 exception — finish in-flight closed-day report only if already bundled; start no new pass.
7. Owner withdraws Observer's Ashley-specific mandate.
8. Git write is not a safe fast-forward (conflict). STOP and SURFACE CONFLICT; do not force-push or discard owner edits.

Emergency stop of **Ashley** is Stewardship Compact, not Observer.

## 21. How Observer cannot influence qualification traffic

### 21.1 What generates qualifying evidence (must not be Observer)

**Recall `live_shadow`:** cognition worker after episode consolidation on durable jobs from **real conversation / cognition**. Observer polls do not qualify unless they wrongly trigger those jobs.

**Recall `isolated_eval`:** owner `POST /nuclear/capabilities/evaluation`.

**Recall epoch start:** owner `POST /nuclear/capabilities/recall/qualification-epoch/start`.

**C1 isolated_eval (GitHub master bootstrap):** owner `POST /nuclear/capabilities/memory-evidence/evaluation` with exact definition/hash/seeds (`c1-memory-evidence-v1`, hash `2a4d38685a60c2d2e27c979f050e884037f98b0806d0cc8ad0fe117e819e1a4e`). Generic `capability_events` cannot satisfy C1.

**C1 live_shadow (GitHub master bootstrap):** runtime seam immediately before `expressSpeak` on a persisted positive Decision. Source key `c1-shadow:v1:decision:<id>`. Text-free receipt. Provider-independent.

**C1 live_shadow (Windows C1–C5 candidate):** **no production caller** for `recordLiveShadowEvent(..., "memory_evidence")`. Isolated_eval would still go through generic evaluation POST (mutates `capability_releases.qualified_at`). Dark-apply is fixture/test only.

**C1 epoch start:** owner `POST …/memory-evidence/qualification-epoch/start`. Fail-closed on identity/cutoff/currentness.

**Cutover / promote / rollback:** owner POSTs. Write paths.

**Wave-4 tests** seed 25 live_shadow + 3 eval seeds **inside tests**. Not production.

### 21.2 Forbidden Observer actions (control / traffic)

Do not POST:

- `/chat/text`
- `/nuclear/capabilities/evaluation`
- `/nuclear/capabilities/memory-evidence/evaluation`
- `/nuclear/capabilities/memory-evidence/qualification-epoch/start`
- `/nuclear/capabilities/recall/qualification-epoch/start`
- `/nuclear/capabilities/recall/cutover`
- `/nuclear/capabilities/memory-evidence/cutover`
- `/nuclear/capabilities/promote`
- `/nuclear/capabilities/rollback`
- `/nuclear/memory/corrections`
- `/curiosity/tick`
- `/initiative/*`
- `/memory/pin`, `/memory/forget*`

Do not GET `/events` (SSE).
Do not GET `/nuclear/capabilities/memory-evidence/readiness` as a daily bundle input (live Expression quiescence).
Do not run cognition workers, dark-apply, or Wave-4 harnesses on mint.
Do not instruct the owner to generate threshold traffic. Observer-caused live Expression is campaign traffic once C1 bootstrap is live.

Read-only sqlite against an external observation snapshot, jsonl read, checkout/source inspection, and public `/health` cannot create epochs, isolated_eval, or Expression if those code paths remain as inspected. Owner-auth GET is not in the standing exporter. If a future surface becomes side-effecting, it leaves the allowlist.

### 21.3 Proof obligation after exporter exists

Before the first live daily pass, the implementation worker and Auditor must show **implementation tests** (fixture/integration — not a field dry run, not a historical rehearsal, not a test day):

1. exporter holds **no Ashley control credential**;
2. no POST/control call in its call graph;
3. no qualification traffic; no new messages/events/epochs;
4. source SQLite access is read-only; no migrate; no VACUUM/write against production;
5. output stays outside Ashley data plane;
6. redaction works;
7. Git conflict behavior fails closed (no force push, no silent discard).

Owner decision: NO historical rehearsal. NO production-replay dry run. NO test day before Day 1. The first real successful closed field day is Day 1.

Until those implementation tests pass: routine stays disabled.

---

## 22. Document Index proposal (do not edit the index in this task)

After owner/frontier acceptance, add to `docs/architecture/Ashley_Architecture_Document_Index.md` §2:

| Title | Path | Topic | Era / date | Status | Current relevance |
|---|---|---|---|---|---|
| Ashley Field Observation Protocol | [`docs/Ashley_Field_Observation_Protocol.md`](Ashley_Field_Observation_Protocol.md) | After-the-day read-only field observation; Owner Attestations; Field Lab; non-intervention | 2026-08-27 | `SUPPORTING` | Procedure under Observability and Evaluation. Not an architecture owner. Does not authorize exporter implementation, daily routine, qualification traffic, or promotion. |

Rejected paths (not a live fork; do not reopen):

| Path | Why rejected |
|---|---|
| `docs/architecture/Ashley_Field_Observation_Protocol.md` | architecture/ is owner/phase contracts; this is a procedure |
| `docs/architecture/evaluation/Ashley_Field_Observation_Protocol.md` | rejected; Observer must not score/qualify. Not a live alternative. |
| `docs/handoffs/…` | Class F SHA-bound evidence, not a standing protocol |
| `docs/qualification/…` | historical isolation evidence only |
| repo root | only VISION/README/AGENTS (+ working packets) |
| `/workspace/ops/observer/` | D-022: coordination only |
| Obsidian | human surface, not canonical |

Siblings that set the `docs/*_Protocol.md` slot: `docs/Wave_Acceptance_Protocol.md`, `docs/Architecture_Review_Protocol.md`.

Do not copy volatile SHA/schema into the accepted protocol body as law. Keep §0 as dated inspection notes or move them to a Class F handoff when this draft is canonicalized.

## 23. Implementation gates (after review)

This draft's next gate is **owner + frontier review**, not build. The vault already exists (D-023). That does not start the pipeline.

Then, separately, if accepted:

1. Place canonical file at `docs/Ashley_Field_Observation_Protocol.md` and add the Index row. Point `00 Protocol/Field Observation Protocol.md` at that path; do not fork semantics in the vault.
2. Establish Observer cloud Git access to `XharvaK/ashley-field-lab` (private). Do not clone onto cloud before this protocol is accepted.
3. Assign an Implementation worker to build the **conversation+evidence exporter** (section 6) **only** after (1) (OpenCode/Luna preferred under scarcity; Operator only when persistent machine-side judgment is actually required). Observer does not implement the exporter. The exporter holds **no Ashley control credential**. Not before.
4. Auditor: fixture/integration tests (section 21.3) proving non-intervention / no-traffic / no write path from Observer into Ashley production. These tests are not a field dry run.
5. Observer enables the 04:00+ daily routine **only** after (1)-(4) and after bounded Field Lab write is live.
6. Luna/Codex C1-C5 work remains untouched by Observer throughout.

Owner decision: no historical rehearsal, no production-replay dry run, no test day. The first real successful closed field day is Day 1.

## 23.1 C1 field-campaign start policy (owner operational policy)

This is **owner operational campaign policy**, not C1 architecture law. C1 does not technically depend on Observer.

Do **not** authorize C1 qualification **epoch start** until all of the following are true:

1. this protocol is accepted;
2. the conversation/evidence exporter is live;
3. Observer cloud vault access is live;
4. bounded Field Lab write is live;
5. the daily Observer routine is enabled.

Inert schema-41 deploy and Recall qualification **may** precede the Observer pipeline.

The owner wants Day 1 observed from the beginning of the C1 qualification campaign. Observer must not tell the owner to start a C1 epoch as tomorrow-guidance.

## 24. Open UNKNOWN (not hidden)

1. Live mint **runtime** identity right now (`runtimeBuildIdentity` / `runtimeSourceSha`). Production packet SHA `09b73fbb` is the last recorded production identity, not a live runtime bind.
2. Connectivity mint to grok-bot-cloud-linux.
3. Observer cloud Git access to private `XharvaK/ashley-field-lab` (not enabled; do not clone until protocol accepted).
4. Accepted C1 implementation contract file in the planning worktree was not opened.
5. Exact GitHub-master vs Windows C1-C5 merge plan. Observer must not pick a winner.
6. GitHub Class F production-accepted observe at 09b73fbb vs ops PORTFOLIO not PRODUCTION_ACCEPTED. Resolve live.
7. `40 Findings/` has no template. This draft writes finding notes there without adding a template.

Vault path is known (D-023). Canonical protocol path is settled (`docs/Ashley_Field_Observation_Protocol.md`). Status-only vs conversation is settled (conversation is the default). GET-as-default is settled (no control credential; owner-auth GET only if source proves it cannot POST).

These remaining items block **enabling the daily routine** (1-3) or belong to frontier (4-6). Item 7 is a non-blocking notebook gap.


---

# FRONTIER REPAIR CHANGELOG

Narrow protocol reconciliation after REPAIR_REQUIRED. Not a redesign. Core authority, non-intervention, attestations, finding lifecycle, causal classification, Field Lab role, tomorrow guidance, and post-cutover remain accepted in principle.

- **SOURCE_REALITY_UPDATED** — §0 now binds current GitHub master `c7c81c4`, superseded `ed269f39`, production `09b73fbb` schema 40 (C1 bootstrap not deployed). Closed resolved UNKNOWNs. SHAs remain inspection facts, not architecture law.
- **CANONICAL_PATH_SETTLED** — Canonical path is `docs/Ashley_Field_Observation_Protocol.md`, SUPPORTING. Docs-path fork removed from OPEN UNKNOWN. Index proposal matches. Evaluation/ path is rejected, not a live fork.
- **DAILY_TRANSCRIPT_DEFAULT** — Complete owner-visible conversation is normal daily evidence, not a privacy exception. Status-only day is DEGRADED/PARTIAL, not PIPELINE READY. Prompts, CoT, provider bodies, secret tools, credentials, and secret-classified data remain excluded. Secret scrubbing mandatory.
- **SNAPSHOT_BOUNDARY_REPAIRED** — Exporter MAY create a consistent **external** snapshot: read-only source, no migrate, no table mutation, no VACUUM/write on production DB, dest outside Ashley data plane, no naive WAL/SHM copy, SQLite-supported consistent backup, snapshot is working evidence not re-imported, explicit retention. Observer still must not mutate Ashley.
- **WRITE_CREDENTIAL_DEPENDENCY_REMOVED** — Exporter must not hold an Ashley control credential. Prefer read-only SQLite/continuity, session JSONL, checkout/source inspect, public `/health`. Owner-auth GET only if source proves that credential cannot authorize POST/control. Do not hand a general owner credential and promise not to POST.
- **RUNTIME_IDENTITY_REPAIRED** — Replaced single `productionSha` with `checkoutSha`, `runtimeBuildIdentity`, `runtimeSourceSha`. Checkout HEAD is not proven running source. Disagreement or unjoinable identities => `runtimeSourceSha=UNKNOWN` + identity mismatch. Campaign binds to the running identity. contractId/schema/lineage/epoch retained.
- **DRY_RUN_REMOVED** — No historical rehearsal, no production-replay dry run, no test day. First real successful closed field day is Day 1. Fixture/integration tests remain (no POST, no qual traffic, no new messages/events/epochs, read-only SQLite, output outside data plane, redaction, Git conflict fail-closed). Do not call those a field dry run. Deleted the real `bundle → Observer → Field Lab` dry-run gate.
- **SEVEN_DAY_CLOCK_REPAIRED** — Field-day notes do not redefine C1 mechanical time. Report only after actual C1 epoch/readiness elapsed span (epoch id, witness timestamps, live-shadow span, counts, reactive/proactive, blockers). If span not elapsed: mechanical section `NOT_READY`. Generate at first closed field-day boundary after the real time condition.
- **QUESTIONNAIRE_UX_DEFINED** — Owner interface is the Observer Grok conversation. Daily analysis may keep Owner Questions for history; Observer also sends the questionnaire conversationally. Owner answers in chat, not by editing Markdown. Record question_id, exact question, verbatim answer, source ref, field_day, attestation_id → `30 Owner Attestations/`. Answer may trigger small deterministic attestation persist, not another expensive daily synthesis. Longitudinal reinterpretation on the next normal daily pass unless material urgent anomaly.
- **IDEMPOTENCY_DEFINED** — Retry-safe. Bind `field_day` + `bundle_id` + `observer_pass_id`. Same field_day + same bundle_id already processed => no duplicate synthesis/report. Late evidence: no silent overwrite; create a traceable revision identity; preserve prior artifact/commit. Git history is not a substitute for bundle lineage.
- **C1_CAMPAIGN_START_POLICY_ADDED** — Owner operational campaign policy, not C1 architecture law: do not authorize C1 qualification epoch start until protocol accepted, conversation/evidence exporter live, Observer cloud vault access live, bounded Field Lab write live, daily routine enabled. Inert schema-41 deploy and Recall qualification may precede Observer pipeline. C1 does not technically depend on Observer; owner wants Day 1 observed from the beginning.
