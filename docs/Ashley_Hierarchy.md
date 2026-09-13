# Ashley Hierarchy

Every decision in Project Ashley derives its authority from a higher layer.
Lower layers implement higher layers. Higher layers are not changed merely to
accommodate lower-level convenience.

If two layers contradict each other, question the lower layer first. This is a
discipline for preserving meaning, not an excuse to avoid reconsidering the
Vision itself through its amendment process.

## Normative order

1. **Vision** - why Ashley exists and what apparent successes would betray her.
2. **Core Principles** - the highest constitutional constraints beneath the
   Vision.
3. **Constitution** - long-form behavioral and architectural direction.
   The file occupying [`Ashley_Constitution.md`](Ashley_Constitution.md) must
   be that constitutional content. A review prompt, living status snapshot,
   or historical design is not Constitution merely because it is filed at
   that path.
4. **Specialized governance (peers)** - [`Ashley_Stewardship_Compact.md`](Ashley_Stewardship_Compact.md)
   (operator authority, consultation, continuity) and
   [`Ashley_Ethics.md`](Ashley_Ethics.md) (relational, privacy, and
   external-entity ethics). These peers clarify and operationalize higher
   authority; neither is sequential over the other.
5. **Architecture** - ownership boundaries and system design. The frozen owner
   map and event terminology live in
   [`architecture/Ashley_Architecture_Freeze.md`](architecture/Ashley_Architecture_Freeze.md).
   That freeze adds no kernel, faculty, or primitive.
6. **System prompts** - runtime expression of the architecture.
7. **Developer prompts** - task-specific implementation guidance.
8. **Few-shot examples** - illustrative behavior, never independent authority.
9. **Runtime decisions** - concrete choices made from grounded state.

The Constitution occupying this chain is long-form constitutional direction,
not an architecture-review prompt. Document class (normative, frozen
architecture, living status, planned, historical, evidence) is owned by
[`architecture/Ashley_Architecture_Document_Index.md`](architecture/Ashley_Architecture_Document_Index.md).
Worktree name, branch name, and folder name are not authority. Exact Git
object identity and that index decide currentness.

```text
VISION.md
  -> Ashley_Core_Principles.md
    -> Ashley_Constitution.md
      -> [Ashley_Stewardship_Compact.md + Ashley_Ethics.md]
        -> Architecture
          -> Prompts
            -> Runtime
```

Specialized governance may clarify and operationalize higher authority. It may
never override it. If Stewardship Compact or Ethics appears inconsistent with
the Constitution, Core Principles, or Vision, the higher authority governs and
the conflict must be surfaced for deliberate amendment.

`VISION.md` is normatively prior, but it is not a technical conflict-resolution
procedure and is not loaded into ordinary runtime prompts. Its role is to
explain why every lower rule matters.

Worktree names, branch names, and folder names are not authority and not
currentness. Exact lineage, document class, and the
[Architecture Document Index](architecture/Ashley_Architecture_Document_Index.md)
decide.

Until grounded joint review exists, normative amendments to the Vision are
frozen. Meaning-preserving editorial corrections are allowed. Later proposals
may be recorded through joint review, but repository changes remain deliberate,
human-controlled acts.
