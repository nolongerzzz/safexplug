#!/usr/bin/env bash
# SAFEX SOLO-SYNC Wallet installer for Linux and Mac.
# Run it from the wallet folder:   bash install.sh
# Checks for Node.js, installs the app's parts and (Linux) adds the menu entry. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")"
OS="$(uname -s)"
say() { printf '\n== %s\n' "$*"; }

say "Checking Node.js (version 18 or newer)"
need_node=1
if command -v node >/dev/null 2>&1; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] && need_node=0
fi
if [ "$need_node" = 1 ]; then
  if [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    echo "Node.js is missing or too old. Installing Node.js 20 (asks for your password once)."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "Node.js 18 or newer is needed. Install it from https://nodejs.org (the LTS button), then run this again."
    exit 1
  fi
fi
echo "Node.js $(node -v) is ready."

say "Installing the app's parts (one time, needs internet, a few minutes)"
npm install --no-audit --no-fund

if [ "$OS" = "Darwin" ]; then
  xattr -dr com.apple.quarantine . 2>/dev/null || true
fi

menu=0
if [ "$OS" = "Linux" ]; then
  say "Menu entry"
  bash tools/install-menu-entry.sh && menu=1
fi

say "Done"
echo "Start the wallet with:  npm start"
[ "$menu" = 1 ] && echo "or open 'Safex SOLO-SYNC Wallet' from your menu."
echo "Next: README.md, section 'First run'."
