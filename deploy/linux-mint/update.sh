#!/usr/bin/env bash
# Activate the current checkout as one coherent release (Surgery A: impact-aware).
#
# Pipeline:
#   pin target SHA/tree -> exact-candidate check -> tracked-clean check
#   -> resolve last-activated SHA marker -> classify A..B -> print plan
#   -> stop affected services -> npm ci (only where metadata requires it)
#   -> build required packages (canonical order) -> verify outputs
#   -> sync supervisor policy -> daemon-reload -> verify loaded units
#   -> start affected services -> ensure BOTH services active -> health
#   -> end identity checks -> atomically advance activation marker.
#
# Does not fetch or merge. Checkout belongs to the SSH wrapper / operator.
# Unknown change classification falls back to the historical broad behavior
# (all six packages, both services). UNKNOWN != SAFE_TO_SKIP.
#
# Activation marker (~/.composer-assistant/deploy/activated-sha, override via
# ASHLEY_ACTIVATED_SHA_FILE) records the most recent candidate that completed
# ALL build/activation/service/health/truth gates. It advances only on total
# success, so an interrupted deploy reruns the same A..B closure on retry.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
UNIT_SRC="${ASHLEY_UNIT_SRC:-${SCRIPT_DIR}/systemd}"
UNIT_DIR="${ASHLEY_UNIT_DIR:-${HOME}/.config/systemd/user}"
ACTIVATED_SHA_FILE="${ASHLEY_ACTIVATED_SHA_FILE:-${HOME}/.composer-assistant/deploy/activated-sha}"
AGENT_HEALTH_URL="${ASHLEY_HEALTH_URL:-http://127.0.0.1:3710/health}"
AGENT_HEALTH_ATTEMPTS="${AGENT_HEALTH_ATTEMPTS:-30}"
AGENT_HEALTH_INTERVAL_SECONDS="${AGENT_HEALTH_INTERVAL_SECONDS:-1}"
SYSTEMCTL=(systemctl --user)

# Canonical package order (valid topological order; subsets keep relative order).
CANONICAL_ORDER="sandbox-policy sandbox-m1 sandbox-tree sandbox-v2 agent-service discord-bot"

ms_now() {
  date +%s%3N
}

timing() {
  printf 'TIMING %s\n' "$1"
}

maybe_fail() {
  if [[ "${ASHLEY_FAIL_AT:-}" == "$1" ]]; then
    echo "injected_failure:$1" >&2
    exit 1
  fi
}

sys() {
  "${SYSTEMCTL[@]}" "$@"
}

unit_field() {
  local file="$1" key="$2"
  awk -F= -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1); exit }' "$file"
}

expand_working_directory() {
  local wd="$1"
  wd="${wd//%h/${HOME}}"
  printf '%s' "$wd"
}

memory_to_bytes() {
  local spec="$1"
  case "$spec" in
    *[Kk]) printf '%s' "$(( ${spec%[Kk]} * 1024 ))" ;;
    *[Mm]) printf '%s' "$(( ${spec%[Mm]} * 1024 * 1024 ))" ;;
    *[Gg]) printf '%s' "$(( ${spec%[Gg]} * 1024 * 1024 * 1024 ))" ;;
    *) printf '%s' "${spec%%.*}" ;;
  esac
}

normalize_ws() {
  tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//'
}

assert_inactive() {
  local unit="$1"
  local state
  state="$(sys is-active "$unit" 2>/dev/null || true)"
  if [[ "$state" == "active" ]]; then
    echo "$unit still active after stop" >&2
    exit 1
  fi
}

assert_active() {
  local unit="$1"
  local state
  state="$(sys is-active "$unit" 2>/dev/null || true)"
  if [[ "$state" != "active" ]]; then
    echo "$unit not active" >&2
    exit 1
  fi
}

