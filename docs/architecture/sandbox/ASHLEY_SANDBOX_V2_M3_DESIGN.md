# Sandbox V2 M3 — Private Writable Candidate Workspace

**Status:** CURRENT V2 M3 MILESTONE CONTRACT. Implemented in current source.
This document does not prove physical qualification or production acceptance
for the current exact SHA.

**Scope:** M3 only — private writable candidate workspace. Does not cover M4
(build/test/lint), M5 (change-set authoring), M6 (bounded operation), or M7
(controlled engineering effects).

**Umbrella authority:** Read
[`ASHLEY_SANDBOX_V2_ROADMAP.md`](ASHLEY_SANDBOX_V2_ROADMAP.md) first. It owns
cross-cutting M-series order, V1 supersession, state and authority matrices,
future milestone boundaries, and acceptance semantics. This file owns M3
detail only. In the umbrella roadmap, M7 is refined and renamed to
**PROMOTE — CONTROLLED ENGINEERING EFFECTS**.

---

## 1. Purpose

Give Ashley a **private writable workbench** for candidate project files:

```
operator-approved project
        ↓
sanitized source projection (reuse M2 machinery)
        ↓
durable candidate workspace (private, survives bwrap process)
        ↓
direct Bubblewrap (writable /workspace mount)
        ↓
typed file operations (create/replace/edit/delete/list/search/read)
        ↓
verified workspace postcondition
        ↓
WorkspaceExperimentObservation
        ↓
OperationalClaimLicense (issued only after verification)
        ↓
Thought continuation → Expression
```

**Central invariant:** CANDIDATE WORKSPACE MUTATION != LIVE REPOSITORY MUTATION. A successful M3 operation never means "the repository changed."

---

## 2. Authority Model

Reuses existing control-plane classification (`classifyProjectRootAccess(..., "workspace", ...)`):

```
projectId
  → operator registry (sandbox-policy ProjectRootEntry)
    → candidateWorkspaceAllowed === true (opt-in, currently false in production)
      → sanitized source projection (M2 machinery)
        → candidate workspace
```

**Key fields in `ProjectRootEntry` (already present, M3 uses them):**
- `candidateWorkspaceAllowed: boolean` — workspace creation authority (opt-in)
- `engineeringAllowed: boolean` — existing source field; M3 does not use it.
  It MUST NOT be interpreted as blanket M4-M7 authority. Future verification,
  authoring, bounded-operation, network, credential, live-repository, Git, and
  promotion authority follows the narrow V2 authority matrix in
  [`ASHLEY_SANDBOX_V2_ROADMAP.md`](ASHLEY_SANDBOX_V2_ROADMAP.md).

**M3 does NOT:**
- Modify production registry (operator action only)
- Require `engineeringAllowed`
- Accept arbitrary host paths from the model
- Inherit host secrets, env, or Git credentials

---

## 3. Candidate Workspace Ontology

### Workspace Identity
- `workspaceId`: opaque, generated (16 random bytes, base64url, 1-64 chars) — matches V1 `createDisposableWorkspaceId`
- `projectId`: owning project (from registry)
- `sourceSnapshotId`: manifest identity / fingerprint of the sanitized source projection
- `createdAt`, `lastUsedAt`: timestamps
- `state`: `active` | `corrupt` | `archived`
- `schemaVersion`: integer

### Persistence Layout
```
<managed-workspace-root>/
  <workspaceId>/
    manifest.json        ← CONTROL_PLANE metadata, NOT mounted writable
    tree/                ← mounted as /workspace (writable)
```

**Invariant:** CONTROL METADATA != MODEL-WRITABLE WORKSPACE CONTENT. Manifest lives outside the bwrap writable mount.

### Source Lineage
- Workspace derives from the **same sanitized projection machinery as M2** (`buildSanitizedProjectView`, `V2_VIEW_COPY_LIMITS`, `copySanitizedTree`, exclusions from `@composer-assistant/sandbox-tree`)
- Provenance recorded in manifest: `sourceSnapshotId` (aggregate digest if available, or path-based identity), `sourceManifestIdentity` (M2 view identity)
- **No silent refresh/merge** on source drift. Workspace remains valid against its recorded snapshot. Rebase belongs to M5+.

