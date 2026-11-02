#!/usr/bin/env python3
"""recurrence.py — 行为病复发账（机器可判）与阈值升级闸。

Why this exists: the seat repeated the same operational mistakes (pasted sandbox
prefix, fabricated citations, unprobed claims) and each time the lesson lived in
prose. Prose is not countable, so "same disease three times = structural fix"
(L-INVARIANT-FIRST) had no trigger. This module makes recurrence a machine fact.

Two inputs, deliberately separate writers:
  - .omo/evidence/gate-blocks.jsonl  — raw events appended by the *gate* itself
    (today: sandbox-bash.js on SANDBOX-PREFIX-COPIED). Single writer = the plugin.
    No chain: each line carries its own sha256 over the canonical body.
  - .omo/evidence/recurrence.jsonl   — chained ledger of seat-authored records
    (`record` CLI). Single writer = this module; prev-hash chain.
Never merge the two into one file: two writers would break the chain.

Escalation rule (mechanical): a class whose in-window count reaches the threshold
must be `fix-landed` (with a deadline not yet passed) or `examized` (with an exam
item). Otherwise `check` exits 3. Class vocabulary is closed: unknown classes are
refused at record time and escalated at check time.

Consumers: scripts/verify-all.sh runs `check` as a step; nothing else is decoration.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVID = Path(os.environ.get("ABATHUR_RECUR_DIR", ROOT / ".omo" / "evidence"))
CHAIN = EVID / "recurrence.jsonl"
RAW = EVID / "gate-blocks.jsonl"
CLASSES = Path(os.environ.get("ABATHUR_RECUR_CLASSES", ROOT / "loop" / "recurrence_classes.json"))
GENESIS = "0" * 64


def _canon(obj: dict) -> str:
    body = {k: v for k, v in obj.items() if k != "sha256"}
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hash(obj: dict) -> str:
    return hashlib.sha256(_canon(obj).encode()).hexdigest()


def _read_jsonl(p: Path) -> list[dict]:
    if not p.is_file():
        return []
    out = []
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            raise SystemExit(f"{p}:{i}: malformed JSON line")
    return out


def tail_hash() -> str:
    rows = _read_jsonl(CHAIN)
    return rows[-1]["sha256"] if rows else GENESIS


def verify_chain() -> list[str]:
    """Return problems; recomputes every link and every body hash."""
    problems: list[str] = []
    prev = GENESIS
    for i, row in enumerate(_read_jsonl(CHAIN), 1):
        if row.get("prev") != prev:
            problems.append(f"chain[{i}] prev mismatch")
        want = _hash(row)
        if row.get("sha256") != want:
            problems.append(f"chain[{i}] body hash mismatch")
        prev = row.get("sha256", "")
    return problems


def load_classes() -> dict:
    if not CLASSES.is_file():
        raise SystemExit(f"class registry missing: {CLASSES}")
    reg = json.loads(CLASSES.read_text(encoding="utf-8"))
    if reg.get("schema") != 1 or not isinstance(reg.get("classes"), dict):
        raise SystemExit("class registry malformed (schema must be 1)")
    return reg


def record(cls: str, where: str, cost: int, note: str) -> dict:
    reg = load_classes()
    if cls not in reg["classes"]:
        raise SystemExit(f"unknown class '{cls}' (closed vocabulary; add it to {CLASSES} first)")
    row = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "class": cls,
        "where": where,
        "cost_turns": int(cost),
        "note": note,
        "prev": tail_hash(),
    }
    row["sha256"] = _hash(row)
    CHAIN.parent.mkdir(parents=True, exist_ok=True)
    with open(CHAIN, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    return row


def aggregate(days: int) -> tuple[dict[str, int], int]:
    """Count events per class within the window; raw gate events + chained records."""
    cut = time.time() - days * 86400
    counts: dict[str, int] = {}
    total = 0
    for row in _read_jsonl(CHAIN):
        try:
            ts = time.mktime(time.strptime(row["ts"], "%Y-%m-%dT%H:%M:%SZ")) - time.timezone
        except Exception:
            ts = 0
        if ts < cut:
            continue
        counts[row["class"]] = counts.get(row["class"], 0) + 1
        total += 1
    for row in _read_jsonl(RAW):
        body = {k: v for k, v in row.items() if k != "sha256"}
        if row.get("sha256") != hashlib.sha256(
            json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest():
            counts["__raw-tampered__"] = counts.get("__raw-tampered__", 0) + 1
            total += 1
            continue
        try:
            ts = time.mktime(time.strptime(row["ts"], "%Y-%m-%dT%H:%M:%SZ")) - time.timezone
        except Exception:
            ts = 0
        if ts < cut:
            continue
        counts[row["class"]] = counts.get(row["class"], 0) + 1
        total += 1
    return counts, total


def _commit_exists(sha: str) -> bool:
    try:
        r = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}"],
                           capture_output=True, text=True, timeout=20)
        return r.returncode == 0
    except Exception:
        return False


def check(days: int, threshold: int) -> int:
    reg = load_classes()
    problems = verify_chain()
    if problems:
        for p in problems:
            print(f"ESCALATE chain {p}")
        print(f"RECURRENCE ESCALATE chain_broken={len(problems)}")
        return 3
    counts, total = aggregate(days)
    escalate = 0
    now = time.time()
    for cls, n in sorted(counts.items()):
        if cls == "__raw-tampered__":
            print(f"ESCALATE class={cls} count={n} reason=raw-gate-log-tampered")
            escalate += 1
            continue
        spec = reg["classes"].get(cls)
        if spec is None:
            print(f"ESCALATE class={cls} count={n} reason=unregistered-class")
            escalate += 1
            continue
        if n < threshold:
            continue
        status = spec.get("status")
        if status not in ("fix-landed", "examized"):
            print(f"ESCALATE class={cls} count={n} reason=status-{status}")
            escalate += 1
            continue
        fix = spec.get("fix_commit")
        if fix and not _commit_exists(fix):
            print(f"ESCALATE class={cls} count={n} reason=fix-commit-absent {fix}")
            escalate += 1
            continue
        if status == "examized" and not spec.get("exam_item"):
            print(f"ESCALATE class={cls} count={n} reason=examized-without-item")
            escalate += 1
            continue
        if status != "examized":
            deadline = spec.get("deadline_utc") or ""
            if not deadline or time.mktime(time.strptime(deadline, "%Y-%m-%dT%H:%M:%SZ")) - time.timezone < now:
                print(f"ESCALATE class={cls} count={n} reason=examization-deadline-passed")
                escalate += 1
    if escalate:
        print(f"RECURRENCE ESCALATE classes={escalate} events={total} threshold={threshold} window={days}d")
        return 3
    print(f"RECURRENCE OK events={total} classes={len(reg['classes'])} threshold={threshold} window={days}d")
    return 0


def report(days: int, threshold: int) -> int:
    reg = load_classes()
    counts, total = aggregate(days)
    print(f"window={days}d events={total} threshold={threshold}")
    for cls in sorted(reg["classes"]):
        spec = reg["classes"][cls]
        n = counts.get(cls, 0)
        flag = ">=" if n >= threshold else "  "
        print(f" {flag} {n:>3}  {cls:<28} status={spec.get('status'):<11} "
              f"exam={spec.get('exam_item') or '-'} deadline={spec.get('deadline_utc') or '-'}")
    print(json.dumps({"counts": counts, "total": total, "threshold": threshold,
                      "window_days": days}, ensure_ascii=False, sort_keys=True))
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cmd = argv[0]
    args = argv[1:]
    if cmd == "record":
        opts = {"cost": "1", "note": "", "where": ""}
        cls = ""
        i = 0
        while i < len(args):
            a = args[i]
            if a.startswith("--"):
                k = a[2:]
                v = args[i + 1] if i + 1 < len(args) else ""
                if k in opts:
                    opts[k] = v
                i += 2
            else:
                cls = a
                i += 1
        if not cls:
            print("usage: recurrence.py record <class> [--where X] [--cost N] [--note S]")
            return 2
        row = record(cls, opts["where"], opts["cost"], opts["note"])
        print(f"RECORDED class={row['class']} sha256={row['sha256'][:16]} prev={row['prev'][:16]}")
        return 0
    if cmd in ("check", "report"):
        days, threshold = 30, 3
        i = 0
        while i < len(args):
            if args[i] == "--days":
                days = int(args[i + 1]); i += 2
            elif args[i] == "--threshold":
                threshold = int(args[i + 1]); i += 2
            else:
                i += 1
        return check(days, threshold) if cmd == "check" else report(days, threshold)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
