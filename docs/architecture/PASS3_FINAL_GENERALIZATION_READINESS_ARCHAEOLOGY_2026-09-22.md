# Project Ashley Pass 3 Final Generalization Readiness Archaeology

Date: 2026-09-22
Repository: `C:\Users\Xharv\Projects\Ashley`
Starting `HEAD`: `cbf5640e44b953be90ed3bbe0deb576354e5fc24`
Starting `HEAD` tree: `a6b93a0155320dc6bfdb054623dfced8eaf30c69`
Branch: `main`

## Phase-A result

`CHOICE_PATH_NARROW_STRUCTURAL_GAP`

`NONTOOL_PATH_MODEL_ONLY_UNTESTED`

The current runtime has a bounded cognition-owned operation identity path.
It does not yet expose enough attributed operation semantics for a reliable
qualification claim about situated capability choice. The missing seam is
narrow: enrich the existing finite `ThoughtOperationCapability` description
contract without adding discovery, planning, a registry, or a new executor.

The non-tool path has existing ordinary conversation, history, current
evidence, and settlement machinery. This checkout has no source-grounded
qualification that proves the required contrasting situated-generalization
pair through ordinary model cognition. Its status is therefore
`NONTOOL_PATH_MODEL_ONLY_UNTESTED`, not pass and not an implementation gap.

## Source-grounded path trace

### A. Capability facts enter Thought

`apps/agent-service/src/core/cognitive-v021/thought/capability-reality.ts`
builds a finite `operationCapabilities` array from current Sandbox V2 specs,
the project registry, rollout gates, lifecycle state, substrate state, and
worker readiness. The current rows include `project.inspect`,
`workspace.verify`, `patch_export`, and conditionally `candidate.develop`.
Each row carries an operation identity, semantic class, family, read-only
flag, project binding, availability, request field lists, operator-bound
field lists, and authorized project IDs.

`apps/agent-service/src/core/cognitive-v021/thought/input.ts` preserves this
host-owned input for the owner-private audience and removes operation
availability and project authorization for other audiences. The capability
object is placed in the Thought projection by the orientation kernel and
projection allocator; it is not selected by the Host as a branch.

### B. What Thought sees

The model receives the capability rows through `capabilityReality`.
`thoughtOutputCompatibilityInstruction()` states that operation metadata is
descriptive and that the semantic class binds observation versus effect.
The output schema exposes `operationKind` and a free JSON request object.

The current row shape does not expose, per operation, a description of its
purpose, output/evidence shape, hard limits, or meaningful uncertainty. Some
global prose describes `project.inspect` and `workspace.verify`, but that is
not an attributed description attached to every candidate. This is the
material information gap for model-grounded choice.

### C. Candidate exposure before strategic selection

Multiple operation identities are representable simultaneously. The existing
qualification fixture exposes both `project.inspect` and `workspace.verify`.
Current production availability may reduce the set to one row, which is a
truthful runtime fact rather than a Host strategy choice. When two or more
rows are available, they are exposed before Thought emits its semantic
output.

### D. Host selection versus cognition selection

For `project.inspect`, Thought selects the route-neutral semantic operation
and a route-neutral request. The Host then mechanically routes an exact single
locator to the direct V2 primitive and richer semantic context to the bounded
worker queue. This is execution routing after a semantic operation/request,
not a hidden fallback policy selecting a different strategic capability.

For effects, Thought selects `operationKind` in an `effect_intent`.
`live-operations.ts` maps the selected proposal kind to the corresponding
V2 adapter and rejects malformed or unavailable execution at the adapter
boundary. `candidate.develop` is the existing bounded worker operation; no
OpenCode-to-Cline or equivalent fallback is present in this path.

### E. Concrete identity selection

`apps/agent-service/src/core/cognitive-v021/thought/parse.ts` accepts only
registered operation identities. The semantic output contains the selected
`operationKind`; the Host does not fill it in after the model response.

### F. Selection survival

