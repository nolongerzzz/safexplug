#!/usr/bin/env bash
# One-time setup so Safex Community Miner opens WITH root (full CPU tuning / MSR) from
# its menu entry and at login, with no terminal and no password prompt each time.
# Run as your normal user (not with sudo): it asks for your password once.
set -euo pipefail
ME="${SUDO_USER:-$(id -un)}"
[ "$(id -u)" -ne 0 ] || [ -n "${SAFEX_TEST_ROOT:-}" ] || { echo "Run this as your normal user, not with sudo."; exit 1; }
R="${SAFEX_TEST_ROOT:-}"                       # only set by tests
APP="$(command -v safex-community-miner || true)"
[ -n "$R" ] && APP="${APP:-/usr/bin/safex-community-miner}"
[ -n "$APP" ] || { echo "Install the app first (./build-deb.sh)."; exit 1; }
APP="$(readlink -f "$APP" 2>/dev/null || echo "$APP")"
HOME_DIR="${HOME}"
SUDO="sudo"; [ -n "$R" ] && SUDO=""
BIN="$R/usr/local/bin/safex-miner-root"
USER_BIN="$R/usr/local/bin/safex-miner-launch"
SUDOERS="$R/etc/sudoers.d/safex-miner"
MODS="$R/etc/modules-load.d/msr.conf"
SYSCTL="$R/etc/sysctl.d/99-hugepages.conf"
$SUDO mkdir -p "$(dirname "$BIN")" "$(dirname "$SUDOERS")" "$(dirname "$MODS")" "$(dirname "$SYSCTL")"

# 1. Root-owned wrapper. Takes no arguments, so it can only ever start this one app.
TMP="$(mktemp)"
cat > "$TMP" <<WRAP
#!/bin/bash
# Installed by Safex Community Miner. Starts the miner as root with the user's own settings.
U="\${SUDO_USER:-}"
[ -n "\$U" ] || exit 1
H="\$(getent passwd "\$U" | cut -d: -f6)"
modprobe msr 2>/dev/null || true
exec "$APP" --no-sandbox --disable-gpu --user-data-dir="\$H/.config/Safex Community Miner"
WRAP
$SUDO install -o root -g root -m 0755 "$TMP" "$BIN"

# 2. Passwordless sudo for exactly that wrapper, for you only (screen vars kept so the window opens).
cat > "$TMP" <<SUD
Defaults:$ME env_keep += "DISPLAY XAUTHORITY"
$ME ALL=(root) NOPASSWD: /usr/local/bin/safex-miner-root
SUD
if command -v visudo >/dev/null 2>&1; then visudo -c -f "$TMP" >/dev/null || { echo "sudoers check failed; nothing installed."; exit 1; }; fi
$SUDO install -o root -g root -m 0440 "$TMP" "$SUDOERS"

# 3. Your-side launcher: lets root draw on your screen, then starts the wrapper.
cat > "$TMP" <<LAUNCH
#!/bin/bash
xhost +SI:localuser:root >/dev/null 2>&1 || true
exec sudo -n /usr/local/bin/safex-miner-root
LAUNCH
$SUDO install -o root -g root -m 0755 "$TMP" "$USER_BIN"
rm -f "$TMP"

# 4. Load the msr module at every boot; keep huge pages (idempotent).
echo msr | $SUDO tee "$MODS" >/dev/null
echo "vm.nr_hugepages=1280" | $SUDO tee "$SYSCTL" >/dev/null
[ -n "$R" ] || { $SUDO modprobe msr || true; $SUDO sysctl -w vm.nr_hugepages=1280 >/dev/null || true; }

# 5. Menu entry + login autostart. Any older autostart entry for the app is set aside so two copies don't fight.
APPS="$HOME_DIR/.local/share/applications"; AUTO="$HOME_DIR/.config/autostart"
mkdir -p "$APPS" "$AUTO"
ICON="safex-community-miner"
DESK="[Desktop Entry]
Type=Application
Name=Safex HomeBase Node+Mine (full speed)
Comment=Starts the miner with root so CPU tuning applies
Exec=/usr/local/bin/safex-miner-launch
Icon=$ICON
Terminal=false
Categories=Utility;"
printf '%s\n' "$DESK" > "$APPS/safex-community-miner-root.desktop"
printf '%s\nX-GNOME-Autostart-enabled=true\n' "$DESK" > "$AUTO/safex-community-miner-root.desktop"
for f in "$AUTO"/*.desktop; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in safex-community-miner-root.desktop) continue;; esac
  if grep -qi "safex" "$f" 2>/dev/null; then mv -n "$f" "$f.disabled-by-root-launcher" && echo "Set aside old login entry: $(basename "$f")"; fi
done
echo
echo "Done. Close the miner if it is open, then open 'Safex Community Miner (full speed)' from your menu."
echo "It will also start that way at every login. To undo: sudo rm /usr/local/bin/safex-miner-root /usr/local/bin/safex-miner-launch /etc/sudoers.d/safex-miner and delete the two safex-community-miner-root.desktop files."
