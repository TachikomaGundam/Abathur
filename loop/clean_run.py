#!/usr/bin/env python3
"""clean_run.py <gen> <item> — remove a half-seeded run dir so the item can be re-seeded.

Exists because a seed crash (G63/SR4-69, bank signature defect) leaves
/tmp/abathur-loop-<gen>/<item>/ behind, and seed_item.py refuses to re-seed over an
existing dir. The seat cannot rm it itself: its bash sees a private tmpfs at /tmp.

Fail-closed: judged runs are evidence and are never removed.
"""
import re
import shutil
import sys
import time
from pathlib import Path

GEN_RE = re.compile(r"^G[0-9]+[A-Z]*$")
ITEM_RE = re.compile(r"^SR4-[0-9]+$")
RUN_ROOT = Path("/tmp")


def main() -> int:
    argv = sys.argv[1:]
    if len(argv) != 2:
        print("usage: clean_run.py <gen> <item>", file=sys.stderr)
        return 2
    gen, item = argv
    if not GEN_RE.match(gen) or not ITEM_RE.match(item):
        print(f"REFUSAL: bad gen/item token: {gen!r} {item!r}", file=sys.stderr)
        return 2
    rd = RUN_ROOT / f"abathur-loop-{gen}" / item
    if not rd.exists():
        print(f"nothing to clean: {rd} does not exist")
        return 0
    if not rd.is_dir():
        print(f"REFUSAL: not a directory: {rd}", file=sys.stderr)
        return 2
    verdict = rd / "harness" / "verdict.json"
    if verdict.exists():
        print(f"REFUSAL: judged run is evidence, keep it: {verdict}", file=sys.stderr)
        return 2
    shutil.rmtree(rd)
    print(f"cleaned {rd} at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
