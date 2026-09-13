# ASHLEY SANDBOX PRODUCTION RELEASE PACKET v1

> **HISTORICAL SANDBOX V1 RELEASE RECORD.** This packet concerns the retired
> broker execution topology. It does not govern, qualify, release, deploy, or
> promote Sandbox V2. Current V2 authority lives in
> [`ASHLEY_SANDBOX_V2_ROADMAP.md`](ASHLEY_SANDBOX_V2_ROADMAP.md). Preserve this
> file as exact-scope V1 provenance only.

Prepared: 2026-08-09

Scope: read-only release planning for the existing Ashley sandbox broker and
typed Unix client. This packet does not implement, activate, qualify, install,
restart, or deploy the sandbox.

## Status

PREPARED — ACTIVATION NOT AUTHORIZED

Preparation result: PASS.

Release result: BLOCKED. The packet is prepared, but the sandbox is not
Release_qualified and is not live delegated access.

Current state:

- Infrastructure implemented: YES. The checked-in broker, policy, Unix
  transport, session, workspace, receipt, and operator seams exist.
- Release-qualified: NO. Wave 07b and Wave 07c are Wave_accepted only.
- Live delegated access: NO evidence. No Mint host, socket, key, service, or
  delegated session was inspected in this pass.
- Ashley autonomy through the sandbox: NO. The production operator adapter and
  normal runtime loop are not wired; lifecycle defaults to disabled.

## SANDBOX-ISOLATION-02E source addendum

The 02E source change does not change this packet's release decision. It adds
canonical delegated-policy preflight before qualification-side service
mutation, stable-service qualification before cgroup evidence, and the
service-level `TasksMax=256` / `pids.max=256` contract. `MemoryHigh=1536M`,
`MemoryMax=2048M`, and `CPUQuota=100%` remain unchanged. The required cgroup is
`/system.slice/ashley-exec-broker.service`.

R4-004 is expired and remains fail-closed. R4-005 is not issued by 02E. The
owner-controlled preparation path reuses the existing bounded policy lifetime
or requires an explicit owner decision when no source convention exists. No
physical host qualification, service activation, delegated runtime enablement,
Ashley-side activation, or deployment is established by this source change.

## AUTONOMY-PLUMBING-01 local source addendum

This addendum records a separately authorized local source/test pass on
2026-08-09. It does not alter the SBX-REL-01 release gate or qualify,
activate, install, restart, or deploy the sandbox.

The current revalidated checkout is
18c7cf88e17671929c5bec5d22d5d209719036ef on master, equal to origin/master.
The historical source snapshot and release blockers below remain evidence
that must be reconciled against one exact future release SHA.

- Delegated nonce construction is now durable locally:
  apps/sandbox-broker/src/broker.ts injects the existing
  BrokerStore.recordNonce into DelegatedRuntime. Reopen, duplicate-winner,
  and persistence-failure tests pass in a disposable broker store.
- Delegated readiness is now truthful locally:
  apps/sandbox-broker/src/delegated/runtime.ts requires valid material,
  supported recipe capacity, networkProvider=none, and operational isolation;
  the Unix client rejects missing or malformed isolation/readiness material.
- The normal Ashley sandbox runtime remains unwired. Phase F is BLOCKED:
  runSandboxLoop still requires injected test diagnostics and an operator
  adapter, only the fixture adapter is concrete, and lifecycle evaluation and
  enabled remain refused.
- Release result remains BLOCKED and current decision remains HOLD. No live
  broker, key, policy, Mint host, receipt, namespace probe, or canary was
  inspected or executed.

This packet remains the only artifact authorized by SBX-REL-01. Its original
read-only scope changed no existing document, source file, test, dependency,
schema, environment, service, key, database, or configuration. The separate
AUTONOMY-PLUMBING-01 addendum and local changes do not grant SBX-REL-01
activation or release authority.

## Release gate

RECALL CANARY PASS REQUIRED

The accepted foundation decision selects sandbox activation only after the
natural Recall canary. Read-only release planning may proceed before that
gate, but activation and release qualification remain separately authorized
actions. Sources: docs/architecture/Ashley_Foundation_Architecture_Decision_v1.md:605-640
and docs/Wave_Acceptance_Protocol.md:12-21, 104-132.

The required order is:

1. Natural Recall canary passes and is recorded by the owner.
2. Doc explicitly authorizes sandbox release qualification.
3. Mint host, policy, key custody, peer boundary, namespace isolation,
   execution, receipt, negative, and rollback evidence is collected.
4. Doc makes the separate keep, disable, or release decision.

No step below changes that order.

## Source baseline

The inspected checkout was:

- Repository: C:/Users/Xharv/Projects/composer-assistant
- Branch: master
- HEAD: bba152be1805cff2c5a71dc8f26947e334a81ac0
- origin/master: bba152be1805cff2c5a71dc8f26947e334a81ac0
- HEAD subject: docs(architecture): record Semantica salvage audit
- Initial worktree: clean

The foundation decision and salvage map embed an older baseline,
0efb0250989e2b67a9b0b3d7e8fce81568ae0975. That is documentation baseline
metadata, not the current release candidate. A future release packet must
select one exact source SHA and verify every deployed artifact against it.
This mismatch is a release blocker for source identity, not a reason to alter
the governing documents in this read-only task.

## Current implementation map

### Agent-side seams

