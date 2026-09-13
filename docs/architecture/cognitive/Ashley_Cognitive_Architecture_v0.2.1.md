# Project Ashley Cognitive Architecture v0.2.1

**Status:** `ACCEPTED ARCHITECTURE / IMPLEMENTATION PLANNED`

**Accepted:** 2026-08-29 by explicit owner direction (implementation-packet correction request). Prior architecture discovery verdict: READY FOR IMPLEMENTATION-GRADE SPECIFICATION.

**Kind:** Focused cognitive-reconstruction contract. This document does **not** add a freeze-map owner, faculty, kernel, or authority boundary. It reconstructs the existing Thought and Agency owners.

**This is not:** implemented, qualified, deployed, production accepted, or production active.

The packet paths below are pre-publication history and are not in the current
tree. They are provenance references, not current execution routes.

**Canonical architecture text:** `docs/cognitive-rework/v0.2.1/00_ARCHITECTURE_REFERENCE.md`

**Software contracts:** `docs/cognitive-rework/v0.2.1/02_IMPLEMENTATION_SPECIFICATION.md`

**Implementation packet:** `docs/cognitive-rework/v0.2.1/README.md`

**Owner acceptance record:** `docs/cognitive-rework/v0.2.1/OWNER_ACCEPTANCE_RECORD.md`

**Owner baseline gate (required before Luna implementation):** `docs/cognitive-rework/v0.2.1/OWNER_BASELINE_GATE.md`

---

## Authority

For the cognitive reconstruction, this contract outranks:

- historical glossary wording that made Agency the semantic decision owner;
- Cross-Phase table cells that route meaning “through Agency”;
- Constitution §Agency wording that called Agency “a decision layer” without the Thought split;
- any earlier implementation packet status of `FUTURE / PLANNED` treated as “not yet accepted architecture.”

It does **not** outrank Vision, Core Principles, Constitution (identity/ethics), Stewardship Compact, Ethics, or the frozen owner **map**. Thought and Agency remain the same freeze-map boxes. Their internal split is now this contract.

Live production source remains the legacy inverted path until configuration-only cutover of an exact qualified SHA.

```text
ACCEPTED ARCHITECTURE
  != IMPLEMENTED
  != QUALIFIED
  != DEPLOYED
  != PRODUCTION_ACCEPTED
```

## Frozen split

### THOUGHT — semantic judgment

Thought owns, for the active cycle/generation:

- what an event means;
- what Ashley concludes;
- what Ashley intends;
- whether an effect is desirable;
- whether Ashley should speak.

Thought is the sole semantic author. Cognitive Settlement publishes conversational and durable meaning. Operational intent may execute intra-cycle under Authority and receipts. Thought remains fallible (S31).

### AGENCY / COGNITIVE KERNEL — executive mechanics

Agency (the v0.2.1 cognitive kernel’s executive surface) owns:

- whether a valid cycle can run;
- resource scheduling;
- fencing (`cycleId` / `generation` / OCC);
- dispatch;
- retries;
- delivery;
- commit orchestration.

Agency may block or defer **mechanically**. Agency may not originate semantic intent.

## What Luna must not conclude

Luna must not treat `docs/Ashley_Glossary.md`’s pre-2026-08-29 Agency wording, Constitution §Agency, or Cross-Phase “through Agency” cells as superior semantic law. Those texts are superseded for cognitive authorship as of this acceptance. Historical copies remain historical evidence.

## Implementation status

Owned by the v0.2.1 implementation packet. Execution requires:

1. independently approved packet SHA (`APPROVED_PACKET_REVIEW_SHA`);
2. owner-selected source baseline SHA (`OWNER_SELECTED_SOURCE_BASELINE_SHA`);
3. packet bind onto that baseline, producing `IMPLEMENTATION_START_SHA` (documentation/governance/`.gitignore` only; production source byte-identical to the source baseline);
4. source-map revalidation on `OWNER_SELECTED_SOURCE_BASELINE_SHA`;
5. phases 00–08 complete in source starting at `IMPLEMENTATION_START_SHA`, then candidate freeze;
6. same-SHA qualification: exhaustive deterministic corpus, bounded real-Thought inhabit witness, isolated Mint, owner-authorized shadow;
7. owner cutover authorization;
8. configuration-only cutover of `QUALIFIED_SHA`;
9. live witness;
10. owner `PRODUCTION_ACCEPTED` (Luna cannot declare this).

Do not collapse those SHAs. Tracked Gate A is a template; execution values live in ignored runtime artifacts.
