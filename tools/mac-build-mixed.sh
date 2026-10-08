#!/bin/bash
# Adds "send SFX and SFT in one transaction" to the wallet tool you built on this Mac.
# Applies tools/safexcore-transfer-mixed.patch to your safexcore source, rebuilds safex-wallet-rpc, and leaves the new
# program next to the old one. Safe to run twice: it checks whether the patch is already in. Nothing is sent or changed in any wallet.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PATCH="$HERE/safexcore-transfer-mixed.patch"
ROOT="${SAFEX_SRC:-$HOME/safexcore-build}"
[ -f "$PATCH" ] || { echo "Patch file not found next to this script: $PATCH"; exit 1; }

# find the source tree (the folder that holds src/wallet/wallet.cpp) and the build folder that has safex-wallet-rpc
SRC=""
for d in "$ROOT" "$ROOT/safexcore" "$ROOT/src-tree" "$HOME/safexcore"; do [ -f "$d/src/wallet/wallet.cpp" ] && { SRC="$d"; break; }; done
[ -z "$SRC" ] && SRC="$(find "$ROOT" -maxdepth 3 -type f -path '*/src/wallet/wallet.cpp' 2>/dev/null | head -1 | sed 's#/src/wallet/wallet.cpp##')"
[ -n "$SRC" ] || { echo "Could not find your safexcore source (a folder with src/wallet/wallet.cpp) under $ROOT."; echo "Run again as:  SAFEX_SRC=/path/to/safexcore $0"; exit 1; }
BUILD=""
for d in "$ROOT/build/b171" "$ROOT/build/release" "$SRC/build"; do [ -f "$d/CMakeCache.txt" ] && { BUILD="$d"; break; }; done
[ -n "$BUILD" ] || { echo "Could not find the build folder (the one with CMakeCache.txt) under $ROOT/build."; exit 1; }
echo "Source: $SRC"; echo "Build:  $BUILD"

cd "$SRC" || exit 1
if grep -q "create_transactions_mixed" src/wallet/wallet.cpp; then
  echo "The patch is already applied."
else
  patch -p1 --dry-run < "$PATCH" >/dev/null || { echo "The patch does not apply cleanly to this source. Nothing was changed."; exit 1; }
  patch -p1 < "$PATCH" || exit 1
fi
cd "$BUILD" || exit 1
cp -p bin/safex-wallet-rpc bin/safex-wallet-rpc.before-mixed 2>/dev/null
echo "Building (this takes a while, the first file is the slowest)..."
make -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 2)" wallet_rpc_server || { echo "Build failed. The old program is kept as bin/safex-wallet-rpc.before-mixed"; exit 1; }
echo
echo "Done. New wallet tool: $BUILD/bin/safex-wallet-rpc"
echo "Now open the wallet app: Help, then Wallet tool options, then the button Update wallet tools. It copies this program in. Unlock your wallet again afterwards."
