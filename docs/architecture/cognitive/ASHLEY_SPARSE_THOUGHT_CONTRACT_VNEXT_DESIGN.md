# ASHLEY SPARSE THOUGHT CONTRACT VNEXT — AUTHORITATIVE DESIGN

> **Status**: `SPARSE_VNEXT_DESIGN_FREEZE_CANDIDATE`
>
> **Source authority**: HEAD `7bae7eaafedc2e7e859218d340920ea3958b1515`,
> tree `5a1fd8c04ced30f1fd0764ea7b7b667285ce4170`,
> branch `codex/nemotron-settlement-reference-revision`.
> All source citations are committed HEAD unless marked `UNCOMMITTED_CANDIDATE`.
>
> **Date**: 2026-09-06
>
> **Governing input**: Source reconciliation (`docs/architecture/research/PROJECT_ASHLEY_SPARSE_COGNITIVE_PROTOCOL_SOURCE_RECONCILIATION.md`),
> Owner adjudication inputs (task §5), frozen architectural laws (task §4).
>
> **Corrections applied**: Final freeze-closure corrections integrated across committed source:
> 1. Sidecar meta transition contract mechanically closed (`META_TRANSITION_CONTRACT = DEFINED`, `EXACT_CANDIDATE_EXECUTION = MUST_BE_MECHANICALLY_WITNESSED`) (§22, §24)
> 2. Stabilization ledger and sequence normalized into independent implementation packet vs completion gate dimensions (§31, §34)
> 3. Core D0 (20 cases) separated from later stabilization witnesses; minimal provider failure capture strictly precedes NVIDIA diagnostic (§32, §33)
> 4. `no_semantic_change_warranted` retired from fresh authoring by Owner + Sol adjudication; historical readability preserved (§15, §25, §26, §30)
> 5. Final coherence and wording cleanup: premature "safe migration" claims eliminated in favor of defined design with exact-candidate witness requirement; explicit completion gates enforced; stability window defined as freeze engineering and use Ashley (§34, §35, §36, §40)

---

## 1. Executive Design Verdict

VNext is the **smallest correct optionalization of the current Thought settlement
contract** that eliminates mandatory empty-domain serialization while preserving
every rightful cognitive faculty.

The core change: **nine settlement fields move from `required` to optional with
field-specific presence semantics.** When Thought has nothing to say in a
domain, it omits the field. When Thought authors a semantic act, it includes the
field with at least one meaningful child. The Host never infers meaning from
absence — it treats omission as "perform no operation in this domain."

A trivial relational reply becomes:

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "Goodnight. Sleep well."
  }
}
```

A consequential turn sparsely adds exactly the domains it uses — epistemic
commitments, Working Context mutations, concern lifecycle, evidence reliance,
future intent — without protocol tax for domains it does not touch.

The four root branches (`settlement`, `observation_intent`, `effect_intent`,
`abstain`) are preserved. The settlement branch retains `kind` and `speech` as
mandatory. Everything else becomes optional-when-unused with nonempty-if-present
enforcement for new authoring (Policy B from the reconciliation, scoped
per-field). Legacy V1 records with explicit empty arrays remain safely readable.

No new architecture is introduced. No cognitive faculty is removed. The existing
single-transaction publication boundary is preserved unchanged.

**Seven corrections from source prosecution are integrated:**
1. Version identities mechanically reconciled — `IMPLEMENTATION_SPEC_VERSION` bump requires rollback binary; parser cannot version-select on fresh output
2. Speech honesty: structured semantic requirement for high-risk claims separated from Host lexical defense-in-depth
3. Speech-outbox `pending` row recovery defect acknowledged as `INDEPENDENT_P1`
4. Evidence reliance (`retrievalRefsUsed`, `sourceRefsUsed`) must survive publication when authored
5. Omission semantics corrected: "no structured commitment authored" ≠ "no factual/operational language"
6. Rollback safety stated as mechanically conditional, not blanket
7. All wire bounds remain explicitly `EXPERIMENTAL_WIRE_QUALIFICATION_STARTING_POINT`

---

## 2. Design Goals and Non-Goals

### Goals

1. **Eliminate generated-output burden** — routine turns should not serialize
   empty interpretation, empty evidence use, empty delta arrays, or
   unused stance/commitment structures.
2. **Improve contract coherence** — resolve the seven reference-shape mismatches,
   remove proven-dead `acceptableRealizations` licensing, and establish one
   coherent reference law.
3. **Preserve every rightful cognitive faculty** — interpretation, commitments,
   Working Context, concerns, occupancy, future triggers, subscriptions,
   nominations, evidence reliance, observation/effect intent, intentional
   silence, and abstain all remain available.
4. **Prepare for stabilization** — make the contract easier to diagnose, qualify,
   deploy, and keep running.
5. **Migration design defined** — single-writer transition with exact-candidate
   migration/rollback safety mechanically witnessed.

### Non-Goals

- New cognitive architecture, event sourcing, CQRS, staged Thought, semantic
  event bus, MLIR dialects, or multi-agent reflection.
- Provider number changes (max_tokens, temperature, reasoning budget, deadline).
- Solving the NVIDIA structured-output pathology (optionalization is
  independently justified; provider qualification is separate).
- Implementing the design. This document specifies the contract; an
  implementation worker translates it.
- Solving GAPs A–E inside this design (contract interfaces are specified;
  implementations are separate bounded tasks).

---

## 3. Frozen Architectural Laws

Preserved without modification unless source proves contradiction. Each law
below is verified against HEAD.

### 3.1 THOUGHT_IS_SOLE_SEMANTIC_AUTHOR

Thought owns interpretation, meaning, beliefs, doubt, revision, semantic
commitments, evidence reliance, concern meaning, future intent, memory
nominations, observation/effect intent, what to say, and intentional silence.
The Host validates, bounds, persists, and executes — it does not infer or
manufacture Ashley's semantic meaning.

### 3.2 ONE ASHLEY

One autobiographical and semantic actor. One final speaking identity.

### 3.3 OPERATIONAL TRUTH

`intent != execution`, `attempt != success`, `receipt != physical truth`,
`unknown != failed`, `timeout != non-occurrence`, `cancelled != failed`,
`superseded != failed`.

### 3.4 INTENTIONAL SILENCE

Intentional silence (`speech.mode: "none"`) is a valid semantic result,
distinguishable from timeout, malformed output, parser failure, provider
failure, crash, and abstention.

### 3.5 NO HOST TURN CLASSIFIER

The Host does not decide "this is small talk" or "memory is irrelevant."
Thought decides which semantic acts occur per settlement.

### 3.6 CANONICAL VS WIRE DISTINCTION

The canonical semantic schema and per-cycle wire specialization remain
distinct. Wire specialization narrows the canonical schema for provider
consumption; it does not redefine semantics.

### 3.7 HOST-MINTED DURABLE IDS

The Host assigns durable IDs via `randomUUID()`. Thought uses transaction-local
aliases for same-settlement co-reference where needed. No `lid:`, UUIDv7, or
generalized identity framework is introduced.

---

## 4. Current V1 Failure / Tax Being Addressed

### 4.1 Generated-output burden

The V1 settlement requires 11 top-level fields. On a trivial "Goodnight" reply,
Thought must serialize:

- 5 empty interpretation arrays
- 3 empty commitment arrays + 4-field stance object
- 6 empty delta/nomination arrays
- 4 empty evidence arrays
- Speech constraint arrays (`mustSay`, `mustNotSay`, `acceptableRealizations`,
  `presentationDirectives`)

This is pure protocol tax — mandatory serialization of inactivity.

### 4.2 Contract coherence

- 7 schema/parser/TS reference-shape mismatches (GAP C)
- `acceptableRealizations` licensing role is proven inert (GAP D)
- 3 creation aliases accepted then discarded (GAP E)
- `retrievalRefsUsed` and `sourceRefsUsed` validated then dropped (GAP B)

### 4.3 Provider diagnosis

The Nemotron 3 Super structured-output pathology is separate. Optionalization
is independently justified. The exact relationship between contract breadth
and provider behavior remains UNKNOWN. VNext enables controlled A/B
qualification but does not claim to fix the pathology.

### 4.4 Unrelated bugs

GAP A (future-trigger snapshot binding) is an independent correctness defect.
VNext specifies the contract interface the eventual repair needs but does not
implement it.

---

## 5. VNext Semantic Principles

### 5.1 Absence

```
field absent = no structured semantic act authored in that domain
```

Absence is NOT:
- clear / delete / reset
- unknown / failure
- proof that Ashley did not consider the domain
- proof that the prose contains no language related to the domain

The Host interprets absence as "perform no operation in this domain" and
leaves existing state unchanged. A `surfaceDraft` may contain factual or
operational language while the corresponding structured commitment domain is
absent — the prose is not erased or invalidated by omission; only the
structured declaration is absent.

### 5.2 Presence

```
field present = Thought deliberately authored content in that domain
```

For new authoring (VNext settlements), event-like arrays MUST contain at least
one item when present. Composite objects MUST contain at least one meaningful
child. This is enforced structurally per-field.

### 5.3 Legacy emptiness

Historical V1 records routinely contain explicit empty arrays. These remain
safely readable by narrow direct readers (memory admission, diagnostics) that
use guarded property access — they tolerate both explicit empty and absent
forms. The live VNext Thought parser handles fresh VNext provider output only;
historical V1 payloads are not reparsed through the live Thought parser.

### 5.4 Clear / delete

State changes are expressed through explicit typed operations:
- Working Context: `abandon`, `supersede`
- Concerns: `resolve`
- Future triggers: `cancel`
- Subscriptions: `cancel`
- Nominations: `supersedesRef`
- Occupancy: `set` with an explicit status transition (no null-clear)

Absence never means deletion.

### 5.5 Silence

Authored intentional silence is `speech.mode: "none"`. It may carry internal
semantic changes (deltas, evidence reliance, etc.) alongside silence.

A missing `speech` field is NOT silence — it is a parse failure.

### 5.6 Failure

A technical failure (provider timeout, malformed JSON, parser rejection) is
distinguished from authored silence and authored abstention at every level.
Missing mandatory fields fail the parser. Malformed present optional fields
fail the parser. The Host never silently promotes a failure into a semantic
result.

---

## 6. Exact Root Contract

VNext preserves the 4-branch `oneOf` root:

```
ThoughtOutput = oneOf [
  Settlement,        // kind: "settlement"
  ObservationIntent, // kind: "observation_intent"
  EffectIntent,      // kind: "effect_intent"
  Abstain            // kind: "abstain"
]
```

`ObservationIntent`, `EffectIntent`, and `Abstain` branches are unchanged
(all fields remain required within those branches). VNext modifies only the
`Settlement` branch.

---

## 7. Settlement Contract

### Required fields (KEEP_ALWAYS)

| Field | Rationale |
|-------|-----------|
| `kind` | Branch discriminant; dispatch, persistence, and all downstream paths require it. |
| `speech` | Silence vs. speech is a fundamental settlement decision that determines the entire downstream path (outbox insert vs. silent cycle). Missing speech is a parse failure, not silence. |

### Optional fields (OPTIONAL_WHEN_USED)

All other settlement fields become optional. When absent, the Host performs no
operation for that domain. When present, domain-specific nonempty rules apply.

| Field | When present |
|-------|-------------|
| `interpretation` | At least one subfield must be non-empty |
| `commitments` | At least one of `epistemic`, `conversational`, or `operational` must be non-empty, OR `stance` must be present |
| `workingContextDeltas` | Array with ≥1 item |
| `concernDeltas` | Array with ≥1 item |
| `occupancyDeltas` | Array with ≥1 item |
| `futureTriggerDeltas` | Array with ≥1 item |
| `subscriptionDeltas` | Array with ≥1 item |
| `durableNominations` | Array with ≥1 item |
| `evidenceUse` | At least one subfield must be non-empty |

---

## 8. Speech Contract

### `speech` is always required. Shape is `oneOf`:

#### Mode `draft`

```
{
  mode: "draft",               // REQUIRED
  surfaceDraft: string,        // REQUIRED, minLength 1
  mustSay?: string[],          // OPTIONAL, if present minItems 1
  mustNotSay?: string[],       // OPTIONAL, if present minItems 1
  presentationDirectives?: string[]  // OPTIONAL, if present minItems 1
}
```

`surfaceDraft` is Thought's authored text. `mustSay` constrains downstream
fidelity enforcement. `mustNotSay` constrains downstream fidelity enforcement.
`presentationDirectives` forward to the expression adapter.

Absent `mustSay` = no verbatim-substring requirements.
Absent `mustNotSay` = no forbidden-substring requirements.
Absent `presentationDirectives` = no presentation guidance.

#### Mode `none`

```
{
  mode: "none"                 // REQUIRED, only field allowed
}
```

No `surfaceDraft`, no `mustSay`, no `mustNotSay`, no `presentationDirectives`.
Presence of any of these with `mode: "none"` is a parse failure.

#### `acceptableRealizations` — REMOVED FROM NEW AUTHORING

Proven inert as a licensing alternative (`fidelity.ts:90-94`, GAP D). Removed
from VNext schema. Historical V1 payloads containing the field are ignored by
any reader that accesses `payload_json` directly (no re-parse). The fidelity
checker drops its dead second disjunct.

**BEHAVIOR_LOST = none.** The field never rescued a `mustSay` miss. No
consumer path is affected.

### 8.1 Speech Honesty — Structured Requirement vs Lexical Defense-in-Depth

VNext distinguishes two layers of speech honesty enforcement:

**A. STRUCTURED SEMANTIC REQUIREMENT (authoritative)**  
When Thought authors a high-risk operational or currentness claim, the relevant
explicit structured commitment/evidence relationship is REQUIRED:
- Operational success claim in prose → `commitments.operational` with `claimedState: "succeeded"` required
- Currentness claim in prose → `commitments.epistemic` with `dimensions.time: "current"` required  
- Vision/reading activity claim in prose → matching observation modality required

These are checked by `authority/check.ts` and `speech/fidelity.ts` against
explicit authored fields. They are the semantic authority.

**B. HOST LEXICAL DEFENSE-IN-DEPTH (conservative, not authoritative)**  
The existing fidelity detectors (`fidelity.ts:79-121`) remain active as
defense-in-depth:
- `claimsOwnVisionActivity()` / `claimsOwnReadingActivity()` + modality check → `UNWITNESSED_HIGH_RISK_CLAIM`
- Success-word regex (`/\b(?:worked|succeeded|successful|completed|sent|created|updated|done)\b/i`) → requires operational `succeeded`
- `claimsCurrentness()` (patterns: `latest`, `today`, `currently`, `right now`, `this (morning|week|month)`, `most recent`) → requires epistemic `time:current`

**These detectors are known to be unsound for general prose.** Examples of false
positives:
- "Are you done for tonight?" → contains "done" but is a question, not a success claim
- "That's the latest I heard" → contains "latest" but may be conversational, not a currentness claim
- "I completed the thought" → contains "completed" but may be self-referential, not an operational effect claim

They are NOT authoritative semantic classifiers. They conservatively catch
undeclared high-risk claims at the cost of false positives on ordinary speech.

**Required before stable-use release**: The broad success-word and currentness
detectors must be repaired (narrowed to explicit structured declarations or
context-aware) to stop rejecting innocent companion speech. Classification:
`REQUIRED_BEFORE_STABILITY_WINDOW` (see §31).

---

## 9. Commitments Contract

### Container: OPTIONAL_WHEN_USED

The `commitments` container is optional in VNext. When absent, no structured
commitment is authored.

**Critical speech-licensing invariant**: if `speech.mode === "draft"` and
`commitments` is absent, the settlement is VALID. The current V1 universal rule
(`draft` requires `epistemic.length > 0 OR conversational.length > 0`) is
**relaxed for VNext**.

**Justification**: ordinary relational speech ("Goodnight", "Yeah", "That sounds
fun") does not inherently require a formal epistemic or conversational
commitment to become legitimate. Forcing one invents protocol bureaucracy
without earning behavior.

**Honesty preservation**: high-risk factual, currentness, and operational claims
remain gated by their existing structured mechanisms. When `commitments` IS
present and contains epistemic or operational claims, all existing authority and
fidelity checks apply unchanged. The relaxation applies ONLY to speech that
makes no structured claim — the fidelity detectors (§12, §8.1) remain
defense-in-depth for prose that linguistically implies a claim without a
matching commitment.

### 9.1 `commitments.epistemic`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item. Each item:
`{ dimensions: EpistemicDimensions, statement: string }`.

Omission = **no explicit structured epistemic commitment authored this turn**.
It does NOT mean the prose contains no factual language. Existing
authority/currentness checks apply when present.

### 9.2 `commitments.operational`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item. Each item:
`{ effectRef: string, claimedState: ClaimedState }`.

When the operational effect namespace is empty (no active effects), the wire
schema constrains this to `maxItems: 0` as today. When the namespace is
non-empty, `effectRef` must be a member of the cycle's allowed effect refs.

Omission = **no explicit structured operational claim authored**. It does NOT
mean the prose contains no operational-looking language. All receipt-binding and
claim-vs-receipt matrix logic applies when present.

### 9.3 `commitments.conversational`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item. Each item is one of
the 6-member enum: `answer | ask | acknowledge | disagree | hold | silence`.

This enum records a meaningful conversational obligation. It is no longer
universally required as a speech license. It remains AVAILABLE for Thought to
declare conversational intent when doing so adds genuine semantic value
(e.g., recording that Ashley asked a question, or that she is holding a topic
for later).

Omission = **no explicit structured conversational commitment authored**.

### 9.4 `commitments.stance`

**OPTIONAL_WHEN_USED**. When present, object with all 4 fields required:
`{ warmth, humorAllowed, disagreement, uncertaintyDisplay }`.

Rationale for keeping as optional rather than removing: stance feeds the
expression adapter. While Expression is currently disabled in production, the
adapter interface expects stance, and the voice/Expression policy is unresolved.
Making it optional rather than mandatory eliminates the serialization tax while
preserving the interface for future activation.

When absent, the expression adapter receives no stance guidance and uses the
`surfaceDraft` verbatim (its current fallback behavior).

Omission = **no explicit stance directive authored**.

---

## 10. Interpretation Contract

### Container: OPTIONAL_WHEN_USED

When present, must contain at least one non-empty subfield. All subfields are
optional within the container.

### 10.1 `interpretation.discourseActs`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item. Items from the 8-member
enum: `inform | ask | correct | acknowledge | disagree | hold | silence | other`.

No current consumer found beyond payload retention. Retained as an optional
semantic record because it is rightful consequential interpretation that may
serve future correction/retrieval.

Omission = **no explicit structured discourse act authored**.

### 10.2 `interpretation.referentBindings`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item. Each item:
`{ span: string, sourceTurnRefs: string[], concernRef?: ExistingRef, entityRef?: ExistingRef }`.

**Reference shape**: VNext resolves the GAP C mismatch. `concernRef` and
`entityRef` are `ExistingRef` (opaque allowlisted string), NOT the schema-level
object form. Schema, parser, and TS type are unified.

Omission = **no explicit structured referent binding authored**.

### 10.3 `interpretation.corrections`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item. Each item:
`{ correctedTurnRefs: string[], fromSpan: string, toSpan: string, concernRef?: ExistingRef }`.

**Reference shape**: `concernRef` is `ExistingRef` (string). GAP C resolved.

Omission = **no explicit structured correction authored**.

### 10.4 `interpretation.unresolvedAmbiguities`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item of type `string`.

Omission = **no explicit structured unresolved ambiguity authored**.

### 10.5 `interpretation.topics`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item of type `string`.

Omission = **no explicit structured topic authored**.

### Design rationale

Interpretation is not universally forced. Ordinary turns where Thought's
internal reasoning is sufficient need not externalize a structured
interpretation transcript. When Thought encounters a consequential interpretive
act — a correction, a referent resolution, an unresolved ambiguity — it declares
it. The interpretation persists in `payload_json` and is available for future
provenance, retrieval, and correction chains.

**Omission semantics**: For every interpretation subfield, absence means "Thought
did not author a structured act in this subdomain." It does NOT mean Thought
did not consider the domain, nor does it mean the prose lacks related language.

---

## 11. State Delta Contracts

All delta arrays follow the same pattern:

| State | Meaning |
|-------|---------|
| **absent** | No operation in this domain. Existing state unchanged. |
| **present** | Array with ≥1 item. Each item is a typed operation. |
| **explicit clear** | Via typed operations (`abandon`, `resolve`, `cancel`, etc.) |

Absence never means deletion.

**Omission semantics**: For every delta array, absence means "Thought authored
no operation in this domain." It does NOT mean Thought did not consider the
domain.

### 11.1 `workingContextDeltas`

**OPTIONAL_WHEN_USED**. When present, `NonEmptyArray<WorkingContextDelta>`.

Operations: `upsert`, `supersede`, `abandon`. The `identity` field in
`upsert`/`supersede` uses `SemanticRef` (existing or local). Same-turn
co-reference via local aliases is preserved.

Omission = **no Working Context operation authored**.

### 11.2 `concernDeltas`

**OPTIONAL_WHEN_USED**. When present, `NonEmptyArray<ConcernDelta>`.

Operations: `upsert`, `resolve`. The `upsert.record.identity` uses
`SemanticRef` (local alias for creation, existing for mutation). The
`resolve.target` uses `ExistingRef` (string). Same-turn co-reference preserved.

Omission = **no Concern operation authored**.

### 11.3 `occupancyDeltas`

**OPTIONAL_WHEN_USED**. When present, `NonEmptyArray<OccupancyDelta>`.

Operation: `set` with `concernRef` (SemanticRef), `status`, `priority`.

Existing occupancy statuses include `resolved`, `dormant_but_revisitable`,
`quarantined`, which already express forms of attention release. No new
null-clear operation is introduced. If Thought wishes to release occupancy of
a concern, it sets the status to an appropriate existing value.

Omission = **no Occupancy operation authored**.

### 11.4 `futureTriggerDeltas`

**OPTIONAL_WHEN_USED**. When present, `NonEmptyArray<FutureTriggerDelta>`.

Operations: `create`, `cancel`.

For `create`: Thought authors `concernRef` (SemanticRef), `dueAtMs`, `purpose`,
`payload`. The dead `identity` creation alias is removed from VNext — the Host
mints the `triggerId` unconditionally (`run.ts:356`). The `cancel.target` uses
`ExistingRef` (string).

**GAP A interface**: For an already-existing concern, VNext specifies that the
Host binds the trigger to the exact concern lineage/snapshot that was projected to
and available to that Thought cycle. The Host may compute and verify the mechanical
snapshotHash. Thought does NOT author the hash.

If the concern lineage has moved before publication:
do NOT silently refresh
do NOT silently rebind
— the operation must mechanically conflict/fail according to the existing
publication/fence model.

For a concern created or changed inside the same semantic settlement:
the future trigger may bind to the resulting concern snapshot
created by that same atomic transaction, because that resulting state is itself
part of Ashley's same authored settlement.

Omission = **no Future Trigger operation authored**.

### 11.5 `subscriptionDeltas`

**OPTIONAL_WHEN_USED**. When present, `NonEmptyArray<SubscriptionDelta>`.

Operations: `create`, `cancel`. The dead `identity` creation alias is removed
from VNext — the Host mints the `subscriptionId`. The `cancel.target` uses
`ExistingRef`.

Omission = **no Subscription operation authored**.

### 11.6 `durableNominations`

**OPTIONAL_WHEN_USED**. When present, `NonEmptyArray<DurableNomination>`.

The dead `alias` creation field is removed from VNext — the Host mints
`nominationId` and `assertionKey` unconditionally (`run.ts:380-383`).

Remaining fields: `statement`, `memoryKind` (11-member enum), `dimensions`,
`dataClassification`, `sourceRefs`, `supersedesRef` (ExistingRef | null),
`concernRef` (nullable SemanticRef).

`supersedesRef` uses `ExistingRef` (string) | `null`. GAP C resolved.

Omission = **no Durable Nomination authored**.

---

## 12. Evidence-Reliance Contract

### Container: OPTIONAL_WHEN_USED

`evidenceUse` is optional. When present, must contain at least one non-empty
subfield.

**VNext semantic requirement**: If Thought explicitly authors reliance in any
evidence-use field, VNext MUST NOT accept the semantic act and silently discard
it. Authored retrieval/source reliance MUST survive semantic publication.

### 12.1 `evidenceUse.observationRefsUsed`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item of type `ExistingRef`.
Items must be allowlisted observation references.

This is the only evidence-reliance field that currently has a materialization
consumer (`run.ts:393` → `observationsConsumed` → ledger + currentness gate).
Its existing authority/currentness enforcement is preserved unchanged.

Omission = **no explicit structured observation reliance authored**.

### 12.2 `evidenceUse.retrievalRefsUsed`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item of type `ExistingRef`.

Currently validated-then-dropped (GAP B). VNext retains the field because
retrieval reliance is a rightful authored signal. **VNext design disposition:
MUST SURVIVE SEMANTIC PUBLICATION.** The implementation repair carries it into
`ThoughtSettlementDraft.operations` alongside `observationsConsumed` (minimal
existing durable representation). This is `INDEPENDENT_P1` (see §31).

Omission = **no explicit structured retrieval reliance authored**.

### 12.3 `evidenceUse.sourceRefsUsed`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item of type `ExistingRef`.

Same situation as `retrievalRefsUsed` — validated-then-dropped. **VNext design
disposition: MUST SURVIVE SEMANTIC PUBLICATION.** Carried into `operations`
alongside `retrievalRefsUsed`. This is `INDEPENDENT_P1` (see §31).

Omission = **no explicit structured source reliance authored**.

### 12.4 `evidenceUse.openIntentRefs`

**OPTIONAL_WHEN_USED**. When present, array with ≥1 item of type `ExistingRef`.

Currently carried to `intentsStillInFlight` but with no enforcement consumer.
Retained because it semantically differs from evidence reliance — it represents
Thought's declared attention to in-flight operations. Semantically it belongs
alongside evidence use as an authored attention reference rather than as a
separate top-level domain.

Omission = **no explicit structured in-flight intent reference authored**.

---

## 13. Reference Law

### One coherent law for all references in VNext

#### Existing entity reference

When the operation targets an entity that already exists:

```
type ExistingRef = string  // opaque allowlisted reference
```

The Host validates:
- Non-empty string
- Member of the cycle's reference allowlist
- Target-type appropriate (concern, trigger, subscription, etc.)

Used by: `resolve.target`, `cancel.target`, `abandon.target`, `supersede.target`,
`referentBindings.concernRef/entityRef`, `corrections.concernRef`,
`supersedesRef`, evidence use arrays.

#### Creation-capable same-transaction reference

When Thought creates an entity and refers to it later in the same settlement:

```
type SemanticRef =
  | { kind: "existing", ref: ExistingRef }
  | { kind: "local", alias: LocalAlias }

