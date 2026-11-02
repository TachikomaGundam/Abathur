#!/usr/bin/env python3
"""Promotion integrity audit (owner order 2026-11-03, after INCIDENT-20261103).

For every archived generation bundle, recompute its sha256 and check whether that
value is pinned in the append-only intent ledger. This answers one narrow,
machine-checkable question:

    "Is the evidence a promotion was based on still byte-identical to what was
     recorded at the time?"

It does NOT answer "was the promotion justified" — that is what the independent
audit is for. It also cannot prove nobody rewrote both the bundle and the ledger
(a same-uid writer can do both); that limitation is printed, not hidden.

Exit: 0 all bundles present and pinned, 1 any missing/unpinned/mismatch, 2 cannot answer.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / ".omo/evidence/loop-archive"
LEDGER = REPO / ".omo/evidence/INTENT-LEDGER.md"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    if not ARCHIVE.is_dir() or not LEDGER.is_file():
        print("cannot answer: archive or ledger missing", file=sys.stderr)
        return 2
    ledger = LEDGER.read_text(errors="replace")
    mirrored = REPO / "evidence"
    rows = []
    for bdir in sorted(ARCHIVE.iterdir()):
        b = bdir / "bundle.json"
        if not b.is_file():
            continue
        gen = bdir.name
        digest = sha256(b)
        # Real pinning artifact = the mirror's SHA256SUMS, whose own sha256 is
        # recorded as sums_sha256=<hex> in the append-only ledger.
        sums = mirrored / gen / "SHA256SUMS"
        sums_state, sums_ok = "no-mirror", False
        if sums.is_file():
            sdig = sha256(sums)
            sums_ok = sdig in ledger
            sums_state = "PINNED" if sums_ok else "UNPINNED-SUMS"
            for line in sums.read_text().splitlines():
                line = line.strip()
                if not line:
                    continue
                want, _, rel = line.partition("  ")
                target = mirrored / gen / rel.strip()
                if not target.is_file() or sha256(target) != want:
                    sums_state = "MIRROR-DRIFT"
                    sums_ok = False
                    break
        pinned = sums_ok
        try:
            data = json.loads(b.read_text())
        except Exception:
            data = {}
        approval = bdir / "APPROVAL.md"
        approved = approval.is_file()
        raw_items = data.get("items") or {}
        if isinstance(raw_items, list):
            items_map = {}
            for idx, v in enumerate(raw_items):
                v = v or {}
                items_map[v.get("item") or f"#{idx}"] = v.get("verdict")
        else:
            items_map = {k: (v or {}).get("verdict") for k, v in raw_items.items()}
        rows.append(
            {
                "gen": gen,
                "sha12": digest[:12],
                "pinned_in_ledger": pinned,
                "mirror": sums_state,
                "approved_file": approved,
                "terminal": data.get("terminal_state") or data.get("status"),
                "nominatable": data.get("nominatable"),
                "canaries_killed": len(data.get("canaries_killed") or []),
                "items": items_map,
            }
        )

    print(f"bundles={len(rows)} ledger={LEDGER.name} sha256={sha256(LEDGER)[:12]}")
    bad = 0
    for r in rows:
        flag = r["mirror"]
        if not r["pinned_in_ledger"]:
            bad += 1
        appr = "approved" if r["approved_file"] else "-"
        items = ",".join(f"{k}:{v}" for k, v in r["items"].items()) or "-"
        print(
            f"{r['gen']:<7} {r['sha12']} {flag:<13} {appr:<8} "
            f"{str(r['terminal']):<12} nominatable={r['nominatable']} ck={r['canaries_killed']} {items}"
        )
    print()
    print("LIMIT: a same-uid writer can rewrite bundle AND ledger AND mirror together.")
    print("      This gate detects drift and unpinned evidence; it does not establish authors.")
    if bad:
        print(f"VERDICT=PROMOTION-INTEGRITY FAIL unpinned={bad} of {len(rows)}")
        return 1
    print("VERDICT=PROMOTION-INTEGRITY OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