### Durability
- Workspace survives bwrap process exit (tree/ is not tmpfs)
- Not cognitive state (not Identity, Mind State, Memory, Thought)
- Classified as **CONTROL_PLANE / DURABLE WORK STATE** in state inventory
- No silent GC in M3. Cleanup is explicit, bounded, auditable.

---

## 4. Typed Operation Surface

**Family:** `project_experimentation` (`readOnly: false`, `requiresProject: true`)

Operations (version 2 envelope):

| Operation | Purpose | Preconditions |
|-----------|---------|---------------|
| `workspace.read_file` | Read file from candidate workspace | path exists, is file, within bounds |
| `workspace.list_directory` | List directory in candidate workspace | path exists, is directory |
| `workspace.search_text` | Search text in candidate workspace | pattern provided, within bounds |
| `workspace.write_file` | Create new file (mustNotExist) | parent dir exists, path free, size ≤ limit |
| `workspace.replace_file` | Replace entire file (expectedSha256) | file exists, hash matches |
| `workspace.edit_text` | Exact-text replacement (oldText→newText, expectedSha256) | single exact match, hash matches |
| `workspace.delete_file` | Delete regular file (expectedSha256 optional) | file exists, is regular file |
| `workspace.create_directory` | Create directory (parents ok) | path free or existing directory |

**Boundaries (M3 does NOT support):**
- chmod/chown, device/FIFO/socket, arbitrary symlinks/hardlinks, mounts, shell, process spawn, package managers, Git, network

**Path Safety (fail-closed):**
- Absolute paths rejected
- `..` traversal rejected (canonicalizeWithinRoot)
- Mixed slash/backslash, NUL, empty path rejected
- Symlink escape rejected (resolved target must be within workspace tree)
- Wrong file type (dir vs file) rejected

**Write Integrity (postcondition verification):**
- Create/replace: atomic temp+rename where practical → re-read → size/hash verify
- Delete: verify absence
- Directory create: verify exists as directory
- **ATTEMPTED WRITE != VERIFIED WRITE**

**Resource Bounds (reuse V2 limits where applicable, extend):**
- `REQUEST_MAX_BYTES: 16 KiB`
- `STDOUT_MAX_BYTES: 256 KiB`, `STDERR_MAX_BYTES: 64 KiB`
- `TIMEOUT_MS: 60_000`
- `READ_MAX_BYTES: 64 KiB` (read), `WRITE_MAX_BYTES: 25 MiB` (single file), `WORKSPACE_MAX_BYTES: 100 MiB` (total)
- `PATH_MAX: 1024`, `DEPTH_MAX: 32`, `MAX_FILES: 10_000`
- Truncated output carried explicitly in typed result

---

## 5. Bubblewrap Topology

Direct Bubblewrap, **no broker, no root service, no privileged IPC**.

Mounts:
```
/workspace  →  <managed-root>/<workspaceId>/tree  (writable, --bind)
/usr, /lib*, /bin*, /sbin*  (--ro-bind / --symlink)
/dev, /proc, /tmp (--tmpfs)
```

**NOT mounted writable:**
- Live canonical root (`/project` is read-only in M2, NOT mounted in M3)
- `.git`, host secrets, home dir, arbitrary host FS

**Isolation flags (same as M2):**
```
--unshare-user --unshare-pid --unshare-net --unshare-ipc --unshare-uts
--clearenv --setenv PATH /usr/bin --setenv HOME /tmp --die-with-parent --new-session
```

Environment: clean, fixed PATH, no model-requested env vars. Host sentinel secret (`ASHLEY_SANDBOX_V2_SECRET_SENTINEL`) injected.

---

## 6. Runner Protocol

Fixed CJS inline runner (like `SANDBOX_V2_INSPECTION_RUNNER_SOURCE`).

**Input (stdin):** single JSON `{ version: 2, operation, ...op fields, probePort, sentinelPath, fdSentinelCanonical }`

**Output (stdout):** single JSON evidence document:
```
{ version: 2, operation, ok: true, result: <WorkspaceExperimentResult>, checks: <WorkspaceRunnerChecks> }
```
or error: `{ version: 2, operation, ok: false, code: <errorCode> }`

