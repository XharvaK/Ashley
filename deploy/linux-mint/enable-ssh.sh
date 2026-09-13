#!/usr/bin/env bash
# One-time: enable SSH on Mint and print how Windows can reach you.
set -euo pipefail

need_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else echo "Need sudo" >&2; exit 1
  fi
}

need_sudo apt-get update -y || true
need_sudo apt-get install -y openssh-server
need_sudo systemctl enable --now ssh

USER_NAME="$(whoami)"
HOST_NAME="$(hostname)"
IPS="$(hostname -I 2>/dev/null || true)"

echo ""
echo "=== SSH ready ==="
echo "User: $USER_NAME"
echo "Host: $HOST_NAME"
echo "IPs:  $IPS"
echo ""
echo "From Windows (PowerShell), test:"
echo "  ssh ${USER_NAME}@<IP>"
echo ""
echo "Then remote update:"
echo "  powershell -File scripts\\mint\\remote-update.ps1 -HostName <IP> -User ${USER_NAME}"
echo ""
echo "Lid can stay closed after this — as long as the laptop stays on Wi‑Fi/power."
