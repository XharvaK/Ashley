# Project Ashley — Initiative Production Path Audit v1

Prepared: 2026-08-09

Scope: local source and disposable-test qualification for
AUTONOMY-PLUMBING-01. No Mint host, production database, live key, provider,
Discord gateway, deployment, or sandbox activation was used.

Historical scope note: this document is an AUTONOMY-PLUMBING-01 audit snapshot.
INIT-03 later added local Open Cognitive Item source projections and diagnostics.
Use INIT03_Persistent_Cognitive_Continuity_Contract_v1.md and
INIT03_Implementation_and_Qualification_Report_v1.md for current INIT-03
evidence. The producer statements below are not a current INIT-03 inventory.

## Decision

- INITIATIVE PATH: PASS for bounded local diagnosis and source correction.
- INIT-02 THOUGHT SILENCE: PASS for deterministic diagnosis; no source fix.
- OFFLINE QUALIFICATION: PASS after the qualification-only network boundary
  and deterministic fixture repair; no external request occurred in the final
  phase0 run.
- SANDBOX NONCE: PASS for the local durable-ledger correction and regression
  proof.
- SANDBOX READINESS: PASS for truthful local readiness aggregation and client
  fail-closed validation.
- PHASE F, NORMAL SANDBOX RUNTIME WIRING: BLOCKED.
- CANARY: WAIT. No canary was run or authorized.

The bounded pass does not claim that Ashley has live initiative or delegated
sandbox access. It closes one real initiative reservation defect, adds
owner-only closed-code observability, closes two sandbox plumbing defects, and
records the remaining semantic admission boundary without inventing an
authority for it.

## Source boundary

The inspected baseline was 18c7cf88e17671929c5bec5d22d5d209719036ef on
master, equal to origin/master, with a clean worktree before this task.
All evidence below is local to the current checkout and disposable test
databases. A local PASS is not Mint installation, restart, release
qualification, or production evidence.

## WAKE → RECEIPT path

| Stage | Owning source | Finding | Classification |
|---|---|---|---|
| WAKE | apps/discord-bot/src/initiative/scheduler.ts:startProactiveScheduler | Starts an immediate and jittered recurring tick, plus a 15-second urgent check. It first requires agent /health readiness and skips when the Discord-side proactive flag is false. | Wiring exists; runtime configuration/state remains unverified locally. |
| ELIGIBILITY | apps/agent-service/src/core/agency/proactive-eligibility.ts:evaluateProactiveEligibility; AshleyCore.tickProactive | Enabled, pause, daily cap, active chat, own-time/availability, and ordinary idle-floor gates are evaluated before mutation. Urgent classification remains capability-gated. | Expected policy gate; unchanged. |
| MOTIVATION | apps/agent-service/src/core/agency/motivations.ts:collectMotivations | Grounded motivation sources are collected. The default silence_ok motivation is low-weight and does not itself qualify an interruption. | Expected policy behavior. |
| EVIDENCE | collectMotivations, learning/capability materializers, and the recent-take reader in AshleyCore.tickProactive | Observe-only or unavailable evidence does not acquire influence. No Recall or capability promotion was performed. | Expected rollout boundary; unchanged. |
| CAPABILITY | apps/agent-service/src/core/rollout/capabilities.ts and relationship capability checks | Relationship initiative remains gated by its existing capability state. Ordinary proactive behavior does not bypass that gate. | Expected governance gate; unchanged. |
| THOUGHT | apps/agent-service/src/core/agency/decide.ts:decide; AshleyCore.tickProactive | Proactive candidates below score 25, or terminal/non-speaking decisions, resolve to silence. A fresh surface normally has only low-weight silence material, so thought_silence is the primary source-backed explanation for natural ordinary silence. | Expected Thought/Agency behavior, not a missing delivery bypass. |
| AGENCY | AshleyCore.tickProactive | A selected motivation is required. Existing material reservations are refused rather than duplicated. | Expected reservation authority. |
| RESERVATION | apps/agent-service/src/core/runtime.ts:tickProactive; apps/agent-service/src/core/delivery/store.ts | Fixed defect: initiative and delivery reservations now share one BEGIN IMMEDIATE transaction, and delivery carries the originating decision_id. A failed delivery insert rolls back both rows, allowing grounded retry. | Source defect fixed locally. |
| EXPRESSION | AshleyCore.tickProactive:expressSpeak | Provider failure, offline rendering, empty text, and empty bubble plans remain distinct closed outcomes. No model/provider text is copied into diagnostics. | Existing authority; bounded observability added. |
| DELIVERY | apps/discord-bot/src/initiative/scheduler.ts; apps/agent-service/src/core/delivery/store.ts | Discord sends only after a reserved delivery exists. Partial/full receipts commit through the existing delivery reservation path; failed sends abort. | Wiring exists; live delivery not exercised. |
| RECEIPT | AshleyCore.commitProactive / delivery finalization and the Discord bubble receipt path | Existing receipt-backed finalization remains the delivery authority. The new transaction preserves the decision-to-delivery link. | Local source/test evidence only. |

