# Sandbox V1 → V2: Why the Broker Architecture Was Retired

**Status:** HISTORICAL

**Current authority:** NON-AUTHORITATIVE FOR CURRENT SANDBOX IMPLEMENTATION

This note preserves the engineering history of Sandbox V1. It is not a current
implementation contract, qualification record, deployment instruction, or
permission to restore the V1 broker architecture.

## What V1 tried to provide

Sandbox V1 separated the caller from execution through a broker. The broker
validated an execution request, applied policy, ran bounded work, and returned
receipts and cleanup state. Approval, authority, process isolation, resource
limits, and durable lifecycle evidence were treated as separate concerns.

The design was useful as a threat-model exercise. It made several boundaries
explicit:

- untrusted work must not receive Ashley's credentials or broad host access;
- approval is scoped evidence, not an execution result;
- cleanup, cancellation, restart, and reconciliation need explicit states;
- a receipt must distinguish an attempt from a verified effect; and
- exact targeting and bounded resources matter at every execution boundary.

## Why the broker architecture was retired

The broker introduced more coupling than the current problem required. Policy,
registry, broker, client, process lifecycle, persistence, cleanup, and receipt
semantics became one coupled surface.

The main failure mode was ownership drift. Policy could be defined in one
place, registry facts could become stale in another, and the broker-client seam
could still appear locally valid while the end-to-end authority contract had
changed. More transport and lifecycle machinery increased the number of crash
windows and retry paths that required independent proof.

The architecture was therefore reset to a thinner threat model. The goal was
to keep isolation and fail-closed admission explicit without making a broker a
semantic owner or a second authority plane.

## What survived in V2

Sandbox V2 uses direct, unprivileged Bubblewrap execution under explicit
capability, network, secret, filesystem, and resource boundaries. Host
admission and isolation proof are fail closed. Current claims depend on the
current V2 source and exact-candidate evidence, not on the existence of a
historical design or a remembered acceptance state.

The durable lessons remain useful: keep authority separate from mechanism,
bind every attempt to an exact candidate and budget, preserve ambiguous
outcomes, reconcile before retry, and do not infer approval or effect from
preparation alone.

## Current authority

The current Sandbox authority is the [Sandbox V2 M-series
roadmap](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md), its current
milestone contracts, and the V2 source under `apps/sandbox-v2/`,
`apps/sandbox-policy/`, and `apps/agent-service/src/core/sandbox/`.

Cross-cutting authority and external-effect meaning belong to the [External
Effect and Authority Architecture](architecture/External_Effect_and_Authority_Architecture.md).
The [Cross-Phase Architecture](architecture/Ashley_Cross_Phase_Architecture.md)
owns shared authority and evidence laws.

Do not resurrect the V1 broker, delegated execution topology, or its historical
protocols by copying this note into current source, policy, routing, or
deployment configuration. Any future change requires a new explicit
architecture decision and its own implementation, qualification, and
acceptance evidence.
