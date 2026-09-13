# Project Ashley — Worker Instructions

[UNIVERSAL] This file is the worker entrance. It carries the non-negotiable
execution and authority rules for working in this repository. It is not an
architecture owner. Verification lifecycle semantics are owned by
[`docs/Wave_Acceptance_Protocol.md`](docs/Wave_Acceptance_Protocol.md).

A worker needs three things: the actual task and scope, the rules in this
file, and the smallest domain material the task triggers (§7). Nothing else
here is universally mandatory.

## 1. Purpose and scope

Work from the exact task scope. The task scope decides what you read, what
you change, and what verification you owe. Do not expand scope to "improve"
adjacent systems, close unrelated gates, or modernize documents you pass
through.

## 2. Universal execution rules

- Follow the exact task scope. If scope is ambiguous, ask or record the
  assumption; do not silently widen it.
- Distinguish three kinds of claims. Normative requirements state what MUST
  be true. Implementation facts state what a revision DOES. Deployed/active
  facts state what IS live. Never let one kind stand in for another.
- Never infer currentness from file names, branch names, worktree names,
  document titles, source presence, or how detailed a document is.
- Implementation presence never implies production activation. A passing
  test never implies promotion. `RELEASE_QUALIFIED` is not
  `PRODUCTION_ACCEPTED`.
- `UNKNOWN` is a legitimate, complete answer when the evidence owner cannot
  be inspected. Never paper over it with the latest confident prose.
- Production observation describes what is live. It does not override
  normative law: a deployed defect does not become correct by being live.
- Read only what the task actually requires. History answers
  causal/historical questions; it is not default context.

## 3. Fact-kind → evidence-owner resolution

Resolve each volatile fact from its owner when the task needs it.
Documentation may explain the kind, the owner, and how to inspect it. It
must not substitute a copied value.

| Kind of question | Owner that answers it | How to inspect |
|---|---|---|
| What MUST be true? | Applicable normative / architectural / domain contract | Read the governing clause (§7) |
| What does this revision implement? | Source at that revision + relevant invariant/focused tests | Read the owning module/directory and its tests |
| What configuration is selected? | Actual configuration owner for that environment | Read `config/` and the effective env file, not prose about them |
| How is routing resolved? | Declared portfolio + loader/resolver source, then effective state | [`docs/Routing_Status.md`](docs/Routing_Status.md) guide, then source; production observation for served state |
| What is actually deployed / active? | Production observation / effective production state | Observe; `UNKNOWN` when unobservable from here |
| What passed qualification? | Exact-candidate qualification evidence | Read the packet bound to its SHA/date/claim |
| What was accepted / promoted? | Attributable acceptance / promotion evidence | Read the acceptance record, not a roadmap row |
| What happened historically? | Dated / baseline-bound records | Curated-history notes for selected lessons; full pre-publication archaeology lives in the old historical repository — read as snapshots |
| What should be done next? | Owner / task scope | Roadmaps record bounded intent; they do not assign your next action |

Today's pending gate is not a sentence in this file. Resolve it live. If it
cannot be established from permitted evidence: `UNKNOWN`.

## 4. Task/domain routing

Route each task to the smallest applicable domain contract, then to the
owning module or package directory, then to exact files and tests
discovered there. Prefer module/directory-level ownership pointers over
exhaustive file maps; use exact file links only where they remove real
ambiguity. If you move an owner, update its nearby documentation and
incoming navigation references.

A task may legitimately require several domain documents. The rule is not
"exactly one document." The rule is: read only what the task actually
requires.

## 5. Standing guardrails

- Development orchestration is not Ashley cognition. Named workers,
  harnesses, review bots, and consultation outputs are how Ashley is
  built and studied. They are not her cognitive faculties. Do not
  describe them as such.
- Sandbox V1 must not return. Current sandbox work uses direct,
  unprivileged Bubblewrap under the V2 M-series contract
  ([`docs/architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md`](docs/architecture/sandbox/ASHLEY_SANDBOX_V2_ROADMAP.md)).
  Retained Wave 07 broker material is historical V1 and MUST NOT be
  reintroduced by implication; full pre-publication archaeology belongs
  to the old historical repository.
- Treat architecture predecessor rules as architecture. Do not implement
  a later milestone while its documented predecessor gate is unmet.
- Infer no self-change authority from Sandbox M5/M7. Authorship is not
  authority to change Ashley.
