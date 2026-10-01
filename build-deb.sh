#!/usr/bin/env bash
# Build the Safex Community Miner .deb on this machine, then install it.
# Needs internet. Installs Node.js 20 first if it's missing.
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
npm install --no-audit --no-fund
npx electron-builder --linux deb
DEB="$(ls -1t dist/*.deb | head -n1)"
echo "Built $DEB"
sudo apt-get install -y "./$DEB"
echo "Installed. Open 'Safex Community Miner' from your menu."
