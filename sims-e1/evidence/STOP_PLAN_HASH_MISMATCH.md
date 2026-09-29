# Project Ashley Sims E1 BUILD — Stop Report

Date: 2026-09-28 Europe/Istanbul

Terminal status: `SIMS4_E1_BUILD_IMPLEMENTATION: BLOCKED`

Cause: `STOP_PLAN_HASH_MISMATCH`

## Observed facts

- Repository root: `C:\Users\Xharv\Projects\Ashley`
- Branch: `main`
- Starting `HEAD`: `60fec11742486b3d6e0fd8cd33912dd6d10d94c2`
- Starting `HEAD^{tree}`: `123d744a17a248e6310e2fab2abb90610a6a7675`
- Local `origin/main`: `60fec11742486b3d6e0fd8cd33912dd6d10d94c2`
- Remote `refs/heads/main`: `60fec11742486b3d6e0fd8cd33912dd6d10d94c2`
- Tracked worktree changes before this pass: none.
- The checkout contained extensive pre-existing untracked Owner material. It was preserved. The two governing documents were already untracked.
- `PROJECT_ASHLEY_SIMS4_EMBODIMENT_DESIGN_V7_3_2a.md` was read completely.
- `PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md` was read completely.
- Master expected SHA-256: `A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3`
- Master observed SHA-256: `A06C24544F23F3520FD0C1FDA78E375C8A24D12581BFB8D2E7D98EE0E4E178F3`
- Master hash verdict: exact match.
- Plan expected SHA-256 from the Owner execution prompt: `CBF47BF6803FE909F02C0BF2B0F21EBB78E139BDEB3595984F8E313130F683`
- Expected plan digest length: 62 hexadecimal characters.
- Plan observed SHA-256: `CBF47BF6803FE909F02C0BF2B0B0F21EBB78E139BDEB3595984F8E313130F683`
- Observed plan digest length: 64 hexadecimal characters.
- The first divergence is at zero-based character index 26. The observed digest contains the additional pair `B0` before the expected suffix `F21EBB...`.
- Exactly one file named `PROJECT_ASHLEY_SIMS4_EMBODIMENT_E0_E1_IMPLEMENTATION_READY_PLAN_V1_2a.md` exists in the repository inventory.
- Neither the malformed expected digest nor the observed digest is embedded elsewhere in the repository Markdown inventory.
- The plan file is 114,209 bytes, UTF-8 without BOM, with 2,116 LF-only lines.

## Commands and checks run

- `Get-Content` over all 2,520 master lines.
- `Get-Content` over all 2,116 plan lines.
- `Get-FileHash -Algorithm SHA256` for both governing files.
- `git status --short --untracked-files=all`
- `git status --porcelain=v1 --untracked-files=no`
- `git rev-parse --abbrev-ref HEAD`
- `git rev-parse HEAD`
- `git rev-parse 'HEAD^{tree}'`
- `git rev-parse origin/main`
- `git ls-remote origin refs/heads/main`
- `git worktree list --porcelain`
- Repository filename and exact-hash occurrence checks with `rg`.
- Byte-level file metadata and line-ending inspection.

## Exact blocker

The Owner prompt requires both authoritative SHA-256 values to verify exactly before editing. The plan hash does not match. The prompt value is not a syntactically valid SHA-256 digest because it contains only 62 hexadecimal characters. Treating the missing `B0` pair as a transcription error would bypass the explicit canonical-input identity gate. The accepted V1.2a byte identity therefore remains unresolved.

No implementation path can safely continue without the Owner confirming the correct 64-character SHA-256 digest or supplying the exact accepted plan bytes.

## Preserved work

- All pre-existing tracked and untracked Owner work remains untouched.
- No governing document was changed.
- This stop report is the only file created by the pass.
- No product implementation was created.

## Not attempted

- P1 Sims Python DLL inspection was not attempted because authority verification failed first.
- P2 compiler pinning was not attempted.
- P3 tooling acquisition or installation was not attempted.
- No `sims-e1` runtime source, tests, tools, package, or build artifact was created.
- No focused tests or verification scripts were run.
- No game installation, Mods copy, game launch, LAB operation, runtime witness, save manipulation, Mint access, Discord access, networked E1 behavior, or E2 work was attempted.
- No Git staging, commit, push, merge, reset, clean, stash, or branch operation was performed.

## Smallest next fact needed

Owner confirmation of one of the following:

1. The accepted V1.2a SHA-256 is `CBF47BF6803FE909F02C0BF2B0B0F21EBB78E139BDEB3595984F8E313130F683`; or
2. A replacement exact V1.2a file whose SHA-256 equals the intended 64-character accepted digest.

Until then, the canonical plan identity is unresolved and BUILD MUST remain stopped.

## Boundary

- Game launched? NO
- Artifact installed to Mods? NO
- Runtime witness performed? NO
- E2 touched? NO
- Product code committed or pushed? NO

`SIMS4_E1_BUILD_IMPLEMENTATION: BLOCKED`

`STOP_PLAN_HASH_MISMATCH`
