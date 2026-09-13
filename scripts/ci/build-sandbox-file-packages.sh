#!/usr/bin/env bash
# Build local file: sandbox packages so agent-service tsc can resolve
# @composer-assistant/sandbox-* types. dist/ is gitignored and those
# packages have no prepare script, so CI must emit declarations first.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
# policy/tree before dependents; m1 has no sandbox file: deps.
packages=(
  sandbox-policy
  sandbox-tree
  sandbox-m1
  sandbox-v2
)

for pkg in "${packages[@]}"; do
  npm ci --prefix "${root}/apps/${pkg}"
  npm run build --prefix "${root}/apps/${pkg}"
done
