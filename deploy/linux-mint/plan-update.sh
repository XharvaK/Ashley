#!/usr/bin/env bash
# Ashley Mint impact planner (Surgery A).
#
# Pure and read-only: inspects `BASE..TARGET` with git diff/cat-file/merge-base
# only. Never mutates the worktree, build output, units, or services.
#
# Usage: bash plan-update.sh <BASE_SHA> <TARGET_SHA>
#
# Output: KEY=value lines on stdout (values are single-line; lists are
# space-separated). Keys:
#   MODE=impact_aware | full_fallback
#   FALLBACK_REASON=none | marker_missing | marker_malformed | marker_unknown_commit
#                    | marker_not_ancestor | unknown_path:<path> | root_metadata:<path>
#   BASE=<sha> TARGET=<sha> CHANGED_COUNT=<n>
#   BUILD=<canonical-ordered package dirs, space-separated, possibly empty>
#   NPMCI=<subset of BUILD needing npm ci, possibly empty>
#   STOP=<services to stop before in-place build, possibly empty>
#   RESTART=<services to (re)start after activation, possibly empty>
#
# Build dependency graph (mechanical, from package.json file: deps + src imports):
#   sandbox-policy -> sandbox-v2 -> agent-service
#   sandbox-tree   -> sandbox-v2 -> agent-service
#   sandbox-m1     -> sandbox-v2 -> agent-service
#   sandbox-m1     -> agent-service
#   discord-bot    -> no package dependency (HTTP-coupled only)
# Canonical build order (valid topological order, preserved for subsets):
#   sandbox-policy sandbox-m1 sandbox-tree sandbox-v2 agent-service discord-bot
#
# Classifier evidence notes:
# - file: deps install as directory links (package-lock "link": true), so an
#   upstream dist change never requires downstream npm ci when the downstream
#   package/lock metadata is unchanged.
# - *.test.ts files are never imported by non-test source (verified per package)
#   and discord-bot excludes them from tsconfig; they cannot affect dist/index.js.
# - workspace/prompts/** is read per-request via readFileSync (prompts.ts), so
#   prompt changes need no build and no restart.
# - config/games.json is consumed only by apps/desktop (not deployed).
#   Other config/** JSON is read at runtime via readFileSync; restart of the
#   agent picks it up, no compilation involved.
# - packages/privacy-core has no build script (plain JS main); agent-service
#   consumes it live through the file: link, so only an agent restart applies.
# - spikes/**, apps/desktop/**, apps/observer-exporter/** have no importers in
#   the six deploy packages.
set -euo pipefail

CANONICAL_ORDER="sandbox-policy sandbox-m1 sandbox-tree sandbox-v2 agent-service discord-bot"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"

# Every fallback preserves the current broad behavior exactly: all six
# packages with fresh installs (metadata unprovable), both services stopped
# before the in-place build and restarted after. UNKNOWN != SAFE_TO_SKIP.
# STOP order is discord before agent (ingress fence).
print_fallback() {
  local reason="$1" base="$2" target="$3"
  printf 'MODE=full_fallback\nFALLBACK_REASON=%s\nBASE=%s\nTARGET=%s\nCHANGED_COUNT=unknown\nBUILD=%s\nNPMCI=%s\nSTOP=ashley-discord.service ashley-agent.service\nRESTART=ashley-agent.service ashley-discord.service\n' \
    "$reason" "$base" "$target" "$CANONICAL_ORDER" "$CANONICAL_ORDER"
}

# Reverse build dependents dynamically derived from target package metadata.
reverse_deps() {
  local p="$1"
  local var="REV_${p//-/_}"
  printf '%s' "${!var:-}"
}

