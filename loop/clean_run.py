#!/usr/bin/env python3
"""clean_run.py — reclaim /tmp run dirs, fail-closed on evidence.

Two modes:
  clean_run.py <gen> <item>    remove a half-seeded run dir so the item can be re-seeded.
      Exists because a seed crash (G63/SR4-69, bank signature defect) leaves
      /tmp/abathur-loop-<gen>/<item>/ behind, and seed_item.py refuses to re-seed
      over an existing dir. The seat cannot rm it itself: its bash sees a private
      tmpfs at /tmp. A judged run is never removed here.
  clean_run.py reclaim <gen>   working-principle-1 reclamation (2026-11-02): after
      harvest, sweep copies the evidence into .omo/evidence/loop-archive/<gen>/ and
      writes ARCHIVE-MANIFEST.json. Until this mode existed the /tmp copy then sat
      forever on tmpfs (measured 8.0G across G61-G80 — RAM), violating "reclaim
      temporary resources promptly". Reclaim deletes the run dir ONLY when the
      archive manifest exists, lists at least one file, and every listed file is
      present in the archive with a matching sha256 — otherwise REFUSE (rc 2).
      Archive root honours ABATHUR_ARCHIVE_ROOT for contract tests.
"""
import hashlib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

GEN_RE = re.compile(r"^G[0-9]+[A-Z]*$")
ITEM_RE = re.compile(r"^SR4-[0-9]+$")
RUN_ROOT = Path(os.environ.get("ABATHUR_RUN_ROOT", "/tmp"))
ARCHIVE_ROOT = Path(os.environ.get(
    "ABATHUR_ARCHIVE_ROOT",
    str(Path(__file__).resolve().parent.parent / ".omo/evidence/loop-archive")))


def _reclaim(gen: str) -> int:
    if not GEN_RE.match(gen):
        print(f"REFUSAL: bad gen token: {gen!r}", file=sys.stderr)
        return 2
    rd = RUN_ROOT / f"abathur-loop-{gen}"
    ad = ARCHIVE_ROOT / gen
    manifest = ad / "ARCHIVE-MANIFEST.json"
    if not rd.exists():
        print(f"nothing to reclaim: {rd} does not exist")
        return 0
    if not manifest.is_file():
        print(f"REFUSAL: no archive manifest, run dir is the only copy: {manifest}", file=sys.stderr)
        return 2
    try:
        doc = json.loads(manifest.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        print(f"REFUSAL: unreadable manifest {manifest}: {exc}", file=sys.stderr)
        return 2
    files = doc.get("files") or {}
    if doc.get("gen") != gen or not files:
        print(f"REFUSAL: manifest gen mismatch or empty file list: {manifest}", file=sys.stderr)
        return 2
    for rel, want in files.items():
        got_p = ad / rel
        if not got_p.is_file():
            print(f"REFUSAL: archived file missing: {got_p}", file=sys.stderr)
            return 2
        digest = hashlib.sha256(got_p.read_bytes()).hexdigest()
        if digest != want:
            print(f"REFUSAL: archive hash mismatch {rel}: manifest={want} disk={digest}", file=sys.stderr)
            return 2
    shutil.rmtree(rd)
    print(f"reclaimed {rd} ({len(files)} archived files verified) "
          f"at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if argv and argv[0] == "reclaim":
        if len(argv) != 2:
            print("usage: clean_run.py reclaim <gen>", file=sys.stderr)
            return 2
        return _reclaim(argv[1])
    if len(argv) != 2:
        print("usage: clean_run.py <gen> <item> | clean_run.py reclaim <gen>", file=sys.stderr)
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
