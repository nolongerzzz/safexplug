#!/usr/bin/env bash
# Adds "Safex SOLO-SYNC Wallet" to your applications menu with its icon. Run once, as your normal user (no sudo, no password).
# Works from wherever this folder is. To undo: delete ~/.local/share/applications/safex-wallet.desktop and the safex-wallet.png icons.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
[ -x "$HERE/node_modules/.bin/electron" ] || { echo "Run 'npm install' in $HERE first."; exit 1; }
for s in 48 128 256 512; do
  mkdir -p "$DATA/icons/hicolor/${s}x${s}/apps"
  cp "$HERE/assets/icons/icon-$s.png" "$DATA/icons/hicolor/${s}x${s}/apps/safex-wallet.png"
done
mkdir -p "$DATA/applications"
cat > "$DATA/applications/safex-wallet.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Safex SOLO-SYNC Wallet
Comment=Safex Cash and Token wallet that syncs from your own node
Exec=sh -c 'cd "$HERE" && exec node_modules/.bin/electron . --no-sandbox'
Path=$HERE
Icon=safex-wallet
Terminal=false
Categories=Finance;Utility;
StartupWMClass=safex-wallet
DESK
chmod 644 "$DATA/applications/safex-wallet.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$DATA/icons/hicolor" >/dev/null 2>&1 || true
echo "Done. Open 'Safex SOLO-SYNC Wallet' from your applications menu (you may need to search for it once)."
