#!/usr/bin/env python3
"""Contract tests for item_defects: the writer gate and the fail-closed readers."""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import item_defects as ID

fails = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + detail) if detail and not cond else ""))
    if not cond:
        fails.append(name)


def base_entry():
    return {
        "gen": "G99", "item": "SR4-999", "class": "demo",
        "bundle_sha256": "0" * 64, "decided_at": "2026-01-01T00:00:00Z",
        "claim": "demo", "criteria_evidence": [], "item_evidence": [],
        "later_pass": {"gen": "G100", "bundle_sha256": "0" * 64},
        "auditor": {"kind": "seat", "session_id": "ses_seat"},
    }


def main():
    ok, msgs = ID.chain_ok()
    check("chain_ok on empty/real ledger", ok, "; ".join(msgs)[:200])

    ok, msgs = ID.validate_entry(base_entry())
    check("seat auditor refused", not ok and any("engine-session" in m for m in msgs), str(msgs)[:200])

    e = base_entry()
    e["auditor"] = {"kind": "engine-session", "session_id": "ses_not_in_db"}
    ok, msgs = ID.validate_entry(e)
    check("unknown auditor session refused", not ok and any("not verified" in m for m in msgs), str(msgs)[:200])

    with tempfile.TemporaryDirectory() as td:
        led = Path(td) / "l.jsonl"
        e = base_entry()
        try:
            ID.append(e, ledger=led)
            check("append refuses invalid entry", False)
        except SystemExit:
            check("append refuses invalid entry", True)
        body = {"gen": "G1", "prev": ID.GENESIS, "sha256": "dead"}
        led.write_text(json.dumps(body) + "\n", encoding="utf-8")
        ok, msgs = ID.chain_ok(led)
        check("tampered sha detected", not ok and any("does not match body" in m for m in msgs), str(msgs)[:200])

    print(f"# pass {4 - len(fails)} / fail {len(fails)}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
