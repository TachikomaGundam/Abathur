#!/usr/bin/env python3
"""Host-side ledger append job (runs OUTSIDE the bash sandbox, via the exam-queue plugin).

Why this exists: the bash sandbox binds only the Abathur workspace, so
/home/lab/workspace/infra/anchor-chain/stamp.sh is unreachable from a sandboxed
shell. Hash-chained ledger appends are a standing duty (L-RECEIPT / L-WRITE-ORDER),
so this job performs them host-side with NO caller-supplied paths: the ledger
target and the pending-text file are fixed constants in this file.

Queue contract: the seat writes the entry body to .omo/pending-ledger.txt, then
enqueues {"gen":"G61","item":"SR4-64","stage":"ledger"}. This script appends the
body to the ledger through infra stamp.sh and clears the pending file only on success.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PENDING = REPO / ".omo" / "pending-ledger.txt"
LEDGER = REPO / ".omo" / "evidence" / "INTENT-LEDGER.md"
STAMP = Path("/home/lab/workspace/infra/anchor-chain/stamp.sh")


def main() -> int:
    if not PENDING.is_file():
        print("ledger job: nothing pending", flush=True)
        return 0
    body = PENDING.read_text(encoding="utf-8").strip()
    if not body:
        print("ledger job: pending file empty", flush=True)
        PENDING.unlink()
        return 0
    if not STAMP.is_file():
        print(f"ledger job: stamp tool missing {STAMP}", file=sys.stderr, flush=True)
        return 2
    if not LEDGER.is_file():
        print(f"ledger job: ledger missing {LEDGER}", file=sys.stderr, flush=True)
        return 2

    draft = REPO / ".omo" / "ledger-draft.txt"
    draft.write_text(body + "\n", encoding="utf-8")
    proc = subprocess.run(
        ["bash", str(STAMP), "ledger-append", "--text-file", str(draft)],
        cwd=str(REPO),
        env={"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
             "HOME": str(Path.home()), "ANCHOR_LEDGER": str(LEDGER)},
        capture_output=True,
        text=True,
        timeout=120,
    )
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        print(f"ledger job: stamp rc={proc.returncode}, pending kept", flush=True)
        return proc.returncode
    PENDING.unlink()
    draft.unlink(missing_ok=True)
    print("ledger job: appended, pending cleared", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
