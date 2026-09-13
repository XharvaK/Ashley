# Sandbox Operations — Recovery, Sweep, Ceilings, Reconciliation

> **HISTORICAL SANDBOX V1 OPERATIONS.** This runbook describes the V1 broker.
> It is not the operating model for Sandbox V2. Bounded cleanup, crash
> finality, resource ceilings, and reconciliation are salvageable semantics;
> the broker store, session ledger, Unix IPC, and workspace sweep topology are
> not current V2 contracts. See
> [`architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md`](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md).

**Historical status:** Local hardening runbook for the sandbox broker
(`apps/sandbox-broker`, Sandbox Wave 4, Commit 12). Reflects the implemented
local broker behavior. Production deployment to Linux Mint, key provisioning,
and service install are out of scope for this wave and are not authorized by
local verification alone (see [`Sandbox_Design.md`](Sandbox_Design.md) gate
status).

This document is operational, not constitutional. Within the V1 record it sat
below [`Sandbox_Design.md`](Sandbox_Design.md). Neither document overrides the
current V2 roadmap.

---

## 1. Runtime model

The broker owns two kinds of durable state:

| Surface | Store | Contents |
|---------|-------|----------|
| Execution facts | `DurableBrokerStore` (`broker.db`, WAL) | artifacts, spent nonces, applied tombstones, task receipts, audit events, session ledger (schema `BROKER_SESSION_SCHEMA_VERSION`) |
| Workspace trees | Disposable workspace roots | One validated workspace tree + manifest per workspace id, below a configured writable disposable root |

The in-memory `BrokerStore` (`store: false`) is the fake/local store used by
tests; the `DurableBrokerStore` is the daemon store. Everything below refers to
the durable daemon path unless noted.

`SandboxBroker.restart()` is the crash-recovery entry point the daemon calls at
startup:

```text
restart()
  ├─ store.markTasksFailedOnRestart()        # running → broker_restart
  ├─ sessionLedger.recoverFromRestart(now)   # lapsed → expired; reserved → interrupted
  └─ audit("broker_recovery", {sessionsMaterialized, interruptedUses, sessionsInterrupted})
```

### 1.1 Crash-recovery semantics

Locked behavior (implemented and tested in `sessions/session-recovery.test.ts`):

- **Running sessions are never auto-resumed.** A session whose `expiresAt`
  lapsed during the downtime is materialized as `expired` with
  `recovery: true`. A still-valid session stays `active`.
- **Reserved capability uses are never retried, refunded, or reused.** A
  reserved use without a final outcome at restart is durably finalized as
  `interrupted` and emits a `session_interrupted` event. Re-finalizing it later
  is rejected (`capability_use_already_finalized`).
- **Restart is idempotent.** A second `restart()` recovers nothing and records
  a `broker_recovery` audit with zero counts.
- **In-flight tasks** are marked `broker_restart`; their approvals are not
  re-executed.

### 1.2 Agent-side approval reconcile

The agent runs `reconcileSandboxApprovals` on both paths of `openNuclearDb`
(`apps/agent-service/src/core/db.ts`). Pending/approved sandbox proposals whose
approval window lapsed are marked `expired` with
`{ reason: "approval_window_elapsed", payload: { reconcileOnOpen: true, expiresAtIso } }`.
Reconciliation never force-decides a proposal and never touches signing keys.

---

## 2. Workspace sweep

`workspaceSweep` / IPC `workspace.sweep` runs a bounded, idempotent, fail-closed
sweep of disposable workspaces (`workspace/workspace-sweep.ts`).

| Property | Behavior |
|----------|----------|
| **Eligibility** | Only workspace ids bound to **terminal** ledger sessions (`expired` / `completed` / `aborted`). Live sessions are never sweep targets, even if offered as candidates. |
| **Offered vs effective** | Caller candidates intersect terminal-session ids; when no candidates are offered, all terminal-bound ids are candidates. |
| **Bounded** | Candidates capped at `MAX_SWEEP_CANDIDATES` (1000); removals capped at the caller's `maxWorkspaces` and `MAX_SWEEP_REMOVALS` (100). |
| **Fail-closed** | Under configured disposable roots only; each candidate is re-located and re-validated through the same containment guards as cleanup. |
| **Due computation** | Only workspaces whose manifest TTL lapsed, or older than an explicit `createdBeforeMs`, are removed. |
| **Idempotent** | Re-sweeping already-removed candidates reports `already_removed` skips and removes nothing. |
| **Audit** | `workspace_sweep` records candidates / removed / skipped / cap-reached. |