- Copy no schema integers, model IDs, quotas, SHAs, or activation states
  into timeless architecture or procedures.
- Run no full generic CI for docs-only edits.

## 6. Durable operations pointers

```powershell
# From the repository root. Env file: ~/.composer-assistant/.env
# See config/env.example. Commands come from this repository's package.json.

npm run start:ashley   # SSH to Mint: checkout + coherent stop/build/start
npm run stop:ashley    # stops accidental Windows pids only
npm run dev:agent      # agent only (no Discord gateway)
npm run dev:discord    # agent + discord bot (conflicts with Mint)
```

| Service | Port | Path |
|---------|------|------|
| agent-service | 3710 | `apps/agent-service/` |
| discord-bot | gateway | `apps/discord-bot/` |

| Path | Purpose |
|------|---------|
| `~/.composer-assistant/.env` | Secrets and config |
| `~/.composer-assistant/conversations/nuclear.db` | Nuclear Identity, Mind State, Thought, Agency, delivery, cognition, and capability SQLite |
| `~/.composer-assistant/continuity.db` | Authoritative continuity sidecar (lineage, forget, sessions) |
| `workspace/prompts/nuclear/` | Thin nuclear identity prompts |

Runtime orientation (stable vocabulary; ownership details live in the
freeze and domain contracts):

```
Discord DM → POST /chat/text → Identity + Mind State + Recall → Thought → Agency / Expression → delivery
Proactive tick → Agency.decide → draft → reserve → send → receipt / reconcile → commit / finalize
Grounded engineering intent → admission → direct unprivileged Bubblewrap → receipt / reconcile
```

Identity and Mind State are joint inputs to Thought — neither produces the
other. Thought owns semantic meaning; the host must not invent it.
Expression realizes an authorized intent as language. Rendering is platform
mechanics only. Reflection calibrates future Thought; it has no
current-turn authority.

When adding behavior, implement it at the lowest layer that naturally owns
it: stable identity, current mind state, reasoning/effort allocation,
expression choice, or rendering concern — in that order.

Inspection surfaces (owner-scoped diagnostics) and control/effect
endpoints are implemented in `apps/agent-service/src/server.ts`. Keeping
inspection separate from mutation is the rule: diagnostics never
authorize, and a work-queue projection (e.g. delivery pending) is never
proof of delivery. Cognition influence is capability-gated; never assume
an effective mode — resolve it from source or production evidence.

The product boundary is single-owner, English-language, Discord-only
(voice, Telegram, habits, Moltbook, and skills retired). Expansion needs
its own design, authority review, verification evidence, and owner
acceptance.

## 7. Conditional reading routes

Governance authority stays binding whenever the task enters its scope.
Conditional reading never waives applicability. Precedence, highest
first: Vision → Core Principles → Constitution → Stewardship Compact +
Ethics → Hierarchy → Architecture → prompts.

| Task class | Read, then own |
|---|---|
| Identity / semantic authorship | Relevant constitutional clauses + Thought contract + `apps/agent-service/src/core/cognitive-v021/thought/` |
| Thought / semantic cognition bugs | Thought contract + `apps/agent-service/src/core/cognitive-v021/thought/`; focused tests live adjacent. Plans never substitute for source |
| Ethics / external representation / stewardship / emergency action | Stewardship Compact, Ethics, Hierarchy — as applicable |
| Cross-domain authority questions | Hierarchy + Cross-Phase contract |
| Delivery / receipt reconciliation | `apps/agent-service/src/core/delivery/` + `apps/agent-service/src/core/cognitive-v021/delivery/`; focused tests adjacent — source and adjacent tests are the route |
| Memory / recall | [`docs/memory-and-recall.md`](docs/memory-and-recall.md) + `apps/agent-service/src/core/cognitive-v021/memory/`; recall-epoch material beside rollout |
| Continuity | `apps/agent-service/src/core/continuity/` (lineage, forget, sessions). No identity-history detour unless the task is constitutional |
| Owner admission / wake / unanswered recovery | `apps/agent-service/src/core/cognitive-v021/cycle/` (admission, fence, recovery); focused cycle tests. No initiative-campaign archaeology |
| Concern projection (occupied concerns) | Concern/projection code inside the Thought module above; describe the domain directly, no campaign terminology |
| Periodic mechanism | `apps/agent-service/src/core/cognitive-v021/initiative/` (schedule, diagnostics). Mechanism only — live enablement is production observation, needed only if the task asks it |
| Private Thought budget / admission | `apps/agent-service/src/core/cognitive-v021/private-budget/` + focused tests. No quota copies |
| Sandbox work | V2 M-series roadmap + `apps/agent-service/src/core/sandbox/` + `apps/sandbox-v2/`; V1 material for provenance only |
| Routing / model-config questions | [`docs/Routing_Status.md`](docs/Routing_Status.md) guide, then `apps/agent-service/src/core/model-routing/` + `apps/agent-service/src/core/model-fabric/` + `config/model-fabric/`; served state via production observation |
| Observer exporter / evidence bugs | `apps/observer-exporter/` (its README states the authority boundary) + focused tests. Tooling, not cognition |
| Field Lab / observational interpretation | Field Observation Protocol — only when the task concerns Field Lab. Docs work never modifies Trial, Observer, or synthesis state |
| Deployment / operator work | AGENTS §6 + `deploy/` procedures + production evidence. No deployment-status prose |
| External effects / authority | External-Effect contract + `apps/agent-service/src/core/external-agency/`; historical Agency design is not authority |
| Deployment / qualification / promotion claims | Applicable operational procedure + exact-candidate evidence |
| Historical regression / design rationale | Curated history and the old historical repository — bound to SHA/date |
| Ambiguous terminology | The relevant [`docs/Ashley_Glossary.md`](docs/Ashley_Glossary.md) entry on demand |

