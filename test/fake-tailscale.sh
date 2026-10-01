#!/bin/sh
# Stand-in for `tailscale status --json` (same shape as the real one).
[ "$1" = "status" ] || exit 1
f="${TS_FIXTURE:?}"
cat "$f"