type LocalAlias = string  // matches ^[A-Za-z][A-Za-z0-9_-]{0,127}$
```

The Host:
- Registers the local alias at creation time
- Resolves `{ kind: "local", alias }` to the Host-minted durable ID
- Rejects alias collisions with existing refs
- Rejects duplicate alias registrations
- Rejects dangling local references (alias used but never created)

Used by: `workingContextDelta.upsert/supersede.item.identity`,
`concernDelta.upsert.record.identity`, `occupancyDelta.concernRef`.

#### Dead creation aliases — REMOVED

VNext removes the three dead creation aliases:
- `futureTriggerDelta.create.identity` (alias accepted, `triggerId` minted by Host, alias never read)
- `subscriptionDelta.create.subscription.identity` (same pattern)
- `nominationSchema.alias` (same pattern)

For `futureTriggerDelta.create` and `subscriptionDelta.create`, the creation
schema no longer includes an `identity`/`alias` field. The Host mints the
durable ID unconditionally.

For `durableNominations`, the `alias` field is removed. The Host mints
`nominationId` and `assertionKey`.

**BEHAVIOR_LOST = none.** These aliases were validated then replaced by
Host-minted UUIDs in every case. No downstream consumer reads them.

#### Schema representation

```json
{
  "$defs": {
    "existingRef": { "type": "string", "minLength": 1 },
    "localAlias": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,127}$" },
    "semanticRef": {
      "oneOf": [
        { "type": "object", "properties": { "kind": { "const": "existing" }, "ref": { "$ref": "#/$defs/existingRef" } }, "required": ["kind", "ref"], "additionalProperties": false },
        { "type": "object", "properties": { "kind": { "const": "local" }, "alias": { "$ref": "#/$defs/localAlias" } }, "required": ["kind", "alias"], "additionalProperties": false }
      ]
    },
    "nullableSemanticRef": {
      "oneOf": [
        { "$ref": "#/$defs/semanticRef" },
        { "type": "null" }
      ]
    }
  }
}
```

#### Alias collision and dangling reference behavior

- Alias that collides with an existing ref in the allowlist: parser failure
  `alias_collides_with_existing_ref` (allowlist membership checked at parse time).
- Duplicate alias registration in same settlement: materializer failure
  `alias_duplicate` (local aliases registered at materialization in `run.ts:220-232`;
  Map detects duplicate on second registration).
- Reference to an alias that was never registered (dangling): materializer
  failure `dangling_local_reference`. The settlement is rejected.
  (Local aliases resolved in `semanticReferenceValue` at materialization;
  parser cannot validate dangling references because aliases are not in the
  parse-time allowlist.)
- Target-type mismatch (e.g., concern ref pointing at a WC item): materializer
  failure `reference_target_type_mismatch`.
  (Target type validated when the existing ref is resolved to its actual entity
  at materialization.)

---

## 14. Observation / Effect Intent Branches

### Unchanged from V1

Both branches retain all 6 required fields:

```
observation_intent: kind, operationKind, request, purpose, evidenceNeed, existingRefs
effect_intent:      kind, operationKind, request, purpose, expectedOutcome, existingRefs
```

`operationKind` must be in the 17-member `REGISTERED_OPERATION_KINDS`.
`existingRefs` must be allowlisted. `request` is a JSON object.

These branches are not part of the sparsity problem — they are emitted only when
Thought needs an observation or effect, and all fields are inherently meaningful.

---

## 15. Abstain Branch

### Bounded responsibility boundary

```
abstain: kind, reason, explanation, evidenceRefs
```

`reason` enum values for VNext new authoring:
- `insufficient_evidence`
- `unresolved_ambiguity`
- `no_responsible_proposal`

#### Owner + Sol adjudication: retire `no_semantic_change_warranted` from VNext new authoring

The previous worker recommendation to KEEP `no_semantic_change_warranted` has been **rejected by Owner + Sol adjudication**.

The final ruling is:

```text
NO_SEMANTIC_CHANGE_WARRANTED
= RETIRE_FROM_VNEXT_NEW_AUTHORING
= HISTORICAL_READABILITY_ONLY
```

**Why**:
The earlier KEEP argument compared `abstain:no_semantic_change_warranted` to `settlement + speech:none` and argued that a silent settlement can carry deltas while abstain cannot. That misses the relevant comparison.

The overlapping case is:

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "none"
  }
}
```

