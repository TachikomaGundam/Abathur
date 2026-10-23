#!/usr/bin/env python3
"""spawn-completion-receipt R1-R5: persistent registry for spawned loop subprocesses.

Invariant: every spawned candidate/judge runner has exactly one `start` and one
`exit` receipt here, so ANY seat in ANY session can mechanically answer:
who is running / who finished awaiting harvest / what is the next step.

Registry = append-only evidence ledger (.omo/evidence/loop-runs.jsonl),
flock-serialized, no shell expansion. Liveness = dual-source /proc check
(/proc/<pid> exists AND cmdline mentions gen+item). pgrep is forbidden here
(G45 lesson: pgrep self-match false-positive).

CLI:
  python3 loop/run_registry.py status            # who runs / who awaits harvest / next step
  python3 loop/run_registry.py mark-harvested GEN ITEM ROLE

Runners import append_event() directly (same-dir module).
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
REGISTRY = REPO / ".omo" / "evidence" / "loop-runs.jsonl"

ROLES = ("candidate", "judge")
EVENTS = ("start", "exit", "harvested")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _sha256(p: Path) -> str | None:
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()
    except OSError:
        return None


def append_event(gen: str, item: str, role: str, event: str, *, pid: int | None = None,
                 pgid: int | None = None, rc: int | None = None,
                 state_path: Path | str | None = None, note: str | None = None) -> dict:
    """Append one receipt row. flock-serialized; never raises on I/O failure
    (registry must never crash the runner it observes) — returns the row or None."""
    row: dict = {"ts": _now(), "gen": gen, "item": item, "role": role, "event": event}
    if pid is not None:
        row["pid"] = pid
    if pgid is not None:
        row["pgid"] = pgid
    if rc is not None:
        row["rc"] = rc
    if state_path is not None:
        row["state_path"] = str(state_path)
        h = _sha256(Path(state_path))
        if h:
            row["state_sha256"] = h
    if note:
        row["note"] = note
    try:
        REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        with open(REGISTRY, "a", encoding="utf-8") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())
    except OSError as exc:  # registry failure must not kill the observed runner
        print(f"run_registry: append failed: {exc}", file=sys.stderr)
    return row


def _load() -> list[dict]:
    if not REGISTRY.exists():
        return []
    rows = []
    for ln in REGISTRY.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            rows.append(json.loads(ln))
        except json.JSONDecodeError:
            rows.append({"event": "CORRUPT", "raw": ln[:200]})
    return rows


def _alive(pid: int, gen: str, item: str) -> bool:
    """Dual-source liveness: /proc/<pid> exists AND cmdline mentions gen+item."""
    try:
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
    except OSError:
        return False
    return gen in cmdline and item in cmdline


def _next_action(gen: str, item: str, role: str, cls: str) -> str:
    if cls == "RUNNING":
        return "none — occupied, queue and never write"
    if cls == "ORPHAN-SUSPECT":
        return f"inspect /tmp/abathur-loop-{gen}/{item}/harness; re-run runner if no terminal state"
    if role == "candidate":
        return f"run judge: python3 loop/run_judge.py {gen} {item}"
    return f"harvest: python3 loop/sweep.py {gen} then python3 loop/run_registry.py mark-harvested {gen} {item} {role}"


def status() -> int:
    rows = _load()
    if not rows:
        print("registry empty: no spawned runs recorded")
        print("occupancy: FREE")
        return 0
    latest: dict = {}
    order: list = []
    for r in rows:
        key = (r.get("gen"), r.get("item"), r.get("role"))
        if None in key:
            continue
        if key not in latest:
            order.append(key)
        latest[key] = r
    occupied = False
    for gen, item, role in order:
        r = latest[(gen, item, role)]
        ev = r.get("event")
        if ev == "harvested":
            cls = "DONE"
        elif ev == "exit":
            cls = "EXITED-UNHARVESTED"
        elif ev == "start":
            pid = r.get("pid")
            cls = "RUNNING" if (isinstance(pid, int) and _alive(pid, gen, item)) else "ORPHAN-SUSPECT"
        else:
            cls = "CORRUPT"
        if cls == "RUNNING":
            occupied = True
        nxt = "none" if cls == "DONE" else _next_action(gen, item, role, cls)
        print(f"{gen} {item} {role}: {cls} last={r.get('ts')} rc={r.get('rc', '-')} next={nxt}")
    print(f"occupancy: {'OCCUPIED — queue, never write' if occupied else 'FREE'}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("status", help="classify RUNNING / EXITED-UNHARVESTED / ORPHAN-SUSPECT / DONE + next action")
    mh = sub.add_parser("mark-harvested", help="close a run after sweep/archive")
    mh.add_argument("gen")
    mh.add_argument("item")
    mh.add_argument("role", choices=ROLES)
    mh.add_argument("--note", default=None)
    args = ap.parse_args()
    if args.cmd == "mark-harvested":
        row = append_event(args.gen, args.item, args.role, "harvested", note=args.note)
        print(json.dumps(row, ensure_ascii=False))
        return 0
    return status()


if __name__ == "__main__":
    sys.exit(main())