`countDisposableWorkspaces` (used by the workspace-creation gate) counts only
direct children of a configured writable disposable root that are valid
workspace ids **and** have a matching manifest — a stray directory never
inflates occupancy.

---

## 3. Global resource ceilings

Master ceilings live in `constants/global-limits.ts`. They are validated at
construction (`validateSandboxGlobalLimits`; invalid config throws
`global_limits_invalid`), default to conservative values, and are enforced by
fail-closed gates at session and workspace creation boundaries.

| Ceiling | Default | Denial errorCode |
|---------|---------|------------------|
| `maxActiveSessions` (non-terminal sessions at once) | 1 | `global_limit_active_sessions` |
| `maxSessionsPerHour` (rolling) | 4 | `global_limit_sessions_per_hour` |
| `maxWorkspacesOnDisk` | 4 | `global_limit_workspaces_on_disk` |
| `maxWorkspaceCreationsPerHour` (caller-tracked rolling) | 4 | `global_limit_workspaces_per_hour` |
| `minFreeDiskBytes` (workspace-root floor) | 512 MiB | `global_limit_disk_floor` |

- `sessionCreateGate(nowMs)` assesses the ledger and is consumed by the session
  service's optional `createGate` hook.
- `workspaceCreateGate({ nowMs, workspaceCreationsLastHour })` counts on-disk
  disposable workspaces and probes free disk. **A failed disk probe is a
  denial** (`global_limit_disk_probe_unavailable`), never a pass.
- Denials are audited as `global_limit_denied` with the dimension and boundary.

---

## 4. State reconciliation

`reconcileState` / IPC `broker.reconcile` (`sessions/session-reconcile.ts`)
compares broker-owned facts against the agent's declared active policy identity
and the workspace filesystem. It **surfaces drift without force-deciding**:

| Condition | Recorded event | Idempotency marker |
|-----------|----------------|--------------------|
| Non-terminal session authorized under a policy hash that is no longer active | `session_policy_superseded` | active policy hash |
| Non-terminal session bound to a workspace the broker can no longer locate | `session_workspace_missing` | workspace id |

- Terminal sessions are skipped.
- Recording is idempotent: one event per marker per session, so repeated
  reconcile passes never duplicate events.
- Owner and peer identity are verified before any action.

---

## 5. Operator flow

### 5.1 Cold start

1. Open the `DurableBrokerStore` (runs migrations, loads artifacts/tasks/audit
   into memory).
2. Construct `SandboxBroker` with the store, root config, and (optionally)
   tuned global limits — an invalid limits config aborts with
   `global_limits_invalid` **before** serving.
3. Call `broker.restart()` to materialize crash recovery and record the
   `broker_recovery` audit.

### 5.2 Recurring maintenance

- Run a workspace sweep when terminal sessions accumulate bound workspaces.
- Run `broker.reconcile` whenever the agent activates a new policy identity or
  after workspace maintenance to surface superseded / missing bindings.
- Query `broker.status` (owner-verified) for a bounded readiness snapshot before
  load (see [`Sandbox_Status.md`](Sandbox_Status.md)).

### 5.3 Failure modes

| Condition | Broker behavior |
|-----------|-----------------|
| Persistence backend down | `status().ready` is `false`; mutating paths fail closed on flush; no partial execution. |
| Disk probe unavailable | Workspace creation is denied (`global_limit_disk_probe_unavailable`). |
| Crash during a task | Task → `broker_restart`; reserved capability use → `interrupted`; never auto-resumed. |
| Sweep of a live session's workspace | Impossible by construction: eligibility requires a terminal session binding. |

---

## 6. Explicit non-goals (this wave)

- No deployment, key provisioning, policy generation, package install, service
  restart, or network access.
- No new capability or route activation beyond the local broker surface.
- Sweep and reconcile record state; they never force-terminate sessions or
  auto-delete outside configured disposable roots.

## Related documents

- [`Sandbox_Design.md`](Sandbox_Design.md) — threat model, authority, IPC matrix
- [`Sandbox_Status.md`](Sandbox_Status.md) — status/observability reference
- [`Wave_Acceptance_Protocol.md`](Wave_Acceptance_Protocol.md) — wave gates