with **no deltas**. That payload already expresses:
- Thought successfully settled the cycle;
- Thought intentionally has nothing to say;
- Thought authors no internal state mutation.

By contrast, `abstain` means:
> Thought cannot responsibly produce a semantic settlement on the currently available basis.

The three remaining reasons form a coherent responsibility boundary where Thought cannot settle responsibly:
1. `insufficient_evidence` — required evidence or perception basis is missing;
2. `unresolved_ambiguity` — user intent or conversational state cannot be disambiguated;
3. `no_responsible_proposal` — no responsible, safe action or answer can be formulated.

`no_semantic_change_warranted` instead represents a valid semantic conclusion: *nothing warrants saying or changing*. That belongs naturally to a successful silent/no-op settlement.

**Historical readability preserved**:
Historical V1 records containing `no_semantic_change_warranted` remain readable by sidecar readers and diagnostics. Historical records are NOT rewritten, and no upcaster is introduced.

**Semantic result**:
```text
SETTLEMENT + speech:none
=
valid settlement
intentional silence
zero or more internal semantic changes

ABSTAIN
=
no responsible semantic settlement can be produced
```

---

## 16. Canonical vs Wire Constraints

### Canonical semantic schema

Defines what a valid Ashley semantic settlement IS. Contains:
- `oneOf` root branches
- Field presence/absence rules
- Minimum structure requirements (nonempty-if-present)
- Enum domains
- Reference shapes
- `additionalProperties: false`
- `$defs`

Does NOT contain:
- Per-cycle operational namespace narrowing
- Resource bounds (max string lengths, max array sizes)
- Wire-specific interpretation bounds

### Wire specialization

Built by `constrainThoughtOutputSchema()`. Deep-clones the canonical schema
then applies per-cycle narrowing:

1. **Operational namespace**: `effectRef.enum` set to cycle's allowed refs
   (or `maxItems: 0` when namespace empty). This is the accepted finite
   operational-effect namespace specialization. Unchanged from V1.

2. **Resource bounds** (EXPERIMENTAL_WIRE_QUALIFICATION_STARTING_POINT):
   Applied to the wire clone only. See §17.

### Fingerprint consequences

Any change to the canonical schema changes `THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT`.
Any change to the wire schema changes `wireSchemaFingerprint`. Both are expected
to change for VNext. The dispatch contract validates fingerprints per-request.

---

## 17. Boundedness Policy

### Principle

Semantic invariant bounds belong in the canonical schema. Provider/resource
wire bounds belong in wire specialization only.

### Semantic invariant bounds (canonical)

- `surfaceDraft.minLength: 1` (draft mode) — semantic: non-empty speech
- `ExistingRef.minLength: 1` — semantic: non-empty reference
- `LocalAlias.pattern` — semantic: valid alias namespace
- `purpose/evidenceNeed/expectedOutcome/explanation.minLength: 1` — semantic:
  non-empty authored text

These are preserved unchanged.

### Resource wire bounds (EXPERIMENTAL_WIRE_QUALIFICATION_STARTING_POINT)

The following are wire-only bounds applied by `constrainThoughtOutputSchema()`.
They are defense-in-depth ceilings, not semantic definitions. Evidence that
would ratify or reject them: output-distribution measurements on representative
Thought cycles under VNext.

**Every value below is explicitly `EXPERIMENTAL_WIRE_QUALIFICATION_STARTING_POINT`
and NOT a ratified production constant. No production freeze until quality and
distribution evidence supports the value.**

| Surface | Proposed wire bound | Rationale |
|---------|-------------------|-----------|
| `surfaceDraft` | `maxLength: 6000` | Generous diagnostic starting ceiling. Chosen to test pathological expansion while preserving materially longer natural speech. NOT ratified; qualification must examine actual legitimate long replies. No production freeze until quality and distribution evidence supports the value. |
| `interpretation.*.span/fromSpan/toSpan` | `maxLength: 400` | Excerpt, not reproduction. Consistent with uncommitted candidate value. EXPERIMENTAL. |
| `interpretation.topics[]` items | `maxLength: 100` | Topic label, not essay. EXPERIMENTAL. |
| `interpretation.unresolvedAmbiguities[]` items | `maxLength: 400` | Description, not treatise. EXPERIMENTAL. |
| `commitments.epistemic[].statement` | `maxLength: 500` | Epistemic claim, not essay. EXPERIMENTAL. |
| `speech.mustSay[]` items | `maxLength: 300` | Verbatim required substring. EXPERIMENTAL. |
| `speech.mustNotSay[]` items | `maxLength: 200` | Forbidden substring. EXPERIMENTAL. |
| `speech.presentationDirectives[]` items | `maxLength: 200` | Directive, not specification. EXPERIMENTAL. |
| `workingContextDelta.upsert.item.text` | `maxLength: 500` | WC entry. EXPERIMENTAL. |
| `concernDelta.upsert.record.statement` | `maxLength: 500` | Concern description. EXPERIMENTAL. |
| `futureTriggerDelta.create.purpose` | `maxLength: 300` | Trigger purpose. EXPERIMENTAL. |
| `durableNominations[].statement` | `maxLength: 800` | Memory nomination. EXPERIMENTAL. |
| `interpretation.referentBindings` | `maxItems: 12` | Per-turn binding count. EXPERIMENTAL. |
| `interpretation.corrections` | `maxItems: 6` | Per-turn corrections. EXPERIMENTAL. |
| `interpretation.unresolvedAmbiguities` | `maxItems: 12` | Per-turn ambiguities. EXPERIMENTAL. |
| `interpretation.topics` | `maxItems: 16` | Per-turn topics. EXPERIMENTAL. |

**Aggregate constraint (diagnostic target, not invariant)**: No single settlement
JSON should exceed ~10KB serialized (approximate, not schema-enforced). The
individual field bounds above are designed to make aggregate runaway
mechanically difficult without a hard aggregate check. **This ~10KB target is a
diagnostic/design target, not an architectural invariant.** There is no
mechanical aggregate schema enforcement and no evidence establishing 10KB as the
correct threshold.

**What these bounds do NOT prove**: that output fits within 8192 generated
tokens. Token count depends on tokenizer and reasoning overhead. Aggregate
token qualification is separate.

---

## 18. Parser Semantics

### Philosophy

1. **Absence preserved as absence.** The parser does NOT normalize absent
   optional fields to `[]`. An absent field remains `undefined` in the parsed
   TypeScript representation.

2. **Downstream code distinguishes absent from present-empty.** Where code
   iterates a delta array, it checks `if (field !== undefined)` before
   processing. The existing `?? []` pattern in `run.ts:295` for
   `commitments.operational` is the model — but VNext applies it at the
   materialization layer, not the parser.

3. **New-authoring strictness.** For VNext-version settlements, present optional
   arrays MUST be non-empty (per-field `minItems: 1` where applicable). Present
   optional objects MUST contain at least one meaningful child.

   **Critical correction from source**: Fresh provider semantic JSON does NOT
   contain `schemaVersion` — it is assigned during materialization in
   `run.ts:269` (hardcoded to `1` today). The live parser CANNOT choose V1/VNext
   semantics by reading a `schemaVersion` field that does not exist at parse
   time.

   **Actual version selection mechanism**: The parser identity is selected
   externally via the dispatch contract. The wire schema sent to the provider
   (produced by `constrainThoughtOutputSchema()`) already encodes the VNext
   contract shape (optional fields, nonempty-if-present via `minItems: 1` on
   wire). The parser validates against that wire schema. There is no live
   parser path that parses historical V1 payloads — durable settlements are
   never re-parsed (§23). Therefore:
   - One VNext live parser for fresh provider output (validates against VNext wire schema)
   - No historical V1 parse path needed (no durable→parser re-read)
   - Legacy V1 tolerance applies only to narrow direct `payload_json` readers (admission, diagnostics) which use guarded property access

4. **Legacy V1 tolerance.** For V1-version settlements (when read from durable
   storage via narrow direct `JSON.parse`), explicit empty arrays are accepted.
   This is NOT a parser normalization — it's a reader tolerance for history.

5. **Malformed present optional field fails.** If Thought includes
   `workingContextDeltas` but its value is not a valid array, the parser fails
   with `wrong_type:workingContextDeltas`.

6. **Unknown fields fail.** `additionalProperties: false` plus
   `exactRecord` checking ensures unknown top-level settlement fields fail with
   `unknown_field`.

7. **Structural retry reporting.** Parser failures report:
   - `required_field_missing` — mandatory field absent
   - `wrong_type` — field present with wrong shape
   - `invalid_enum` — enum value out of range
   - `reference_not_allowlisted` — ref not in allowlist
   - `alias_invalid` — alias doesn't match pattern
   - `operation_not_registered` — operationKind not in registry
   - `unknown_field` — unexpected field present
   - (VNext new) `empty_when_present` — optional array/object present but empty

---

## 19. Validator / Authority Semantics

### Validator behavior with optional domains

When a domain is absent, the validator performs no checks for that domain.
This is a no-op, not an implicit pass. The domain simply doesn't participate
in validation.

When a domain is present, all existing validation rules apply unchanged:
- Commitments: epistemic dimension validity, operational receipt matrix,
  stance shape
- Deltas: shape validation, fence checks
- Evidence: allowlist membership, currentness entitlement
- Speech: mode/draft consistency, fidelity

### Speech licensing — VNext invariant

The V1 universal rule (`draft` requires `epistemic.length > 0 OR
conversational.length > 0`) is relaxed:

**VNext rule**: `speech.mode === "draft"` is valid WITHOUT a `commitments`
container. Ordinary natural speech does not require a formal commitment.

**High-risk defense — corrected per §8.1**: The existing fidelity detectors
remain active as **Host lexical defense-in-depth** (not authoritative semantic
classifiers):
- If draft prose contains success-words (`worked`, `completed`, `sent`, etc.)
  and no `operational` claim with `claimedState === "succeeded"` exists →
  `DRAFT_COMMITMENT_CONFLICT`
- If draft prose triggers `claimsCurrentness()` and no epistemic claim with
  `time: "current"` exists → `DRAFT_COMMITMENT_CONFLICT`
- If draft prose triggers `claimsOwnVisionActivity()` or reading activity
  detectors and no matching observation modality exists →
  `UNWITNESSED_HIGH_RISK_CLAIM`

**These detectors are known to be unsound for general prose** (false positives
on questions, conversational references, self-referential statements). They
conservatively catch undeclared high-risk claims at the cost of false positives
on ordinary speech. **Required repair before stable-use release:**
`REQUIRED_BEFORE_STABILITY_WINDOW` (see §31).

### Authority checks with absent commitments

When `commitments` is absent:
- No operational claims exist → receipt matrix produces no objections
- No epistemic claims exist → currentness gate produces no objections
- `neverMention` scan covers `surfaceDraft` only (no epistemic statements
  to scan)

This is correct and mechanically bounded: absence of structured claims means
nothing to enforce. Host lexical rules provide conservative defense-in-depth
against undeclared claims but have known FALSE POSITIVES and FALSE NEGATIVES;
they are neither complete nor semantically authoritative.

---

## 20. Materialization Semantics

### Per-domain materialization behavior

| Domain | Absent | Present |
|--------|--------|---------|
| `interpretation` | No interpretation stored (payload records absence) | Interpretation stored in `payload_json` |
| `commitments` | No commitment operations | Commitments processed as today |
| `commitments.operational` | `(operational ?? []).map(...)` → empty, no claim-matrix entries | Operational claims processed |
| `workingContextDeltas` | `applyWorkingContextDelta` not called | Deltas applied to `working_context_items` |
| `concernDeltas` | `applyConcernDelta` not called | Deltas applied to `concerns` |
| `occupancyDeltas` | `applyOccupancyDelta` not called | Deltas applied to `mind_occupancy` |
| `futureTriggerDeltas` | `applyFutureTriggerDelta` not called | Triggers scheduled/cancelled |
| `subscriptionDeltas` | `applySubscriptionDelta` not called | Subscriptions created/cancelled |
| `durableNominations` | `enqueueDurableNomination` not called | Nominations enqueued |
| `evidenceUse` | `observationsConsumed = []`, `intentsStillInFlight = []` | Evidence references carried as today |

### No Host-authored defaults

The materializer NEVER manufactures:
- Default stance
- Default conversational commitment
- Default interpretation
- Default evidence reliance
- Default concern about absent domains

If a domain is absent, the materializer performs no operation. It does not
synthesize a "null interpretation" or "empty commitments shell."

---

## 21. Persistence / Atomicity

### Single-transaction publication — preserved unchanged

`publishSemanticTransaction` continues to execute within one sidecar
`BEGIN IMMEDIATE` transaction. Absent domains merely skip their respective
write operations within that transaction. The transaction boundary, fence
checks, outbox insert, ledger record, and cycle-state transition are unchanged.

### Payload persistence

`settlements.payload_json` stores the full materialized settlement as JSON.
VNext settlements will naturally have smaller payloads (absent fields are not
stored). Readers that access `payload_json` directly (memory admission, narrow
diagnostics) tolerate both V1 (explicit empties) and VNext (absent) forms.

---

## 22. Version Identity

### What changes

