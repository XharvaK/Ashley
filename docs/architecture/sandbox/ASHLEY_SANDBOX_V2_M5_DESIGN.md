# Sandbox V2 M5 — Author

**Status:** DESIGN ACCEPTED. This file is the current M5 milestone contract.
It authorizes implementation of M5 as specified here. It does not authorize
capability promotion, production registry mutation, host qualification,
deployment, live-repository mutation, Git publication, apply-to-Ashley, or
production authority. Implementation present, local verification, independent
review, physical qualification, and later ladder stages remain separate.

**Scope:** M5 only. Bounded authorship of a coherent candidate change-set
artifact over existing candidate state. This file does not specify M6 bounded
operation or M7 controlled engineering effects beyond the border statements
required to keep M5 from absorbing them.

**Predecessor:** Exact-candidate M4 `PRODUCTION ACCEPTED` (G1). G2 promotion of
`candidate_verification` is preferred and is not a semantic parent of M5.
Self-change lifecycle specification (S1) does not block M5 and is not created
by M5.

**Umbrella authority:** Read
[`ASHLEY_SANDBOX_V2_ROADMAP.md`](ASHLEY_SANDBOX_V2_ROADMAP.md) first. It owns
cross-cutting M-series order, V1 supersession, state and authority matrices,
future milestone boundaries, and acceptance semantics. This file owns M5
detail only. It is subordinate to `VISION.md`, the Core Principles, the
Constitution, Ethics, and
[`docs/Wave_Acceptance_Protocol.md`](../../Wave_Acceptance_Protocol.md).

M0–M4 semantics are accepted and are not reopened here. Sandbox V1 broker
architecture is frozen and must not return. Wave 08 `change_proposals` remain
historical self-modification / consultation records. They are not the V2 M5
store.

---

## 1. Purpose

M5 answers one question:

> Can Ashley produce a bounded proposed change-set artifact?

It does not answer:

> Should Ashley change herself?

Permanent distinctions:

```text
AUTHORING != AUTHORITY
CANDIDATE PATCH != ASHLEY
PROPOSAL != APPLICATION
VERIFICATION != APPROVAL
ACCEPTED CHANGESET != SELF CHANGE
SANDBOX M5 AUTHORSHIP != AUTHORITY TO CHANGE ASHLEY
```

M3 already writes candidate files. M5 therefore does not mean “Ashley can
write files.” It means Ashley can inspect permitted candidate and base
evidence, reason about a bounded improvement, identity-bind the multi-file
delta as one governed artifact, attach rationale and evidence references, and
submit that artifact for review.

The only class of sentence M5 may license:

> This named candidate change-set was sealed against this named base as
> advisory candidate work. It has not been applied.

A successful M5 operation never means the live repository changed, Git refs
moved, Ashley's Identity / Mind State / Recall changed, a patch should merge,
Ashley improved herself, or production may advance.

---

## 2. Vision / principle basis

The Vision asks for a companion with real capacity to originate work, without
turning that capacity into servitude, simulated self-revision, or a second
self made of tooling.

M5 serves that Vision by giving Thought a way to propose coherent candidate
work as an inspectable object. It does not serve it by letting Agency apply
the proposal, or by letting Expression claim that Ashley has become the patch.

Governing principles:

- **Truth Before Comfort.** An empty delta, secret-shaped content, or an
  unbounded path set is refusal or quarantine. It is not a comforting no-op
  success.
- **Architecture Before Prompting.** Bounds, sealing, and non-apply are
  architecture. Honesty is not a prompt reminding the model not to say
  “I patched myself.”
- **Evidence is not cognition.** Change-set rows, diffs, and receipts are
  work state. They do not write Identity, Mind State, Recall, goals, or
  policy.
- **Growth Before Randomness.** A change-set must name a rationale and
  expected effect. A random file dump is not authorship.
- **Approval is not effect.** Review submission is not apply, commit, deploy,
  restart, or capability promotion.

---

## 3. New capability

