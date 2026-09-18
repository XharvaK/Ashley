# Proactive messages / periodic initiative (nuclear)

Current mechanism: the Discord bot polls on `PROACTIVE_CHECK_INTERVAL_MIN`
and asks the agent for idle work. The scheduler never sends a Discord
message directly.

## Surface

- Discord DM only
- Cap: `PROACTIVE_MAX_PER_DAY`, idle floor: `PROACTIVE_MIN_IDLE_HOURS`
- Disable: `PROACTIVE_ENABLED=false`, `/proactive pause`, or ask her to stop

## Pipeline (current v0.2.1 source)

1. **Scheduler** — discord-bot interval calls `POST /initiative/idle`
   (`apps/discord-bot/src/initiative/scheduler.ts` via `tickCognitiveIdle`).
   It never sends directly.
2. **Gate** — the v021 idle handler checks the periodic schedule and the
   inquiry gate (`apps/agent-service/src/core/cognitive-v021/initiative/`);
   a wake is admitted only when the gate allows it (wake ledger admission).
3. **Thought** — an admitted wake runs Thought through the bound runner.
4. **Settlement/delivery** — normal settlement → speech outbox → delivery
   projector/pump → receipt/finalize, same as the reactive path.
5. **Due commitments** — due self-commitments surface as `commitment_due`
   wakes into Thought (gated by `RA_COMMITMENTS`).

Silence is the default: empty or unadmitted material means no message —
no filler path.

## Operator status

- `GET /initiative/status?owner_id=` — legacy + periodic state
  (`operator-status.ts`; status only, never proof of delivery)
- `GET /initiative/periodic/diagnostics`, `GET /initiative/urgent?owner_id=`
  (local wake signal; never sends directly)
- `POST /initiative/pause`, `POST /initiative/resume`
- `GET /nuclear/decisions?owner_id=`, `GET /nuclear/reflections?owner_id=`

## Superseded (do not treat as current)

The legacy proactive endpoints are gone: `/initiative/tick`,
`/initiative/commit`, `/initiative/abort`, `/initiative/evaluate`,
`/initiative/generate`. There is no current Agency.decide → draft →
reserve → send pipeline (the decide module is source-present but no
non-test source reaches it).

## Reflection note

Reflection owns post-outcome interpretation; it has no current-turn
authority and no live calibration consumer in Thought. The
`ASHLEY_REFLECTION_MODE=apply` switch feeds only `applyInitiativeLearning`
(a legacy motivation-score adjustment with no live caller) — it is
unrelated to cognitive-graduation C4 `apply` (which throws; live
application is not authorized and `dark_apply` is fixture-only) and does
not touch Thought.

See [Architecture_Index.md](Architecture_Index.md).
