#!/usr/bin/env bash
# Full Mint bootstrap: Node 22 + clone (if needed) + systemd Ashley (agent+discord).
# Run AFTER: gh auth login  (private repo)
# Optional: copy ~/.composer-assistant/.env from Windows first (or pass --env-file).
set -euo pipefail

REPO_SLUG="${ASHLEY_REPO:-XharvaK/project-ashley}"
CLONE_DIR="${ASHLEY_HOME:-$HOME/project-ashley}"
HOME_DATA="${HOME}/.composer-assistant"
ENV_FILE="${HOME_DATA}/.env"
ENV_SRC=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_SRC="${2:-}"
      shift 2
      ;;
    --dir)
      CLONE_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: bash bootstrap.sh [--env-file /path/to/.env] [--dir ~/project-ashley]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

echo "=== Ashley Mint bootstrap ==="

need_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Need root/sudo for: $*" >&2
    exit 1
  fi
}

echo "--- apt packages ---"
need_sudo apt-get update -y
need_sudo apt-get install -y curl ca-certificates gnupg git

if ! command -v gh >/dev/null 2>&1; then
  echo "--- install GitHub CLI ---"
  need_sudo mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | need_sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  need_sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | need_sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  need_sudo apt-get update -y
  need_sudo apt-get install -y gh
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)" -lt 20 ]]; then
  echo "--- install Node.js 22 ---"
  curl -fsSL https://deb.nodesource.com/setup_22.x | need_sudo bash -
  need_sudo apt-get install -y nodejs
fi

echo "Node: $(node -v)  npm: $(npm -v)  gh: $(gh --version | head -n1)"

if ! gh auth status >/dev/null 2>&1; then
  echo ""
  echo "GitHub CLI is not logged in. On this Mint laptop run:"
  echo "  gh auth login"
  echo "Choose GitHub.com → HTTPS → Login with browser (or token)."
  echo "Then re-run: bash bootstrap.sh"
  exit 2
fi

mkdir -p "${HOME_DATA}/conversations"

if [[ -n "$ENV_SRC" ]]; then
  if [[ ! -f "$ENV_SRC" ]]; then
    echo "Env file not found: $ENV_SRC" >&2
    exit 1
  fi
  install -m 600 "$ENV_SRC" "$ENV_FILE"
  echo "Installed env → $ENV_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo ""
  echo "Missing $ENV_FILE"
  echo "On Windows run:  powershell -File scripts\\mint\\prepare-mint-transfer.ps1"
  echo "Copy the transfer folder to this laptop (USB), then:"
  echo "  bash bootstrap.sh --env-file /path/to/ashley-mint-transfer/.env"
  exit 3
fi

if [[ ! -d "${CLONE_DIR}/.git" ]]; then
  echo "--- clone ${REPO_SLUG} → ${CLONE_DIR} ---"
  mkdir -p "$(dirname "$CLONE_DIR")"
  gh repo clone "$REPO_SLUG" "$CLONE_DIR"
else
  echo "--- repo exists, pull ---"
  git -C "$CLONE_DIR" pull --ff-only || true
fi

if [[ "$CLONE_DIR" != "${HOME}/project-ashley" && ! -e "${HOME}/project-ashley" ]]; then
  ln -s "$CLONE_DIR" "${HOME}/project-ashley"
  echo "Symlink ~/project-ashley → $CLONE_DIR"
fi
if [[ ! -e "${HOME}/composer-assistant" ]]; then
  ln -s "$CLONE_DIR" "${HOME}/composer-assistant"
  echo "Symlink ~/composer-assistant → $CLONE_DIR (legacy)"
fi

bash "${CLONE_DIR}/deploy/linux-mint/install.sh"

echo ""
echo "Bootstrap complete."
echo "  curl -s http://127.0.0.1:3710/health"
echo "  systemctl --user status ashley-agent ashley-discord"
echo ""
echo "Remember: stop Windows Ashley first (one Discord token)."