- apps/agent-service/src/index.ts:13-20 constructs the production Unix
  sandbox client and injects it into the HTTP server.
- The delegated client is constructed only when
  ASHLEY_SANDBOX_DELEGATED_ENABLED is true and a broker socket path exists:
  apps/agent-service/src/core/sandbox/unix-broker-client.ts:293-569.
- The proposal transport has a separate broker opt-in,
  ASHLEY_SANDBOX_BROKER_ENABLED, and is also disabled by default:
  apps/agent-service/src/core/change-proposal/unix-broker-transport.ts:198-206.
- Owner-gated approval, tombstone-signing, proposal, and resume routes exist
  in apps/agent-service/src/server.ts:678-872. They do not execute work.
- The normal sandbox loop is dependency-injected. Its interface requires an
  operator adapter, broker client, delegated key material, clock, and bounds:
  apps/agent-service/src/core/sandbox/loop.ts:73-126.
- The only concrete operator adapter in the inspected source is the fixture
  adapter. Its production-wiring comment is explicit, and lifecycle values
  evaluation and enabled refuse to run in this commit:
  apps/agent-service/src/core/sandbox/operator-adapter.ts:48-70 and
  apps/agent-service/src/core/sandbox/lifecycle.ts:41-75.

### Broker and transport

- apps/sandbox-broker/src/main.ts:68-174 loads the delegated runtime only
  behind ASHLEY_SANDBOX_DELEGATED_ENABLED, verifies the active policy, resolves
  canonical roots, loads broker-owned recipe material, and selects the network
  isolation provider.
- The Unix server requires peer credentials by default and rejects missing or
  mismatched peer UIDs:
  apps/sandbox-broker/src/server.ts:34-63, 120-153.
- The Linux helper obtains SO_PEERCRED and fails closed on missing or malformed
  output: apps/sandbox-broker/src/peer-credentials.ts:10-38 and
  apps/sandbox-broker/src/peer-credentials-helper.c:7-16.
- The production broker is socket-activated on
  /run/ashley/broker.sock and runs as ashley-sandbox under the checked-in
  systemd hardening: deploy/linux-mint/sandbox/systemd/ashley-exec-broker.service:7-40
  and deploy/linux-mint/sandbox/systemd/ashley-exec-broker.socket:4-11.

### Authorization, execution, and evidence

- Delegated authorization verifies the fixed Ed25519 signer, owner binding,
  active owner-signed policy identity, policy expiry, network mode, nonce,
  broker-resolved canonical paths, capability, risk, rule, and owner approval
  requirements: apps/sandbox-broker/src/policy/delegated-authorization.ts:1-49
  and :620-930.
- FixedRecipeExecutionService is the single fixed-recipe execution chain. It
  verifies authorization, session, capability, recipe, limits, executable,
  cwd, workspace, and network preparation before reservation and spawn:
  apps/sandbox-broker/src/execution/fixed-recipe-execution-service.ts:101-418.
- The runner uses direct argv execution, shell false, an explicit environment,
  PGID cancellation on Linux, bounded output, and bounded wall time:
  apps/sandbox-broker/src/process/real-runner.ts:22-117.
- Receipts contain hashes, byte counts, terminal state, effective limits,
  isolation status, and a receipt hash; they do not contain raw output or
  environment values: apps/sandbox-broker/src/execution/receipt.ts:1-100.
- Workspace resolution is broker-owned and realpath-based; writes and deletes
  are constrained to disposable roots/workspaces, and sanitized copy rejects
  symlinks, special files, privileged bits, path escapes, and case collisions:
  apps/sandbox-broker/src/policy/path.ts:42-67, 159-300 and
  apps/sandbox-broker/src/workspace/workspace-copy.ts:1-16, 131-333.

### Network and process boundary

- The invariant is explicit: NO ISOLATION → NO SPAWN.
- The unavailable provider refuses before reservation or spawn:
  apps/sandbox-broker/src/execution/network-isolation.ts:9-29, 75-117.
- The Linux provider prepares the exact unshare argv with user and network
  namespaces, requires an active probe, and has no ordinary-spawn fallback:
  apps/sandbox-broker/src/execution/linux-network-isolation.ts:1-38,
  168-217, 219-310.
- Production selection keeps the provider unavailable by default. Selecting
  none requires the qualification flag and then a boot-time active probe:
  apps/sandbox-broker/src/execution/linux-network-isolation.ts:312-359.
- Service-level hardening is present in the checked-in unit, while per-task
  cgroup delegation and hard RSS enforcement remain deferred by design:
  docs/Sandbox_Design.md:358-390, 399-445.

## Authority chain

The packet follows the project authority order:

1. VISION.md
2. docs/Ashley_Core_Principles.md
3. docs/Ashley_Constitution.md
4. docs/Ashley_Stewardship_Compact.md and docs/Ashley_Ethics.md
5. docs/Ashley_Hierarchy.md
6. Accepted architecture decisions and the Wave Acceptance Protocol
7. docs/Sandbox_Design.md and docs/Sandbox_Operations.md
8. Owner-signed policy and approval envelopes
9. Broker peer verification, policy recomputation, session/capability checks,
   and fixed-recipe execution

Thought may propose. Agency may gate. Expression may explain or ask. Neither
may sign, widen scope, authorize host execution, or become a sandbox authority.
The broker is the final execution authority. External content is untrusted.
This follows docs/Sandbox_Design.md:13-22, 61-80 and
docs/Ashley_Constitution.md:1449-1475, 1716-1752.