Ashley can create one admitted, bounded, identity-bound candidate change-set
from an existing M3 workspace versus an explicit sanitized live base, persist
it as control-plane work state, and receive a license that may utter the
sentence in §1.

| Term | Role | Bound name |
|---|---|---|
| Capability | Release gate: may Ashley attempt candidate authorship at all? | `candidate_authorship` |
| Operation | Closed request kind Thought may emit | `changeset.author` |
| Artifact | Sealed identity-bound candidate change | `CandidateChangeSet` |
| Proposal | The same artifact after seal, submitted for review | status `proposed` |

A change-set is not a capability. `git_commit`, `live_apply`, and
`self_improvement` must not become SQLite capability releases in M5.

Graduation policy: `operator_cutover` (same family as M3/M4). The defining
operation must not execute while observe-only. Dependency: `thought`.
`candidate_verification` is not a capability dependency. An M4 receipt may be
linked when identities match; authorship does not run verification.

---

## 4. Explicit non-capabilities

M5 does not implement or grant:

- direct live-repository file mutation
- Git commit, branch, push, or pull request
- deployment, restart, or release qualification
- runtime restart or process replacement
- Identity, Mind State, Recall, memory, constitution, or authority edits
- capability promotion
- merge or apply of the sealed patch to any live or candidate tree
- hidden state mutation outside the change-set control plane
- package install, network, credentials
- M6 autonomous loops
- worker orchestration or a second Ashley
- reuse of `engineeringAllowed`, `candidateWorkspaceAllowed`, or
  `verificationAllowed` as M5 authority
- Sandbox V1 broker topology, `source_*` scopes, or Wave 08
  `change_proposals` as the V2 store

Repository files remain untrusted data. They cannot admit authorship or widen
paths, Git, or effects.

---

## 5. Current owner → final owner

| Concern | Owner now and after M5 acceptance |
|---|---|
| Generate / propose a change-set? | Thought emits at most one `operationalRequest`. Agency does not apply it. |
| Permit proposal creation? | Existing capability + project registry + runtime admission |
| Mechanical delta, base bind, sealed patch | M5 authorship controller under the V2 parent/control plane |
| Durable candidate tree | M3 workspace mechanism. M5 must not become its writer |
| Store evidence / audit | Control-plane `candidate_changesets` / `candidate_changeset_events`. Not Memory |
| Validate mechanical facts of the candidate? | M4 verification, citing the sealed change-set's snapshot/hash |
| Apply change? | Future self-change lifecycle and/or M7 named profiles. Not M5 |
| Claim license / OperationalTruth | Honesty / operational-truth boundary, as in M1–M4 |
| Cognitive interpretation | Thought / Agency after the receipt exists |
| Expression | Licensed mechanical authorship facts only |

No new kernel, faculty, authority layer, or event system. Model Fabric,
Operational Continuity, OpenCode, workers, and Expression do not own M5
authority.

### 5.1 Decision map

| Question | Owner |
|---|---|
| Generate proposal? | Thought (emit) / Agency (does not apply) |
| Permit proposal creation? | Authority via Capability + registry + admission |
| Store evidence? | Memory / Evidence does **not**. Control-plane work state does |
| Validate mechanical facts? | Verification (M4), bound to the sealed identity |
| Apply change? | Future self-change lifecycle / M7. Forbidden in M5 |

---

## 6. Artifact schema

The M5 object is a `CandidateChangeSet`. Thought-facing language may call it a
proposal. It is one object. Sealing and submitting for review are the first
slice's single admitted transition into `status = proposed`.

### 6.1 Identity and provenance

