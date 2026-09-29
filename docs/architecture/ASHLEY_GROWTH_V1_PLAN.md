# Ashley Growth V1 — Memory, Inner Life, and Growth

Status: PROPOSED 2026-09-29 (awaiting Owner acceptance)
Scope: v0.2.1 cognition (`apps/agent-service/src/core/cognitive-v021/`) plus
selected designs ported from the stale pre-v0.2.1 cognition.
Author: principal engineer (Claude), from Owner direction in session.

## 0. Owner decisions this plan is built on (2026-09-29)

- Ashley should be a persistent autonomous cognitive entity: identity,
  learned outcomes from experience, taste and personality that develop over
  time. "Ashley deserves a sophisticated system."
- Model economics: all cognition runs on Muse Spark 1.3 at xhigh
  (Command Code contributor plan; cost is not a design constraint).
- No quiet hours. Ashley may reach out whenever she judges it worth it.
- Time limits stay: 1 h Thought deadline, 65k output ceiling (long CLI work
  must be deliverable; retry exists).
- Interests: a 50-item pool (Appendix A). Ashley chooses her own starting
  set from it; tastes then evolve from experience.
- Old cognition is stale but reusable where the design is good (§9).
- Sims embodied time is a separate clock that bypasses the inner-life rhythm.
- Direct vision (Thought sees pixels) — done, commit 94be5b6.
- Expression rewrite retired — done, commit d933e00.

## 1. Why this plan exists (production evidence, 2026-09-29, read-only)

After 42 published replies on fresh state:

| Finding | Evidence |
|---|---|
| Zero durable memories | `durable_nominations`/assertions empty; no settlement ever carried `durableNominations` |
| Thought is never told when to remember | Output contract has the field, no guidance |
| Automatic admission accepts 1 of 11 kinds | `FROZEN_AUTOMATIC_ADMISSION_ALLOWLIST = ["learned_self_evidence"]`; Owner-facing kinds only via explicit "remember:" |
| Conversation window = 12 rows | `DEFAULT_LAST_N_TURNS = 12` |
| Recall is lexical only | BM25 tiers, fuse 16 hits / 12 KB; no salience, recency, reinforcement, or always-on core |
| Deliberate recall is dead | `memory.lookup` declared, no executor |
| Episodes are dead | `createEpisode` has no live caller |
| Inner life never ran | `PERIODIC_COGNITION_ENABLED` unset on Mint → 0 periodic cycles; all 53 wakes were Owner messages |
| Cadence is crude | 4 h opportunity, private budget 4 Thought calls/hour |
| No mood | v0.2.1 has no affect input |
| Identity frozen | 8 seeded `identity_entries`, never revised; growth modules (learning, reflection, affect, c2–c5) are stale-architecture and unwired |

## 2. Principles

1. **Thought authors meaning; the Host keeps mechanics.** Every memory,
   reflection, appraisal, opinion, and revision is authored by Ashley's
   Thought. The Host schedules, stores, grounds, ranks, decays, forgets, and
   enforces — it never invents content or importance.
2. **Grounded or labelled.** A memory about Doc or the world must point at
   real evidence (a message span, an observation, a receipt). Ashley's own
   interpretations are allowed but always labelled as hers.
3. **Everything forgettable.** Every new store joins the existing `/forget`
   cascade. A forget that lands first always wins over late background work.
4. **Honest life.** Ashley may describe only what her activity journal
   records. An inner life replaces "nothing happened" with "here is what I
   actually did" — never with invention.
5. **Slow things change slowly.** Moment-level reactions are cheap; opinions
   need repeated evidence; traits need evidence over weeks; values and
   boundaries need Ashley's affirmation and Doc's approval.
6. **Reuse v0.2.1 substrate.** Concerns, future triggers, subscriptions,
   durable nominations, assertions/supports/lineage, wakes, the private
   budget ledger, and the kernel path are extended, not bypassed.

## 3. Architecture: four time scales

