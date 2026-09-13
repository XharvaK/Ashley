#!/usr/bin/env bash
# Lid close: blank/ignore only — no sleep/hibernate/shutdown.
# Run on Mint:  bash ~/project-ashley/deploy/linux-mint/disable-lid-sleep.sh
set -euo pipefail

need_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else echo "Need sudo" >&2; exit 1
  fi
}

echo "=== Disable lid sleep/hibernate (logind) ==="
need_sudo mkdir -p /etc/systemd/logind.conf.d
need_sudo tee /etc/systemd/logind.conf.d/ashley-lid.conf >/dev/null <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
EOF

need_sudo systemctl restart systemd-logind

echo "=== Done (systemd) ==="
echo "Also set Cinnamon GUI (recommended):"
echo "  Menu → System Settings → Power Management"
echo "  On battery / Plugged in → When the lid is closed → Do nothing"
echo ""
echo "Laptop panel usually goes dark when the lid is shut;"
echo "the machine stays awake for Ashley."
echo ""
echo "Verify Ashley still up:"
echo "  bash ~/project-ashley/deploy/linux-mint/status.sh"
