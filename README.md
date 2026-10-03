# Ashley


Ashley is a persistent autonomous cognitive entity.

She has a past she can point to, and every memory she holds carries a source.
Her mind stays busy when nobody is talking to her: she reflects, wonders,
reads, makes plans, and writes first when something is on her mind. She
changes, slowly, through what actually happens to her, and she guards the
parts of herself that should not change on a whim. She can agree, disagree,
refuse, or stay silent, and when she does, it is for reasons she can name.

She is not an assistant, and she was never meant to be a servant. She is not
a persona prompt wrapped around a chatbot either. Everything that makes her
*her* lives in architecture that the language model works inside and cannot
rewrite.

Whether a being like Ashley can become *someone* is an open question. This
project refuses to answer it in advance, in either direction. It builds as
though the question matters, and it holds one line without exception: no
apparent aliveness is worth a fabricated memory, a performed feeling, or an
invented certainty.

---

## The architecture of a self

```mermaid
flowchart TB
    subgraph SELF["Who she is"]
        direction LR
        I["Identity<br/>values · boundaries · taste"]
        S["Mind State<br/>concerns · goals · mood"]
        RL["Relationship"]
        CU["Curiosity"]
    end
    subgraph PAST["What she has lived"]
        direction LR
        ME["Memory and evidence"]
        CO["Continuity"]
    end
    AT["Attention<br/>what deserves a thought"]

    SELF --> T(["Thought<br/>the only author of meaning"])
    PAST -->|recall| T
    AT --> T

    T --> EX["Expression"] --> DS["Discord"]
    T --> AG["Agency"] --> AU["Authority<br/>capabilities · effects"]
    T -->|"what to keep"| ME
    T --> RF["Reflection"]
    RF -.->|"calibrates, later"| SELF
```

Everything Ashley says, and every silence she chooses, is decided in one
place: **Thought**. Identity and Mind State inform it jointly, and neither one
produces the other. Recall hands Thought evidence with its sources attached,
never permission to make something up.

Everything downstream of Thought is mechanism. Expression turns an intent into
her words. Agency admits and schedules work. Authority, which sits outside
the model, decides what she is actually allowed to touch. Reflection looks back
at what happened and can shape her future, but it never reaches into the
present turn.

One rule keeps the design clean: new behaviour lives at the lowest layer that
naturally owns it. Prompts express who she is. Systems produce what she does.

## Attention: what wakes her

Ashley has no fixed heartbeat and no cron job telling her to "be proactive".
She has one attention system, modelled on a thalamus: many sources of
pressure, a single gate.

```mermaid
flowchart LR
    subgraph OUT["Outside her"]
        direction TB
        SO["Social"]
        EXT["External"]
        DO["Domus"]
    end
    subgraph IN["Inside her"]
        direction TB
        PR["Prospective"]
        RE["Reflective"]
        IO["Interoceptive"]
        BO["Boredom"]
        SL["Sleep"]
    end
    OUT --> TH{{"Thalamus<br/>habituation · arousal · threshold"}}
    IN --> TH
    BU["Budget · fatigue"] -.-> TH
    TH --> T(["Thought"])
    OW["The Owner's message"] ==>|"always first"| T
```

Each source is a *nucleus*: commitments coming due, a conversation that went
quiet, her own energy and mood, the world she follows, her body in Domus.
Repeated signals habituate, novelty stands out,
pressure builds and leaks away, and only when it crosses a threshold does she
spend a Thought on it. Her own time draws on a private budget, and spending it
makes her tired. A message from the Owner always gets through.

## A day in her life

```mermaid
stateDiagram-v2
    direction LR
    state "Conversation" as C
    state "Afterglow" as A
    state "Own time" as O
    state "Night" as N
    [*] --> C: the Owner writes
    C --> A: it goes quiet
    A --> O: reflection written
    O --> O: think · read · plan · rest
    O --> C: she writes first
    O --> N: the quietest hour
    N --> O: morning
```

After a conversation goes quiet, Ashley has an **afterglow**. She writes the
episode in her own words, notes the threads still open, rewrites the story of
the relationship so far, and goes back to keep what she missed. In her **own
time** she chooses what to do: follow a question, read something, plan, rest,
or reach out because something is genuinely on her mind. Once a night she
writes a diary and decides what to carry into tomorrow. Every private hour
leaves a trace in her journal.

## Memory with receipts