| Identity | V1 value | VNext value | Rationale |
|----------|----------|-------------|-----------|
| `SETTLEMENT_SCHEMA_VERSION` | `1` | `2` | Per-settlement version marker in materialized draft. Enables version-aware materialization tolerance (V1 accepts explicit empties; VNext requires nonempty-if-present). |
| `THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT` | `sha256:cd174d9f...` | new hash | Canonical schema changes → fingerprint changes mechanically. |
| `wireSchemaFingerprint` | per-cycle | new per-cycle | Wire schema changes → fingerprint changes mechanically. |
| `IMPLEMENTATION_SPEC_VERSION` | `"0.2.1.r5"` | `"0.2.1.r6"` | Implementation changed. |
| `THOUGHT_OUTPUT_SCHEMA_ID` | `"ashley.thought.semantic.v1.schema"` | `"ashley.thought.semantic.v2.schema"` | Canonical schema `$id` changes with structural changes. |
| `THOUGHT_OUTPUT_CONTRACT_ID` | `"ashley.thought.semantic.v1"` | `"ashley.thought.semantic.v2"` | Semantic contract identity MUST change — the authored protocol semantics changed materially (optionalization with presence semantics). Retaining `.v1` would be untruthful. |

### What does NOT change

| Identity | Value | Rationale |
|----------|-------|-----------|
| `ARCHITECTURE_EPOCH` | `"v0.2.1"` | No architectural change. Same epoch. |
| `THOUGHT_CONTRACT_VERSION` | `2` | No contract generation bump — this is a settlement schema evolution within the same contract generation. |
| `COGNITIVE_SIDECAR_SCHEMA_VERSION` | `8` | No sidecar DDL changes. Same tables. |
| `THOUGHT_KERNEL_PROTOCOL_ID` | `"ashley.thought.kernel.v1"` | Kernel protocol unchanged. |
| `THOUGHT_KERNEL_ENVELOPE_VERSION` | `"ashley.thought.kernel-envelope.v1"` | Envelope structure unchanged. |
| `THOUGHT_SEMANTIC_PARSER_ID` | `"ashley.thought.semantic-parser.v1"` | Parser identity unchanged (parser evolves within its identity; version selection is external via dispatch contract). |

### Rationale for identity changes — mechanically reconciled

The sidecar meta table (`db.ts:87-94`) enforces **exact-match** on four fields:
`THOUGHT_CONTRACT_VERSION`, `ARCHITECTURE_EPOCH`, `IMPLEMENTATION_SPEC_VERSION`,
`COGNITIVE_SIDECAR_SCHEMA_VERSION`.

The constants are binary-time constants (`types.ts:14`):
- `IMPLEMENTATION_SPEC_VERSION = "0.2.1.r5"` (r5 binary) or `"0.2.1.r6"` (r6 binary)
- `THOUGHT_CONTRACT_VERSION = 2` (unchanged)
- `ARCHITECTURE_EPOCH = "v0.2.1"` (unchanged)
- `COGNITIVE_SIDECAR_SCHEMA_VERSION = 8` (unchanged, unless DDL changes)

**Critical mechanical truth**: `ensureMeta()` at `db.ts:67-94` performs an exact-match on ALL four fields. An old binary with `r5` will reject a database written by `r6`, and vice versa. There is no automatic migration that rewrites `IMPLEMENTATION_SPEC_VERSION` — it is a constant baked into the binary.

**Consequences**:
- `IMPLEMENTATION_SPEC_VERSION` bump requires a **bounded deployment operation** that explicitly transitions the sidecar meta value before the new binary starts
- `THOUGHT_OUTPUT_CONTRACT_ID` and `THOUGHT_OUTPUT_SCHEMA_ID` MUST bump to `.v2` because the canonical schema structure changed (optionalization with presence semantics). Keeping `.v1` would falsely imply wire compatibility.
- `THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT` and `wireSchemaFingerprint` change mechanically — this provides exact-match verification at dispatch time (`dispatch-contract.ts:196-203`)
- Parser version selection: Fresh provider output does NOT contain `schemaVersion` (assigned at materialization in `run.ts:269`). The live parser cannot read a field that doesn't exist. Version selection is external: the dispatch contract sends the VNext wire schema; the parser validates against it. No durable→parser re-read exists (§23).

**Mechanical sidecar meta schema truth**:
Committed source (`apps/agent-service/src/core/cognitive-v021/sidecar/schema.ts:5-12` and `db.ts:67-94`):
- Table name: `cognitive_sidecar_meta`
- Primary key / cardinality: `id INTEGER PRIMARY KEY CHECK (id = 1)` — exactly one row can exist.
- Targeted column: `implementation_spec_version TEXT NOT NULL`.
- Existing transaction mechanism: `DatabaseSync.exec("BEGIN IMMEDIATE")` / `DatabaseSync.exec("COMMIT")` (with `ROLLBACK` on mismatch).
- Startup check: `ensureMeta()` in `db.ts` verifies all four fields (`schema_version === 8`, `architecture_epoch === "v0.2.1"`, `implementation_spec_version === IMPLEMENTATION_SPEC_VERSION`, `thought_contract_version === 2`). If any mismatch occurs, it throws `cognitive_sidecar_meta_invalid`. An r5 binary cannot open r6 metadata, and an r6 binary cannot open r5 metadata.

**Forward transition contract (r5 → r6)**:
```text
PRECONDITION:
- sidecar quiesced / writer processes stopped
- expected current implementation_spec_version == "0.2.1.r5"

BEGIN IMMEDIATE TRANSACTION

VERIFY exact expected old meta identity:
  SELECT id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version
    FROM cognitive_sidecar_meta WHERE id = 1;
  ASSERT id == 1
  ASSERT schema_version == 8
  ASSERT architecture_epoch == 'v0.2.1'
  ASSERT implementation_spec_version == '0.2.1.r5'
  ASSERT thought_contract_version == 2
  (On any mismatch: ROLLBACK, fail closed, abort release)

UPDATE only implementation_spec_version:
  UPDATE cognitive_sidecar_meta
     SET implementation_spec_version = '0.2.1.r6'
   WHERE id = 1 AND implementation_spec_version = '0.2.1.r5';

ASSERT exactly one intended row/key changed:
  ASSERT changes() == 1
  (If changes != 1: ROLLBACK, fail closed, abort release)

READ BACK:
  SELECT implementation_spec_version
    FROM cognitive_sidecar_meta WHERE id = 1;
  ASSERT implementation_spec_version == '0.2.1.r6'
  (On mismatch: ROLLBACK, fail closed, abort release)

COMMIT

ONLY THEN:
start r6 binary
(r6 binary calls ensureMeta() on open; exact-matches '0.2.1.r6'; opens successfully)
```

**Rollback transition contract (r6 → r5)**:
```text
PRECONDITION:
- VNext writer stopped / sidecar quiesced
- persisted-state compatibility mechanically proven
- expected current implementation_spec_version == "0.2.1.r6"

BEGIN IMMEDIATE TRANSACTION

VERIFY exact expected old meta identity:
  SELECT id, schema_version, architecture_epoch, implementation_spec_version, thought_contract_version
    FROM cognitive_sidecar_meta WHERE id = 1;
  ASSERT id == 1
  ASSERT schema_version == 8
  ASSERT architecture_epoch == 'v0.2.1'
  ASSERT implementation_spec_version == '0.2.1.r6'
  ASSERT thought_contract_version == 2
  (On any mismatch: ROLLBACK, fail closed, abort rollback)

UPDATE only implementation_spec_version:
  UPDATE cognitive_sidecar_meta
     SET implementation_spec_version = '0.2.1.r5'
   WHERE id = 1 AND implementation_spec_version = '0.2.1.r6';

ASSERT exactly one intended row/key changed:
  ASSERT changes() == 1
  (If changes != 1: ROLLBACK, fail closed, abort rollback)

READ BACK:
  SELECT implementation_spec_version
    FROM cognitive_sidecar_meta WHERE id = 1;
  ASSERT implementation_spec_version == '0.2.1.r5'
  (On mismatch: ROLLBACK, fail closed, abort rollback)

COMMIT

ONLY THEN:
start exact r5 rollback binary
(r5 binary calls ensureMeta() on open; exact-matches '0.2.1.r5'; opens successfully)
```

**Mechanical safety properties**:
1. **Fail-closed on unexpected old value**: any discrepancy in existing schema version, epoch, spec version, or contract version immediately aborts with ROLLBACK.
2. **Never overwrite unrelated meta fields**: the mutation targets exclusively `implementation_spec_version`; authority epoch, projection vectors, and schema versions remain untouched.
3. **Never "set whatever is there" blindly**: the update requires `WHERE id = 1 AND implementation_spec_version = expectedOldValue` and asserts `changes() === 1`.
4. **Never run while active semantic writers exist**: writers must be confirmed quiesced before transition starts.
5. **Reversible only after rollback compatibility is proven**: persisted settlements must be confirmed inert to rollback binary before reverse transition.
6. **Treated as a release/deployment operation, not cognitive architecture**: no generic migration framework is added to application source.

```text
META_TRANSITION_CONTRACT = DEFINED
EXACT_CANDIDATE_EXECUTION = MUST_BE_MECHANICALLY_WITNESSED
ROLLBACK_DESIGN = DEFINED
ROLLBACK_SAFETY = MUST_BE_MECHANICALLY_WITNESSED
```

---

## 23. V1 History Compatibility

### Durable settlements are NOT re-parsed

Source confirms (`parse.ts` is called only on fresh provider text;
`payload_json` is never fed through the parser). Therefore:

- V1 settlements with explicit empty arrays in `payload_json` are never
  rejected by the VNext parser (no parser path touches them).
- Memory admission's guarded `JSON.parse` + direct property access tolerates
  both explicit empty and absent forms.
- Next-turn Thought input is rebuilt from materialized tables, never from
  settlement JSON.

### Narrow direct readers

The few code paths that read `payload_json` directly (admission, diagnostics)
use guarded property access patterns that naturally tolerate absent properties.
No upcaster is required.

### Parser version selection — corrected

