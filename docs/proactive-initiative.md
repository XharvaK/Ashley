# Proactive messages (nuclear)

Ashley messages first when Agency decides she has something to say. Empty material means silence — no filler path.

## Surface

- Discord DM only
- Cap: `PROACTIVE_MAX_PER_DAY`, idle floor: `PROACTIVE_MIN_IDLE_HOURS`
- Disable: `PROACTIVE_ENABLED=false`, `/proactive pause`, or ask her to stop

## Pipeline

1. **Scheduler** — Discord bot polls every `PROACTIVE_CHECK_INTERVAL_MIN` minutes (`apps/discord-bot/src/initiative/scheduler.ts`)
2. **Decide** — `AshleyCore.tickProactive` → Agency motivations + `decide`
3. **Reserve** — row in `initiative_reservations` (wire shape kept for the bot)
4. **Send** — bot DMs bubbles, then `/initiative/commit` (or abort on failure)
5. **Reflect** — explicit 👍/👎 on a committed message updates bounded motivation-kind calibration for future proactive decisions

Grounded commitments or concerns with urgency at least `0.85` can wake the bot's
local urgent check instead of waiting for the normal jittered poll. This only
accelerates evaluation: pause, daily cap, Agency, reservation, deduplication,
send, commit, and Reflection remain mandatory.

Relational initiative is also capability-gated. The cognition master mode must
permit influence, and `relational_initiative` plus its dependencies must have
passed release qualification and live-shadow promotion.

Urgent wakes are edge-triggered (`pending → claimed → consumed`). A claim has a
five-minute lease; a logged Agency decision consumes it even when Ashley stays
silent. Failures before a decision retry after 5, 10, 20, 40, then 60 minutes.
An active item only re-arms when new source-grounded text arrives, it crosses
the urgency threshold, or urgency rises materially. This permits one wake for
a concern; further contact needs new evidence or increased urgency. Explicit
pause and space requests remain authoritative. The urgent endpoint is read-only and
returns false whenever proactive safeguards or another live claim block work.

Reflection is deterministic and defaults to `ASHLEY_REFLECTION_MODE=observe`.
Observe mode records and calculates without changing Thought scores; `apply`
enables the bounded adjustment.

## Observability

- `GET /initiative/status?owner_id=`
- `GET /nuclear/decisions?owner_id=`
- `GET /nuclear/reflections?owner_id=`
- `GET /health` → minimal public liveness/readiness and provider state
- `GET /initiative/urgent?owner_id=` → local wake signal; never sends directly

See [Architecture_Index.md](Architecture_Index.md).
