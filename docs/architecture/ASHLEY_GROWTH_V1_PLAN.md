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
4. **Recency window:** `DEFAULT_LAST_N_TURNS` 12 → 40.

### 4.7 Visibility

`/memory` shows what Ashley remembers (by kind), episodes, and strength;
`/forget` covers episodes and journal entries.

## 5. Inner life (layer B)

### 5.1 States

| State | Enter | Behaviour |
|---|---|---|
| ENGAGED | Owner message | normal turns |
| AFTERGLOW | 20 min after last exchange | one reflection pass (§5.2) |
| AWAKE | after afterglow | musing passes every 45–75 min (jittered) |
| NIGHT | once per 24 h, at the quietest learned hour | consolidation pass (§5.4) |
| EMBODIED | a Sims session armed | inner rhythm yields; Sims clock drives wakes (§5.7) |

Doc messaging always pre-empts; no state delays a reply.

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

Private budget 4 → 30 Thought calls/hour (runaway fuse, not a pacing
tool). `PERIODIC_COGNITION_ENABLED=true` on Mint as part of rollout. Old 4 h
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

The two seeded `taste` identity entries (Owner-derived and too specific) are
retired at G3 rollout by an appended revision (`revised_from` kept, so
history is preserved), replaced by "curious across a wide pool; choosing and
discovering my own tastes". Ashley's first reflection after rollout then
chooses a starting set from the Appendix A pool (her choice, recorded as
self-evidence). Interest strength
then moves with engagement (reads she valued, conversations she started,
takes she wrote). She may add interests outside the pool; unused interests
fade in ranking but are never erased from history.

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
| G1 Memory formation | contract guidance, grounded admission, strength table, core profile, window 40, `memory.lookup` | memories appear after ordinary chat; recalled next day |
| G2 Afterglow + episodes | state machine (ENGAGED/AFTERGLOW), `episodes_v2`, forget cascade | an episode per conversation; forget removes it |
| G3 Inner life | AWAKE musing, agenda, journal + honesty licence, budget, periodic enable, curiosity feeds, interest choice | journaled passes; a grounded unsolicited message |
| G4 Growth | revision engine, mood, expectations/calibration | a revision applied from real evidence; mood moves and decays |
| G5 Night + long arc | consolidation, diary, weekly narrative | nightly diary; weekly narrative |
| G6 Sims seam | embodied clock bypass | with E3 |

## 11. Open points (Owner)

None blocking. Defaults chosen: AFTERGLOW 20 min, AWAKE 45–75 min, runaway
fuse 12 unsolicited/24 h, window 40, recall fuse 32/24 KB. All tunable.

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
