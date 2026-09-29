# Memory and recall

## v0.2.1 memory (current cognition)

Ashley's v0.2.1 memory lives in the cognitive sidecar
(`apps/agent-service/src/core/cognitive-v021/memory/`), with retrieval in
`retrieval/` and Thought input assembly in `thought/input.ts`. The Growth V1
design is [ASHLEY_GROWTH_V1_PLAN.md](architecture/ASHLEY_GROWTH_V1_PLAN.md).

**Formation.** Thought nominates memories (`durableNominations`) alongside
its speech; the contract tells it what is worth keeping and how to ground
it. Admission is automatic and grounded per kind (`memory/grounding.ts`):
claims about the Owner must quote the Owner's own message verbatim in a
`conversation_text_span`; world and project facts may use an observation or
receipt instead; shared episodes quote either side; Ashley's own kinds
(`ashley_interpretation`, `open_question`, `learned_self_evidence`) need no
quote and stay labelled as hers. An Owner quote may come from any
Owner-private conversation, not only the nominating one; a row from another
conversation grounds only if it resolves to the Owner. A memory replaces
another (by `supersedesRef` or the same key) only if its kind needs at least
the same grounding, so her interpretation never retires what the Owner said;
a replacement inherits the old memory's still-resolvable quotes, so a merged
Owner fact stays grounded. Each nomination is decided once and the
decision is logged in `admission_log`. `/remember` and `remember:` still
admit directly.

**Strength.** `memory_strength` holds Thought's salience (0-1) and the
Host's recall and use counts. Strength = salience x 30-day half-life since
last use x (1 + ln(1 + uses)). It orders recall and never deletes.

**Recall.** Every Owner-private Thought receives:
- a clock (local time and weekday in the Owner's zone, time since each side
  last spoke; `ASHLEY_OWNER_TIME_ZONE`, UTC+3 by default);
- the last 40 conversation rows verbatim;
- a core profile: the strongest 12 memories about the Owner and the
  strongest 8 of Ashley's own;
- associative retrieval: exact keys, then BM25 over memories (re-ranked by
  strength) and over the conversation log of every Owner-private thread
  and trusted room, within a 32-hit / 24 KB fuse;
- the thread story and her most recent and most relevant episodes (below);
- `memory.lookup`, a read-only Owner-private observation Ashley can choose
  to search her own memories and episodes deliberately.

**Afterglow, episodes, thread story.** When the Owner conversation has been
quiet for 30 minutes, or more than 30 rows are waiting during a long one,
the Host runs a private Thought over exactly the rows Ashley has not
reflected on yet (`initiative/afterglow.ts`; watermark in `afterglow_state`).
In it Ashley writes an episode of that stretch (`episodes_v2`, FTS-indexed,
linked to the exact rows) and rewrites the thread story, the running
narrative of the whole conversation (`thread_stories`). She may also
nominate memories she missed. The Host decides only when; Ashley writes
every word. Each stretch is reflected once. After 3 failed attempts that
stretch is skipped, and its rows stay searchable in the log. The pass
uses the private Thought budget, never runs while a turn is in progress,
and can be turned off with `ASHLEY_AFTERGLOW_ENABLED=false`. `/memory` shows
the thread story and recent episodes.

**Own time, journal, interests.** Every 3 hours (±20 min) Ashley gets an
AWAKE pass (`initiative/awake.ts`). It waits while the Owner conversation is
live and lets a due afterglow go first. It is switched on by
`PERIODIC_COGNITION_ENABLED=true`, which replaced the old 4-hour periodic
schedule. The pass gets an inner agenda (`initiative/agenda.ts`): new
episodes, open threads and questions, her interests, and how her recent
unprompted messages landed. She chooses to think, read (her own
`web.search`/`web.fetch`), plan, reach out, or rest.

Every private pass leaves an activity-journal entry
(`initiative/journal.ts`): the Host records what she read in that cycle and
whether she spoke, and she writes the entry. The journal is in every
Owner-private Thought input, and she may describe her time between messages
only from it. A reading claim may cite a journal read, and fidelity checks
it against the real observation.