## Configuration / boot gates

| Gate | Source-backed behavior | Required future evidence |
|---|---|---|
| Agent broker opt-in | ASHLEY_SANDBOX_BROKER_ENABLED defaults false; the proposal transport is absent otherwise. | Agent configuration metadata confirms false until explicit opt-in. |
| Agent delegated opt-in | ASHLEY_SANDBOX_DELEGATED_ENABLED defaults false; the Unix sandbox client is absent otherwise. | Exact agent environment flags and socket path, without reading secrets. |
| Agent lifecycle | ASHLEY_SANDBOX_LIFECYCLE defaults disabled; non-disabled values still fail the current production lifecycle gate. | A separately authorized runtime-wiring decision, if general autonomy is in scope. |
| Agent readiness dependencies | Active configuration requires owner and continuity key metadata, policy pair, owner public key, and delegated key path existence checks. | Metadata/fingerprint checks only; never expose private key contents. |
| Broker host | Linux is required; state root, workspace root, owner ID, public keys, manifest, helper, and socket activation/path are required. | Mint preflight and exact installed artifact hashes. |
| Delegated runtime | Broker-side delegated enablement requires policy, delegated public key, encrypted capability key, passphrase path, owner/continuity public keys, canonical roots, and executable mappings. | Fresh live inspection with secrets withheld. |
| Network | unavailable is the default. none requires ASHLEY_SANDBOX_NETWORK_ISOLATION_QUALIFIED=true and a successful active probe. | R5B probe evidence under the installed systemd unit. |
| Peer boundary | SO_PEERCRED is required; the peer UID must equal the configured Ashley agent UID. | Live UID/GID, group membership, socket owner/group/mode, and accepted/rejected peer evidence. |
| Policy | The broker loads and verifies an active owner-signed policy, checks identity/hash/expiry, and rederives decisions. | Current policy ID/version/hash/expiry and public-key fingerprints. |
| Recipe | The broker-owned manifest controls supported recipes; unsupported/planning-only/unmapped recipes refuse. | Exact deployed manifest and executable mappings. |
| Execution | Fixed argv, absolute executable, bounded limits, canonical cwd/workspace, allowlisted environment, and prepared isolation are required. | One future bounded canary plus all negative checks. |
| Persistence | Durable broker.db backs artifacts, task receipts, audit rows, owner nonces, tombstones, and session ledger state. | Live database health and restart-recovery evidence without deleting audit history. |

The agent and broker use separate environment surfaces. The broker daemon uses
ASHLEY_SANDBOX_SOCKET, while the agent client uses
ASHLEY_SANDBOX_BROKER_SOCKET. A future release must verify both sides rather
than inferring one from the other.

## Existing qualification evidence

The following evidence is historical or local. None is Mint release evidence.

| Evidence | What it supports | What it does not support |
|---|---|---|
| Wave 07b gate packet, 2026-08-04 | Local fake/in-process broker, signatures, path policy, bounded fixtures, and historical local builds/tests. | Real SO_PEERCRED, systemd, durable Mint state, production wiring, or release qualification. |
| Wave 07c gate packet, 2026-08-04 | Local Unix framing, daemon source, peer helper, durable-store source, real-runner source, agent transport seam, and historical local test/build results. | Mint user/service/socket, Linux peer credentials, systemd namespace behavior, live keys, agent opt-in, or delegated execution. |
| Wave 10c gate packet, 2026-08-04 | Local health/resource/backup/document assurance and explicit no-live boundary. | Mint combined-resource measurements, live service, provider, credential, or network evidence. |
| Sandbox_Status.md | Bounded owner-safe status shape and qualification-state semantics. | Current Mint status; no live broker was queried. |
| Sandbox_Design.md | Threat model, authority matrix, hardening, R5A/R5B requirements, and deferred risks. | Operational proof that the host satisfies those requirements. |
| Mint README and scripts | Future operator order, preflight/install boundaries, default smoke manifest, and the existing one-shot driver. | Current policy, current key state, current host state, or permission to execute. |
| Foundation decision and salvage map | Keep the existing client/policy/broker and wait for Recall before activation. | Release qualification or deployment authorization. |

Wave acceptance remains below Release_qualified on the acceptance ladder:
docs/Wave_Acceptance_Protocol.md:25-42, 104-132.

## Existing test evidence

Static inspection found targeted coverage for:

- peer credentials and Unix server rejection:
  apps/sandbox-broker/src/server.test.ts
- delegated signature, expiry, signer class, non-none network mode, policy
  verification, and owner approval:
  apps/sandbox-broker/src/crypto/delegated-approval.test.ts,
  delegated-policy.test.ts, owner-approval.test.ts,
  and execution/owner-approval-execution.test.ts
- canonical paths, symlink escape, roots, recipes, executable mappings, argv,
  and environment:
  apps/sandbox-broker/src/policy/path-facts.test.ts,
  delegated-root-facts.integration.test.ts, recipe-registry.test.ts,
  execution.test.ts, execution/executable-resolver.test.ts, and
  execution/fixed-recipe-execution-service.test.ts
- the fail-closed network contract and Linux namespace preparation:
  apps/sandbox-broker/src/execution/network-isolation.test.ts,
  linux-network-isolation.test.ts, and
  process/linux-network-isolation.integration.test.ts