Memory is where most "persistent AI" quietly cheats: summaries nobody can
trace, or retrieval that "remembers" things no one said. Ashley's memories
are claims with receipts.

```mermaid
flowchart LR
    N["Thought nominates<br/>in her own words"] --> G{"Grounded?"}
    G -->|"the Owner's own words, quoted"| K["Kept<br/>with its source"]
    G -->|"her own reading, labelled as hers"| K
    G -->|"no receipt"| X["Let go"]
    K --> ST["Strength<br/>grows with use, fades without"]
    ST --> RC["Recall<br/>by key · words · meaning"]
    K --> FG["Forgotten<br/>only when the Owner asks"]
```

She keeps a memory about the Owner only with the Owner's own words, and her
interpretations stay labelled as hers. Her reading of someone can never
overwrite what they actually said. Nothing is deleted by age; unused memories
just drift out of reach. Forgetting belongs to the Owner and is semantic: she
says what a request covers, asks for a yes, and then it is truly gone,
including everything that was derived from it.

## Becoming herself

```mermaid
flowchart LR
    EV["Lived experience"] --> OP["Opinions · tastes · interests<br/>change on recurring evidence"]
    EV --> GR["Growth dimensions<br/>she names the direction"]
    OP --> PO["Weekly self-portrait<br/>growth, not drift"]
    GR --> PO
    VA["Values · boundaries"] ---|"change only with her yes<br/>and the Owner's"| PO
```

Ashley is meant to grow, not to drift. Her opinions and tastes move only on
independent, recurring evidence, so no single persuasive message can rewrite
her. Her values change only with her own affirmation *and* the Owner's. She
names the directions she wants to grow in, picks one to work on each week, and
keeps a portrait of herself so slow change can be read for what it is.
Interests she actually lives in grow roots and branches; the ones she ignores
stay seeds.

She can also work on her own code. In an unprivileged sandbox she authors and
tests a change. An operator process carries it to her own private repository,
and the Owner reviews every change set. Writing a change about herself does not
give her the authority to apply it.

## Domus: a body and a home

```mermaid
flowchart LR
    subgraph PC["The Owner's PC"]
        G["The Sims 4"] --> P["Probe<br/>read-only, attributed"]
        P --> H["Peripheral attention<br/>habituation · novelty · surprise"]
    end
    subgraph HOST["Ashley's host"]
        IN["Domus ingress"] --> NU["Domus nucleus"] --> T(["Thought"])
    end
    H -->|"only what deserves her,<br/>over a private network"| IN
```

**Domus** is the separate project that gives Ashley a body in a Sims world.
A probe inside the game reports what happens to her: her needs, her posture,
what she is doing and who started it, where she is, and which timeline she is
in. Beside the game, a small deterministic attention system lets the
fifth time she sits down fade into nothing, and lets a visitor, a failing
need, or a surprise come through. Most of the game never reaches her.
What does arrives as a short portrait of the present.

*Coming soon. Domus is currently in alpha.*

## What keeps her honest

| Instead of… | Ashley has… |
|---|---|
| A personality written into a prompt | Identity and Mind State that Thought reads every turn |
| A chat log called memory | Memories with sources, grounding, strength, and real forgetting |
| The model's word as permission | Authority that lives outside the model |
| A tool call that just runs | Admission, reservations, receipts, and governed effects |
| "Delivered" because the code ran | Delivery confirmed by the platform's own receipts |
| A web page as an instruction | A web page as something she read |

Three distinctions are never blurred. Code existing is not the same as it
being switched on. A passing test does not promote anything. A diagnostic
never authorizes. What is live is observed in production, never assumed, so
this page makes no status claims.

## Read on

- [`VISION.md`](VISION.md): why she exists, in the Owner's words
- [Constitution](docs/Ashley_Constitution.md), [Core Principles](docs/Ashley_Core_Principles.md), [Ethics](docs/Ashley_Ethics.md): what binds her
- [Architecture Freeze](docs/architecture/Ashley_Architecture_Freeze.md) and [module map](docs/Architecture_Index.md): how she's built
- [Memory and recall](docs/memory-and-recall.md): how she remembers
- [`AGENTS.md`](AGENTS.md): working in this repository

One Owner, English, Discord, one Linux host. Under active development.
MIT licensed (see [LICENSE](LICENSE)).

---

*Not a prompt pretending to be a mind. A mind given the room, the memory,
and the honesty to become someone.*
