#!/usr/bin/env python3
"""
Read-only health probe for a safexd LMDB blockchain database.

Tries to read the block record at EVERY height in the `blocks` table and
reports which heights are readable, missing, or return an LMDB error.
It never writes to the database (read-only, no lock file).

After a real LMDB error the read session is thrown away and a fresh one is
started, so one corrupt page cannot make every later block look damaged.

Usage:
    python3 diagnose-chain-db.py [/data/lmdb]

Last line of output (for The Safex Node app to parse):
    SUMMARY status=OK|DAMAGED|NODB|UNREADABLE blocks=N readable=R missing=M errors=E first_bad=H|none
"""
import os
import struct
import sys

try:
    import lmdb
except ImportError:  # pragma: no cover - only if the image is missing python3-lmdb
    print("python3-lmdb is not installed in this image.", flush=True)
    print("SUMMARY status=UNREADABLE detail=python3-lmdb_missing", flush=True)
    sys.exit(2)

PATH = sys.argv[1] if len(sys.argv) > 1 else "/data/lmdb"
MAX_RUNS_SHOWN = 15
PROGRESS_EVERY = 100_000


def summary(status, blocks=0, readable=0, missing=0, errors=0, first_bad="none", detail=""):
    line = (
        f"SUMMARY status={status} blocks={blocks} readable={readable} "
        f"missing={missing} errors={errors} first_bad={first_bad}"
    )
    if detail:
        line += " detail=" + detail.replace(" ", "_")
    print(line, flush=True)


# ---- open -----------------------------------------------------------------

if not os.path.exists(os.path.join(PATH, "data.mdb")):
    print(f"No chain database found at {PATH} (no data.mdb).", flush=True)
    summary("NODB")
    sys.exit(0)

try:
    env = lmdb.open(PATH, readonly=True, lock=False, max_dbs=64, readahead=False)
    # Open the handle WITHOUT passing a transaction: a handle opened inside a
    # read transaction stops being valid once that transaction ends, and we
    # deliberately start fresh read sessions after any real LMDB error.
    blocks = env.open_db(b"blocks", create=False, integerkey=True)
    with env.begin() as t0:
        entries = t0.stat(blocks)["entries"]
except Exception as e:
    print(f"Could not open the database: {type(e).__name__}: {e}", flush=True)
    summary("UNREADABLE", detail=f"{type(e).__name__}:{e}")
    sys.exit(2)

print(f"blocks table reports {entries:,} entries (heights 0..{max(entries - 1, 0):,})", flush=True)

# ---- probe every height ---------------------------------------------------

counts = {"ok": 0, "MISSING": 0, "ERROR": 0}
runs = []  # [status, first_height, last_height, detail]
txn = env.begin(db=blocks)

for h in range(entries):
    if h and h % PROGRESS_EVERY == 0:
        print(f"PROGRESS {h}/{entries}", flush=True)

    key = struct.pack("=Q", h)  # native-endian; Linux x86_64 => little-endian
    try:
        val = txn.get(key, db=blocks)
        if val is None:
            status, detail = "MISSING", ""
        elif len(val) == 0:
            status, detail = "ERROR", "empty record"
        else:
            status, detail = "ok", ""
    except Exception as e:  # lmdb.Error subclasses (CorruptedError, PageNotFoundError, ...)
        status, detail = "ERROR", f"{type(e).__name__}: {e}"
        # LMDB flags the whole read session as failed after a real error;
        # start a clean one so later heights are judged on their own.
        try:
            txn.abort()
        except Exception:
            pass
        txn = env.begin(db=blocks)

    counts[status] += 1
    if runs and runs[-1][0] == status and runs[-1][3] == detail and runs[-1][2] == h - 1:
        runs[-1][2] = h
    else:
        runs.append([status, h, h, detail])

try:
    txn.abort()
except Exception:
    pass

# ---- report ---------------------------------------------------------------

print()
print("=== RESULT ===")
print(f"readable: {counts['ok']:,}   missing: {counts['MISSING']:,}   errors: {counts['ERROR']:,}")

bad = [r for r in runs if r[0] != "ok"]
if not bad:
    print("Every block record in the `blocks` table is readable.")
    summary("OK", entries, counts["ok"], counts["MISSING"], counts["ERROR"])
else:
    first_bad = bad[0][1]
    print(
        f"First unreadable height: {first_bad:,}  ({first_bad:,} good blocks before it, "
        f"{entries - first_bad:,} blocks from there to the tip)"
    )
    print(f"Damaged ranges ({len(bad)} total, showing up to {MAX_RUNS_SHOWN}):")
    for status, a, b, detail in bad[:MAX_RUNS_SHOWN]:
        span = f"{a:,}" if a == b else f"{a:,} - {b:,}"
        print(f"  {status:8} heights {span}  {detail}")
    if len(bad) > MAX_RUNS_SHOWN:
        print(f"  ... and {len(bad) - MAX_RUNS_SHOWN} more range(s)")
    summary("DAMAGED", entries, counts["ok"], counts["MISSING"], counts["ERROR"], first_bad)