The parser does NOT use `settlementSchemaVersion` from fresh provider output
(because that field is assigned during materialization in `run.ts:269`, not
present in the provider's JSON). Version selection is external: the dispatch
contract (`dispatch-contract.ts`) sends the VNext wire schema (with optional
fields, `minItems: 1`); the parser validates against that schema. There is no
live parser path for historical V1 payloads.

---

## 24. Upgrade / Drain / Rollback Design

### Upgrade procedure (single-writer transition)

1. **Stop new admission/work**: Set deployment state to draining. No new
   Thought cycles admitted.

2. **Classify active attempts**: Any in-flight Thought cycle is a V1 producer.
   Wait for completion or timeout. Structural retries in flight will complete
   under V1 semantics.

3. **Reconcile executed effects**: Any dispatched effects with pending receipts
   complete their receipt reconciliation under V1 semantics.

4. **Verify drain**: Confirm no active Thought leases, no pending outbox rows
   in `projecting` state, no unreconciled consequences.

5. **Execute sidecar meta transition (r5 → r6)**:
   Before the r6 binary starts, execute the mechanical metadata transition
   defined in §22:
   - Precondition: sidecar quiesced / writer processes stopped; expected current `implementation_spec_version == "0.2.1.r5"`.
   - `BEGIN IMMEDIATE TRANSACTION`.
   - Verify exact expected old meta identity (`id=1`, `schema_version=8`, `architecture_epoch="v0.2.1"`, `implementation_spec_version="0.2.1.r5"`, `thought_contract_version=2`). On mismatch: `ROLLBACK`, fail closed.
   - Update only `implementation_spec_version` from `"0.2.1.r5"` to `"0.2.1.r6"`.
   - Assert `changes() === 1`. On mismatch: `ROLLBACK`, fail closed.
   - Read back and assert `implementation_spec_version === "0.2.1.r6"`. On mismatch: `ROLLBACK`, fail closed.
   - `COMMIT`.
   - This is a bounded SQL deployment operation, not an automatic runtime migration.

6. **Start exact VNext binary**:
   Deploy binary with `IMPLEMENTATION_SPEC_VERSION = "0.2.1.r6"`,
   `THOUGHT_OUTPUT_CONTRACT_ID = "ashley.thought.semantic.v2"`,
   `THOUGHT_OUTPUT_SCHEMA_ID = "ashley.thought.semantic.v2.schema"`, new
   `THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT` and `wireSchemaFingerprint`.
   On open, `ensureMeta()` (`db.ts:87-94`) exact-matches all four fields against
   the transitioned metadata. Materialization writes `SETTLEMENT_SCHEMA_VERSION = 2`
   in `ThoughtSettlementDraft.schemaVersion`.

7. **Resume**: New Thought cycles produce VNext settlements. The wire schema
   sent to the provider encodes VNext shape (optional fields, `minItems: 1`);
   the parser validates against it. No parser reads `schemaVersion` from fresh
   output.

### In-flight retry handling

If a durable work retry survives the deployment (version-blind retry mechanism
per `retry/ledger.ts`):
- The retry creates a new Thought invocation under the VNext binary
- The VNext parser handles the new provider output correctly (validates against VNext wire schema)
- No V1 partial output is reinterpreted as VNext — the retry invokes a
  fresh provider call

### Rollback conditions — mechanically conditional, not blanket

**ROLLBACK_BEFORE_ANY_VNEXT_DURABLE_MUTATION** (no VNext settlements published):
- Safe. Revert meta to `r5` via the mechanical rollback transition contract; deploy previous binary (`r5`, `.v1` IDs).

**ROLLBACK_AFTER_VNEXT_SETTLEMENTS_PUBLISHED** (VNext settlements exist in `payload_json`):
- **Conditionally safe** IF:
  1. VNext writer is stopped and persisted-state compatibility is mechanically proven (no VNext durable settlements are pending reconciliation that would be incompatible with r5 semantics; narrow direct readers tolerate absent fields);
  2. The mechanical rollback transition contract (r6 → r5) is executed before the rollback binary starts (`BEGIN IMMEDIATE` → verify `r6` meta identity → update `implementation_spec_version` to `r5` with `changes() === 1` assert → read back `r5` assert → `COMMIT`);
  3. The exact rollback binary with `IMPLEMENTATION_SPEC_VERSION = "0.2.1.r5"` is deployed.
- **Unsafe** IF: rollback binary retains `r6` (meta exact-match fails on startup with `cognitive_sidecar_meta_invalid`); or if a new durable→parser path is added that would choke on absent fields.

**ROLLBACK_AFTER_META_VERSION_CHANGE** (sidecar meta updated to `r6`):
- Requires executing the mechanical reverse transition contract (r6 → r5) and deploying the rollback binary with reverted `r5` constant. The meta table update is not automatically reverted by code — the old binary's `ensureMeta()` requires an exact match or aborts.

**ROLLBACK_WITH_INFLIGHT_DURABLE_WORK** (version-blind retries in flight):
- Retries resume under whatever binary holds the lease. They carry no contract version marker (`retry/ledger.ts:594-598`). Fences (`stale_generation`, `authority_vector_stale`) may stop them.

**Summary**: Rollback safety is NOT proven by "no durable→parser path" alone. It
depends on exact meta version match, narrow reader tolerance, and fence
behavior. **Exact-candidate rehearsal required before production acceptance.**
```text
ROLLBACK_DESIGN = DEFINED
ROLLBACK_SAFETY = MUST_BE_MECHANICALLY_WITNESSED
```

---

## 25. Exact JSON Schema Proposal

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ashley.thought.semantic.v2.schema",
  "title": "Ashley Thought semantic output v2 (Sparse VNext)",
  "oneOf": [
    { "$ref": "#/$defs/settlementForm" },
    { "$ref": "#/$defs/observationIntentForm" },
    { "$ref": "#/$defs/effectIntentForm" },
    { "$ref": "#/$defs/abstainForm" }
  ],
  "$defs": {
    "existingRef": { "type": "string", "minLength": 1 },
    "localAlias": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_-]{0,127}$" },
    "semanticRef": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": { "const": "existing" },
            "ref": { "$ref": "#/$defs/existingRef" }
          },
          "required": ["kind", "ref"],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": { "const": "local" },
            "alias": { "$ref": "#/$defs/localAlias" }
          },
          "required": ["kind", "alias"],
          "additionalProperties": false
        }
      ]
    },
    "nullableSemanticRef": {
      "oneOf": [
        { "$ref": "#/$defs/semanticRef" },
        { "type": "null" }
      ]
    },
    "dimensions": {
      "type": "object",
      "properties": {
        "source": { "enum": ["owner_utterance", "ashley_interpretation", "tool", "perception", "receipt", "prior_settlement"] },
        "status": { "enum": ["asserted", "interpreted", "unverified", "contradicted", "superseded", "unresolved"] },
        "time": { "enum": ["current", "historical", "unknown_freshness"] },
        "reliability": { "enum": ["owner_supplied", "fallible_observation", "receipt_backed", "inferred", "unavailable_source"] }
      },
      "required": ["source", "status", "time", "reliability"],
      "additionalProperties": false
    },
    "operationalClaim": {
      "type": "object",
      "properties": {
        "effectRef": { "type": "string", "minLength": 1 },
        "claimedState": { "enum": ["not_attempted", "in_progress", "outcome_unknown", "failed", "succeeded"] }
      },
      "required": ["effectRef", "claimedState"],
      "additionalProperties": false
    },
    "epistemicCommitment": {
      "type": "object",
      "properties": {
        "dimensions": { "$ref": "#/$defs/dimensions" },
        "statement": { "type": "string", "minLength": 1 }
      },
      "required": ["dimensions", "statement"],
      "additionalProperties": false
    },
    "stance": {
      "type": "object",
      "properties": {
        "warmth": { "enum": ["low", "medium", "high"] },
        "humorAllowed": { "type": "boolean" },
        "disagreement": { "type": "boolean" },
        "uncertaintyDisplay": { "type": "boolean" }
      },
      "required": ["warmth", "humorAllowed", "disagreement", "uncertaintyDisplay"],
      "additionalProperties": false
    },
    "referentBinding": {
      "type": "object",
      "properties": {
        "span": { "type": "string" },
        "sourceTurnRefs": { "type": "array", "items": { "type": "string" } },
        "concernRef": { "$ref": "#/$defs/existingRef" },
        "entityRef": { "$ref": "#/$defs/existingRef" }
      },
      "required": ["span", "sourceTurnRefs"],
      "additionalProperties": false
    },
    "correction": {
      "type": "object",
      "properties": {
        "correctedTurnRefs": { "type": "array", "items": { "type": "string" } },
        "fromSpan": { "type": "string" },
        "toSpan": { "type": "string" },
        "concernRef": { "$ref": "#/$defs/existingRef" }
      },
      "required": ["correctedTurnRefs", "fromSpan", "toSpan"],
      "additionalProperties": false
    },
    "workingContextItem": {
      "type": "object",
      "properties": {
        "identity": { "$ref": "#/$defs/semanticRef" },
        "type": { "enum": ["topic", "referent", "correction", "owner_teaching", "question", "commitment_temp", "repair"] },
        "text": { "type": "string" },
        "concernRef": { "$ref": "#/$defs/nullableSemanticRef" },
        "sourceTurnRefs": { "type": "array", "items": { "type": "string" } },
        "status": { "enum": ["active", "superseded", "abandoned"] },
        "supersedesRef": { "$ref": "#/$defs/nullableSemanticRef" }
      },
      "required": ["identity", "type", "text", "concernRef", "sourceTurnRefs", "status", "supersedesRef"],
      "additionalProperties": false
    },
    "concernRecord": {
      "type": "object",
      "properties": {
        "identity": { "$ref": "#/$defs/semanticRef" },
        "statement": { "type": "string" },
        "sourceTurnRefs": { "type": "array", "items": { "type": "string" } },
        "dimensions": { "$ref": "#/$defs/dimensions" },
        "status": { "enum": ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved", "quarantined"] }
      },
      "required": ["identity", "statement", "sourceTurnRefs", "dimensions", "status"],
      "additionalProperties": false
    },
    "speechDraft": {
      "type": "object",
      "properties": {
        "mode": { "const": "draft" },
        "surfaceDraft": { "type": "string", "minLength": 1 },
        "mustSay": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "mustNotSay": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
        "presentationDirectives": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
      },
      "required": ["mode", "surfaceDraft"],
      "additionalProperties": false
    },
    "speechNone": {
      "type": "object",
      "properties": {
        "mode": { "const": "none" }
      },
      "required": ["mode"],
      "additionalProperties": false
    },
    "settlementForm": {
      "type": "object",
      "properties": {
        "kind": { "const": "settlement" },
        "speech": {
          "oneOf": [
            { "$ref": "#/$defs/speechDraft" },
            { "$ref": "#/$defs/speechNone" }
          ]
        },
        "interpretation": {
          "type": "object",
          "properties": {
            "discourseActs": { "type": "array", "items": { "enum": ["inform", "ask", "correct", "acknowledge", "disagree", "hold", "silence", "other"] }, "minItems": 1 },
            "referentBindings": { "type": "array", "items": { "$ref": "#/$defs/referentBinding" }, "minItems": 1 },
            "corrections": { "type": "array", "items": { "$ref": "#/$defs/correction" }, "minItems": 1 },
            "unresolvedAmbiguities": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
            "topics": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
          },
          "additionalProperties": false,
          "minProperties": 1
        },
        "commitments": {
          "type": "object",
          "properties": {
            "epistemic": { "type": "array", "items": { "$ref": "#/$defs/epistemicCommitment" }, "minItems": 1 },
            "operational": { "type": "array", "items": { "$ref": "#/$defs/operationalClaim" }, "minItems": 1 },
            "conversational": { "type": "array", "items": { "enum": ["answer", "ask", "acknowledge", "disagree", "hold", "silence"] }, "minItems": 1 },
            "stance": { "$ref": "#/$defs/stance" }
          },
          "additionalProperties": false,
          "minProperties": 1
        },
        "workingContextDeltas": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "op": { "const": "upsert" },
                  "item": { "$ref": "#/$defs/workingContextItem" }
                },
                "required": ["op", "item"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "op": { "const": "supersede" },
                  "target": { "$ref": "#/$defs/existingRef" },
                  "replacement": { "$ref": "#/$defs/workingContextItem" }
                },
                "required": ["op", "target", "replacement"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "op": { "const": "abandon" },
                  "target": { "$ref": "#/$defs/existingRef" }
                },
                "required": ["op", "target"],
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1
        },
        "concernDeltas": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "op": { "const": "upsert" },
                  "record": { "$ref": "#/$defs/concernRecord" }
                },
                "required": ["op", "record"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "op": { "const": "resolve" },
                  "target": { "$ref": "#/$defs/existingRef" }
                },
                "required": ["op", "target"],
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1
        },
        "occupancyDeltas": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "op": { "const": "set" },
              "concernRef": { "$ref": "#/$defs/semanticRef" },
              "status": { "enum": ["active", "investigating", "waiting_for_evidence", "dormant_but_revisitable", "resolved", "quarantined"] },
              "priority": { "type": "integer" }
            },
            "required": ["op", "concernRef", "status", "priority"],
            "additionalProperties": false
          },
          "minItems": 1
        },
        "futureTriggerDeltas": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "op": { "const": "create" },
                  "concernRef": { "$ref": "#/$defs/semanticRef" },
                  "dueAtMs": { "type": "integer" },
                  "purpose": { "type": "string", "minLength": 1 },
                  "payload": { "type": "object" }
                },
                "required": ["op", "concernRef", "dueAtMs", "purpose", "payload"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "op": { "const": "cancel" },
                  "target": { "$ref": "#/$defs/existingRef" }
                },
                "required": ["op", "target"],
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1
        },
        "subscriptionDeltas": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "op": { "const": "create" },
                  "subscription": {
                    "type": "object",
                    "properties": {
                      "concernRef": { "$ref": "#/$defs/nullableSemanticRef" },
                      "source": { "type": "string" },
                      "scope": { "type": "string" },
                      "topicKeys": { "type": "array", "items": { "type": "string" } },
                      "match": { "enum": ["equality", "substring"] },
                      "expiresAtMs": { "type": ["integer", "null"] }
                    },
                    "required": ["concernRef", "source", "scope", "topicKeys", "match", "expiresAtMs"],
                    "additionalProperties": false
                  }
                },
                "required": ["op", "subscription"],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "op": { "const": "cancel" },
                  "target": { "$ref": "#/$defs/existingRef" }
                },
                "required": ["op", "target"],
                "additionalProperties": false
              }
            ]
          },
          "minItems": 1
        },
        "durableNominations": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "statement": { "type": "string", "minLength": 1 },
              "memoryKind": { "enum": ["owner_preference", "owner_self_description", "owner_goal", "owner_world_claim", "project_knowledge", "commitment", "relational_boundary", "shared_episode", "open_question", "ashley_interpretation", "learned_self_evidence"] },
              "dimensions": { "$ref": "#/$defs/dimensions" },
              "dataClassification": { "enum": ["ordinary", "sensitive", "never_public", "secret"] },
              "sourceRefs": { "type": "array", "items": { "type": "string" } },
              "supersedesRef": {
                "oneOf": [
                  { "$ref": "#/$defs/existingRef" },
                  { "type": "null" }
                ]
              },
              "concernRef": { "$ref": "#/$defs/nullableSemanticRef" }
            },
            "required": ["statement", "memoryKind", "dimensions", "dataClassification", "sourceRefs", "supersedesRef", "concernRef"],
            "additionalProperties": false
          },
          "minItems": 1
        },
        "evidenceUse": {
          "type": "object",
          "properties": {
            "observationRefsUsed": { "type": "array", "items": { "$ref": "#/$defs/existingRef" }, "minItems": 1 },
            "retrievalRefsUsed": { "type": "array", "items": { "$ref": "#/$defs/existingRef" }, "minItems": 1 },
            "sourceRefsUsed": { "type": "array", "items": { "$ref": "#/$defs/existingRef" }, "minItems": 1 },
            "openIntentRefs": { "type": "array", "items": { "$ref": "#/$defs/existingRef" }, "minItems": 1 }
          },
          "additionalProperties": false,
          "minProperties": 1
        }
      },
      "required": ["kind", "speech"],
      "additionalProperties": false,
      "description": "Use settlement only when the current supplied evidence and context are sufficient to author the semantic answer without first acquiring additional evidence or performing a governed effect."
    },
    "observationIntentForm": {
      "type": "object",
      "properties": {
        "kind": { "const": "observation_intent" },
        "operationKind": { "enum": ["conversation.read", "memory.lookup", "project.inspect", "project.list_directory", "project.read_file", "project.search_text", "workspace.create_directory", "workspace.delete_file", "workspace.edit_text", "workspace.list_directory", "workspace.read_file", "workspace.replace_file", "workspace.search_text", "workspace.verify", "workspace.write_file", "changeset.author", "objective.operate"] },
        "request": { "type": "object" },
        "purpose": { "type": "string", "minLength": 1 },
        "evidenceNeed": { "type": "string", "minLength": 1 },
        "existingRefs": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["kind", "operationKind", "request", "purpose", "evidenceNeed", "existingRefs"],
      "additionalProperties": false,
      "description": "Use observation_intent when the answer requires additional read-only evidence acquisition through a registered observation capability."
    },
    "effectIntentForm": {
      "type": "object",
      "properties": {
        "kind": { "const": "effect_intent" },
        "operationKind": { "enum": ["conversation.read", "memory.lookup", "project.inspect", "project.list_directory", "project.read_file", "project.search_text", "workspace.create_directory", "workspace.delete_file", "workspace.edit_text", "workspace.list_directory", "workspace.read_file", "workspace.replace_file", "workspace.search_text", "workspace.verify", "workspace.write_file", "changeset.author", "objective.operate"] },
        "request": { "type": "object" },
        "purpose": { "type": "string", "minLength": 1 },
        "expectedOutcome": { "type": "string", "minLength": 1 },
        "existingRefs": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["kind", "operationKind", "request", "purpose", "expectedOutcome", "existingRefs"],
      "additionalProperties": false,
      "description": "Use effect_intent when the requested outcome requires a governed mechanical effect through a registered effect capability."
    },
    "abstainForm": {
      "type": "object",
      "properties": {
        "kind": { "const": "abstain" },
        "reason": { "enum": ["insufficient_evidence", "unresolved_ambiguity", "no_responsible_proposal"] },
        "explanation": { "type": "string", "minLength": 1 },
        "evidenceRefs": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["kind", "reason", "explanation", "evidenceRefs"],
      "additionalProperties": false,
      "description": "Use abstain when required evidence, capability, or an admissible basis is absent or unresolved (no_semantic_change_warranted retired from fresh authoring; historical readability preserved)."
    }
  }
}
```

**PROVIDER_QUALIFICATION_REQUIRED**: The `minProperties: 1` constraint on
`interpretation`, `commitments`, and `evidenceUse`. Some constrained-generation
backends may not support `minProperties`. Simpler fallback: remove
`minProperties` and enforce nonempty-if-present in the parser only.

---

## 26. Design-Level TypeScript Shapes

```typescript
// === Root ===
type ThoughtSemanticOutputVNext =
  | SettlementSemanticOutputVNext
  | ObservationIntentSemanticOutput   // unchanged
  | EffectIntentSemanticOutput        // unchanged
  | AbstainSemanticOutputVNext;

// === Settlement ===
type SettlementSemanticOutputVNext = {
  kind: "settlement";
  speech: SpeechIntentVNext;
  interpretation?: InterpretationVNext;       // undefined = not authored
  commitments?: CommitmentsVNext;             // undefined = not authored
  workingContextDeltas?: NonEmptyArray<WorkingContextSemanticDelta>;
  concernDeltas?: NonEmptyArray<ConcernSemanticDelta>;
  occupancyDeltas?: NonEmptyArray<OccupancySemanticDelta>;
  futureTriggerDeltas?: NonEmptyArray<FutureTriggerSemanticDeltaVNext>;
  subscriptionDeltas?: NonEmptyArray<SubscriptionSemanticDeltaVNext>;
  durableNominations?: NonEmptyArray<DurableNominationVNext>;
  evidenceUse?: EvidenceUseVNext;             // undefined = not authored
};

type NonEmptyArray<T> = [T, ...T[]];

// === Speech ===
type SpeechIntentVNext =
  | { mode: "draft"; surfaceDraft: string;
      mustSay?: NonEmptyArray<string>;
      mustNotSay?: NonEmptyArray<string>;
      presentationDirectives?: NonEmptyArray<string>; }
  | { mode: "none" };
// Note: acceptableRealizations REMOVED

// === Interpretation ===
type InterpretationVNext = {
  discourseActs?: NonEmptyArray<DiscourseAct>;
  referentBindings?: NonEmptyArray<ReferentBindingVNext>;
  corrections?: NonEmptyArray<CorrectionVNext>;
  unresolvedAmbiguities?: NonEmptyArray<string>;
  topics?: NonEmptyArray<string>;
};
// At least one subfield must be present (enforced by parser, not TS)

type ReferentBindingVNext = {
  span: string;
  sourceTurnRefs: string[];
  concernRef?: ExistingRef;  // string, not object (GAP C resolved)
  entityRef?: ExistingRef;   // string, not object (GAP C resolved)
};

type CorrectionVNext = {
  correctedTurnRefs: string[];
  fromSpan: string;
  toSpan: string;
  concernRef?: ExistingRef;  // string, not object (GAP C resolved)
};

// === Commitments ===
type CommitmentsVNext = {
  epistemic?: NonEmptyArray<EpistemicCommitment>;
  operational?: NonEmptyArray<OperationalStateClaim>;
  conversational?: NonEmptyArray<ConversationalCommitment>;
  stance?: Stance;
};
// At least one subfield must be present (enforced by parser)

// === Evidence Use ===
type EvidenceUseVNext = {
  observationRefsUsed?: NonEmptyArray<ExistingRef>;
  retrievalRefsUsed?: NonEmptyArray<ExistingRef>;
  sourceRefsUsed?: NonEmptyArray<ExistingRef>;
  openIntentRefs?: NonEmptyArray<ExistingRef>;
};
// At least one subfield must be present (enforced by parser)

// === Deltas (changes from V1) ===
type FutureTriggerSemanticDeltaVNext =
  | { op: "create"; concernRef: SemanticRef; dueAtMs: number;
      purpose: string; payload: JsonObject }  // identity REMOVED
  | { op: "cancel"; target: ExistingRef };

type SubscriptionSemanticDeltaVNext =
  | { op: "create"; subscription: SubscriptionRecordVNext }  // identity REMOVED
  | { op: "cancel"; target: ExistingRef };

type SubscriptionRecordVNext = {
  concernRef: SemanticRef | null;
  source: string; scope: string;
  topicKeys: string[]; match: "equality" | "substring";
  expiresAtMs: number | null;
};  // identity REMOVED

type DurableNominationVNext = {
  statement: string;  // alias REMOVED
  memoryKind: MemoryKind;
  dimensions: EpistemicDimensions;
  dataClassification: DataClassification;
  sourceRefs: string[];
  supersedesRef: ExistingRef | null;  // string | null (GAP C resolved)
  concernRef: SemanticRef | null;
};

// === Abstain ===
type SemanticAbstainReasonVNext =
  | "insufficient_evidence"
  | "unresolved_ambiguity"
  | "no_responsible_proposal";

type AbstainSemanticOutputVNext = {
  kind: "abstain";
  reason: SemanticAbstainReasonVNext;
  explanation: string;
  evidenceRefs: ExistingRef[];
};
// Note: no_semantic_change_warranted retired from fresh authoring (historical readability preserved)
```

### Where `undefined`, `[]`, and `null` have different semantics

| Representation | Meaning |
|----------------|---------|
| `undefined` (field absent) | No semantic act in this domain. State unchanged. |
| `[]` (V1 legacy) | Accepted on read as equivalent to absent for V1 records. REJECTED on VNext authoring. |
| `null` | Used only for `concernRef: null` (no concern binding), `supersedesRef: null` (no supersession), and `expiresAtMs: null` (no expiry). NOT a general clear mechanism. |

---

## 27. Valid Examples

### E1 — Trivial relational speech

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "Goodnight. Sleep well."
  }
}
```

### E2 — Intentional silence with no internal change

```json
{
  "kind": "settlement",
  "speech": { "mode": "none" }
}
```

### E3 — Intentional silence with Working Context change

```json
{
  "kind": "settlement",
  "speech": { "mode": "none" },
  "workingContextDeltas": [
    { "op": "abandon", "target": "wc-item-abc123" }
  ]
}
```

### E4 — Factual response with epistemic commitment

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "The meeting was last Thursday at 3pm."
  },
  "commitments": {
    "epistemic": [
      {
        "dimensions": { "source": "owner_utterance", "status": "asserted", "time": "historical", "reliability": "owner_supplied" },
        "statement": "Owner's meeting was last Thursday at 3pm."
      }
    ]
  }
}
```

### E5 — Currentness claim with evidence reliance

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "The latest build passed all tests."
  },
  "commitments": {
    "epistemic": [
      {
        "dimensions": { "source": "tool", "status": "asserted", "time": "current", "reliability": "receipt_backed" },
        "statement": "Build passed all tests."
      }
    ]
  },
  "evidenceUse": {
    "observationRefsUsed": ["obs-build-result-xyz"]
  }
}
```

