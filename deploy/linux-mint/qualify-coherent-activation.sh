#!/usr/bin/env bash
# Physical qualification for coherent user-systemd policy sync using a throwaway
# probe unit. Never touches ashley-agent or ashley-discord.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROBE_NAME="${ASHLEY_SLICE_C_PROBE:-ashley-slice-c-probe.service}"
UNIT_DIR="${ASHLEY_UNIT_DIR:-${HOME}/.config/systemd/user}"
UNIT_SRC="${ASHLEY_UNIT_SRC:-}"
MARKER_OLD="${ASHLEY_SLICE_C_MARKER_OLD:-old}"
MARKER_NEW="${ASHLEY_SLICE_C_MARKER_NEW:-new}"

if [[ "$PROBE_NAME" == "ashley-agent.service" || "$PROBE_NAME" == "ashley-discord.service" ]]; then
  echo "refusing to use production Ashley unit as probe" >&2
  exit 1
fi

cleanup() {
  systemctl --user stop "$PROBE_NAME" 2>/dev/null || true
  rm -f "${UNIT_DIR}/${PROBE_NAME}"
  systemctl --user daemon-reload 2>/dev/null || true
  if [[ "${UNIT_SRC}" == *ashley-slice-c-src.* ]]; then
    rm -rf "$UNIT_SRC"
  fi
}
trap cleanup EXIT

mkdir -p "$UNIT_DIR"
if [[ -z "$UNIT_SRC" ]]; then
  UNIT_SRC="$(mktemp -d "${TMPDIR:-/tmp}/ashley-slice-c-src.XXXXXX")"
fi
mkdir -p "$UNIT_SRC"

write_probe() {
  local marker="$1"
  cat > "${UNIT_SRC}/${PROBE_NAME}" <<EOF
[Unit]
Description=Ashley Slice C coherent-activation probe (not production)
[Service]
Type=simple
ExecStart=/bin/sleep 3600
Restart=no
MemoryMax=32M
WorkingDirectory=%h
Environment=ASHLEY_SLICE_C_MARKER=${marker}
RestartPreventExitStatus=75 78
EOF
}

echo "=== Slice C probe qualification ==="
write_probe "$MARKER_OLD"
install -m 644 "${UNIT_SRC}/${PROBE_NAME}" "${UNIT_DIR}/${PROBE_NAME}"
systemctl --user daemon-reload
systemctl --user start "$PROBE_NAME"
if ! systemctl --user is-active --quiet "$PROBE_NAME"; then
  echo "probe failed to start with old marker" >&2
  exit 1
fi
OLD_ENV="$(systemctl --user show -p Environment --value "$PROBE_NAME")"
if ! printf '%s' "$OLD_ENV" | grep -q "ASHLEY_SLICE_C_MARKER=${MARKER_OLD}"; then
  echo "old marker not loaded: $OLD_ENV" >&2
  exit 1
fi

systemctl --user stop "$PROBE_NAME"
write_probe "$MARKER_NEW"
export ASHLEY_UNIT_SRC="$UNIT_SRC"
export ASHLEY_UNIT_DIR="$UNIT_DIR"
bash "${SCRIPT_DIR}/sync-user-units.sh" "$PROBE_NAME"
systemctl --user daemon-reload

LOADED_ENV="$(systemctl --user show -p Environment --value "$PROBE_NAME")"
FRAGMENT="$(systemctl --user show -p FragmentPath --value "$PROBE_NAME")"
RPES="$(systemctl --user show -p RestartPreventExitStatus --value "$PROBE_NAME")"
if [[ "$FRAGMENT" != "${UNIT_DIR}/${PROBE_NAME}" ]]; then
  echo "probe FragmentPath mismatch: $FRAGMENT" >&2
  exit 1
fi
if ! printf '%s' "$LOADED_ENV" | grep -q "ASHLEY_SLICE_C_MARKER=${MARKER_NEW}"; then
  echo "new marker not loaded before start: $LOADED_ENV" >&2
  exit 1
fi
if ! printf '%s' "$RPES" | grep -q "75"; then
  echo "probe RestartPreventExitStatus not loaded: $RPES" >&2
  exit 1
fi

systemctl --user start "$PROBE_NAME"
if ! systemctl --user is-active --quiet "$PROBE_NAME"; then
  echo "probe failed to start with new marker" >&2
  exit 1
fi
echo "OK. Probe loaded candidate policy without touching production Ashley units."
