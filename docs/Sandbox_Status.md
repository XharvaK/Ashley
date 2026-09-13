# Sandbox Status — Historical V1 Snapshot (Readiness, Snapshot Shape, Degradation)

> **HISTORICAL SANDBOX V1 STATUS SNAPSHOT — FROZEN, NOT CURRENT
> AUTHORITY.** This file describes V1 broker
> readiness and isolation work. It is not current Sandbox V2 readiness. Use
> [`architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md`](architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md)
> and current V2 milestone evidence. Do not infer a V2 broker dependency from
> this record.

**Historical status:** Local status/observability reference for the sandbox broker
(`apps/sandbox-broker`, Sandbox Wave 4, Commit 12, SANDBOX-ISOLATION-01).
Companion to [`Sandbox_Operations.md`](Sandbox_Operations.md). Production
deployment, key provisioning, and service install are out of scope for this
wave.

This document is operational, not constitutional. It does not override the
current V2 roadmap.

## 0. SANDBOX-ISOLATION-02E source status

02E adds source-level policy lifecycle and host-qualification hardening. It
does not establish physical Mint qualification, sandbox activation, delegated
runtime enablement, Ashley-side activation, or Sandbox Autonomy completion.

- Expired R4-004 remains fail-closed. The qualification helper performs
  canonical policy preflight before any service installation or systemd
  mutation and reports `delegated_policy_expired` before startup.
- Stable-service qualification requires consecutive active/running samples,
  a nonzero main PID, unchanged restart count, and the exact cgroup
  `/system.slice/ashley-exec-broker.service`. Restart gaps and loops remain
  lifecycle failures, not cgroup evidence.
- The service resource contract is `TasksMax=256` and `pids.max=256`.
  `MemoryHigh=1536M`, `MemoryMax=2048M`, and `CPUQuota=100%` are unchanged.
- R4-005 is not issued by this change. The owner-controlled staging script
  requires explicit owner confirmation, preserves the accepted R4-004
  authority surface, reuses its bounded lifetime convention, and requires an
  explicit lifetime decision if that convention is absent. It does not
  install, activate, deploy, or enable the delegated runtime.
- `RESOURCE-ISOLATION-FOLLOWUP` remains frozen. 02E does not add per-task
  cgroups.

---

## 1. Execution isolation (SANDBOX-ISOLATION-01)

`FixedRecipeExecutionService` now gates execution behind a
**spawn-coupled execution isolation** check (stage `isolation`). Two provider
implementations ship in `apps/sandbox-broker/src/execution/`:

- `LinuxExecutionIsolation` — Linux Mint (production) path: extends the
  R5A spawn-coupled `LinuxUnshareNetworkIsolation`; reports honest evidence
  over the mechanism properties. The currently wired mechanism is
  `unshare --user --map-root-user --net` (network isolation only);
  `process_tree`/`filesystem_view` are `unproven` until candidate A
  (`--pid --fork --mount --mount-proc`) is qualified, and the control-plane
  and broker-socket properties are KNOWN `absent` (child uid == broker uid).
- `BubblewrapExecutionIsolation` — bubblewrap (`bwrap`) path: the same
  evidence contract, with a hard policy that `/` is **never** bound and that
  only exact, declared disposable workspace roots may be bound under
  control-plane parents. Not qualified: stays `unproven` and fails closed
  unless `qualified: true` is supplied by host qualification.

The gate is **fail-closed** by default (operational posture): a recipe that
declares `requiredIsolation` will not spawn unless `isolationActivationLevel >=
1` **and** the merged evidence (provider claim + broker-owned facts of the run)
satisfies the requirement. Refusals occur before reservation and never consume
a reservation.

| Field | Meaning |
|-------|---------|
| `isolationActivationLevel` (broker option, default `0`) | Master ceiling for execution-isolation authority. `0` = isolation refused for any recipe that requires it. |
| `ExecutionIsolationProvider.evidence()` | Honest mechanism claim; broker-owned facts are merged at eval time. |
| `BrokerOwnedIsolationFacts` | `workspaceBound`, `sourceIdentityBound`, `environmentHardened`, `resourceLimitsEnforced` — set by the service per run. |
| `formatIsolationEvidenceSummary` | Bounded human-readable summary written to the task audit (`audit.isolationEvidenceSummary`); `null` when no provider is configured. |

### Operational posture

- Default (`isolationActivationLevel` unset/`0`): recipes with
  `requiredIsolation` are refused at stage `isolation` with
  `isolation_not_activated`. The isolation summary is recorded as `null`.
