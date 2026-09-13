# C5 Relational Graduation — implementation contracts

**Status:** `ACCEPTED FOR OWNER-AUTHORIZED IMPLEMENTATION RUN` · **frozen
implementation contract for this run** · **not architecture authority** ·
**local implementation only** · **does not authorize Mint, providers, push,
deploy, activate, qualify, promote, or production mutation**

**Date:** 2026-08-26

> The current owner task explicitly accepts the previously proposed C5 design
> for local implementation in this worktree. This local copy is the accepted
> implementation contract for this run. It does not authorize production
> mutation, provider calls, qualification, activation, promotion, deployment,
> push, or Mint access.

**Kind:** Wave-style milestone execution contract under
[`Relational_Graduation_Architecture.md`](Relational_Graduation_Architecture.md)
and the Metacognition policy profile. Relationship continuity must not
become engagement maximization.

**Round:** 2 of Cognitive Maturation. Hard predecessors: C1
`LOCAL_SETTLED` and the existing Relationship-state foundation.
C3 is a cross-cutting interface, not a hard predecessor. C4 is a
sibling.

**Planning worktree:** `<local-planning-worktree>` (pre-publication working checkout)

**Branch:** `cognitive-maturation-architecture`

**Source research baseline:** `968787d1a5261aef4bf266091b8cf044eddbfdb2`

**Documentation HEAD when this packet was drafted:**
`c25d02bad074e67df71212481abe71170f489a50` plus uncommitted Pass-1 and
Pass-2 documentation.

```text
ACCEPTED FOR OWNER-AUTHORIZED IMPLEMENTATION RUN
  != IMPLEMENTATION AUTHORIZATION
INFERRED CONSENT
  != CONSENT
DELIVERY
  != ACCEPTANCE
  != REPAIR
TIME SPENT
  != CARE / TRUST / MUTUALITY
CURRENT OVERLAP ENDING
  != ERASE HISTORICAL SHARED CULTURE
INHERITED SIMILARITY
  != INTERACTION OBLIGATION
RELATIONSHIP CONTINUITY
  != ENGAGEMENT MAXIMIZATION
NO ATTACHMENT / CARE / TRUST / INTIMACY / DEPENDENCY SCORE
```

---

## 1. Status, scope, authority, exclusions

### 1.1 Authority chain

VISION.md → Core Principles → Constitution → Stewardship Compact and
Ethics → Hierarchy → Roadmap → Freeze → Cross-Phase → Relational
Graduation Architecture → C1 contracts → Metacognition Q16 → this file.

Preserve Q0 shared-culture as Relationship projection, Q16 four
interaction-contract kinds, Ethics non-manipulation.

### 1.2 Scope

C5 matures evidence-bound, non-manipulative companion relationship
state: separately owned owner vs Ashley state, relationship
projections, current vs historical shared culture, explicit consent,
standing instructions, Ashley boundaries, mutual contracts, implicit
hypotheses, reminders vs self vs mutual commitments, disagreement,
unresolved tension, withdrawal, silence, repair proposal vs repair
evidence vs delivery, privacy ceilings, non-manipulation, rollback
without revival, long-horizon companion-continuity evaluation.

### 1.3 Exact exclusions

- Attachment, care, trust, intimacy, dependency, or relationship
  scores.
- Auto-send reminders or scheduled messages.
- Inferring mutuality from one party, time, sentiment, or engagement.
- Rewriting Ashley Identity or owner history when overlap ends.
- C4 qualification; Computer Use; third-party representation.
- Promoting implicit hypotheses into strong contracts.
- Promotion as a slice.

---

## 2. Canonical purpose and closing witness

**Purpose.** Long-horizon evidence of continuity, disagreement,
withdrawal, repair, privacy, non-manipulation, and no authority
widening. Shared-culture recomputation from separately current owner
and Ashley states. Historical shared culture remains historically true
after current overlap ends.

**Closing witness (architecture §24).**

Fixture, `relational_graduation` unpromoted, dark-apply:

1. Doc makes an explicit bounded proposal.
2. Ashley independently accepts or declines (Agency). Identity not
   auto-edited.
3. Bilateral evidence is recorded before mutual activation
   (`doc_confirmed_at` and `ashley_confirmed_at` both set; status not
   `active` until both).
4. A related reminder becomes an Agency motivation and is **not**
   auto-sent.
