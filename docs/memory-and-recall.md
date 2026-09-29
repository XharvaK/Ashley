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
quote and stay labelled as hers. Each nomination is decided once and the
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
- `memory.lookup`, a read-only Owner-private observation Ashley can choose
  to search her own memories deliberately.

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
