#!/usr/bin/env python3
"""rerun_zero_trust.py — re-judge a sealed paper with the judge bytes pinned at seed time.

Why: a verdict is only worth what the program that produced it is worth. Audits kept
finding that the working tree could change between sealing and reading. This tool takes
the blob ids recorded in draw-ledger.jsonl at seed time, materialises exactly those
bytes, re-runs the judge on a copy of the run dir, and diffs the two verdicts.

Usage:  python3 loop/rerun_zero_trust.py <gen> <item> [--compare-only]
Exit:   0 identical verdicts, 1 different, 2 cannot run (no pinned blobs / no run dir)

The rerun happens in /tmp/abathur-loop-<gen>Z so the original generation is never
touched; the comparison receipt is written to the ORIGINAL item's harness dir.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LEDGER = REPO / ".omo" / "evidence" / "draw-ledger.jsonl"
TMP = Path("/tmp")


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def pinned_tooling(gen: str, item: str) -> dict:
    if not LEDGER.is_file():
        raise SystemExit("no draw-ledger.jsonl")
    hit = None
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("gen") == gen and row.get("item") == item:
            hit = row
    if not hit or not hit.get("tooling"):
        raise SystemExit(f"no pinned tooling for {gen}/{item} (seeded before the pin existed)")
    return hit["tooling"]


def materialise(tooling: dict, dest: Path) -> dict:
    dest.mkdir(parents=True, exist_ok=True)
    got = {}
    for rel, blob in tooling.items():
        if not blob:
            raise SystemExit(f"blob id missing for {rel}")
        out = dest / Path(rel).name
        proc = subprocess.run(["git", "cat-file", "blob", blob], cwd=str(REPO),
                              capture_output=True, timeout=60)
        if proc.returncode != 0:
            raise SystemExit(f"git cat-file failed for {rel} @ {blob}")
        out.write_bytes(proc.stdout)
        got[rel] = {"blob": blob, "sha256": sha256(out), "path": str(out)}
    # The judge imports the item bank. The bank is the exam questions, deliberately the
    # current one, so it is NOT pinned; the shim makes that explicit and recorded.
    bank_shim = dest / "bank.py"
    bank_shim.write_text(
        "import importlib.util\n"
        f"_s = importlib.util.spec_from_file_location('_bank_repo', {str(REPO / 'loop' / 'bank.py')!r})\n"
        "_m = importlib.util.module_from_spec(_s)\n"
        "_s.loader.exec_module(_m)\n"
        "ITEMS = _m.ITEMS\n",
        encoding="utf-8")
    got["bank.py(shim->current repo bank)"] = {"blob": None, "sha256": sha256(bank_shim),
                                               "path": str(bank_shim)}
    return got


def verdict_shape(v: dict) -> dict:
    sigs = {k: (val or {}).get("verdict") for k, val in (v.get("signals") or {}).items()} \
        if isinstance(v.get("signals"), dict) else {}
    return {"item": v.get("item"), "aggregate": v.get("aggregate"),
            "canary_kill": v.get("canary_kill"),
            "hard_global_fail": v.get("hard_global_fail"), "signals": sigs}


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    gen, item = argv[0], argv[1]
    src = TMP / f"abathur-loop-{gen}" / item
    if not src.is_dir():
        raise SystemExit(f"run dir missing: {src}")
    v1_path = src / "harness" / "judge-work" / "verdict.json"
    if not v1_path.is_file():
        raise SystemExit(f"no original verdict at {v1_path}")
    tooling = pinned_tooling(gen, item)
    zgen = f"{gen}Z"
    zrun = TMP / f"abathur-loop-{zgen}"
    code_dir = zrun / "_pinned-code"
    if "--compare-only" not in argv:
        shutil.rmtree(zrun, ignore_errors=True)
        zrun.mkdir(parents=True)
        shutil.copytree(src, zrun / item, symlinks=True)
        for stale in ("verdict.json", "session.txt", "verdict-problems.txt", "judge.out"):
            (zrun / item / "harness" / "judge-work" / stale).unlink(missing_ok=True)
        got = materialise(tooling, code_dir)
        entry = code_dir / "run_judge.py"
        proc = subprocess.run([sys.executable, str(entry), zgen, item], cwd=str(REPO),
                              capture_output=True, text=True, timeout=3600)
        print(f"pinned judge rc={proc.returncode}")
        if proc.returncode != 0:
            print(proc.stdout[-800:], proc.stderr[-800:], file=sys.stderr)
    else:
        got = {rel: {"blob": blob, "path": str(code_dir / Path(rel).name)}
               for rel, blob in tooling.items()}
    v2_path = zrun / item / "harness" / "judge-work" / "verdict.json"
    if not v2_path.is_file():
        raise SystemExit(f"rerun produced no verdict at {v2_path}")
    v1 = json.loads(v1_path.read_text())
    v2 = json.loads(v2_path.read_text())
    s1, s2 = verdict_shape(v1), verdict_shape(v2)
    same = s1 == s2
    receipt = {
        "gen": gen, "item": item, "rerun_gen": zgen,
        "pinned_tooling": got,
        "v1_sha256": sha256(v1_path), "v2_sha256": sha256(v2_path),
        "v1": s1, "v2": s2, "identical": same,
        "rerun_dir": str(zrun / item),
    }
    out = src / "harness" / "zerotrust-compare.json"
    out.write_text(json.dumps(receipt, indent=2, ensure_ascii=False))
    print(json.dumps({"identical": same, "v1": s1.get("aggregate"), "v2": s2.get("aggregate"),
                      "receipt": str(out)}, ensure_ascii=False))
    return 0 if same else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