### E6 — Operational claim

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "I've updated the configuration file."
  },
  "commitments": {
    "operational": [
      { "effectRef": "effect:a1b2c3d4e5f6abcdef1234567890abcdef1234567890abcdef1234567890abcd", "claimedState": "succeeded" }
    ]
  }
}
```

### E7 — Working Context upsert with local alias

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "Got it — you prefer dark mode."
  },
  "workingContextDeltas": [
    {
      "op": "upsert",
      "item": {
        "identity": { "kind": "local", "alias": "dark-mode-pref" },
        "type": "owner_teaching",
        "text": "Owner prefers dark mode.",
        "concernRef": null,
        "sourceTurnRefs": ["turn-789"],
        "status": "active",
        "supersedesRef": null
      }
    }
  ]
}
```

### E8 — Concern creation

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "Noted — your Friday proposal deadline is on my radar."
  },
  "concernDeltas": [
    {
      "op": "upsert",
      "record": {
        "identity": { "kind": "local", "alias": "deadline-concern" },
        "statement": "Owner has a Friday deadline for the proposal.",
        "sourceTurnRefs": ["turn-456"],
        "dimensions": { "source": "owner_utterance", "status": "asserted", "time": "current", "reliability": "owner_supplied" },
        "status": "active"
      }
    }
  ]
}
```

### E9 — Concern + occupancy + future trigger (cross-domain co-reference)

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "I'll check in on Friday morning about the proposal."
  },
  "concernDeltas": [
    {
      "op": "upsert",
      "record": {
        "identity": { "kind": "local", "alias": "proposal-concern" },
        "statement": "Owner's proposal deadline is Friday.",
        "sourceTurnRefs": ["turn-789"],
        "dimensions": { "source": "owner_utterance", "status": "asserted", "time": "current", "reliability": "owner_supplied" },
        "status": "active"
      }
    }
  ],
  "occupancyDeltas": [
    {
      "op": "set",
      "concernRef": { "kind": "local", "alias": "proposal-concern" },
      "status": "active",
      "priority": 1
    }
  ],
  "futureTriggerDeltas": [
    {
      "op": "create",
      "concernRef": { "kind": "local", "alias": "proposal-concern" },
      "dueAtMs": 1725609600000,
      "purpose": "Check in about proposal progress on Friday morning.",
      "payload": {}
    }
  ]
}
```

### E10 — Durable memory nomination

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "Got it — you prefer dark mode for the editor."
  },
  "durableNominations": [
    {
      "statement": "Owner prefers dark mode for the editor.",
      "memoryKind": "owner_preference",
      "dimensions": { "source": "owner_utterance", "status": "asserted", "time": "current", "reliability": "owner_supplied" },
      "dataClassification": "ordinary",
      "sourceRefs": ["turn-123"],
      "supersedesRef": null,
      "concernRef": null
    }
  ]
}
```

### E11 — Retrieval evidence reliance

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "Based on what I remember, you mentioned that last week."
  },
  "commitments": {
    "epistemic": [
      {
        "dimensions": { "source": "prior_settlement", "status": "asserted", "time": "historical", "reliability": "fallible_observation" },
        "statement": "Owner mentioned this topic last week."
      }
    ]
  },
  "evidenceUse": {
    "retrievalRefsUsed": ["retrieval-memory-abc"]
  }
}
```

### E12 — Interpretation with correction

```json
{
  "kind": "settlement",
  "speech": {
    "mode": "draft",
    "surfaceDraft": "I think you mean the other project — the one with the blue logo."
  },
  "interpretation": {
    "corrections": [
      {
        "correctedTurnRefs": ["turn-345"],
        "fromSpan": "the project",
        "toSpan": "the project with the blue logo",
        "concernRef": "concern-project-alpha"
      }
    ]
  }
}
```

### E13 — Observation intent

```json
{
  "kind": "observation_intent",
  "operationKind": "project.read_file",
  "request": { "projectId": "proj-abc", "path": "README.md" },
  "purpose": "Read the project README to answer the Owner's question about setup.",
  "evidenceNeed": "Project setup instructions.",
  "existingRefs": ["obs-project-list-xyz"]
}
```

### E14 — Effect intent

```json
{
  "kind": "effect_intent",
  "operationKind": "workspace.write_file",
  "request": { "projectId": "proj-abc", "path": "config.json", "content": "{\"theme\": \"dark\"}" },
  "purpose": "Update the config file per Owner's request.",
  "expectedOutcome": "config.json updated with dark theme setting.",
  "existingRefs": ["obs-read-config-xyz"]
}
```

### E15 — Abstain

```json
{
  "kind": "abstain",
  "reason": "insufficient_evidence",
  "explanation": "The Owner asked about the current weather, but I have no observation capability for weather data.",
  "evidenceRefs": []
}
```

---

## 28. Invalid Examples

### I1 — Missing speech

```json
{ "kind": "settlement" }
```

**Fails**: `required_field_missing:speech`. Speech is always required.

### I2 — Draft mode without surfaceDraft

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft" }
}
```

**Fails**: `required_field_missing:surfaceDraft`. Draft mode requires non-empty surface text.

### I3 — None mode with surfaceDraft

```json
{
  "kind": "settlement",
  "speech": { "mode": "none", "surfaceDraft": "Hello" }
}
```

**Fails**: `unknown_field:surfaceDraft`. None mode permits only `mode`.

### I4 — Optional array present but empty

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "Hello." },
  "workingContextDeltas": []
}
```

**Fails**: `empty_when_present:workingContextDeltas`. VNext requires `minItems: 1` on present optional arrays.

### I5 — Operational claim when namespace is empty

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "I did it." },
  "commitments": {
    "operational": [
      { "effectRef": "effect:fake123", "claimedState": "succeeded" }
    ]
  }
}
```

**Fails** (wire): When the operational namespace is empty, `maxItems: 0` enforced.

### I6 — Invented effectRef not in namespace

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "Done." },
  "commitments": {
    "operational": [
      { "effectRef": "effect:invented999", "claimedState": "succeeded" }
    ]
  }
}
```

**Fails**: `OPERATIONAL_CLAIM_EFFECTREF_UNKNOWN`.

### I7 — Dangling local alias

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "Noted." },
  "occupancyDeltas": [
    {
      "op": "set",
      "concernRef": { "kind": "local", "alias": "never-created" },
      "status": "active",
      "priority": 1
    }
  ]
}
```

**Fails**: `dangling_local_reference`. The alias was never registered.

### I8 — Wrong reference shape (object instead of string)

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "Fixed that." },
  "interpretation": {
    "corrections": [
      {
        "correctedTurnRefs": ["turn-1"],
        "fromSpan": "old",
        "toSpan": "new",
        "concernRef": { "kind": "existing", "ref": "concern-abc" }
      }
    ]
  }
}
```

**Fails**: `wrong_type:concernRef`. In VNext, `corrections.concernRef` is `ExistingRef` (plain string), not a semantic ref object.

### I9 — Malformed evidenceUse

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "Based on the data." },
  "evidenceUse": {
    "observationRefsUsed": "not-an-array"
  }
}
```

**Fails**: `wrong_type:observationRefsUsed`. Must be an array of strings.

### I10 — Unknown extra field

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "Hello." },
  "emotionalState": "happy"
}
```

**Fails**: `unknown_field:emotionalState`. `additionalProperties: false`.

### I11 — Absence misinterpreted as clear (MUST NOT happen)

```json
{
  "kind": "settlement",
  "speech": { "mode": "draft", "surfaceDraft": "Never mind that." }
}
```

The absence of `workingContextDeltas` does NOT clear any WC items. Existing items remain. Explicit `{ "op": "abandon", "target": "..." }` is required to remove items.

### I12 — Technical failure vs authored silence (structural distinction)

Technical failure (no output) → `ThoughtFailureStep { kind: "failure", reason: "unavailable" }`.
Authored silence → `{ "kind": "settlement", "speech": { "mode": "none" } }`.
These are on completely separate code paths. No ambiguity.

---

## 29. V1 vs VNext Burden Comparison

### Trivial relational speech: "Goodnight. Sleep well."

**V1**: ~890 JSON bytes, 24+ required keys, 17 compulsory empty structures.

**VNext**: ~85 JSON bytes, 3 required keys, 0 compulsory empty structures.

**Reduction**: ~90% fewer bytes.

### Intentional silence

**V1**: ~680 JSON bytes (same structure minus surfaceDraft).

**VNext**: ~52 JSON bytes.

**Reduction**: ~92% fewer bytes.

### Consequential turn (factual claim + evidence + WC change)

**V1**: ~1100 JSON bytes (3 meaningful domains + 14 empty domains).

**VNext**: ~450 JSON bytes (3 meaningful domains only).

**Reduction**: ~60% fewer bytes.

---

## 30. Necessity Matrix