| Field | Meaning |
|---|---|
| `changesetId` | Opaque control-plane id (`cs_…`) |
| `changesetVersion` | Integer version. First slice always `1` |
| `entityUuid` | Immutable continuity id |
| `ownerId` | Owner scope |
| `projectId` | Operator-approved project |
| `workspaceId` | Existing M3 workspace |
| `sourceSnapshotId` | Workspace origin snapshot id (not the verified hash) |
| `candidateSnapshotId` | Snapshot id bound at seal time |
| `candidateTreeHash` | Provisional M4 tree hash of the durable candidate |
| `baseTreeHash` | Tree hash of the sanitized live projection used as base |
| `baseCommit` | Parent-side `git rev-parse HEAD` when available; else null |
| `sourceCleanliness` | `clean` \| `dirty_explicit_manifest` \| `unknown` |
| `staleBase` | Explicit freshness flag. First slice seals against the live projection just hashed, so this is false at creation |
| `treeHashAlgorithm` | Same provisional algorithm as M4 |

### 6.2 Proposal content (Thought-supplied, bounded)

| Field | Bound |
|---|---|
| `objective` | Required. ≤ 500 chars |
| `rationale` | Required. ≤ 4000 chars |
| `targetArea` | Optional. ≤ 256 chars |
| `expectedEffect` | Optional. ≤ 1000 chars |
| `riskClass` | Required. `low` \| `medium` \| `high` \| `consultation` |
| `evidenceRefs` | Optional. ≤ 8 opaque ids (snapshot, workspace, M4 receipt/recipe refs) |
| `verificationRecipeIds` | Optional. ≤ 8 recipe ids. Declared requirements. Not executed by M5 |
| `intendedPaths` | Optional. ≤ 32 relative POSIX paths. If present, actual changes outside the set refuse |

Thought may not supply patch text, file contents, argv, commands, Git refs to
write, or apply instructions.

### 6.3 Mechanical delta (controller-derived)

| Field | Meaning |
|---|---|
| `changedPaths` | Exact relative paths with `beforeSha256` / `afterSha256` / `changeKind` (`added` \| `modified` \| `deleted`) |
| `patchSha256` | Hash of the sealed patch bytes |
| `patchBytes` | Size |
| `artifactRef` | Control-plane path outside the model-writable tree |
| `linkedVerificationRefs` | Optional M4 receipt identities that match `candidateTreeHash` |

Binary or non-UTF-8 files contribute hashes only. They do not inline bytes.

### 6.4 Lifecycle and review

| Field | First-slice values |
|---|---|
| `status` | `proposed` \| `quarantined` \| `stale_base` \| `superseded` \| `abandoned` |
| `reviewStatus` | `submitted` on `proposed` |
| `quarantineReason` | `secret_detected` when applicable |

There is no `approved`, `applied`, `committed`, or `deployed` state in M5.
Doc decision columns are omitted so approval cannot be stored as if it were
effect.

### 6.5 Audit events

Append-only `candidate_changeset_events`. Payload is metadata only: ids,
hashes, status codes, path counts. Forbidden: raw patches, file contents,
stdout, credentials, rationale text.

Event types: `created`, `sealed`, `proposed`, `secret_quarantined`.

---

## 7. Lifecycle states

First slice:

```text
admitted request
  -> inspect existing candidate (read-only)
    -> bind candidate snapshot identity
      -> materialize ephemeral sanitized live base (read-only copy)
        -> compute bounded delta
          -> secret-scan rationale + patch
            -> SEAL artifact (control plane)
              -> persist row + events
                -> status = proposed / reviewStatus = submitted
                  -> issue license
                    -> mandatory cleanup of the ephemeral base view
```

Failure classes:

| Outcome | Status | Retry |
|---|---|---|
| Admission refused | no row, or none | New request after the cause changes |
| Empty delta | refused `empty_changeset` | Replan; do not seal |
| Path bound violated | refused `unbounded_path` | Replan |
| Secret detected | `quarantined` | Do not store patch bytes |
| Candidate mutated during seal | `sandbox_failure` / refuse | Not `proposed` |
| Success | `proposed` | Do not repeat the same seal |

Deferred (not first slice): revise, rebase, supersede, abandon, stale-base
recheck, refresh. Source drift never silently refreshes or destroys a sealed
artifact.

