# Discord presence truth

**Status:** `SUPPORTING`

**Date:** 2026-08-26

Discord custom status is a rendering of current activity. It is not the owner
of read lifecycle, Mind State, takes, or recency.

## Laws

- DISCOVERED != READ
- FETCHED != READ
- READ != CURRENTLY READING
- TAKE EXISTS != CURRENTLY THINKING
- RECENT != CURRENT
- HISTORICAL ACTIVITY != LIVE ACTIVITY
- COMPLETED ACTIVITY != ACTIVE ACTIVITY
- PERSISTED ACTIVITY RECORD != PRESENT-TENSE PRESENCE

Present-progressive labels such as `reading <title>` require an in-flight
lifecycle that has started and has not yet ended. Freshness alone cannot
establish that.

## Root cause

`getCuriosityStatus` already exposed a completed `lastTake` (title, depth,
`createdAt`, `ageMin`). That projection was historical and true.

`pickPresenceLabel` was the first false step. It treated `lastTake.ageMin <=
120` as currently reading, `<= 720` as `last: <title>`, and excerpt depth as
`skimmed <title>`. Sticky TTL for that band was two hours, so a completed take
could keep present-progressive Discord text long after the read (and after
take formation) had finished.

`last:` was history-composer syntax on the public presence string. It was not
a product contract for Discord.

`networkActivity` / `researchTopic` were never populated by agent-service.

A first repair stopped take-recency from becoming current reading, but it
began `currentActivity` around `fetchValidatedResource`. Candidate selection
and network retrieval are not reading. That boundary is now consolidation.

## Ownership

Curiosity owns in-flight reading as process-local `currentActivity`.
`consolidateCuriosityRead` begins the slot after a grounded `cur_reads` row
exists and after the offline (no-provider) early return, immediately before
the consolidation model call. It ends the slot in `finally`. The activity id
is `read:<readId>`. Title is the read-record title.

Fetch, MIME checks, extraction, failed read-record writes, and a pending
`consolidate_curiosity` job must not fill the slot.

Restart empties the slot. A persisted `cur_reads` row or `cur_takes` row
cannot refill it.

`getCuriosityStatus` projects `currentActivity` plus optional historical
`lastTake`. Status reads do not write cognitive or curiosity state.

Discord renders `currentActivity`. It ignores `lastTake` for labels. Idle
defaults remain `feed quiet`, `curiosity off`, and `around`.

The cognition loop claims one job at a time (`running` guard, sequential
`await processNextCognitiveJob`). Overlapping curiosity consolidations are
not a current source path. The single activity slot is kept.

## Semantics

| Case | Source | Discord |
|---|---|---|
| Fetch / validate / extract in flight | `currentActivity.state === "none"` | must not say `reading <title>` |
| Grounded read recorded, consolidation queued | `none` | must not say `reading <title>` |
| `consolidateCuriosityRead` running a model call | `active`, kind `reading` | `reading <title>` is allowed |
| Consolidation done, failed, or aborted | slot cleared | must not say `reading <title>` |
| Recent take / recent thought artifact | `lastTake` or other stored rows | not current activity; no `last:` leak |
| No current activity | `state: "none"` | existing idle / mode labels |

There is no currently-thinking presence path. A stored take is not thinking.

## TTL

The 120-minute and 720-minute `ageMin` windows were illegitimate currentness
rules. They are removed from the renderer.

The two-hour sticky TTL on the old reading band was the same error: it treated
a completed label as still live. Live activity labels now yield immediately
when the snapshot no longer reports them.

The Discord refresh interval remains ten minutes. That interval is how often
the bot polls. It is not a recency-to-currentness window.

## Remaining limits

A genuine consolidation call is usually shorter than the ten-minute poll, so
Discord may never show `reading <title>` even when the semantic slot is
briefly active. That is fail-closed, not a license to stretch completed reads
into currentness. Low observability is not falsehood. No Operational
Continuity, Event Spine, or Discord-owned cognition was added to close that
gap.
