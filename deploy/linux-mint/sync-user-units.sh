#!/usr/bin/env bash
# Copy release-owned Ashley user-systemd units into the installed unit dir.
# Always recopies. cmp is verification, not a skip.
# Does not daemon-reload or start units.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT_SRC="${ASHLEY_UNIT_SRC:-${SCRIPT_DIR}/systemd}"
UNIT_DIR="${ASHLEY_UNIT_DIR:-${HOME}/.config/systemd/user}"

if [[ $# -gt 0 ]]; then
  UNITS=("$@")
else
  UNITS=(ashley-agent.service ashley-discord.service)
fi

mkdir -p "$UNIT_DIR"

for unit in "${UNITS[@]}"; do
  src="${UNIT_SRC}/${unit}"
  dest="${UNIT_DIR}/${unit}"
  if [[ ! -f "$src" ]]; then
    echo "missing candidate unit: $src" >&2
    exit 1
  fi
  install -m 644 "$src" "$dest"
done

for unit in "${UNITS[@]}"; do
  if ! cmp -s "${UNIT_SRC}/${unit}" "${UNIT_DIR}/${unit}"; then
    echo "unit mismatch after copy: $unit" >&2
    exit 1
  fi
done
