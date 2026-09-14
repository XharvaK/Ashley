# Field Lab modern transcript and Expression evidence repair

## Scope

- [x] Repair only the Observer exporter and its focused tests.
- [x] Preserve the four-file bundle contract: `manifest.json`, `identity.json`, `transcript.json`, and `evidence.json`.
- [x] Do not modify Thought, Expression, providers, prompts, routing, reasoning settings, deadlines, deployment, or Observer synthesis.
- [x] Treat Trial 1 artifacts as immutable historical evidence.

## Implementation

- [x] Add a bounded modern transcript projection from the read-only `cognitive-v021.db` evidence and lifecycle owners.
- [x] Correlate Owner ingress by durable evidence row, conversation, Discord, and cycle identifiers.
- [x] Correlate Ashley output through cycle, settlement, speech outbox, delivery reservation, and delivery bubble records. Record gaps when a required join is absent or ambiguous.
- [x] Add per-turn Thought, observed Expression attempt, fallback, licensed speech, delivery, and fidelity evidence without exporting hidden reasoning or configured-only claims.
- [x] Classify observed paths only as `QWEN_PRIMARY`, `LIGHTNING_FALLBACK`, `THOUGHT_DIRECT`, or `UNKNOWN` from durable request/outcome evidence.
- [x] Make coverage depend on canonical modern activity and extraction results. An empty legacy sessions directory must not establish completeness or `NORMAL` coverage.
- [x] Keep the Europe/Istanbul 04:00 field-day boundary and read-only SQLite snapshot behavior unchanged.

## Verification

- [x] Add focused tests first for modern ingress/output, primary Expression, fallback, Thought-direct/unknown path, false-normal prevention, true empty day, reasoning redaction, and bundle immutability.
- [x] Run the observer package build and only the focused observer test files.
- [x] Run exactly one read-only replay against a safe temporary snapshot of the natural `2026-09-14 06:24`–`06:38` Europe/Istanbul slice with temporary output and no synthesis.
- [x] Verify the requested counts and source/coverage assertions, remove temporary artifacts, inspect diff/tree, and create one local commit only if all gates pass.