- `isolationActivationLevel >= 1` with no `ExecutionIsolationProvider`:
  `isolation_evidence_unavailable`.
- Provider evidence present but unmet requirement:
  `isolation_requirement_unmet:<property>:<reason>`.

A canary recipe (`verify:broker-smoke`, `/usr/bin/true --smoke`,
`requiredIsolation = level 1`) exercises every branch in
`src/execution/canary-isolation.test.ts` via a mock full-evidence provider in
test #7. The canary asserts on the *gate logic*, not on live host
qualification.

For this wave, the autonomous level-1 requirement is exactly:

| Property | Required evidence |
|----------|-------------------|
| `network` | `provided` |
| `process_tree` | `partial` or stronger |
| `control_plane_invisible` | `provided` |
| `broker_socket_invisible` | `provided` |

The broker also records per-run evidence for the hardened environment,
identity-resolved source binding, exact session-workspace binding, and runner
resource limits. Those broker-owned facts do not manufacture provider-owned
filesystem or control-plane qualification. A recipe requirement must name the
property before the gate can accept it.

### Readiness (non-overclaiming)

The composite readiness below describes the **default local** posture only.
Statuses are sourced from honest evidence, not configuration claims.

| Property | Status (Linux provider) | Source | Notes |
|----------|-------------------------|--------|-------|
| provider availability | unavailable | source | `LinuxUnshareNetworkIsolation` not wired into the local service by default |
| mechanism preparation | unproven | source | candidate A `--pid --fork --mount --mount-proc` designed, not wired |
| network isolation | unproven | source | R5A network provider exists but is not activated locally |
| process-tree containment | unproven | source | candidate A unqualified; current `RestrictNamespaces=user net` does not qualify it |
| filesystem containment | unproven | source | CWD and broker path checks are not a kernel filesystem boundary; mount namespace unqualified |
| control-plane invisibility | absent (known-visible) | source | child uid == broker uid; control-plane paths remain reachable |
| socket invisibility | absent (known-visible) | source | child uid == broker uid; `/run/ashley/broker.sock` reachable |
| broker socket invisibility | absent (known-visible) | source | same uid, mode 0660 |
| environment hardening | partial (broker-owned) | source | allowlist, synthetic `HOME`, fixed `PATH=/usr/bin:/bin`; `NODE_OPTIONS` denied |
| source binding | per-run | source | `provided` only when the workspace manifest carries the identity-resolved source root |
| session-workspace binding | per-run | source | `provided` only for an exact revalidated disposable workspace; CWD alone is not filesystem containment |
| resource containment | partial | source | runner wall/process/output limits only; no cgroup CPU/memory ceiling |
| recipe executable readiness | unproven | source | `/usr/bin/true` is the only level-1 recipe; no source-verification toolchain |

Because `process_tree` is `unproven`, `control_plane_invisible` is absent, and
`broker_socket_invisible` is absent, the canary's level-1 requirement is not met
by the Linux provider's real evidence. The canary therefore does not execute
under the real Linux provider. This is fail-closed behavior by design; the
mock-provider test proves the gate, not the host.

### Outcome semantics

Before reservation, `refused` means the broker knows execution did not
proceed. After reservation, a failure while finalizing or recording the result
returns explicit `outcome_unknown`; the broker cannot establish whether the
attempt executed or whether the response was lost. The audit uses the same
`outcome_unknown` status. A durable execution-state and reconciliation design
is `DEFERRED — REQUIRED BEFORE EFFECTFUL LIVE EXECUTION`.

### Environment and namespace qualification

When `PATH` is allowlisted, the child receives only the broker-fixed
`/usr/bin:/bin` value. Ambient broker `PATH` is not copied. `NODE_OPTIONS` is
always denied, and explicit `allowNodeOptions` callers are `NONE`.

The current bubblewrap plan explicitly requests PID, network, UTS, and IPC
namespaces through `--unshare-pid`, `--unshare-net`, `--unshare-uts`, and
`--unshare-ipc`. Its binds, fresh `/proc`, `/dev`, and `/tmp` require the
mount-namespace boundary. Unprivileged operation also requires user-namespace
support. The plan does not bind `/` or the broker control plane.