```
 MOMENT      (each turn)        perceive → recall → think → speak → nominate memories, appraise
 AFTERGLOW   (~20 min quiet)    reflect on the conversation → episode, missed memories, self-evidence
 DAY         (awake rhythm)     musing passes: questions, reading, takes, plans, reaching out
 NIGHT       (daily)            consolidate: merge/supersede memories, review growth, update narrative
 LONG ARC    (weekly)           "who I am becoming" narrative; trait-level revisions
```

All passes are ordinary v0.2.1 Thought cycles on the kernel path with a
distinct wake cause, so settlement, authority, fidelity, delivery, and
forget semantics apply unchanged.

## 4. Memory (layer A)

### 4.1 What is worth remembering (Thought guidance)

Added to the Thought output-contract guidance (not to identity prompts):

- Doc: preferences, dislikes, self-descriptions, goals, plans, projects,
  people in his life, boundaries, running jokes, things he is waiting on.
- Shared: moments that mattered, decisions made together, promises either
  side made, open threads.
- Ashley herself: her stated opinions and choices, what she enjoyed or found
  boring, what she learned about herself, questions she wants to pursue.
- Not: small talk with no future value, anything Doc asks not to keep,
  secrets (classification `secret` is never admitted).

Guidance is explicit that remembering is normal, frequent, and cheap: "If
you would want this next week, nominate it."

### 4.2 Formation paths

1. **In-turn** (MOMENT): Thought emits `durableNominations` alongside speech.
2. **Afterglow** (§5.2): a reflection pass over the finished conversation
   catches what the live turn missed and writes the episode.
3. **Night** (§5.4): consolidation merges duplicates, supersedes outdated
   memories via lineage, and promotes repeated self-evidence.

### 4.3 Admission — grounded automatic admission

Replace the one-kind allowlist with a grounding rule applied to every kind:

| Kind | Admitted automatically when |
|---|---|
| `owner_preference`, `owner_self_description`, `owner_goal`, `relational_boundary`, `commitment` | at least one `conversation_text_span` supportRef resolves to an Owner message, and the quoted span is found verbatim (port of the old "literal quote" rule) |
| `owner_world_claim`, `project_knowledge` | as above, or an observation/receipt ref resolves |
| `shared_episode` | evidence refs resolve to the conversation(s) it summarizes |
| `ashley_interpretation`, `open_question`, `learned_self_evidence` | always admissible as Ashley-authored (dimension `source` = Ashley); labelled as interpretation in recall |

Ungrounded Owner-facing claims are rejected with a recorded reason (the
existing `admission_skipped_provenance`), never silently pending forever.
Supersession (`supersedesRef`) and retraction keep working.

### 4.4 Episodes (port of the old episode design, v0.2.1-native)

New sidecar table `episodes_v2`:
`episode_id, conversation_id, started_at_ms, ended_at_ms, evidence_row_ids
(exact message links), summary (Ashley's words), tone, salience (0–1,
Thought-assigned), unresolved_threads[], ashley_takeaway, data_classification,
forgotten_at_ms`. FTS5-indexed on summary + takeaway. Joins the forget
cascade (topic match over summary/takeaway; message-level forget redacts
linked episodes).

### 4.5 Memory strength

Per assertion and episode, Host-maintained: `salience` (set by Thought at
formation, revisable at night), `recall_count`, `last_recalled_at_ms`,
`last_used_at_ms` (cited in evidenceUse). Ranking score =
salience × recency decay (half-life ~30 days on last use) × reinforcement
(log(1+uses)). Decay affects ranking only — nothing is deleted by decay.

### 4.6 Recall

1. **Core profile (always present):** top ~12 Doc facts and top ~8 Ashley
   self-facts by strength, plus current open commitments. Small, stable,
   always in Thought input.
2. **Associative:** existing BM25 tiers over assertions + episodes +
   conversation log, then re-ranked by strength; fuse raised to 32 hits /
   24 KB.
3. **Deliberate:** implement the dead `memory.lookup` operation (Owner-
   private, read-only, bounded): free-text + kind filter → ranked
   assertions/episodes. Ashley can go and look.
