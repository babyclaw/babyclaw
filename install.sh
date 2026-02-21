#!/usr/bin/env bash
set -euo pipefail

BABYCLAW_MIN_NODE=20
BABYCLAW_PKG="babyclaw"

# ── Colors ────────────────────────────────────────────────────────────────────

setup_colors() {
  if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    BOLD='\033[1m'
    DIM='\033[2m'
    MAGENTA='\033[35m'
    GREEN='\033[32m'
    YELLOW='\033[33m'
    RED='\033[31m'
    BLUE='\033[34m'
    RESET='\033[0m'
  else
    BOLD='' DIM='' MAGENTA='' GREEN='' YELLOW='' RED='' BLUE='' RESET=''
  fi
}

info()    { printf "${BLUE}info${RESET}  %s\n" "$1"; }
success() { printf "${GREEN}  ✓${RESET}  %s\n" "$1"; }
warn()    { printf "${YELLOW}warn${RESET}  %s\n" "$1"; }
error()   { printf "${RED}error${RESET} %s\n" "$1" >&2; }

banner() {
  printf "\n"
  printf "${MAGENTA}"
  cat <<'ART'
   ╭─────────────────────────────╮
   │                             │
   │   🦀  babyclaw installer    │
   │                             │
   │   your friendly agent       │
   │   gateway, at your service  │
   │                             │
   ╰─────────────────────────────╯
ART
  printf "${RESET}\n"
}

# ── Helpers ───────────────────────────────────────────────────────────────────

has_cmd() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  local prompt="${1:-Continue?}"
  if [[ ! -t 0 ]]; then
    return 0
  fi
  printf "${BOLD}%s [Y/n]${RESET} " "$prompt"
  read -r answer </dev/tty
  case "${answer:-Y}" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

abort() {
  error "$1"
  exit 1
}

# ── Platform Detection ────────────────────────────────────────────────────────

check_os() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) OS="macos" ;;
    Linux)  OS="linux" ;;
    MINGW*|MSYS*|CYGWIN*)
      abort "Windows is not supported. Please use WSL (Windows Subsystem for Linux) and re-run this script inside it."
      ;;
    *)
      abort "Unsupported operating system: $os"
      ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)
      abort "Unsupported architecture: $arch"
      ;;
  esac

  success "Platform: $OS ($ARCH)"
}

# ── Dependency Checks ────────────────────────────────────────────────────────

check_git() {
  if has_cmd git; then
    success "git found: $(git --version | head -1)"
  else
    warn "git not found — some BabyClaw features (workspaces, skills) require git."
    warn "Install it from https://git-scm.com or via your package manager."
  fi
}

node_version_major() {
  node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

check_node() {
  if has_cmd node; then
    local major
    major="$(node_version_major)"
    if [[ "$major" -ge "$BABYCLAW_MIN_NODE" ]]; then
      success "Node.js $(node --version) found (>= $BABYCLAW_MIN_NODE required)"
      return 0
    else
      warn "Node.js $(node --version) found, but >= $BABYCLAW_MIN_NODE is required."
    fi
  else
    warn "Node.js not found."
  fi

  printf "\n"
  info "BabyClaw needs Node.js >= $BABYCLAW_MIN_NODE."

  if has_cmd nvm; then
    info "nvm detected — installing Node.js $BABYCLAW_MIN_NODE..."
    nvm install "$BABYCLAW_MIN_NODE"
    nvm use "$BABYCLAW_MIN_NODE"
    success "Node.js $(node --version) installed via nvm"
    return 0
  fi

  if has_cmd fnm; then
    info "fnm detected — installing Node.js $BABYCLAW_MIN_NODE..."
    fnm install "$BABYCLAW_MIN_NODE"
    fnm use "$BABYCLAW_MIN_NODE"
    success "Node.js $(node --version) installed via fnm"
    return 0
  fi

  if confirm "No Node.js version manager found. Install Node.js $BABYCLAW_MIN_NODE via nvm?"; then
    info "Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

    export NVM_DIR="${HOME}/.nvm"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

    nvm install "$BABYCLAW_MIN_NODE"
    nvm use "$BABYCLAW_MIN_NODE"
    success "Node.js $(node --version) installed via nvm"
    return 0
  fi

  printf "\n"
  info "Install Node.js manually from one of:"
  info "  https://nodejs.org"
  info "  brew install node     (macOS)"
  info "  https://github.com/nvm-sh/nvm"
  info "  https://github.com/Schniz/fnm"
  abort "Cannot continue without Node.js >= $BABYCLAW_MIN_NODE."
}

check_npm() {
  if has_cmd npm; then
    success "npm $(npm --version) found"
  else
    abort "npm not found. It should come bundled with Node.js — is your Node install healthy?"
  fi
}

# ── Installation ──────────────────────────────────────────────────────────────

install_babyclaw() {
  if has_cmd babyclaw; then
    local current
    current="$(babyclaw --version 2>/dev/null || echo "unknown")"
    warn "babyclaw is already installed (version: $current)."
    if ! confirm "Reinstall / upgrade?"; then
      info "Skipping installation."
      return 0
    fi
  fi

  info "Installing babyclaw globally via npm..."

  if npm install -g "$BABYCLAW_PKG" 2>/dev/null; then
    success "babyclaw installed successfully"
    return 0
  fi

  warn "Global npm install failed (likely a permissions issue)."

  if [[ "$OS" == "linux" ]]; then
    info "Retrying with sudo..."
    if sudo npm install -g "$BABYCLAW_PKG"; then
      success "babyclaw installed successfully (via sudo)"
      return 0
    fi
  fi

  printf "\n"
  error "Could not install babyclaw globally."
  info "Try one of:"
  info "  1. Fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
  info "  2. Use a Node version manager (nvm / fnm) which avoids permission issues"
  info "  3. Run: sudo npm install -g $BABYCLAW_PKG"
  abort "Installation failed."
}

verify_install() {
  if ! has_cmd babyclaw; then
    warn "babyclaw was installed but is not in your PATH."
    local npm_prefix
    npm_prefix="$(npm prefix -g 2>/dev/null)/bin"
    info "Try adding this to your shell profile:"
    info "  export PATH=\"$npm_prefix:\$PATH\""
    abort "Please fix your PATH and re-run this script."
  fi

  success "babyclaw $(babyclaw --version 2>/dev/null || echo "") is ready"
}

# ── Setup & Doctor ────────────────────────────────────────────────────────────

run_setup() {
  printf "\n"
  info "Launching the BabyClaw setup wizard..."
  info "This will configure your AI providers, Telegram bot, and system service."
  printf "\n"

  babyclaw setup
}

run_doctor() {
  printf "\n"
  info "Running diagnostics..."
  printf "\n"

  babyclaw doctor
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  setup_colors
  banner

  info "Checking your environment...\n"

  check_os
  check_git
  check_node
  check_npm

  printf "\n"
  install_babyclaw
  verify_install

  run_setup
  run_doctor

  printf "\n"
  printf "  ${GREEN}${BOLD}Setup complete! 🦀${RESET}\n"
  printf "  ${DIM}Useful commands:${RESET}\n"
  printf "    babyclaw service status   — check if the gateway is running\n"
  printf "    babyclaw config edit      — tweak your configuration\n"
  printf "    babyclaw doctor           — run diagnostics anytime\n"
  printf "\n"
  printf "  ${DIM}Docs: https://babyclaw.org${RESET}\n"
  printf "\n"
}

main "$@"