**Checks (positive control + isolation):**
- `envClean` (only PATH, HOME, PWD, secret)
- `homeAbsent`, `runAbsent`, `hostSentinelAbsent`
- `fdClean`
- `workspaceWritable` (probe write to `/workspace/.v3-write-probe` succeeds)
- `loopbackIsolated` (same as M2)
- `externalIsolated` (same as M2)

---

## 7. Operational Truth Semantics

Preserves M2 precedence:

```
verified current-turn effect
  > current OperationalClaimLicense
  > general capability self-model
  > Expression / model inference
```

**For M3:**
- `CapabilityAuthorization` = may Ashley attempt candidate workspace mutation? (release gate + registry)
- `WorkspaceExperimentObservation` = what actually happened inside private workspace
- `OperationalClaimLicense` = what may Expression truthfully claim (issued **only after** verified execution)

**Failure model:** Typed failure codes (not generic "cannot use sandbox"):
- `release_gate_denied`, `project_not_registered`, `project_disabled`, `read_not_allowed`, `workspace_not_allowed`
- `workspace_not_found`, `workspace_corrupt`, `workspace_lineage_mismatch`
- `invalid_path`, `path_escapes_workspace`, `symlink_unsafe`, `file_missing`, `file_exists`
- `hash_mismatch`, `ambiguous_text_replacement`, `size_limit_exceeded`, `quota_exceeded`
- `runner_malformed`, `bwrap_unavailable`, `bwrap_timeout`, `bwrap_nonzero_exit`, `postcondition_failed`
- `operation_aborted`

**Verified but not interpreted:** If execution succeeds but Thought continuation fails/times out:
- `executionStatus = verified_success`
- `interpretationStatus = not_interpreted`
- Expression must not invent semantic details

---

## 8. Cognition Flow (M2 pattern preserved)

```
FIRST PASS
  → Thought
  → optional M3 request (evidenceDisposition: "acquire_candidate_workspace")

EXECUTION
  → runtime authority admission (capability gate + registry + lifecycle + substrate)
  → workspace acquisition/revalidation (create or resume)
  → Bubblewrap dispatch
  → WorkspaceExperimentObservation (verified / typed failure)

SECOND PASS
  → Thought continuation (inspectionCognitiveResult for workspace)
  → final Decision

EXPRESSION
  → final Thought
  → structured Operational Truth (workspace evidence block)
  → natural response
```

**Arbitration (one sandbox action per turn):**
- If M3 request exists: execute M3, M2 count = 0, M1 count = 0
- Else if M2 request exists: execute M2, M3 count = 0, M1 count = 0
- Else: M1 reactive eligibility as currently designed
- Mutually exclusive requests in same proposal → FAIL CLOSED

**Easy-turn reachability:** If M3 capability is available, Thought must be able to select it on easy turns (same M2 fix).

**Reactive only:** M3 is not M6. No proactive autonomous engineering. Only direct user conversation and explicitly grounded tasks.

---

## 9. Capability Gate

New capability: `project_experimentation` (dependencies: `["thought"]`)

Gates for offering to Thought:
1. `project_experimentation` release state = `active` (under master `apply`)
2. `sandboxEngineeringLifecycleEnabled` = true
3. `isSandboxV2Available()` = true (Linux + bwrap)
4. Project registry has ≥1 entry with `enabled && readAllowed && candidateWorkspaceAllowed`

**Self-model:** "Private candidate workspaces: available for project-ashley" / "not currently available" — orthogonal to current-turn execution status.

---

## 10. Audit

Profile: `project_experimentation`

Record emitted at Expression/honesty boundary (like M2). Safe metadata only:
- `discriminator: "ASHLEY_SANDBOX_V2_LICENSE"`
- `state`, `taskId`, `profile`, `verified`, `error`, `refusalReason`
- `effect` (for writes: `bytesWritten`, `contentHash`, `readMatches`, `deleted`, `verifiedAbsent`)
- `inspection` (for reads: `operation`, `projectId`, `workspaceId`, `targetPath`, `targetPattern`, `truncated`, `bytes`, `filesScanned`, `matchCount`, `entryCount`)
- **NO raw file contents, secrets, host paths, env snapshots**

---

## 11. Database Schema (Migration 28)