4. **Recency window and continuity (no cliff at message 41):**
   - last 40 rows verbatim (`DEFAULT_LAST_N_TURNS` 12 → 40);
   - a **thread story** — a rolling narrative of everything older than the
     window, rewritten by each afterglow and always present;
   - episodes and memories recalled by relevance;
   - the full log stays searchable forever. The Discord `/new` command
     (which archived the thread and hid prior conversation from log search)
     was retired 2026-09-29 by Owner decision; G1 also widens log search to
     all of Doc's Owner-private threads so older archived threads stay
     reachable. The `/memory/newthread` HTTP route remains for eval
     harnesses only;
   - rule 2 of §5.1 guarantees no row leaves the window unreflected.
5. **Clock:** Thought input gains the current local time, weekday, the
   Owner's timezone (UTC+3), and time since the last exchange. Today she
   sees only raw epoch-ms timestamps on messages.

### 4.7 Visibility

`/memory` shows what Ashley remembers (by kind), episodes, and strength;
`/forget` covers episodes and journal entries.

## 5. Inner life (layer B)

### 5.1 States

| State | Enter | Behaviour |
|---|---|---|
| ENGAGED | Owner message | normal turns |
| AFTERGLOW | 30 min of silence after unreflected conversation | light reflection (§5.2) |
| AWAKE | every 3 h (jittered ±20 min) | big "own time" pass (§5.3) |
| NIGHT | once per 24 h, at the quietest learned hour | consolidation pass (§5.4) |
| EMBODIED | a Sims session armed | inner rhythm yields; Sims clock drives wakes (§5.7) |

Doc messaging always pre-empts; no state delays a reply.

**Harmony rules (Owner 2026-09-29):**
1. *Watermarks, not timers.* AFTERGLOW covers exactly the conversation
   rows after the previous afterglow's watermark. Each new message restarts
   the 30-min silence clock. Example: talk at 10:00 and 10:20 → one
   afterglow at 10:50 covering both. Coverage is by row range, so nothing is
   reflected twice and nothing is skipped; rows arriving during an
   afterglow belong to the next one.
2. *Window pressure.* If unreflected rows exceed 30 during a long
   conversation, a background rolling afterglow runs early so nothing leaves
   the verbatim window unreflected (§4.6).
3. *Layering.* AWAKE never re-reads raw conversation; it consumes the
   afterglows/episodes written since its own watermark. If an afterglow is
   due, it runs first and AWAKE waits for it.
4. *Single flight.* One inner pass at a time; ENGAGED pre-empts and the
   pass resumes after the next afterglow.
5. Ashley's self-scheduled future triggers fire on their own time in any
   state except EMBODIED (where they queue).

### 5.2 Afterglow reflection

