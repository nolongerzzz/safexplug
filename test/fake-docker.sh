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
  run)
    all="$*"
    case "$all" in
      *" -d "*) echo running > "$D/container"; case "$all" in *"--restricted-rpc"*) echo '["--db-sync-mode","safe","--restricted-rpc"]' > "$D/cmd";; *) echo '["--db-sync-mode","safe"]' > "$D/cmd";; esac; case "$all" in *" -p 17402:17402"*) echo "0.0.0.0:17402" > "$D/portbind";; *) echo "127.0.0.1:17402" > "$D/portbind";; esac; echo "f00dfeedcafe"; exit 0;;
      *"command -v python3"*) [ -f "$D/noscript" ] && exit 1; exit 0;;
      *"test ! -e /from/.INCOMPLETE"*) for v in $(cat "$D/invalid" 2>/dev/null); do case "$all" in *"$v:/from"*) exit 1;; esac; done; exit 0;;
      *"du -sk /data"*) if [ -f "$D/nodata" ]; then echo NO_DATA; elif [ -f "$D/lowspace" ]; then echo "5000000 100000"; else echo "5000000 20000000"; fi; exit 0;;
      *"touch /to/.INCOMPLETE"*) echo "Copied data.mdb: 9035280384 bytes -> 9035280384 bytes"; [ -f "$D/failbackup" ] && exit 1; echo BACKUP_OK; exit 0;;
      *"find /to -mindepth 1 -delete"*) echo "Restored data.mdb: 9035280384 bytes -> 9035280384 bytes"; echo RESTORE_OK; exit 0;;
      *"diagnose-chain-db.py"*) echo "blocks table reports 2,097,365 entries"; echo "PROGRESS 100000/2097365"; echo "=== RESULT ==="; cat "$D/summary" 2>/dev/null || echo "SUMMARY status=OK blocks=2097365 readable=2097365 missing=0 errors=0 first_bad=none"; exit 0;;
    esac
    exit 0;;
  inspect) if [ "$2" = "--format" ]; then [ -f "$D/container" ] || exit 1; cat "$D/cmd" 2>/dev/null || echo '[]'; exit 0; fi; [ -f "$D/container" ] || { echo "Error: No such object: $2" >&2; exit 1; }; echo "[{\"Type\":\"volume\",\"Name\":\"$(cat "$D/mountname" 2>/dev/null || echo safex-node-data)\",\"Source\":\"/var/lib/docker/volumes/x/_data\",\"Destination\":\"/data\"}]"; exit 0;;
  rm) [ "$2" = "safex-node" ] && rm -f "$D/container" "$D/portbind"; exit 0;;
  port) [ -f "$D/portbind" ] && cat "$D/portbind"; exit 0;;
  volume)
    case "$2" in
      inspect) grep -qx "$3" "$D/volumes" 2>/dev/null && { echo "[{}]"; exit 0; }; echo "Error: No such volume: $3" >&2; exit 1;;
      ls) for v in $(cat "$D/volumes" 2>/dev/null); do case "$v" in safex-node-backup*) echo "$v";; esac; done; exit 0;;
      create) echo "$3" >> "$D/volumes"; echo "$3"; exit 0;;
      rm) grep -vx "$4" "$D/volumes" > "$D/volumes.tmp" 2>/dev/null; mv "$D/volumes.tmp" "$D/volumes" 2>/dev/null; exit 0;;
    esac; exit 0;;
  start) echo running > "$D/container"; echo "$2"; exit 0;;
  stop) echo exited > "$D/container"; echo "$4"; exit 0;;
  build) echo "Step 1/9 : FROM ubuntu:22.04"; echo "Step 2/9 : RUN apt-get update"; echo "Successfully tagged safex-node:latest"; touch "$D/image"; exit 0;;
  logs) echo "2026-10-01 Synced 1500000/2097364"; echo "2026-10-01 Synced 1500050/2097364"; exec sleep 300;;
esac
exit 0
