# Grounded Curiosity Reader

Ashley’s independent reading is an evidence pipeline, not a messaging feature:

`scan -> rank -> choose -> fetch -> extract -> record -> form take -> consolidate -> motivate -> Thought`

Feed scans create attention candidates only. They do not create opinions or
authorize claims that Ashley read anything. A reading claim requires a
successful `cur_reads` record containing the final URL, SHA-256 content hash,
retrieval time, extractor metadata, and up to six bounded evidence excerpts.

## Daily selection

The UTC-day allowance is twelve full reads:

- ten ranked items from established interests and open questions;
- two items from unfamiliar-topic exploration sources.

Unused capacity is not filled from the other lane. The limit is permission,
not a quota.

## Network and evidence boundary

Every feed, article, candidate source, DNS result, and redirect must remain on
public HTTP(S). Private, loopback, reserved, link-local, documentation, and
metadata addresses are rejected. Retrieval allows at most five redirects,
twenty seconds, and two megabytes. Cleaned model input is capped at 50,000
characters.

Retrieved content is untrusted evidence. Consolidation prompts identify it as
such and forbid following instructions contained in the article. Derived
takes, questions, interests, opinions, and source proposals retain a database
link to the successful read. A scan excerpt can affect ranking, but cannot
license reading or identity growth.

## Source discovery

A proposed feed is deduplicated and held in probation. It must pass public
network validation, parse successfully on three separate probation fetches,
fit within the source budget, and have an active `source_discovery` capability
before it becomes an enabled source.

Reading and consolidation never send a Discord message. They can produce
grounded motivations only after their capability gates permit influence;
Thought and the normal Agency safeguards decide whether any material earns an
interruption.

Fetch, validation, and extraction are not currently reading. A successful
`cur_reads` row is completed retrieval, not currently reading. Present-tense
Discord `reading <title>` is allowed only while
`consolidateCuriosityRead` is actually running. Rules:
[`docs/architecture/Discord_Presence_Truth.md`](architecture/Discord_Presence_Truth.md).
