# Influences

Interests she keeps returning to may become influences; the Host counts returns, Thought decides.

The sidecar owns the ported influence, evidence and choice-receipt stores. Per-cycle `interest_touches` are recorded only for branch IDs returned by the existing interest-growth operation, inside the aftermath transaction. Replay is idempotent per branch and cycle; a failed receipt rolls back branch growth too. Counting starts at migration, with no historical backfill. Existing branch forget removes its receipt identifiers.

Contract state defaults to `observe`. The Host proposes after three distinct branch-touch cycles, copying the stored branch label and preserving seed/native lineage. A proposal remains pending; it grants no agenda or effect authority. Legacy C3 consumers remain separate until their retirement packet. Nuclear C1 assertion IDs in evidence refer to that evidence owner; they are not sidecar assertion keys and have no cross-database SQLite foreign key.

Sidecar schema ownership and supported version are declared in `../sidecar/` and `../types.ts`. Source and tests establish no production activation or mode promotion.

`eligibility.ts` splits the legacy C3 predicate into `readEligibility`, which writes to neither database, and `refreshEligibility`, which explicitly records a C1 correction in the sidecar. Both use a caller-supplied nuclear evidence owner. Demoted, superseded and expired bindings never revive. Contract state is sidecar-owned and unsupported versions fail closed.

The predicate retains the legacy fixture's dark-apply evidence/provenance rules for its ported C1 cases. Branch evidence has a separate typed store referencing actual branch-cycle receipts. Branch eligibility also requires a later Thought admission and current basis; it is an eligibility fact, not permission to apply it. Forgetting a branch removes its influence text, evidence and receipts. Proposal creation runs in the existing standing aftermath path; later position and agenda consumers are separate integration steps.
