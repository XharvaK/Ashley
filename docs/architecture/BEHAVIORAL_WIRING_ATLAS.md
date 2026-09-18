# Project Ashley Behavioral Wiring Atlas

STATUS: COMMITTED BASELINE AUDIT + OWNER/SOL-ADJUDICATED POST-REPAIR DELTA
AUTHORITY: NONE
IMPLEMENTATION AUTHORITY: NONE
PROMOTION AUTHORITY: NONE
DEPLOYMENT AUTHORITY: NONE

THIS DOCUMENT DOES NOT AUTHORIZE CONNECTING ANY EDGE.

- AUDIT HEAD (dev/source): `048325c5f257aad7dc148cc7c05a150a7fe46f02`
- AUDIT TREE (dev/source): `b1bed7768de753953f7bcf685be974707f706bdd`
- PRODUCTION HEAD: `048325c5f257aad7dc148cc7c05a150a7fe46f02`
- PRODUCTION TREE: `b1bed7768de753953f7bcf685be974707f706bdd`
- SOURCE DIVERGENCE: NONE. Dev and production resolve to the identical commit and tree.
- DATE: 2026-09-18 (Europe/Istanbul)
- ARTIFACT STATUS: COMMITTED BASELINE (`048325c`/`b1bed77`, sections above
  unchanged provenance) + OWNER/SOL-ADJUDICATED POST-REPAIR DELTA (final
  section below, bound to its own repair SHA/tree). This document still
  authorizes nothing: it records decisions, it does not grant them.

No fix was implemented. No runtime configuration was altered. No database was migrated.
No feature flag was changed. No capability was promoted or rolled back. No cognitive
tick was forced. No owner message was sent. No production witness was fabricated.
No service was restarted. Apart from this markdown file, the audit was read-only.

Note on secrets hygiene: production `.env` was listed read-only to resolve effective
non-secret configuration. Secret values observed during that listing are NOT recorded
anywhere in this atlas.

---

# 1. Audit Certificate

- Baseline verified first, before any substantive audit:
  - dev/source: branch `main`, HEAD and tree exactly as expected, tracked tree clean.
    14 untracked paths exist in the dev checkout only (staging/campaign notes and
    `report.md`); they are not part of the audited tree and were not read as evidence
    except for this count.
  - production (`~/project-ashley` on Mint, read-only over SSH): branch `main`,
    identical HEAD and tree, `git status --short` empty.
- Production health (read-only): `ashley-agent` active, `ashley-discord` active,
  agent on `127.0.0.1:3710` reports `ok/ready`, `cognitiveKernel v021`,
  sidecar open schema 21. Activated SHA file confirms `048325c…`; service start
  records activation 2026-09-18 00:28 +03 (2026-09-17 21:28 UTC).
- Schema identities (read-only `PRAGMA user_version`): nuclear 49, cognitive-v021
  sidecar 21, continuity 1, observability 2, derived index 0. All match reported values.
- Last production owner activity precedes this audit: latest delivery reservation
  `2026-09-17T07:16:43Z`. No owner traffic has occurred since activation of the
  audited commit, so every post-repair (Wave A/B/C/D + P0) production path is
  WITHOUT a natural live witness at audit time.
- Evidence tiers were never flattened: SOURCE_PROVEN / TEST_PROVEN /
  PRODUCTION_PROVEN are recorded separately for every consequential edge, and
  production proof means an exact bounded witness (row, receipt, log), never a
  call graph or a unit test.
- Four parallel read-only source-research passes (reachability, M6 layers,
  notice/delivery/concern/status paths, architecture contracts) plus direct auditor
  spot-checks back every file:line claim. No test campaign was run
  (`NO TEST CAMPAIGN` rule); existing tests were read, not executed.

# 2. Method and Truth Order

For CURRENT BEHAVIOR the audit used: (1) exact current source, (2) exact current
runtime configuration (non-secret effective env), (3) production database/runtime
evidence via read-only SQLite over `mode=ro` plus read-only health/diagnostics,
(4) current tests as read artifacts, (5) authoritative architecture, (6) supporting
docs, (7) history as provenance only, (8) the audit prompt last.

For INTENDED OWNERSHIP: Vision / Core Principles / Constitution, then Architecture
Freeze, then owner-specific accepted architecture, then Cross-Phase Architecture,
then current phase contracts, then history as provenance only.

Two passes were made over every important state edge. PASS A (forward): what does
this producer output actually feed. PASS B (reverse): what live path actually
produces this consumer input. The reverse pass is what exposes the quarantined
concerns, the never-firing nomination path, the always-empty trigger tables, and
the stale `sending` rows documented below.

# 3. Frozen Owner Map

Per Freeze, Cross-Phase, and v0.2.1 (see §4-adjacent research notes in the audit
trail): no new owner is invented in this atlas. Metacognition is a policy profile,
not a box. Self-change is a composed lifecycle chokepoint, not an owner.

COGNITIVE: Identity (stable values/boundaries, governed development only);
Mind State (dynamic concerns/priorities/condition); Thought (sole semantic author);
Agency (executive mechanics only: eligibility, fence, dispatch, retry, delivery,
commit); Reflection (post-outcome calibration, no current-turn authority);
Relationship (bilateral commitment/withdrawal/coercion state); Curiosity
(unanswered-question-driven evidence seeking).

SUPPORTING, NOT PEER FACULTIES: Perception; open cognitive items;
Expression/Rendering; Recall as the Memory/Evidence retrieval surface.

BOUNDARY / CONTROL: Authority; Capability; Sandbox; Honesty; Evaluation;
Stewardship; External Effect; Attention as resource admission, not salience.

PERSISTENCE / EVIDENCE: Memory/Evidence; Continuity.

INFRASTRUCTURE: Operational Continuity; Context Budget; Model Fabric;
Observability; future typed Event Spine only if later earned (not current).

# 4. Source-Family Currentness / Disposition Inventory

Disposition of every immediate child of `apps/agent-service/src/core/`, from static
import reachability off the production roots (§5), not directory names.

| Family | Disposition | Evidence (importer / reachability) |
|---|---|---|
| agency | CURRENT_OBSERVE_ONLY | Only `server.ts` `listRecentDecisions` for `GET /nuclear/decisions`; candidate-selection never imported by a production root |
| attention | CURRENT_MECHANISM | `mistral-client` attention index on every `completeChat`; `runtime.ts` ledger/governor; 2282 production requests |
| change-proposal | CURRENT_MECHANISM | `runtime.ts` store/lifecycle; `server.ts` `/nuclear/change-proposals`, `/identity/proposals`; 0 production rows (mechanism live, unused) |
| cognition | HISTORICAL_RETAINED | Only `db.ts` migrations 23/24/25 + schema contract; live `live.ts/run.ts` never imported by production roots |
| cognitive-graduation | CURRENT_OBSERVE_ONLY | Only `server.ts` `getCognitiveGraduationDiagnostics` for `GET /nuclear/cognitive-graduation`; diagnostics hardcode influence `authorized/executed/delivered: false`; calibration table classified SHADOW_ARTIFACT; `dark_apply` is fixture-only per contract-state |
| cognitive-v021 | CURRENT_RUNTIME_OWNER | `agent.ts` `runLiveCognitiveTurn`; kernel `v021`; `serve.ts` inbox-consumer/frontier/live-operations |
| context-allocation | HISTORICAL_RETAINED | Only `import type ContextBudgetMode` + `db.ts` migration-36; live render path is `conversation/*` |
| continuity | CURRENT_MECHANISM | `runtime.ts` registry/sessions/forget-preview/db; `server.ts` `getContinuityFor`; 182 production sessions |
| conversation | CURRENT_SUPPORTING_MECHANISM | `thought/run.ts` + `live-expression.ts` render paths; legacy `/chat/text` retired (`gone`) |
| curiosity | CURRENT_MECHANISM | `agent.ts` `scanConfiguredSources` / `performGroundedReads` / `listRecentTakes` in idle provider; `/curiosity/status` live, `/curiosity/tick` gone |
| delivery | CURRENT_MECHANISM | `runtime.ts` store/finalize/abort-registry; `server.ts` `/delivery/claim receipt finalize`; fulfillment pump live |
| external-agency | CURRENT_BUT_GATED | `runtime.ts` lifecycle/emergency-stop/store; `server.ts` `/nuclear/external/*`; 0 production rows; fake adapter undeployed per Architecture Index |
| honesty | CURRENT_SUPPORTING_MECHANISM | Live via `cognitive-v021/authority/currentness-detectors` + `speech/fidelity`; legacy conversation path retired |
| identity | CURRENT_MECHANISM | `runtime.ts` identity/classification; `server.ts` identity reviews/proposals; 8 stable production entries |
| learned-autonomy | CURRENT_OBSERVE_ONLY | `server.ts` `assertC3ContractCompatible` / `listActiveLearnedInfluences` for diagnostics; maturation contract c2/c3/c4/c5 all `observe` in production |
| learning | CURRENT_OBSERVE_ONLY | `runtime.ts` revisions path present; `learning` release is `observe`; 0 production revisions |
| memory | CURRENT_MECHANISM | `runtime.ts` facts/threads/forget/cutover/activation; `server.ts` episodes/corrections/fanout; v021 memory admission + nomination |
| model-fabric | CURRENT_MECHANISM | `agent.ts` `resolveDispatchPolicy`; `mistral-client` receipts + hash; `thought/run` receipts |
| model-routing | CURRENT_MECHANISM | `agent.ts` `routeReady`; `mistral-client` adapters/router; `server.ts` `/nuclear/routing`; 138 provider-responded attempts |
| perception | CURRENT_SUPPORTING_MECHANISM | `serve.ts` `sweepExpiredArtifacts`; Thought perception is `cognitive-v021/perception/adapter`, not this family |
| privacy | CURRENT_SUPPORTING_MECHANISM | `agent.ts` `detectCredentialShape`; `server.ts` classification types |
| provenance | HISTORICAL_RETAINED | Only `db.ts` migrations 21/22 DDL; zero live imports outside `db.ts` |
| qualification | CURRENT_TEST_OR_QUALIFICATION_ONLY | Zero non-test imports; only `*.test.ts` helpers/mocks |
| reflection | CURRENT_OBSERVE_ONLY | `runtime.ts` initiative-reflection; `server.ts` `/nuclear/reflections`; `ASHLEY_REFLECTION_MODE=observe`; 3 production events, all Aug `initiative_reaction` |
| relationship | CURRENT_BUT_GATED | C5 maturation `c5=observe`; social-authority + room-seeding live; commitment chain gated separately by `RA_COMMITMENTS` (fail-closed, unset in prod — not a C5 gate); all commitment/tension/repair tables 0 rows |
| rollout | CURRENT_BUT_GATED | `server.ts` capabilities + C1 epoch; `capabilityCanInfluence` gate; promotion needs owner + qualification |
| sandbox | CURRENT_BUT_GATED | V2 via `serve.ts` live-operations (v2-execution + opencode worker); V1 `/sandbox/*` routes all `gone`; nuclear `sandbox_task_admissions` dead since Aug 30 (1016 refused) |
| state | CURRENT_SUPPORTING_MECHANISM | `runtime.ts` affect/mind-items/own-time feed overviews; no independent authority |