- bounded output, receipt hashing, secret omission, sessions, restart recovery,
  and durable metadata:
  apps/sandbox-broker/src/execution/receipt.test.ts,
  bounded-output.test.ts, sessions/session-recovery.test.ts,
  sessions/session-ledger.test.ts, and store/durable-store.test.ts
- the existing delegated driver flow, including one-shot budget and terminal
  finalization:
  apps/agent-service/src/core/sandbox/verify-agent-tsc.driver.test.ts

The platform integration tests are host-gated, and this audit ran on Windows.
The historical gate packets report prior local test/build results, but no full
application test suite was rerun for this doc-only audit. Test presence is not
Mint qualification.

## Release-critical security audit

Classification uses RELEASE BLOCKER, HARDEN BEFORE RELEASE, ACCEPTED CURRENT
LIMITATION, and NON-BLOCKING.

| Area | Finding | Classification | Required closure |
|---|---|---|---|
| Recall ordering | The natural Recall canary is not recorded as a passed gate in this packet. | RELEASE BLOCKER | Owner records the Recall canary pass before any activation review. |
| Exact source identity | Current HEAD/origin/master is bba152b, while the accepted foundation/salvage documents embed 0efb025 as their baseline. | RELEASE BLOCKER | Freeze one candidate SHA and prove deployed source/dist hashes match it. |
| Mint qualification | No live Mint inspection, preflight, service, socket, peer, namespace, or receipt evidence exists here. | RELEASE BLOCKER | Perform the separately authorized future Mint phases below. |
| Peer authentication | Production source requires SO_PEERCRED and the expected agent UID; Windows only has injected test stand-ins. | ACCEPTED CURRENT LIMITATION | Reconfirm on Mint with accepted and rejected peer evidence. |
| Owner and policy binding | Broker checks trusted owner ID, owner-signed active policy identity/hash/expiry, signer class, capability, risk, and rule. | ACCEPTED CURRENT LIMITATION | Verify current public-key fingerprints and policy hash/expiry on Mint. |
| Delegated nonce durability | The local source closure injects BrokerStore.recordNonce into the delegated runtime, and disposable tests prove reopen replay refusal, one duplicate winner, and persistence-failure refusal. | RELEASE BLOCKER until release evidence | Freeze the exact candidate SHA and prove the deployed broker uses the same durable ledger with restart/replay evidence on Mint. |
| Policy expiry evidence | R4-004 (`pol-production-r4-004`) expired at 2026-08-08T13:27Z and remains fail-closed. 02E adds preflight that reports `delegated_policy_expired` before service mutation; no R4-005 artifact is issued by this change. | RELEASE BLOCKER | Owner explicitly prepares a fresh R4-005 pair through the controlled signing path, reusing the existing bounded lifetime or making an explicit lifetime decision, then verifies its expiry covers the complete canary window and matches its hash to broker readiness. |
| Canonical paths and symlinks | Broker-owned realpath facts, protected roots, workspace containment, special-file denial, and sanitized-copy rules are implemented and locally tested. | ACCEPTED CURRENT LIMITATION | Reconfirm live roots, symlink-preserving staging, and workspace containment on Mint. |
| Recipe and executable authority | Broker-owned manifests, fixed argv, absolute executable mapping, unsupported/planning-only refusal, and no shell/inherited environment are implemented. The checked-in deployment manifest enables only verify:broker-smoke; verify:agent-tsc is marked unsupported. | ACCEPTED CURRENT LIMITATION | Qualify the exact manifest/toolchain selected for the canary; do not silently promote the unsupported entry. |
| Network isolation | unavailable refuses; none requires qualification and active probe; prepare returns the exact isolated spawn request, and refusal occurs before reservation/spawn. | RELEASE BLOCKER | Pass the active R5B probe under the installed unit and record namespace-scoped /proc/net/dev evidence containing only lo. If isolation is unavailable, do not spawn. |
| Readiness truthfulness | The local source closure derives broker readiness from valid material, supported recipe capacity, networkProvider=none, and operational isolation. The Unix client requires and validates the isolation field and recomputes ready fail-closed. | RELEASE BLOCKER until release evidence | Freeze the exact candidate SHA and verify live readiness plus the active isolation probe; keep the delegated surface disabled otherwise. |
| Process limits | Service limits and PGID cancellation exist. The 02E service contract raises `TasksMax` / `pids.max` to 256 while preserving the other service ceilings. Per-task cgroup delegation and hard per-task RSS enforcement remain explicitly deferred. | HARDEN BEFORE RELEASE | Decide and document whether the bounded canary accepts the service-level boundary; otherwise complete the separately designed cgroup hardening before broad execution. |
| Deadline, output, and receipts | Direct runner, bounded wall/output, redaction, hashes, receipt hash, and terminal finalization are implemented. | ACCEPTED CURRENT LIMITATION | Inspect one live receipt and audit row for absence of raw output, env values, keys, and secrets. |
| Restart and abort | Durable task/session recovery marks interrupted work terminal, does not auto-resume, and does not refund consumed uses. | ACCEPTED CURRENT LIMITATION | Reconfirm after a separately authorized recovery qualification; preserve all audit evidence. |
| Production autonomy wiring | The normal loop requires an operator adapter and lifecycle gate; production adapter/wiring is absent. | RELEASE BLOCKER for general autonomous sandbox access; NON-BLOCKING for the explicitly bounded standalone one-shot driver | Keep general autonomy disabled. Treat the existing driver as a separate, one-shot qualification surface only. |
| Secret custody | Source and docs keep private keys out of the broker workspace, model, IPC diagnostics, receipts, and installer inputs except encrypted broker-owned material. | ACCEPTED CURRENT LIMITATION | Inspect only metadata, permissions, and public fingerprints on Mint; never print or copy private key material. |

