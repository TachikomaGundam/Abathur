#!/usr/bin/env python3
"""Contract tests for loop/recurrence.py (行为病复发账与阈值升级闸).

Run: python3 loop/test_recurrence.py   → prints "# pass N / # fail 0", rc 0 on success.
Each case runs the CLI in a subprocess with an isolated evidence dir and registry.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "loop" / "recurrence.py"
FUTURE = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 86400 * 7))
PAST = "2020-01-01T00:00:00Z"

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS {name}")
    else:
        failed += 1
        print(f"FAIL {name} {detail}")


def mk_registry(tmp: Path, classes: dict) -> Path:
    p = tmp / "classes.json"
    p.write_text(json.dumps({"schema": 1, "classes": classes}, ensure_ascii=False), encoding="utf-8")
    return p


def run(tmp: Path, reg: Path, *args: str) -> subprocess.CompletedProcess:
    env = dict(os.environ, ABATHUR_RECUR_DIR=str(tmp), ABATHUR_RECUR_CLASSES=str(reg))
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=env)


def cls(status="fix-landed", deadline=FUTURE, exam=None) -> dict:
    return {"label": "t", "status": status, "fix_commit": None, "exam_item": exam,
            "deadline_utc": deadline, "gate": None, "note": ""}


def case1_empty() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls()})
        r = run(tmp, reg, "check")
        check("empty ledger passes", r.returncode == 0, r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp)


def case2_below_threshold() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls(status="open")})
        for _ in range(2):
            run(tmp, reg, "record", "c1", "--where", "test")
        r = run(tmp, reg, "check")
        check("2 events under threshold passes", r.returncode == 0, r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp)


def case3_open_escalates() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls(status="open")})
        for _ in range(3):
            run(tmp, reg, "record", "c1", "--where", "test")
        r = run(tmp, reg, "check")
        check("3 events with status=open escalate", r.returncode == 3 and "status-open" in r.stdout,
              r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp)


def case4_fix_landed_passes() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls(status="fix-landed")})
        for _ in range(3):
            run(tmp, reg, "record", "c1", "--where", "test")
        r = run(tmp, reg, "check")
        check("3 events with fix-landed + future deadline passes", r.returncode == 0, r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp)


def case5_deadline_passed() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls(status="fix-landed", deadline=PAST)})
        for _ in range(3):
            run(tmp, reg, "record", "c1", "--where", "test")
        r = run(tmp, reg, "check")
        check("deadline passed escalates", r.returncode == 3 and "deadline" in r.stdout, r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp)


def case6_unknown_class() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls()})
        r = run(tmp, reg, "record", "nope", "--where", "test")
        check("unregistered class refused at record time", r.returncode != 0 and "unknown class" in (r.stdout + r.stderr),
              r.stdout + r.stderr)
        import hashlib
        ghost = {"ts": FUTURE, "class": "ghost", "gate": "test", "detail": "x"}
        canon = json.dumps(ghost, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        ghost["sha256"] = hashlib.sha256(canon.encode()).hexdigest()
        (tmp / "gate-blocks.jsonl").write_text(
            json.dumps(ghost, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
        r2 = run(tmp, reg, "check")
        check("unregistered class in gate log escalates",
              r2.returncode == 3 and "unregistered-class" in r2.stdout, r2.stdout + r2.stderr)
    finally:
        shutil.rmtree(tmp)


def case7_chain_tamper() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls()})
        run(tmp, reg, "record", "c1", "--where", "a")
        run(tmp, reg, "record", "c1", "--where", "b")
        lines = (tmp / "recurrence.jsonl").read_text(encoding="utf-8").splitlines()
        row = json.loads(lines[0])
        row["where"] = "tampered"
        lines[0] = json.dumps(row, ensure_ascii=False, sort_keys=True)
        (tmp / "recurrence.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        r = run(tmp, reg, "check")
        check("body tamper detected", r.returncode == 3 and "hash mismatch" in r.stdout, r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp)


def case8_raw_events_count() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls(status="open")})
        run(tmp, reg, "record", "c1", "--where", "a")
        run(tmp, reg, "record", "c1", "--where", "b")
        body = {"ts": FUTURE, "class": "c1", "gate": "test", "detail": "x"}
        import hashlib
        canon = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        body["sha256"] = hashlib.sha256(canon.encode()).hexdigest()
        with open(tmp / "gate-blocks.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(body, ensure_ascii=False, sort_keys=True) + "\n")
        r = run(tmp, reg, "check")
        check("raw gate event counts toward threshold (2+1=3 escalates)",
              r.returncode == 3, r.stdout + r.stderr)

        body2 = dict(body)
        body2["detail"] = "tampered"
        with open(tmp / "gate-blocks.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(body2, ensure_ascii=False, sort_keys=True) + "\n")
        r2 = run(tmp, reg, "check")
        check("tampered raw event detected", "raw-gate-log-tampered" in r2.stdout, r2.stdout + r2.stderr)
    finally:
        shutil.rmtree(tmp)


def case9_examized_requires_item() -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        reg = mk_registry(tmp, {"c1": cls(status="examized", deadline=None, exam=None)})
        for _ in range(3):
            run(tmp, reg, "record", "c1", "--where", "t")
        r = run(tmp, reg, "check")
        check("examized without item escalates", r.returncode == 3 and "examized-without-item" in r.stdout,
              r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp)


def case10_real_registry_sane() -> None:
    """The shipped registry must parse and classify every class."""
    reg = json.loads((ROOT / "loop" / "recurrence_classes.json").read_text(encoding="utf-8"))
    ok = reg.get("schema") == 1 and reg.get("classes")
    statuses = {k: v.get("status") for k, v in reg["classes"].items()}
    check("shipped registry parses", bool(ok), str(reg)[:200])
    check("every shipped class has a valid status",
          all(s in ("open", "fix-landed", "examized") for s in statuses.values()), str(statuses))


def main() -> int:
    for fn in (case1_empty, case2_below_threshold, case3_open_escalates, case4_fix_landed_passes,
               case5_deadline_passed, case6_unknown_class, case7_chain_tamper, case8_raw_events_count,
               case9_examized_requires_item, case10_real_registry_sane):
        fn()
    print(f"# pass {passed} / # fail {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
