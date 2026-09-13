#!/usr/bin/env bash
# Ashley Mint setup — no Nodesource/GitHub apt GPG repos.
# Survives broken third-party apt sources (e.g. Spotify).
#
# Run from ashley-mint-transfer:
#   sed -i 's/\r$//' mint-setup.sh
#   bash mint-setup.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_SLUG="${ASHLEY_REPO:-XharvaK/project-ashley}"
CLONE_DIR="${ASHLEY_HOME:-$HOME/project-ashley}"
HOME_DATA="${HOME}/.composer-assistant"
ENV_SRC="${HERE}/.env"
ENV_DST="${HOME_DATA}/.env"

echo "=== Ashley Mint setup (nvm path) ==="

need_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else echo "Need sudo" >&2; exit 1
  fi
}

echo "--- disable broken third-party apt lists (Spotify etc.) ---"
need_sudo mkdir -p /etc/apt/sources.list.d/disabled-by-ashley
shopt -s nullglob
for f in /etc/apt/sources.list.d/*spotify* \
         /etc/apt/sources.list.d/*Spotify* \
         /etc/apt/sources.list.d/*.list; do
  [[ -f "$f" ]] || continue
  base="$(basename "$f")"
  # Only move known-noisy third parties; keep official mint/ubuntu lists
  case "$base" in
    *spotify*|*Spotify*|*nodesource*|*github-cli*|*vscode*|*google-chrome*|*brave*)
      echo "Disabling apt source: $f"
      need_sudo mv -f "$f" "/etc/apt/sources.list.d/disabled-by-ashley/$base" || true
      ;;
  esac
done
shopt -u nullglob

echo "--- apt: curl git wget (ignore leftover repo noise) ---"
set +e
need_sudo apt-get update -y
APT_UPD=$?
set -e
if [[ "$APT_UPD" -ne 0 ]]; then
  echo "WARN: apt-get update had errors (often a leftover Spotify/Chrome repo)."
  echo "Continuing with package install anyway..."
fi

# Prefer install even if update was partial
need_sudo apt-get install -y curl ca-certificates git wget || \
  need_sudo apt-get install -y --fix-missing curl ca-certificates git wget

echo "--- Node 22 via nvm (no apt Node repo) ---"
export NVM_DIR="${HOME}/.nvm"
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm install 22
nvm use 22
nvm alias default 22

mkdir -p "${HOME}/.local/bin"
NODE_DIR="$(dirname "$(nvm which current)")"
ln -sfn "${NODE_DIR}/node" "${HOME}/.local/bin/node"
ln -sfn "${NODE_DIR}/npm" "${HOME}/.local/bin/npm"
ln -sfn "${NODE_DIR}/npx" "${HOME}/.local/bin/npx"
need_sudo ln -sfn "${HOME}/.local/bin/node" /usr/bin/node
need_sudo ln -sfn "${HOME}/.local/bin/npm" /usr/bin/npm
need_sudo ln -sfn "${HOME}/.local/bin/npx" /usr/bin/npx

echo "Node: $(node -v)  npm: $(npm -v)"

echo "--- GitHub CLI (snap or .deb, not apt repo) ---"
if ! command -v gh >/dev/null 2>&1; then
  if command -v snap >/dev/null 2>&1 && need_sudo snap install gh; then
    echo "gh via snap"
  else
    ARCH="$(dpkg --print-architecture)"
    TMP="$(mktemp -d)"
    VER="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
    VER_NUM="${VER#v}"
    echo "Downloading gh ${VER} ..."
    wget -q "https://github.com/cli/cli/releases/download/${VER}/gh_${VER_NUM}_linux_${ARCH}.deb" -O "${TMP}/gh.deb"
    need_sudo dpkg -i "${TMP}/gh.deb" || need_sudo apt-get install -fy
    rm -rf "$TMP"
  fi
fi
echo "gh: $(gh --version | head -n1)"

if ! gh auth status >/dev/null 2>&1; then
  echo ""
  echo "GitHub not logged in. Run:"
  echo "  gh auth login"
  echo "Then re-run: bash mint-setup.sh"
  exit 2
fi

mkdir -p "${HOME_DATA}/conversations"
if [[ -f "$ENV_SRC" ]]; then
  install -m 600 "$ENV_SRC" "$ENV_DST"
  echo "Env installed -> $ENV_DST"
elif [[ -f "$ENV_DST" ]]; then
  echo "Using existing $ENV_DST"
else
  echo "Missing .env next to this script (and no $ENV_DST)." >&2
  exit 3
fi

if [[ ! -d "${CLONE_DIR}/.git" ]]; then
  echo "--- clone ${REPO_SLUG} ---"
  gh repo clone "$REPO_SLUG" "$CLONE_DIR"
else
  echo "--- pull ---"
  git -C "$CLONE_DIR" pull --ff-only || true
fi
ln -sfn "$CLONE_DIR" "${HOME}/project-ashley"
ln -sfn "$CLONE_DIR" "${HOME}/composer-assistant"

INSTALL="${CLONE_DIR}/deploy/linux-mint/install.sh"
if [[ ! -f "$INSTALL" && -f "${HERE}/deploy-linux-mint/install.sh" ]]; then
  INSTALL="${HERE}/deploy-linux-mint/install.sh"
fi
if [[ ! -f "$INSTALL" ]]; then
  echo "install.sh not found. Check git clone." >&2
  exit 4
fi

sed -i 's/\r$//' "${CLONE_DIR}/deploy/linux-mint/"*.sh 2>/dev/null || true
sed -i 's/\r$//' "${HERE}/deploy-linux-mint/"*.sh 2>/dev/null || true

echo "--- systemd install (agent + discord) ---"
export PATH="${HOME}/.local/bin:${PATH}"
bash "$INSTALL"

echo ""
echo "=== DONE ==="
echo "  bash ~/project-ashley/deploy/linux-mint/status.sh"
echo "  curl -s http://127.0.0.1:3710/health"
echo "Stop Windows Ashley if it is still running (one Discord token)."
echo ""
echo "Note: broken Spotify apt list was moved to /etc/apt/sources.list.d/disabled-by-ashley/"
echo "Re-enable later if you fix its GPG key."