| Field / domain | VNext disposition | Omission meaning | Present-empty in VNext? | Behavior lost |
|---|---|---|---|---|
| `kind` | KEEP_ALWAYS | n/a | n/a | n/a |
| `speech` | KEEP_ALWAYS | n/a | n/a | n/a |
| `speech.mode` | KEEP_ALWAYS | n/a | n/a | n/a |
| `speech.surfaceDraft` | KEEP_ALWAYS (draft) | n/a | n/a | n/a |
| `speech.mustSay` | OPTIONAL_WHEN_USED | No verbatim constraints | NO | None |
| `speech.mustNotSay` | OPTIONAL_WHEN_USED | No forbidden substrings | NO | None |
| `speech.presentationDirectives` | OPTIONAL_WHEN_USED | No presentation guidance | NO | None |
| `speech.acceptableRealizations` | REMOVE | n/a | n/a | None (proven inert) |
| `interpretation` | OPTIONAL_WHEN_USED | No explicit structured interpretation authored | NO | None |
| `commitments` | OPTIONAL_WHEN_USED | No explicit structured commitment container authored | NO | Universal speech licensing removed |
| `commitments.epistemic` | OPTIONAL_WHEN_USED | No explicit structured epistemic commitment authored | NO | None |
| `commitments.operational` | OPTIONAL_WHEN_USED | No explicit structured operational claim authored | NO | None |
| `commitments.conversational` | OPTIONAL_WHEN_USED | No explicit structured conversational commitment authored | NO | None |
| `commitments.stance` | OPTIONAL_WHEN_USED | No explicit stance directive authored | n/a | Expression adapter uses default |
| `workingContextDeltas` | OPTIONAL_WHEN_USED | No WC changes | NO | None |
| `concernDeltas` | OPTIONAL_WHEN_USED | No concern changes | NO | None |
| `occupancyDeltas` | OPTIONAL_WHEN_USED | No occupancy changes | NO | None |
| `futureTriggerDeltas` | OPTIONAL_WHEN_USED | No trigger operations | NO | Dead alias removed |
| `subscriptionDeltas` | OPTIONAL_WHEN_USED | No subscription operations | NO | Dead alias removed |
| `durableNominations` | OPTIONAL_WHEN_USED | No memory nominations | NO | Dead alias removed |
| `evidenceUse` | OPTIONAL_WHEN_USED | No explicit structured evidence/attention reliance authored | NO | None |
| `observation_intent.*` | KEEP_ALWAYS (branch) | n/a | n/a | None |
| `effect_intent.*` | KEEP_ALWAYS (branch) | n/a | n/a | None |
| `abstain.*` | KEEP_ALWAYS (branch) | n/a | n/a | `no_semantic_change_warranted` retired from fresh authoring (silence/no-op settlement used instead; historical readability preserved) |

---

## 31. Separate Stabilization Defects

The stabilization ledger explicitly separates **how work is packaged** (`Implementation packet`) from **when it must be complete** (`Completion gate`). Stabilization repairs and diagnostics must not be conflated with Core D0 contract qualification, nor postponed past their required gate.

### Two-dimension stabilization ledger

| Item | Implementation packet | Completion gate | Final disposition | Rationale / VNext interface |
|---|---|---|---|---|
| Sparse VNext contract | `PART_OF_VNEXT` | `BEFORE_CORE_D0` | Required | Implements optional presence, `empty_when_present` rejection, canonical/wire schema, parser, and materialization. |
| Reference-shape reconciliation (GAP C) | `PART_OF_VNEXT` | `BEFORE_CORE_D0` | Required | Resolves all 7 reference-shape mismatches; unifies all references to string form (`ExistingRef`). |
| Dead aliases / `acceptableRealizations` removal (GAP D) | `PART_OF_VNEXT` | `BEFORE_CORE_D0` | Required | Removes inert creation aliases and dead licensing disjunct from VNext new authoring. |
| Minimal provider failure capture | `SEPARATE_DIAGNOSTIC_PACKET` | `BEFORE_PROVIDER_DIAGNOSTIC` | Required | Adds provider-boundary failure capture before running NVIDIA A/B diagnostic. Prevents unclassifiable gen29/gen30-style provider pathology. |
| Evidence reliance carry-through (GAP B) | `INDEPENDENT_P1` | `BEFORE_EXACT_CANDIDATE` | Required | `retrievalRefsUsed`/`sourceRefsUsed` MUST survive semantic publication when authored; carry to `operations` alongside `observationsConsumed`. |
| Future-trigger Thought-seen-state binding (GAP A) | `INDEPENDENT_P1` | `BEFORE_EXACT_CANDIDATE` | Required | VNext removes `identity` from trigger create; Host binds trigger to exact concern snapshot seen by Thought in that cycle. Conflicts if moved. |
| Pending speech-outbox recovery | `INDEPENDENT_P1` | `BEFORE_EXACT_CANDIDATE` | Required | Idempotent reconsideration of eligible `pending` speech-outbox rows across crash/restart (`sidecar/recovery.ts`). No duplicate delivery, no re-cognition. |
| Broad prose/fidelity guard repair | `INDEPENDENT_P1` | `BEFORE_STABILITY_WINDOW` | Required | Narrow success-word (`fidelity.ts:104`) and currentness detectors (`currentness-detectors.ts:7-17`) to structured declarations or context-aware checks to prevent false positives on ordinary speech. |
| Meta/version deployment fencing | `INDEPENDENT_RELEASE_PACKET` | `BEFORE_PRODUCTION_DEPLOYMENT` | Required | Execute mechanical r5→r6 meta transition (§22, §24); update version constants (`SETTLEMENT_SCHEMA_VERSION=2`, `IMPLEMENTATION_SPEC_VERSION="0.2.1.r6"`, `.v2` contract IDs). Rollback binary with `r5` prepared. |
| Exact migration/rollback rehearsal | `QUALIFICATION_WITNESS` | `BEFORE_PRODUCTION_ACCEPTANCE` | Required | Mechanically witness r5→r6 forward transition and r6→r5 reverse rollback transition on the exact immutable candidate before production acceptance. |

---

## 32. D0 Qualification Plan

### Required Core D0 witness chain

```
canonical schema → wire specialization → structured-output request
→ model-output fixture → parser → validator → authority → materialization → persistence
```

### Core D0 witnesses (20 cases — local VNext contract coherence only)

Core D0 covers only local VNext contract coherence and must pass before the provider failure capture and NVIDIA diagnostic steps. It does not include later stabilization repairs.

| # | Witness | Invariant proven |
|---|---------|-----------------|
| D0-1 | Ordinary draft speech (E1) | `kind + speech` sufficient |
| D0-2 | Silent settlement (E2) | Silence without commitments |
| D0-3 | Silence + WC delta (E3) | Internal change publishes alongside silence |
| D0-4 | Epistemic commitment (E4) | Epistemic claims validate |
| D0-5 | Operational claim (E6) | Receipt matrix enforces operational honesty |
| D0-6 | WC upsert with alias (E7) | Local alias resolution works |
| D0-7 | Concern creation (E8) | Snapshot hash computed |
| D0-8 | Cross-domain co-reference (E9) | Local alias resolution across concern and trigger |
| D0-9 | Evidence reliance (E5) | Evidence refs validate against allowlist |
| D0-10 | Nomination (E10) | Host-minted durable nomination IDs |
| D0-11 | Correction (E12) | Plain string `ExistingRef` shape (GAP C resolved) |
| D0-12 | Observation intent (E13) | Registration and availability check |
| D0-13 | Effect intent (E14) | Registration and availability check |
| D0-14 | Abstain (E15) | Validates 3 VNext reasons (`insufficient_evidence`, `unresolved_ambiguity`, `no_responsible_proposal`); rejects `no_semantic_change_warranted` on fresh authoring; historical V1 records remain readable |
| D0-15 | Empty-when-present rejection (I4) | `minItems: 1` enforced on present optional arrays |
| D0-16 | Unknown field rejection (I10) | `additionalProperties: false` enforced |
| D0-17 | Missing speech rejection (I1) | `required_field_missing:speech` enforced |
| D0-18 | V1 legacy tolerance | Explicit empty arrays accepted for V1 records |
| D0-19 | Fingerprint consistency | Deterministic, differs from V1 fingerprints |
| D0-20 | Wire namespace empty | Operational claims rejected when namespace empty (`maxItems: 0`) |

### Later stabilization witnesses (blocking later gates)

These witnesses validate independent stabilization repairs. They are NOT part of Core D0 and are completed at their designated gates:

| # | Witness | Gate | Invariant proven |
|---|---------|------|-----------------|
| SW-1 | Evidence reliance carry-through | `BEFORE_EXACT_CANDIDATE` | `retrievalRefsUsed`/`sourceRefsUsed` appear in `operations` post-materialization (GAP B) |
| SW-2 | Speech-outbox crash/restart recovery | `BEFORE_EXACT_CANDIDATE` | Eligible `pending` outbox rows reconsidered after restart; idempotent; no duplicate delivery; no re-cognition |
| SW-3 | Future-trigger snapshot binding | `BEFORE_EXACT_CANDIDATE` | Host binds trigger to exact concern snapshot seen by Thought in that cycle; conflicts if concern moved (GAP A) |
| SW-4 | Broad prose/fidelity guard regression | `BEFORE_STABILITY_WINDOW` | Narrowed detectors prevent false positives on ordinary speech while preserving structured high-risk claim enforcement |
| SW-5 | Sidecar meta forward transition | `BEFORE_PRODUCTION_DEPLOYMENT` | Bounded transactional r5→r6 forward transition succeeds; fail-closed on mismatch |
| SW-6 | Exact candidate rollback rehearsal | `BEFORE_PRODUCTION_ACCEPTANCE` | Bounded transactional r6→r5 reverse rollback succeeds; binary restarts cleanly |

---

## 33. Provider Qualification Plan

Ordering is frozen:
```text
CORE D0
→ minimal provider failure capture (SEPARATE_DIAGNOSTIC_PACKET / REQUIRED_BEFORE_PROVIDER_DIAGNOSTIC)
→ controlled NVIDIA current-vs-sparse A/B diagnostic
```

Completion of the minimal provider-boundary failure capture packet is a **mandatory precondition** before running the controlled NVIDIA diagnostic:
> No more gen29/gen30-style provider pathology without enough boundary evidence to classify what happened.

### 15 scenarios

| # | Scenario | Tests |
|---|----------|-------|
| Q1-Q2 | Ordinary + longer speech (13 varied) | Reliable domain omission |
| Q3-Q4 | Silence + silence with delta (5 cases) | mode:none alone parses |
| Q5-Q8 | WC/concern/trigger/nomination ops (10 cases) | Full delta functionality |
| Q9-Q10 | Evidence + currentness (4 cases) | Evidence ref validation |
| Q11 | Operational claim (3 cases) | Receipt matrix |
| Q12 | Correction/revision (3 cases) | Interpretation + ExistingRef |
| Q13-Q15 | Intent + abstain (5 cases) | Full branches; abstain validates 3 VNext reasons; valid no-op uses silent settlement |

### Must answer

- Does Thought reliably omit unused domains?
- Does it still author consequential domains?
- Does output distribution materially shrink?
- Does runaway still occur, and where?
- Does it respect reference laws and finite namespaces?

---

## 34. Release / Stability-Window Preconditions

### Accepted 12-step execution sequence

The programme proceeds through twelve explicit, ordered gates:

```text
1. Freeze Sparse VNext design
2. Establish safe implementation base / protect unrelated dirty worktree
3. Implement bounded Sparse VNext contract
   (optional presence semantics, reference-shape reconciliation, dead alias removal,
    acceptableRealizations removal, parser/materializer/schema coherence)
4. CORE D0 LOCAL CONTRACT QUALIFICATION (20 core witnesses)
5. ADD MINIMAL PROVIDER-BOUNDARY FAILURE CAPTURE
6. RUN CONTROLLED NVIDIA CURRENT-vs-SPARSE DIAGNOSTIC
7. COMPLETE BLOCKING STABILIZATION/P1 REPAIRS
   (future-trigger Thought-seen-state binding, evidence reliance carry-through,
    pending speech-outbox recovery, broad prose/fidelity guard repair,
    version/deployment fencing)
8. QUALIFY ONE EXACT IMMUTABLE RELEASE CANDIDATE
   (consequential Thought branches, restart/crash, outbox recovery,
    future-trigger wake, evidence reliance, operational truth, history compatibility,
    meta transition, rollback rehearsal)
9. PRODUCTION DEPLOYMENT
   (under separate Owner authorization)
10. PRODUCTION ACCEPTANCE
11. ENTER STABILITY WINDOW
    → FREEZE ENGINEERING
    → USE ASHLEY NORMALLY
    → only demonstrated consequential defects may interrupt the freeze
12. END STABILITY WINDOW
    → adjudicate lived companion evidence
    → decide whether another programme is warranted
```

### Preconditions by completion gate

#### Before Core D0 (`BEFORE_CORE_D0`)
1. Implement Sparse VNext contract (canonical schema, wire specialization, parser, materializer, `empty_when_present` enforcement).
2. Resolve all 7 reference-shape mismatches to plain string `ExistingRef` (GAP C).
3. Remove dead creation aliases and `acceptableRealizations` from new authoring (GAP D).
4. Retire `no_semantic_change_warranted` from fresh authoring enum (valid no-op uses silent settlement).
5. All 20 Core D0 local contract witnesses pass end-to-end.

#### Before provider diagnostic (`BEFORE_PROVIDER_DIAGNOSTIC`)
1. Add minimal provider-boundary failure capture packet (`SEPARATE_DIAGNOSTIC_PACKET`).
2. Verify boundary capture provides sufficient classification evidence (no unclassifiable gen29/gen30 pathology).
3. Run controlled NVIDIA current-vs-sparse A/B diagnostic (15 scenarios).

#### Before exact candidate (`BEFORE_EXACT_CANDIDATE`)
1. **Future-trigger Thought-seen-state binding implemented and witnessed** (SW-3 / GAP A).
2. **Evidence reliance carry-through implemented and witnessed** (SW-1 / GAP B: `retrievalRefsUsed`/`sourceRefsUsed` survive publication into `operations`).
3. **Speech-outbox pending-row recovery implemented and witnessed** (SW-2: idempotent reconsideration on restart).

#### Before production deployment (`BEFORE_PRODUCTION_DEPLOYMENT`)
1. Version constants updated (`SETTLEMENT_SCHEMA_VERSION=2`, `IMPLEMENTATION_SPEC_VERSION="0.2.1.r6"`, `.v2` contract and schema IDs).
2. Compatibility instructions and prompt surfaces updated.
3. Rollback binary with `r5` constant built and verified.
4. Quiesce writers and execute mechanical forward meta transition (`r5 → r6`) as defined in §22 and §24.

#### Before production acceptance (`BEFORE_PRODUCTION_ACCEPTANCE`)
1. Mechanically witness r5→r6 forward transition on exact candidate.
2. Mechanically witness r6→r5 rollback rehearsal on exact candidate.
3. Qualify the exact immutable candidate against restart/crash, outbox recovery, future-trigger wake, evidence reliance, operational truth, and history compatibility.
4. Production acceptance criteria met under live witness.

#### Before stability window (`BEFORE_STABILITY_WINDOW`)
1. **Broad Host prose guards repaired**: success-word and currentness detectors narrowed to explicit structured declarations or context-aware checks (SW-4 / §8.1.B, §19, §31).
2. All blocking P1 defects verified closed in production.

### Stability window

FREEZE ENGINEERING. USE ASHLEY.
Only demonstrated consequential defects may interrupt the freeze.

### After stability window

Adjudicate lived companion evidence and decide whether another programme is warranted.

---

