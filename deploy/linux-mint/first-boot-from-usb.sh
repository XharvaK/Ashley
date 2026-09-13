#!/usr/bin/env bash
# USB first-boot for Mint WHEN deploy scripts are not on the machine yet.
# Avoids Nodesource/GitHub apt GPG issues: uses nvm for Node + official gh .deb or snap.
#
# Usage (from the transfer folder on Mint):
#   sed -i 's/\r$//' first-boot-from-usb.sh
#   bash first-boot-from-usb.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_SLUG="${ASHLEY_REPO:-XharvaK/project-ashley}"
CLONE_DIR="${ASHLEY_HOME:-$HOME/project-ashley}"
HOME_DATA="${HOME}/.composer-assistant"

echo "=== Ashley Mint first-boot (USB) ==="

need_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"
  elif command -v sudo >/dev/null 2>&1; then sudo "$@"
  else echo "Need sudo" >&2; exit 1
  fi
}

need_sudo apt-get update -y
need_sudo apt-get install -y curl ca-certificates gnupg git wget

# --- Node 22 via nvm (no apt GPG repos) ---
export NVM_DIR="${HOME}/.nvm"
if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
  echo "--- install nvm ---"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "${NVM_DIR}/nvm.sh"
nvm install 22
nvm alias default 22
hash -r
echo "Node: $(node -v)  npm: $(npm -v)"

# Put node on PATH for systemd later via symlink into ~/.local/bin
mkdir -p "${HOME}/.local/bin"
NODE_BIN="$(nvm which current)"
NODE_DIR="$(dirname "$NODE_BIN")"
ln -sfn "${NODE_DIR}/node" "${HOME}/.local/bin/node"
ln -sfn "${NODE_DIR}/npm" "${HOME}/.local/bin/npm"
ln -sfn "${NODE_DIR}/npx" "${HOME}/.local/bin/npx"

# --- GitHub CLI without flaky apt keyring when possible ---
if ! command -v gh >/dev/null 2>&1; then
  echo "--- install gh ---"
  if command -v snap >/dev/null 2>&1; then
    need_sudo snap install gh
  else
    # Direct .deb from GitHub releases (amd64)
    ARCH="$(dpkg --print-architecture)"
    TMP="$(mktemp -d)"
    (
      cd "$TMP"
      # Use apt package from GitHub's CDN with keyring in /usr/share/keyrings (Mint-friendly)
      need_sudo mkdir -p -m 755 /usr/share/keyrings
      curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | need_sudo tee /usr/share/keyrings/githubcli-archive-keyring.gpg >/dev/null
      need_sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
      echo "deb [arch=${ARCH} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | need_sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
      if need_sudo apt-get update -y && need_sudo apt-get install -y gh; then
        echo "gh installed via apt"
      else
        echo "apt gh failed; downloading .deb..."
        VER="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+' | head -1)"
        VER_NUM="${VER#v}"
        wget -q "https://github.com/cli/cli/releases/download/${VER}/gh_${VER_NUM}_linux_${ARCH}.deb" -O gh.deb
        need_sudo dpkg -i gh.deb || need_sudo apt-get install -fy
      fi
    )
    rm -rf "$TMP"
  fi
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Run: gh auth login   then re-run this script."
  exit 2
fi

mkdir -p "${HOME_DATA}/conversations"
if [[ -f "${HERE}/.env" ]]; then
  install -m 600 "${HERE}/.env" "${HOME_DATA}/.env"
  echo "Env installed from USB."
elif [[ ! -f "${HOME_DATA}/.env" ]]; then
  echo "No .env in USB folder or ${HOME_DATA}/.env" >&2
  exit 3
fi

if [[ ! -d "${CLONE_DIR}/.git" ]]; then
  gh repo clone "$REPO_SLUG" "$CLONE_DIR"
else
  git -C "$CLONE_DIR" pull --ff-only || true
fi

if [[ ! -e "${HOME}/project-ashley" && "$CLONE_DIR" != "${HOME}/project-ashley" ]]; then
  ln -sfn "$CLONE_DIR" "${HOME}/project-ashley"
fi
# Legacy alias for older docs / muscle memory
if [[ ! -e "${HOME}/composer-assistant" ]]; then
  ln -sfn "$CLONE_DIR" "${HOME}/composer-assistant"
fi

# systemd units call /usr/bin/node — point that at nvm node if missing
if [[ ! -x /usr/bin/node ]]; then
  echo "--- link /usr/bin/node -> nvm node ---"
  need_sudo ln -sfn "${HOME}/.local/bin/node" /usr/bin/node
  need_sudo ln -sfn "${HOME}/.local/bin/npm" /usr/bin/npm
fi

if [[ -f "${CLONE_DIR}/deploy/linux-mint/install.sh" ]]; then
  sed -i 's/\r$//' "${CLONE_DIR}/deploy/linux-mint/"*.sh || true
  bash "${CLONE_DIR}/deploy/linux-mint/install.sh"
elif [[ -f "${HERE}/deploy-linux-mint/install.sh" ]]; then
  echo "WARN: using USB copy of install scripts."
  sed -i 's/\r$//' "${HERE}/deploy-linux-mint/"*.sh || true
  bash "${HERE}/deploy-linux-mint/install.sh"
else
  echo "No install.sh found. Push deploy/linux-mint to GitHub from Windows, then re-run." >&2
  exit 4
fi

echo "Done. bash ${CLONE_DIR}/deploy/linux-mint/status.sh"
