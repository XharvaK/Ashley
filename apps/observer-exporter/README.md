# Observer pipeline substrate

This package implements the non-bot portion of the accepted [Ashley Field
Observation Protocol](../../docs/Ashley_Field_Observation_Protocol.md).

## Authority boundary

- `observer-export` reads approved Ashley evidence through read-only SQLite
  snapshots and primary conversation JSONL.
- `observer-export` has no Ashley control credential, provider credential,
  GitHub credential, network client, HTTP path, runtime/server import, or
  qualification-traffic path.
- `field-lab-publish` receives completed artifacts. It has no Ashley read
  authority and does not synthesize, infer, or query production.
- Working SQLite snapshots are ephemeral and are deleted in `finally` after
  extraction. Durable bundles contain allowlisted extracted evidence only.
- Durable bundles are written outside the Ashley data plane.
- This task does not run a historical field dry run. It does not run the
  exporter against production.
- C1 MUST NOT start until the protocol is accepted, the exporter is LIVE/armed,
  Observer cloud access to Field Lab is LIVE, the bounded Field Lab write path
  is LIVE, and the daily routine is enabled. The first real closed field day
  occurs during C1. No pre-C1 rehearsal is implemented.

## Bundle v2 source coverage

Bundle schema v2 embeds `source_coverage` in `manifest.json` and in the
semantic bundle identity. It records independent coverage for:
`conversations/sessions`, `conversations/nuclear.db`, `cognitive-v021.db`,
`cognitive-v021-observability.db`, and `continuity.db`.

Each source records its requested interval, observed interval, disposition,
timestamp-surface record count, and failure or omission state. The allowed
dispositions are `complete_empty`, `complete_nonempty`, `partial`,
`unavailable_or_unchecked`, and `completeness_unknown`.

The aggregate is `NORMAL` only when every source is complete and the
transcript/session source is nonempty. Missing or unreadable sources remain
unknown or unavailable. Coverage reads timestamp columns and does not export
message payloads, prompt bodies, reasoning content, or unrestricted
`payload_json` fields. The exporter keeps the cognitive sidecar and its
source-owned observability database read-only.

## Local commands

From `apps/observer-exporter/`:

```text
npm install
npm run build
npm test
npm run export -- --data-root <Ashley-data-root> --out-root <external-output-root> --ashley-checkout <Ashley-checkout> --field-day YYYY-MM-DD --closed-as-of <ISO-instant>
npm run publish -- --artifacts <completed-artifacts> --field-lab <Field-Lab-worktree> --field-day YYYY-MM-DD --bundle-id <bundle-id> --observer-pass-id <observer-pass-id>
```

`--preflight` validates exporter inputs and path authority without exporting.
Production defaults are intentionally not provided.

`artifacts.json` is the publisher input contract. Each declared artifact must
use one of the protocol’s six allowed vault roots and a Markdown target:
`10 Daily Transcripts/`, `20 Daily Analyses/`, `30 Owner Attestations/`,
`40 Findings/`, `50 Longitudinal/`, or `60 Post-Cutover/`.

## Future QXY operation

The source-controlled units are disabled candidates only. After the pipeline
gates are independently accepted, a future QXY operator may copy the named
units with `deploy/linux-mint/sync-user-units.sh`, run the exact `/usr/bin/node`
preflight, and inspect the timer with:

```text
systemd-analyze calendar '*-*-* 04:05:00 Europe/Istanbul'
```

Installation, `daemon-reload`, enablement, production export, Field Lab clone,
and C1 start are outside this task and were not performed.
