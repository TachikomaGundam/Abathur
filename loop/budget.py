#!/usr/bin/env python3
"""budget.py — per-generation cost meter (P0 C-05).

Why: the loop could burn unbounded tokens/wall-clock and nobody would notice until the
bill arrives. This meter reads only things the run already wrote, so it cannot disagree
with reality by construction:

  * wall clock per stage   — queue receipts (.omo/exam-queue/done/*.result.json)
  * agent tokens/parts     — the engine DB inside each role's fake HOME (session tables)
  * disk footprint         — bytes under /tmp/abathur-loop-<gen> at meter time

It appends one JSON line per generation to .omo/evidence/budget.jsonl (append-only, so
history survives; the meter never rewrites a line it wrote).

Usage: python3 loop/budget.py <gen> [--json]
Exit: 0 ok, 2 cannot measure (missing run dir) — never a silent zero.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUEUE = REPO / ".omo" / "exam-queue" / "done"
OUT = REPO / ".omo" / "evidence" / "budget.jsonl"
RUN_ROOT = Path("/tmp")


def _receipts(gen: str) -> list[dict]:
    rows = []
    for fh in sorted(QUEUE.glob(f"*.result.json")):
        try:
            d = json.loads(fh.read_text())
        except (OSError, ValueError):
            continue
        if d.get("gen") != gen:
            continue
        rows.append({
            "stage": d.get("stage"),
            "rc": d.get("rc"),
            "elapsed_s": d.get("elapsed_s"),
            "kind": d.get("kind"),
            "receipt": str(fh),
        })
    return rows


def _role_db(gen: str, item: str, role: str) -> dict | None:
    base = RUN_ROOT / f"abathur-loop-{gen}" / item
    db = (base / "candidate" / "home" if role == "candidate" else base / "harness" / "judge-home") \
        / ".local" / "share" / "opencode" / "opencode.db"
    if not db.is_file():
        return None
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            row = con.execute(
                "SELECT COUNT(*), COALESCE(SUM(tokens_input),0), COALESCE(SUM(tokens_output),0),"
                " COALESCE(SUM(tokens_reasoning),0), COALESCE(SUM(cost),0) FROM session"
            ).fetchone()
            try:
                msgs = con.execute("SELECT COUNT(*) FROM message").fetchone()[0]
            except sqlite3.Error:
                msgs = None
        finally:
            con.close()
    except sqlite3.Error as exc:
        return {"error": str(exc), "db": str(db)}
    return {"sessions": row[0], "messages": msgs, "tokens_input": row[1],
            "tokens_output": row[2], "tokens_reasoning": row[3], "cost": round(row[4] or 0, 6),
            "db": str(db)}


def _disk(gen: str) -> int:
    root = RUN_ROOT / f"abathur-loop-{gen}"
    total = 0
    for base, _dirs, files in os.walk(root):
        for name in files:
            fp = Path(base) / name
            try:
                total += fp.stat().st_size
            except OSError:
                pass
    return total


def measure(gen: str) -> dict:
    root = RUN_ROOT / f"abathur-loop-{gen}"
    if not root.is_dir():
        raise SystemExit(f"cannot measure {gen}: {root} missing")
    items = sorted(p.name for p in root.iterdir() if p.is_dir() and p.name.startswith("SR4-"))
    roles: dict[str, dict] = {}
    for item in items:
        for role in ("candidate", "judge"):
            got = _role_db(gen, item, role)
            if got:
                roles[f"{item}/{role}"] = got
    receipts = _receipts(gen)
    by_stage: dict[str, float] = {}
    for r in receipts:
        if isinstance(r.get("elapsed_s"), (int, float)):
            key = f"{r.get('stage')}:{r.get('rc')}"
            by_stage[key] = round(by_stage.get(key, 0.0) + r["elapsed_s"], 2)
    return {
        "at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "gen": gen,
        "items": items,
        "receipts": len(receipts),
        "seconds_by_stage_rc": by_stage,
        "total_receipt_seconds": round(sum(v for v in by_stage.values()), 2),
        "roles": roles,
        "run_disk_bytes": _disk(gen),
    }


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: budget.py <gen> [--json]", file=sys.stderr)
        return 2
    gen = argv[0]
    row = measure(gen)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    if "--json" in argv:
        print(json.dumps(row, ensure_ascii=False, indent=1))
    else:
        print(f"BUDGET {gen} items={len(row['items'])} receipts={row['receipts']} "
              f"seconds={row['total_receipt_seconds']} disk={row['run_disk_bytes']}B line={OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
