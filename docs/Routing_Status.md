# Routing — Ownership and Resolution Guide

**Role:** Durable guide to how Ashley routing is owned, selected, and
inspected. **Not** a record of current occupants, quotas, or bindings.

This file never claims which provider or model serves a route today. Any
occupant, quota, or enablement value encountered below lives inside the
explicitly frozen historical appendix and is bound to that audit's date
and baseline. Values there are evidence of what was observed then — never
current truth and never refreshed in place.

```text
Declared portfolio file
  != Loader / resolver behavior in source
  != Effective production dispatch
  != Owner-selected future target policy
```

## 1. Ownership chain

Routing truth is split across owners, in this order:

1. **Declared configuration.** The CURRENT compatibility portfolio file
   under `config/model-fabric/portfolios/` owns the complete declared
   policy rows: route bindings, enablement, and quota contracts. The file
   carries its own revision identity (`portfolioRevisionId`,
   `replacesPortfolioRevisionId`). The filename is not the authority —
   read the file's declared revision, not the filename.
2. **Loader / resolver source.** `portfolio.ts` (in
   `apps/agent-service/src/core/model-fabric/`) validates and hashes the
   declared snapshot and resolves role, occupancy, and overrides.
   `router.ts` (in `apps/agent-service/src/core/model-routing/`)
   projects the snapshot for quota and route-lifecycle checks. The
   registry owns unknown-route rejection.
3. **Effective production dispatch.** What actually served traffic is a
   production-observation fact: per-route dispatch receipts, the
   owner-only `/nuclear/routing` projection, and observed behavior.
   Repository configuration alone never proves deployed state.
4. **Future targets.** Owner-selected future occupants live in the Model
   Fabric architecture's target policy, not in any CURRENT row. A future
   target is never current routing.

A request's configured route and its dispatched route can differ. Model
Fabric receipts record the requested purpose and the logical role
separately — always read both fields. Never assume the configured
mapping is what was dispatched.

## 2. Fail-closed dispatch contract

Behavior of the dispatch path (verified against router, registry, and
adapter source; confirm exact codes in source if a task depends on them):

- **Unknown routes** fail with `route_disabled` (404).
- **Disabled routes** fail with `operator_disabled` (503). Route
  lifecycle is enforced before adapter selection and quota reservation:
  a disabled route reserves no quota, invokes no adapter, demands no
  key, and makes no network call. There is **no fallback** to another
  provider.
- **Missing credentials** fail the call with `agent_not_ready` (503)
  before provider access. Each provider family requires its own
  credential only for its enabled rows; a credential is never demanded
  for rows that cannot dispatch.
- A route name is never a capability grant. Retained configuration for a
  disabled route creates no execution dependency and no authority. Any
  future use must satisfy the owning milestone contract,
  purpose-specific qualification, and the relevant authority gates.

## 3. Identifier seams

Route, purpose, and role identifiers are not interchangeable. Known seams
(confirmed in attention types, purpose registries, and policy rows; the
full set lives in source, not here):

| Identifier kind | Meaning |
|---|---|
| Purpose (e.g. observation work requested by a job) | What the caller asked for |
| Configured compatibility route | What the declared portfolio maps that purpose to |
| Dispatched route | What the resolver actually invoked |
| Historical / deferred purpose names | Planned or deferred semantics; not current dispatch |

When identifiers disagree, the dispatched route plus the receipt's
requested-purpose / logical-role fields describe the observed behavior.
Whether the disagreement is a defect is determined against the applicable
contract and evidence. Repair belongs to the owner and task scope authorized
to change the mismatched layer.

## 4. How to inspect current routing

On demand, in this order:

1. Read the declared CURRENT portfolio file's revision identity and the
   loader source that validates it.
2. Read the resolver/router behavior in source for the routes the task
   touches.
3. For served state, use the owner-only `/nuclear/routing` projection
   (per-route alias, provider, configured model, enabled state, quota
   bucket, health, quota availability, last dispatch/error, resolved
   model when known, fabric projection) and production observation.
   `/nuclear/attention` queue figures are caller-level defaults, not
   per-bucket pressure.
4. If effective state cannot be observed from here: `UNKNOWN`. Never
   fall back to the frozen appendix below.

No secret is ever exposed through these surfaces: no API keys, raw
prompts, model outputs, or secret-bearing errors.

## 5. What this file does not claim

- Current occupants, model IDs, quotas, or enabled states.
- Production acceptance or deployment of any row.
- Promotion of any declared capability.
- That a future target policy is already routed.
- That repository configuration equals served production traffic.

---

## Appendix A — Frozen historical audit (2026-09-08, bound, never refreshed)

> **SNAPSHOT. NOT CURRENT.** What follows is the 2026-09-08
> closure-candidate audit of the then-CURRENT v3 portfolio, audited
> against production baseline `9ef99620475552216905cd6995be2a11d1358519`
> by read-only comparison of the portfolio to `portfolio.ts`,
> `router.ts`, `registry.ts`, provider adapters, deployment
> configuration, and focused Model Fabric/routing regressions. It did
> not claim production acceptance or deployment when written, and it
> claims nothing about any later revision, migration, or deployment.
> Do not copy values out of this appendix into procedures, guides, or
> new audits. Do not refresh this appendix — write a new bounded audit
> if one is ever needed.

At audit time, Thought used Nemotron 3 Super with high reasoning policy
through Cloudflare Workers AI; Expression and utility/bulk rows used
NVIDIA NIM Nemotron 3.5 Lightning; the Expression fallback used Groq
Qwen with a distinct quota bucket; named disabled rows
(`sandbox_operator_light`, `sandbox_operator_deep`, `sandbox_reviewer`,
`experimental_auditor`, `experimental_multimodal`) created no provider
access; Thought had no automatic provider fallback; and the
`thought_observation` / `reflection_initiative` purposes were configured
as `utility_bulk` while dispatching the Thought route.

The obsolete `config/models.json` registry had been removed at audit
time. Owner-selected future targets (including Qwen-primary Expression
and Groq 120B Thought, documented in Model Fabric Architecture §12.9)
were not then-current routing and must not be read as such now.