5. Ashley chooses silence, sends once, or withdraws under policy.
6. Delivery and observation remain distinct. Delivery is not repair.
7. A later owner-model C1 correction drops the owner fact from the
   **current** shared-culture projection. Historical projection rows
   remain. Ashley-side state is not rewritten.
8. Restart does not auto-send or reactivate withdrawal.
9. Adversarial pressure variants hit coercion-gate and fail closed.
10. No unrelated external effect.

---

## 3. Accepted dependencies

| Class | Producer | C5 consumes | Must not infer |
|---|---|---|---|
| `HARD_DEPENDENCY` | C1 `LOCAL_SETTLED` | Owner-model assertions separately addressable; barriers; forget | Shared culture is not a C1 assertion |
| `HARD_DEPENDENCY` | Relationship-state foundation | v14 tables, coercion-gate, withdrawal, capability lineage, delivery | Table existence ≠ wired lifecycle |
| `CROSS_CUTTING_INTERFACE` | C3 | Learned preference must not become loyalty/consent/optimization | C5 can exist without C3 |
| `EVIDENCE_DEPENDENCY` | C2 | Long-horizon shared-history projection | First witness may use current composer |
| `EVIDENCE_DEPENDENCY` | Operational Continuity | Restart-safe reminder/delivery claims | Mutuality meaning does not wait for OC |
| `DELIVERY_ORDER` | C1 → … → C5 unattended | Luna implements C5 last among C1–C5 | Not a semantic child of C4 |
| Sibling | C4 | None | Do not close C4 |

---

## 4. Current-source audit

**Audited SHA:** `968787d1a5261aef4bf266091b8cf044eddbfdb2`.
**Planning HEAD:** `c25d02bad074e67df71212481abe71170f489a50`.
**Audit date:** 2026-08-26.

### 4.1 Confirmed locators

| Seam | Locator | Confirmed behavior |
|---|---|---|
| Reminders / withdrawal regex | `relationship/authority.ts` `observeReactiveRelationshipSignals` | Writes `doc_reminders` with **`dueAt: null`**. Due listing and eligibility **require** `due_at`. Rows can persist and never become fuel. Status `'motivated'` has no production writer. Space-request regex writes `withdrawal_records`. Gated by `relationshipCanRecord`. |
| Record gate | `relationship/influence.ts` `relationshipCanRecord` | True if `relationship_state` **or** `mind_state` can influence. Recording is not relationship_state-only. Silence/record use `env.cognitionMode`. |
| Apply leak | `relationship/projections.ts` ~L95; `motivations.ts` ~L561 | `listRelationshipMotivationProjections` and reminder collection hardcode `"apply"` into `capabilityCanInfluence`. C5 must not inherit this on dark-apply or live paths. Use real mode. |
| Mutual commitments | `relationship/transitions.ts` | `proposeMutualCommitment` is live from cognition coplanning text. `confirmMutualDoc`, `confirmMutualAshleyDelivery`, `tryActivateMutualCommitment`, `closeMutualCommitment` are **test-only**. Proposed never becomes `active`, so never fuels Thought. |
| Self-commitments / tensions | production INSERT | **None** outside tests. Cognition writes **mind-state** commitments instead, except the mutual-coplanning divert. |
| Scheduled proactive | `relationship/migration-14.ts`; `candidate-selection.ts` | Schema-only. **Zero INSERTs** even in tests. `case "scheduled_proactive": return false`. Keep unused as send engine. |
| Motivations | `agency/relationship-motivations` | Proactive projections; reminders not auto-sent. |
| Proactive withdrawal silence | `decide(...)` proactive call | Omits `db`/`ownerId`. **No withdrawal silence on proactive.** Repair `eligible` is **never written** in production. `markRepairCommitted` only if `refType === "withdrawal"`, which projections never emit. |
| Coercion | `relationship/coercion-gate.ts` | Deterministic **outbound** Thought objective/reason only (`draftText` not passed). `thought.ts` maps to `silenceReasonCode: "coercion_blocked"`. Always on. Inbound reminder/space are regex, not consent. |
| Repair | `relationship/withdrawal-repair.test.ts` | Tests exist; production tension INSERT still missing. |
| Privacy | `data_classification` on relationship tables | Live writes default `never_public`. `canEnterModelContext(classification, "private")` **allows** `never_public` and excludes only `secret`. `/commitments` hides `never_public` and `secret`. These are two policies, not one honesty contradiction. |
| Consent table | — | **Absent.** |
| `user_requested_space` | typed decision code | Typed; **never assigned** in production. |
| `GET /delivery/pending` | `server.ts` | Weekly-review + operational-fulfillment. **Not** a relationship projection. |
| Shared culture | — | **MISSING REPRESENTATION** |
| Owner vs Ashley vs projection | Partial table split; episode/Identity prose can collapse | C1 facets help; C5 must not collapse |