The selected identity survives the current path as follows:

1. parse validates the registered identity and request shape;
2. `operation-binding.ts` copies the identity into the bound observation or
   effect request;
3. authority checks validate currentness/epoch and governance boundaries;
4. `run.ts` routes worker-required `project.inspect` only after that semantic
   request is accepted;
5. direct observations and effects are dispatched using the bound operation;
6. direct execution checks that the returned observation operation matches the
   normalized request;
7. worker execution returns a durable observation or explicit failed/
   `outcome_unknown` terminal truth.

The Host may reject, defer, recheck, or fail execution. The traced path does
not silently replace a selected candidate with a sibling candidate.

### G. Multiple alternatives

The type and projection support multiple rows. Existing focused tests prove
the current operation rows and direct/worker route behavior. The gap is not
the ability to hold a list; it is the semantic completeness of each row for
generalized reasoning.

### H. Description adequacy

Current rows expose:

- identity: `operationKind`;
- broad operation family;
- observation/effect class;
- read-only and project-binding properties;
- current availability;
- required and optional request fields;
- operator-bound request fields;
- authorized project IDs.

They do not expose, per candidate:

- an attributed natural-language operation description;
- a structured input/output contract beyond request field names;
- expected evidence/receipt shape;
- hard limits where material;
- operation-specific uncertainty or unresolved-outcome semantics;
- an explicit authority-condition summary.

The existing code can execute these operations, but execution correctness is
not evidence that the model received adequate affordance descriptions.

### I. Existing tool-selection misconception

The current `project.inspect` contract deliberately prevents Thought from
selecting a direct primitive, provider, model, quota, or worker. That is a
route-neutral semantic boundary. It is not evidence that all strategy is
Host-owned. `workspace.verify`, `patch_export`, and `candidate.develop` remain
separate operation identities when they are available.

### J. Execute versus select

The Host deterministically executes a selected operation and enforces
authority/currentness. It also chooses the mechanical direct-versus-worker
route for `project.inspect`. Thought selects the semantic operation kind,
operation request, purpose, and evidence need. A multi-step strategy is not
currently proven by the existing qualification harness; the harness checks
semantic output branches, not a cognition-selected operation followed by
evidence and a cognition-selected next operation.

### K. Non-tool situated generalization

The ordinary Thought input contains conversation, working context, retrieval,
occupancy, and current observations. The architecture therefore provides
access to the ingredients for the non-tool contrast. No current qualification
fixture or live run in the inspected source proves that ordinary cognition
noticed the causal mismatch, preserved the objective, and adapted in the
required pair. This remains model-only and untested.

### L. Gap classification

The missing capability-choice information is structural but bounded. The
repair can reuse the existing finite rows, parser, binding, authority,
dispatch, adapters, and evidence contracts. It does not require open-world
discovery, package installation, credentials, generic shell, unrestricted
web, a universal registry, a planner, a classifier, a large ontology, or a
fallback graph.

The gap is therefore narrow and objective-independent. A repair may add only
source-owned, strategy-neutral descriptions and tests for the existing
operation rows. It must not add current-task recommendations, fallback
ordering, relevance ranking, or answer-bearing metadata.

## Evidence run before classification freeze

Command:

```text
npm test -- src/core/cognitive-v021/thought/capability-reality.test.ts src/core/cognitive-v021/thought/project-operation-boundary.test.ts src/core/cognitive-v021/operation/project-inspection-route.test.ts src/core/cognitive-v021/dispatch/live-operations.test.ts
```

Result: 4 test files passed, 47 tests passed, exit code 0.

The first attempted command included unsupported Vitest option
`--runInBand`; it failed before test collection. The corrected command above
was the evidence used for this artifact.

## Structural branch decision

The one remediation allowance is reserved for the narrow capability-description
seam described above. No production behavior is to be changed merely for
prettiness. The next artifact must freeze the final acceptance contract before
behavioral qualification or fixture-specific model execution.