## Why Ashley can currently be silent

The source does not show one universal “initiative disabled” defect. The
silence causes separate into three classes:

1. Expected Thought/Agency silence. The proactive decision excludes silence_ok
   and other non-interruption material, then requires a candidate score of at
   least 25. On an otherwise fresh surface, this resolves to thought_silence;
   it is the primary local explanation for ordinary silence.
2. Eligibility or operational gates. Pause, daily cap, active chat,
   unavailable/own-time state, idle floor, a false Discord proactive flag, or
   an agent health response can stop the path before drafting. The scheduler
   also does not reach the agent tick when /health is not ready. Current Mint
   configuration and service state were not inspected.
3. Provider-dependent expression. The agent is offline when its Mistral key is
   absent, and expression can fail or produce an empty draft. Those are
   configuration/provider outcomes, not evidence for changing Thought or
   Agency gates.

Owner-only /initiative/status now includes one bounded lastDiagnostic record
with an ISO timestamp, stage, and closed code. Current codes include
eligibility gates, thought_silence, thought_hold, expression outcomes,
reservation conflicts, delivery claim failure, and delivery commit/abort
outcomes. It contains no prompt, motivation summary, hidden reasoning, or raw
provider error.

## Sandbox hardening result

The delegated runtime now receives BrokerStore.recordNonce through
SandboxBroker.buildDelegatedRuntime, so the nonce ledger is the existing
durable broker store rather than a process-local set. Disposable tests prove
reopen replay refusal, one winner for duplicate reservation, and fail-closed
behavior when persistence fails.

DelegatedRuntime.readiness() now requires valid key/policy material, a
supported recipe, networkProvider === "none", and an operational isolation
provider. The Unix client requires the boolean isolation field and recomputes
readiness from complete broker material, positive capacity, none mode, and
operational isolation. The final execution service still revalidates
isolation immediately before spawn, preserving:

    NO ISOLATION -> NO READY -> NO SPAWN

These are source and disposable-test closures only. The release packet still
requires fresh Mint evidence, a current policy, exact artifacts, an active
isolation probe, and the Recall gate.

## Phase F — production task admission

PHASE F = BLOCKED.

The current source has an execution loop, but not a production Ashley-owned
structured admission seam:

- runSandboxLoop and bootstrapSandboxSession require a SandboxTask, a broker
  client plus SandboxBrokerClientTestDiagnostics, a delegated key, lifecycle,
  adapter, budgets, and clock.
- The trusted policy context reads injected client.policy, client.pathFacts,
  and client.liveFileCanonical; these are fixture/test diagnostics, not a
  production producer owned by Thought or Agency.
- SandboxOperatorAdapter declares a "production" kind, but the only concrete
  adapter is FakeSandboxOperatorAdapter.
- checkSandboxAutonomyLifecycle permits only the fixture adapter under
  fixture_only; evaluation and enabled refuse in the current commit.
- apps/agent-service/src/index.ts constructs the Unix client for the HTTP
  server, but does not construct an Ashley-owned task admission flow or pass a
  production operator into runSandboxLoop.

The missing loop data is not merely a transport field. A future production
seam would need Ashley-produced, authoritative values for the bounded task
identity/deadline/budget, requested capability and risk intent, owner and
policy binding, approved target scope, and the exact operator context that
Thought/Agency is authorizing. The semantic gap is the absence of that
Ashley-owned producer and its authority contract. A fixture adapter can make
tests run, but it cannot supply the real owner/policy/capability decision or
turn untrusted task data into authorization.

