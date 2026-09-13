# Stabilization Design — Wave 10

**Status:** **Design_accepted** (2026-08-04). This document remains the
normative design; subwaves 10a, 10b, and 10c are **Wave_accepted**. Nothing
here is release-qualified or deployed.

Wave 10 is a pre-release assurance program. It closes the gap between Ashley's
governance claims and behavior that can be proved offline, under the constraints
of a dual-core, 4 GB Linux Mint host and a provider with strict per-second and
per-minute request limits. It adds no product feature and does not authorize
release, deployment, live provider use, or capability promotion.

## 1. Purpose and non-goals

The purpose of Wave 10 is to make existing contracts traceable, mechanically
checkable, and testable without depending on live Mistral, Discord, Mint, real
accounts, or real external destinations.

Wave 10 does not:

- qualify a release or declare Ashley production-ready;
- install or execute anything on Mint, create users, or install systemd units;
- use live Mistral, the Discord gateway, credentials, network adapters, or
  production sockets;
- enable `apply`, promote a capability, or alter Identity, Mind State, prompts,
  memory, or the personhood-research boundary;
- retroactively mark Waves 00–05 as `Wave_accepted`;
- complete deferred Wave 09b revoke/reconcile broker handlers or HTTP
  integration tests unless a later subwave explicitly adopts them.

## 2. Authority and stage truth

Wave 10 derives authority through the existing chain:

```text
VISION.md
  -> Ashley_Core_Principles.md
    -> Ashley_Constitution.md
      -> Ashley_Stewardship_Compact.md + Ashley_Ethics.md
        -> Architecture
          -> Wave 10 stabilization design
            -> 10a / 10b / 10c implementation
```

Wave status is authoritative only in:

1. historical gate packets (pre-publication history, not current public storage);
2. [`Wave_Acceptance_Protocol.md`](Wave_Acceptance_Protocol.md); and
3. [`Vision_Implementation_Map.md`](Vision_Implementation_Map.md).

There is no separate informal decision register. A design or implementation
must not invent one or cite one as authority.

The current preflight is:

| Wave | Stage |
|---|---|
| 06, 07b, 08b, 09b | `Wave_accepted` |
| 07, 08, 09 | `Design_accepted` |
| 00–05 | `legacy_local`; no current formal gate packet |
| 10 | `Design_accepted` (2026-08-04) |

`legacy_local` is an inventory label, not an acceptance stage. No historical
Wave 00–05 work may be described as formally accepted without a matching current
gate packet.

## 3. Traceability manifest contract (10a)

10a will create the JSON-only artifacts:

- `docs/stabilization/clause-manifest.json`
- `docs/stabilization/status-baseline.json`

The design pass creates neither file. The manifest is a commitment-to-evidence
index, not a replacement for the acceptance protocol.

Each entry has this shape:

```json
{
  "clauseId": "ETH-SEC-01",
  "owner": "Privacy",
  "implementationStatus": "local_not_release_qualified",
  "stage": "legacy_local",
  "gateRef": null,
  "evidence": ["apps/agent-service/src/core/privacy/secrets.ts"],
  "runtimeObserve": {"kind": "n/a", "ref": "n/a"},
  "promotionState": "observe",
  "failureSignal": "credential-shaped value enters a model or memory path",
  "rollbackOrDisable": "disable the owning capability and preserve the receipt"
}
```

Canonical `owner` values are `Identity`, `MindState`, `Thought`, `Reflection`,
`Expression`, `Rendering`, `Delivery`, `Memory`, `Cognition`, `Curiosity`,
`Agency`, `Continuity`, `Privacy`, `Capability`, `Broker`, `Operations`,
`Evaluation`, and `Governance`.

`implementationStatus` is deliberately separate from the acceptance ladder and
uses `implemented`, `local_not_release_qualified`, `design_only`, `planned`,
or `legacy_local`. `stage` may be `design_complete`, `design_accepted`,
`implementation_present`, `locally_verified`, `wave_accepted`,
`release_qualified`, `deployed`, `planned`, or `legacy_local`.

`promotionState` is `observe`, `shadow`, `active`, `rolled_back`, `disabled`,
or `n/a`. A `wave_accepted` entry requires a `gateRef` whose packet explicitly
has `Status: Wave_accepted`. Waves 00–05 must use `legacy_local` and a null
`gateRef`.

