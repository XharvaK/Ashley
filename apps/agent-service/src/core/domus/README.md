# Domus ingress (wire contract v1)

Separate listener on `127.0.0.1`, port `DOMUS_INGRESS_PORT` (default 3711). It starts only when `DOMUS_HELPER_TOKEN` is set, is at least 32 bytes, and is not equal to `DISCORD_BOT_TOKEN`. Otherwise the process logs `[domus-ingress] disabled: <reason>` and does not listen.

Auth header: `X-Domus-Token`. Compared as SHA-256 digests with `crypto.timingSafeEqual`. Missing, wrong, or the bot token: `401 {"error":"unauthorized"}`. JSON body limit 64 KiB: `413 {"error":"payload_too_large"}`. Any other path: `404 {"error":"not_found"}`.

Phase 8a stores rows. The listener never appends inbox events and never wakes Thought; 8d below does that from the thalamus.

## POST /domus/observation

Unknown top-level keys: `400 {"error":"invalid_body"}`.

```json
{
  "v": 1,
  "observation_id": "1..128 chars of [A-Za-z0-9._:-]",
  "world": "1..64", "branch": "1..64", "session": "1..64",
  "attachment": "1..64", "body": "1..64", "snapshot": "1..64",
  "seq": 0,
  "source_time_ms": 0,
  "expires_at_ms": 0,
  "lineage_class": "1..32 chars of [A-Z_]",
  "percepts": [ { "kind": "1..32 chars of [a-z0-9_]", "salience": 0.0, "facts": {} } ],
  "portrait": {}
}
```

- `seq`, `source_time_ms`, and `expires_at_ms` are safe non-negative integers.
- `percepts` has 1–32 items. Each item has only `kind`, `salience`, and `facts`.
- `salience` is a finite number in 0..1.
- `facts` is a JSON object of at most 2,048 UTF-8 bytes of `JSON.stringify`.
- `portrait` is optional, a JSON object of at most 8,192 UTF-8 bytes of `JSON.stringify`.

With `now` as receipt time:

- `expires_at_ms <= source_time_ms` → `400 {"error":"invalid_body"}`
- `expires_at_ms - source_time_ms > 600000` → `400 {"error":"invalid_body"}`
- `source_time_ms > now + 120000` → `400 {"error":"clock_skew"}`
- `now > expires_at_ms` → `410 {"error":"expired"}`

The digest is SHA-256 of canonical JSON (object keys sorted recursively; array order kept).

- New `observation_id` → store, `202 {"status":"admitted","observation_id","receipt_time_ms"}`
- Same id and same digest → `200 {"status":"duplicate","observation_id","receipt_time_ms"}` using the original receipt time, no new row
- Same id and a different digest → `409 {"error":"observation_conflict"}`

## POST /domus/heartbeat

Unknown keys: `400 {"error":"invalid_body"}`.

```json
{ "v": 1, "helper_session": "1..64", "sent_at_ms": 0, "attached": true, "world": "0..64 optional", "probe_version": "0..16 optional" }
```

`sent_at_ms` is a safe non-negative integer. `attached` is a boolean. Upserts `domus_heartbeats` by `helper_session` (`last_received_at_ms`, `last_sent_at_ms`, `count`, `last_json`). Response: `200 {"status":"ok"}`.

## POST /domus/undo

Unknown keys: `400 {"error":"invalid_body"}`. The helper decides; Ashley never infers abandonment.

```json
{ "v": 1, "world": "1..64", "branch": "1..64", "session": "1..64", "after_source_time_ms": 0, "reason": "1..32 chars of [A-Z_]" }
```

`after_source_time_ms` is a safe non-negative integer. `world`, `branch`, and `session` use the same character rules as those fields on an observation. Response: `200 {"status":"ok","observations":0,"supports":0,"assertions":0,"episodes":0,"journal":0}`.

- Observations in that world, branch, and session with `source_time_ms` greater than `after_source_time_ms` and `undone_at_ms` null get `undone_at_ms` set to the undo time. Rows stay.
- Current supports whose `support_ref_json` is `{ kind: "domus_observation", observationId }` for one of those ids, and that still have `source_ref` or `support_ref_json`, become `lineage_class = undone`. A forgotten support (both null) is skipped.
- Each current assertion that owns one of those supports, and whose statement is not redacted, becomes `undone`. Every other current support of that assertion becomes `undone` with it.
- Current episodes and journal rows on `domus:<world>` with `forgotten_at_ms` null and `created_at_ms` at or after the earliest undone receipt become `undone`. Cycle binding waits for 8d.
- Nothing is deleted or redacted. `live`, `statement`, `content_hash`, FTS, vectors, and `memory_strength` stay as they are. A second identical call returns zeros.

## Memory channel and lineage (8b-1)

`sidecar_memory_assertions`, `sidecar_memory_supports`, `episodes_v2`, and `activity_journal` carry `channel` (`discord` or `domus:<world>`, default `discord`) and `lineage_class` (`current` or `undone`, default `current`). `domus_observations.undone_at_ms` is null while the observation still counts. Rows marked `undone` stay as history and are hidden from recall. Thought may cite a stored row as typed support `{ kind: "domus_observation", observationId }`. Admission resolves it only when the row exists, `admission_state` is not `dropped`, and `undone_at_ms` is null, then stamps `channel` from that row's world. A nomination whose fresh supports name more than one channel (two worlds, or Discord plus Domus) is `admission_skipped_provenance`. A Domus observation never grounds an Owner-world claim.

## Domus passes (8d)

`notification.ts`. The central thalamus's `domus` nucleus (`thalamus/nuclei/domus.ts`) proposes one candidate per armed attachment over its pending rows: `admission_state` stored, `undone_at_ms` null, not expired, newest 32. An attachment is armed while its latest heartbeat said `attached: true` and arrived within 180 s. The helper's peripheral thalamus already did salience, habituation and refractory, so a delivered row is due (`deadlineMs`); a percept with `urgency: always_through` makes the candidate `ALWAYS_THROUGH`. A conversation with the Owner still holds the lane.

Budget `ashley.embodiment.v1`, one rolling hour, limit from `ASHLEY_EMBODIMENT_BUDGET_LIMIT` (bump `ASHLEY_EMBODIMENT_BUDGET_VERSION` to change it), configured at startup. Unset means no Domus passes. It never lends capacity to ordinary private passes.

When selected, one transaction appends inbox `domus_notification` (`domus-notification:<newest id>`), binds the thalamus decision, marks the included rows `admitted` and older stored rows of that attachment `dropped`; then the wake reserves the embodiment budget (a missed reservation is retried, the rows are never admitted twice). Disarming stops new passes; admitted work finishes and is not refunded.

Thought gets `domus` (Owner-private only), rebuilt from the rows, never from the inbox payload: `world`, `asOfMs`, `observationIds`, `portrait` (the newest row's helper portrait), `events` (the percepts in time order within 4 KiB, newest kept, `omittedEvents` counts the rest). Undone rows are left out. The contract profile is `domus`, and the pass journals on `domus:<world>`.