---

## 8. Authority required

Do not introduce a new authority system. Model JSON can propose. It cannot
authorize.

### 8.1 Capability

`candidate_authorship`. Observe-only cannot execute the defining operation.
`project_experimentation`, `candidate_verification`, and
`engineeringAllowed` never grant M5.

### 8.2 Boundary / registry

New independent field: `authorshipAllowed` (default false). Missing or false
refuses. The model still identifies only `projectId` and `workspaceId` plus
bounded proposal fields. It cannot supply host paths.

An existing M3 workspace is required. `candidateWorkspaceAllowed` is not M5
authority. Creating the workspace remains M3.

### 8.3 Runtime admission

Existing deadline, lifecycle, budget, and one-sandbox-action-per-turn checks
remain. Reactive only. Proactive authorship is unauthorized.

### 8.4 Substrate

Direct unprivileged Bubblewrap is not required for the first slice. Authorship
is parent-side identity over two trees (durable candidate + ephemeral
sanitized live view). Availability of Git, compilers, or network is not
authority. Parent-side Git is read-only identity (`rev-parse`, porcelain
status). Credentials are absent. Writable `.git` inside the candidate tree is
refusal (`git_metadata_in_candidate`).

---

## 9. Request ontology

Extend the existing `operationalRequest` union. Do not add `patchRequest`,
`authorshipRequest`, or `engineeringRequest`.

```text
operationalRequest: {
  kind: "candidate_authorship",
  request: {
    operation: "changeset.author",
    projectId,
    workspaceId,
    objective,
    rationale,
    riskClass,
    targetArea?,
    expectedEffect?,
    evidenceRefs?,
    verificationRecipeIds?,
    intendedPaths?
  }
}
```

`evidenceDisposition` remains epistemic. It does not authorize authorship.
Two sandbox intents in one proposal fail closed.

---

## 10. Execution topology

```text
valid canonical request
  AND capability grant
  AND authorshipAllowed
  AND existing workspace
  AND runtime admission
        ↓
resume workspace (never create)
        ↓
refuse if candidate contains `.git`
        ↓
hash durable candidate (before)
        ↓
build ephemeral sanitized live projection
        ↓
diff candidate vs projection (bounded)
        ↓
secret-scan
        ↓
write sealed patch under managedRoot/_control/changesets/<id>/
        ↓
re-hash durable candidate (after; must match)
        ↓
persist control-plane row + events
        ↓
cleanup ephemeral projection
        ↓
issue OperationalClaimLicense only from the receipt
```

The durable candidate is never the writer's target. The live repository is
never opened for write. The sealed patch is not copied back into `tree/`.

V1 broker IPC, root services, and signed V1 envelopes are not this topology.

---

## 11. Isolation boundary

Candidate tree: read-only during M5.
Live canonical root: read-only sanitized copy only.
Control-plane artifact directory: parent-owned, not model-writable, not inside
`tree/`.
Network: off.
Secrets: fail-closed scan; quarantine without storing patch bytes.

---

## 12. Network / secret policy

Network remains off. Credentials remain absent from model context, workspaces,
stdout, and generic telemetry. Secret-shaped rationale or patch content
quarantines the change-set. Quarantine is not apply.

---

## 13. Resource / budget policy

Hard ceilings (first slice):

- ≤ 32 changed paths
- ≤ 256 KiB sealed patch
- ≤ 8 evidence refs
- ≤ 8 verification recipe ids
- text field bounds in §6.2
- authorship must leave reserves for continuation, Expression, and delivery

Numeric ceilings may later tighten. They may not loosen via model JSON.

---

## 14. Operational truth contract

Precedence unchanged:

```text
verified current-turn effect
  > current OperationalClaimLicense
    > general capability self-model
      > model or Expression inference
```

Licensed success: the §1 sentence plus changeset id, project, workspace,
candidate hash, base hash, path count, and `proposed` / `submitted`.