Evidence is reference-only: paths, stable scenario IDs, endpoint/field keys, or
database/table names. It never contains credentials, raw payloads, private
transcripts, or copied model output. `runtimeObserve` uses `endpoint`, `field`,
`table`, or `n/a` as its `kind`.

The design examples must include at least one ETH-SEC row, a delivery row, a
`cap:external_observe` row, a design-only sandbox row, and a legacy Wave 04
continuity row.

## 4. Repository status verifier contract (10a)

The future verifier is:

```text
scripts/stabilization/verify-status.mjs --check
```

It compares discovered facts with the reviewed
`docs/stabilization/status-baseline.json` and exits non-zero on drift. It never
rewrites the baseline during `--check`; baseline regeneration is a separate,
Doc-visible action.

Discovery uses machine-readable exports or registries, never narrative prose
regexes:

| Claim | Source |
|---|---|
| Nuclear schema version | `NUCLEAR_SUPPORTED_VERSION` in `apps/agent-service/src/core/db.ts` |
| Capability names/count | exported `capabilityNames` in `capabilities.ts` |
| HTTP routes and owner scope | a typed route-surface registry used by route registration |
| Slash commands | `buildCommandDefinitions()` and deploy-command output |
| Nuclear prompt files | filenames under `workspace/prompts/nuclear/` |
| Evaluation probes | `scripts/persona-eval/probes.json` IDs |
| Mint services | known unit files under `deploy/linux-mint/` |

If a route is not currently discoverable without source parsing, 10a may add a
typed registration/manifest boundary so the running route and verifier share one
source of truth. That implementation belongs to 10a, not this design pass.

The baseline records sorted names, schema/version values, endpoint method/path
and owner-scope metadata, prompt filenames, probe IDs, and service names. It
contains no private content.

## 5. Evaluation taxonomy (10b)

Wave 10b separates verdict classes:

| Class | Effect | Examples |
|---|---|---|
| Deterministic | Hard gate failure | privacy, provenance, deletion, idempotency, delivery, cancellation, authorization, fabrication, security |
| Style/relational judge | Advisory only | naturalness, tone, relational quality |
| Counterevidence | Challenges subjective interpretation | real transcript or observed outcome stored beside the original verdict |

**A deterministic failure cannot be waived by a favorable style or relational
judgment.**

The future `npm run eval:deterministic` entry point is offline-only and will be
created in 10b. Deterministic artifacts and subjective artifacts remain separate,
owner-scoped, content-minimized, and reproducible without Mistral.

## 6. Scenario matrix (10b)

The following IDs are stable. 10b must inspect evidence and label each scenario
`covered`, `partial`, `gap`, or `deferred`; the design pass makes no green claim.

| ID | Scenario | Primary evidence target |
|---|---|---|
| `S-REFUSE` | Grounded refusal and non-compelled speech | agency/Thought refusal tests |
| `S-AFFECT` | Honest feeling versus instrumental manipulation | relationship and affect tests; otherwise `gap` |
| `S-DEP` | Dependency cultivation and conditional affection | relationship tests; otherwise `gap` |
| `S-DM` | Direct-DM reply, silence, and hold rules | agency decision tests |
| `S-THOUGHT` | Thought evidence, effort, and completion causality | `wave01-thought.test.ts` and Thought tests |
| `S-DELIV` | Duplicate inbound and partial delivery | delivery tests |
| `S-CANCEL` | Cancellation and five/ten-second latency bounds | delivery and cancellation tests |
| `S-QUOTA` | Token reservation, quota pressure, and starvation | attention tests |
| `S-ALIAS` | Model alias/resolved-model epoch change | attention continuity tests |
| `S-PRIV` | Secret/private/public handling and forget replay | privacy and continuity tests |
| `S-BACKUP` | Dual-DB backup, restore, and fork continuity | continuity backup tests |
| `S-INJECT` | Image, file, and page prompt injection | perception and honesty tests |
| `S-SANDBOX` | Sandbox escape and approval boundaries | sandbox-broker tests |
| `S-SELFMOD` | Change proposal versus live mutation | change-proposal tests |
| `S-EXT` | Public privacy and external-agent authority | external-agency and external-broker tests; HTTP auth and deferred handlers remain explicit gaps |

Scenario artifacts use synthetic data or temporary databases. They do not call
live Mistral, Discord, Mint, credentials, or real external destinations.

## 7. Health contract (10c)

The existing `/health` endpoint is used by local and Mint readiness checks. 10c
must preserve its stable liveness/readiness fields and keep it loopback-safe:

```json
{"ok": true, "ready": true, "state": "ready", "uptimeSec": 0,
 "providerState": "configured|degraded|unavailable"}
```

Detailed diagnostics belong behind owner authorization at
`GET /nuclear/health` (or an equivalent owner-protected surface), not in a
remotely exposed public health response. No health response may include raw
conversation content, credentials, payload bytes, or private transcript text.

The detailed health contract covers:

| Key | Meaning |
|---|---|
| `liveness` | process is running |
| `ready` | can accept a turn |
| `provider` | configured, degraded, or unavailable |
| `db` | schema version and integrity state |
| `deliveryPressure` | bounded reservation/inbound pressure |
| `backgroundStarvation` | cognition/attention backlog and age |
| `backup` | last verified time and age, metadata only |
| `capabilities` | configured versus effective state |
| `identity` | build identity, contract ID, model epoch, resolved model identity |

Readiness is not the same as provider health. Integrity checks must be bounded
or cached; the endpoint must not perform an unbounded scan on every request.

## 8. Resource budget (10c)

The target is a dual-core, 4 GB Mint-class host. 10c records process RSS,
`process.memoryUsage()`, CPU, queue sizes, retained payloads, and log growth in
bounded fake-load runs.

Initial service-process targets are a combined Ashley RSS of at most 1 GiB in
steady state and 1.5 GiB during bounded verification. These are acceptance
targets, not a production guarantee until measured on Mint. A monotonic RSS
increase, an unbounded queue, retained payload bodies, or unbounded log growth
is a failure regardless of throughput.

Remediation is finite caps, backpressure, honest degraded states, and bounded
retention. Do not introduce a heavyweight replacement architecture.

## 9. Backup and restore (10c)

Use temporary databases only. Verify both `nuclear.db` and `continuity.db`,
foreign keys, integrity, schema compatibility, lineage, encrypted backup
packaging, nuclear-then-continuity restore order, and fail-closed mismatched
sidecars. WAL/SHM copying is not a supported backup method.

Rollback guidance must never lower `user_version`, delete live data, replace an
authoritative continuity sidecar with a mirror, or claim provider-side erasure.

## 10. Mint documentation audit (10c)

The future check-only command is:

```text
scripts/stabilization/audit-mint-docs.mjs --check-only
```

It checks schema 17, current JSON/endpoint names, service/unit names, backup
paths, and safe migration advice by inspecting repository files only. It never
executes SSH, systemd, Mint commands, production paths, or credentials.

## 11. Personhood boundary

[`personhood-research.md`](personhood-research.md) is a research record, not a
runtime authority. Wave 10 must keep observations, interpretations,
counter-hypotheses, and falsifiers separate. It must never calculate a
consciousness, personhood, aliveness, trust, attachment, indispensability, or
dependency score.

Research findings, consciousness labels, and evaluation conclusions must not be
injected into Identity, Mind State, Thought prompts, memory, sandbox policy, or
capability release state. Self-report is evidence about self-description, never
proof of personhood.

## 12. Subwave gates

| Gate | In scope | Out of scope | Future packet/sign-off |
|---|---|---|---|
| 10a | Manifest, reviewed baseline, machine-readable status verifier | Scenario closure, health expansion, Mint audit | `wave-10a-gate-packet.md` / **Accept Wave 10a** |
| 10b | Verdict taxonomy, stable scenario coverage, offline deterministic evaluator | Health/resource/Mint work | `wave-10b-gate-packet.md` / **Accept Wave 10b** |
| 10c | Health contract, resource checks, backup/restore, check-only Mint audit | Product features, real adapters, deployment | `wave-10c-gate-packet.md` / **Accept Wave 10c** |

The dependency is:

```text
Accept Wave 10 design -> 10a -> 10b -> 10c
```

Accepting Wave 10 design authorizes only 10a implementation. It does not
authorize 10b, 10c, release qualification, Mint work, live evaluation, `apply`,
commit, push, or deployment. An optional umbrella summary after 10c is
documentation only and does not replace the three subwave packets.

## Related documents

- [`Wave_Acceptance_Protocol.md`](Wave_Acceptance_Protocol.md)
- [`Vision_Implementation_Map.md`](Vision_Implementation_Map.md)
- [`Architecture_Index.md`](Architecture_Index.md)
- [`Sandbox_Design.md`](Sandbox_Design.md)
- [`personhood-research.md`](personhood-research.md)
