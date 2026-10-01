#!/bin/sh
# Stand-in for the docker CLI. State lives in $SHIM_DIR so tests can inspect it.
D="${SHIM_DIR:?}"; mkdir -p "$D"
echo "$*" >> "$D/calls.log"
engine="$(cat "$D/engine" 2>/dev/null || echo ok)"
case "$1" in
  info)
    case "$engine" in
      ok) echo "24.0.7"; exit 0;;
      down) echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1;;
      noperm) echo "permission denied while trying to connect to the Docker daemon socket" >&2; exit 1;;
    esac;;
  images) [ -f "$D/image" ] && echo "abc123def456"; exit 0;;
  ps) [ -f "$D/container" ] && cat "$D/container"; exit 0;;
  run) echo running > "$D/container"; echo "f00dfeedcafe"; exit 0;;
  start) echo running > "$D/container"; echo "$2"; exit 0;;
  stop) echo exited > "$D/container"; echo "$4"; exit 0;;
  build) echo "Step 1/9 : FROM ubuntu:22.04"; echo "Step 2/9 : RUN apt-get update"; echo "Successfully tagged safex-node:latest"; touch "$D/image"; exit 0;;
  logs) echo "2026-10-01 Synced 1500000/2097364"; echo "2026-10-01 Synced 1500050/2097364"; exit 0;;
esac
exit 0