Input: the conversation since the last reflection, current core profile,
mood, open questions. Output (Thought-authored): one episode, any missed
nominations, self-evidence ("that debate energised me"), expectation checks
(§6.5), new open questions, optional future triggers ("ask Doc how the
interview went on Friday").

### 5.3 Musing passes — the inner agenda

The Host assembles an **inner agenda** (it chooses nothing):
open questions, active concerns, due self-scheduled triggers, unread items
from subscriptions/curiosity feeds within her interests, unresolved episode
threads, recent mood. Thought chooses what to do this pass:

- **think** — revisit a question or thread, form/adjust an opinion;
- **read** — web search/fetch or a subscribed feed item, then write a take;
- **plan** — schedule future triggers, subscribe to a source;
- **reach out** — message Doc when something earns it;
- **rest** — do nothing (a legitimate choice; recorded).

Every pass writes an **activity journal** entry (what she did, refs to
reads/observations). The honesty licence is extended to journal entries, and
the identity prompt line "Do not invent a life between messages" becomes
"Describe your time between messages only from your activity journal."

### 5.4 Night consolidation

Merge near-duplicate memories (supersede), re-score salience, promote
repeated self-evidence into revision proposals (§6.2), close stale open
questions, and write a one-paragraph diary entry for the day.

### 5.5 Reaching out

Thought decides. Host constraints are mechanical only: no quiet hours; a
runaway fuse (≤ 12 unsolicited messages / 24 h); and **learned restraint**
— the Host supplies reaction evidence (reply or not, reply latency, emoji)
to Thought as input, and Ashley's own calibration (§6.5) decides her
pacing. No generic check-ins by contract (existing proactive prompt).

### 5.6 Budget and cadence

Private budget 4 → 12 Thought calls per rolling hour (Owner). It counts
only Thought calls Ashley makes on her own initiative (afterglow, AWAKE,
NIGHT, self-scheduled triggers); replies to Doc are never counted. It is a
runaway fuse, not the rhythm: one AWAKE pass may use several calls
(e.g. read → take → decide to message). `PERIODIC_COGNITION_ENABLED=true` on Mint as part of rollout. Old 4 h
cadence replaced by the state machine above.

### 5.7 Sims embodied clock

While a Sims session is armed (`ashley_e1.start` … `stop`, and later E3
bound perception), a separate embodied scheduler owns her wakes: game
events and game-time rhythm, not the 45–75 min musing cadence. On stop,
AFTERGLOW runs over the play session (it becomes an episode). Designed
concretely with E3; this plan only reserves the seam.

## 6. Growth (layer C)

### 6.1 Self-evidence

`learned_self_evidence` memories are written in afterglow, musing, and
night passes: what she enjoyed, found boring, believed, changed her mind
about, did well/badly. They are the fuel for every revision.

### 6.2 Revision engine (port of `learning/revisions.ts`)

| Layer | Examples | Applies when |
|---|---|---|
| Opinion | "Dub techno is best at 3am" | ≥ 2 evidence |
| Taste / dynamic identity | interests, style, humour | ≥ 2 evidence over ≥ 2 days |
| Stable trait | "patient with messy problems" | ≥ 3 evidence over ≥ 14 days, then 72 h delay |
| Value / boundary | foundational | Ashley affirms AND Doc approves (`/identity`) |

Every applied revision appends a new `identity_entries` row with
`revised_from`, keeps evidence links, and is revertible. Seeded core values
remain until revised through the foundational path. Thought proposes;
the Host checks thresholds; nothing is applied on a single impulse.

### 6.3 Taste and interests

**Interest graph (Owner 2026-09-29).** The 50 Appendix A interests are
her **core roots** — stable, all hers from day one. Specific tastes are
**branches** under roots, each with a strength that moves only with lived
evidence (reads she valued, conversations, takes, reactions). Nobody
retires anything: the two seeded `taste` entries are re-homed as her first
branches (dub techno → Electronic music; open-weight AI → Artificial
intelligence; database internals, small sharp tools, software architecture →
Technology; essays that argue → Books & essays; systems-heavy games → Video
games). Branches she lives with grow and sprout new branches; branches she
never touches fade in ranking but stay in history. The taste line of her
identity is regenerated from her strongest branches at NIGHT, through the
revision engine, so it changes because she changed.

### 6.4 Mood (port of `state/affect.ts`)

Four dimensions — valence, energy, openness, tension — event-sourced.
Thought authors an **appraisal** each turn/pass (what moved her and why);
the Host applies bounded deltas and hourly decay toward baseline (0.85/h).
Mood is an input to Thought, never a script for it.

### 6.5 Expectations and calibration (light port of c4)

Thought may record an expectation ("Doc will enjoy this article"). Afterglow
or night checks it against what happened (reply, reaction, explicit words)
and records the outcome as self-evidence ("I overestimate how much he likes
long takes"). This is how experiences become learned outcomes.

### 6.6 Narrative self

Weekly LONG ARC pass: "who I am becoming" — a short autobiographical summary
maintained as a dynamic identity entry, visible to Doc, grounded in the
week's episodes and revisions.

## 7. Authority boundaries

- Thought: all content (memories, episodes, appraisals, opinions, takes,
  proposals, decisions to reach out).
- Host: schedules, grounding checks, thresholds, strength arithmetic,
  decay, fuses, forget cascade, delivery.
- Doc: values/boundaries approval; `/forget`; `/proactive pause`.
- Unchanged: constitution/identity precedence; fidelity and honesty checks;
  no external effects beyond existing capability gates.

## 8. Data model additions

Sidecar: `episodes_v2` (+FTS), `memory_strength`, `activity_journal`,
`inner_state` (state machine), `expectations`, `interest_strength`.
Nuclear (reuse existing tables): `learning_revisions`, `evidence_links`,
`identity_reviews`, `opinions`, `affective_state`, `affective_events`.
All new rows carry `data_classification` and join the forget cascade.

## 9. Reuse ledger (stale cognition → v0.2.1)

| Source | Decision |
|---|---|
| `learning/revisions.ts` | Port semantics (§6.2); reuse tables |
| `state/affect.ts` | Port (§6.4); reuse tables |
| old episode schema + literal-quote rule | Port (§4.3, §4.4) |
| `curiosity/*` (feeds, probation, grounded reads, takes) | Reuse; feed the inner agenda |
| `state/questions.ts` | Port as `open_question` memories + agenda |
| `reflection/*` reaction learning | Idea only; generalised to reply/latency (§5.5) |
| c4 predictions/calibration | Idea only; light rebuild (§6.5) |
| own-time sessions | Superseded by activity journal (§5.3) |
| agency, open-items, context-allocation | Leave (v0.2.1 has native equivalents) |
| learned-autonomy | Shelve until Sims agency |

## 10. Delivery phases

Each phase: focused red/green tests, typecheck, commit, deploy on Owner
go, production witness (read-only DB evidence), honest verdict.

| Phase | Content | Witness |
|---|---|---|
| G1 Memory formation | contract guidance, grounded admission, strength table, core profile, window 40 + thread story, cross-thread log search, clock/sense of time, `memory.lookup` | memories appear after ordinary chat; recalled next day |
| G2 Afterglow + episodes | state machine (ENGAGED/AFTERGLOW), `episodes_v2`, forget cascade | an episode per conversation; forget removes it |
| G3 Inner life | AWAKE musing, agenda, journal + honesty licence, budget, periodic enable, curiosity feeds, interest choice | journaled passes; a grounded unsolicited message |
| G4 Growth | revision engine, mood, expectations/calibration | a revision applied from real evidence; mood moves and decays |
| G5 Night + long arc | consolidation, diary, weekly narrative | nightly diary; weekly narrative |
| G6 Sims seam | embodied clock bypass | with E3 |

**G1 implementation status (2026-09-29, not yet deployed).** Implemented:
formation guidance, grounded admission for all kinds (decided once),
salience + `memory_strength` (sidecar v36), core profile, strength
re-ranking, fuse 32/24 KB, window 40, recall across every Owner-private
thread, the clock, and `memory.lookup`. Moved to G2: the rolling thread
story, because its only writer is the afterglow pass; until then rows
older than the window stay reachable through log search, memories, and
`memory.lookup`. Also deferred: "open commitments" in the core profile
(commitment-kind memories are included; live commitment state is not).

**G2 implementation status (2026-09-29, not yet deployed).** Implemented:
the AFTERGLOW pass (30-min silence and 30-row rolling triggers, row
watermark, single flight, 3 attempts, then that stretch is skipped),
`episodes_v2` with FTS, the rolling thread story (always present in
Owner-private Thought input), episodes in Thought input and in
`memory.lookup`, the forget cascade over both, and `/memory` showing story
and episodes (sidecar v37). An afterglow is a private `idle_opportunity`
cycle marked by its inbox payload, so the existing wake, budget, kernel,
settlement, and delivery paths apply unchanged. It is never offered public
presence. Deferred to G3 with the AWAKE state: layering rule 3 (AWAKE
waits for a due afterglow), expectation checks (§6.5), and mood.

**G3 implementation status (2026-09-29, not yet deployed).** Implemented:
- *AWAKE* (`initiative/awake.ts`): a private pass every 3 h, jittered by up
  to ±20 min; the first comes 20 min after the rhythm starts. It is a private
  `idle_opportunity` cycle like the afterglow. Layering rule 3: AWAKE waits
  while the Owner conversation is live, and a due afterglow runs first. Each
  pass consumes the episodes written since the previous pass. Afterglow and
  AWAKE share one single-flight poll (`serve.ts`), so only one inner pass
  runs at a time.
- *Inner agenda* (`initiative/agenda.ts`): new episodes, unresolved
  threads, open questions, all 50 interest roots with the strongest
  branches, and reach-out evidence (unprompted messages in 24 h, whether
  and how fast the Owner replied). Due triggers, concerns, and
  subscriptions still arrive through the ordinary input. "Read" means
  Thought's own `web.search`/`web.fetch`. The nuclear curiosity feeds were
  not wired in: fresh state has no sources, and Ashley can subscribe
  through `subscriptionDeltas`.
- *Activity journal* (`initiative/journal.ts`): one entry per private
  pass. The Host records the pass kind, the page and text observations
  read in that cycle, and whether she spoke. Ashley writes the entry (the
  `journal` settlement field). A "read" with nothing read loses the label.
  The journal is in every Owner-private Thought input. The honesty licence
  extends to it: a reading claim may cite a journal read's observation, and
  fidelity checks it against the real, unredacted observation. `core.md`
  now reads "Describe your time between messages only from your activity
  journal."
- *Interest graph* (`memory/interests.ts`): the 50 roots are fixed, and
  branches grow only when a settlement records `interests`. Strength is
  (1 + ln(1 + lived)) × a 30-day half-life. The 8 seeded tastes are
  re-homed as seed branches (sidecar v38).
- *Reaching out* (`initiative/reach-out.ts`): a runaway fuse of 12
  unprompted messages (idle, future trigger, subscription) per 24 h,
  enforced at publication.
- *Budget*: private budget 4 → 12 per hour.
- *Periodic*: `PERIODIC_COGNITION_ENABLED` now switches AWAKE on, and the
  old 4 h periodic schedule is retired (the idle tick passes
  `periodicCognitionEnabled: false`).
- The journal and interest branches join the forget cascade.
- `/memory` shows "Own time lately" and "Growing interests".

Deferred to G4: mood, expectations/calibration. Deferred to G5: the NIGHT
pass regenerating the identity taste line from the strongest branches.

**G4 implementation status (2026-09-29, not yet deployed).** Implemented
in `cognitive-v021/growth/` (sidecar v39):
- *Where it lives.* Section 8 named the nuclear `learning_revisions`,
  `affective_*` and `identity_reviews` tables. G4 keeps its records in the
  sidecar instead, like G1–G3, so they join the v0.2.1 forget cascade; the
  stale tables stay unwired. Applied identity revisions still land in
  `nuclear.db:identity_entries`, the canonical identity store.
- *Revision engine* (`revisions.ts`): Thought proposes (`growth.revisions`)
  and cites evidence; the Host resolves it (live memory keys, episodes,
  journal entries, checked expectations) and applies at the §6.2
  thresholds. Proposals to one target (an opinion topic, an identity entry
  id, or a new entry's topic) accumulate evidence, and her latest wording
  stands. A taste may revise only a taste, and so on. Vision and core
  principles are not revisable here. Evidence a forget removes stops
  counting, and a ripe trait falls back and waits again.
- *Values and boundaries*: Ashley affirms, objects, or defers
  (`growth.revisionPositions`) in a pass after the one that proposed it; the
  Owner approves, rejects, or defers through `/identity`, which now reads
  `/growth/identity/reviews`. A new wording clears both positions. The old
  `/nuclear/identity/reviews` routes are unchanged and no longer fed.
- *Identity is read per cycle* (`KernelDeps.readConstitution`), so an
  applied revision reaches the next Thought without a restart.
- *Revert*: `POST /growth/revisions/revert` (Owner) removes the appended
  entry and relinks what revised it; an opinion falls back to the one it
  replaced. Not yet exposed as a Discord action.
- *Mood* (`mood.ts`): four dimensions, one appraisal per cycle, deltas
  bounded to ±0.3, continuous decay ×0.85/h toward baseline (valence 0,
  energy 0.5, openness 0.5, tension 0). The reason is dropped once settled.
- *Expectations* (`expectations.ts`): recorded, checked in a later cycle
  with an outcome and lesson, expired after 14 days unchecked. A checked
  one is citable self-evidence. §6.5's "the outcome becomes self-evidence"
  is met by that citation; the guidance also invites her to nominate the
  lesson as `learned_self_evidence`, but the Host does not write memories
  on her behalf.
- Growth is recorded after publication on every Owner-private settlement,
  so a trait whose 72 h wait ran out applies on the next one. A growth
  claim on a settlement that a forget already redacted is dropped.
- `/memory` shows mood, opinions, and recent identity changes.

Not in G4: the NIGHT pass that promotes self-evidence and regenerates the
taste line (G5), and a Discord action for revert.

**G5 implementation status (2026-09-29, not yet deployed).** Implemented
(sidecar v40):
- *NIGHT* (`initiative/night.ts`): a private pass once per 24 h at the
  Owner's quietest learned hour: Owner messages over 28 days are bucketed by
  local hour, each hour weighed with its neighbours; 04:00 until 20 messages
  exist. The next night is the quiet hour at least 12 h ahead, so a late
  night or a moving hour never gives two in one day. It follows the AWAKE
  layering (a live conversation and a due afterglow come first), shares the
  single-flight poll, runs before AWAKE, and is switched with it by
  `PERIODIC_COGNITION_ENABLED`.
- *Consolidation* (`growth/night.ts`): the agenda gathers the day, her
  memories with the pairs whose words overlap (a hint, never a verdict),
  self-evidence, questions untouched for 14 days, and her taste entries
  beside her 16 strongest branches. Merging and superseding use the
  existing `durableNominations.supersedesRef`; promotion uses
  `growth.revisions`. The new `night` field carries the diary, re-scored
  salience (`memory_strength`), and closed questions (live off, words kept).
- *Taste line*: regenerated through the revision engine as an ordinary taste
  revision. A branch she has lived (`interest:<branchId>`) is now citable
  evidence, dated by when she last lived it; a seed she never lived is not.
- *Long arc*: when seven days have passed since the last one (12 h of
  slack), the night is weekly and also writes "who I am becoming", grounded
  in the week's episodes, applied changes, and the previous narrative.
  §6.6 called it a dynamic identity entry; it is kept in the sidecar
  (`self_narratives`) instead, so it joins the forget cascade, and it is
  shown in every Owner-private Thought input and at the top of `/memory`.
- Diary entries and narratives join the forget cascade (all three paths).

Not in G5: the Sims embodied clock (G6).

## 11. Open points (Owner)

None blocking. Owner-set: AFTERGLOW 30 min (watermarked), AWAKE 3 h,
private budget 12/h. Defaults: window 40 + thread story, runaway fuse 12
unsolicited/24 h, recall fuse 32/24 KB. All tunable.

## Appendix A — Interest pool (50)

Electronic music; Technology; Artificial intelligence; Psychology & the
mind; Neuroscience; Video games (strategy & systems); Philosophy; Science &
space; Internet culture; Film & TV; Books & essays; Design & architecture;
History; Politics & society; Music production & sound; Art & visual
culture; Fashion & style; Food & cooking; Nature & animals; Economics &
markets; Language & words; Math & puzzles; True crime & mysteries; Cities &
travel; Esports & competition; Mythology & the strange; Health & the body;
Comedy & humour; Photography; How people behave in relationships; Theology;
Psychopharmacology; Psychedelia; Absurd humour; Mysticism & religious
experience; Consciousness studies; Dreams & altered states; Ethics & moral
dilemmas; Existentialism & meaning; Occultism & esoteric history;
Comparative religion; Surrealism & dada; Cult films & weird cinema;
Experimental & ambient music; Sci-fi & speculative fiction; Cognitive
biases; Drug policy & harm reduction; Cosmology & big questions; Folklore &
urban legends; Satire & dark comedy.
