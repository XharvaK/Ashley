# Thalamus partial replay

Run from the repository root against an Owner-provided or explicitly
Owner-authorized local sidecar snapshot and its timing-only journal export:

```powershell
node scripts/thalamus/replay.mjs --sidecar <COPY_PATH> --journal <TIMING_JSON_PATH>
```

The command opens SQLite read-only, enables `query_only`, checks integrity,
and verifies the source hash after reading. It does not migrate, fetch,
create traffic, or change production. Keep snapshots and reports private.

Journal input is a JSON array of `{atMs, passType, outcome, codes?}`.
`passType` is `afterglow`, `night`, or `awake`; `outcome` is `ran`,
`scheduled`, or `abandoned`. Export timing and codes only, without message
content. Journal records and admitted cycles describe different events;
their counts need not be equal.

Historical replay reports retained admission order and pass codes. It does
not invent historical holds, salience, budget, mood, or overwritten clock
states. It cannot derive counterfactual wake counts or threshold calibration
from admitted passes alone. An empty exact-decision corpus is unavailable
evidence, not a passing equivalence claim.

New decision receipts retain mechanical input order, the pre-evaluation
checkpoint, and numeric context. Build the agent before replaying those
receipts; the command uses that revision's compiled arbiter. Exact replay
compares decision codes, pass type, selected IDs and held IDs. A mismatch
exits nonzero. It does not claim execution, delivery, qualification,
promotion, or production acceptance.

Focused tool verification:

```powershell
node --test scripts/thalamus/replay.test.mjs
```