Other trees: `apps/discord-bot/src/` (ingress HTTP client, channel queue, proactive
scheduler, fulfillment pump — process boundary, no `core/` import);
`apps/observer-exporter/` (tooling, not cognition); `apps/sandbox-m1/`,
`apps/sandbox-tree/`, `apps/sandbox-policy/` (M-series retained machinery, see §14);
`apps/sandbox-v2/` (current V2 dispatcher/inspection/workspace/verification/
authorship/export/operate; zero broker files); `packages/` (shared types only).

# 5. Production Root Reachability Map

Proven by static imports. A file existing is not reachability; a test importing it
is not production reachability.

- `bootstrap/production.ts` reaches: `AgentManager` + production data plane only.
  All cognition is transitive through the manager.
- `server.ts` reaches: cognitive ingress/HTTP (inbox + fence), v021 commands
  (remember/forget), settlement recheck (`recheckExternal`,
  `recheckOwnerPublicationReservation`), delivery claim/receipt/finalize,
  outbox projector, periodic diagnostics + operator status, memory, relationship
  (C5 + social authority), reflection overview, rollout capabilities, learned
  autonomy + graduation diagnostics (observe surfaces), continuity, privacy.
  Retired to `gone()`: `/chat/text`, `/chat`, `/jobs`, `/engineering`, `/habits`,
  `/scheduler`, `/actions`, `/sandbox/*`, `/initiative/tick,commit,abort,evaluate,generate`.
- `agent.ts` reaches: `runLiveCognitiveTurn` (the live Thought turn),
  inbox append/claim/consume, outbox-projector reconcile, idle tick
  (`tickIdleOpportunity` + `isPeriodicCognitionEnabled` gate), curiosity
  scan/reads/feed, memory threads, dispatch policy + route readiness.
- `core/runtime.ts` (`AshleyCore`) reaches: nuclear delivery store/finalize,
  proactive eligibility + initiative reservations, curiosity status, memory,
  relationship C5, reflection reactions, rollout, continuity, attention,
  identity classification, change-proposal lifecycle, external-agency lifecycle.
  It does NOT directly import cycle/inbox/Thought/settlement — those live under
  `cognitive-v021/` via `serve.ts`/`agent.ts`.
- `cognitive-v021/index.ts` (barrel) re-exports cycle, speech, delivery,
  initiative (idle, future-triggers, subscriptions, eligibility), settlement,
  thought (run, input, capability-reality), perception, retrieval, evidence,
  concerns, authority, observation, memory, commands, identity, relationship,
  private-budget, dispatch. Curiosity, reflection, and sandbox are callers or
  providers, not barrel members.
- `dispatch/live.ts` reaches: `runCognitiveCycle`, outbox projector, wake/cycle
  fence with single-active claim, private-budget binding, deferred-frontier
  ledger, DM activation gate.
- `thought/run.ts` reaches: cycle/inbox/admission, memory admission + governed
  catch-up, authority check + barrier, effect proposal/dispatch, perception
  adapter, settlement validate + publish, speech fidelity + infrastructure
  notice, relationship commitment admission + social authority, room/DM
  activation, future-triggers, subscriptions, public presence, model-fabric
  receipts. No direct curiosity or reflection import.
- `settlement/publish.ts` reaches: authority barrier, speech outbox insert,
  interim recheck, delivery reserve, license consume, working context, desk,
  concerns lineage + occupancy, memory nomination, observation subscriptions,
  future-triggers, source-currentness. Imports `getSystemNotice` but never calls
  it (dead import, noted; system-notice reads go through keyed getters).
- `discord-bot/index.ts`: no `core/` import (process boundary).
- `discord-bot/agent-client.ts` HTTP-reaches: ingress, delivery
  claim/receipt/finalize/recheck, initiative idle/pause/resume/status, memory,
  nuclear identity/relationship/continuity/status, public presence, signals,
  health. No curiosity, capability, or sandbox endpoint is called.
- `discord-bot/handlers/messageCreate.ts` reaches admission/cycle only via
  `POST /chat/ingress` (owner) and `/chat/ingress-external*` (gated externals).
- `discord-bot/initiative/scheduler.ts` reaches periodic only:
  `tickCognitiveIdle → POST /initiative/idle`. It never sends Discord directly.
- `discord-bot/initiative/fulfillment-pump.ts` reaches delivery only:
  claim → target gate → recheck → send → receipt → finalize. No other subsystem.

# 6. Behavioral Journey Maps

Actual current names are used throughout. Classifications live in §7; journeys
here state what happens and where the owner boundary is crossed.

A. Owner reactive conversation. Discord owner message → `messageCreate` →
`POST /chat/ingress` → inbox append (154 events) → claim → wake (146) → cycle
admit (146, all `owner_message`) → `runLiveCognitiveTurn` → Thought input
(context composer, evidence log, recall, occupancy, identity, capability
reality) → 167 thought steps (118 settlement, 41 failure, 7 observation_request,
1 abstain) → `publishSemanticTransaction` → speech_outbox pending (108) →
nuclear reservation (352) → fulfillment-pump claim → publication recheck →
Discord bubbles (427) → receipt → finalize committed (323). Terminal `silent`
state: 145 (`silent` state, but disposition NULL on all 146 cycles, so intentional
vs technical/preempted/deferred silence is indistinguishable in production — see
E10). One cycle still `sending`. Failure branch: Thought
failure → `emitInfrastructureNotice` → system_notice_outbox (37) → separate
system recheck (P0) → delivery or terminal `send_failure` (7, terminal, kept).

B. Durable unanswered-message recovery. 147 inbox events consumed; 7 went
`failed_terminal`/`quarantined` (4 legacy `permanent_failure` Aug 30, 1
`age_exhausted` Sep 4, 1 `age_exhausted` Sep 11, 1 `attempts_exhausted`
`transient_retryable` Sep 17). The 7 obligations were never answered. A repair
seam exists in source (`repair_of_event_id`, `durable_work_repairs`) with zero
production use. Five inbox wakes from Sep 3–4 sit `pending`, never consumed
across the Sep 18 restart — the recovery trigger that should claim them never
fires. Two deferred reactive frontiers are `exhausted` (terminal). Verdict per
step: discoverable YES (rows exist), preserved YES, wake NO (stale pending),
current context N/A, truthful acknowledgment NO, answer NO, duplicate-reply
avoidance YES (fence + idempotency, vacuously).

C. Recall/memory. Canonical evidence (670 sidecar rows; 335 owner + 305 ashley
delivered + 30 system) → nomination path exists in `publish.ts` but
`durable_nominations=0`, `admission_log=0`: governed admission never fired in
production. 92 sidecar assertions exist with `live=0` (all `owner_world_claim`);
92 nuclear `memory_assertions` (87 supported I0, 5 uncertain I0) mirror them with
92 supports. Retrieval runs through the derived FTS index + recall cutover to
`ashley-capability-v3` (Aug 27); recall release is `active`. Direct `mem_*`
reads are superseded (facts 0; threads 19; messages 570 historical). Whether a
live assertion has ever entered a production Thought input could not be
established: NEEDS_LIVE_WITNESS, not a defect finding.

D. Concern/occupancy. Thought emits `concernDeltas`/`occupancyDeltas`
(output-contract schema, parse validation, run materialization) → settlement
fence → `applyConcernDelta`/`applyOccupancyDelta` → `concerns`/`mind_occupancy`
→ `buildOccupiedConcernProjection` → Thought input enrichment + periodic
eligibility. Source-proven and test-proven (Wave A `3a5ee62`). Production: 4
concerns + 4 occupancy rows, ALL `quarantined`, ALL `legacy:concern:1..4`
(M3-workshop-era statements), ALL `legacy-import`. Zero live rows. 21/21
periodic receipts `skipped_empty`. The seam is complete but has never carried a
live concern in production.

E. Periodic proactivity. Cheap scheduler → `POST /initiative/idle` →
`readSchedule` (`ashley-periodic-v1`, epoch 1, ticking through Sep 18) →
inquiry gate → occupancy (quarantined/empty), triggers (0 rows), subscriptions
(0 rows), acquisition, commitments (0 rows, RA-gated) → always `skipped_empty` (21/21, zero wakes). Operator
status (`/initiative/status`, Wave B `c256d52`) reads current owners (schedule,
occurrence diagnostics, occupancy projection, last owner evidence, enabled
flag, active thread) and no longer reads legacy `scheduled_proactive_messages`;
the endpoint is auth-gated (production returned `forbidden` unauthenticated, as
designed), so its rendered output has no production witness. `PROACTIVE_ENABLED`
is true and the tick is witnessed; periodic cognition working (a wake with
speech) is not.

F. Curiosity. 69 configured sources → scan → grounded reads (358, fresh through
Sep 17, including Sep 17 batches) → takes (228, ALL `provenance=shadow`, latest
Aug 30) → questions (44) → consolidation (observe; `curiosity_consolidation`
release `observe`; `CURIOSITY_ENABLED=false` in production). Takes feed nothing
live: no take has ever left shadow, and no take has been produced since Aug 30
while reads continue. Shadow/observe-only by current gating, not by accident.

G. Reflection/learning. Only 3 production reflection events, all
`initiative_reaction` from early Aug; no reactive, proactive, operation,
delivery, failure, or cancellation outcome has been recorded since.
`thought_calibration_adjustments=0`: the writer primitive
(`recordThoughtCalibrationAdjustment`) has no non-test callers, so no
adjustment has ever been recorded, and none feeds later Thought (no Thought
consumer exists in source; `dark_apply` eligibility is fixture-only).
`ASHLEY_REFLECTION_MODE=observe`. Learning revisions 0, identity
reviews 0, `learning` release `observe`. Observe-only by design; the missing
producer and consumer are not seams to wire.

H. Relationship/commitments. Self-commitments 0, mutual 0, settlements 0,
interaction contracts 0, consent 0, tensions 0, repair family 0, projections 0.
Maturation contract `c5=observe` (does not participate in this path). The full
chain exists and is test-proven: Thought draft proposals → persist + settle
(`run.ts:3451-3452`) → due-read (`idle.ts:855-861`) → `commitment_due` wake
(`idle.ts:587-609`) → `commitmentDue` projection into Thought
(`input.ts:114`, `projection.ts:93`); production even passes `commitmentDb`
(`agent.ts:198`). The single operative gate is `RA_COMMITMENTS`, fail-closed
and unset in production, holding shut BOTH row admission (settle `enabled`)
AND due-read/wake (idle `isCommitmentsEnabled`). 0 rows. Gated, not absent;
not a C5-graduation effect. Live relationship
surfaces are only social-authority/room-seeding (1 room conversation captured
Sep 16; room publication configured). External-DM cognition path has no rows.