The central containment invariant is non-negotiable:

NO ISOLATION → NO SPAWN

No packet phase may weaken that invariant to obtain a successful canary.

## Release blockers

The sandbox cannot be marked Release_qualified while any of the following
remain open:

1. The natural Recall canary has not passed and been recorded.
2. There is no exact release SHA and deployed-artifact hash match.
3. Mint has not supplied authorized live evidence for the peer boundary,
   systemd hardening, broker state, active policy, key fingerprints, manifest,
   namespace probe, and bounded receipt.
4. Mint has not supplied restart/replay evidence for the locally corrected
   delegated nonce ledger on the exact release source.
5. Mint has not supplied truthful delegated readiness and active isolation
   probe evidence on the exact release source.
6. The current policy reference is stale and no fresh live policy is verified.
7. The current deployment manifest does not support the proposed
   verify:agent-tsc canary.
8. General autonomous access is not wired and must remain disabled; any scope
   that expects Ashley's normal runtime to execute requires a separate
   implementation and release review.

## Preconditions

Before any future qualification action:

- Doc has recorded the natural Recall canary as PASS.
- Doc has separately authorized SBX-REL-01 Mint release qualification.
- The exact source SHA, package lock state, built artifact hashes, and target
  host checkout are frozen and recorded.
- No private key, passphrase, .env value, production database, or provider
  credential is entered into this packet or exposed in diagnostics.
- A fresh owner-signed policy pair exists, is not expired or near expiry, and
  explicitly allows the selected role, capability, recipe, temporary
  persistence, and networkMode none.
- Public key fingerprints and key IDs are recorded without reading private
  material; delegated and capability keypair checks occur in their custody
  boundaries.
- The broker is disabled and unavailable until the exact future phase that
  authorizes the canary.
- The host passes the Linux, systemd, Node, helper, manifest, filesystem, and
  namespace prerequisites.
- The network provider is operationally proven. A configuration flag alone is
  not evidence.
- A rollback owner, evidence retention location, and human decision window are
  agreed before the first live canary.

## Future Phase 0–N procedure

Every action in this section is future-only. This packet grants no Mint,
network, key, service, broker, or delegated-execution authority.

### Phase 0 — Recall and authority gate

PRECONDITION

- Ashley's natural Recall canary is complete and Doc has recorded PASS.

READ-ONLY CHECKS

- Confirm the Recall result, source SHA, and absence of unrelated live
  service/configuration changes during the canary window.
- Confirm this packet remains the sole SBX-REL-01 artifact.

AUTHORIZED ACTION — FUTURE ONLY

- None. Doc may authorize the next phase separately.

EXPECTED STATE

- Sandbox remains disabled, unqualified, and inactive.

FAIL CONDITION

- Missing Recall evidence, ambiguous canary outcome, or source drift.

ROLLBACK CONDITION

- Stop planning at this gate; preserve the Recall evidence and do not enable
  any sandbox flag.

### Phase 1 — Exact source and Mint snapshot

PRECONDITION

- Phase 0 PASS and explicit Mint read-only inspection authorization.

READ-ONLY CHECKS

- Record the deployed checkout SHA, origin relationship, package-lock hashes,
  built broker/agent artifact hashes, and systemd unit file hashes.
- Record host OS/kernel/Node/systemd versions, agent UID/GID, broker UID/GID,
  group membership, socket metadata, state/workspace roots, and manifest hash.
- Record only public-key fingerprints, key IDs, file ownership, modes, and
  existence metadata. Do not read or display private key contents, passphrases,
  .env values, databases, or conversation data.

AUTHORIZED ACTION — FUTURE ONLY

- None beyond the separately authorized read-only inspection.

EXPECTED STATE

- One unambiguous source and deployment identity; no active delegated access
  is inferred from file presence.

FAIL CONDITION

- Any hash mismatch, unknown checkout, missing artifact, path drift, unexpected
  user/group, world-readable secret metadata, or source baseline ambiguity.

ROLLBACK CONDITION

- Stop before preflight continuation; retain only scrubbed metadata and do not
  copy, rotate, generate, or delete keys.

### Phase 2 — Disabled broker and read-only preflight

PRECONDITION

- Phase 1 PASS.

READ-ONLY CHECKS

- Run the existing read-only Mint preflight with the daemon requirement.
- Inspect the existing status surface, installed units, socket metadata,
  state-root metadata, broker persistence health, and exact recipe manifest.
- Confirm the delegated and agent opt-in flags remain false while this phase is
  being assessed.

AUTHORIZED ACTION — FUTURE ONLY

- None. Installation, user creation, group changes, unit changes, and socket
  activation remain separately gated.

EXPECTED STATE

- Preflight passes or reports only understood non-blocking warnings; broker
  execution and delegated runtime remain unavailable.

FAIL CONDITION