The 02E source contract requires `RestrictNamespaces=user mnt pid net uts ipc`;
`mnt` is systemd's mount-namespace identifier. The qualification helper first
preflights the configured delegated policy, then verifies the effective
systemd property after installation and reload, and only reads cgroup evidence
after stable-service qualification. No 02E physical qualification has passed,
so this source contract is not evidence that the current host service is ready.
The provider remains fail-closed until the fresh physical run produces bound
evidence.

## 2. Broker status surface

`SandboxBroker.status()` answers IPC `broker.status` (the 16th message in the
broker dispatch table). It is **owner-verified**: the request must pass
`assertOwnerPeer` before any snapshot is produced, so a non-owner peer is
rejected outright.

The snapshot is deliberately **bounded**: aggregate counts and the active master
ceilings only. It never exposes task payloads, artifacts, keys, nonces, or
internal store state.

```ts
type BrokerStatusSnapshot = {
  ready: boolean;                       // fail-closed: requires healthy persistence
  persistence: "ok" | "degraded";
  schemaVersion: number;                // BROKER_SESSION_SCHEMA_VERSION
  ownerId: string;
  sessions: { active: number; total: number };
  audits: number;
  workspaceBytesUsed: number;
  globalLimits: {
    maxActiveSessions: number;
    maxSessionsPerHour: number;
    maxWorkspacesOnDisk: number;
    maxWorkspaceCreationsPerHour: number;
    minFreeDiskBytes: number;
  };
};
```

### 2.1 `ready` is fail-closed

`ready` is `true` **only** when `store.persistenceHealthy()` is true. The base
(in-memory) store reports healthy; the durable store reports healthy only while
its SQLite handle is open (`database.isOpen`). When the persistence backend is
down:

- `ready` becomes `false`,
- `persistence` becomes `"degraded"`,
- `status()` **skips ledger and audit reads** so a down backend cannot make the
  status call itself throw,
- aggregate session counts are reported as zero in the degraded path
  (fail-closed rather than fabricated).

### 2.2 Behavior with a closed backend

When `persistenceHealthy()` is false the snapshot still returns with `ok: true`
so the caller can read the degraded state; mutating paths, by contrast, fail
closed on flush (see `broker.status` / `task.submit` failure-injection tests).

---

## 3. Agent-side integration

`apps/agent-service/src/core/change-proposal/broker-client.ts` exposes
`BrokerStatusSnapshot` and `fetchBrokerStatus(transport)`, which dispatches
`broker.status` and returns a typed dispatch result.

`apps/agent-service/src/core/sandbox/availability.ts` folds the broker snapshot
into the sandbox availability surface:

- `SandboxAvailabilitySnapshot.brokerStatus?: BrokerStatusSnapshot | null`
  carries the latest broker answer; it is `null` when the broker did not answer
  status.
- `probeSandboxBrokerReachability(ownerId, transport)` first verifies reachability
  with `artifact.list`; on success it fetches `broker.status` and caches the
  snapshot in the module-level reachability cache.
- Qualification states: `disabled` → `socket_missing` → `keys_missing` →
  `configured` → `qualified` / `unreachable`. `qualified` means the socket is
  reachable and signing keys are configured this session — it does **not**
  license any task; each isolated task still requires an owner-signed approval.

---

## 4. Related status and diagnostics

The agent also surfaces owner-only nuclear observability endpoints for
diagnostics (see `AGENTS.md`):

| Endpoint | Purpose |
|----------|---------|
| `GET /nuclear/capabilities?owner_id=` | Capability rollout status |
| `GET /nuclear/status?owner_id=` | Nuclear health + initiative + relationship state |
| `GET /nuclear/relationship?owner_id=` | Relationship state summary |

The broker's own status is the OS-boundary counterpart: it reports persistence,
schema, occupancy, and the master ceilings that bound sandbox growth.

---

## 5. Degradation quick reference

| Signal | Meaning | Operator action |
|--------|---------|-----------------|
| `ready: false`, `persistence: "degraded"` | Broker SQLite handle is closed / persistence down | Restore persistence; broker rejects mutating work |
| `brokerStatus: null` (agent) | Broker answered nothing at last probe | Re-probe; check socket / service |
| `qualification: "unreachable"` | Socket present but dispatch failed | Inspect broker service logs |
| `global_limit_*` denials | Master ceiling hit at a creation boundary | Retire terminal sessions / sweep workspaces; see `Sandbox_Operations.md` §3–4 |

## Related documents

- [`Sandbox_Operations.md`](Sandbox_Operations.md) — recovery, sweep, ceilings, reconcile
- [`Sandbox_Design.md`](Sandbox_Design.md) — threat model and authority
