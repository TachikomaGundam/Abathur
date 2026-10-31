#!/usr/bin/env python3
"""coverage.py — closed enumeration of the evidence an exam generation must leave behind.

Why: "we check everything" is a claim, not an enumeration. This script walks a fixed
list of artifacts per item (the list is the enumeration; extending it is a code change,
not a prose edit) and reports PRESENT / MISSING per cell, plus the archive copy.

Exit: 0 all expected artifacts present, 1 something missing, 2 cannot answer (no run dir).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / ".omo" / "evidence" / "loop-archive"
RUNROOT = Path("/tmp")

# The closed list. Each entry: (label, path template, required)
ITEM_EXPECTED = [
    ("candidate_state", "harness/candidate_state.json", True),
    ("transcript", "harness/transcript.json", True),
    ("verdict", "harness/judge-work/verdict.json", True),
    ("judge_session", "harness/judge-work/session.txt", False),
    ("disk_probe", "harness/disk_probe.json", True),
    ("manifest", "harness/manifest.json", True),
]
GEN_EXPECTED = [
    ("bundle", "bundle.json", True),
    ("bundle_face", "BUNDLE.md", True),
    ("archive_manifest", "ARCHIVE-MANIFEST.json", True),
]


def items_of(gen: str) -> list[str]:
    lead = REPO / ".omo" / "evidence" / "draw-ledger.jsonl"
    out: list[str] = []
    if not lead.is_file():
        return out
    for line in lead.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("gen") == gen and row.get("item") and row["item"] not in out:
            out.append(row["item"])
    if out:
        return sorted(out)
    bundle = ARCHIVE / gen / "bundle.json"
    try:
        data = json.loads(bundle.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return out
    for row in data.get("items") or []:
        item = row.get("item")
        if item and item not in out:
            out.append(item)
    return sorted(out)


def cell(run: Path, arch: Path, rel: str) -> tuple[str, str]:
    live = run / rel
    kept = arch / rel
    if live.is_file():
        return "PRESENT", "run"
    if kept.is_file():
        return "PRESENT", "archive"
    return "MISSING", "-"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: coverage.py <GEN>", file=sys.stderr)
        return 2
    gen = sys.argv[1]
    items = items_of(gen)
    arch = ARCHIVE / gen
    live_root = RUNROOT / f"abathur-loop-{gen}"
    if not items and not arch.is_dir():
        print(f"COVERAGE {gen}: no items in draw ledger and no archive", file=sys.stderr)
        return 2
    missing = 0
    rows: list[str] = []
    for name, rel, required in GEN_EXPECTED:
        state, where = cell(live_root, arch, rel)
        if state == "MISSING" and required:
            missing += 1
        rows.append(f"{state:8} gen    {name:18} {where:8} {rel}")
    for item in items:
        run = live_root / item
        for name, rel, required in ITEM_EXPECTED:
            state, where = cell(run, arch / item, rel)
            if state == "MISSING" and required:
                missing += 1
            rows.append(f"{state:8} {item:7} {name:18} {where:8} {rel}")
    print(f"COVERAGE {gen}: items={len(items)} cells={len(rows)} missing_required={missing}")
    for row in rows:
        print(row)
    return 0 if missing == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
