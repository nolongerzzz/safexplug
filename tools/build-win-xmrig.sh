#!/bin/bash
# Cross-builds the Safex-patched mining engine for Windows (x64) from a Linux machine.
# Needs: mingw-w64 (apt install mingw-w64), cmake, a Safex xmrig source folder (the Safex fork, 6.26.0 with the SFX patch),
# and the libuv 1.51.0 source folder. Pool mining over TLS is not included (no Windows OpenSSL); solo mining and plain pools work.
#   bash tools/build-win-xmrig.sh /path/to/safex-xmrig /path/to/libuv-v1.51.0
set -e
XM="${1:?path to the Safex xmrig source}"; UV="${2:?path to the libuv 1.51.0 source}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"; W="${WORK:-/tmp/xmwin}"; INC=/usr/x86_64-w64-mingw32/include
command -v x86_64-w64-mingw32-g++-posix >/dev/null || { echo "Install mingw-w64 first: sudo apt install mingw-w64"; exit 1; }
rm -rf "$W"; mkdir -p "$W/shim"; cd "$W"
cat > tc.cmake <<'TC'
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER x86_64-w64-mingw32-gcc-posix)
set(CMAKE_CXX_COMPILER x86_64-w64-mingw32-g++-posix)
set(CMAKE_RC_COMPILER x86_64-w64-mingw32-windres)
set(CMAKE_FIND_ROOT_PATH /usr/x86_64-w64-mingw32)
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
TC
echo "1/3 libuv"; cp -r "$UV" libuv-src
cmake -S libuv-src -B uvbuild -DCMAKE_TOOLCHAIN_FILE="$W/tc.cmake" -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DLIBUV_BUILD_SHARED=OFF -DCMAKE_INSTALL_PREFIX="$W/deps" >uv.log 2>&1
cmake --build uvbuild -j"$(nproc)" >>uv.log 2>&1; cmake --install uvbuild >/dev/null 2>&1
echo "2/3 header case shims (the source says Windows.h, the cross-compiler's headers are lowercase)"
grep -rhoE '#\s*include <[A-Za-z0-9_]+\.h>' "$XM/src" | sed -E 's/.*<(.*)>/\1/' | sort -u | while read h; do
  lc=$(echo "$h" | tr 'A-Z' 'a-z'); [ "$h" != "$lc" ] && [ -f "$INC/$lc" ] && [ ! -f "$INC/$h" ] && echo "#include <$lc>" > "shim/$h" || true; done
echo "3/3 xmrig (a few minutes)"; mkdir xmbuild && cd xmbuild
cmake "$XM" -DCMAKE_TOOLCHAIN_FILE="$W/tc.cmake" -DCMAKE_BUILD_TYPE=Release -DWITH_TLS=OFF -DWITH_HWLOC=OFF -DWITH_OPENCL=OFF -DWITH_CUDA=OFF \
  -DWITH_NVML=OFF -DWITH_ADL=OFF -DWITH_ENV_VARS=OFF -DWITH_DMI=OFF -DUV_INCLUDE_DIR="$W/deps/include" -DUV_LIBRARY="$W/deps/lib/libuv.a" \
  -DCMAKE_C_FLAGS="-I$W/shim" -DCMAKE_CXX_FLAGS="-I$W/shim" -DCMAKE_EXE_LINKER_FLAGS="-static -static-libgcc -static-libstdc++" >../xm.log 2>&1
make -j"$(nproc)" >>../xm.log 2>&1
cp xmrig-notls.exe "$HERE/src/resources/windows/xmrig.exe"; file "$HERE/src/resources/windows/xmrig.exe"