The narrow future decision is therefore: define the Ashley-owned admission
contract and its layer ownership, then separately review how it supplies
broker facts and operator input. This task does not redesign Agency, add a
generic task schema, promote a capability, or weaken the broker boundary.

## Phase0 offline diagnosis

The exact command was `npm run phase0:offline` at the repository root. It
invokes `scripts/phase0/run-all.ps1 -Tier offline`, which builds
`apps/agent-service` and then runs the full agent Vitest suite through the
offline-only `vitest.offline.config.ts` setup. The child process pins
`COMPOSER_ENV_FILE` to `config/env.example` and sets
`ASHLEY_PHASE0_OFFLINE=true`; normal startup precedence is unchanged.

Two pre-existing tests in
`apps/agent-service/src/core/delivery/delivery.test.ts` call the real
`AshleyCore.handleReactiveChat` path without an Expression mock. Before the
repair, the exact path was

    handleReactiveChat -> expressSpeak -> completeChat -> runAttentiveDispatch
    -> Mistral adapter -> Mistral SDK -> global fetch
    -> https://api.mistral.ai/v1/chat/completions

The first bounded `phase0:offline` run printed the real Mistral response
`402 Check your subscription` in both delivery tests and then reached the
external command timeout at about 122 seconds (exit 124), before Vitest could
print a final summary. The 402 was provider work from those tests; the timeout
was the outer command ending while the full suite continued, not evidence of
a new single-test deadlock. The phase0 script, delivery tests, and this
initiative source change did not introduce that route.

The repair adds the existing process outbound gate as the authoritative
offline boundary, the route-aware deterministic qualification fixture for the
two delivery tests, and a Vitest defense-in-depth guard for global fetch plus
Node HTTP/HTTPS. Loopback hosts and Unix sockets remain allowed only for
legitimate local fixtures; external targets fail loudly with a stable marker.

Final `phase0:offline` qualification passed with 100 test files, 765 passed,
and 1 skipped in 187.95 seconds. The offline output and error logs contained
zero external-network guard markers and zero provider URL markers. No further
provider request was made.

## Thought Silence Root-Cause Audit

### Exact floor contract

The current proactive contract is deterministic and closed:

1. `collectMotivations` assembles the structured material set and sorts it by
   descending score. Baseline identity boundaries are present for suppression,
   but are not interruption material. `silence_ok` is always appended at
   score 8 for proactive turns.
2. `decide(..., "proactive")` excludes `silence_ok`, `silence_signal`,
   `user_message`, and `boundary`. It selects the highest remaining material.
   With no candidate, or with a candidate below 25, it returns deterministic
   `kind: "silence"`, `shouldSpeak: false`, and score 0 or the candidate score.
3. `classifyTurnComplexity` marks silence, delay, hold, and non-speaking
   decisions terminal. Meaningful proactive share/ask/revisit decisions are
   hard, but the classifier does not delete their material.
4. `deliberateDecision` may call model Thought only for an eligible hard,
   speaking decision when its capability and provider preconditions hold. The
   model is not required to establish the deterministic floor.
5. `AshleyCore.tickProactive` stops before Expression when the decision is
   terminal, complexity is terminal, or score is below 25. It records
   `thought_silence` when the decision is silence or non-speaking, otherwise
   `thought_hold`, logs an empty outcome, and returns without drafting.

No hidden chain-of-thought is part of this contract or the diagnostic. The
owner-only diagnostic contains only a stage and closed code.

### Floor checks and structured inputs

The following is the complete check order for a proactive turn. A failed check
either stops the turn before Thought or removes the corresponding material;
none of these checks authorizes Expression by itself.