I. Capability projection. `capability_releases` → `capabilityCanInfluence` →
`getCapabilityReality` → `thoughtOperationCapabilities` → Thought input →
structural validation → Host admission → executor → receipt → continuation.
Projected today: `project.read_file`, `project.list_directory`,
`project.search_text` (inspection-gated), `project.investigate` (delegated,
gated), `workspace.verify` (gated), `patch_export` (gated), `candidate.develop`
(iterative-engineering-gated). Generic M6 is absent from the projection by
explicit `false` (§18). Live witnesses: 4 project-inspection observations,
11 engineering runs, 2 patch exports, 12 proposed changesets (all Aug,
pre-cutover workshop scope).

J. Direct project inspection. Thought inspection operations → V2 host adapter →
Bubblewrap (`/usr/bin/bwrap` present) → typed read → receipt → Thought as tool
observation. 4 production observations, all `sandbox-v2:project-inspection`,
all consumed into September cycles. L1-direct path live; OpenCode quota
independent (test-locked).

K. Async project investigation. Thought A → `admitDetachedOperation`
(`admitted`) → interim speech authorize (`operation_interim_outbox`, `pending`)
→ worker → terminal → completion event → Thought B resume. Fail-closed:
no hook / unavailable seam / dispatch throw all yield `published:false` +
`OPERATION_DISPATCH_FAILED` with zero detached rows and no observation call
(Wave C `ee420b7`, test-proven). Production: 0 detached operations, 0 interim
rows. No natural owner witness exists.

L. Candidate workspace engineering. Iterative-engineering-gated
`candidate.develop`; M5 authorship machinery present; OpenCode Mode-B worker
enabled and pinned (1.18.30) with fail-closed admission and quota truth (Wave
`966f625`/`cd482e8`). Production: 0 Mode-B uses; 12 `proposed` changesets and
11 engineering runs are Aug (pre-cutover) records, not current-path witnesses.

M. Verification/authorship/export. `candidate_verification` active;
`typescript_fixture_compile_v1` recipe allowed; authorship allowed in registry;
`patch_export` active with 2 Aug exports. Authorship is not apply, patch export
is not commit/push/deploy, proposal is not authority: all preserved in current
source; `change_proposals` 0 rows in production (no live proposal traffic).

N. Delivery and system notices. Reactive lane (338 reservations, 323 committed),
operational_fulfillment lane (13; 8 stuck `sending` since Aug 24; 2 committed
Aug 25), proactive lane (1 committed Aug 26), system-notice lane (30 delivered
pre-fix; 7 terminal `send_failure` Sep 17; 0 post-fix), interim lane (0 rows),
room lane (capture witnessed; room delivery unwitnessed), external/public
lanes (0 rows, intentionally dark). Four reactive reservations + one speech row
stuck `sending` since Sep 15 across the Sep 18 restart: the startup recovery
that should reconcile them has no observable effect on them.

O. Forgetting. Mechanism present (`runtime.ts` forget paths, continuity
forget-preview/tombstones schema, `forget_receipts` table). Production: 0
forget receipts, 0 tombstones. Never exercised; correctly not a defect.

P. Provider/model dispatch. `routeReady` + `resolveDispatchPolicy` → attempt →
138 `provider_responded`, 9 `transient_retryable`, 3 `not_started`, 2
`outcome_unknown_reconcile` → receipts/diagnostics → Thought result or Thought
failure notice. Attention ledger admits every turn (2282 requests). Failover
evidence exists; the two `unknown` reconciliations and the Sep 17
`attempts_exhausted` inbox row are the current failure tail.

Q. Crash/restart recovery. Continuity: 182 sessions, 6 clean shutdowns vs 175
unclean. Inbox durability witnessed (154 events survive), delivery ledger
survives, causal ledger (144) survives, schedule + pending state survive. What
does NOT re-enter a semantic owner after restart: 5 pending wakes (Sep 3–4),
4+1 stale `sending` delivery/speech rows, 7 quarantined inbox obligations.
Recovery code exists (`retry/startup-outcome-recovery`, frontier ledger) and is
source-reachable; its production effect on exactly these rows is unobserved.

# 7. Wiring Edge Ledger

Columns: ID / Behavior / Producer / Contract-state / Consumer / Owner boundary /
Gates / Source / Tests / Production / Classification / Review flag.
`S`=source proof file, `T`=test proof, `P`=production witness. `—` means none
established. One classification per edge from the exact §8 vocabulary.