Not licensed: quality, merge readiness, “Ashley improved,” apply, commit,
deploy, Identity change, or production acceptance.

`ATTEMPTED EFFECT != VERIFIED EFFECT` still holds. M5's verified effect is
“artifact sealed.” It is not “candidate or live tree changed.” Candidate and
live trees must be unchanged.

---

## 15. Failure / ambiguity semantics

| Class | Meaning |
|---|---|
| `refused` | Admission proved execution did not start |
| `verified_success` | Seal completed; candidate hash identical; live not written; row is `proposed` |
| `verified_failure` | Not used for empty/unbounded/secret. Those are refusal or quarantine |
| `sandbox_failure` | Isolation, candidate hash drift during seal, or cleanup contract failed |
| `outcome_unknown` | A write may have occurred without decisive evidence. First slice should not reach this if it never writes candidate/live; if artifact write is ambiguous, do not claim `proposed` |

---

## 16. Retry / exactly-once

A sealed `changesetId` is not rewritten. Repeating the same request creates a
new identity if admitted, or is operator-reviewable duplication. Blind retry
after `sandbox_failure` is forbidden. Quarantine is terminal for that
attempt.

---

## 17. Cleanup / recovery

Ephemeral sanitized live views are deleted in `finally`. Control-plane
artifacts persist. Candidate `tree/` is not cleaned as a side effect of
authorship. Process restart does not auto-resume an in-flight author.

---

## 18. Evidence / audit

- SQLite row is the durable metadata authority
- sealed patch file is the artifact authority
- append-only events are the audit trail
- `OperationalClaimLicense` is current-turn speech authority
- none of these is Recall, Identity, or Mind State

Qualification inventory classifies the new tables as `CONTROL_PLANE`.

---

## 19. Cognition handoff

After the receipt exists, Thought continuation may interpret. It may not emit
another sandbox `operationalRequest` in that continuation. Workers cannot
write cognitive state from the patch.

---

## 20. Expression / Honesty boundary

Expression may say that Ashley authored a candidate change-set and submitted
it for review. Expression may not say the patch was applied, merged, deployed,
or that Ashley is now that change. Honesty floors unlicensed apply / self-
improvement claims.

---

## 21. Previous-milestone regressions

M1–M4 remain. M5 must not:

- make the durable candidate writable to authorship
- treat M4 receipts as authorship
- use `engineeringAllowed` or `verificationAllowed` as M5
- revive V1 broker `source_*`
- write Identity / Mind State / Recall

---

## 22. Physical qualification

Required where Git/filesystem mechanics are host-dependent. First-slice local
falsification does not need Bubblewrap. Physical qualification is a later
ladder stage and is not claimed by this design.

Owner-selected M-series policy: do not run Mint physical qualification after
M5 local settlement. Preserve every physical criterion named here and in the
M-series roadmap. Execute those criteria in the coordinated Mint campaign
after M7 independent review, against an exact frozen M-series candidate. Local
settlement of M5 is not `PHYSICALLY QUALIFIED` and not `PRODUCTION ACCEPTED`.

---

## 23. Production witness

Create one coherent multi-file candidate change-set against an explicit
sanitized live base. Produce a sealed diff artifact. Optionally bind one M4
receipt identity that matches the exact change-set hash. Prove:

1. the live repository bytes are unchanged
2. Git refs are unchanged when Git is present
3. the durable candidate tree hash is identical before and after
4. the row is `proposed` / `submitted`
5. evidence references are explicit
6. Expression describes candidate work, not apply or self-change

---

## 24. Acceptance gate

```text
DESIGN ACCEPTED
  → IMPLEMENTED
    → LOCALLY VERIFIED
      → INDEPENDENTLY REVIEWED
        → PHYSICALLY QUALIFIED
          → RELEASE_QUALIFIED
            → DEPLOYED
              → CAPABILITY PROMOTED
                → PRODUCTION WITNESSED
                  → PRODUCTION ACCEPTED
```