| Check | Owning source | Structured input | Pass / fail behavior and output |
|---|---|---|---|
| Initiative class / urgency | `proactive-eligibility.ts:classifyInitiativeClass` | Active `relational_initiative` influence and `hasUrgentMindState(ownerId)` | Pass classifies `urgent_grounded`; otherwise class is `ordinary`. Urgency bypasses the ordinary idle floor only; it does not guarantee speech. |
| Enabled, pause, daily cap, contact | `proactive-eligibility.ts:evaluateProactiveEligibility` | `enabled`, `paused`, `sentToday`, `maxPerDay`, `chatInProgress` | Failure returns `proactive_disabled`, `proactive_paused`, `daily_cap`, or `chat_in_progress`; Thought is not reached. |
| Own-time / availability | `evaluateProactiveEligibility` | `own_time_sessions`, `state.availability`, `state.focus` | An open session, non-available state, or `own_time` focus returns `unavailable`; proactive Thought is not reached. Own-time report material is reactive-only. |
| Ordinary contact idle floor | `evaluateProactiveEligibility` | `lastUserMessageAt`, `minIdleHours`, current time, initiative class | For `ordinary`, insufficient elapsed idle time returns `idle_floor`; `urgent_grounded` may pass this check. |
| Recall and Mind State authority | `rollout/capabilities.ts:capabilityCanInfluence` and `collectMotivations` | Master mode, release state, contract version, and dependency chain | Observe/non-active/incomplete dependency state cannot influence. Mind State requires its Recall dependency; no Recall state is promoted by this floor. |
| Callback / concern / commitment | `motivations.ts:mindStateItemToMotivation` | Active Mind State item `kind`, `activation`, `urgency`, `sourceType`, `sourceId` | `concern`/`goal` map to `callback`; `commitment`/`unfinished` map to `unfinished`; score is `clamp(activation*55 + urgency*45, 20, 100)`. Missing or non-influential state yields no candidate. |
| Reminder / relationship claim | `motivations.ts:collectMotivations` and `relationship/store.ts` | Due `doc_reminder`, relationship capability state, `relational_initiative`, claim lease | A due reminder is added at score 72 only when relationship influence is live and `tryClaimRelationshipMotivation` succeeds. Failed claim, redaction, or missing gate removes it. |
| Broader commitment / relationship records | `relationship/store.ts` and `collectMotivations` | Self/mutual commitments, tensions, withdrawals, and relationship source rows | These records persist, but only `doc_reminders` currently have a proactive reader. The others cannot reach this Thought path. |
| Pending question | `motivations.ts:collectMotivations` | Open question `priority`, `id`, `text`, and scope | Questions are read directly and scored `clamp(priority*2 + 30, 20, 100)`. A persisted question can reach the deterministic floor without a model. |
| Facts, opinions, identity | `motivations.ts:collectMotivations` | Active facts, recent opinions, stable identity boundaries, Mind State interest | Facts/opinions can be material; stable boundaries are suppression context and are excluded by proactive `decide`. An interest item maps to `identity` only through active Mind State influence. |
| Curiosity / evidence provenance | `motivations.ts:collectMotivations` and `curiosity/feed.ts` | `reading`, `curiosity_consolidation`, `evidenceKind`, `readId`, write-time `provenance` | Only `read_record` takes with `live` provenance and both influence capabilities enter as `take`; scan, shadow, and observe-only rows are excluded. |
| Own-time report | `runtime.ts:handleReactiveChat` and `own-time-report.ts:buildOwnTimeReportConstraint` | Completed own-time session, owner-linked live reads, reportable takes, message-scoped ask | The capability can constrain reactive Thought, including evidence refs, but `tickProactive` does not build this constraint. It is not a missing proactive floor candidate. |
| Candidate selection | `decide.ts:decide` | Sorted `Motivation[]`, trigger `proactive`, optional own-time constraint | Excludes `silence_ok`, `silence_signal`, `user_message`, and `boundary`; selects the highest remaining candidate. No candidate or score `<25` becomes deterministic silence. |
| Capability/model Thought | `agency/thought.ts:deliberateDecision` | Hard speaking decision, Thought capability, Groq key, model deadline, structured candidate list | Model Thought is optional. Missing gate/key, terminal/non-speaking base, deadline, model error, or invalid JSON returns the deterministic base with `thoughtSource: "fallback"` and a closed error code. |
| Model evidence refs / claims | `agency/thought.ts` and `decide.ts:attachAuthorizedClaims` | Allowed evidence ref types, selected motivation IDs, live read-record take IDs | Invalid or unsupported refs are filtered. Reading claims require live `read_record` evidence and a `readId`; absence of claims does not manufacture material. |
| Deterministic material floor | `runtime.ts:tickProactive` | Decision kind, `shouldSpeak`, complexity mode, score | If terminal, terminal complexity, or score `<25`, records `thought_silence` for silence/non-speaking or `thought_hold` otherwise, logs empty outcome, and stops before Expression. |
| Material key / reservation | `runtime.ts:tickProactive` and initiative reservation store | Candidate `kind`, `refId`/`id`, derived material key, prior reservation rows | A qualifying candidate must have no existing reservation for the material key. Duplicate material records a reservation diagnostic and does not draft or send. |