- Any blocking preflight failure, unexpected installed unit, socket exposure,
  wrong ownership/mode, missing helper, missing manifest, or ambiguous state.

ROLLBACK CONDITION

- Hold at disabled state; do not repair the host inside this packet.

### Phase 3 — Peer and broker transport qualification

PRECONDITION

- Phase 2 PASS and a separately approved installed-but-disabled broker state.

READ-ONLY CHECKS

- Verify AF_UNIX-only transport, socket owner/group/mode, expected agent UID,
  SO_PEERCRED helper identity, and broker status persistence metadata.
- Use the existing broker reachability/smoke surface only as an owner-scoped
  read, not as task authorization.
- Exercise negative peer cases in the qualification harness: absent
  credentials and wrong UID must close/reject without audit mutation.

AUTHORIZED ACTION — FUTURE ONLY

- A bounded owner-scoped reachability read may be issued after the host
  boundary is separately approved. No recipe or task may be submitted.

EXPECTED STATE

- Correct peer is accepted; missing/wrong peers are rejected; status is
  bounded and owner-safe; no task, session, or artifact mutation occurs.

FAIL CONDITION

- Payload-supplied owner identity affects trust, a non-owner peer is accepted,
  a missing helper weakens the boundary, or a reachability read mutates state.

ROLLBACK CONDITION

- Disable the qualification attempt and preserve socket/service/audit evidence;
  do not continue to delegated execution.

### Phase 4 — R5A/R5B network isolation qualification

PRECONDITION

- Phase 3 PASS; Linux kernel/user-namespace and systemd authorization is
  explicit; no provider endpoint or external network destination is required.

READ-ONLY CHECKS

- Verify the configured unshare path is an absolute regular non-symlink file.
- Verify the selected provider is none only when the qualification flag is
  true, and verify RestrictNamespaces is exactly user net.
- Verify RestrictAddressFamilies is AF_UNIX, ProtectHome/System/ControlGroups
  and other checked-in hardening are active, and no ordinary-spawn fallback is
  configured.
- Inspect namespace-scoped /proc/net/dev from the probe child. The expected
  interface set is only lo. Do not use /sys/class/net as namespace evidence.

AUTHORIZED ACTION — FUTURE ONLY

- Run the existing bounded boot-time active probe through the provider's own
  prepared spawn path. The probe is the existing no-op isolation check, not a
  user recipe and not a network canary.

EXPECTED STATE

- The probe succeeds under the actual service context and provider status is
  operational. Any unavailable, failed, or ambiguous probe leaves the broker
  fail-closed.

FAIL CONDITION

- User namespaces are forbidden/unknown at the final probe, unshare is
  missing/symlinked, the child sees a host interface, a provider reports
  operational without a successful probe, or any ordinary spawn is possible
  without prepared isolation.

ROLLBACK CONDITION

- Keep network provider unavailable and delegated execution disabled. Preserve
  probe output and service metadata without attempting a fallback.

### Phase 5 — Trust, policy, recipe, and workspace qualification

PRECONDITION

- Phase 4 PASS and a fresh signed policy selected for this exact source and
  host.

READ-ONLY CHECKS

- Verify public-key fingerprints and key IDs; verify owner signature and policy
  canonical hash; verify issue/expiry window, signer allowlist, role,
  capability, recipe, path, limit, persistence, and network constraints.
- Verify the active broker policy identity/hash matches the operator-side
  verified artifact.
- Verify the exact deployed manifest, support state, absolute executable
  mapping, cwd policy, environment allowlist, and disposable workspace roots.
- Verify workspace staging preserves required package-manager symlinks and does
  not resolve back into the live checkout.

AUTHORIZED ACTION — FUTURE ONLY

- None beyond verification. Do not promote the currently unsupported
  verify:agent-tsc entry or write a new recipe as part of this packet.

EXPECTED STATE

- The selected canary is explicitly supported by the exact manifest and policy,
  or the phase stops with no execution.

FAIL CONDITION

- Stale/near-expiry policy, signature/hash mismatch, unsupported recipe,
  unmapped/symlink executable, root overlap, workspace escape, or any
  unexpected environment/argv authority.

ROLLBACK CONDITION

- Return to disabled/unavailable state; preserve the rejected metadata and
  audit result without copying or deleting key material.

### Phase 6 — Single bounded delegated canary

PRECONDITION

- Phases 0–5 PASS; nonce durability and truthful readiness blockers are closed
  or an explicit human decision rejects activation; the exact canary is
  supported; owner approval is bound to the exact session/policy/recipe.

READ-ONLY CHECKS

- Confirm the agent and broker flags, socket path, policy identity, network
  status, session limits, and capability window immediately before the run.
- Confirm no active session or prior canary is being reused.

AUTHORIZED ACTION — FUTURE ONLY

- Enable the already reviewed flags only for this qualification window.
- Run exactly one existing one-shot delegated driver invocation for the
  selected fixed recipe, with one sandbox_operator_light session, one
  capability, one tool execution, temporary persistence, no external side
  effects, networkMode none, and the recipe's signed bounds.
- Do not run a model autonomy loop, patch, source mutation, live checkout
  write, network destination, Discord action, or second retry.

EXPECTED STATE

- The broker performs the full chain: policy verification, delegated signer
  validation, session create, activate, capability issue, envelope sign,
  broker-final authorization, prepared isolated execution, receipt, and
  terminal transition.
