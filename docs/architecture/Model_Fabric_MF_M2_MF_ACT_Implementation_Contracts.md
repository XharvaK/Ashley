# Model Fabric MF-M2 → MF-ACT — implementation contracts

**Status:** `DESIGN ACCEPTED` / `IMPLEMENTATION_READY` for machinery.
**Not:** production routing authorization.

**Date:** 2026-08-25

**Kind:** Wave-style Milestone Execution contracts under
[`Model_Fabric_Architecture.md`](Model_Fabric_Architecture.md).
This file does not replace that architecture. It is the focused execution
contract Luna Max must follow.

**Pass:** 2 (owner answers closed). Pass 2.1 is a consistency freeze of
these contracts, not a design reopen.

**Planning HEAD when written:** `d915af86483e2af4f5edf2838023ffe22f875dcc`

**MF-M1 implementation candidate:** `d918572c7ae01d5b367323692bd6e8fbcf257895`

**Owner answers:** Q1=A, Q2=modified A/B, Q3=C, Q4=B, Q5=strict A, Q6=B
refined, Q7=A+C, Q8=A, Q9=A, Q10=A refined, Q11=refined A, Q12=A, Q13=A,
Q14=A, Q15=A, Q16=A refined, Q17=B, Q18=modified B, shadow closed, MF-M1
R1/R2 closed as SLICE 0.

```text
CURRENT ROUTING
  != OWNER-SELECTED TARGET
  != IMPLEMENTED SUPPORT
  != QUALIFIED
  != OWNER APPROVED
  != ACTIVATION APPROVED
  != PRODUCTION ROUTED
```

```text
M2–M6 = machinery
MF-ACT = activation mechanism
actual route activation = owner-created ActivationRef
  citing QualificationResult + OwnerApprovalRef
```

Do not implement runtime in the planning pass that writes this file.
Do not treat creation of MF-ACT mechanics as permission to activate any
target route.

---

## 0. Frozen laws (do not reopen)

Preserve Architecture laws and Pass-1 receipt ontology:

- `MODEL SELECTION != COGNITIVE AUTHORITY`
- `PROVIDER TRANSPORT != LOGICAL ROLE`
- `RECEIPT != TRUTH`
- `OWNER TARGET != CURRENT ROUTING`
- `QUALIFIED != ACTIVATION APPROVED != PRODUCTION ROUTED`
- `FALLBACK != SILENT SEMANTIC EQUIVALENCE`
- `UNKNOWN TRANSPORT OUTCOME MUST REMAIN UNKNOWN`
- One `ModelAttemptReceipt` = at most one provider HTTP request
- Attempt stages: `resolved_not_sent` | `dispatch_attempted` | `provider_response`
- Send outcomes: `not_sent` | `sent_outcome_unknown` | `response_received`
- Invocation vs attempt vs caller-owned `ModelFallbackChain` stay distinct
- Evaluation owns `QualificationResult` meaning
- Fabric owns mechanical resolve, translation, receipts, and binding
- Track A ≠ Track B
- Thought and Expression are not on OpenCode in this program
- No auto-promotion
- Event Spine is not a dependency
- Metacognition is not implemented inside M2–M6 or MF-ACT
- F1-obs remains deferred optional and must not block this program

### 0.1 Q7 / Q13 reconciliation (closed, not a new vote)

Q13: activation unit is the logical role, not the whole portfolio.
Thought and Expression activate independently. Coupling requires joint
**review**, not one semantic activation blob.

Q3: each role has explicit policy-row identity. Qualification binds to
role + material inference identity + policy-row identity.

Q7: interactive Thought keeps the 6000 ms / 1000 output-token / 2500 ms
failover-floor envelope. Durable/proactive Thought may qualify and move
to GPT-OSS 120B `high` earlier because it does not share that envelope.

**Closed reading:** logical role `thought` has two independently
activatable **policy rows**:

| `occupancyKey` | Envelope | ActivationRef |
|---|---|---|
| `interactive` | 6000 ms initial, 1000 output-token cap, 2500 ms remaining failover floor | own |
| `durable_proactive` | remaining durable-job time or proactive none (current source) | own |

They remain one logical role. Coupling list names shared Groq/NIM buckets.
Coupling preflight is required when an activation would share a provider
bucket already used by the other Thought row or by utility. Coupling does
not force both rows to cut over together.

### 0.2 Implementation slice order

| Slice | Milestone | May change live routing? |
|---|---|---|
| 0 | MF-M1 R1/R2 receipt-truth repairs | No |
| 1 | MF-M2 | No |
| 2 | MF-M3 | No |
| 3 | MF-M4 | No, unless a later owner `ActivationRef` exists (none in this program by default) |
| 4 | MF-M5 | No; health among already-approved only |
| 5 | MF-M6 | No; generic seat resolution + catalog. `routine_validation` stays dark until MF-ACT owner records |
| 6 | MF-ACT | Mechanics only. Luna MUST NOT create `OwnerApprovalRef` or `ActivationRef` |

SLICE 0 MUST land and pass its regressions before MF-M3 or Evaluation
consumes attempt/invocation receipt truth. MF-M2 MAY follow SLICE 0 in
the same candidate. Do not skip SLICE 0.

---

## 1. Shared identity model

### 1.1 Identifier types

All IDs are strings. Do not put them in `nuclear.db`.

| Type | Pattern | Owner |
|---|---|---|
| `PortfolioRevisionId` | `mfp_<slug>_v<n>` | Model Fabric policy (Git) |
| `PolicyRowId` | `mfr_<logicalRole>_<occupancyKey>_<rev>` | Model Fabric policy (Git) |
| `OccupantId` | `mfo_<provider>_<modelToken>_<inferenceTag>` | Model Fabric policy (Git) |
| `IndependenceGroupId` | slug in catalog | Model Fabric catalog data |
| `SpecialistSeatId` | slug in catalog | Model Fabric catalog data |
| `QualificationResultId` | `qres_<ulid-or-sha>` | Evaluation |
| `OwnerApprovalRefId` | `oap_<ulid>` | Owner / control plane |
| `ActivationRefId` | `act_<ulid>` | Owner / control plane |
| `StewardshipConsultationId` | `scc_<date>_<slug>` | Stewardship / control plane |
| `CouplingPreflightId` | `cpf_<ulid>` | Model Fabric control plane |
| `AdapterSemanticRevision` | `asr_<n>` | Model Fabric (Git) |

Wire/vendor model identifiers (`configuredModelId`) are **mutable policy
data**. Changing them does not reopen architecture (Q16).

### 1.2 Qualification subject (Q4)

```text
QualificationSubject
  = logicalRole
    + optional SpecialistSeatId
    + MaterialInferenceFingerprint
```

`MaterialInferenceFingerprint` is `sha256` over the canonical JSON of:

| Included | Excluded |
|---|---|
| `provider` | source-file bytes of an adapter with identical wire/semantic behavior |
| `configuredModelId` | `PortfolioRevisionId` alone |
| `resolvedModelId` when Evaluation binds it | fallback **ordering** among already-qualified occupants |
| `logicalRole` / seat | process PID, cooldown, TPM remaining |
| material `ReasoningPolicy` + effective provider control | Observability extras |
| structured-output mode | |
| privacy eligibility class | |
| context/profile/projection policy IDs that Evaluation currently treats as material | |
| identity/system prompt epoch when Evaluation binds it | |
| `AdapterSemanticRevision` when translation changes material inference | |
| materially changed fallback/**substitution** policy (new occupant or new substitution class) | |

Same model on another provider is a **different** subject. Same-model
NIM→Groq failover requires two `QualificationResult`s (Q5).

A fallback **chain** is not a transferable qualification blob. Evaluation
MAY write an aggregate readiness report that **cites** multiple
`QualificationResult`s. That report is not a `QualificationResult`.

`RoutePolicyRevision` / portfolio revision change does **not** invalidate
an otherwise identical role+fingerprint `QualificationResult`. It changes
policy/activation provenance only (Q6).

### 1.3 Admission basis

Reuse MF-M1 `RouteAdmissionBasis`:

```text
existing_compatibility
  | qualification_owner_approved
      { qualificationResultRef, ownerApprovalRef }
```

Production dispatch of a non-compatibility occupant additionally requires
the active pointer to cite an `ActivationRef` for that policy row
(MF-ACT). `OwnerApprovalRef` without `ActivationRef` MUST NOT dispatch
the new occupant.

### 1.4 Occupant vs policy row vs portfolio

```text
PortfolioRevision
  contains PolicyRow[]
PolicyRow
  = logicalRole + occupancyKey + ordered OccupantRef[]
OccupantRef
  = OccupantId + provider + backend + configuredModelId
    + reasoningPolicy + translation profile
    + privacyPolicyId + admissionBasis citation
```

Activation/rollback selects **one policy row** (Q13 + §0.1).
The `ActivationRef` MUST also cite `portfolioRevisionId` for provenance
(Q3).

---

## 2. Persistence and artifact locations (Q11)

No Model Fabric tables in `nuclear.db` or `continuity.db` for M2–M6 or
MF-ACT.

### 2.1 Git / versioned non-secret configuration

Repository root:

```text
config/model-fabric/
  README.md
  portfolios/
    current-compatibility.v1.json
    target-12-9.v1.json
  catalog/
    independence-groups.json
    seats.json
    coupling.json
  translation/
    reasoning-maps.json
```

These runtime Git paths are created in **MF-M2+ implementation**, not in
this planning freeze.

Pass-2 documentation fixtures live at
`docs/architecture/model-fabric/examples/`. They are **not** dispatchable,
not Mint state, and not the runtime path. Files marked
`incompleteFixture: true` MUST be completed from §10.5 (CURRENT) and
Architecture §12.9 (TARGET) before they become the Git snapshot. Do not
copy an incomplete fixture onto `config/model-fabric/` and dispatch it.

These files are policy. They are not live activation. Committing
`target-12-9.v1.json` MUST NOT change production routing.

`config/models.json` remains until MF-M2 cutover of **authority**. After
M2, enablement + quota contracts MUST be projected from the CURRENT
portfolio snapshot. M2 MUST NOT silently change occupant/provider/model
relative to `d918572c` live behavior.

Secrets never appear in these files.

### 2.2 Local immutable control / evaluation artifacts

Host-local, default:

```text
~/.composer-assistant/control/model-fabric/
  active.json
  qualifications/<QualificationResultId>.json
  approvals/<OwnerApprovalRefId>.json
  activations/<ActivationRefId>.json
  consultations/<StewardshipConsultationId>.json
  preflights/<CouplingPreflightId>.json
```

Override root with env `ASHLEY_MODEL_FABRIC_CONTROL_DIR` (configuration,
not architecture).

Rules:

- Files are immutable after write. Correction = new id that cites the old
  id (`revokes*` / `rollbackOf*`).
- No in-place mutation of a `QualificationResult`, approval, or
  activation.
- Evaluation owns qualification file **meaning**. Fabric may store the
  bytes in this directory but MUST NOT rewrite status.
- Luna / Evaluation / Fabric MUST NOT create `OwnerApprovalRef` or
  `ActivationRef`. Only an explicit owner/operator act may write those
  files. Implementation MAY provide a validator and an owner-invoked
  writer CLI/API that still requires owner authentication.

### 2.3 Active pointer

`active.json` schema: §MF-ACT.

Atomic replace:

1. Write `active.json.tmp` in the same directory.
2. `fsync` the temp file (and directory where the host requires it).
3. `rename` over `active.json`.

If `active.json` is absent or unreadable: dispatch the Git
`current-compatibility.v1` portfolio under `existing_compatibility`.
Do **not** dispatch `target-12-9`.

If `active.json` cites a policy row whose `ActivationRef` is missing,
revoked, whose `OwnerApprovalRef` is revoked, or whose
`QualificationResult` is stale/invalid: that row is not production-routed.
Fail per §4. If a current-compatibility row exists for the same
`logicalRole`+`occupancyKey`, use it. Never substitute an unqualified
target occupant.

### 2.4 Process-local health

Cooldowns, last-error, “unavailable this process” are process-local,
reconstructable, and **not** qualification authority (Q11, Q15). Restart
clears them. Next dispatch may probe again.

---

## 3. Shared schemas

JSON keys are camelCase. `schema` is required on every artifact.

### 3.1 PortfolioRevision

```json
{
  "schema": "ashley.model_fabric.portfolio_revision.v1",
  "portfolioRevisionId": "mfp_current_compatibility_v1",
  "kind": "current_compatibility",
  "status": "declared",
  "replacesPortfolioRevisionId": null,
  "notes": "Live MF-M1 snapshot. Not §12.9.",
  "policyRowIds": ["mfr_thought_interactive_compat_v1"]
}
```

Use `policyRowIds` for pointer form. Use inlined `rows` (objects, each
with `policyRowId`) as the example fixtures do. Do not invent a third
key such as `policyRows`.

`kind`: `current_compatibility` | `candidate_target` | `historical`.

`status`: `declared` | `superseded`. Never `production_routed`. Production
routing is only the active pointer.

A portfolio file MAY inline `rows` as objects instead of id pointers.
If inlined, each row MUST still carry `policyRowId`.

JSON examples in this file are executable guidance. They MUST match the
translation tables in §5. An occupant’s `reasoningPolicy` is authoritative
for that occupant’s wire translation. The row’s `reasoningPolicy` is the
default only when an occupant omits the field.

`occupantId` MAY repeat across policy rows. It is not the qualification
subject. Qualification is per (`policyRowId` + material inference
fingerprint). Interactive Thought and durable/proactive Thought therefore
need separate `QualificationResult`s even when they share a model id.

### 3.2 PolicyRow

CURRENT Thought interactive (normative example — not an empty row):

```json
{
  "schema": "ashley.model_fabric.policy_row.v1",
  "policyRowId": "mfr_thought_interactive_compat_v1",
  "portfolioRevisionId": "mfp_current_compatibility_v1",
  "logicalRole": "thought",
  "occupancyKey": "interactive",
  "seat": null,
  "purposes": ["thought"],
  "latencyClass": "interactive",
  "reliabilityClass": "explicit_fallback",
  "privacyPolicyId": "owner_private",
  "contextPolicyId": "thought_summary",
  "quotaCouplingIds": ["qc_nim_gpt_oss_20b", "qc_groq_gpt_oss_20b"],
  "reasoningPolicy": "economical",
  "structuredOutput": "json_schema",
  "deadlineMs": 6000,
  "maxOutputTokens": 1000,
  "failoverRemainingMsFloor": 2500,
  "failClosed": "role_existing"
}
```

A CURRENT Thought row MUST list both 20B occupants from §3.3. Do not ship
this illustration with empty occupants.

`occupancyKey` values used in this program:

| Role | occupancyKey | Notes |
|---|---|---|
| `thought` | `interactive` | Reactive Discord Thought |
| `thought` | `durable_proactive` | Durable/proactive Thought callers |
| `thought_observation` | `default` | Preserve configured≠dispatched |
| `expression` | `default` | Caller-owned substitution chain |
| `reflection_initiative` | `default` | Preserve Mistral-id-on-Thought scar |
| `exchange_cognition` | `default` | |
| `curiosity_consolidation` | `default` | Super activatable later; secondaries unordered |
| `maintenance` | `default` | |
| `engineering` | `direct_cognition` | MF-M1 `engineering-model-adapter.ts`. Not Track B |
| `engineering` | `routine_validation` | Specialist seat id. Dark until ActivationRef. Never selected by the engineering adapter |
| evaluation seats | seat id | Not user-visible production roles (Q9) |
| other specialist seats | seat id | M6 catalog; remain dark unless an owner ActivationRef names that seat |

### 3.3 OccupantRef

CURRENT Thought primary (normative example):

```json
{
  "occupantId": "mfo_nim_openai_gpt_oss_20b_low",
  "ordinal": 1,
  "provider": "nim",
  "backend": "nim",
  "configuredModelId": "openai/gpt-oss-20b",
  "independenceGroup": "openai_gpt_oss",
  "reasoningPolicy": "economical",
  "effectiveReasoning": "low",
  "adapterSemanticRevision": "asr_1",
  "privacyEligibility": ["owner_private"],
  "admissionBasis": {
    "kind": "existing_compatibility",
    "compatibilityBindingId": "compat_thought_nim_gpt_oss_20b_low_v1"
  },
  "fallbackClassFromPrevious": "none",
  "fallbackTriggerClasses": [],
  "qualificationResultId": null,
  "ownerApprovalRefId": null
}
```

CURRENT Thought Groq failover uses the same `reasoningPolicy` /
`effectiveReasoning` pair (`economical` / `low`) with
`fallbackClassFromPrevious: "transport_failover"`.

TARGET Thought occupants use `reasoningPolicy: "high"` and
`effectiveReasoning: "high"`. Never write CURRENT Thought as
`standard`/`low`. `standard` translates to GPT-OSS wire `medium`.

`qualification_owner_approved` is legal only with **non-null**
`qualificationResultRef` and `ownerApprovalRef`. Declared candidate
occupants omit `admissionBasis` until those records exist. A null ref is
not approval and MUST fail closed if a resolver sees that kind.

Occupant-level `qualificationResultId` / `ownerApprovalRefId` are
optional denormalized citations of the same strings. When present they
MUST match `admissionBasis`. Compatibility occupants use
`existing_compatibility` and keep those ids null.

`ordinal` 1 is primary. Later ordinals are the **approved ordered chain**
for that row (Q14). Curiosity candidate secondaries that are not yet
owner-ordered MUST NOT appear as ordinals. They MAY appear in
`unorderedCandidates` on the row (Q16).

### 3.4 QualificationResult citation (Evaluation-owned body)

Fabric consumes, does not judge. Minimum fields Fabric MUST be able to
read:

```json
{
  "schema": "ashley.evaluation.qualification_result.v1",
  "qualificationResultId": "qres_example",
  "status": "PASS",
  "subject": {
    "logicalRole": "thought",
    "seat": null,
    "materialInferenceFingerprint": "sha256:..."
  },
  "policyRowId": "mfr_thought_interactive_target_v1",
  "occupantId": "mfo_groq_openai_gpt_oss_120b_high",
  "profileBinding": {
    "profileId": "...",
    "profileVersion": 1,
    "profileFingerprint": "sha256:...",
    "provider": "groq",
    "configuredModelId": "openai/gpt-oss-120b"
  },
  "identityContinuityEpoch": null,
  "recommendation": "owner_review",
  "limitations": [],
  "invalidated": false,
  "invalidatedBy": null
}
```

`status` values remain Evaluation First Spike: `PASS` | `FAIL` |
`BLOCKED` | `INCONCLUSIVE` | `NOT_RUN`.

Only `PASS` plus a later `OwnerApprovalRef` can feed MF-ACT.
`recommendation` MUST NOT create approval or activation (Q12).

Interactive Thought 120B `high` MUST include empirical latency evidence
inside the §0.1 interactive envelope before that occupant may be approved
for `thought`/`interactive` (Q7). Durable/proactive may use a different
campaign binding. Failure of the interactive envelope returns evidence to
the owner. Do not silently raise 6000 ms.

### 3.5 OwnerApprovalRef (Q12)

```json
{
  "schema": "ashley.model_fabric.owner_approval_ref.v1",
  "ownerApprovalRefId": "oap_example",
  "decision": "approve",
  "qualificationResultId": "qres_example",
  "logicalRole": "thought",
  "seat": null,
  "policyRowId": "mfr_thought_interactive_target_v1",
  "occupantId": "mfo_groq_openai_gpt_oss_120b_high",
  "portfolioRevisionId": "mfp_target_12_9_v1",
  "consultationId": "scc_example_family_cutover",
  "createdBy": "owner",
  "createdAt": "2026-08-25T00:00:00.000Z",
  "revokesOwnerApprovalRefId": null
}
```

`decision`: `approve` | `revoke`.

New model-family approvals MUST cite a consultation whose
`ashleyPositionStatus` is `recorded`. Compatibility preservation does not.

Luna MUST NOT write this file.

### 3.6 ActivationRef (Q12, MF-ACT)

```json
{
  "schema": "ashley.model_fabric.activation_ref.v1",
  "activationRefId": "act_example",
  "kind": "activate",
  "policyRowId": "mfr_thought_interactive_target_v1",
  "portfolioRevisionId": "mfp_target_12_9_v1",
  "ownerApprovalRefIds": ["oap_primary", "oap_secondary"],
  "occupantsActivated": ["mfo_groq_openai_gpt_oss_120b_high", "mfo_nim_openai_gpt_oss_120b_high"],
  "couplingPreflightId": "cpf_example",
  "rollbackOfActivationRefId": null,
  "createdBy": "owner",
  "createdAt": "2026-08-25T00:00:00.000Z",
  "revokesActivationRefId": null
}
```

`kind`: `activate` | `rollback`.

Rollback MUST cite `rollbackOfActivationRefId` and select a **previously
approved** policy-row revision. It MUST NOT mutate historical
`ActivationRef` bytes.

Every occupant in `occupantsActivated` MUST have its own
`OwnerApprovalRef` citing its own `QualificationResult` (Q4, Q5).

### 3.7 Active pointer

```json
{
  "schema": "ashley.model_fabric.active_pointer.v1",
  "pointerGeneration": 1,
  "replacedPointerGeneration": 0,
  "rows": {
    "thought": {
      "interactive": "act_example"
    }
  }
}
```

Map is `logicalRole → occupancyKey → ActivationRefId`.
Absent keys mean current-compatibility for that row.

### 3.8 StewardshipConsultationRecord

```json
{
  "schema": "ashley.stewardship.consultation.v1",
  "consultationId": "scc_example",
  "clause": "SC-CON-04",
  "matterClass": "model_family_activation",
  "subject": "groq/nim openai/gpt-oss-120b as core Thought",
  "doesNotActivate": true,
  "ashleyPositionStatus": "recorded",
  "ashleyPosition": "affirm",
  "ashleyRationale": "...",
  "ashleyDecidedAt": "...",
  "docDecision": "approve",
  "docRationale": "...",
  "docDecidedAt": "..."
}
```

Constitution-text consultation already exists:

`../governance/SC-CON-04_2026-08-25_Constitution_Model.md`

That record MUST NOT be reused as `consultationId` for §12.9 activations.

---

## 4. Shared route-resolution, fallback, failure, health

### 4.1 Resolve algorithm (all later milestones)

1. Caller supplies purpose and optional explicit `route` / `model` /
   `logicalRole` / `specialistRequirement`.
2. Stamp `logicalRole` from caller; never infer it from the dispatched
   route.
3. Select policy row:
   - If this invocation is **specialist-seat resolution** (MF-M6) and
     `specialistRequirement.seat` is set: select the row whose `seat`
     equals that id. The MF-M1 `engineering-model-adapter` is **not**
     this path. It always uses `engineering` / `direct_cognition`.
   - Else use `logicalRole` + `occupancyKey` from the §3.2 table.
     Thought callers: `interactive` if Attention/deadline class is
     reactive Discord Thought; `durable_proactive` otherwise.
     `thought_observation` is a different logical role (`default` key)
     that still **dispatches** the Thought route (configured≠dispatched
     scar).
   - Do not invent occupancyKeys outside §3.2.
4. Choose CURRENT vs TARGET using §4.5. Never merge occupants from both
   into one chain.
5. Record explicit `route` / `model` overrides as overrides on the
   receipt. M2 preserves their current behavior. Later activation still
   must not delete them until the owner activates a row that replaces
   that scar.
6. Translate reasoning: occupant `reasoningPolicy` if present, else the
   row default. Fabric MUST NOT raise reasoning because a turn “looks
   difficult” (Q8).
7. Dispatch occupant ordinal 1 if that occupant is eligible under §4.5
   and healthy.
8. On failure, consider ordinal n+1 only if §4.2 allows.

### 4.2 Fallback (Q5, Q14)

| Class | Allowed |
|---|---|
| Transport failover | Same model family identity, different provider, **each occupant qualified+approved+active** (or each under `existing_compatibility` for the current live Thought 20B pair) |
| Model substitution | Only occupants already on that row’s approved ordered chain |
| Unqualified substitution | **Never** |
| Emergency unqualified availability | **Does not exist** |
| Quota-driven shopping | **Never**. Quota may only walk the already-approved chain (Q15) |

Outage MUST NOT rewrite canonical target policy files.

If no remaining eligible occupant **on the selected row**: fail according
to that row’s `failClosed`. For interactive Thought that is currently
the compatibility 20B row, keep today’s eligibility (NIM fail classes +
2500 ms floor). While a **target** 120B Thought row remains selected
(§4.5 C), do **not** silently dispatch 20B unless 20B is an explicit
qualified+approved occupant on **that same target row** (Q14). 20B
returns only by selecting the compatibility row after the target row is
no longer production-routed (§4.5 E).

Receipts MUST name the occupant that actually ran.

Same-invocation vs caller-owned:

- Preserve MF-M1: Thought NIM→Groq is **one invocation, two attempts**.
  Fabric owns eligibility via `fallbackTriggerClasses` (the live
  `ELIGIBLE_THOUGHT_FAILOVER_CODES` allowlist).
- Preserve MF-M1: Expression Mistral→Qwen is **caller-owned chain**, two
  invocations. Eligibility stays in `expression-fallback.ts`
  (`INELIGIBLE_FAILURE_CODES` plus lane/secret/profile gates). Fabric
  MUST NOT treat a missing or empty `fallbackTriggerClasses` on that
  occupant as “never fall back.”
- Do not collapse these.

### 4.3 Failure / UNKNOWN

Reuse MF-M1 `ModelFailureCode` / `dispatchTruth`. SLICE 0 R2: HTTP
observed ⇒ `response_received`; no HTTP ⇒ `sent_outcome_unknown`. Never
synthesize HTTP from `AppError` status alone.

UNKNOWN remains UNKNOWN. Do not map it to `REFUSED`.

### 4.4 Health predicates (M5; available as types from M2)

Distinct predicates, not one boolean:

| Predicate | Meaning |
|---|---|
| `configured` | Present on the policy row |
| `available` | Process-local: last probe did not prove durable unavailability |
| `ready` | `available` and not cooling down |
| `qualified` | `existing_compatibility` or non-invalidated `QualificationResult` `PASS` |
| `owner_approved` | Non-revoked `OwnerApprovalRef` (compatibility rows skip) |
| `active` | Pointer cites `ActivationRef` for this row, or compatibility default |
| `degraded` | Process-local elevated failure/cooldown |

`unhealthy != unqualified`. Recovery does not re-qualify (Architecture
§16, Q6).

Operational Continuity owns work-concern health. `GET /health` owns
process readiness. Attention owns TPM admission. Fabric MUST NOT
duplicate those owners. Fabric MAY consume an availability signal if OC
later exposes one; M2–M6 MUST work with process-local probes only.

### 4.5 CURRENT vs TARGET row selection (one interpretation)

Let `key` = (`logicalRole`, `occupancyKey`). Seat resolution uses `seat`
id instead of this key.

| Case | Selected row | 20B compatibility occupants |
|---|---|---|
| A. No `active.json`, or missing key | `current-compatibility` for `key` | Used (they are that row) |
| B. Pointer cites valid `ActivationRef` + approvals + non-invalidated `PASS` fingerprints | **Target** policy row named by that ref | Not used, unless they are occupants **on that target row** |
| C. Valid target row, primary unhealthy | Next approved occupant **on the target row** | Not inserted |
| D. Pointer/ref/approval/qualification missing, revoked, stale, or fingerprint mismatch | Target key is not production-routed. Use `current-compatibility` for the same `key` if it exists; else fail closed | Used only because the **compatibility row** is selected, not mixed into the target chain |
| E. Crash leaving `active.json.tmp` | Ignore tmp; use existing `active.json` or A | Per A/B |
| F. Restart | Reload `active.json`; process-local cooldowns empty | Per A/B |
| G. Unqualified fallback occupant | Skip it; never dispatch it | Never as an emergency extra |
| H. Dark `routine_validation` (no ActivationRef) | Do not dispatch that seat. Engineering caller stays `direct_cognition` | N/A |
| I. Zen absent / unqualified | Compatibility utility; core Thought/Expression unchanged | Thought failover bucket untouched |

Never merge CURRENT and TARGET occupants into one ordered chain.

---

## 5. Reasoning translation (Q8)

Role policy supplies the default `ReasoningPolicy`.
Fabric translates to provider wire. No per-turn escalation in this
program.

A future Thought-owned cognitive-effort signal MAY add a bounded
per-invocation **override** later without moving ownership into Fabric.
That signal does not exist in M2–MF-ACT. Do not add a hidden Attention
“difficulty” raiser.

Git file `config/model-fabric/translation/reasoning-maps.json`:

### 5.1 GPT-OSS on Groq and NIM

Published wire: `low` | `medium` | `high` only.
Normalized `high` and `max_supported` collapse to wire `high`.

| Policy | Wire |
|---|---|
| `disabled` | `capability_mismatch` fail-closed (no published off switch) |
| `economical` | `low` |
| `standard` | `medium` |
| `high` | `high` |
| `max_supported` | `high` |

Current live Thought is wire `low` = policy `economical` for
compatibility rows. Do not relabel it as `standard` without an
`AdapterSemanticRevision` and a behavior-preserving characterization
test. M2 MUST keep sending `low` for current Thought.

Target interactive Thought: policy `high` once qualified (Q8).

### 5.2 Qwen 3.6 27B on Groq

Published: `none` | `default`.

| Policy | Wire |
|---|---|
| `disabled` | `none` |
| `economical` | `none` |
| `standard` | `default` |
| `high` | `default` |
| `max_supported` | `default` |

Live Expression fallback sends `none`. Keep that on the compatibility
row. Target primary is `default`, not `none` (Architecture §12.9).
Target fallback: `economical` if exposed, else provider default.

### 5.3 Mistral Medium

No GPT-OSS-style effort dial on the current adapter. Compatibility:
omit extra reasoning fields (current behavior). If a policy requests
`max_supported` on Mistral, send provider default; do not invent a
hidden chain-of-thought flag.

### 5.4 Nemotron 3 Ultra / Super (NIM)

Thinking on/off via chat template / official controls.

| Policy | Wire |
|---|---|
| `disabled` | thinking off |
| `economical` | thinking on, provider minimum if a numeric dial exists, else on |
| `standard` | thinking on |
| `high` | thinking on |
| `max_supported` | thinking on at provider maximum documented control |

Exact wire keys are adapter data. Changing them without changing
observable thinking is not a new fingerprint. Changing on/off **is**.

### 5.5 Nemotron 3.5 Lightning

Utility/validation. Map `disabled`/`economical` to the lightest
documented control; `standard` to documented default. Fail closed if
the requested policy cannot be expressed.

### 5.6 Inkling / Muse Glimmer

Glimmer published strengths include `xhigh`.
`max_supported` → `xhigh` when that control exists.
`high` → `high`.
Inkling: use official controllable effort; `max_supported` = maximum
documented. Independence_group still differs even when both are NVIDIA
hosts (Q10: group is training-lineage, not provider).

### 5.7 OpenCode Zen Track A

Utility-only. No tools. Reasoning maps are per occupant ID in the
catalog. If unknown, fail closed (`capability_mismatch`), do not guess.

If a map would clamp silently to a weaker policy than requested for a
**target** row, fail closed instead of lying. Compatibility rows preserve
today’s wire even when the historical name is ugly.

---

## 6. Privacy / data eligibility seam

Ethics and Architecture §23.6 own meaning. Fabric enforces occupant
`privacyEligibility` versus the row’s `privacyPolicyId` and the
projection classification.

| Occupant class | Eligible for |
|---|---|
| Current NIM/Groq/Mistral paid or account routes as used today | Current compatibility classes |
| NVIDIA **trial** / Zen **free** promotional endpoints | Not `owner_private`; not core Thought; not Expression, unless a future privacy `QualificationResult` explicitly approves that endpoint/data class (Q17) |
| Zen HTTP utility | Redacted utility projections only until privacy qualification says otherwise |

Fabric is not a general data-governance owner. It refuses dispatch on
mismatch (`ModelFailureCode` stays `capability_mismatch` or a dedicated
sanitized class already used for privacy refusals if one exists; do not
invent a cognition policy).

Secrets stay in `~/.composer-assistant/.env`. Never in Git policy,
receipts, or control artifacts.

---

## 7. Observability

- Keep stage-valid receipts from MF-M1 + SLICE 0.
- Extend owner `GET /nuclear/routing` to expose: portfolio id, policy-row
  id, occupant id, admission basis, active `ActivationRefId` or
  `compatibility_default`, health predicates, configured vs dispatched
  route.
- Do not add Event Spine.
- Receipts are not qualification. Telemetry is not authority.

---

## 8. Concurrency and idempotency

- Attention remains the admission serializer for in-process model calls.
- One HTTP per attempt. No hidden SDK retries.
- Active-pointer replace is atomic rename. Two owner activations: both
  `ActivationRef` files remain; the pointer names at most one per
  policy row.
- Control artifacts are content-addressed by id. Rewriting the same id
  is forbidden.
- Catalog discovery (if OC-admitted later) creates `unqualified` records
  only. It is not a daemon in M2–M6 (Q15).

---

## 9. SLICE 0 — MF-M1 receipt repairs + retry pin

### 9.1 Wave identity

| Field | Contract |
|---|---|
| Name / ID | SLICE 0 (mandatory predecessor of MF-M3 evidence use) |
| Track | mechanism |
| Purpose | Make MF-M1 receipts match the already-closed attempt ontology |
| Existing owner | Model Fabric |
| Must already be true | MF-M1 local candidate `d918572c` |
| Must not be treated as required | §12.9, OpenCode, qualification campaigns |
| Creates | Truthful invocation `fallbackClass`; HTTP-vs-unknown `dispatchTruth` |
| Does not create | Routing change; architecture reopen |
| Forbidden reading | “Repair allows Qwen-primary or 120B Thought” |
| Promotion | Out of scope |
| Rollback | Revert the two receipt paths; keep live failover eligibility |

### 9.2 R1

**Where:** `apps/agent-service/src/mistral-client.ts` failure finalize.

**Must:** on catch, set invocation `fallbackClass` the same way as the
success path:

```text
transportFailoverUsed
  ? "transport_failover"
  : options.modelFallbackChain?.fallbackClass ?? "none"
```

Do not infer class from attempt count.

**Tests:**

1. NIM eligible fail + Groq fail + remaining deadline ≥ 2500 ms → two
   attempts, invocation `fallbackClass=transport_failover`, no third
   adapter call.
2. NIM ineligible fail (`AbortError`) → one attempt, `none`, Groq not
   called.
3. NIM eligible fail + remaining < 2500 ms → one attempt, `none`.
4. Expression primary fail without Thought failover → not
   `transport_failover` unless the caller chain says so.

### 9.3 R2

**Must:** `provider_response` / `response_received` only when the adapter
**observed an HTTP response** (`!res.ok` or SDK status 4xx/5xx).
Connection failures, DNS, `ECONNREFUSED`, abort with no response remain
`dispatch_attempted` / `sent_outcome_unknown`.

Do not treat synthesized `AppError.httpStatus` as HTTP proof.
Do not change Expression fallback **eligibility** error-code sets.

**Tests:** listed in Pass-1 research audit §24 R2. Keep the existing
AppError 429 test. Add SDK-shaped non-AppError 429 → `response_received`.
Add Groq/NIM fetch throw without status → `sent_outcome_unknown`.
Still one `dispatch` per attempt.

### 9.4 Mistral retry pin

Owner placed the pin in **M2**. Implement it in M2 (or in SLICE 0 if
that is the same candidate, which is preferred). Construct
`new Mistral({ apiKey, retryConfig: { strategy: "none" } })`.
Characterization: still one HTTP per attempt.

Do not add OpenAI/Groq official SDKs on this path.

### 9.5 Prohibited

Live route changes. Observation Groq-key repair. Reflection
Mistral-id-on-NIM repair. Engineering quota decoupling.
`ContextProjection`-only enforcement.

### 9.6 Completion gate

Focused Fabric/routing tests green for R1/R2. `git diff --check` clean
on touched files. No Mint.

---

## 10. MF-M2 — unified CURRENT policy snapshot

### 10.1 Wave identity

| Field | Contract |
|---|---|
| Name / ID | MF-M2 |
| Track | mechanism |
| Purpose | Replace split route authority with one validated CURRENT snapshot consumed by dispatch and status, with zero intended user-visible routing change |
| Existing owner | Model Fabric |
| Must already be true | MF-M1 seam; SLICE 0 in the same program before M3 uses receipts |
| Must not be treated as required | Qualification campaigns; OpenCode; §12.9 activation; Event Spine |
| Creates | Git `current-compatibility.v1` portfolio; typed resolver; override recording; registry snapshot identity; Mistral retry pin |
| Does not create | Target routing; Fabric DB; specialist production; observation-behavior repair |
| Forbidden reading | “Unified registry means Qwen-primary / 120B Thought” |
| Evidence | Characterization of every current caller vs `d918572c` behavior |
| Verification | Settlement tests: purpose-only vs explicit route; observation mismatch still recorded; Thought failover; Expression substitution; no hidden retry |
| Promotion | Out of scope |
| Rollback | Keep previous split authority behind a flag **only if** tests prove byte-compatible dispatch; prefer one-way cut of authority with identical occupants |

### 10.2 Ownership / non-ownership

**Owns:** CURRENT policy object, resolve, translation for current
occupants, snapshot hash, recording of overrides, adapter identity
unification.

**Does not own:** Evaluation meaning, activation, Track A/B, Metacognition,
OC health plane, Context Budget selection.

### 10.3 Dependencies

`HARD_DEPENDENCY` on MF-M1 types/receipts.
`OWNER_SELECTED_IMPLEMENTATION_ORDER`: SLICE 0 before treating receipts
as evidence. M2 code may land in the same candidate as SLICE 0.

### 10.4 Inputs / outputs

**In:** existing `completeChat` options (purpose, route, model, messages,
deadline, `logicalRole`, `specialistRequirement`, `modelFallbackChain`).

**Out:** same chat result + `ModelFabricDispatchMetadata` with
`ResolvedModelRoute.registryVersion` equal to
`sha256` of the loaded CURRENT portfolio canonical JSON.

### 10.5 CURRENT snapshot content (must match live)

Encode, do not repair:

| Policy row | Live occupant behavior to preserve | Normalized `ReasoningPolicy` / wire |
|---|---|---|
| `thought` / `interactive` | NIM `openai/gpt-oss-20b` `reasoningEffort: "low"` → Groq same-model 20B; eligible fail classes unchanged; 6000 ms; 1000 output tokens; 2500 ms floor | `economical` / `low` |
| `thought` / `durable_proactive` | Same occupants/wire as today for durable/proactive Thought callers; deadline = remaining job time or none | `economical` / `low` |
| `thought_observation` / `default` | Configured `utility_bulk`, dispatched `thought`; Groq-key enqueue no-op remains | `economical` / `low` (same Thought wire; do not send utility `medium`) |
| `expression` / `default` | Mistral `env.mistralModel` primary; caller-owned Groq `qwen/qwen3.6-27b` `none`; 4000 ms reactive | Primary: row default `standard`, Mistral omits effort fields. Fallback occupant: `economical` / `none` |
| `exchange_cognition` / `default` | Groq 20B `medium` via `utility_bulk`; no fallback | `standard` / `medium` |
| `curiosity_consolidation` / `default` | Same as exchange today | `standard` / `medium` |
| `reflection_initiative` / `default` | Forced `thought` + `model: env.mistralModel` | Preserve omitted GPT-OSS effort plus explicit model override; do not “fix” onto 20B GPT-OSS |
| `engineering` / `direct_cognition` | Omitted purpose → Expression route; `SpecialistRequirement` recorded, not selected | Same as Expression primary (Mistral, no Lightning) |
| `maintenance` / `default` | Mapped `utility_bulk`; no production caller required | `standard` / `medium` if that mapping is dispatched |

Shared bucket `groq:openai/gpt-oss-20b` remains.

`models.json` `purpose_routes` is **not** the resolver. After M2 the
Git portfolio is. Quota/enablement currently in `models.json` MUST be
copied into the snapshot so enablement cannot drift.

The documentation fixture
`docs/architecture/model-fabric/examples/current-compatibility.v1.json`
encodes Thought + Expression only. Luna MUST complete the remaining
§10.5 rows before treating a Git snapshot as the CURRENT authority.
An incomplete fixture is not a license to drop those callers.

### 10.6 Caller migration (frozen)

Migrate **all** production `completeChat` callers onto the unified
CURRENT resolver in one M2 seam. Keep explicit `route` / `model`
overrides as **recorded overrides**, not deleted behavior.

Do not migrate role-by-role in M2. Role-by-role is MF-ACT (Q13).

Blast radius if overrides were dropped: observation would hit
`utility_bulk`; reflection would stop sending Mistral id on Thought;
engineering would need an explicit purpose.

### 10.7 Candidate target file

M2 MAY add `target-12-9.v1.json` as **declared candidate** data. M2 MUST
NOT read it for dispatch.

### 10.8 State machine

```text
declared CURRENT snapshot
  -> loaded at process start
    -> hashed registryVersion
      -> resolve each call against that snapshot
```

Hot-reload of CURRENT is not required in M2. Restart picks up Git
changes. That is not activation of target rows.

### 10.9 Migration / compatibility

`existing_compatibility` tuples remain the admission basis.
Do not fabricate `QualificationResult`s for current routes.

### 10.10 Falsification tests

- Snapshot hash stable for canonical JSON (key order frozen by serializer).
- CURRENT Thought rows: `reasoningPolicy === "economical"` and
  `effectiveReasoning === "low"` for both NIM and Groq 20B occupants.
- TARGET Thought rows (declared, not dispatched): `high` / `high`.
- Purpose-only Thought matches live NIM→Groq eligibility.
- Explicit `route: "thought"` on observation still dispatched as thought;
  receipt configured ≠ dispatched.
- Expression chain ordinals unchanged.
- Reflection still sends Mistral model id on Thought route.
- Engineering still Expression-quota coupled; specialist recorded.
- Disabled route fail-closed.
- Unknown route fail-closed.
- Hidden retry: one adapter HTTP per attempt; Mistral client
  `retryConfig.strategy === "none"`.
- Loading `target-12-9` must not occur on the dispatch path (unit
  assertion on resolver inputs).
- R1/R2 still green.

### 10.11 Acceptance evidence

Settlement of Fabric/routing tests. Characterization matrix vs the
Pass-1 caller inventory. No Mint. No `models.json` occupant change
except moving authority into the snapshot **without** occupant change.

### 10.12 Completion gate

CURRENT snapshot is the only dispatch authority for production callers.
Live behavior matches `d918572c`. `Routing_Status.md` re-audited against
the same source behavior (still current facts, not targets).

### 10.13 Prohibited

§12.9 dispatch. OpenCode. Repairing observation/reflection/engineering
scars. Fabric DB. Periodic catalog daemon.

---

## 11. MF-M3 — catalog and qualification records

### 11.1 Wave identity

| Field | Contract |
|---|---|
| Name / ID | MF-M3 |
| Track | mechanism |
| Purpose | Minimum catalog + qualification **records**: occupancy, packs as named targets, lifecycle, `independence_group`. Discovery may create `unqualified` only |
| Existing owner | Model Fabric records; Evaluation owns result meaning |
| Must already be true | MF-M2 identity; SLICE 0 receipt truth |
| Must not be treated as required | OpenCode production route; Event Spine; running full Evaluation spike on Mint |
| Creates | Git catalog; lifecycle records; binding types; independence groups; pack names; local qualification artifact **layout** |
| Does not create | Production OpenCode; auto-promotion; thresholds; dual-run of user turns |
| Forbidden reading | “Catalog entry is routable” |
| Evidence | Discovery cannot promote; compatibility not rewritten as QualificationResult |
| Verification | Unit/settlement on record state machine |
| Promotion | Out of scope |
| Rollback | Catalog files revert; live routing unchanged |

### 11.2 Ownership

**Fabric owns:** occupancy records, seat catalog, independence_group
**data**, mechanical binding to `QualificationResultId`.

**Evaluation owns:** campaign, judges, pass/fail, identity continuity
epoch, whether independent dual review was satisfied.

**Does not own:** Identity writes, Track B, activation.

### 11.3 Lifecycle (records only)

```text
discovered
  -> unqualified
    -> qualifying
      -> qualified
        -> owner_approved
          -> (MF-ACT) routable_while_healthy
degraded | unavailable | retired
```

M3 may write through `owner_approved` **only as a citation** of an
owner-created `OwnerApprovalRef`. M3 code MUST NOT mint that ref.

`discovered → unqualified` is allowed from:

- explicit owner/operator import;
- Network/OC-admitted discovery **if already authorized** (Q15).

No periodic Fabric daemon.

### 11.4 Catalog files

`independence-groups.json` (Q10) — training-lineage groups. Different
provider alone is not independence. Minimum declared groups (data, not
architecture):

```text
openai_gpt_oss
nvidia_nemotron
alibaba_qwen
mistral
thinkingmachines_inkling
meta_muse
minimax
```

Same GPT-OSS id on Groq and NIM = `openai_gpt_oss`.

Mandatory materially independent dual review (Evaluation-enforced, Fabric
refuses to treat same-group as independent):

- high-impact identity/model-family qualification already required by
  Evaluation Plane;
- `architecture_critique` when that seat is active;
- `adversarial_audit` when that seat is active.

Not required for ordinary Reflection or Expression.

`seats.json` — seats persist; models occupy. Include all Architecture
§12.4 seats plus Evaluation seats as `evaluation_*` with
`userVisibleProductionRole: false` (Q9).

First vertical activation **candidate** (not live): `routine_validation`
occupant target Nemotron 3.5 Lightning (Q18). All other seats
`candidate_only: true`.

Pack names remain Architecture §15 categories. M3 does not invent
numeric thresholds.

### 11.5 Target portfolio records

Write `target-12-9.v1.json` with §12.9 occupants as **candidate** rows.
Vendor strings are policy data. Curiosity secondaries live in
`unorderedCandidates` only (Q16). Only Super is activatable until
secondaries are individually qualified, owner-approved, **and** the
owner approves an ordered chain. Evaluation MUST NOT auto-order from a
score.

### 11.6 Qualification invalidation consumer (Q6)

Fabric MUST refuse to treat a `QualificationResult` as live when:

- subject fingerprint no longer matches;
- `invalidated: true`;
- Evaluation identity-continuity epoch bound on the result no longer
  matches;
- occupant substitution class changed.

MUST NOT invalidate merely because adapter source bytes changed with
identical wire/semantic behavior.

### 11.7 Shadow (closed)

No default live dual-run of user turns.
Shadow/counterfactual is Evaluation-only when a campaign requires it.
`SHADOW OUTPUT != LIVE AUTHORITY`.
Do not require E6 shadow evidence for every route.

### 11.8 Persistence

Git catalogs + local `qualifications/` directory layout.
No Fabric tables.

### 11.9 Falsification tests

- Import/discovery creates `unqualified`, never `owner_approved`.
- Binding cannot reconstruct profile fields from route preference.
- `existing_compatibility` cannot be converted to `QualificationResult`
  by M3.
- Same-group judges cannot satisfy an independence constraint.
- Aggregate portfolio report cannot be passed to the resolver as a
  `QualificationResult`.
- Unordered curiosity candidates cannot dispatch.
- Evaluation judge seats are not registered as user-visible production
  roles.

### 11.10 Completion gate

Catalog exists. Lifecycle is enforced in code. No production route uses
catalog occupancy. Target file present and unused by dispatch.

### 11.11 Prohibited

Activating Lightning, Ultra, Super, Inkling, Glimmer, MiniMax, 120B
Thought, Qwen-primary. Running user-turn shadows. Fabric DB.

---

## 12. MF-M4 — Track A Zen HTTP utility backend

### 12.1 Wave identity

| Field | Contract |
|---|---|
| Name / ID | MF-M4 |
| Track | mechanism |
| Purpose | First Track A inference backend: OpenCode Zen HTTP chat-completions, utility-only, fail-closed if absent |
| Existing owner | Model Fabric |
| Must already be true | MF-M3 records exist so an occupant cannot become live without qualification records |
| Must not be treated as required | Track B; `opencode serve`; Thought/Expression on Zen; owner ActivationRef |
| Creates | `DeliveryBackend = opencode_zen_http` adapter; one POST per attempt; fail-closed absent/unqualified |
| Does not create | Worker execution; tools; subagents; production utility cutover |
| Forbidden reading | “Zen is in the repo, so utility rides Zen” |
| Evidence | Core Ashley boots without Zen key; no Thought failover theft |
| Verification | Adapter tests with recorded HTTP; no tools field; retry none |
| Promotion | Out of scope |
| Rollback | Disable backend; compatibility utility remains Groq 20B |

### 12.2 Transport (Q17) — closed

```text
POST https://opencode.ai/zen/v1/chat/completions
Authorization: Bearer <env secret>
Content-Type: application/json
```

Use raw `fetch` (same family as Groq/NIM). Do not add an SDK with
default retries.

Env secret name is configuration (`OPENCODE_ZEN_API_KEY` recommended).
Never commit it.

**In scope:** utility-only inference, Ashley-owned messages, no tools,
no worker, no subagents, no Track B authority, no Thought, no
Expression, no owner-private cognition unless a future privacy
qualification explicitly approves the endpoint/data class.

**Out of scope:** isolated `opencode serve` (future research). Occupants
that require `POST /zen/v1/responses` instead of chat-completions are
**not eligible** for this adapter (`capability_mismatch`).

### 12.3 Fail-closed

| Condition | Behavior |
|---|---|
| Key absent / HTTP unreachable / unqualified occupant | Core Ashley continues on current-compatibility utility |
| Unauthorized substitution onto Thought failover bucket | Forbidden. Zen MUST NOT steal `groq:openai/gpt-oss-20b` Thought failover capacity |
| Tools / MCP / skills / filesystem in request | Forbidden. Assert empty `tools` / no tool-choice |

Live dispatch of a Zen occupant still requires later
`QualificationResult` + `OwnerApprovalRef` + `ActivationRef`. M4 may
ship the adapter dark.

### 12.4 State machine

```text
backend_configured
  -> backend_absent | backend_present
       -> occupant_unqualified (dark)
         -> (owner MF-ACT) occupant_active_utility_only
```

Boot never fails because Zen is missing.

### 12.5 Falsification tests

- No env key: agent-service starts; Thought/Expression unchanged.
- Adapter sends exactly one POST per attempt; no retries.
- Request has no `tools`.
- Occupant without qualification+approval+activation never dispatched.
- Responses-only model id refused.
- Privacy: owner_private projection refused for trial/free Zen.
- Thought failover still Groq 20B under compatibility.
- Hidden retry absent.

### 12.6 Completion gate

Adapter present, dark, fail-closed. No Mint. No production utility
cutover.

### 12.7 Prohibited

Track B. Thought/Expression on Zen. `opencode serve`. Auto-enablement
because a free model appeared in `/zen/v1/models`.

---

## 13. MF-M5 — availability among approved occupants

### 13.1 Wave identity

| Field | Contract |
|---|---|
| Name / ID | MF-M5 |
| Track | mechanism |
| Purpose | Dynamic availability and owner-approved pools among **already-approved** occupants. Not Thought/Expression cutover |
| Existing owner | Model Fabric |
| Must already be true | M3 records; M4 adapter may be absent |
| Must not be treated as required | MF-ACT owner records; OC health plane |
| Creates | Health predicates; cooldown; walk approved chain (Q14); coupling-aware pool status |
| Does not create | Core cutover; cheaper unqualified occupant; catalog daemon |
| Forbidden reading | “Quota pressure picked Lightning for Thought” |
| Evidence | Unhealthy ≠ unqualified; recovery ≠ re-qualify; quota exhaustion ≠ policy rewrite |
| Verification | Unit tests on chain walk and fail-closed |
| Promotion | Out of scope |
| Rollback | Disable health walker; compatibility failover remains |

### 13.2 Rules (Q14, Q15)

Within an already-qualified, owner-approved, **ordered** chain for a
row, Fabric MAY use the next **ready** occupant. Receipts expose which
ran. Canonical target files do not change.

Quota/rate pressure may use only that chain. It may never choose an
arbitrary cheaper occupant. Budget exhaustion outside the chain fails
closed.

No periodic qualification daemon.

Thought/Expression remain on compatibility rows unless MF-ACT later
activates them. M5 MUST NOT treat §12.9 as approved.

### 13.3 Falsification tests

- Pool cannot include unqualified occupant.
- Unhealthy primary → next approved occupant; policy file unchanged.
- No secondary → fail closed.
- Thought compatibility still 20B NIM→Groq, not 20B→Lightning.
- Cooldown dies on process restart.
- `GET /nuclear/routing` shows predicates without implying
  qualification.

### 13.4 Completion gate

Health walker exists. No §12.9 production routing.

### 13.5 Prohibited

Core cutover. Daemon. Remaining-quota oracle invention. OC fencing
duplication.

---

## 14. MF-M6 — specialist-seat resolution

### 14.1 Wave identity

| Field | Contract |
|---|---|
| Name / ID | MF-M6 |
| Track | mechanism |
| Purpose | Generic specialist-seat resolution. First vertical **candidate**: `routine_validation` / Nemotron 3.5 Lightning. Dark until owner records |
| Existing owner | Model Fabric |
| Must already be true | M3 seat catalog; M5 health among approved |
| Must not be treated as required | Full specialist portfolio activation; Track B worker |
| Creates | Requirement → resolve approved occupant → real session id only if a specialist actually ran |
| Does not create | Sandbox effects; Evaluation pass semantics; fabricated `SpecialistSession` |
| Forbidden reading | “M6 means all seats are live” |
| Evidence | Unqualified occupant cannot be selected; empty seat fails closed |
| Verification | Unit tests on resolve and session fabrication ban |
| Promotion | Out of scope |
| Rollback | Resolver unused; engineering remains record-only requirement |

### 14.2 Evaluation seats (Q9)

Evaluation owns the semantic judge seat and campaign.
Fabric resolves the approved mechanical occupant for that seat.
Judge seats are **not** ordinary user-visible production roles.

### 14.3 First vertical (Q18)

```text
seat: routine_validation
initial target occupant: Nemotron 3.5 Lightning
wire id (policy data): nvidia/nemotron-3.5-lightning-30b-a3b
```

May become live only after `QualificationResult` + `OwnerApprovalRef` +
`ActivationRef`. Luna implements mechanics and qualification **support**.
Luna MUST NOT create the owner records.

All other seats remain catalogued/candidate.

### 14.4 Session rule

Do not fabricate `SpecialistSession` when no specialist executed.
MF-M1 branded invocation `sessionId` as `SpecialistSessionId` — do not
treat that as a specialist session. M6 may introduce a distinct
`executedSpecialistSessionId` that is set only after a real specialist
invocation.

Engineering `SpecialistRequirement` today is record-only. M6 MUST NOT
silently start selecting Lightning for engineering cognition. The
`routine_validation` policy row is selected only by specialist-seat
resolution. It is never the row for `engineering-model-adapter.ts`.

Direct engineering cognition (Ultra / Glimmer / Super) remains §12.9
target, not M6 activation.

Track B worker remains Agency → Authority → Durable Work.

### 14.5 Independence on resolve

If `requiredIndependenceGroup` is set, the occupant’s group MUST differ
for dual-review seats. Same-family agreement is not sufficient
independence (Q10).

### 14.6 Falsification tests

- Requirement cannot select unqualified occupant.
- `routine_validation` dark without ActivationRef.
- Other seats refuse production resolve.
- No specialist run ⇒ no executed session id.
- Evaluation seat resolve does not send user-visible Discord Expression.
- Track B not invoked.

### 14.7 Completion gate

Generic resolver + dark `routine_validation` candidate. No portfolio
activation.

### 14.8 Prohibited

Activating architecture/implementation/review/audit seats. Track B.
User-visible judge roles.

---

## 15. MF-ACT — activation mechanism

### 15.1 Wave identity

| Field | Contract |
|---|---|
| Name / ID | MF-ACT |
| Track | mechanism (control plane) |
| Purpose | Implement owner-gated per-role activation/rollback without performing any target cutover in the autonomous program |
| Existing owner | Model Fabric control plane; Stewardship for consultation; Evaluation for QualificationResult |
| Must already be true | M2 snapshot; M3 records; schemas in §3 |
| Must not be treated as required | Owner actually signing a §12.9 ActivationRef |
| Creates | Validator, atomic pointer, coupling preflight, fail-closed stale handling, owner-invoked writer |
| Does not create | Any production target route; Evaluation recommendation as approval |
| Forbidden reading | “MF-ACT implemented, therefore 120B Thought is live” |
| Evidence | Pointer atomicity; missing/stale refs fail closed; Luna cannot mint owner refs in tests except via explicit fixture marked non-production |
| Verification | Unit tests on pointer rename, stale qual, coupling preflight, rollback provenance |
| Promotion | Out of scope. Production qualification of a route is a **later owner gate** |
| Rollback | Pointer restore to previous generation; new rollback `ActivationRef` |

### 15.2 Two owner acts (Q12)

```text
1. OwnerApprovalRef
     cites QualificationResult + role/seat/policy row/occupant
2. ActivationRef
     cites exact approved policy revision/role row to become production-routed
```

Neither Evaluation nor qualification nor Luna creates these.
`OwnerApprovalRef` does not imply activation.
Both are revocable through new governed records, not mutation.

### 15.3 Per-role activation (Q13)

Unit = one policy row (`logicalRole` + `occupancyKey`).
Thought `interactive` and `durable_proactive` are separate (§0.1).
Expression is independent of Thought.

Coupling preflight MUST load `config/model-fabric/catalog/coupling.json`
and require joint **review** when shared provider buckets would be
affected. Preflight failure blocks the pointer write. It does not merge
roles into one activation unit.

### 15.4 Coupling preflight

Minimum couplings to declare (current + target families):

| Id | Members |
|---|---|
| `qc_groq_gpt_oss_20b` | utility_bulk, Thought 20B failover |
| `qc_nim_gpt_oss_20b` | Thought 20B primary |
| `qc_groq_gpt_oss_120b` | target Thought rows sharing Groq 120B |
| `qc_nim_gpt_oss_120b` | target Thought NIM 120B |
| `qc_groq_qwen_27b` | Expression Qwen |
| `qc_mistral_medium` | Expression Mistral |
| `qc_nim_lightning` | routine_validation + bulk Lightning if both ever active |

Preflight records: buckets touched, other active rows sharing them,
owner acknowledgement field. Without acknowledgement when overlap
exists, refuse pointer write.

### 15.5 Fail-closed stale / unqualified

Refuse to activate if any occupant lacks `QualificationResult` `PASS`,
has `invalidated: true`, fingerprint mismatch, missing
`OwnerApprovalRef`, revoked approval, missing SC-CON-04 recorded Ashley
position for **new family**, or privacy mismatch.

If an already-active row later becomes stale: stop dispatching that
target row (§4.5 D); revert that key to current-compatibility if present;
else fail the role closed. Never insert 20B under a still-selected 120B
Thought row unless 20B is on that target row (Q14, Q5, §4.5 C vs D).

Invalidation is **resolver-only**. Do not auto-write a rollback
`ActivationRef` or mutate `active.json`. Owner rollback (§15.1) is a
distinct pointer write.

### 15.6 Restart / crash

- `active.json` survives process restart (local file).
- Temp file left behind is ignored; previous `active.json` remains.
- Crash during rename: POSIX rename atomicity; on Windows use the same
  directory replace pattern already used elsewhere in the repo if one
  exists, else document `MoveFileEx` replace-if-exists. Tests must cover
  “tmp remains, old pointer still used.”
- Process-local health does not survive. Pointer does.

### 15.7 Production qualification gate (owner, not Luna)

A target route is production-routed only when **all** are true:

1. Occupant `QualificationResult` `PASS` and not invalidated.
2. Interactive Thought 120B `high` passed the 6000 ms / 1000 token /
   2500 ms envelope if the row is `thought`/`interactive` (Q7).
3. SC-CON-04 consultation recorded with Ashley position for new families.
4. `OwnerApprovalRef` `approve`.
5. Coupling preflight passed.
6. `ActivationRef` written by the owner.
7. Active pointer cites that ref.
8. Exact candidate deployed and owner-accepted per Wave Acceptance.
   Tests never promote.

Luna’s MF-ACT completion = mechanics + tests with **fixtures**.
Fixtures MUST use `kind: fixture` / non-production paths so they cannot
be copied onto Mint as live activations.

### 15.8 Owner-invoked writer

Provide an owner-authenticated control-plane method (HTTP already used
for other owner POSTs, or a CLI that fails without owner auth) that:

- validates schemas;
- refuses to write if Luna/test env tries to activate §12.9 without
  owner auth;
- performs atomic pointer replace.

Do not add a Discord slash command that silently activates.

### 15.9 Falsification tests

- Approval without activation ⇒ still compatibility dispatch.
- Activation without approval ⇒ pointer write refused.
- Stale qualification ⇒ row not dispatched.
- Unqualified fallback occupant ⇒ not dispatched even if primary fails.
- Rollback writes a new `ActivationRef` citing previous approved row.
- Mutating an old `ActivationRef` file is detected/refused.
- Partial pointer write cannot leave mixed target/compat occupants inside
  one row.
- Coupling overlap without acknowledgement ⇒ refuse.
- Fixture activations cannot load from production control dir.
- Missing `active.json` ⇒ compatibility, not target.

### 15.10 Completion gate

Mechanics verified locally. **Zero** §12.9 production-routed roles.
Checkpoint must say `NO TARGET ROUTE ACTIVATED`.

### 15.11 Prohibited

Luna-created owner refs. Constitution-amendment consultation reused as
family-cutover consultation. Raising Thought deadline to make 120B fit.
20B as silent Thought downgrade. Shadow dual-run of user turns.

---

## 16. Cross-cutting falsification pack

Required somewhere in SLICE 0–MF-ACT (do not duplicate blindly; map to
the slice that first makes the behavior real):

- role vs route vs occupant
- current vs target policy resolution
- reasoning translation tables
- unavailable provider / quota / deadline
- fallback eligibility classes
- unqualified primary / unqualified fallback
- stale qualification / policy provenance mismatch
- invalidation on fingerprint change, not on adapter bytes
- promotion/approval does not activate
- activation atomicity / rollback
- partial portfolio (one role active, others compatibility)
- independent judge resolution
- specialist requirement without fabricated session
- hidden retries
- transport ambiguity (R2)
- R1 Thought failed-invocation class
- Zen absent ⇒ core lives
- curiosity unordered secondaries cannot run
- shadow output cannot become live response

---

## 17. Milestone completion gates (summary)

| ID | Completion means | Production routing change |
|---|---|---|
| SLICE 0 | R1/R2 tests green | No |
| MF-M2 | Unified CURRENT snapshot; live behavior preserved | No |
| MF-M3 | Catalog + record lifecycle | No |
| MF-M4 | Dark Zen adapter | No |
| MF-M5 | Approved-chain health walker | No |
| MF-M6 | Generic seat resolver; `routine_validation` dark | No |
| MF-ACT | Pointer/approvals/activations mechanics | No, unless owner later creates records |

---

## 18. Readiness matrix

| Milestone | Readiness |
|---|---|
| SLICE 0 (R1/R2) | `IMPLEMENTATION_READY` |
| MF-M2 | `IMPLEMENTATION_READY` |
| MF-M3 | `IMPLEMENTATION_READY` |
| MF-M4 | `IMPLEMENTATION_READY` |
| MF-M5 | `IMPLEMENTATION_READY` |
| MF-M6 | `IMPLEMENTATION_READY` |
| MF-ACT | `IMPLEMENTATION_READY` |

Numeric Evaluation thresholds, held-out corpus visibility, and live
Ashley SC-CON-04 positions for **future family cutovers** remain
Evaluation/Stewardship concerns. They do not block machinery
implementation. They **do** block owner activation of new families
(§15.7). That is intended.

---

## 19. Document map

| Document | Role |
|---|---|
| This file | Execution contracts |
| [`Model_Fabric_Architecture.md`](Model_Fabric_Architecture.md) | Sole semantic owner |
| `../governance/SC-CON-04_2026-08-25_Constitution_Model.md` | Q1 consultation |
| [`../Routing_Status.md`](../Routing_Status.md) | CURRENT facts only |
| [`Ashley_Evaluation_Qualification_Plane.md`](Ashley_Evaluation_Qualification_Plane.md) | Qualification meaning |
| [`Ashley_Milestone_Execution_Governance.md`](Ashley_Milestone_Execution_Governance.md) | Wave format / §4 entries |
| Example artifacts | `model-fabric/examples/` (pre-publication history) |