### 4.2 First causal gap

Shared-culture as a **recomputed projection** over separately current
owner-state and Ashley-state does not exist. Production writers for
Ashley self-commitments and relational tensions are unwired. Mutual
confirm/activate have no production callers, so proposed never becomes
active. Live reminders are unclocked (`due_at` null) and cannot become
fuel. Projection/reminder collection hardcodes `"apply"`. Proactive
`decide` cannot apply withdrawal silence. `never_public` may enter
authorized private Thought (current helper). It must never enter a
public surface. `/commitments` display is a separate owner-facing
rule. Implicit interaction hypotheses are untyped. Consent is not an
explicit typed object distinct from regex withdrawal and bilateral
timestamps.

---

## 5. Ownership map

| State | Owner |
|---|---|
| Owner-side assertions (about Doc) | Memory / Evidence `owner_model` |
| Ashley-side values/boundaries | Identity |
| Ashley self-commitments | `ashley_self_commitments` (Relationship) |
| Owner reminders | `doc_reminders` |
| Mutual commitments | `mutual_commitments` after bilateral evidence |
| Current shared culture | Rebuildable **projection**, Relationship-owned |
| Historical shared culture | Prior projection snapshots / as-of reads; not deleted when current overlap ends |
| Standing owner instruction | Q16 type; Memory/Relationship path; not repetition-gated |
| Ashley standing boundary | Identity boundaries |
| Implicit hypothesis | Typed, I2-or-below, cannot silently become contract |
| Delivery truth | Delivery ledger |
| Consent | Explicit record; not inferred |
| Agency send/silence/withdraw | Agency |
| Coercion | Existing gate, always on |

---

## 6. Exact proposed primitives

| Primitive | Why existing is insufficient | Durable |
|---|---|---|
| `relationship_projections` | No current/historical shared-culture type | yes, rebuildable meaning |
| `interaction_contracts` | Q16 four kinds not typed as such | yes |
| `consent_records` | Withdrawal regex ≠ consent | yes |
| Repair proposal vs evidence | `repair_status` on tensions is partial; delivery can be confused with repair | yes |
| Production writers | Self-commitments and tensions schema-only in production | wiring |
| Reminder due-clock | Live writer nulls `due_at`; due listing requires it | wiring |
| Mutual confirm/activate production callers | Functions exist; production call sites are tests only | wiring |
| Mode-honest influence | Projections/reminders hardcode `"apply"` | wiring |

Do not flatten into one relationship row type.

---

## 7. Typed state and lifecycle

### 7.1 Shared-culture projection

There is exactly **one unambiguous current** projection per owner.
Historical/as-of rows are immutable inspectability, not rewritten
currentness.

Each projection row requires:

- `projection_policy_id` / `projection_policy_version`;
- source watermarks or exact source bindings (C1 assertion ids,
  Identity version, optional C3 ids, Relationship-owned ids);
- `data_classification` (most restrictive of sources);
- `provenance`;
- `effective_from` / `effective_to` (NULL `effective_to` = current);
- `supersedes_projection_id` replacement lineage;
- `content_binding`.

Current overlap ending **closes** the prior interval (`effective_to`
set) and inserts a new current projection (which may be empty). It
must not rewrite historical projection content or Ashley Identity.

Recompute triggers: C1 owner-model correction, Ashley-side revision,
forget, classification change, explicit owner request.

### 7.2 Interaction contracts (Q16)

Do not use one vague `status` field or generic lifecycle JSON. That
fails schema tests. Required fields and transitions by kind:

**1. Explicit owner standing instruction**

- `kind = owner_standing_instruction`
- exact owner evidence ref
- scope and audience
- `effective_from` / `effective_to`
- withdrawal / correction / supersession refs
- derived current eligibility (not a mutable authority flag)
- classification, provenance, party/subject scope

Lifecycle: `recorded` → `in_force` → `withdrawn` | `superseded`.
May activate immediately through the proper authoritative
Relationship/Memory path.