- A success or failure receipt is produced; either outcome is evidence, not
  permission for another run.

FAIL CONDITION

- Any stage refusal, unexpected second attempt, no receipt, non-enforced
  isolation, raw output/secret leakage, wrong policy/session/capability
  binding, or execution outside the fixed recipe.

ROLLBACK CONDITION

- Immediately hold further runs and return the flags to disabled after the
  separately authorized window. Do not auto-retry, refund, or erase the
  receipt/audit/session evidence.

### Phase 7 — Evidence, recovery, and negative qualification

PRECONDITION

- Phase 6 completed with a terminal broker state.

READ-ONLY CHECKS

- Verify receipt and audit fields: terminal outcome, stage, recipe identity,
  session, capability use, policy identity, limits, output hashes/bytes,
  truncation, wall time, network isolation, and receipt hash.
- Confirm no raw output, environment value, key, passphrase, or secret-shaped
  content is present.
- Confirm durable broker state, session terminality, consumed budget, nonce
  behavior, and no auto-resume/retry/refund.
- Run the listed negative checks against a disposable qualification state;
  every rejection must occur at the expected stage and must not spawn.

AUTHORIZED ACTION — FUTURE ONLY

- A separately authorized restart/recovery observation may be performed only
  after the first receipt is durably retained. It must not be used to create a
  second execution.

EXPECTED STATE

- Evidence is complete, bounded, scrubbed, and reconstructable from durable
  metadata. Failure remains terminal and explainable.

FAIL CONDITION

- Missing or mutable evidence, duplicate use, post-terminal execution,
  recovery auto-resume, raw secret exposure, or any unexplained state.

ROLLBACK CONDITION

- Hold release; preserve broker.db, receipts, audit rows, and scrubbed host
  evidence. Do not delete state to make the report appear clean.

### Phase 8 — Ashley self-knowledge and human decision

PRECONDITION

- Phases 0–7 PASS or have explicit documented exceptions accepted by Doc.

READ-ONLY CHECKS

- Confirm Ashley reports the actual state as disabled, configured, qualified,
  unreachable, or live delegated only when the corresponding evidence exists.
- Confirm qualified means reachability plus configured keys, not a blanket task
  license; each task remains separately authorized.
- Confirm no normal conversation, model output, or Expression path claims
  successful host execution without a broker receipt.

AUTHORIZED ACTION — FUTURE ONLY

- Doc chooses HOLD, DISABLE, or a separately documented Release_qualified
  decision. This packet does not make that decision.

EXPECTED STATE

- If any blocker or unknown remains, Ashley stays disabled/unqualified and
  says so truthfully.

FAIL CONDITION

- Ashley claims live delegated access from source presence, configured flags,
  stale readiness, or an unverified receipt.

ROLLBACK CONDITION

- Select DISABLE or HOLD, retain evidence, and keep the host in the last
  known safe disabled state.

## Canary recipe

The planned actual execution canary is the existing one-shot
scripts/mint/verify-agent-tsc.mjs flow, not a new script or recipe. It is
intended to execute exactly one bounded verify:agent-tsc fixed recipe:

- role: sandbox_operator_light
- session lifetime: 300 seconds
- one allowed capability
- one tool execution
- capability lifetime: 120 seconds
- envelope lifetime: 30 seconds, clamped inside the capability window
- execution wall limit: 120 seconds
- networkMode: none
- persistence: temporary
- external side effects: false
- final state: completed or aborted
- evidence: broker receipt and scrubbed audit metadata only

The current checked-in deployment manifest marks verify:agent-tsc supported
false at deploy/linux-mint/sandbox/recipes.json:19-36. Therefore this canary is
not currently runnable or release-qualified. The future phase must first
establish an explicitly authorized, freshly reviewed manifest and toolchain;
this packet does not promote the entry, provision the toolchain, or alter the
manifest.

The existing scripts/mint/broker-smoke.mjs surface may be used earlier only as
an owner-scoped reachability read. It is not task authorization and is not a
substitute for the one bounded isolated execution.

## Negative checks

Each case must fail closed. The expected result is refusal, an audit record
without secrets, and no process spawn unless the case is explicitly a
post-execution terminal-state observation.

- Missing SO_PEERCRED or wrong peer UID.
- Payload owner ID differs from the trusted broker owner.
- Unknown, revoked, wrong-class, malformed, or bad-signature key.
- Canonical payload tampering after signing.
- Expired or not-yet-valid policy, envelope, capability, or session.
- Policy ID, version, hash, signer, role, capability, recipe, rule, risk,
  persistence, or network-mode mismatch.
- Reused delegated nonce, including after a broker restart.
- Reused capability-use ID or use after a terminal session.
- Path traversal, noncanonical path, symlink escape, root overlap, special
  file, setuid/setgid target, live-checkout write, or write outside the
  disposable workspace.
- Unregistered, unsupported, planning-only, or policy-disallowed recipe.
- Unmapped, relative, symlinked, or writable-root executable.
- Shell metacharacters, arbitrary interpreter, inherited environment,
  credential-shaped environment, interactive Git behavior, or non-synthetic
  HOME.
- Missing network provider, failed active probe, unavailable user namespace,
  non-Linux host, wrong namespace flags, or ordinary-spawn fallback.
- Wall deadline, output budget, process/task budget, workspace quota, or
  concurrency limit.
