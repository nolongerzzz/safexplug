#!/bin/bash
# Builds the Safex-patched mining engine on this Mac and installs it into the app.
# The stock xmrig cannot solo mine Safex ("Invalid block template"); Safex's fork can.
# Safe to run more than once. Takes roughly 10-20 minutes the first time.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PATCH="$HERE/tools/xmrig-sfx.patch"
WORK="$HOME/safex-xmrig-build"
[ "$(uname)" = "Darwin" ] || { echo "This script is for Mac only."; exit 1; }
case "$(uname -m)" in arm64) DEST="$HERE/src/resources/mac_m1";; *) DEST="$HERE/src/resources/mac";; esac

echo "1/5 Checking Apple's build tools..."
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "A window opened asking to install Apple's command line tools. Click Install, wait for it to finish, then run this same command again."; exit 1
fi

echo "2/5 Checking Homebrew..."
BREW="$(command -v brew || true)"
[ -z "$BREW" ] && [ -x /opt/homebrew/bin/brew ] && BREW=/opt/homebrew/bin/brew
[ -z "$BREW" ] && [ -x /usr/local/bin/brew ] && BREW=/usr/local/bin/brew
if [ -z "$BREW" ]; then
  echo "Homebrew is not installed. Install it with this one line, then run this same command again:"
  echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi
echo "3/5 Installing build ingredients (cmake, openssl)..."
"$BREW" install cmake openssl@3

echo "4/5 Getting the engine source and applying the Safex patch..."
rm -rf "$WORK"; mkdir -p "$WORK"; cd "$WORK"
if ! curl -fsSL -o src.tgz https://github.com/xmrig/xmrig/archive/refs/tags/v6.26.0.tar.gz || ! tar xzf src.tgz; then
  rm -rf xmrig-6.26.0; git clone --quiet --depth 1 --branch v6.26.0 https://github.com/xmrig/xmrig.git xmrig-6.26.0
fi
cd xmrig-6.26.0
patch -p1 < "$PATCH"

echo "   Building libuv (small, about a minute; Homebrew's copy needs a docs tool old macOS lacks)..."
DEPS="$WORK/deps"; mkdir -p "$DEPS"
cd "$WORK"
rm -rf libuv-1.51.0
if ! curl -fsSL -o uv.tgz https://github.com/libuv/libuv/archive/refs/tags/v1.51.0.tar.gz || ! tar xzf uv.tgz; then
  rm -rf libuv-1.51.0; git clone --quiet --depth 1 --branch v1.51.0 https://github.com/libuv/libuv.git libuv-1.51.0
fi
cmake -S libuv-1.51.0 -B uvbuild -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DLIBUV_BUILD_SHARED=OFF \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_INSTALL_PREFIX="$DEPS" > "$WORK/uv-cmake.log" 2>&1 || { tail -20 "$WORK/uv-cmake.log"; exit 1; }
cmake --build uvbuild -j"$(sysctl -n hw.ncpu)" > "$WORK/uv-make.log" 2>&1 || { tail -30 "$WORK/uv-make.log"; exit 1; }
cmake --install uvbuild > /dev/null 2>&1 || { echo "libuv install failed"; exit 1; }
[ -f "$DEPS/lib/libuv.a" ] || { echo "libuv did not build (no libuv.a in $DEPS/lib)"; exit 1; }
cd "$WORK/xmrig-6.26.0"

echo "5/5 Building (this is the long part)..."
UVP="$DEPS"; SSL="$("$BREW" --prefix openssl@3)"
UVLIB="$UVP/lib/libuv.a"; [ -f "$UVLIB" ] || UVLIB="$UVP/lib/libuv.dylib"
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DWITH_HWLOC=OFF -DWITH_OPENCL=OFF -DWITH_CUDA=OFF -DWITH_NVML=OFF -DWITH_ADL=OFF \
  -DOPENSSL_ROOT_DIR="$SSL" -DUV_INCLUDE_DIR="$UVP/include" -DUV_LIBRARY="$UVLIB" > "$WORK/cmake.log" 2>&1 || { tail -20 "$WORK/cmake.log"; exit 1; }
make -j"$(sysctl -n hw.ncpu)" > "$WORK/make.log" 2>&1 || { tail -30 "$WORK/make.log"; exit 1; }

cp xmrig "$DEST/xmrig" && chmod +x "$DEST/xmrig"
xattr -dr com.apple.quarantine "$DEST/xmrig" 2>/dev/null || true
echo
"$DEST/xmrig" --version | head -2
echo "Done. The Safex-patched engine is installed. Start the app and mine."