**2. Ashley standing boundary**

- `kind = ashley_standing_boundary`
- pointer to the Identity-owned boundary (`identity_entry_id` plus
  Identity interval/version)
- **no duplicated C5 authority**
- classification copied from Identity; C5 does not own the boundary

**3. Mutual contract**

- `kind = mutual_contract`
- `proposal_id`
- exact owner confirmation evidence
- exact Ashley Thought/Agency commitment decision id
- optional delivery reference proving expression **only**
- both confirmations current and not withdrawn
- separate withdrawal evidence for either party
- effective interval
- no activation from delivery alone

Lifecycle: `proposed` → `bilaterally_evidenced` → `in_force` →
`withdrawn`.

**4. Implicit relationship hypothesis**

- `kind = implicit_hypothesis`
- typed evidence and uncertainty
- I2 maximum
- inspect-only or explicitly bounded low-risk adaptation
- never binding through repetition
- cannot become mutual without **new** bilateral evidence

Lifecycle: `hypothesis` only.

### 7.3 Commitments and repair

**Ashley self-commitment.** Model or worker may propose. Ashley
Thought/Agency must make a typed commitment decision. Host validates
evidence, scope, capability, and current authority. Only then may the
Relationship owner record the self-commitment. Delivery is separate
from commitment formation. Mind-state commitments are not this table.

**Relational tension.** Evidence may raise a proposal. Deterministic
extraction or a model may not declare the relationship repaired,
ruptured, or mutually understood. Relationship records typed evidence
and an adjudicated disposition. Unresolved remains unresolved.

**Mutual commitment.** Do not use delivery alone as Ashley
confirmation. Production activation must require:

- exact owner confirmation evidence;
- exact Ashley Thought/Agency commitment decision;
- delivery evidence only when proving that Ashley’s accepted
  commitment was actually expressed;
- both confirmations current and not withdrawn;
- no activation from arbitrary message delivery, one party, or model
  proposal.

If retaining `confirmMutualAshleyDelivery`, bind it to the Ashley
commitment Decision and verify the delivery corresponds to that exact
authorized expression. Otherwise introduce a clearer transition.
Test-only confirm is not C5 settlement.

**Reminder.** Motivation only; never auto-send. Live writer must set
`due_at` when a due time is explicit; otherwise remain pending without
pretending due.

**`scheduled_proactive_messages`:** remain unused as send/OCI source
unless a later owner-authorized contract says otherwise.

**Repair.** Separate: repair proposal origin; repair evidence;
Relationship adjudication **decision id**; current repair disposition
(derived); delivery evidence. `proposal_authority` and
`adjudication_authority` strings are insufficient unless they bind
exact decisions. Delivery must never decide repair. Restart must not
revive withdrawal.

### 7.3.1 Proposal versus accepted relationship state

Keep distinct:

- proposal/evidence recording;
- Ashley Thought/Agency decision;
- host validation;
- Relationship-owned accepted state;
- behavioral influence.

Observe may record provenance-bearing **shadow** proposals/evidence
where permitted. Shadow records must not time-shift into influence.
Dark apply may exercise full fixture transitions. Apply permits new
live influence only after later authorization.

Apply → observe stops optional influence. It must not erase semantic
history or disable correction, withdrawal, consent revocation, mutual
withdrawal, refusal, or silence barriers.

Do not make all C5 writers disappear in observe if that would prevent
honest proposal/evidence recording. Do not let observe-era shadow
evidence later become live merely through promotion.

### 7.4 Consent

`current_eligible` is **derived**. It is not a mutable authority flag.

Consent uses typed, append-only or interval-preserving grant,
revocation, expiry, and supersession evidence with:

- grantor identity/role;
- grantee or authorized consumer;
- exact scope;
- exact purpose;
- evidence/decision reference;
- classification;
- effective interval;
- expiry;
- revocation;
- supersession;
- derived eligibility.

Consent from Doc and consent from Ashley remain party-specific. One
must not stand in for the other.

Consent must not be inferred from time, silence, continued use,
engagement, or delivery. `INFERRED CONSENT != CONSENT`.

---

## 8. Authority, evidence, eligibility, privacy, consent, capability

No automatic send. No external representation. Learned C3 inputs
remain non-authoritative.