For the current empty source surface, the exact structured collection is two
`{ kind: "boundary", score: 40, refType: "identity" }` rows followed by
`{ kind: "silence_ok", score: 8, refType: null }`. The two boundaries are
stable Identity suppression context, not proactive material; after the
`decide` exclusions the candidate set is empty and the floor emits
`thought_silence`.

### Producer inventory

The producer inventory distinguishes a persisted source from an Ashley-owned
production caller and from a reader that can actually reach proactive Thought.

| Source / type | Type exists | Handler exists | Producer exists | Production caller exists | Persistence exists | Capability-gated | Can reach proactive Thought |
|---|---|---|---|---|---|---|---|
| Callback / unresolved | Yes: `callback` | Yes: `mindStateItemToMotivation` and collector | Yes for emitted `stateItems` and direct Mind State upserts | Yes: cognition job apply and existing state paths | Yes: `mind_state_items`; legacy `internal_state.unfinished` also exists | Yes for active Mind State influence; Recall is a dependency | Yes when an active item survives gates. Episode `unresolved` alone is not read. |
| Ordinary commitment / unfinished | Yes: `unfinished` | Yes: same Mind State mapper/collector | Yes: cognition job state application | Yes: cognitive worker and state callers | Yes: Mind State or `internal_state.unfinished` | Mind State path gated; legacy unfinished read directly | Yes through `unfinished` when persisted in a readable source. |
| Due document reminder | Yes: `reminder` | Yes: due-reminder reader plus claim helper | Yes: `upsertDocReminder` and relationship flows | Yes: existing relationship/runtime callers | Yes: `doc_reminders` and motivation claims | Yes: `relationship_state` apply + `relational_initiative` | Yes, only after a successful claim and before reservation. |
| Self/mutual commitment | Partly: ordinary commitment maps to `unfinished`; relationship proposal is not a proactive kind | No proactive reader for `ashley_self_commitments` or `mutual_commitments` | Yes: relationship/cognition producers | Persistence callers exist, but no proactive production caller | Yes: commitment tables | Recording/query gates exist; proactive influence reader is absent | No for the relationship-table rows; this is a missing producer/reader boundary, not a floor defect. |
| Tension / withdrawal / repair | No dedicated proactive `MotivationKind` | No proactive reader | Yes: relationship state and reactive repair paths | Yes for reactive handling, not proactive Thought | Yes: `relational_tensions` / `withdrawal_records` | Relationship influence gates apply | No current proactive reach. |
| Curiosity take | Yes: `take` | Yes: collector and authorized-claims attachment | Yes: scan/read/extract/consolidate pipeline | Yes: curiosity cognitive jobs | Yes: `cur_reads`, `cur_takes`, evidence links | Yes: `reading` + `curiosity_consolidation` and live provenance | Yes for live `read_record` takes only. |
| Pending question | Yes: `question` | Yes: open-question reader | Yes: `createQuestion` and question-producing state paths | Yes: existing reactive/cognition callers | Yes: questions table | No direct current capability gate on read; source creation remains governed | Yes, score and age permitting. |
| Fact / opinion / legacy unfinished | Yes: `fact`, `opinion`, `unfinished` | Yes: direct collector readers | Yes: fact pinning, opinion state, and legacy state paths | Yes: existing message/cognition callers | Yes: facts, opinions, and internal state | No direct proactive capability gate for direct reads | Yes when active/recent and above the floor. |
| Identity curiosity / stable boundary | Yes: `identity` and `boundary` types | Yes: boundary insertion and Mind State interest mapping | No dedicated identity-curiosity producer; boundary seed exists | No dedicated proactive caller | Yes for identity seed; no identity-curiosity record | Mind State interest is gated; boundary seed is stable identity | Boundary: no, intentionally excluded. Mind State interest: yes if produced and gated. |
| Own-time report | No proactive MotivationKind; typed constraint exists | Yes in reactive `handleReactiveChat` | Yes: own-time sessions and report assessment | Yes reactive caller only | Yes: `own_time_sessions` and linked live reads/takes | Yes: `own_time_report` depends on Thought + curiosity consolidation | No from `tickProactive`; reactive Thought only. |
| Urgent grounded wake | No distinct kind; reuses `callback`/`unfinished` | Yes: initiative classifier, urgent claim, and Mind State mapper | Yes: urgent Mind State producer | Yes: proactive tick claims after eligibility | Yes: urgent Mind State fields/wake lease | Yes: `relational_initiative` plus Mind State/Recall chain | Yes as a candidate when the wake survives the same deterministic floor. |
| Scheduled intent | Yes: `scheduled_proactive` type/mapping | Partial: decision/complexity handling only | No current `scheduled_proactive_messages` producer into motivations | No current proactive caller | Yes: scheduled table exists | Contract boundary is defined, but no active reader path | No. Human authority/design decision required before adding it. |

