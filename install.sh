#!/usr/bin/env bash
# SOLO-SYNC Node+Mine installer for Linux and Mac.
# Run it from the app folder:   bash install.sh
# It checks for Node.js, installs the app's parts, and (Linux) offers the
# menu entry that starts the miner with full CPU speed. Safe to run again.
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
  # A downloaded folder is quarantined by macOS; clear that so the bundled miner engine can run.
  xattr -dr com.apple.quarantine . 2>/dev/null || true
  chmod +x src/resources/mac/xmrig src/resources/mac_m1/xmrig 2>/dev/null || true
fi

if [ "$OS" = "Linux" ]; then
  say "Menu entry with full CPU speed (recommended)"
  echo "This adds 'SAFEX SOLO-SYNC Node+Mine (full speed)' to your menu and starts it at login."
  echo "It lets the miner use the CPU boost that needs root. You are asked for your password once."
  launcher=0
  read -r -p "Set it up now? [Y/n] " ans || ans=n
  case "${ans:-Y}" in
    n|N) echo "Skipped. You can run it any time:  bash tools/install-root-launcher.sh" ;;
    *)   bash tools/install-root-launcher.sh && launcher=1 ;;
  esac
fi

say "Done"
echo "Start the app with:  npm start"
[ "${launcher:-0}" = 1 ] && echo "or open 'SAFEX SOLO-SYNC Node+Mine (full speed)' from your menu."
echo "Next: README.md, section 'First run'."