No stage implies the next. This file is `DESIGN ACCEPTED`. It is not
`IMPLEMENTED` until source lands, and source is not promotion.

Entry gate for implementation: G1 (M4 `PRODUCTION ACCEPTED`). Owner-selected
current work may implement this contract; this file still does not record
live production observations.

---

## 25. What remains blocked after M5

Even after future M5 `PRODUCTION ACCEPTED`:

- M6 bounded operation
- every M7 effect profile, including `patch_export` and `live_apply`
- Git mutation, network, packages, credentials
- apply-to-Ashley / self-change execution
- treating a sealed change-set as Ashley
- treating workspace state as Recall

---

## 26. Deferred work

1. Revise / rebase / supersede / abandon as admitted operations
2. Canonical (non-provisional) tree hash
3. Binding Doc review decisions (still must not apply)
4. Retention / forget policy beyond control-plane classification
5. Whether a later slice needs a detached credential-free Git projection
6. Owner HTTP diagnostics for change-sets (audit exists in SQLite without it)

---

## 27. Test plan

Local falsification during `ITERATION` / `SETTLEMENT` (no Bubblewrap, no full
corpus, no production database):

1. **Parse / bounds.** Valid `changeset.author` admits. Forbidden fields
   (patch, argv, command, apply, git write) fail closed.
2. **Capability isolation.** Observe/disabled `candidate_authorship` refuses.
   Active `project_experimentation` or `candidate_verification` does not grant
   M5. `engineeringAllowed` / `verificationAllowed` do not grant M5.
3. **Registry.** `authorshipAllowed=false` or missing refuses.
4. **Seal path.** Multi-file candidate delta vs sanitized base produces
   `proposed` row, sealed artifact, explicit evidence refs, audit events.
5. **Non-mutation.** Candidate tree hash identical. Live files identical.
   No git commit/ref movement in a fixture repo.
6. **Empty / unbounded.** No changes → `empty_changeset`. Extra actual paths
   beyond `intendedPaths` → `unbounded_path`.
7. **Secrets.** Credential-shaped patch or rationale → `quarantined`, no
   patch bytes stored.
8. **Git metadata.** `.git` inside candidate → refuse.
9. **Honesty.** License locks to the §1 sentence. Expression cannot inflate
   to apply or self-improvement.
10. **No apply.** Any apply/merge/commit entry point refuses
    `m5_apply_forbidden`.
11. **Proactive.** Unauthorized.
12. **One op per turn.** Authorship cannot chain with M3/M4 in the same
    Thought proposal.
13. **M4 coexistence.** A matching verification receipt may be recorded as a
    link. M5 does not execute recipes. M4 still cannot write the candidate.
14. **Schema.** Nuclear migration creates control-plane tables; inventory
    classifies them `CONTROL_PLANE`.

Physical qualification and production witness remain later, distinct claims.

---

## 28. Anti-patterns

Reject:

- reviving Wave 08 `change_proposals` as the V2 M5 store
- applying the patch “only to the candidate” as M5
- copying the sealed diff into Identity, prompts, or Recall
- `approved` as an M5 state that looks like effect
- treating `changeset.author` as Git commit
- building an improvement loop (edit → verify → author → apply)
- a new authorship kernel or event bus
- interpreting M5 as the beginning of autonomous self-improvement

---

## 29. Adversarial misreadings

| Misreading | Blocking text |
|---|---|
| M5 writes the live repo | §4, §10, §23 |
| M5 writes the durable candidate | §3, §10. M3 already writes files; M5 seals identity |
| A sealed patch is Ashley | Header distinctions; §1 |
| Approval applies the patch | §2, §6.4. No approve/apply states |
| M4 success authors a change-set | M4 design §24; this file §3 |
| `engineeringAllowed` grants M5 | §8.2 |
| Git present ⇒ commit | §8.4, §25 |
| Implementation is production acceptance | §24 |
| M5 is self-change | §1, §25. S1 remains specification |

No listed misreading is authorized by a reasonable reading of this text.