### Deterministic fixture matrix

The disposable matrix is executable at
`apps/agent-service/src/core/agency/initiative-material-floor.test.ts`.
It invokes the real deterministic `decide`, complexity, and floor contract;
hard cases explicitly disable model Thought, so no provider is contacted.
For C-G, the table reports the observed output rather than asserting a
desired speaking policy.

| Fixture | Structured material reaching the floor | Decision output | Floor result |
|---|---|---|---|
| A no grounded | `silence_ok(8)` | `silence`, score 0, terminal | `thought_silence` |
| B weak | `callback(20)` | `silence`, score 20, terminal | `thought_silence` |
| C callback | `callback(100)` | `revisit`, score 100, hard | `eligible_for_expression` |
| D reminder | `reminder(72)` | `revisit`, score 72, hard | `eligible_for_expression` |
| E question | `question(70)` | `ask`, score 70, hard | `eligible_for_expression` |
| F curiosity take | live `take(55)` | `share`, score 55, hard | `eligible_for_expression` |
| G own-time | reportable own-time constraint plus no proactive material | `silence`, score 0, terminal | `thought_silence` |
| H redacted | redacted source excluded; only `silence_ok(8)` remains | `silence`, score 0, terminal | `thought_silence` |
| I observe-only | observe-only source excluded from influence; only `silence_ok(8)` remains | `silence`, score 0, terminal | `thought_silence` |
| J pause/contact | no Thought input; eligibility tested first | `proactive_paused` / `chat_in_progress` | Thought not reached |

The same disposable test also probes current persistence and capability gates,
not only synthetic `Motivation[]` values. Its observed producer outputs were:

| Current-source probe | Disposable input | Observed collected material |
|---|---|---|
| Callback | Active `recall` + `mind_state`; persisted `concern` with activation `0.8`, urgency `0.7`, episode source | `callback`, score `75.5`, `refType: "mind_state"` |
| Reminder | Active `recall`, `mind_state`, `thought`, `relationship_state`, and `relational_initiative`; due unredacted `doc_reminder` | `reminder`, score `72`, `refType: "doc_reminder"` |
| Question | Persisted `about_self` question with priority `20` | `question`, score `70`, `refType: "question"` |
| Curiosity take | Active `reading` + `curiosity_consolidation`; live `read_record` read and live take | `take`, approximately score `55`, `refType: "take"` |
| Redacted | Same due reminder source, then relationship redaction | Empty material set |
| Observe-only | Live-looking disposable take while `cognitionMode` is `observe` | Empty material set |

For C-G, `eligible_for_expression` in the matrix means only that the
deterministic floor did not refuse the candidate. It is not a predeclared
speech outcome. The model was disabled for these cases and no provider was
contacted; any future model decision remains a separate observed result.

