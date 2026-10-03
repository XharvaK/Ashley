# Private self-change courier

This operator tool publishes sealed S0 proposals to the Owner-created private `XharvaK/Ashley-self` repository. It never applies changes to live Ashley and never opens a PR. The Owner decides review, cherry-pick, deployment and capability promotion separately.

## Activation prerequisites

The Owner must confirm the repository is private and create a write deploy key scoped only to that repository. A pinned GitHub known-hosts file and the key must be regular files at absolute paths. The key must have no group or other permissions. Do not put credentials in this repository.

Create `~/.composer-assistant/self-change` before enabling the service. Supply its separate `courier.env` with `ASHLEY_SELF_COURIER_ENABLED=true`, `ASHLEY_SELF_COURIER_EXPORT_ROOT` (the trusted sealed export directory), `ASHLEY_SELF_COURIER_PROJECT_ID`, `ASHLEY_SELF_COURIER_KEY_FILE`, and `ASHLEY_SELF_COURIER_KNOWN_HOSTS_FILE`. No default project, key or activation is supplied. The broader Ashley environment file is not loaded.

After Owner authorization, explicitly copy `ashley-self-courier.service` and `.timer` using `sync-user-units.sh` with those two names, reload user systemd, and enable the timer. Default installation and synchronization exclude these units. The timer runs every 15 minutes. Disabled direct invocation creates no files and makes no network requests.

## Evidence and recovery

Each manifest and patch is bounded and validated before network activity. The courier mirrors observed public main by normal fast-forward push, fetches the exact base SHA, checks its full repository tree and ancestry, and runs actual Git apply check and apply. Candidate hooks and filters do not run. All clones and temporary patch files stay within the courier state directory.

The structured private commit retains the authored rationale, declared friction references, M4 export receipt, patch/manifest digests and native tree identifiers. A sanitized candidate tree is provenance; it is not falsely equated with a full repository tree. The actual resulting repository tree is recorded separately. When the sanitized and full base trees match, the candidate tree must match too.

Publication is `self/<changeset-id>` only. An existing branch must match the exact parent, resulting tree and structured message; otherwise publication refuses without overwriting it. Private-main divergence refuses without rewinding. Every witnessed proposal outcome is appended and fsynced to `courier.jsonl` before the next proposal. If publication succeeds but local recording fails, the next run verifies the existing branch and recovers its receipt. Unknown transport outcomes are never reported as success. stdout contains only stable status codes; inspect the private journal for proposal evidence.

The advisory lock excludes overlapping courier runs. No public PR, force push, global Git configuration, live checkout mutation or Ashley mode change occurs. Offline fixture tests qualify source mechanics only; SSH, Linux/systemd isolation and real publication need exact-candidate physical evidence after the Owner prerequisites are met.

## Source verification

`python deploy/linux-mint/self_courier_test.py` uses isolated local actual Git repositories. It does not use production credentials or network. Shell syntax can be checked with `bash -n deploy/linux-mint/self-courier.sh`. These checks do not start the service or timer.