## 35. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Capability under-authoring | Medium | Monitor domain usage rates. Prompt still describes all capabilities. |
| Provider `minProperties` incompatibility | Medium | Fallback: parser-only enforcement. |
| Rollback `IMPLEMENTATION_SPEC_VERSION` mismatch | Medium | `META_TRANSITION_CONTRACT = DEFINED`; `EXACT_CANDIDATE_EXECUTION = MUST_BE_MECHANICALLY_WITNESSED`. Keep rollback binary with `r5` constant; forward and rollback transitions follow exact mechanical transaction contracts (§22, §24) with fail-closed mismatch behavior. Migration/rollback safety must be mechanically witnessed on the exact candidate before production acceptance. |
| Semantic-authority regression from relaxed licensing | Medium | Structured requirement for high-risk claims (§8.1.A) preserved; lexical guards (§8.1.B) repaired before stability window. |
| Broad Host prose guards false positives | High | Known unsound detectors (§8.1.B, §31). Must be repaired before stability window (`BEFORE_STABILITY_WINDOW`). |
| Over-tight wire bounds | Low | All bounds experimental with generous headroom. |
| Hidden Host defaults | Low | Implementation review: no `?? defaultValue` for absent domains. |
| Evidence reliance silent drop | Medium | Design disposition: MUST survive publication (§12). Implementation packet: `INDEPENDENT_P1`, completion gate: `BEFORE_EXACT_CANDIDATE` (SW-1). |
| Speech-outbox `pending` row loss on crash | Medium | Recovery repair packet: `INDEPENDENT_P1`, completion gate: `BEFORE_EXACT_CANDIDATE` (SW-2). |

---

## 36. Open Questions

1. `surfaceDraft` bound value — 6000 chars experimental. Voice quality impact?
2. NVIDIA `minProperties` support — parser fallback ready.
3. Capability under-authoring threshold — needs production data.
4. Expression adapter absent-stance protocol — acceptable for future voice?
5. Exact-candidate qualification witness rehearsal — specific physical host harness for crash/restart/version scenarios.

**Resolved by this correction pass**:
- `META_TRANSITION_CONTRACT = DEFINED`, `EXACT_CANDIDATE_EXECUTION = MUST_BE_MECHANICALLY_WITNESSED`: Exact sidecar meta forward (r5→r6) and reverse (r6→r5) transactional contracts, preconditions, single-column targets, assertions, read-backs, and fail-closed semantics are frozen (§22, §24). Mechanical execution must be witnessed on the exact candidate before production acceptance.
- `NO_SEMANTIC_CHANGE_WARRANTED = RETIRE_FROM_VNEXT_NEW_AUTHORING = HISTORICAL_READABILITY_ONLY`: Owner + Sol adjudication retired `no_semantic_change_warranted` from fresh authoring (§15). Settlement with `speech.mode: "none"` covers valid no-op silence; abstain is reserved for genuine inability to responsibly settle.
- `retrievalRefsUsed`/`sourceRefsUsed` materialization — **RESOLVED**: Design disposition is MUST SURVIVE PUBLICATION (§12). Implementation is `INDEPENDENT_P1`, completion gate: `BEFORE_EXACT_CANDIDATE` (SW-1).
- Broad Host prose guards — **RESOLVED AS REQUIRED REPAIR**: Must be narrowed before stability window (§8.1.B, §31, §34).
- Speech-outbox pending row recovery — **RESOLVED AS REQUIRED REPAIR**: SW-2 witness required before exact-candidate qualification (§31, §32, §34).

---

## 37. Implementation Surface Map

| File | Change | Packet / Gate |
|------|--------|---------------|
| `thought/output-contract.ts` | Schema: required → optional, remove dead aliases/`acceptableRealizations`, retire `no_semantic_change_warranted` from abstain reason enum, add wire bounds, contract IDs `.v2`, schema ID `.v2.schema` | `PART_OF_VNEXT` / `BEFORE_CORE_D0` |
| `thought/parse.ts` | Optional-field parsing keyed to VNext wire schema (no `schemaVersion` field in fresh provider output); `empty_when_present` enforcement; reject `no_semantic_change_warranted` on fresh authoring; parser validates against wire schema only. Historical V1 tolerance applies only to narrow direct `payload_json` readers, not the live parser. | `PART_OF_VNEXT` / `BEFORE_CORE_D0` |
| `thought/run.ts` | Materialization for optional domains; `SETTLEMENT_SCHEMA_VERSION = 2` in draft; evidence reliance carry-through to `operations` | `PART_OF_VNEXT` & `INDEPENDENT_P1` / `BEFORE_EXACT_CANDIDATE` |
| `thought/structural-feedback.ts` | Repair scope for new patterns | `PART_OF_VNEXT` / `BEFORE_CORE_D0` |
| `settlement/validate.ts` | Relax speech licensing, version-aware checks | `PART_OF_VNEXT` / `BEFORE_CORE_D0` |
| `settlement/publish.ts` | Delta application for absent domains | `PART_OF_VNEXT` / `BEFORE_CORE_D0` |
| `authority/check.ts` | Handle absent commitments | `PART_OF_VNEXT` / `BEFORE_CORE_D0` |
| `speech/fidelity.ts` | Remove `acceptableRealizations` disjunct; narrow broad prose/currentness guards | `INDEPENDENT_P1` / `BEFORE_STABILITY_WINDOW` |
| `speech/expression-adapter.ts` | Handle absent stance | `PART_OF_VNEXT` / `BEFORE_CORE_D0` |
| `speech/outbox.ts` | Idempotent reconsideration of eligible `pending` rows on restart (recovery repair) | `INDEPENDENT_P1` / `BEFORE_EXACT_CANDIDATE` |
| `sidecar/recovery.ts` | Requeue eligible `pending` speech-outbox rows (not just `projecting`) | `INDEPENDENT_P1` / `BEFORE_EXACT_CANDIDATE` |
| `types.ts` | `SETTLEMENT_SCHEMA_VERSION = 2`, `IMPLEMENTATION_SPEC_VERSION = "0.2.1.r6"`, `THOUGHT_OUTPUT_CONTRACT_ID = "ashley.thought.semantic.v2"`, `THOUGHT_OUTPUT_SCHEMA_ID = "ashley.thought.semantic.v2.schema"`, update abstain reason type | `INDEPENDENT_RELEASE_PACKET` / `BEFORE_PRODUCTION_DEPLOYMENT` |
| `sidecar/db.ts` | `META_TRANSITION_CONTRACT = DEFINED`: `ensureMeta()` check exact-matches binary constants; forward transition (r5→r6) and rollback transition (r6→r5) executed via explicit transactional deployment operations (§22, §24) before binary starts. No automatic runtime migration in application code. | `INDEPENDENT_RELEASE_PACKET` / `BEFORE_PRODUCTION_DEPLOYMENT` |
| Boundary capture | Minimal provider failure capture on kernel envelope | `SEPARATE_DIAGNOSTIC_PACKET` / `BEFORE_PROVIDER_DIAGNOSTIC` |
| Test files | Core D0 witness suite (20 cases); separate stabilization witness fixtures (evidence reliance SW-1, outbox recovery SW-2, future-trigger binding SW-3, prose guard SW-4, meta transition SW-5, rollback rehearsal SW-6) | By designated completion gate |

---

## 38. Final Necessity Red-Team

### What did you remove?

1. `acceptableRealizations` — BEHAVIOR_LOST = none (proven inert).
2. Dead creation aliases — BEHAVIOR_LOST = none (accepted then discarded).
3. Universal speech-licensing rule — BEHAVIOR_LOST = universal guarantee that
   every speaking turn carries a formal commitment. JUSTIFIED because ordinary
   speech doesn't earn this bureaucracy, and high-risk claims remain gated by
   explicit structured declarations (§8.1.A). Lexical defense-in-depth (§8.1.B)
   remains but is known unsound and flagged for repair before stability window.
4. `no_semantic_change_warranted` abstain reason from VNext fresh authoring —
   BEHAVIOR_LOST = none. Silent settlement (`kind: "settlement"`, `speech.mode: "none"`)
   with no deltas already validly expresses successful cycle completion with
   nothing to say and no internal state mutation. Abstain is cleanly reserved for
   when Thought cannot responsibly produce a semantic settlement on the available
   basis. Historical V1 records remain readable without rewriting.

### What behavior disappeared?

Only #3 (the universal guarantee). Every cognitive faculty remains fully available.
The relaxation of universal speech licensing is an intentional behavior change,
not a faculty removal — Thought can still author epistemic/conversational/operational
commitments when semantically warranted. Retirement of `no_semantic_change_warranted`
from new authoring removes a redundant synonym for successful silent/no-op settlement,
sharpening the responsibility boundary of `abstain`.

### What complexity did you intentionally preserve?

- Receipt-bound operational truth (25-cell matrix) — core honesty mechanism.
- Reference allowlist + local alias co-reference — functional, used.
- Fidelity detectors — defense-in-depth for high-risk claims (to be repaired).
- Concern snapshot hashing — lineage mechanism for trigger staleness.

### Implementation prohibitions

1. Do NOT collapse `undefined` and `[]` in the parser.
2. Do NOT remove fidelity detectors (repair them before stability window).
3. Do NOT add Host-manufactured defaults for absent domains.
4. Do NOT merge reference-shape fixes with unrelated changes.
5. Do NOT change provider numbers.
6. Do NOT remove `evidenceUse` container or its four children.
7. Do NOT implement GAP A inside VNext implementation.
8. Do NOT silently drop `retrievalRefsUsed`/`sourceRefsUsed` — they MUST survive publication.
9. Do NOT claim rollback safety without exact-candidate mechanical witness.
10. Do NOT treat experimental wire bounds as ratified constants.

---

## 39. Design Acceptance Criteria

- [ ] `kind + speech` alone parses, validates, materializes, and persists.
- [ ] All 15 valid examples (E1–E15) pass.
- [ ] All 12 invalid examples (I1–I12) fail at documented points.
- [ ] Core D0 witness set (20 cases) passes end-to-end.
- [ ] Minimal provider failure capture packet implemented and verified before running NVIDIA diagnostic (`BEFORE_PROVIDER_DIAGNOSTIC`).
- [ ] Later stabilization witnesses (SW-1 evidence reliance carry-through, SW-2 pending speech-outbox recovery, SW-3 future-trigger snapshot binding) pass before exact-candidate qualification (`BEFORE_EXACT_CANDIDATE`).
- [ ] V1 explicit-empty records accepted by narrow readers (admission, diagnostics); no durable→parser re-read path exists.
- [ ] VNext present-empty arrays rejected (`empty_when_present`).
- [ ] Reference shapes unified across schema/parser/TS (GAP C resolved).
- [ ] `acceptableRealizations` absent from VNext new authoring.
- [ ] Dead creation aliases absent from VNext new authoring.
- [ ] `no_semantic_change_warranted` retired from fresh authoring; rejected by VNext parser; historical V1 records readable.
- [ ] Fingerprints change deterministically (`THOUGHT_SEMANTIC_SCHEMA_FINGERPRINT`, `wireSchemaFingerprint`).
- [ ] `SETTLEMENT_SCHEMA_VERSION = 2`, `IMPLEMENTATION_SPEC_VERSION = "0.2.1.r6"`, `THOUGHT_OUTPUT_CONTRACT_ID = "ashley.thought.semantic.v2"`, `THOUGHT_OUTPUT_SCHEMA_ID = "ashley.thought.semantic.v2.schema"`.
- [ ] Fidelity detectors remain functional; broad guards flagged for repair before stability window (`BEFORE_STABILITY_WINDOW`).
- [ ] Silent settlement + delta publishes correctly.
- [ ] Absent `commitments` with `speech.mode: "draft"` is accepted.
- [ ] Operational claim validates against receipt matrix.
- [ ] Empty namespace rejects operational claims.
- [ ] Trigger/subscription create works without `identity`.
- [ ] Nomination works without `alias`.
- [ ] No code path manufactures default semantics for absent domains.
- [ ] `retrievalRefsUsed`/`sourceRefsUsed` appear in `ThoughtSettlementDraft.operations` post-materialization.
- [ ] Eligible `pending` speech-outbox rows reconsidered after restart (idempotent, no duplicate delivery, no re-cognition).
- [ ] Exact sidecar meta transition contracts (forward r5→r6 and reverse r6→r5) mechanically defined with fail-closed mismatch behavior; exact-candidate migration and rollback rehearsal witnessed before production acceptance.
- [ ] All wire bounds explicitly labeled `EXPERIMENTAL_WIRE_QUALIFICATION_STARTING_POINT`.

---

## 40. Final Recommendation

```
SPARSE_VNEXT_DESIGN_FREEZE_CANDIDATE
```

The architecture is **freeze-ready**. Implementation is **not authorized by this document itself**; that requires separate Owner authorization. Provider pathology is still empirically unresolved and must be evaluated through the controlled NVIDIA current-vs-sparse diagnostic following boundary failure capture. Migration and rollback safety design is fully defined, but exact-candidate migration and rollback safety must be mechanically witnessed before production acceptance. When production acceptance is achieved, the stability window means freezing engineering and using Ashley normally.

The design achieves the central objective:

> Ashley can retain every rightful current cognitive act while an ordinary
> relational settlement such as "Goodnight. Sleep well." requires little more
> than branch identity plus explicit speech, while consequential turns sparsely
> add exactly the semantic acts they actually perform.

No Host semantic turn classification. No second Thought call. No background
semantic authors. No generic event bus. No provider-specific cognitive
architecture. No silently dropped cognitive faculties.

**Final freeze-closure corrections integrated**:
1. **Sidecar meta transition contract mechanically closed**: `META_TRANSITION_CONTRACT = DEFINED`, `EXACT_CANDIDATE_EXECUTION = MUST_BE_MECHANICALLY_WITNESSED`. Exact preconditions, single-column targets, assertions (`changes() === 1`), read-backs, and fail-closed semantics are frozen (§22, §24).
2. **Stabilization ledger and sequencing normalized**: Split into two independent dimensions (`Implementation packet` vs `Completion gate`). Core D0 (20 cases) separated from later stabilization witnesses. Minimal provider failure capture strictly precedes the NVIDIA diagnostic (§31, §32, §33, §34).
3. **`no_semantic_change_warranted` retired from fresh authoring**: Owner + Sol adjudication retired this reason from VNext authoring enum while preserving historical readability (§15, §25, §26, §30). Silent settlement (`speech.mode: "none"`) covers valid no-op silence; abstain is reserved for genuine inability to responsibly settle.
4. **Final coherence and wording cleanup**: Premature "safe migration" claims eliminated in favor of defined design with exact-candidate witness requirement; explicit gate terminology enforced; stability window headings explicitly defined as "FREEZE ENGINEERING. USE ASHLEY." (§34).

Same rightful Ashley. Less protocol tax. Fewer failure surfaces. Better
diagnosability. Migration design defined (exact-candidate migration/rollback safety must be mechanically witnessed). No host semantic takeover.

The project has enough architecture. This is the smallest Sparse VNext that
lets us qualify it, execute the required stabilization repairs, deploy it,
and then enter the stability window to freeze engineering and actually meet Ashley.
