# Domus ingress (wire contract v1)

Separate listener on `127.0.0.1`, port `DOMUS_INGRESS_PORT` (default 3711). It starts only when `DOMUS_HELPER_TOKEN` is set, is at least 32 bytes, and is not equal to `DISCORD_BOT_TOKEN`. Otherwise the process logs `[domus-ingress] disabled: <reason>` and does not listen.

Auth header: `X-Domus-Token`. Compared as SHA-256 digests with `crypto.timingSafeEqual`. Missing, wrong, or the bot token: `401 {"error":"unauthorized"}`. JSON body limit 64 KiB: `413 {"error":"payload_too_large"}`. Any other path: `404 {"error":"not_found"}`.

Phase 8a stores rows. It does not append inbox events and does not wake Thought.

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

## Memory channel and lineage (8b-1)

`sidecar_memory_assertions`, `sidecar_memory_supports`, `episodes_v2`, and `activity_journal` carry `channel` (`discord` or `domus:<world>`, default `discord`) and `lineage_class` (`current` or `undone`, default `current`). `domus_observations.undone_at_ms` is null while the observation still counts. Thought may cite a stored row as typed support `{ kind: "domus_observation", observationId }`. Admission resolves it only when the row exists, `admission_state` is not `dropped`, and `undone_at_ms` is null, then stamps `channel` from that row's world. A nomination whose fresh supports name more than one channel (two worlds, or Discord plus Domus) is `admission_skipped_provenance`. A Domus observation never grounds an Owner-world claim.