Interests (`memory/interests.ts`) are 50 fixed roots with branches that grow
only when a settlement says she lived them, and fade over a 30-day
half-life otherwise.

At most 12 unprompted messages go out per 24 hours (`initiative/reach-out.ts`).

**Growth: mood, expectations, revisions.** Every Owner-private Thought
also receives `growth` (`growth/growth.ts`): her mood, her current identity
entries by id, the opinions she holds, open revisions with their evidence
count, open expectations, and recent lessons. A settlement may carry a
`growth` claim, recorded after publication:
- *Mood* (`growth/mood.ts`): valence (-1..1), energy, openness, tension
  (0..1). Ashley's appraisal says what moved her and which way. The Host
  moves each dimension by at most 0.3 per appraisal and decays it toward
  baseline at x0.85 per hour. Mood is input, never a script.
- *Expectations* (`growth/expectations.ts`): she records what she expects
  and, in a later cycle, checks it (met, missed, mixed, unknowable) with
  the lesson she takes. A checked expectation is self-evidence. Unchecked
  ones expire after 14 days.
- *Revisions* (`growth/revisions.ts`): she proposes a change to herself,
  citing evidence that must exist (memory keys, episodes, journal entries,
  checked expectations). Proposals to the same target add up. Evidence
  counts by origin: records that share a conversation row, a pass, a
  contact or a website count once, so a memory and the episode and journal
  entry derived from it are one origin; at least one origin must be hers or
  the Owner's, never only contacts or the web. Recurrence is measured on
  her proposals: a pass counts when it cites evidence not cited before. An
  opinion applies at 2 independent origins; a taste at 2, proposed in 2
  passes over 2 days; a trait at 3, in 3 passes over 14 days, then 72
  hours. A value or boundary needs her
  affirmation in a later pass and the Owner's approval through `/identity`
  (a new wording clears both). An applied identity revision appends a
  `nuclear.db:identity_entries` row that revises the old one; the Thought
  identity slice is read fresh each cycle, so the change is seen at once.
  The Owner can revert one (`POST /growth/revisions/revert`).
`/memory` shows her mood, the opinions she holds, and recent identity
changes.

**Night and the long arc.** Once a day Ashley gets a NIGHT pass
(`initiative/night.ts`) at the Owner's quietest local hour. The Host learns
that hour from four weeks of Owner messages (04:00 until there are 20), and
the next night is always at least 12 hours on. Like AWAKE, it is switched on
by `PERIODIC_COGNITION_ENABLED`, waits for a live conversation and a due
afterglow, and comes before AWAKE when both are due. The pass sees the day
(episodes, journal), her memories with the pairs whose words overlap most,
her self-evidence, open questions nobody touched for 14 days, and her taste
line beside her strongest interest branches (`growth/night.ts`). She merges
memories with ordinary superseding nominations, turns repeated
self-evidence into revisions, and may regenerate her taste line through a
taste revision grounded in branches she has lived (`interest:<branchId>`).
In `night` she writes the diary for the day, re-scores salience, and closes
stale questions (closing keeps the words; it only leaves recall). Once a
week the same night is the long arc: she writes "who I am becoming",
grounded in the week's episodes and applied changes. Thought sees her latest
narrative and diary entry; `/memory` shows both.

**Forgetting.** `/forget` reaches episodes whose words mention the topic and
any episode built from a message it redacts. A thread story is retired when
it mentions the topic or when any of its conversation's messages is
redacted; the next afterglow writes a fresh one. A forget that lands during
an afterglow wins: that reflection is dropped. Journal entries that mention
the topic or cite a redacted read lose their words and reads (the fact that
a pass happened stays). Interest branches that mention it are removed. Revisions that mention it can never
apply, and an identity entry one already applied is removed. Appraisals and
expectations that mention it lose their words (the mood numbers stay).
Evidence a forget removes stops counting toward any revision, and a
growth claim on a settlement a forget already redacted is not recorded. Diary entries and narratives that mention the topic lose
their words.