is_test_path() {
  case "$1" in
    *.test.ts|*.test.mjs|apps/*/vitest*.config.*|scripts/mint/*.test.mjs|deploy/linux-mint/*.test.mjs) return 0 ;;
    *) return 1 ;;
  esac
}

# classify_path <path>: prints one effect token.
#   pkg:<name> | meta:<name> | testonly | docs | noop | prompts | restart-agent
#   | deployscript | unit-agent | unit-discord | fallback
classify_path() {
  local p="$1"
  if is_test_path "$p"; then
    printf 'testonly'
    return 0
  fi
  case "$p" in
    apps/sandbox-policy/src/*) printf 'pkg:sandbox-policy' ;;
    apps/sandbox-m1/src/*) printf 'pkg:sandbox-m1' ;;
    apps/sandbox-tree/src/*) printf 'pkg:sandbox-tree' ;;
    apps/sandbox-v2/src/*) printf 'pkg:sandbox-v2' ;;
    apps/agent-service/src/*) printf 'pkg:agent-service' ;;
    apps/discord-bot/src/*) printf 'pkg:discord-bot' ;;
    apps/sandbox-policy/package.json|apps/sandbox-policy/package-lock.json|apps/sandbox-policy/tsconfig.json) printf 'meta:sandbox-policy' ;;
    apps/sandbox-m1/package.json|apps/sandbox-m1/package-lock.json|apps/sandbox-m1/tsconfig.json) printf 'meta:sandbox-m1' ;;
    apps/sandbox-tree/package.json|apps/sandbox-tree/package-lock.json|apps/sandbox-tree/tsconfig.json) printf 'meta:sandbox-tree' ;;
    apps/sandbox-v2/package.json|apps/sandbox-v2/package-lock.json|apps/sandbox-v2/tsconfig.json) printf 'meta:sandbox-v2' ;;
    apps/agent-service/package.json|apps/agent-service/package-lock.json|apps/agent-service/tsconfig.json) printf 'meta:agent-service' ;;
    apps/discord-bot/package.json|apps/discord-bot/package-lock.json|apps/discord-bot/tsconfig.json) printf 'meta:discord-bot' ;;
    apps/sandbox-policy/*|apps/sandbox-m1/*|apps/sandbox-tree/*|apps/sandbox-v2/*|apps/agent-service/*|apps/discord-bot/*) printf 'fallback' ;;
    deploy/linux-mint/systemd/ashley-agent.service) printf 'unit-agent' ;;
    deploy/linux-mint/systemd/ashley-discord.service) printf 'unit-discord' ;;
    deploy/*|scripts/*) printf 'deployscript' ;;
    packages/privacy-core/*) printf 'restart-agent' ;;
    config/games.json|config/env.example) printf 'noop' ;;
    config/*) printf 'restart-agent' ;;
    workspace/prompts/*) printf 'prompts' ;;
    workspace/*) printf 'noop' ;;
    docs/*|*.md|*.mdx|VISION.md|AGENTS.md) printf 'docs' ;;
    .github/*) printf 'noop' ;;
    apps/observer-exporter/*|apps/desktop/*|spikes/*) printf 'noop' ;;
    package.json|package-lock.json|tsconfig.json|tsconfig.base.json|.npmrc|.nvmrc) printf 'fallback' ;;
    *) printf 'fallback' ;;
  esac
  return 0
}

contains() {
  local list="$1" item="$2" x
  for x in $list; do
    if [[ "$x" == "$item" ]]; then return 0; fi
  done
  return 1
}

main() {
  if [[ $# -ne 2 ]]; then
    echo "usage: plan-update.sh <BASE_SHA> <TARGET_SHA>" >&2
    exit 2
  fi
  local base="$1" target="$2"

  # Marker/base validity gates. UNKNOWN != SAFE_TO_SKIP.
  if [[ -z "$base" ]]; then
    print_fallback marker_missing "$base" "$target"
    return 0
  fi
  if [[ ! "$base" =~ ^[0-9a-f]{40}$ ]]; then
    print_fallback marker_malformed "$base" "$target"
    return 0
  fi
  if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    print_fallback marker_unknown_commit "$base" "$target"
    return 0
  fi
  if ! git merge-base --is-ancestor "$base" "$target" 2>/dev/null; then
    print_fallback marker_not_ancestor "$base" "$target"
    return 0
  fi

  local seeds="" meta_pkgs="" need_agent_restart=0 need_discord_restart=0
  local fallback_reason="" changed_count=0
  local line rest p2 eff

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    changed_count=$((changed_count + 1))
    rest="${line#*$'\t'}"
    # Split tab-separated fields (renames carry old + new paths).
    local OLD_IFS="$IFS"
    IFS=$'\t'
    # shellcheck disable=SC2206
    local fields=($rest)
    IFS="$OLD_IFS"
    for p2 in "${fields[@]}"; do
      eff="$(classify_path "$p2")"
      case "$eff" in
        pkg:*)
          seeds="$seeds ${eff#pkg:}" ;;
        meta:*)
          seeds="$seeds ${eff#meta:}"
          meta_pkgs="$meta_pkgs ${eff#meta:}" ;;
        unit-agent)
          need_agent_restart=1 ;;
        unit-discord)
          need_discord_restart=1 ;;
        restart-agent)
          need_agent_restart=1 ;;
        testonly|docs|noop|prompts|deployscript)
          : ;;
        fallback)
          fallback_reason="unknown_path:$p2"
          if [[ "$p2" == "package.json" || "$p2" == "package-lock.json" || "$p2" == tsconfig* || "$p2" == .npmrc ]]; then
            fallback_reason="root_metadata:$p2"
          fi
          ;;
      esac
    done
    if [[ -n "$fallback_reason" ]]; then
      break
    fi
  done < <(git diff --name-status -M "$base" "$target" -- || true)

  if [[ -n "$fallback_reason" ]]; then
    print_fallback "$fallback_reason" "$base" "$target"
    return 0
  fi

  # Dynamically derive reverse dependencies and mechanically audit metadata completeness.
  local graph_out graph_status=0
  graph_out="$("$NODE_BIN" "${SCRIPT_DIR}/derive-graph.mjs" "$ROOT" 2>&1)" || graph_status=$?
  if [[ "$graph_status" -ne 0 ]]; then
    local reason
    reason="$(printf '%s\n' "$graph_out" | grep '^FALLBACK_REASON=' | head -n1 | cut -d= -f2-)"
    if [[ -z "$reason" ]]; then
      reason="graph_derivation_failed:$(printf '%s\n' "$graph_out" | head -n1)"
    fi
    print_fallback "$reason" "$base" "$target"
    return 0
  fi
  eval "$graph_out"

  # Transitive build closure over reverse dependents.
  local closure="$seeds" prev="" dep r
  while [[ "$closure" != "$prev" ]]; do
    prev="$closure"
    for dep in $closure; do
      for r in $(reverse_deps "$dep"); do
        if ! contains "$closure" "$r"; then
          closure="$closure $r"
        fi
      done
    done
  done

  # Canonical order for the subset.
  local build="" c
  for c in $CANONICAL_ORDER; do
    if contains "$closure" "$c"; then
      build="$build $c"
    fi
  done
  build="${build# }"

  local npmci="" m
  for m in $meta_pkgs; do
    if contains "$build" "$m" && ! contains "$npmci" "$m"; then
      npmci="$npmci $m"
    fi
  done
  npmci="${npmci# }"

  local agent_in_closure=0 discord_in_closure=0
  for c in $build; do
    case "$c" in
      agent-service|sandbox-policy|sandbox-m1|sandbox-tree|sandbox-v2) agent_in_closure=1 ;;
      discord-bot) discord_in_closure=1 ;;
    esac
  done
  if [[ "$agent_in_closure" == "1" ]]; then need_agent_restart=1; fi
  if [[ "$discord_in_closure" == "1" ]]; then need_discord_restart=1; fi

  local stop="" restart=""
  if [[ "$need_agent_restart" == "1" ]]; then
    # Whenever agent restart is required, ashley-discord.service acts as the ingress fence.
    # STOP order: discord before agent.
    # RESTART order: agent before discord.
    stop="ashley-discord.service ashley-agent.service"
    restart="ashley-agent.service ashley-discord.service"
  elif [[ "$need_discord_restart" == "1" ]]; then
    # Discord-only change leaves agent live.
    if [[ "$discord_in_closure" == "1" ]]; then
      stop="ashley-discord.service"
    fi
    restart="ashley-discord.service"
  fi

  printf 'MODE=impact_aware\nFALLBACK_REASON=none\nBASE=%s\nTARGET=%s\nCHANGED_COUNT=%s\nBUILD=%s\nNPMCI=%s\nSTOP=%s\nRESTART=%s\n' \
    "$base" "$target" "$changed_count" "$build" "$npmci" "$stop" "$restart"
}

main "$@"
