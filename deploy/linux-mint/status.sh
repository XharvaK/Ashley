#!/usr/bin/env bash
# Quick health / unit status for Mint host.
set -euo pipefail

echo "=== systemd ==="
systemctl --user --no-pager status ashley-agent ashley-discord || true
echo ""
echo "=== health ==="
curl -sS http://127.0.0.1:3710/health || echo "(agent not reachable)"
echo ""
