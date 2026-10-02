# Central attention vectors v1

These JSON fixtures specify central arbitration. They do not require peripheral
sensing to make the same decisions from different inputs. All references are
constructed fixtures. Expected results are hand calculated, not core snapshots.

Schema and parameter revision are 1. The harness binds the parameter revision
to the declared numeric contract version; incompatible parameter revisions
require revised vectors. Times use milliseconds supplied by the
caller. Event order is ascending observation time, then event identifier using
Unicode code-unit order. Duplicate observations do not repeat attenuation or
arousal. Older observations do not rewind state. Boundary comparisons use >=.
Normalized salience is clipped to [0,1]; mood and gain limits use the parameter
contract. Refractory begins at selection, which proposes a pass and is not an
execution receipt. Repeated proposals require the existing admission/execution
owner to preserve idempotence. Rollback retains the greatest observed wall time;
budget reconciliation remains the budget owner's decision.

A five-repeat response is (1-0.3)^5 = 0.16807 without recovery. Recovery is
1-(1-response)*exp(-elapsed/recoveryMs). A new strong observation from a different
nucleus restores half the lost response once. This is a structural cross-nucleus
stimulus rule, not an inference about semantic relatedness. Arousal leaks by
exp(-elapsed/leakMs). Compatible pass types coalesce; incompatible work stays
pending. Opportunistic context cannot independently create a wake.

For numeric expected fields, the harness accepts absolute error below 1e-9.
Identifiers, decisions, arrays, reason codes and timestamps compare exactly.
JSON has no NaN or infinity representation; nonfinite caller timestamps/context
and gain values are rejected by the core rather than serialized as observations.
These vectors establish constructed contract evidence, not deployment,
calibration, cross-language parity or production acceptance.