- Malformed/oversized frame, mismatched request ID, transport timeout,
  malformed response, or ambiguous mutating transport outcome.
- Broker persistence failure, closed database, restart during a reservation,
  auto-resume, budget refund, or receipt loss.
- Receipt or audit containing raw stdout/stderr, environment values, private
  keys, passphrases, or unredacted secret-shaped content.
- Readiness reporting active/ready while isolation is unavailable.

## Rollback packet

Rollback is a human-controlled evidence-preserving decision, not an automatic
cleanup routine.

Trigger rollback or HOLD on any release blocker, failed negative check,
unexpected process/network behavior, policy/key mismatch, receipt gap, secret
exposure, source drift, or self-knowledge mismatch.

Future-only rollback sequence:

1. Stop the qualification window and prevent any second delegated run.
2. Return agent and delegated opt-in to the known disabled state through a
   separately authorized configuration action.
3. Keep the broker fail-closed or disabled; do not substitute an ordinary
   process runner or a different network provider.
4. Preserve broker.db, receipts, audit rows, session transitions, policy
   fingerprints, source hashes, and scrubbed host evidence.
5. Record the exact failure and human owner decision.
6. Re-qualify from the first failed phase after the underlying issue is
   separately fixed and reviewed.

Rollback must not delete audit evidence, broker state, receipts, policy
history, or session recovery records. The existing removal design preserves
state by default, but destructive data removal is outside this packet and
requires a separate explicit human decision.

## Ashley self-knowledge states

| State | Truthful meaning | Permitted claim |
|---|---|---|
| disabled | Broker IPC or lifecycle is off by default. | Ashley has no active sandbox access. |
| socket_missing | Opt-in was requested but the broker socket is absent. | Sandbox is unavailable. |
| keys_missing | Required owner/continuity signing metadata is incomplete. | Sandbox is unavailable and cannot authorize work. |
| configured | Socket and signing metadata are present, but reachability has not been verified this session. | Sandbox is configured, not qualified, and not a task license. |
| unreachable | Socket is present but the broker did not answer. | Sandbox is unavailable; no stale session is trusted. |
| qualified | This session reached the broker and the required signing metadata was present. | A separately authorized task may still require an owner-signed approval; qualified does not mean active execution. |
| live delegated access | A future canary passed on the exact source/host with current policy, operational isolation, receipt, and human decision. | Only then may Ashley report bounded live delegated access, with exact scope and evidence. |

Current truthful summary: implemented machinery, not release-qualified, no live
delegated access, and no normal autonomy path.

## Things explicitly not authorized

- No production activation or release qualification.
- No Mint access, SSH, sudo, remote command, or host inspection in this pass.
- No user/group creation, socket creation, systemd install, enable, restart,
  stop, reload, or service mutation.
- No key generation, key reading, private-key copying, passphrase reading, or
  secret inspection.
- No policy generation, promotion, rotation, or live policy installation.
- No delegated broker launch, session creation, recipe execution, provider
  call, network canary, namespace canary, or one-shot driver execution.
- No Recall changes, production database access, capability promotion,
  production agent opt-in, Discord gateway, or external destination.
- SBX-REL-01 grants no source, test, dependency, schema, config, or environment
  changes; the separately authorized AUTONOMY-PLUMBING-01 local changes do not
  activate or qualify the sandbox.
- No sandbox activation, new sandbox design, new recipe, new driver, or
  replacement execution substrate.
- No commit, push, deploy, branch change, or deletion.

## Unknowns requiring live Mint inspection

The following remain unknown because no live host was contacted:

- Current Mint checkout SHA, remote state, package-lock state, and deployed
  dist/source hashes.
- OS, kernel, Node, util-linux, systemd, user-namespace sysctls, and actual
  /usr/bin/unshare identity.
- Installed users, groups, UID/GID values, membership, socket ownership,
  socket mode, runtime directory, and peer-helper deployment.
- Active systemd directives, service state, restart history, journal behavior,
  ProtectHome/System/Proc/ControlGroups, RestrictNamespaces, AF_UNIX, and
  service resource limits.
- Actual broker.env and agent environment flag values, without exposing any
  secret values.
- Existence/permissions/fingerprints of public trust anchors and encrypted
  broker key material; delegated keypair and capability key match.
- Current policy ID/version/hash/signer/expiry, signature validity, and
  whether the active broker policy matches the agent-side artifact.
- Actual recipe manifest, supported flags, executable mappings, toolchain
  paths, workspace copy, symlink behavior, and live-checkout separation.
- Broker.db schema/version, persistence health, audit/receipt state, active
  sessions, interrupted uses, nonce ledger behavior, and restart recovery.
- R5B active-probe result and namespace-scoped /proc/net/dev evidence.
- Production agent adapter/runtime wiring, if a future scope expects more than
  the standalone one-shot qualification driver.
- The human-recorded natural Recall canary result and final Doc release
  decision.

## Human release decision

Current decision: HOLD.

Preparation is PASS. Production release is BLOCKED.

Doc must explicitly choose one of:

- HOLD — retain disabled state and gather the missing evidence.
- DISABLE — reject this release attempt and preserve the evidence packet.
- RELEASE_QUALIFIED — only after Recall, all required Mint phases, negative
  checks, receipt/recovery evidence, source identity, and blocker closure pass.

No choice above is made by this packet. The human next gate is:

WAIT FOR RECALL CANARY PASS. STOP.