verify_loaded_unit() {
  local name="$1"
  local src="${UNIT_SRC}/${name}"
  local installed="${UNIT_DIR}/${name}"
  local fragment rpes mem wd
  local expected_rpes expected_mem expected_wd loaded_mem

  fragment="$(sys show -p FragmentPath --value "$name")"
  rpes="$(sys show -p RestartPreventExitStatus --value "$name" | normalize_ws)"
  mem="$(sys show -p MemoryMax --value "$name")"
  wd="$(sys show -p WorkingDirectory --value "$name")"

  if [[ "$fragment" != "$installed" ]]; then
    echo "loaded FragmentPath mismatch for $name: $fragment != $installed" >&2
    exit 1
  fi

  expected_rpes="$(unit_field "$src" RestartPreventExitStatus | normalize_ws)"
  expected_wd="$(expand_working_directory "$(unit_field "$src" WorkingDirectory)")"
  expected_mem="$(memory_to_bytes "$(unit_field "$src" MemoryMax)")"
  loaded_mem="$(memory_to_bytes "$mem")"

  if [[ "$rpes" != "$expected_rpes" ]]; then
    echo "loaded RestartPreventExitStatus mismatch for $name: $rpes != $expected_rpes" >&2
    exit 1
  fi
  if [[ "$wd" != "$expected_wd" ]]; then
    echo "loaded WorkingDirectory mismatch for $name: $wd != $expected_wd" >&2
    exit 1
  fi
  if [[ "$loaded_mem" != "$expected_mem" ]]; then
    echo "loaded MemoryMax mismatch for $name: $mem ($loaded_mem) != $expected_mem" >&2
    exit 1
  fi
}

wait_agent_ready() {
  local i out
  for i in $(seq 1 "$AGENT_HEALTH_ATTEMPTS"); do
    out="$(curl -sf "$AGENT_HEALTH_URL" 2>/dev/null || true)"
    if printf '%s' "$out" | grep -q '"ready":true'; then
      printf '%s\n' "$out"
      return 0
    fi
    sleep "$AGENT_HEALTH_INTERVAL_SECONDS"
  done
  echo "agent health not ready: $AGENT_HEALTH_URL" >&2
  exit 1
}

# Authoritative production build output per package (package.json main + tsconfig outDir).
pkg_output() {
  case "$1" in
    sandbox-m1) printf 'apps/sandbox-m1/dist/sandbox-m1.js' ;;
    *) printf 'apps/%s/dist/index.js' "$1" ;;
  esac
}

plan_val() {
  local file="$1" key="$2"
  grep "^${key}=" "$file" | head -n1 | cut -d= -f2-
}

in_list() {
  local list="$1" item="$2" x
  for x in $list; do
    if [[ "$x" == "$item" ]]; then return 0; fi
  done
  return 1
}

echo "=== Ashley Mint coherent activation ==="
cd "$ROOT"
T_DEPLOY_START="$(ms_now)"
trap 'rm -f "${PLAN_FILE:-}" "${MARKER_TMP:-}"' EXIT

T_PREP_START="$(ms_now)"
CHECKOUT_SHA="$(git rev-parse HEAD)"
if [[ -z "$CHECKOUT_SHA" ]]; then
  echo "empty checkout SHA" >&2
  exit 1
fi
TARGET_SHA="$CHECKOUT_SHA"
TARGET_TREE="$(git rev-parse 'HEAD^{tree}')"
if [[ -z "$TARGET_TREE" ]]; then
  echo "empty checkout tree" >&2
  exit 1
fi
echo "CHECKOUT_SHA=${CHECKOUT_SHA}"
echo "TARGET_SHA=${TARGET_SHA}"
echo "TARGET_TREE=${TARGET_TREE}"

# Exact-candidate truth: the Windows wrapper embeds the intended candidate.
# Never activate a different remote commit merely because pull fetched it.
if [[ -n "${ASHLEY_EXPECTED_SHA:-}" && "${ASHLEY_EXPECTED_SHA}" != "$TARGET_SHA" ]]; then
  echo "expected SHA mismatch: ASHLEY_EXPECTED_SHA=${ASHLEY_EXPECTED_SHA} != TARGET_SHA=${TARGET_SHA}" >&2
  echo "push the intended candidate first, then rerun the canonical path." >&2
  exit 1
fi
if [[ -n "${ASHLEY_EXPECTED_TREE:-}" && "${ASHLEY_EXPECTED_TREE}" != "$TARGET_TREE" ]]; then
  echo "expected tree mismatch: ASHLEY_EXPECTED_TREE=${ASHLEY_EXPECTED_TREE} != TARGET_TREE=${TARGET_TREE}" >&2
  exit 1
fi

# Tracked worktree must be clean (untracked production noise is ignored).
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "tracked worktree dirty; refusing to activate an indeterminate candidate" >&2
  git status --porcelain --untracked-files=no >&2
  exit 1
fi