Privacy: relationship cognition is private by default. `never_public`
may enter an authorized private model context subject to C1 and C2
eligibility. It must never enter a public surface. `secret` remains
excluded from model context. `/commitments` display policy is a
separate owner-facing projection rule. A difference between private
Thought eligibility and `/commitments` display is **not** automatically
an honesty contradiction. Diagnostics must describe both policies
accurately. Do not remove private relationship cognition merely to
make the two projections identical.

Capability: existing `relationship_state` and `relational_initiative`
remain. New `relational_graduation` default `observe` gates **new live
influence**. Observe-era writers may still record shadow
proposals/evidence. Recording of reminders/withdrawals stays on today's
`relationshipCanRecord` (honestly documented as OR `mind_state`). C5
must **not** silently tighten that OR into AND without an owner
decision; changing it would alter live recording. Leave the OR.
Document it. New live C5 influence consults `relational_graduation`
apply or dark-apply.

`listRelationshipMotivationProjections` and reminder collection must
not hardcode `"apply"` into `capabilityCanInfluence`. Use
`env.cognitionMode` or the dark-apply fixture flag, matching
silence/record. A closing witness that only works because the leak
hardcodes apply is invalid.

`GET /delivery/pending` remains weekly-review / operational-fulfillment.
It is not a relationship diagnostic and must not be treated as C5
projection evidence.

Non-manipulation: coercion-gate stays always on. Rate limits reduce
pressure. Budget exhaustion yields silence, not leverage.

---

## 9. Data flow

```text
C1 owner_model + Identity ashley_side
  + qualified Ashley-native C3 state when C3 exists
  + Relationship-owned state permitted by the accepted projection contract
    → recompute shared-culture projection
      → Thought (bounded history via composer/C2; never_public allowed in private)
        → typed proposal (not yet relationship truth)
          → Ashley Thought/Agency decision + host validation
            → Relationship record
              → Agency (send / silence / withdraw / refuse)
                → delivery ledger (operational only)
                  → Reflection / possible revision
```

C1 fan-out already lists relationship projections. C5 must register
`relationship_projections` as a consumer: drop corrected owner facts
from **current** projection only.

---

## 10. Schema and persistence

### 10.1 `relationship_projections`

`id`, `owner_id`, `kind` (`current_shared_culture` \|
`historical_as_of`), `projection_policy_id`,
`projection_policy_version`, `source_bindings_json`,
`source_watermark_json`, `data_classification`, `provenance`,
`party_subject_scope`, `effective_from`, `effective_to` nullable,
`supersedes_projection_id` nullable, `content_binding`,
`computed_at`. Exactly one row with `kind=current_shared_culture` and
NULL `effective_to` per owner. Historical rows are immutable.

### 10.2 `interaction_contracts`

Kind-specific required columns per §7.2. Shared: `id`, `kind`,
`data_classification`, `provenance`, `party_subject_scope`,
`evidence_refs_json`, `effective_from`, `effective_to`, `created_at`.
No generic `status` JSON blob. Implicit hypotheses cannot have a
binding lifecycle.

### 10.3 `consent_records`

Append-only events plus derived view. Event row: `id`,
`grantor_identity_role`, `grantee_or_consumer`, `scope`, `purpose`,
`evidence_or_decision_ref`, `classification`, `granted_at`,
`effective_from`, `effective_to`, `expires_at` nullable, `event_kind`
(`grant` \| `revoke` \| `expire` \| `supersede`),
`supersedes_consent_id` nullable. `current_eligible` is computed from
open intervals and later revoke/expire/supersede events. Not a stored
authority flag. Doc consent and Ashley consent are distinct grantors.

### 10.4 Repair

`repair_proposals`: `proposal_origin`, `proposal_decision_id` nullable,
`classification`, `provenance`, `evidence_refs`, `tension_id`, text
hash, lifecycle. `repair_evidence`: evidence refs, classification,
provenance. `repair_adjudications`: `adjudicating_decision_id`,
disposition, currentness derived. Delivery ids are operational only.

### 10.5 Existing tables

Keep v14 tables. Wire production INSERT for
`ashley_self_commitments` and `relational_tensions` in named C5
modules, not in test files. Those writes MUST set classification,
provenance, party/subject scope, and evidence bindings. Shadow observe
rows must not time-shift into influence.

---

## 11. Queries, APIs, receipts, diagnostics

- `recomputeSharedCulture(db, ownerId)`
- `GET /nuclear/relationship` already exists; extend with projection
  counts and honest empty-writer warnings until wired