| ID | Behavior | Producer | Contract / state | Consumer | Owner boundary | Gates | S | T | P | Classification | Review flag |
|---|---|---|---|---|---|---|---|---|---|---|---|
| E01 | Owner message admitted to inbox | discord-bot `messageCreate` → `POST /chat/ingress` | `inbox_events` owner_utterance | inbox claim | Discord → Cognition (admission) | gateway admission, fence | ingress/http.ts | ingress tests | 154 rows, 147 consumed | LIVE_WITNESSED | — |
| E02 | Inbox claim → wake → cycle | inbox-consumer | `wakes`, `cycle_records` | `runLiveCognitiveTurn` | Agency → Thought | single-active claim, authority epoch | dispatch/live.ts | live.test.ts | 146 wakes, 146 cycles | LIVE_WITNESSED | — |
| E03 | Cycle → Thought input build | Thought input composer | working context, evidence, recall, occupancy, identity, capability reality | Thought kernel | Evidence → Thought | source-currentness fence | thought/input.ts, run.ts | run tests | 167 thought steps | LIVE_WITNESSED | — |
| E04 | Thought → settlement → speech pending | `publishSemanticTransaction` | `speech_outbox` pending + `settlements` | delivery projector | Thought → Delivery | barrier, generation fence | settlement/publish.ts | publish tests | 108 outbox, 110 settlements | LIVE_WITNESSED | — |
| E05 | Speech → reservation → Discord send | outbox projector + fulfillment pump | `delivery_reservations` + bubbles | Discord channel | Delivery → Rendering | publication recheck per bubble | delivery/pending.ts, fulfillment-pump.ts | pump tests | 103 delivered, 427 bubbles | LIVE_WITNESSED | — |
| E06 | Bubble receipt → finalize | fulfillment pump | `delivery_bubbles` discord ids | nuclear finalize | Rendering → Delivery truth | lease, idempotency | delivery finalize | pump tests | 323 committed `all_bubbles_delivered` | LIVE_WITNESSED | — |
| E07 | Thought failure → system-notice write | `emitInfrastructureNotice` | `system_notice_outbox` send_status | pre-P0 system recheck (E61) → pump; current recheck E08 | Thought → System notice | idempotent notice_key | speech/infrastructure-notice.ts | Wave-D tests | 37 writes; 30 delivered + 7 failed, ALL via pre-P0 path (res ≤351); current-path delivery unwitnessed, see E08 | LIVE_WITNESSED | — |
| E08 | Post-P0 system recheck ownership | `recheckOwnerPublicationReservation` key router | `system:` truth, never speech_outbox | pump Owner recheck | System-notice owner vs speech owner | cycle fence, dispatch basis | settlement/publish.ts:1423 | Wave-D fixture (048325c) | NONE (no post-fix notice) | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E09 | Refusal branch | Thought | refusal settlement / speech | delivery | Thought → Delivery | policy | run.ts (unverified) | — | NONE found in v021 | UNKNOWN | NEEDS_SOURCE_RECONCILIATION |
| E10 | Thought silence → silent cycle (intent unwitnessed) | Thought (`markIntentionalSilence` + technical/preempt/defer paths) | `cycle_records` state + disposition (13-valued enum) | — (no delivery) | Thought → (none) | semantic choice; fence preemption | cycle/inbox.ts:62-75 enum, :686 intentional path | freshness.test.ts:217,235 | 145 state=`silent` BUT disposition NULL on all 146 cycles — intentional vs technical/preempted/deferred indistinguishable | LIVE_SOURCE_ONLY | NEEDS_PRODUCTION_WITNESS |
| E11 | Provider retry/failover | model dispatch | `durable_work_attempts` | Thought result or failure notice | Model Fabric → Thought | per-leg 300s budget | mistral-client, live-operations | dispatch tests | 138 responded, 9 transient retry | LIVE_WITNESSED | — |
| E12 | Partial delivery handling | pump | `partially_delivered` status | finalize | Delivery truth | bubble receipts | fulfillment-pump.ts | — | NONE (value never observed) | UNKNOWN | NEEDS_PRODUCTION_WITNESS |
| E13 | Stale `sending` rows never reconciled | settlement/pump writers | 4 reactive + 8 operational `sending`, 1 speech `sending` | startup-outcome-recovery (never claims them) | Delivery → Operational Continuity | lease/recovery trigger | retry/startup-outcome-recovery | — | rows persist across Sep 18 restart | PRODUCER_ORPHANED | OWNER_SOL_REVIEW_REQUIRED |
| E14 | Failed inbox → quarantine terminal | inbox consumer | `failed_terminal`/`quarantined` | — (terminal) | Agency → quarantine | attempts/age/permanent classes | cycle/inbox | inbox tests | 7 rows, 0 ever answered | LIVE_WITNESSED | — |
| E15 | Quarantine → repair → Thought | quarantined rows | `repair_of_event_id`, `durable_work_repairs` | repair consumer | Quarantine → Cognition | repair trigger (never called) | operation repair refs | — | 0 repairs | SOURCE_PRESENT_EDGE_ABSENT | OWNER_SOL_REVIEW_REQUIRED |
| E16 | Stale pending wakes | wake ledger | 5 `pending` inbox wakes Sep 3–4 | inbox consumer (never claims) | Agency → Thought | lease/claim | wake/ledger.ts | — | pending across restart | PRODUCER_ORPHANED | OWNER_SOL_REVIEW_REQUIRED |
| E17 | Exhausted deferred frontiers | frontier ledger | 2 `exhausted` rows | — (terminal) | Agency → quarantine | exhaustion | frontier/ledger.ts | frontier tests | 2 rows | LIVE_WITNESSED | — |
| E18 | Thought → concern persistence | Thought deltas | `concerns` via `applyConcernDelta` | occupancy/projection | Thought → Mind State | settlement fence | concerns/lineage.ts, publish.ts:341 | run.test.ts (Wave A) | 0 live rows (4 quarantined legacy); edge present in source, natural witness absent | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E19 | Occupied projection → Thought | `buildOccupiedConcernProjection` | `mind_occupancy` + concerns | Thought input + periodic eligibility | Mind State → Thought | eligible statuses only | thought/occupied-concerns.ts, input.ts | occupied-concerns.test.ts | 0 live rows, projection empty in prod; edge present in source, natural witness absent | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E20 | Periodic tick always skips empty | scheduler → idle → schedule evaluate | `periodic_cognition_occurrence_receipts` | — (no wake) | Agency → (none) | inquiry gate, epoch | initiative/periodic-schedule.ts | periodic-schedule.test.ts | 21/21 `skipped_empty` thru Sep 18 | LIVE_WITNESSED | — |
| E21 | Periodic admit on live concern | `evaluatePeriodicPoll` admit_runnable | future wake + Thought | proactive Thought | Mind State → Agency | occupancy/triggers/commitments | initiative/eligibility | run.test.ts (Wave A) | NONE (no live concern ever) | CONSUMER_ORPHANED | OWNER_SOL_REVIEW_REQUIRED |
| E22 | Scheduler → idle endpoint tick | discord scheduler | `POST /initiative/idle` | `tickCognitiveIdle` | Discord-bot → Agent | `isPeriodicCognitionEnabled` | scheduler.ts, server.ts | scheduler tests | receipts ticking Sep 18 | LIVE_WITNESSED | — |
| E23 | Truthful proactive status | `buildProactiveOperatorStatus` | `GET /initiative/status` | `/proactive status` render | Agent → Operator | auth | initiative/operator-status.ts | operator-status.test.ts | NONE (endpoint auth-gated; no output witness) | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E24 | Proactive speech → delivery | proactive Thought/commission | proactive-lane reservation | pump → Discord | Thought → Delivery | publication eligibility | publish + pump | pump tests | 1 proactive committed Aug 26 (+2 operational Aug 25) | LIVE_WITNESSED | — |
| E25 | Legacy nuclear initiative path | old reservations/diagnostics | `initiative_reservations`, kv diag | legacy proactive send | (superseded owner) | — | runtime legacy | — | last Aug 26; diag stale Aug 30 | SUPERSEDED_EDGE | LIKELY_STALE_MACHINERY |
| E26 | Future triggers → wake | Thought/publish | `future_triggers` (0 rows) | periodic evaluation | Thought → Agency | due/snapshot | initiative/future-triggers | — | 0 rows, 0 wakes | LIVE_SOURCE_ONLY | OWNER_SOL_REVIEW_REQUIRED |
| E27 | Observation subscriptions → poll → Thought | subscription writer | `observation_subscriptions` (0 rows) | poll/ingest/frontier | External → Thought | poll interval, expiry | observation/subscriptions | — | 0 rows | LIVE_SOURCE_ONLY | OWNER_SOL_REVIEW_REQUIRED |
| E28 | Commitment proposal → admission → due → wake → Thought | Thought draft `commitments.commitmentProposals` (run.ts:3444) | `ashley_self_commitments` / opportunities (0 rows) | idle due-read → `commitment_due` wake → `commitmentDue` projection → Thought | Relationship → Agency → Thought | `RA_COMMITMENTS` fail-closed (unset→false in prod); C5 observe does NOT participate | run.ts:3451-3452, idle.ts:855-861 + 587-609, input.ts:114, projection.ts:93 | commitment-admission.test.ts, idle.test.ts:157-176 | 0 rows; `agent.ts:198` passes commitmentDb live; settle + due-read gates closed | WIRED_BUT_GATED | OWNER_SOL_REVIEW_REQUIRED |
| E29 | Curiosity scan → grounded read | `scanConfiguredSources` + reads | `cur_reads` (358) | takes/questions | Curiosity → Evidence | source config | curiosity/sources, reads | curiosity tests | reads fresh Sep 17 | LIVE_WITNESSED | — |
| E30 | Reads → takes (shadow only) | consolidation | `cur_takes` (228, all shadow) | questions/proposals | Curiosity → Curiosity | shadow provenance | curiosity/feed | — | latest take Aug 30; all shadow | WIRED_OBSERVE_ONLY | LIKELY_INTENTIONAL_BOUNDARY |
| E31 | Takes → consolidation → influence | consolidation | takes/questions/proposals | Thought/initiative | Curiosity → Thought | `CURIOSITY_ENABLED=false` | curiosity/current-activity | — | 0 live takes | WIRED_BUT_GATED | LIKELY_INTENTIONAL_BOUNDARY |
| E32 | Curiosity → concern/initiative/proactive | takes/questions | concern/trigger/eligibility | Thought, Agency | Curiosity → Cognition | disabled + observe release | — (no writer) | — | NONE | INTENTIONALLY_DARK | LIKELY_INTENTIONAL_BOUNDARY |
| E33 | Evidence → memory nomination | `publishSemanticTransaction` nomination | `durable_nominations` (0) | governed admission | Thought → Memory | nomination gate | settlement/publish.ts (import) | — | 0 nominations, 0 admission_log | LIVE_SOURCE_ONLY | NEEDS_PRODUCTION_WITNESS |
| E34 | Non-live assertions accumulate | migration/admission writers | 92 sidecar assertions `live=0` | — (no live reader) | Memory → (none) | live flag | memory/admission | — | 92 rows, none live | PRODUCER_ORPHANED | OWNER_SOL_REVIEW_REQUIRED |
| E35 | Recall retrieval → Thought | derived FTS + cutover | retrieval projection | Thought input | Memory → Thought | recall release active | retrieval/derived-store | recall tests | indirect only (threads, FTS) | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E36 | Direct mem_* → Thought | legacy readers | `mem_facts/threads/messages` | Thought | Memory → Thought | recall cutover v3 | memory/* legacy | — | facts 0; msgs 570 historical | SUPERSEDED_EDGE | NEEDS_SOURCE_RECONCILIATION |
| E37 | Forgetting → retraction/rebuild | forget paths | `forget_receipts` (0) | dependents | Memory → Memory | owner authority | memory/forget, continuity tombstones | — | 0 receipts | LIVE_SOURCE_ONLY | — |
| E38 | Identity state → Thought | constitution projection | 8 stable entries | Thought input | Identity → Thought | governance (ordinary vs foundational) | serve.ts KernelDeps identity/constitution | — | entries exist; projection unwitnessed | LIVE_SOURCE_ONLY | NEEDS_PRODUCTION_WITNESS |
| E39 | Ordinary preference/opinion growth | learning writers | `opinions` (6), revisions (0) | Thought | Identity → Thought | `learning` release observe | learning/revisions | — | 0 revisions | WIRED_OBSERVE_ONLY | LIKELY_INTENTIONAL_BOUNDARY |
| E40 | Historical learning machinery | old learning paths | historical tables | — (unreached) | (retired owner) | — | learning/* hist | — | 0 rows | LEGACY_DEAD_EDGE | LIKELY_STALE_MACHINERY |
| E41 | Outcomes → Reflection | outcome writers | `reflection_events` (3, Aug only) | Reflection (observe store/diagnostics) | Delivery/Thought → Reflection | observe mode | reflection/initiative | — | 3 `initiative_reaction`, nothing since | WIRED_OBSERVE_ONLY | LIKELY_INTENTIONAL_BOUNDARY |
| E42 | Graduation calibration → later Thought | writer primitive `recordThoughtCalibrationAdjustment` (zero non-test callers) | `thought_calibration_adjustments` (0) | — (no Thought consumer in source) | Graduation → (withheld) | `dark_apply` fixture-only; live `apply` throws; persisted contract observe; table SHADOW_ARTIFACT | calibration.ts:181-210, contract-state.ts:33-48 | c4-future-only.test.ts, settlement.test.ts:82 | 0 rows; diagnostics hardcode influence false | INTENTIONALLY_DARK | OWNER_SOL_REVIEW_REQUIRED |
| E43 | C5 relationship → live behavior | C5 machinery | commitments/tensions/repair (all 0) | Thought/Agency | Relationship → Thought | c5=observe, unpromoted | relationship/* | — | 0 rows everywhere | INTENTIONALLY_DARK | LIKELY_FUTURE_PHASE |
| E44 | Room capture → social conversation | ingress-external batch | `social_conversations` (1 room) | Thought (room ctx) | Room → Cognition | RA_ROOM_SEED_ACTIVE, capture gate | ingress/http.ts:746 | — | 1 room row Sep 16 | LIVE_WITNESSED | — |
| E45 | External-DM cognition | dm-activation | wakes/cycles for DM | Thought | External → Cognition | DM principal allowlist | social/dm-activation | — | 0 DM rows | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E46 | Release → reality → Thought offer | rollout + `getCapabilityReality` | `operationCapabilities` | Thought choice | Capability → Thought | `capabilityCanInfluence`, qualification | thought/capability-reality.ts | capability-reality.test.ts | inspection/investigate/verify/authorship/export live | LIVE_WITNESSED | — |
| E47 | Availability vs authority split | registry/helper layer | helper truth vs Thought truth | Host vs Thought | Sandbox → Capability → Thought | distinct gates per layer | project-registry.ts vs capability-reality.ts | M6-dark test | M6 helper-true/Thought-false both hold | LIVE_WITNESSED | — |
| E48 | Lower-level M6 readiness helper | `canOfferBoundedOperation` | release+lifecycle+substrate+registry | (no Thought consumer) | Sandbox → Capability | engineering lifecycle, operationAllowed | sandbox/project-registry.ts:254 | capability-reality.test.ts setup | inputs all true in prod (computed, not executed) | LIVE_SOURCE_ONLY | — |
| E49 | Thought-facing M6 offer withheld | `getCapabilityReality` | `canOfferBoundedOperation:false` | Thought (absent) | Capability → Thought | explicit hard false | capability-reality.ts:303 | M6-dark test:208 | 0 M6 ops since cutover | INTENTIONALLY_DARK | LIKELY_INTENTIONAL_BOUNDARY |
| E50 | Bounded execution without Thought offer | `executeBoundedOperationV2` | `bounded_operation_tasks/steps` | worker/steps | Host → Sandbox | owner id, deadline, operationAllowed | sandbox/bounded-operation-execution.ts | — | 10 tasks Aug (workshop scope), 0 since | WIRED_BUT_GATED | OWNER_SOL_REVIEW_REQUIRED |
| E51 | L1 direct inspection → observation | live-operations dispatch | `observations` tool rows | Thought continuation | Sandbox → Thought | inspection allowlist | dispatch/live-operations.ts | live-operations tests | 4 project-inspection observations Sep | LIVE_WITNESSED | — |
| E52 | Async investigate → interim → Thought B | detach/dispatch/completion | `detached_operations`, interim outbox | Thought B resume | Thought → Sandbox → Thought | fail-closed, single-active | operation/detached.ts, dispatch.ts | detach-investigate.test.ts | 0 detached, 0 interim | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E53 | Mode-B candidate worker | opencode worker adapter | worker binding, quota truth | Thought (via dispatch) | Sandbox → Thought | worker enabled+pinned, fail-closed | sandbox-v2 opencode adapter | Mode-B qual tests | enabled 1.18.30, 0 uses | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E54 | V1 broker paths | (removed) | broker socket/envelopes | — | (retired topology) | `BROKER_ENABLED=false` | — (zero broker files) | negative guard test | V1 tables unread; socket absent | LEGACY_DEAD_EDGE | LIKELY_STALE_MACHINERY |
| E55 | Route → model → Thought | `routeReady` + dispatch policy | provider attempt + receipt | Thought result | Model Fabric → Thought | alias, quota, deadline | model-routing/router, model-fabric/activation | router tests | 138 responded; provider configured | LIVE_WITNESSED | — |
| E56 | Attention admission per turn | attention ledger/governor | `attention_requests` (2282) | Thought + dispatch | Attention → Thought | quota bucket | attention/*, mistral-client | attention tests | 2282 rows, latest Sep 17 | LIVE_WITNESSED | — |
| E57 | Model-fabric receipts → diagnostics | fabric hashing | allocation/dispatch receipts | observability, Thought | Fabric → Observability | — | model-fabric/receipts, thought/run | — | allocation_receipts present | LIVE_SOURCE_ONLY | — |
| E58 | Mind-state items → Thought | state provider | `mind_state_items` (12 nuclear) | Thought input | Mind State → Thought | — | state/mind-items | — | items exist; projection unwitnessed | LIVE_SOURCE_ONLY | NEEDS_PRODUCTION_WITNESS |
| E60 | Interim speech lane | interim authorizer | `operation_interim_outbox` (0) | pump recheck | Thought → Delivery | interim recheck (never cancels op) | operation/interim.ts | detach tests | 0 rows | NEEDS_LIVE_WITNESS | NEEDS_PRODUCTION_WITNESS |
| E61 | System-notice lane delivery (pre-fix path, superseded) | notice recheck (legacy path) | notice rows → reservations | pump → Discord | System notice → Delivery | pre-P0 ownership | publish.ts (pre-ccfbee7) | — | 30 delivered (res 208–261); path superseded by E08 | LIVE_WITNESSED | — |
| E62 | Owner-room delivery | room recheck | room reservations | pump → room | Delivery → Room | room publication target | publish.ts room path | — | capture yes; delivery unwitnessed | UNKNOWN | NEEDS_PRODUCTION_WITNESS |
| E63 | External/public delivery | external reserve | `external_actions` (0) | provider/adapter | External Effect → world | credentials, account, release | external-agency/* | — | 0 rows; fake adapter only | INTENTIONALLY_DARK | LIKELY_INTENTIONAL_BOUNDARY |
| E64 | Perception adapter → Thought | v021 perception adapter | adapted perception | Thought input | Perception → Thought | capability set (possibly empty) | cognitive-v021/perception/adapter | — | no distinguished prod rows | LIVE_SOURCE_ONLY | NEEDS_SOURCE_RECONCILIATION |
| E65 | Attachments / vision paths | ingestion | `perception_artifacts` | Thought | Perception → Thought | modality support | perception/artifact-store | — | unwitnessed | UNKNOWN | NEEDS_PRODUCTION_WITNESS |
| E66 | Retained external-agency lifecycle | runtime + server routes | agency state (0) | operator only | External agency → Operator | no credentials, unqualified adapter | external-agency/lifecycle | — | 0 rows | WIRED_BUT_GATED | LIKELY_INTENTIONAL_BOUNDARY |
| E67 | Proposal → review path | change-proposal lifecycle | `candidate_changesets` (12 proposed) | owner review | Authorship → Stewardship | consultation, base commit | change-proposal/* | proposal tests | 12 proposed Aug (pre-cutover) | LIVE_WITNESSED | — |
| E68 | Self-change apply | (no live applier) | patch export (2, Aug) | live Ashley (none) | Authorship → (withheld) | authorship != apply | export paths | — | export never applied | INTENTIONALLY_DARK | LIKELY_INTENTIONAL_BOUNDARY |
| E69 | C2/C3/C4 graduation observe | maturation contracts | c2/c3/c4 `observe` + 34 C3 terminal records | — (no influence) | Graduation → (none) | hard Memory/Evidence dependency | learned-autonomy/*, graduation/* | contract tests | observe rows only | WIRED_OBSERVE_ONLY | LIKELY_FUTURE_PHASE |
| E70 | Learned influences → choice | influence writers | `learned_influences` (0), receipts (0) | Thought choice | Autonomy → Thought | promotion, qualification | learned-autonomy/* | — | 0 rows | INTENTIONALLY_DARK | LIKELY_FUTURE_PHASE |
| E71 | Domain durability mechanisms | inbox/retry/delivery/detached/attention/session writers | ledgers + continuity events | restart recovery | each domain → Continuity | per-domain triggers | retry/ledger, continuity/registry | ledger tests | 182 sessions; ledgers populated | LIVE_WITNESSED | — |
| E72 | General Operational Continuity engine | (not implemented) | workflow state (none) | — | — | named future phase | architecture only | — | NONE (correctly) | DEFERRED_BY_DESIGN | LIKELY_FUTURE_PHASE |
| E73 | Typed Event Spine | (not implemented) | committed-transition announcements (none) | — | — | only if later earned | architecture only | — | NONE (correctly) | FUTURE_CONTRACT_ONLY | LIKELY_FUTURE_PHASE |
| E74 | Health + diagnostic surfaces | agent/discord status | `/health`, idle status, graduation/learned diagnostics | operator | Runtime → Operator | auth on control; diagnostics never authorize | server.ts routes | status tests | `/health` ready witnessed Sep 18 | LIVE_WITNESSED | — |
| E75 | Legacy proactive diagnostic kv | old proactive writer | `nuclear.proactive.diagnostic` (Aug 30) | — (unread by current surface) | (retired owner) | — | runtime legacy | — | 1 stale row | LEGACY_DEAD_EDGE | LIKELY_STALE_MACHINERY |
| E76 | Nuclear sandbox admission path | old task admission | `sandbox_task_admissions` (1016 refused) | — (no executor reads) | (superseded owner) | `no_grounded_evidence` | sandbox/* hist | — | all refused, dead since Aug 30 | LEGACY_DEAD_EDGE | LIKELY_STALE_MACHINERY |

(Edge numbering skips E59, which was folded into E24 during drafting; the ledger
is authoritative by ID, not by sequence.)

Classification tally (counted from the table above):
LIVE_WITNESSED 24, LIVE_SOURCE_ONLY 10, WIRED_BUT_GATED 4, WIRED_OBSERVE_ONLY 4,
WIRED_BUT_UNQUALIFIED 0, SOURCE_PRESENT_EDGE_ABSENT 1, PRODUCER_ORPHANED 3,
CONSUMER_ORPHANED 1, MISWIRED 0, OPERATOR_TRUTH_STALE 0, INTENTIONALLY_DARK 7,
DEFERRED_BY_DESIGN 1, FUTURE_CONTRACT_ONLY 1, LEGACY_DEAD_EDGE 4,
SUPERSEDED_EDGE 2, NEEDS_LIVE_WITNESS 9, UNKNOWN 4. Total 75.

# 8. Durable-State Producer / Consumer Matrix

Behaviorally consequential families only. Bookkeeping columns omitted.

| State | Writer (live path?) | Reader (live path?) | Lifecycle / invalidation | After restart | Projects back into Thought? |
|---|---|---|---|---|---|
| `inbox_events` | ingress append (YES) | claim/consume (YES) | consumed / failed_terminal quarantine / repair seam unused | survives; 5 pending unwitnessed by consumer | YES via wake→cycle |
| `wakes` | inbox consumer (YES) | live dispatch (YES, 141 terminal) | terminal / pending (5 stale) | survives; stale stay pending | YES |
| `cycle_records` | admission (YES) | Thought + settlement (YES) | silent / sending (1 stale) | survives | YES |
| `concerns` / `mind_occupancy` | settlement deltas (source YES, prod 0 live) | projection (source YES, prod empty) | resolve/quarantine; 4 legacy quarantined | survives quarantined | NO live instance yet |
| `future_triggers` | publish writer (source) | periodic eval (source) | due/fire/cancel | survives | NO (0 rows) |
| `observation_subscriptions` | subscription writer (source) | poller (source) | poll/expiry | survives | NO (0 rows) |
| `speech_outbox` | settlement (YES) | projector/pump (YES) | pending→delivered/suppressed/failure | survives; 1 stale `sending` | via delivery intent only |
| `system_notice_outbox` | `emitInfrastructureNotice` (YES) | system recheck (YES pre-fix; post-fix unwitnessed) | pending→delivered/failure terminal | survives; 7 terminal kept | NO (notices are rendered, not reasoned over) |
| `operation_interim_outbox` / `detached_operations` | detach path (source) | recheck/resume (source) | admit→start→terminal; fail-closed | would survive; 0 rows | NO instance yet |
| `periodic_cognition_schedule` + receipts | scheduler evaluate (YES) | operator status (YES) | eligible→skip/wake/expire | survives; ticking | only on wake (never) |
| `settlements` / `causal_ledger` / `thought_steps` | Thought+settlement (YES) | diagnostics, recheck basis (YES) | immutable receipts | survive | as attempt basis, YES |
| `sidecar_memory_assertions` + supports | migration/admission (fired historically) | recall projection (unwitnessed live) | live flag (all 0) | survive non-live | NO live instance yet |
| `durable_nominations` / `admission_log` | nomination (source) | governed admission (source) | — | — | NO (0 rows) |
| nuclear `delivery_reservations`/`bubbles` | settlement+pump (YES) | pump/finalize (YES) | committed/aborted/cancelled/sending (12 stale) | survive incl. stale | NO |
| nuclear `memory_assertions` | historical migrate + supports (YES historically) | recall (unwitnessed live) | supported/uncertain, supersede | survive | UNWITNESSED |
| nuclear `mem_*` | legacy writers (dead) | superseded readers | — | survive | NO (superseded) |
| `capability_releases` | rollout/promotion (YES historically) | `capabilityCanInfluence` (YES) | active/observe/rollback | survive | YES via CapabilityReality |
| `bounded_operation_tasks/steps` | M6 admission (workshop scope) | finalize (workshop scope) | admitted→succeeded (1 admitted stale) | survive | NO (Thought offer dark) |
| `sandbox_task_admissions` | old admission (dead) | none | refused terminal | survive | NO |
| `cur_*` / `questions` | scan/reads/takes (YES) | status surfaces (YES); Thought NO | shadow provenance | survive | NO live influence |
| `identity_entries` | governed writes (0 recent) | constitution projection (source) | stable layers | survive | unwitnessed projection |
| `reflection_events` / calibration | outcome writers (dormant) | none live | — | survive | NO |
| relationship family (all) | C5 writers (dormant) | none live | observe | survive empty | NO |
| `external_actions` + events | none live | none live | — | — | NO |
| `change_proposals` / changesets / exports | proposal writers (Aug) | owner review (no live session) | proposed; export≠apply | survive | NO |
| continuity `lineage_state`/`sessions`/`events` | lifecycle hooks (YES) | diagnostics (YES) | 175 unclean vs 6 clean shutdowns | survives | sessions inform overview only |
| `desk_entries` / `working_context_items` | desk writer (0) / Thought topics (5 live) | Thought input (topics YES) | transient | topics survive | topics YES; desk NO |

Negative-space findings (state with no counterparty): 12 stale `sending`
reservations + 1 `sending` speech with no claiming recovery; 5 pending wakes;
7 quarantined obligations with no repair; 92 non-live assertions with no live
reader; 4 quarantined concerns with no projection; `thought_calibration_adjustments`
with writer but no rows and no reader; `desk_entries`, `durable_nominations`,
`admission_log`, `effect_receipts` (0 rows despite 144 causal entries noting
`effectIds:[]`), `in_flight_effects` (0), `public_presence_state` (0 despite
room capture), `future_triggers`, `observation_subscriptions` (schema ready,
producers idle).

# 9. Capability / Authority Wiring Matrix

Availability != authority, at every layer (all witnessed in production except
where marked):

| Layer | bounded_operation (M6) | project_inspection (M2) | experimentation (M3) | verification (M4) | authorship (M5) | patch_export (M7) |
|---|---|---|---|---|---|---|
| Machinery present | YES | YES | YES | YES | YES | YES |
| Release state | active (v3) | active | active | active | active | active |
| Registry permission | operationAllowed true | readAllowed true | recipes allowed | verificationAllowed true | authorshipAllowed true | patchExportAllowed true |
| Thought-visible | NO (hard false) | YES | YES (gated) | YES (gated) | YES (gated) | YES (gated) |
| Host-admissible | operator path only | YES direct | YES | YES | YES | YES |
| Production witness | 10 tasks Aug, 0 since cutover | 4 observations Sep | inquiry-only routing | 11 runs Aug | 12 proposed Aug | 2 exports Aug |
| Current intentional gate | cognitive offer dark | none | M3+M4 only via operate | snapshot/provenance | iterative gate, no apply | named profile only |

`objective.operate` from Thought routes to the inquiry-only coordinator
(M3+M4, `profile:inquiry_experiment`), never to `executeBoundedOperationV2`;
no dispatch caller of the bounded executor exists. The standalone executor keeps
its own gates (capability influence, lifecycle, owner id, operationAllowed,
deadline, step limits, forbidden effects). Workshop-accepted Aug operations do
not transfer to the current cognitive cutover.

# 10. Cognitive Projection Matrix

What can currently enter Thought, from where, under what gate, and whether it
ever does in production:

| Projection | From | Gate | Ever in prod? |
|---|---|---|---|
| Owner/system evidence | conversation_evidence_log | admission + fence | YES (670 rows) |
| Occupied concerns | mind_occupancy + concerns | eligible status + hash match | NO (all quarantined) |
| Live memory assertions | sidecar assertions live=1 | governed admission | NO (all live=0) |
| Recall retrieval | derived FTS + cutover | recall release active | UNWITNESSED (indirect only) |
| Relationship constraints | C5/social-authority | graduation + licenses | effectively NO (empty state) |
| Due-commitment wakeup | self-commitments/opportunities | `RA_COMMITMENTS` fail-closed (unset in prod) | NO (0 rows; chain gated, not absent) |
| Identity/constitution | identity_entries | governance | UNWITNESSED |
| Mind-state items | state provider | — | UNWITNESSED |
| Capability reality + ops | rollout + registry + env | influence + qualification | YES (ops offered; 4+ uses) |
| Operation completions | detached completion inbox | resume path | NO (0 completions) |
| Tool observations | sandbox/interim/perception | dispatch + recheck | YES (4 inspection obs) |
| Working-context topics | Thought-authored topics | — | YES (5 live) |
| Future-trigger wakeups | future_triggers | due + snapshot | NO (0 rows) |
| Subscription ingests | polls | interval + expiry | NO (0 rows) |
| Curiosity takes | cur_takes | NONE (no edge) | NO (shadow only) |
| Reflection calibration | calibration table | `dark_apply` fixture-only; live `apply` throws; persisted contract observe | NO (0 rows; no live producer-caller, no Thought consumer) |
| Learned influences | influences | promotion (unpromoted) | NO |

# 11. Publication / Delivery Matrix

| Lane | Semantic owner | Outbox | Recheck | Pump claim | Production |
|---|---|---|---|---|---|
| Reactive Ashley speech | Thought/settlement | speech_outbox | Owner DM/room per bubble | reactive | 103 delivered, live |
| Proactive Ashley speech | Thought/commission | speech_outbox | eligibility + publication | proactive | 1 committed Aug 26 |
| Detached interim speech | Thought A (authorized) | operation_interim_outbox | interim recheck (never cancels op) | interim | 0 rows |
| System notices | infrastructure (not Ashley voice) | system_notice_outbox | system-notice truth (P0) | system | 30 delivered; 7 failed terminal; 0 post-fix |
| Social/room notifications | social authority | reservations | room recheck | room/social | capture live; delivery unwitnessed |
| Owner room | Thought + room activation | speech_outbox | Owner-room typed recheck (Wave D) | owner_room | test-only |
| External/public | External Effect | external reserve | provider receipt | external | dark (0 rows, fake adapter) |

System notices are never Ashley-authored speech and never use `speech_outbox`
for pending resolution; speech never uses `system_notice_outbox`. The P0 split
is source- and test-proven and has no production instance yet.

# 12. Recovery / Restart Matrix

| Failure | Detection | Recovery path | Production state |
|---|---|---|---|
| Unfinished cycle / process failure | inbox status + attempts | claim retry → quarantine after exhaustion | 7 quarantined, 0 repaired |
| Stale pending wakes | wake state | lease/claim (never fires for Sep 3–4 rows) | 5 pending across restart |
| Stale `sending` delivery/speech | reservation state | startup-outcome-recovery (no effect observed) | 12 + 1 stale across restart |
| Thought/provider failure | attempts failure_class | retry → failure notice | 9 transient retried; notices emitted |
| Thought failure notice unsendable | send_failure | terminal (no retry by design) | 7 terminal, kept |
| Deadline/overflow/pass-exhausted | step kinds | failure notice only | 41 failure steps |
| Detached worker never completes | admission/started durability | expiry reconciliation; interim failure keeps admission | 0 instances |
| Unclean shutdown | continuity events | startup + sessions | 175 unclean vs 6 clean; sessions survive |
| Duplicate reply risk | fence + idempotency + single-active | claim tokens, projection keys | 0 duplicates observed |

# 13. Operator-Truth Matrix

| Runtime fact | Operator surface | Verdict |
|---|---|---|
| Health/readiness | `GET /health` (+agent root) | truthful, witnessed |
| Periodic truth (schedule, receipts, occupancy) | `GET /initiative/status` → `/proactive status` | source/test truthful; output unwitnessed (auth-gated) |
| Delivery pending/receipts | pump claim + finalize + diagnostics | live and truthful |
| Capability/release state | `/nuclear` capability routes | live |
| Graduation/learned autonomy | `/nuclear/cognitive-graduation`, `/nuclear/learned-autonomy` | observe-only diagnostics, correctly non-authorizing |
| Reflection/overview | `/nuclear/reflections` | observe, correctly non-authorizing |
| Curiosity status | `/curiosity/status` | live; takes shadow correctly reported |
| Legacy proactive kv diagnostic | nothing current reads it | stale row, unread — dead, not surfaced |
| Stale `sending` rows age/state | no observed surfacing | unknown surface — review item, not a stale-truth finding |
| Control endpoints | auth-gated (`forbidden` unauthed witnessed) | diagnostics separated from control |

# 14. Historical / Superseded Machinery — DO NOT RECONNECT

- V1 sandbox broker topology (Wave 07): zero broker files in `apps/sandbox-v2`
  and `core/sandbox`; `BROKER_ENABLED=false`; socket path configured but no
  broker exists; negative guard test locks env absence. LEGACY_DEAD_EDGE.
- Nuclear `cognition/*` live paths, `context-allocation` engine, `provenance`
  tables: migration/DDL residue only. HISTORICAL_RETAINED.
- Nuclear sandbox task admission (`no_grounded_evidence` refusals): dead since
  Aug 30; executor never reads it. LEGACY_DEAD_EDGE.
- Legacy nuclear initiative (reservations, kv diagnostics, operational lanes
  stuck `sending` since Aug 24): superseded by v021 periodic cognition.
  SUPERSEDED_EDGE / LEGACY_DEAD_EDGE; the stuck rows are evidence, not a queue.
- Direct `mem_*` reads for Thought: superseded by derived FTS + sidecar
  projection + recall cutover. SUPERSEDED_EDGE.
- Historical agency decision log (ask/speak/challenge/silence through Aug 30):
  pre-cutover cognition record, not a live producer. HISTORICAL_RETAINED.
- Seven terminal `send_failure` notices: historical terminal state. Do not
  revive, do not retry, do not reproject.

# 15. Intentionally Dark / Gated Machinery

- Generic M6 Thought offer: hard `false`, test-locked (§18). Dark by explicit
  source + test, not by omission.
- Curiosity live influence: `CURIOSITY_ENABLED=false`, consolidation observe,
  takes shadow. Dark by config + release.
- Self-commitment due/wake influence: full Thought→settle→due→wake→projection
  chain implemented and test-proven, held shut by the single fail-closed
  `RA_COMMITMENTS` flag (unset in production). Gated by config, not by
  graduation.
- Broader mutual/consent/tension/repair / C5 relational influence: separate
  C5/relationship machinery, currently observe/unpromoted (E43). Not governed
  by `RA_COMMITMENTS`; do not read the RA gate as covering every relational
  mechanism.
- Learned influences: unpromoted, 0 rows. Dark by promotion gate.
- External/public delivery: fake adapter, no credentials, 0 rows. Dark by
  authority + qualification absence.
- Self-change apply: authorship≠apply, export≠commit/push/deploy preserved;
  no live applier. Dark by architecture law.
- Reflection influence on turns: observe mode; calibration writer primitive has
  no live callers and no Thought consumer; `dark_apply` explicitly fixture-only
  (`contract-state.ts:33`), live apply throws, table classified SHADOW_ARTIFACT.
  Dark by explicit source gating. Source names future intent only
  (`calibrationsEligibleForFutureThought` counter) — intent, not wiring, and no
  proof it must never be connected, only that it currently is not.
- External-agency retained lifecycle: reachable operator surfaces, fake
  adapter, 0 rows. Gated (no credentials, unqualified) — do not reconnect
  account/action machinery because tables exist.

# 16. Future-Contract-Only Edges

- General Operational Continuity workflow engine: planned, named future phase;
  current durability is per-domain by design (§35 of the audit: inbox, retry,
  delivery, detached, attention, sessions). Absence is not a wiring defect.
- Typed Event Spine: design-later, only if earned; operational inbox ≠ event
  spine (event ≠ instruction/truth/permission).
- Computer Use, voice, broad external tools, broad self-modification: deferred
  per Freeze; no edge drawn.

# 17. Orphan / Negative-Space Findings

1. 12 `sending` reservations + 1 `sending` speech: writers live, recovery
   consumer never claims (E13). 2. Five pending wakes: producer live, consumer
   idle (E16). 3. Quarantined obligations: terminal with unused repair seam
   (E14/E15). 4. Non-live assertions: written, never read live (E34).
5. `effect_receipts` 0 rows while causal ledger carries 144 entries with empty
   effect lists: effect machinery present, effects never originated in prod.
6. `in_flight_effects`, `desk_entries`, `durable_nominations`, `admission_log`,
   `public_presence_state`, `future_triggers`, `observation_subscriptions`,
   `external_actions`, `change_proposals`: schema ready, no live producer.
7. `thought_calibration_adjustments`: WRITER PRIMITIVE = SOURCE_PROVEN
   (`recordThoughtCalibrationAdjustment`, calibration.ts:181-210); LIVE
   PRODUCER = ABSENT (zero non-test callers); THOUGHT CONSUMER = ABSENT (no
   Thought input/projection/run reader; only the observe diagnostics surface
   reads eligibility); 0 rows; `dark_apply` fixture-only, live apply throws
   (E42, INTENTIONALLY_DARK).
8. `open_cognitive_items`: WRITER PRIMITIVE = SOURCE_PROVEN
   (`materializeOpenCognitiveItem`, open-items.ts:987, INSERT :1014); LIVE
   PRODUCER/REACHABILITY = ABSENT (zero non-test callers); readers exist only
   in non-production-reachable families (agency decide paths, cognition
   wake-selection/reconsideration); 0 production rows. `cognition_claims`: 0
   rows. Supporting surface, not a defect, not a seam to wire. 9. `scheduled_proactive_messages`: 0 rows ever; superseded.
10. Dual-memory appearance (nuclear assertions vs sidecar assertions): declared
    currentness owner is Memory Evidence with the sidecar `live` flag; nuclear
    rows are the supported-mirror with 92 supports. No conflicting-truth
    incident found, but no live projection witnessed either — adjudicate before
    assuming either side feeds Thought today.

# 18. Targeted M6 Reconciliation

- M6_LOWER_LEVEL_MACHINERY_READY = YES (bounded_operation release active +
  engineering lifecycle enabled + Bubblewrap present + registry
  operationAllowed true; the helper's four inputs are all true in production)
- M6_RELEASE_ACTIVE = YES (`bounded_operation` / `ashley-capability-v3`,
  promoted 2026-08-23, never rolled back)
- M6_REGISTRY_OPERATION_ALLOWED = YES (`project-ashley` entry,
  `operationAllowed: true`)
- THOUGHT_CAPABILITY_REALITY_CAN_OFFER_BOUNDED_OPERATION = FALSE
  (`capability-reality.ts:303`, explicit)
- THOUGHT_OPERATION_CAPABILITY_FOR_GENERIC_M6_PRESENT = NO (live set at
  `capability-reality.ts:34` excludes it; no `bounded_operation` entry in
  `thoughtOperationCapabilities`)
- ANY_CURRENT_COGNITIVE_PATH_CAN_ORIGINATE_GENERIC_M6 = NO
  (`objective.operate` dispatches to the inquiry-only M3+M4 coordinator;
  `executeBoundedOperationV2` has no dispatch caller)
- ANY_CURRENT_HOST_PATH_CAN_EXECUTE_M6_WITHOUT_THOUGHT_OFFER =
  ONLY_EXPLICIT_OPERATOR_PATH (direct invocation with capability-gate skip
  exists as an operator/test seam; no server or dispatch wiring exposes it)
- PRODUCTION_M6_OPERATION_SINCE_CURRENT_COGNITIVE_CUTOVER = NO (10
  `bounded_operation_tasks`, latest 2026-08-25 `succeeded`; cutover 2026-09-04;
  nothing since)
- STOPPED_ARCHITECTURAL_BLOCKER verdict: FALSE_POSITIVE_LAYER_CONFLATION.
  The stopped campaign read the lower-level readiness helper (true) as Thought
  exposure. Both truths stand simultaneously and must be represented together:
  lower-level machinery intentionally available under its workshop-accepted
  scope AND current Thought exposure explicitly false and test-locked. Nothing
  was mutated to make either side look darker.

# 19. Targeted Post-Repair Witness State

- CONCERN_OCCUPANCY (Wave A `3a5ee62`): SOURCE_PROVEN YES (output-contract →
  parse → run → publish fence → lineage/occupancy writers → projection →
  input enrichment). TEST_PROVEN YES (`run.test.ts` carry-through + cycle
  binding regression; `occupied-concerns.test.ts` projection). PRODUCTION_PROVEN
  NO (0 live rows; 4 quarantined legacy-import; 21/21 periodic skips).
- PROACTIVE_STATUS (Wave B `c256d52`): SOURCE_PROVEN YES (operator-status
  reads schedule, occurrence diagnostics, occupancy projection, last owner
  evidence, enabled flag; legacy messages unread). TEST_PROVEN YES
  (operator-status + proactive render tests). PRODUCTION_PROVEN NO (endpoint
  auth-gated by design; scheduler ticks witnessed, rendered output not).
- ASYNC_INVESTIGATE (Wave C `ee420b7` + detach stack): SOURCE_PROVEN YES
  (admit → interim authorize → fail-closed dispatch → completion resume).
  TEST_PROVEN YES (three fail-closed cases, zero-row + unpublished asserts).
  PRODUCTION_PROVEN NO (0 detached, 0 interim; no natural owner witness).
- SYSTEM_NOTICE (P0 `ccfbee7` + Wave D `048325c`): SOURCE_PROVEN YES
  (keyed router; system truth; terminal stays terminal). TEST_PROVEN YES
  (production-shaped fixture notice 31 / reservation 329, pending and terminal
  cases). PRODUCTION_PROVEN: pre-fix path YES (30 delivered); post-fix path NO
  (see answers below).
- System-notice reconciliation: WERE_ALL_7_FAILURES_CREATED_BEFORE_THE_P0_RUNTIME_FIX
  = YES (failures 2026-09-17 00:31–07:16 UTC; fixed code activated 2026-09-17
  21:28 UTC with this exact commit). ANY_POST_FIX_SYSTEM_NOTICE_CREATED = NO.
  ANY_POST_FIX_SYSTEM_NOTICE_DELIVERED = NO. ANY_POST_FIX_SYSTEM_NOTICE_FAILED
  = NO. CURRENT_SOURCE_PATH = SOURCE_PROVEN. CURRENT_TEST_PATH = TEST_PROVEN.
  CURRENT_PRODUCTION_PATH = NEEDS_LIVE_WITNESS. Historical terminal failures
  remain terminal; nothing was revived or retried.

# 20. Candidate Current Seams for Owner/Sol Review

No implementation is recommended. No wiring is authorized. Each item states why
it looks current, what behavior is absent, and the risks of touching it.

1. E15 quarantine→repair seam. Looks current: quarantined rows exist, repair
   columns and repair tables exist in current schema. Absent: any repair ever.
   Producer quarantined obligations; consumer repair path; owners Agency→Cognition
   compatible. Authority risk: re-waking old obligations could answer stale
   prompts as if current. Stale-machinery risk: medium (repair path never run in
   prod). Missing: source proof the repair consumer is wired beyond schema.
   Flag: OWNER_SOL_REVIEW_REQUIRED.
2. E21 periodic admit on live concern. Looks current: evaluator + test exist.
   Absent: any live concern, so the branch never runs. Risk: wiring pressure
   toward manufacturing concerns to "test" proactivity — explicitly forbidden
   by this audit. Flag: OWNER_SOL_REVIEW_REQUIRED (adjudicate only on natural
   concern arrival).
3. E26/E27 triggers and subscriptions. Look current: writers + evaluators in
   current source. Absent: any row, any wake. Risk: connecting them would grant
   autonomous wake authority with no demonstrated need. Flag:
   OWNER_SOL_REVIEW_REQUIRED (likely intentional boundary until a producer need
   is demonstrated).
4. E34 non-live assertions. Looks current: 92 supported mirror rows. Absent: a
   live flag and a witnessed Thought read. Risk: flipping `live` without
   governed admission would manufacture belief from unadmitted content. Flag:
   OWNER_SOL_REVIEW_REQUIRED.
5. E35 recall→Thought. Looks current: release active, index built, cutover
   recorded. Absent: proof any assertion entered production Thought. Risk:
   assuming recall works because indexes exist. Flag: NEEDS_PRODUCTION_WITNESS.
6. E13/E16 stale recovery rows. Look current: recovery modules exist. Absent:
   any effect on exactly these rows across a restart. Risk: "fixing" recovery
   could finalize/duplicate user-visible sends. Flag:
   NEEDS_SOURCE_RECONCILIATION first (prove what recovery is specified to
   cover), then owner decision.
7. E50 bounded execution operator path. Looks current: gates + executor live.
   Absent: any cognitive access (correct). Risk: any Thought-adjacent shortcut
   would collapse the §18 distinction. Flag: OWNER_SOL_REVIEW_REQUIRED (decide
   only explicit-operator invocation policy, never cognitive exposure).

# 21. Current Disconnections / Boundaries That Must Not Be Bypassed

- Curiosity takes → Thought/concerns/initiative (disabled + shadow + observe;
  connecting would manufacture interests as beliefs).
- Graduation calibration → Thought: writer primitive exists with no live
  producer-caller and no Thought consumer; `dark_apply` explicitly fixture-only,
  live apply throws, persisted contract observe, table SHADOW_ARTIFACT.
  Currently dark by explicit source gating — source proves absence/darkness,
  not that it must never be connected (future intent is named in source as
  intent only).
- C5 commitments → Thought/Agency via graduation influence (unpromoted; C5 gate
  unmet). Distinct from the RA-gated commitment chain (E28): C5 non-influence
  stays disconnected; the RA chain is gated, not absent.
- Learned influences → choice (unpromoted; no rows).
- Lower M6 readiness → Thought offer (explicit false; workshop scope ≠
  cognitive authority).
- V1 broker anything → anything (superseded topology; must not return).
- Legacy nuclear initiative/sandbox-admission rows → any live consumer (dead
  owners; stuck rows are evidence, not work).
- Terminal `send_failure` notices → retry/repair (terminal by design).
- Quarantined legacy concerns → occupancy projection (quarantine is doing its
  job; Wave-A seam must earn its first live row naturally).
- External-agency account/action machinery → credentials/effects (no
  credentials, fake adapter, unqualified).
- Memory Evidence future contracts → current reads (do not project future
  architecture as current).
- Generic Operational Continuity engine → domains (planned phase; domain
  mechanisms are the current design, not a gap).
- Event Spine → anything (does not exist; inbox is not a spine).

# 22. Production Witness Gaps

Ordered by consequence: (1) post-fix system-notice path — first natural Thought
failure notice after activation; (2) first live concern→occupancy→projection→
periodic eligibility chain; (3) first detached investigation with interim
delivery and Thought-B resume; (4) first Mode-B worker use; (5) rendered
`/proactive status` output; (6) recall assertion entering Thought;
(7) identity projection effect; (8) room delivery completion; (9) external-DM
cognition (may correctly never occur); (10) partial-delivery handling;
(11) refusal branch in v021; (12) forgetting/retraction (may correctly never
  occur); (13) `intentional_silence` disposition (E10): terminal silent state
  witnessed, disposition never set in production. None of these gaps authorizes manufacturing the missing event.

# 23. Unknowns

- U1: v021 refusal branch shape and any production instance (E09).
- U2: partial-delivery semantics in production (E12).
- U3: owner-room delivery completion (E62).
- U4: attachment/vision ingestion in production (E65).
- U5: exact C5 runtime mode value under `apply` (tables all empty regardless;
  mode string itself not resolved from source in this audit).
- U6: whether recall retrieval has ever fed production Thought (E35).
- U7: which surface, if any, reports the age/state of stale `sending` rows.
- U8: perception adapter's live capability set contents (no distinguished rows).
- U9: full test-seam-vs-production-seam surface beyond the two documented
  seams (bounded-operator skip, Wave-D fixture) — recorded as a standing
  reconciliation item, not a finding.
- U10: pre-cutover archaeology details (kept in the old historical repository
  by policy; not pursued).
- U11: whether any production silent cycle was `intentional_silence`
  (disposition NULL on all 146 cycles; state alone cannot distinguish).

# 24. Executive Summary

75 behavioral edges inventoried at identical source/production baseline
`048325c`/`b1bed77`. 24 are live-witnessed end to end (reactive conversation,
delivery, failure-notice writes and pre-fix notice delivery, retries, periodic
ticks that skip, curiosity reads, room capture, capability projection,
inspection observations, domain durability, health). Terminal silent cycle
state is witnessed; that any of it was intentional silence is not (E10 —
disposition NULL on all cycles). 9 more are source-complete with tests but await
their first natural production witness (post-fix notice recheck, concern seam,
proactive status output, recall, DM cognition, detached async + interim,
Mode-B, room delivery). 7 are intentionally dark by explicit source, config,
or test lock (graduation calibration, curiosity influence, C5, M6 offer,
external delivery, self-change apply, learned influence). 4 are wired but
gated (commitment chain held by the unset `RA_COMMITMENTS` flag, bounded
execution, external agency, takes consolidation). 4 are retained legacy that
must not be reconnected; 2 are superseded with live replacements; 1 is
deferred-by-design and 1 is future-contract-only. 3 producers write state no
consumer claims (stale `sending` rows, stale pending wakes, non-live
assertions); 1 consumer waits on input with no live producer (periodic admit
on live concern); 1 schema-complete seam (quarantine repair) has both
sides current but never connected. 0 edges found miswired, 0 operator surfaces
found stale. M6 reconciles as FALSE_POSITIVE_LAYER_CONFLATION: lower machinery
verifiably ready AND Thought exposure verifiably, intentionally false. All 7
historical notice failures pre-date the P0 fix activation; no post-fix notice
exists. No historical path was accidentally reconnected. Every suspect edge
carries an Owner/Sol review flag; none carries a wiring authorization.

---

# 22. POST-ATLAS REPAIR DELTA (R1 OWNER/SOL-ADJUDICATED REPAIR WAVE)

This section is the ONLY post-baseline content in this artifact. Everything
above remains the read-only audit bound to `048325c`/`b1bed77`; the original
75-edge production audit did NOT occur on the new source below.

SOURCE_REPAIR_SHA =
76c05bb5c964b83727befa0ed8a2dc4c59c5baa4

SOURCE_REPAIR_TREE =
5c7f6f4df02049aa20e55640ba7aefce1f9dd6b4

Scope implemented (adjudicated R1-A + R1-B; R1-C investigated, no replay):

- R1-A: terminal/quarantined unresolved Owner obligation -> existing durable
  repair lineage -> fresh wake -> Thought with explicit recovery context.
- R1-B: orphan/stale pending wake convergence where no valid durable
  continuation owner remains.
- R1-C: stale delivery/speech `sending` state. Investigated; ambiguity
  preserved; no replay, resend, abort, or delivery-state change.

NOT connected (unchanged by this repair): E21 periodic/live-concern path,
E26 future triggers, E27 subscriptions, E34 non-live assertions, E35 recall,
E42 calibration -> Thought, E43 C5 influence, E50 generic bounded M6 ->
Thought, curiosity shadow/learned influence, V1/legacy initiative/sandbox
paths, any external/public capability. No capability promotion, no
feature-flag widening, no RA_COMMITMENTS enablement, no C4/C5 promotion, no
M6 Thought exposure (proven by T16 + untouched capability files).

## E15 delta (R1-A)

PRE_REPAIR =
SOURCE_PRESENT_EDGE_ABSENT / OWNER_SOL_REVIEW_REQUIRED. Quarantined rows
exist; `repair_of_event_id` + `durable_work_repairs` schema present; no
producer ever called `createRepairEvent()`; 0 repairs.

POST_REPAIR_SOURCE =
- `retry/owner-recovery.ts` (new, durable-work/retry ownership):
  `serviceUnansweredOwnerRecovery()` discovers eligible conversations
  oldest-first and materializes at most one conversation-coalesced repair
  undertaking per conversation through the existing `createRepairEvent()`
  lineage (deterministic `repair:` id, versioned `unanswered_owner_recovery:v1`
  authorization with a 3-lineage-per-predecessor cap, per-conversation
  transactions, fail-closed counting). Eligibility
  (`checkUnansweredOwnerEligibility()`) is evidence/durable truth only:
  owner-bearing kind, current-version Owner evidence, no resolving terminal
  disposition (superseded/cancelled/stale/abandoned), no explicit refusal,
  no nonterminal owner/frontier-wake/detached-completion continuation, no
  later delivered reply, no later covering settlement, no active
  frontier/detached-operation/repair owner, and a dedicated
  owner-visible-dispatch proof (settlement/outbox/notice/effect boundary;
  a finished-failed Thought provider call alone is not ambiguity).
- `retry/ledger.ts`: `createRepairEvent()` additionally accepts
  terminal+failed_terminal predecessors (legacy permanent_failure class) and
  stores optional continuity-recovery references on the repair payload (no
  new store; legacy repairs without references run as plain recovery).
- `thought/run.ts` + `thought/input.ts` + `thought/projection.ts` +
  `types.ts`: repair-kind turns project `trigger.continuityRecovery`
  (repairEventId, primaryPredecessorEventId, outstandingOwnerEvidenceRefs,
  reason) into Thought input through the existing trigger projection (no new
  section, no allocator change); the primary outstanding row becomes the
  current trigger and all resolved refs enter cycle coverage so a delivered
  recovery provably covers them. The Host states only the mechanical
  continuity fact; Thought authors all meaning and response.
- `serve.ts`: servicing at startup (after ownership + outcome-unknown
  reconciliation, before the inbox consumer begins) and at each steady-state
  reconciliation-maintenance opportunity (bounded, idempotent, sync).

TEST_PROOF =
`retry/owner-recovery.test.ts` 14/14 (T2 one repair, T3 recovery Thought
receives canonical evidence + frame end to end through `runCognitiveCycle`,
T4 predecessor history untouched incl. legacy permanent_failure, T5 restart
idempotency across bounded retry lineages, T6 conversation coalescing,
T7 delivered recovery prevents rematerialization, T8 supersession excluded,
T9 later silence settlement excluded, T10 ambiguous sending blocks + stays
unreplayed, T11 forgotten evidence excluded, T12 external excluded, T13/T14
orphan convergence/live-wake preservation, T15 duplicate-service safety,
T16 no M6/capability change). T1 sibling behavior unchanged
(`autonomous-recovery.test.ts` 7/7). Regression set 119/119 across 10 files
(reconciliation, origin-profile, q2-repair integration, serve-boot-recovery,
Thought run/input/projection/allocator suites). `tsc --noEmit` clean.

PRODUCTION_PROOF = NONE until actual deploy evidence exists.

## E16 delta (R1-B)

PRE_REPAIR =
PRODUCER_ORPHANED / OWNER_SOL_REVIEW_REQUIRED. 5 `pending` inbox wakes
(Sep 3-4); plain `recoverWakes()` never touches pending wakes, so a pending
wake with no claimable continuation survives forever.

POST_REPAIR_SOURCE =
`convergeOrphanPendingWakes()` (same servicing pass, after repair
materialization): a pending wake converges to terminal/`no_action` through
the existing wake lifecycle only when it has no pending/retry/leased/
reconciling inbox continuation, no valid continuation owner through its
cycle (frontier/delivery/normal-phase via the canonical
`hasValidDurableContinuationOwner` predicate), no undelivered
system-notice owner, no detached-operation continuation bound to its cycle,
no in-flight/unknown effect, and its conversation holds no eligible
obligation or active repair (protected set). Never fabricates
completed/answered/delivered. Old orphan wakes in repaired conversations
converge on later passes once the repair is no longer active.

TEST_PROOF = T13/T14 in `retry/owner-recovery.test.ts` (orphan converges to
`no_action`; pending/reconciling wakes untouched).

PRODUCTION_PROOF = NONE until actual deploy evidence exists.

## E13 disposition (R1-C)

PRE_REPAIR =
PRODUCER_ORPHANED / OWNER_SOL_REVIEW_REQUIRED. Stale `sending` rows persist
across restart; zero-receipt post-dispatch sends stay `sending`.

POST_REPAIR_SOURCE =
No behavioral change (deliberate). Verified: `reconcileProjectedDeliverySweep`
resolves only from nuclear reservation truth and never resends;
`recoverCognitiveSidecar` requeues only `projecting`-without-reservation
rows, never `sending`; R1-A eligibility refuses any conversation with an
ambiguous owner-visible projection. MISSING RECEIPT != PROVEN NON-EXECUTION
is preserved.

TEST_PROOF = T10 in `retry/owner-recovery.test.ts` (a `sending` outbox row
blocks repair of its conversation and the row is byte-identical afterwards).

E13_DISPOSITION = TRUTHFUL AMBIGUITY PRESERVED / NO AUTO-REPLAY.

## Edges mechanically unchanged by this repair

E21 = unchanged (periodic admit untouched; no witness manufactured).
E26 = unchanged. E27 = unchanged. E34 = unchanged. E35 = unchanged.
E42 = unchanged (no calibration consumer added). E43 = unchanged.
E49/M6 = unchanged (`canOfferBoundedOperation: false` path untouched; T16).
E50 cognitive exposure = unchanged. No other edge classification moves: the
repair touches 6 source files (retry ledger + owner-recovery, Thought
run/input/projection/types, serve wiring) and adds no producer, consumer,
flag, or authority outside R1-A/R1-B.