Every erase bumps a forget epoch in the sidecar. A Thought records the epoch
when its input is assembled, and publication refuses a settlement whose epoch
has moved, so work already in flight never republishes what a forget removed;
an Owner turn refused this way is re-run by unanswered-Owner recovery. Rows
written between a `/forget` preview and its confirmation are not re-scanned
(the preview keeps only a fingerprint of the topic); semantic forgetting
replaces preview and confirm.

**Decided direction (Owner, 2026-09-29; not yet built).** Forgetting becomes
semantic and Alex-only (Stewardship Compact `SC-FGT-*`, `SC-ADM-*`): Alex asks
in plain words; Ashley names what the request covers and asks for a yes; the
Host erases those records and everything derived from them, with an
exact-phrase sweep of raw logs as the floor; anything in flight that saw them
is refused and re-runs. She complies and may say how she feels. A forget is
never silent: she may know that something was forgotten, not what. `/forget`
retires when this lands. Nothing leaves her records by age alone.

**Who can read what.** Alex can read her memories, diary, activity journal,
mood and "who I am becoming", and Ashley knows this (Ethics `ETH-VIS-*`).
Contacts, once they exist, see none of it.

## Legacy nuclear memory (pre-v0.2.1)

The sections below describe the retired nuclear runtime and are kept for
provenance. Its memory lives in
`~/.composer-assistant/conversations/nuclear.db` (SQLite).

Per turn, nuclear assembles relevant grounded episodes, standing facts, recent
thread messages, identity, Mind State, and opinions after Thought selects the
evidence. Episodes never replace their source messages.

## Facts and threads

- Pins: Discord `/remember`, or chat `remember:` / `bunu hatırla:`
- List: `/memory`
- Forget: `/forget`

Facts categories: `project`, `preference`, `person`, `ongoing`, `pinned`.

## Episodic continuity

Completed exchanges queue a durable consolidation job. The job links its
episode to exact message IDs, stores salience and unresolved status, and indexes
the summary with local SQLite FTS5. In `observe` mode episodes are inspectable
but excluded from live context. In `apply` mode relevant episodes can support a
callback, active concern, commitment, or grounded affect update.

Message loading and model analysis happen before integration. Episode creation,
message links, verified facts, Mind State, affect, revision proposals, the
successful run, and job completion are then committed atomically. Automatic
facts are accepted only when the model cites a stored user message and an exact
literal quote from it. Manual pins are preserved separately from automatic and
legacy facts.

Forgetting uses literal topic matching, so `%` and `_` are ordinary characters.
Confirmation runs as one transaction: matching source messages are emptied and
marked with a content-free receipt; matching episodes and FTS entries are
forgotten; evidence links, episode-sourced Mind State, affect, unsupported facts
and growth leaves are reconciled; and linked model output is redacted. Redacted
messages are excluded from hot context, consolidation, and cadence queries.
Seeded and unrelated manual identity remain immutable. Completed cognition
history is retained for 90 days and failed history for 180 days; pending or
running work is never pruned.

## Backup

```powershell
powershell -File scripts/backup-memory.ps1
```

Creates consistent VACUUM snapshots of both `nuclear.db` and the authoritative
`continuity.db` sidecar under `~/.composer-assistant/backups/{timestamp}/`.
Naive WAL/SHM copying is not supported. Encrypted package creation and restore
verification must preserve nuclear-then-continuity order and fail closed on a
sidecar lineage mismatch; do not replace live databases from this document.

## Architecture

Accepted memory evidence semantics (canonical evidence vs memory assertions vs
retrieval projections, provenance, forgetting) are governed by
[Ashley Memory Evidence Architecture](architecture/Ashley_Memory_Evidence_Architecture.md);
this document describes the current implementation.

See [Architecture_Index.md](Architecture_Index.md). Legacy `index.db` is archival (audit logger may still append session rows there; nuclear does not read it for chat).
