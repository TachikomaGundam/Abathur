#!/usr/bin/env python3
"""seat_ledger.py — receipt-enforcing ledger writer (mechanizes E4/E6/E7 principles).

Principles mechanized:
- E4 (magi+self): write = replace+assert+read-back. This tool IS the write path.
- E6: ledger only records what is read-back-verified; batch claims need per-item evidence.
- E7: timestamps come from the system clock (taken by the tool, never by the author);
  pid claims are verified via ps AT WRITE TIME; file claims via os.stat/sha256.

Usage:
  python3 loop/seat_ledger.py note "text"                          # plain note (timestamp auto)
  python3 loop/seat_ledger.py claim "text" --pid 700824            # pid verified via ps
  python3 loop/seat_ledger.py claim "text" --file path             # file existence+size verified
  python3 loop/seat_ledger.py claim "text" --file path --sha256 xx # content verified
Exit 2 + nothing written if any verification fails. Fail-closed by construction.
"""
import sys, os, subprocess, hashlib, json
from datetime import datetime, timezone, timedelta

LEDGER = os.path.join(os.path.dirname(__file__), "..", ".omo", "evidence", "INTENT-LEDGER.md")

def now_str() -> str:
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%dT%H:%M:%S%z")

def verify_pid(pid: str) -> str:
    r = subprocess.run(["ps", "-p", pid, "--no-headers", "-o", "pid,etime,cmd"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        raise SystemExit(f"REFUSED: pid {pid} not alive (ps rc={r.returncode}) — nothing written")
    return r.stdout.strip()

def verify_file(path: str, sha256: str | None) -> str:
    if not os.path.exists(path):
        raise SystemExit(f"REFUSED: {path} does not exist — nothing written")
    size = os.path.getsize(path)
    info = f"{path} ({size}B)"
    if sha256:
        got = hashlib.sha256(open(path, "rb").read()).hexdigest()
        if not got.startswith(sha256):
            raise SystemExit(f"REFUSED: sha256 mismatch {got[:16]}… != {sha256}… — nothing written")
        info += f" sha256={got[:16]}…"
    return info

def main() -> None:
    args = sys.argv[1:]
    if len(args) < 2 or args[0] not in ("note", "claim"):
        raise SystemExit(__doc__)
    mode, text = args[0], args[1]
    evidences = []
    i = 2
    while i < len(args):
        if args[i] == "--pid":
            evidences.append(f"pid verified @write: `{verify_pid(args[i+1])}`"); i += 2
        elif args[i] == "--file":
            sha = None
            if i + 2 < len(args) and args[i+2] == "--sha256":
                sha = args[i+3]; i += 1
            evidences.append(f"file verified @write: {verify_file(args[i+1], sha)}"); i += 2
            if sha: i += 1
        else:
            raise SystemExit(f"unknown arg {args[i]}")
    if mode == "claim" and not evidences:
        raise SystemExit("REFUSED: claim mode requires at least one --pid/--file evidence — nothing written")
    ts = now_str()
    lines = [f"\n## {ts} — {text}"]
    for e in evidences:
        lines.append(f"- {e}")
    entry = "\n".join(lines) + "\n"
    with open(LEDGER, "a") as f:
        f.write(entry)
    # read-back: the entry must be physically present
    tail = open(LEDGER).read()[-len(entry) - 1:]
    assert ts in tail and text[:30] in tail, "read-back failed"
    print(f"ledger: wrote + read-back OK @ {ts}")

if __name__ == "__main__":
    main()