# Last successfully activated SHA. Never derived from HEAD..HEAD: after an
# interrupted deploy the worktree is already at TARGET with partial dist, and
# HEAD..HEAD would wrongly report no changes.
BASE_SHA=""
if [[ -f "$ACTIVATED_SHA_FILE" ]]; then
  BASE_SHA="$(head -n1 "$ACTIVATED_SHA_FILE" | tr -d '[:space:]')"
fi
echo "ACTIVATED_SHA=${BASE_SHA:-<none>}"
timing "prep_ms=$(( $(ms_now) - T_PREP_START ))"

T_PLAN_START="$(ms_now)"
PLAN_FILE="$(mktemp)"
bash "${SCRIPT_DIR}/plan-update.sh" "$BASE_SHA" "$TARGET_SHA" > "$PLAN_FILE"
MODE="$(plan_val "$PLAN_FILE" MODE)"
FALLBACK_REASON="$(plan_val "$PLAN_FILE" FALLBACK_REASON)"
PLAN_BASE="$(plan_val "$PLAN_FILE" BASE)"
PLAN_TARGET="$(plan_val "$PLAN_FILE" TARGET)"
CHANGED_COUNT="$(plan_val "$PLAN_FILE" CHANGED_COUNT)"
BUILD_PKGS="$(plan_val "$PLAN_FILE" BUILD)"
NPMCI_PKGS="$(plan_val "$PLAN_FILE" NPMCI)"
STOP_SERVICES="$(plan_val "$PLAN_FILE" STOP)"
RESTART_SERVICES="$(plan_val "$PLAN_FILE" RESTART)"
if [[ "$PLAN_TARGET" != "$TARGET_SHA" ]]; then
  echo "planner target drift: $PLAN_TARGET != $TARGET_SHA" >&2
  exit 1
fi
# A package with no installed node_modules cannot compile: install it even
# when its lock metadata is unchanged (fresh checkout safety).
for pkg in $BUILD_PKGS; do
  if [[ ! -d "${ROOT}/apps/${pkg}/node_modules" ]] && ! in_list "$NPMCI_PKGS" "$pkg"; then
    NPMCI_PKGS="$NPMCI_PKGS $pkg"
    NPMCI_PKGS="${NPMCI_PKGS# }"
  fi
done
timing "classification_ms=$(( $(ms_now) - T_PLAN_START ))"

echo "=== Ashley deployment plan ==="
echo "base: ${PLAN_BASE:-<none>}"
echo "target: $TARGET_SHA"
echo "mode: $MODE"
if [[ "$MODE" == "full_fallback" ]]; then
  echo "fallback reason: $FALLBACK_REASON"
fi
echo "changed paths: $CHANGED_COUNT"
if [[ -n "${PLAN_BASE:-}" && "$PLAN_BASE" != "$TARGET_SHA" ]]; then
  git diff --name-only "$PLAN_BASE" "$TARGET_SHA" -- | sed 's/^/  /' || true
fi
echo "npm ci: ${NPMCI_PKGS:-<none>}"
echo "build: ${BUILD_PKGS:-<none>}"
echo "stop: ${STOP_SERVICES:-<none>}"
echo "leave running: $(comm -23 <(printf 'ashley-agent.service\nashley-discord.service\n' | sort) <(printf '%s\n' $STOP_SERVICES | sort) | tr '\n' ' ' || true)"
echo "restart: ${RESTART_SERVICES:-<none>}"
echo "============================="

maybe_fail stop
T_STOP_START="$(ms_now)"
if [[ -n "$STOP_SERVICES" ]]; then
  for unit in $STOP_SERVICES; do
    sys stop "$unit"
    assert_inactive "$unit"
  done
  timing "stop_ms=$(( $(ms_now) - T_STOP_START ))"
else
  timing "stop=skipped"
fi

maybe_fail build
for pkg in $CANONICAL_ORDER; do
  if ! in_list "$BUILD_PKGS" "$pkg"; then
    timing "$pkg build=skipped"
    continue
  fi
  if in_list "$NPMCI_PKGS" "$pkg"; then
    T_CI_START="$(ms_now)"
    npm ci --prefix "${ROOT}/apps/${pkg}"
    timing "$pkg npm_ci_ms=$(( $(ms_now) - T_CI_START ))"
  else
    timing "$pkg npm_ci=skipped"
  fi
  T_BUILD_START="$(ms_now)"
  npm run build --prefix "${ROOT}/apps/${pkg}"
  timing "$pkg build_ms=$(( $(ms_now) - T_BUILD_START ))"
  out="$(pkg_output "$pkg")"
  if [[ ! -s "${ROOT}/${out}" ]]; then
    echo "missing runtime artifact: $out" >&2
    exit 1
  fi