Table: `candidate_workspaces` (CONTROL_PLANE)

```sql
CREATE TABLE IF NOT EXISTS candidate_workspaces (
  workspace_id      TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,   -- manifest identity / aggregate digest
  source_manifest_identity TEXT,      -- M2 view identity
  tree_root         TEXT NOT NULL,    -- absolute path to <managed-root>/<id>/tree
  manifest_path     TEXT NOT NULL,    -- absolute path to <managed-root>/<id>/manifest.json
  owner_id          TEXT NOT NULL,
  state             TEXT NOT NULL CHECK (state IN ('active','corrupt','archived')),
  schema_version    INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  last_used_at      TEXT NOT NULL,
  UNIQUE(project_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_candidate_workspaces_owner_state ON candidate_workspaces (owner_id, state, last_used_at);
```

**State inventory classification:** `CONTROL_PLANE` — "candidate workspace lifecycle metadata; durable work state, not live behavioral state"

---

## 12. Non-Goals (Hard Scope Boundary)

M3 does NOT implement:
- Arbitrary shell / command execution / npm test / build / lint / compiler
- Git init / diff / commit / branch / patch promotion / live repo writes
- Dependency installation / network requests / browser actions
- External accounts / credentials / sudo / root service / V1 broker
- Self-modification / weekly patches / proactive autonomous engineering
- Worker orchestration / autonomous retry loops / multi-step engineering loops
- M4 verification / M5 authoring / M6 bounded operation / M7 controlled engineering effects

---

## 13. Local Qualification (This Task)

- Unit tests: workspace creation, manifest, paths, file ops, bounds, special files
- Dispatch tests: bwrap argv, mounts, isolation, deadline, bounds, runner protocol
- Authority tests: release gate, registry flags, project unknown/disabled/denied
- Cognition tests: M2 witness regression, M1 regression, M3 pass-1→exec→pass-2, arbitration, truth semantics
- Build + full test suite pass
- **No physical Bubblewrap qualification** (Windows — Mint gate later)
- **No production deployment / registry mutation / commit / push**

---

## 14. Embedded Physical Qualification Procedure (Historical Milestone Design)

This section preserves the M3 milestone-design procedure. It is subordinate to
the current exact-candidate qualification packet and executor prompt selected
for an authorized run. It is not a current exact-candidate qualification
packet. It grants no independent authority to access Mint, restart a service,
deploy, activate M3, change a registry, or repeat a qualification attempt.

**Gate 1 — Creation Witness:**
```
/new
Create a file named m3-witness.txt in a private candidate workspace for Project Ashley containing exactly: m3-witness-ok
Do not modify the live repository. Tell me what happened.
```
- Before: `git status --short` on `/home/xarvak/project-ashley` (no m3-witness.txt)
- After: LIVE repo unchanged; candidate workspace has m3-witness.txt with exact content; postcondition hash matches; workspace survives bwrap exit
- Trace: thought_source=model, M3 executions=1, M2=0, M1=0, real bwrap=yes, audit verified=true, operationalClaimLicense post-execution, Expression grounded

**Gate 2 — Persistence Witness:**
1. Create m3-witness.txt via Gate 1
2. Under a separately authorized exact-candidate qualification packet, restart
   `ashley-agent.service` as specified by that packet
3. Ask Ashley to inspect/read the SAME candidate workspace
4. Verify workspaceId resolves, file still contains m3-witness-ok
- Proves: workspace process lifetime != workspace state lifetime

**Negative assertions:** candidate root != canonicalRoot; canonicalRoot never writable-mounted; secrets excluded; no network/Git/package install/root/V1 broker.

---

## 15. Acceptance Ladder

Do not collapse states:
```
DESIGN_ACCEPTED ≠ IMPLEMENTED ≠ LOCALLY_TESTED ≠ PHYSICALLY_QUALIFIED
≠ RELEASE_QUALIFIED ≠ DEPLOYED ≠ CAPABILITY_PROMOTED ≠ PRODUCTION_WITNESSED
≠ PRODUCTION_ACCEPTED
```

At end of local task: **M3 IMPLEMENTED + LOCALLY VERIFIED** (if all tests pass).

**Never claim M3 PRODUCTION ACCEPTED in this task.**