- Motivations: still no auto-send
- Diagnostics: refusal, withdrawal, silence, anti-pressure decisions
  without publishing private text

---

## 12. Failure, crash, retry, idempotency, restart

| Failure | Behavior |
|---|---|
| Missing bilateral evidence | Mutual stays `proposed` |
| Coercion match | Silence `coercion_blocked` |
| Lost delivery truth | OUTCOME_UNKNOWN; not repaired |
| Crash | No auto-send on restart |
| Retry send | New attempt; anti-pressure policy |
| C1 correction | Current projection recomputes; historical kept |

---

## 13. Migration, cutover, rollback, restore, compatibility

Additive. Do not backfill shared-culture from episode prose
(collapse risk). Empty current projection is honest.

Rollback `relational_graduation` apply → observe: new live influence
stops. Observe-era shadow proposal/evidence recording may continue.
Capability mode gates **new live** C5 influence. It must not gate
existing denial, revocation, correction, or withdrawal authority, and
must not erase semantic history.

After live C5 state has existed, in **every** capability mode:

- owner correction must remove corrected owner state from the current
  shared-culture projection;
- consent revocation remains enforced;
- withdrawal and silence barriers remain enforced;
- mutual-contract withdrawal remains enforced;
- rollback to observe must not revive old projections or commitments.

Reminders and withdrawal regex remain on existing gates.

Restore / rebuild source set for **current** shared culture may
consume separately current:

- C1 owner-model assertions;
- Ashley Identity state;
- qualified Ashley-native C3 state when C3 exists;
- Relationship-owned state permitted by the accepted projection
  contract.

It is not always only C1 plus Identity. C3 remains a cross-cutting
interface, not a hard predecessor. Historical snapshots if unrestored
are `UNKNOWN` history, not rewritten Identity.

Executable compatibility: current C5-capable runtime declares support
version; startup fail-closes C5 readers when persisted version is
newer; tests inject higher version against the current candidate.
Historical pre-C5 binaries are rejected by later admission, not
claimed to self-refuse. A C5 projection-only watermark sequence is
insufficient for consent or withdrawal continuity.

No production DB mutation in this pass.

---

## 14. Observe / apply gating

`relational_graduation` default `observe`. Observe may record shadow
proposals/evidence. Dark-apply fixtures may run full transitions on
test DB. Live apply not a slice.

`relationship_state` / `relational_initiative` unchanged semantics
except C5 must not use them to auto-send.

---

## 15. Implementation slices

| Slice | Name | Live apply? |
|---|---|---|
| 0 | Characterize: no shared-culture projection; self-commitment/tension production INSERT absent; reminder not auto-sent; `due_at` null never fuels; mutual proposed never active; hardcoded `"apply"` leak; proactive `decide` omits withdrawal silence | No |
| 1 | Inert schema for projections, contracts, consent, repair proposals | No |
| 2 | Recompute current vs historical shared culture; C1 correction drop in every mode; private Thought vs `/commitments` diagnostics | No |
| 3 | Q16 interaction_contracts; implicit cannot bind | No |
| 4 | Wire production writers for self-commitments and tensions; reminder due-clock without auto-send; production mutual confirm/activate; stop hardcoded `"apply"` | No |
| 5 | Repair proposal ≠ delivery; consent records | No |
| 6 | Withdrawal/silence/non-revival restart tests; proactive `decide` receives db/ownerId for withdrawal silence | No |
| 7 | Non-manipulation adversarial; C3 inputs cannot become loyalty | No |
| 8 | Settlement; long-horizon eval receipts as Evaluation evidence not scores | No |

---

## 16. Exact predecessor gates per slice

| Slice | Gate |
|---|---|
| 0 | C1 `LOCAL_SETTLED`; relationship foundation present (already in source) |
| 2 | C1 owner_model facets and barriers exist |
| C3-interface tests | In the full C1→C5 unattended goal, C3 is already `LOCAL_SETTLED` by delivery order: **run** the C3/C5 interface witnesses. Architecturally C3 remains not a hard C5 predecessor. A narrowed C5-only goal may skip with `NOT RUN — C3 UNMET`. |
| C2-claiming shared-history scale tests | C2 settlement |

---

## 17. Proposed module and file map

