#!/usr/bin/env python3
"""Contract tests for instrument_defects.py (design v2 rules that must not drift)."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import instrument_defects as ID  # noqa: E402

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def head(rev: str = "HEAD") -> str:
    return subprocess.run(["git", "-C", str(ID.ROOT), "rev-parse", rev],
                          capture_output=True, text=True).stdout.strip()


def base_entry(**over: object) -> dict:
    rev = head()
    con = ID.blob_sha256(rev, "AGENTS.md")
    e = {
        "gen": "G-TEST", "defect_id": "INS-TEST-1", "class": "other",
        "affected_items": [], "affected_paths": ["docs/README-test-only.md"],
        "introduced_at": rev, "fixed_at": rev,
        "probe_before": {"cmd": "true", "rc": 0, "output_sha256": "a" * 64},
        "probe_after": {"cmd": "true", "rc": 0, "output_sha256": "b" * 64},
        "contract": {"path": "AGENTS.md", "blob_sha256": con},
    }
    e.update(over)
    return e


def main() -> int:
    tmp = Path(tempfile.mkdtemp()) / "instrument-defects.jsonl"

    check("judgement path derives blocking",
          ID.derive_severity({"affected_paths": ["loop/run_judge.py"], "affected_items": []}) == "blocking")
    check("unrelated path derives hygiene",
          ID.derive_severity({"affected_paths": ["docs/x.md"], "affected_items": []}) == "hygiene")

    ok, msgs = ID.validate_entry({**base_entry(), "severity": "blocking"})
    check("severity laundering refused", not ok and any("laundering" in m for m in msgs), str(msgs))

    e = base_entry()
    e["probe_after"] = dict(e["probe_before"])
    ok, msgs = ID.validate_entry(e)
    check("vacuous probe pair refused", not ok and any("vacuous" in m for m in msgs), str(msgs))

    ok, msgs = ID.validate_entry(base_entry(affected_paths=["loop/run_judge.py"]))
    check("blocking without auditor refused", not ok and any("auditor" in m for m in msgs), str(msgs))

    rec = ID.append(base_entry(), ledger=tmp)
    check("hygiene append derives and chains",
          rec["severity"] == "hygiene" and rec["prev"] == ID.GENESIS and tmp.is_file())

    ok, _ = ID.chain_ok(tmp)
    check("chain verifies after append", ok)

    lines = tmp.read_text().splitlines()
    tampered = json.loads(lines[0])
    tampered["claim"] = "rewritten after the fact"
    tmp.write_text(json.dumps(tampered) + "\n")
    ok, msgs = ID.chain_ok(tmp)
    check("tamper detected", not ok and any("sha256" in m for m in msgs), str(msgs))

    print(f"# fail={len(FAILS)}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
