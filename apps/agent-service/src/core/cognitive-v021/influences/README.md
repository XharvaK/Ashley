# Influences

Interests she keeps returning to may become influences; the Host counts returns, Thought decides.

The sidecar owns the ported influence, evidence and choice-receipt stores. Per-cycle `interest_touches` are recorded only for branch IDs returned by the existing interest-growth operation, inside the aftermath transaction. Replay is idempotent per branch and cycle; a failed receipt rolls back branch growth too. Counting starts at migration, with no historical backfill. Existing branch forget removes its receipt identifiers.

Contract state defaults to `observe`. This storage slice does not propose, admit or apply influences, and supplies no agenda or Thought consumer. Legacy C3 consumers remain separate until their retirement packet. Nuclear C1 assertion IDs in evidence refer to that evidence owner; they are not sidecar assertion keys and have no cross-database SQLite foreign key.

Sidecar schema ownership and supported version are declared in `../sidecar/` and `../types.ts`. Source and tests establish no production activation or mode promotion.