Full governance and architecture live behind these routes:
[`VISION.md`](VISION.md),
[`docs/Ashley_Core_Principles.md`](docs/Ashley_Core_Principles.md),
[`docs/Ashley_Constitution.md`](docs/Ashley_Constitution.md),
[`docs/Ashley_Stewardship_Compact.md`](docs/Ashley_Stewardship_Compact.md),
[`docs/Ashley_Ethics.md`](docs/Ashley_Ethics.md),
[`docs/Ashley_Hierarchy.md`](docs/Ashley_Hierarchy.md),
[`docs/architecture/Ashley_Architecture_Roadmap.md`](docs/architecture/Ashley_Architecture_Roadmap.md) (bounded intent, not current-state proof),
[`docs/architecture/Ashley_Architecture_Freeze.md`](docs/architecture/Ashley_Architecture_Freeze.md),
[`docs/architecture/Ashley_Cross_Phase_Architecture.md`](docs/architecture/Ashley_Cross_Phase_Architecture.md),
[`docs/architecture/Ashley_Milestone_Execution_Governance.md`](docs/architecture/Ashley_Milestone_Execution_Governance.md),
[`docs/architecture/External_Effect_and_Authority_Architecture.md`](docs/architecture/External_Effect_and_Authority_Architecture.md),
[`docs/Architecture_Index.md`](docs/Architecture_Index.md) (module map).

## 8. Verification selection

Select verification by affected contracts, dependency reach, and
applicable project gates. More tests are not automatically more
evidence. This matrix is worker-facing selection only; Wave Acceptance
owns the semantics.

| Change / claim | Default verification |
|---|---|
| Docs-only | Documentation verification only. No Bubblewrap. No full corpus. |
| Pure / local logic | Focused falsification tests during `ITERATION` |
| Schema / migration / data-plane | Targeted authority and migration regressions plus `SETTLEMENT` build/typecheck where relevant. No production database. |
| Settled code candidate | `SETTLEMENT`: affected regression plus build/typecheck where relevant |
| Candidate freeze | One full corpus gate |
| Linux / Bubblewrap / process / filesystem / timing claims | `PHYSICAL QUALIFICATION` on the real host/environment where the claim depends on it |
| Capability promotion | `PRODUCTION`: exact-candidate production witness. Tests never promote. |

Available corpus commands (use only at the stage Wave Acceptance requires):

```powershell
npm test
npm run phase0:offline
npm run eval:full -- -Baseline baseline-w0 -Label wave5
```

## Slash commands

| Command | Action |
|---------|--------|
| `/remember` | Pin fact |
| `/memory` | Show memory |
| `/new` | Fresh thread |
| `/forget` | Forget by topic |
| `/proactive` | Initiative status / pause / resume |
| `/identity` | Owner-only foundational review / approve / reject / defer |
| `/commitments` | Relationship summary (owner-only, ephemeral) |
| `/continuity` | Continuity lineage snapshot |
| `/status` | Nuclear health + initiative + relationship_state |