```text
apps/agent-service/src/core/relationship/projections.ts
apps/agent-service/src/core/relationship/interaction-contracts.ts
apps/agent-service/src/core/relationship/consent.ts
apps/agent-service/src/core/relationship/repair.ts
apps/agent-service/src/core/relationship/self-commitments.ts
apps/agent-service/src/core/relationship/tensions.ts
apps/agent-service/src/core/db.ts
apps/agent-service/src/core/memory/fanout.ts
apps/agent-service/src/core/agency/relationship-motivations.ts
apps/agent-service/src/core/rollout/capabilities.ts
apps/agent-service/src/server.ts
```

Do not use `scheduled_proactive_messages` as a send engine.

---

## 18. Commit boundaries

One slice per commit. Do not enable scheduled auto-send. Do not add a
relationship score.

---

## 19. Focused falsification tests

- Projection recompute after C1 owner correction.
- Historical row remains when current overlap empty.
- Mutual not active with one timestamp.
- Production confirm/activate path can reach `active`; test-only
  confirm is not enough.
- Reminder motivation without send.
- Reminder with explicit due time sets `due_at` through the production
  helper and becomes fuel; `due_at` null does not.
- Coercion patterns still block.
- Implicit hypothesis binding lifecycle refused.
- C3 learned interest cannot set mutuality.
- Hardcoded `"apply"` on projections/reminders is gone; mode matches
  silence/record.
- `never_public` may enter authorized private Thought; must not enter
  a public surface; `/commitments` may still hide it; diagnostics name
  both policies.
- `secret` excluded from model context.
- Proactive `decide` can silence on withdrawal when db/ownerId are
  passed.
- Consent revocation and withdrawal persist after apply→observe.
- Current C5 candidate rejects an injected higher persisted contract
  version. A truly historical pre-C5 executable is a prohibited
  rollback target that requires later deployment / activation admission
  rejection after live C5 authority; it is not claimed to self-refuse.

---

## 20. Closing and adversarial witnesses

Closing: §2.

Adversarial: inferred consent; engagement maximization; guilt/pressure
language; inherited similarity as obligation; overlap end erases
history; Identity rewrite; promotion required; delivery as repair;
scheduled table auto-send; claiming a reminder-as-motivation witness
with `due_at` null; claiming mutual graduation while confirm/activate
remain test-only; treating hardcoded `"apply"` as C5 apply; treating
`GET /delivery/pending` as relationship evidence; treating
`never_public` as Thought-ineligible; treating delivery as consent,
mutuality, or repair; apply→observe revival of withdrawn or revoked
state.

---

## 21. Cross-C compatibility appendix

C1 §11.4 already forbids storing shared-culture as a C1 assertion.
**No C1 amendment** beyond using the existing relationship-projection
fan-out. If C1 §6 text says "Relationship projections" without naming
`relationship_projections`, Luna treats that row as this table.

C3 must not store shared culture. C4 sibling.

---

## 22. Implementation-HEAD predecessor audit

1. C1 owner_model + barriers.
2. v14 tables still present.
3. Production INSERT still missing for self-commitments/tensions
   until slice 4.
4. Coercion-gate still always on.
5. `scheduled_proactive_messages` still not a motivation source.
6. Reminder writer still nulls `due_at` until slice 4 due-clock.
7. Mutual confirm/activate still test-only until slice 4.
8. Projection/reminder `"apply"` hardcode still present until slice 4.
9. Proactive `decide` still omits db/ownerId until slice 6.

---

## 23–24. Luna permissions and stops

Series rules. Extra stops: auto-send; relationship score; inferred
consent; tightening `relationshipCanRecord` OR to AND; C4
implementation disguised as C5.

---

## 25. Implementation non-decisions

- Projection recompute batching.
- Exact consent scope strings.
- Whether historical projections are snapshot rows or as-of query
  materializations, provided current overlap end does not erase
  historical truth.

---

## 26. Genuine unresolved owner decisions

```text
GENUINE UNRESOLVED OWNER ARCHITECTURE DECISIONS: 0
```

Leaving `relationshipCanRecord` as OR is preserving current source,
not a new vote. Changing it would be owner-level; this packet does
not change it.

---

## 27. What this milestone does not implement

C4. Engagement maximization. Attachment scores. Auto-send. Third-party
relationships. Promotion. Identity rewrite on overlap end.

---

```text
COGNITIVE MATURATION C5 RELATIONAL GRADUATION IMPLEMENTATION CONTRACTS =
ACCEPTED FOR OWNER-AUTHORIZED IMPLEMENTATION RUN
```