done

T_SYNC_START="$(ms_now)"
maybe_fail sync
export ASHLEY_UNIT_SRC="$UNIT_SRC"
export ASHLEY_UNIT_DIR="$UNIT_DIR"
bash "${SCRIPT_DIR}/sync-user-units.sh"
timing "unit_sync_ms=$(( $(ms_now) - T_SYNC_START ))"

T_RELOAD_START="$(ms_now)"
maybe_fail reload
sys daemon-reload
timing "daemon_reload_ms=$(( $(ms_now) - T_RELOAD_START ))"

maybe_fail policy
verify_loaded_unit ashley-agent.service
verify_loaded_unit ashley-discord.service

# (Re)start affected services in dependency order.
# When agent restart is required, Discord was stopped as an ingress fence:
# agent starts, satisfies the ready-health gate, and only then Discord starts.
T_START_START="$(ms_now)"
if in_list "$RESTART_SERVICES" "ashley-agent.service"; then
  maybe_fail start-agent
  T_ONE_START="$(ms_now)"
  if sys is-active --quiet "ashley-agent.service"; then
    sys restart "ashley-agent.service"
  else
    sys start "ashley-agent.service"
  fi
  assert_active "ashley-agent.service"
  timing "ashley-agent.service start_ms=$(( $(ms_now) - T_ONE_START ))"

  # Ingress fence: agent must be fully ready before discord starts.
  T_HEALTH_START="$(ms_now)"
  maybe_fail health
  wait_agent_ready >/dev/null
  timing "agent_health_ms=$(( $(ms_now) - T_HEALTH_START ))"
else
  timing "ashley-agent.service restart=skipped"
fi

if in_list "$RESTART_SERVICES" "ashley-discord.service"; then
  maybe_fail start-discord
  T_ONE_START="$(ms_now)"
  if sys is-active --quiet "ashley-discord.service"; then
    sys restart "ashley-discord.service"
  else
    sys start "ashley-discord.service"
  fi
  assert_active "ashley-discord.service"
  timing "ashley-discord.service start_ms=$(( $(ms_now) - T_ONE_START ))"
else
  timing "ashley-discord.service restart=skipped"
fi
timing "start_phase_ms=$(( $(ms_now) - T_START_START ))"

# Final production health is global: an unaffected service that is
# unexpectedly inactive is started and verified, never silently ignored.
for unit in ashley-agent.service ashley-discord.service; do
  if ! sys is-active --quiet "$unit"; then
    echo "$unit inactive after activation; starting" >&2
    sys start "$unit"
    assert_active "$unit"
  fi
done

if ! in_list "$RESTART_SERVICES" "ashley-agent.service"; then
  T_HEALTH_START="$(ms_now)"
  maybe_fail health
  wait_agent_ready >/dev/null
  timing "agent_health_ms=$(( $(ms_now) - T_HEALTH_START ))"
fi

END_SHA="$(git rev-parse HEAD)"
if [[ "$END_SHA" != "$CHECKOUT_SHA" ]]; then
  echo "checkout SHA changed during activation: $END_SHA != $CHECKOUT_SHA" >&2
  exit 1
fi
END_TREE="$(git rev-parse 'HEAD^{tree}')"
if [[ "$END_TREE" != "$TARGET_TREE" ]]; then
  echo "checkout tree changed during activation: $END_TREE != $TARGET_TREE" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "tracked worktree dirty after activation; refusing to record success" >&2
  exit 1
fi

# All gates passed: atomically record this candidate as last-activated.
# Same-directory temp file + rename is atomic on one filesystem.
mkdir -p "$(dirname "$ACTIVATED_SHA_FILE")"
MARKER_TMP="$(mktemp "$(dirname "$ACTIVATED_SHA_FILE")/.activated-sha.XXXXXX")"
printf '%s\n' "$TARGET_SHA" > "$MARKER_TMP"
mv -f "$MARKER_TMP" "$ACTIVATED_SHA_FILE"

timing "total_ms=$(( $(ms_now) - T_DEPLOY_START ))"
rm -f "$PLAN_FILE"
echo "OK. Activated checkout ${CHECKOUT_SHA}"
curl -s "$AGENT_HEALTH_URL" || true
echo ""
sys --no-pager status ashley-agent.service ashley-discord.service || true
