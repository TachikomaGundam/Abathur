#!/usr/bin/env python3
"""Promotion inventory: what does disk actually prove about each promotion?

Owner order 2026-11-03: audit back to the FIRST promotion. This tool emits the
machine facts (one row per archived generation) that the audit reads; it does not
decide whether a promotion was justified.

Columns:
  bundle  sha256[:12] of the archived bundle.json
  mirror  PINNED (mirror SHA256SUMS hash recorded in the intent ledger)
          UNPINNED-SUMS (mirror exists, its sums hash was never ledger-pinned)
          MIRROR-DRIFT (mirror file no longer matches its own SHA256SUMS)
          no-mirror (evidence exists only under .omo, which git does not track)
  appr    APPROVAL.md present in the archive
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / ".omo/evidence/loop-archive"
MIRROR = REPO / "evidence"
LEDGER = REPO / ".omo/evidence/INTENT-LEDGER.md"
CHARTER = REPO / "AGENTS.md"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def promoted_gens() -> set[str]:
    """从宪章「晋升条款」标题行解析被批准的世代集合。

    只认标题行（含「晋升条款」且带「进化世代 …」字样），并把区间展开：
    G22–G25 → G22,G23,G24,G25；G26–G28 → G26,G27,G28；G68/G72 → 两个。
    世代后缀（如 G36B）原样保留。
    """
    if not CHARTER.is_file():
        return set()
    text = CHARTER.read_text(errors="replace")
    import re

    gens: set[str] = set()
    for line in text.splitlines():
        if "晋升条款" not in line:
            continue
        m = re.search(r"进化世代\s+(G\d+[A-Z]?(?:\s*[/–\-]\s*G?\d+[A-Z]?)*)", line)
        if not m:
            continue
        for part in re.split(r"[/]", m.group(1)):
            bounds = re.split(r"[–\-]", part)
            if len(bounds) == 2:
                lo, hi = (b.strip() for b in bounds)
                if not hi.startswith("G"):
                    hi = "G" + hi
                try:
                    lo_n, hi_n = int(re.sub(r"\D", "", lo)), int(re.sub(r"\D", "", hi))
                except ValueError:
                    continue
                for n in range(lo_n, hi_n + 1):
                    gens.add(f"G{n}")
            else:
                tok = part.strip()
                if re.fullmatch(r"G\d+[A-Z]?", tok):
                    gens.add(tok)
    return gens


def mirror_state(gen: str, ledger: str) -> str:
    sums = MIRROR / gen / "SHA256SUMS"
    if not sums.is_file():
        return "no-mirror"
    digest = sha256(sums)
    if digest not in ledger:
        return "UNPINNED-SUMS"
    for line in sums.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        want, _, rel = line.partition("  ")
        target = MIRROR / gen / rel.strip()
        if not target.is_file() or sha256(target) != want:
            return "MIRROR-DRIFT"
    return "PINNED"


def main() -> int:
    ledger = LEDGER.read_text(errors="replace") if LEDGER.is_file() else ""
    promoted = promoted_gens()
    rows = []
    for bdir in sorted(ARCHIVE.iterdir()):
        bundle = bdir / "bundle.json"
        if not bundle.is_file():
            continue
        gen = bdir.name
        try:
            data = json.loads(bundle.read_text())
        except Exception:
            data = {}
        raw = data.get("items") or {}
        if isinstance(raw, list):
            items = ",".join((v or {}).get("verdict", "?") for v in raw if isinstance(v, dict))
        else:
            items = ",".join(f"{k}:{(v or {}).get('verdict')}" for k, v in raw.items())
        rows.append(
            {
                "gen": gen,
                "sha": sha256(bundle)[:12],
                "mirror": mirror_state(gen, ledger),
                "appr": "yes" if (bdir / "APPROVAL.md").is_file() else "-",
                "promoted": "PROMOTED" if gen in promoted else "-",
                "terminal": data.get("terminal_state") or data.get("status") or "?",
                "nom": data.get("nominatable"),
                "ck": len(data.get("canaries_killed") or []),
                "items": items,
            }
        )

    print("| gen | bundle | mirror | approval | charter | terminal | nominatable | canaries | items |")
    print("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(
            f"| {r['gen']} | {r['sha']} | {r['mirror']} | {r['appr']} | {r['promoted']} "
            f"| {r['terminal']} | {r['nom']} | {r['ck']} | {r['items']} |"
        )
    missing = sorted(g for g in promoted if not (ARCHIVE / g).is_dir())
    print()
    print(f"promoted_in_charter={len(promoted)} archived={len(rows)}")
    print(f"promoted_without_archive={' '.join(missing) or '(none)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
