# Project Ashley — Embodiment E1 Writer Contract Repair 1.0.7 -> 1.0.8

Date: `2026-09-29` (Europe/Istanbul)

Scope: authorized writer-contract implementation, focused verification, and
pyc-only packaging. Sims was not launched, installed, uninstalled, or
commanded by this pass. No E1-A/B/G, E2, or power action was performed.

## Authority and baseline

| Item | Value |
|---|---|
| repository | `C:\\Users\\Xharv\\Projects\\Ashley` |
| branch | `main` |
| baseline HEAD | `2398e327000eac19abee2e31ff855eca1d141129` |
| baseline tracked tree | `bd8545bc0a4c407dd5e3b1e94bd5a3e9e848508d` |
| internal probe transition | `1.0.7` -> `1.0.8` |
| product-facing name | `Embodiment 1.0.0` |
| schema | `e1.telemetry/v1`, schema version `1` |
| master SHA256 | `A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3` |
| V1.2a plan SHA256 | `CBF47BF6803FE909F02C0BF2B0B0F21EBB78E139BDEB3595984F8E313130F683` |

Historical runtime evidence, including the preserved 1.0.7 blocked session,
was not rewritten.

## Implemented contract delta

- Ordinary writes are buffered. Dirty sampling data flushes on a monotonic
  five-second cadence.
- Checkpoint, cap, writer-failure, disarm, rotation, and close boundaries
  flush through the writer thread. Game-thread disarm remains signal-only.
- Flush failures remain non-sticky for the first two consecutive failures.
  The third consecutive failure becomes one `FAILED_STICKY`/`flush_failure`
  state with one best-effort `writer_failed` diagnostic. Successful flushes
  reset the consecutive count.
- Physical write failures remain distinct and immediately become sticky
  `write_failure`.
- Serialization failures increment the existing `dropped_serialize` counter,
  retain the bounded `SERIALIZE_FAILURE` pending reason, and do not become
  sticky writer failures.
- Shutdown-deadline discards retain the existing `dropped_queue` counter and
  are surfaced as `reason=SHUTDOWN_DEADLINE` on `session_close`; no new schema
  field, event, counter, or enum was added.
- Logical buffered-byte accounting preserves the existing file, rotation, and
  directory caps without restoring per-row flushes.

The focused writer regressions were first run red against unchanged 1.0.7
source. The expected failures covered missing buffered-flush state, per-row
flush behavior, shutdown-loss provenance, serialization accounting, and the
slow-flush case. The pre-existing 1.0.7 focused suite was green before those
regressions were added.

## Verification

| Gate | Result |
|---|---|
| focused suite, host Python 3.12.14 | `96/96 PASS` |
| focused suite, exact CPython 3.7.0 x64 | `96/96 PASS` |
| AST guards | `PASS` |
| PowerShell parsing (`build.ps1`, `verify.ps1`, `install.ps1`, `remove.ps1`) | `PASS` |
| `verify.ps1` | `PASS all checks` |

The focused regression set covers no per-row flush, five-second cadence,
periodic/rotation/pre-disarm checkpoint flush, signal-only shutdown on the
writer thread, flush-before-close ordering, cap/failure diagnostics,
three-failure escalation and reset, physical write failure including final
close, validation/serialization failure, shutdown provenance under writer
failure, clean shutdown, and the slow-flush regression with all critical rows
physically written. Existing binding, bootstrap, schema, guard, identity,
package, root, sequence, and session tests remain green.

## Artifact

| Item | Value |
|---|---|
| path | `sims-e1/build/ashley_e1_1.0.8.ts4script` |
| manifest implementation commit | `14ec2d8` |
| bytes | `24837` |
| SHA256 | `E0E1CB043EBC21EA12F0975BF8A8620FCD44BB65F502E210EA212FC673709240` |
| members | six: `__init__.pyc`, `observers.pyc`, `probe.pyc`, `schema.pyc`, `snapshot.pyc`, `writer.pyc` |
| magic | `420d0d0a` on all six members |
| raw `.py` / `__pycache__` members | none |

Compiler identity recorded by the manifest:

- official CPython 3.7.0 x64;
- installer SHA256 `9D6AFA39538AADE3A2BACB099EF1C9F78E8D4AFAEFFF99057B902118845C5DDA`;
- embedded package SHA256 `0CC08F3C74C0112ABC2ADAFD16A534CDE12FE7C7AAFB42E936D59FD3AB08FCDB`;
- executable SHA256 `E964F2E498AB3141D86DA5F0D6E135BE82986C66AAAFEF356B6E7751B779A796`.

P1 manifest identity remains the Owner-verified compatible
`python37_x64.dll` (`3.7.150.1013`, product `3.7.0`) with SHA256
`3BD2257D1A7C3D405D25F989CC0E3C847213700397C3F86D7B64AFB910069AEC`.

## Boundary

```text
source changed: YES, intended E1 writer/version/test/tooling files only
tests changed: YES, focused writer contract coverage only
artifact built: YES, pyc-only 1.0.8
Sims launched: NO
Sims command: NO
install/uninstall: NO
E1-A/B/G: NO
E2: NO
power action: NO
```