The empty disposable surface collected exactly two identity boundary
motivations at score 40 and `silence_ok(8)`. Boundaries are excluded from
proactive interruption selection, leaving no candidate and producing
`thought_silence`. This is the primary explanation for the currently
dominant proactive result when the observed tick has already passed
eligibility.

### Root cause and decision

| Silence mechanism | Classification | Evidence |
|---|---|---|
| No grounded material / only boundaries and `silence_ok` | Correct deterministic restraint | The exact empty collection has no eligible candidate after `decide` exclusions. |
| Weak material below 25 | Correct deterministic restraint | The callback-20 fixture returns terminal silence and `thought_silence`. |
| Pause, contact, daily cap, disabled, unavailable, idle floor | Correct pre-Thought restraint | Eligibility returns a closed reason and does not call Thought. |
| Redacted or forgotten source | Intentional material removal | The current-source redaction probe returns an empty collected set. |
| Observe-only or shadow material | Capability/provenance gate | The current-source observe probe returns an empty collected set; this is required by write-time authority. |
| Callback, reminder, question, or live curiosity take | Connected source | Current-source probes produce structured material; the deterministic floor preserves it at scores 70-75.5 or approximately 55. |
| Own-time return report | Deliberately reactive-only producer | The real owner-time path builds a reactive constraint; proactive eligibility stops on an open own-time state and `tickProactive` never builds the report constraint. |
| Self/mutual commitments, tensions, withdrawals, scheduled intent | Missing/disconnected producer or reader | Persistence and some handlers exist, but no current proactive motivation reader reaches Thought. Adding one would change relationship/initiative authority and is not a narrow floor fix. |
| Model/provider failure | Downstream/configuration issue, not `thought_silence` | Model Thought is optional and fallback is deterministic; the observed Mistral 402 occurs in downstream Expression delivery tests, after this floor would have passed. |

Primary root cause: expected Thought/Agency policy behavior, not a source
defect. The current surface has no qualifying proactive material, so the
deterministic floor correctly refuses to turn baseline boundaries or
`silence_ok` into an unsolicited interruption. The 402/offline issue is a
separate test-isolation defect and is downstream of this floor; it cannot
produce `thought_silence` because Expression is never reached.

No narrow INIT-02 source fix was made. Lowering the 25-point floor, adding
random initiative, or increasing frequency would change human-behavior
policy and is not authorized by this audit. The missing scheduled and broader
relationship producers are authority/design questions, not grounds for
silently inventing material. The one source change in the current dirty
worktree remains the previously accepted initiative reservation transaction;
the additional sandbox fixture correction is test-only and unrelated to
Thought.

Recall consequence: none. Recall state, provenance promotion, capability
promotion, cutover, qualification counters, production evidence, and
deployment were untouched. Any future producer that depends on Recall,
Mind State, reading, or relationship influence still requires its existing
capability and human governance gates.

## Recall and rollout recommendation

Recall was untouched. No Recall evidence was promoted, no production
configuration was changed, and no canary was executed. The recommendation is

    WAIT UNTIL RECALL CANARY

After that human gate, the sandbox release packet still requires its separate
Mint qualification and activation authorization. Phase F must remain blocked
until the missing Ashley-owned admission authority is designed and accepted.

## Local verification record

The implementation included red-proof tests for the orphaned initiative row,
process-local nonce replay, stale broker readiness, and incomplete client
readiness. Final focused verification passed:

- earlier agent-service acceptance focus: 6 files, 147 tests;
- sandbox-broker: 5 files, 72 tests;
- INIT-02 matrix: 1 file, 2 tests;
- final Agency/Thought/runtime focus: 7 files, 59 tests;
- final current targeted Agency/Thought/runtime rerun: 7 files, 42 tests;
- directly affected sandbox readiness focus: 2 files, 8 tests;
- delegated sandbox-broker wiring focus: 1 file, 4 tests;
- provider-safe delivery focus: 1 file, 9 tests;
- agent-service, sandbox-broker, and discord-bot TypeScript builds;
- git diff --check, with only the repository's existing LF/CRLF warnings.

The root phase0:offline wrapper now completes through the isolated full agent
suite without reaching a provider. No live-Mistral evaluation was run. No
commit or push was performed.
