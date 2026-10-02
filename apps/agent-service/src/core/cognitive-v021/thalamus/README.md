# Attention parameter contract

The Host controls wake timing. Thought owns semantic meaning. This directory
contains the parameter contract, pure arbiter and durable timing integration.
The service maintenance loop uses it when the scheduler switch is enabled.
Existing ingress, budgets, eligibility, resource fuses and pass executors retain
their authority; disabling the switch restores the legacy scheduler paths.

`parameters.ts` is the numeric inventory for the pure core, nuclei, attention
contract, scheduler handoff and bounded learning. Each entry declares units,
default, learning bounds, source and status. `FIXED` entries cannot learn.
`BOUNDED` entries implement specified learning limits. `PROVISIONAL` entries are
architect defaults, with tuning confined to the learning packet. Bounds are not
permission to alter live resource policies. Budget ratios must use the effective
private-budget policy; this contract contains no spend quota.

The initial threshold is **provisional**, not empirically calibrated. Available
retained successful-pass evidence establishes a wake-rate target, but cannot
reconstruct candidate salience, pressure trajectories or historical holds.
Before release, report the denominator, partial-day coverage, expected pass-rate
delta and which decisions remain unreconstructable. The target tolerance is
20% of the retained baseline. Admissions and successful passes are distinct.
Evidence and candidate-specific calibration belong in the qualification packet,
not copied into this timeless contract.

Owner messages retain their existing ingress path and never enter the arbiter.
Afterglow coverage edges and due commitments are mandatory. The sleep ceiling
is accumulated **work pressure**, with no elapsed-time floor. Mandatory events
bypass learned attenuation, suppression and refractory gates; budget authority
still belongs to the existing policy owner. Ambient response is at most 0.2
after five repetitions without recovery, using alpha 0.3.

Defaults use normalized salience in [0,1]. Nucleus and family gains remain in
[0.5,2]. Mood modulation stays within 15%. Fatigue uses effective policy spend
as a ratio, never a new fixed quota. Sleep work weights are provisional
normalization choices, not semantic judgments about the evidence. Quiet hour
shapes sleep preference; clock time never creates sleep pressure.

Arousal, recovery, dishabituation, refractory durations, work weights and boredom
rise are provisional. The numerical defaults are not transferred from the
peripheral game attention system as if it were the central attention system.
The central contract deliberately records its own source. Future implementation
must use these entries rather than adding undocumented tuning constants.

The pure core accepts immutable state, structural candidates, a supplied time
and context. It returns a decision and a new checkpoint. `fire` is a proposal,
not admission, delivery or completion. Budget-blocked mandatory obligations
remain pending. Producer observation identities distinguish repeats from poll
re-evaluations. Clock rollback never fabricates elapsed recovery. Owner ingress
is prohibited here and retains its existing path. No I/O or clock is used.

The current pure core includes threshold modulation, bounded gains, recovery,
arousal, habituation, cross-nucleus dishabituation, refractory and compatible
coalescing. Golden vectors specify timing and code conformance. Nuclei adapters consume
supplied facts. Current metadata readers, subscription retention, eligible
social admission hooks and the service loop supply those facts. Durable
decisions distinguish proposals from actual admitted-cycle bindings.

Published `attention.wakeWorth` updates nucleus/family gain and coalesce-family
habituation through a bounded EMA. Only an actual admitted cycle bound to a
fire receipt and a matching publication context can learn. One receipt learns
once, including crash recovery. Mandatory obligations still bypass attenuation.
Social profiles offer only `wakeWorth`; their timing-only aftermath cannot
adopt private watches, resting, growth, senses, interests or journal claims.
Private turns see stored sensitivity through the sense projection. Owner-only
`/attention` reads the same values. These values grant no execution authority,
change no budget policy and never promote the provisional threshold.
