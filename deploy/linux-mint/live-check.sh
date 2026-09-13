#!/usr/bin/env bash
# Per-wave live check on the Mint host: is she up, is her inner life running, and
# is the initiative path answering with a reason instead of erroring.
# Read-only apart from one curiosity tick.
set -uo pipefail

AGENT="http://127.0.0.1:3710"
WAVE="${1:-all}"
fails=0

req() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H 'Content-Type: application/json' -d "$body" "$AGENT$path"
  else
    curl -sS "$AGENT$path"
  fi
}

check() {
  local name="$1" out="$2" needle="$3"
  if printf '%s' "$out" | grep -q "$needle"; then
    echo "  ok   $name"
  else
    echo "  FAIL $name"
    printf '       %s\n' "$(printf '%s' "$out" | head -c 300)"
    fails=$((fails + 1))
  fi
}

owner="$(grep -E '^(MEMORY_OWNER_ID|DISCORD_OWNER_ID)=' "$HOME/.composer-assistant/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"'"'"'\r')"

echo "=== health ==="
health="$(req GET /health)"
check "agent ready" "$health" '"ready":true'
check "mistral configured" "$health" '"configured":true'

if [ "$WAVE" = "all" ] || [ "$WAVE" = "4" ]; then
  echo "=== wave 4: inner life ==="
  status="$(req GET /curiosity/status)"
  check "curiosity enabled" "$status" '"enabled":true'
  tick="$(req POST /curiosity/tick '{}')"
  check "tick runs" "$tick" 'scanned'
  echo "       $tick"
fi

if [ "$WAVE" = "all" ] || [ "$WAVE" = "5" ]; then
  echo "=== wave 5: initiative ==="
  if [ -z "$owner" ]; then
    echo "  FAIL owner id not found in ~/.composer-assistant/.env"
    fails=$((fails + 1))
  else
    evaluated="$(req POST /initiative/evaluate "{\"userId\":\"$owner\"}")"
    check "evaluate answers with a reason" "$evaluated" '"reason"'
    echo "       $evaluated"
    st="$(req GET "/initiative/status?owner_id=$owner")"
    check "daily cap is 8" "$st" '"maxPerDay":8'
    echo "       $st"
  fi
fi

if [ "$WAVE" = "all" ] || [ "$WAVE" = "6" ]; then
  echo "=== wave 6: open-turn texture ==="
  if [ -z "$owner" ]; then
    echo "  FAIL owner id not found in ~/.composer-assistant/.env"
    fails=$((fails + 1))
  else
    open="$(req POST /chat/text "{\"message\":\"what's up\",\"channel\":\"discord\",\"userId\":\"$owner\"}")"
    reply="$(printf '%s' "$open" | sed -n 's/.*"text":"\([^"]*\)".*/\1/p')"
    # A positive present-tense disposition or concrete detail beats a void echo.
    if printf '%s' "$reply" | grep -qiE "^(nothing|not much|just here)([, .!]*)$"; then
      echo "  FAIL open-turn void answer: $reply"
      fails=$((fails + 1))
    else
      echo "  ok   open turn answered with texture: $(printf '%s' "$reply" | head -c 120)"
    fi
  fi
fi

echo ""
if [ "$fails" -gt 0 ]; then
  echo "$fails check(s) failed. Roll this wave back before touching the next one."
  exit 1
fi
echo "All checks passed. Watch a real conversation before starting the next wave."
