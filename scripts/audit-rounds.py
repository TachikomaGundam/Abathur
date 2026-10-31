#!/usr/bin/env python3
"""audit_rounds.py — mechanical stop-loss for repeated blind audits of one artifact.

The rule the owner set: a single artifact gets at most TWO blind-audit rounds; a third
is not a stricter check, it is a loop. This script records each submission and refuses
past the cap instead of leaving the decision to whoever is tired enough to keep going.

Usage:
  audit_rounds.py check  <artifact_sha256> [--gen G67]   # rc 0 allowed, 3 escalate
  audit_rounds.py record <artifact_sha256> --gen G67 --run <runid> --verdict <v>

Exit: 0 allowed / recorded, 2 usage or bad hash, 3 escalate to human.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOG = REPO / ".omo" / "evidence" / "audit-rounds.jsonl"
MAX_ROUNDS = 2
SHA = re.compile(r"^[0-9a-f]{64}$")


def rows() -> list[dict]:
    if not LOG.is_file():
        return []
    out = []
    for line in LOG.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def main() -> int:
    argv = sys.argv[1:]
    if len(argv) < 2 or argv[0] not in ("check", "record"):
        print("usage: audit_rounds.py check|record <sha256> [...]", file=sys.stderr)
        return 2
    sha = argv[1].strip().lower()
    if not SHA.match(sha):
        print(f"audit_rounds: not a sha256: {sha!r}", file=sys.stderr)
        return 2
    opts = {}
    rest = argv[2:]
    i = 0
    while i < len(rest):
        if rest[i].startswith("--") and i + 1 < len(rest):
            opts[rest[i][2:]] = rest[i + 1]
            i += 2
        else:
            i += 1
    prior = [r for r in rows() if r.get("artifact_sha256") == sha]
    if argv[0] == "check":
        n = len(prior)
        print(f"AUDIT-ROUNDS sha={sha[:12]} used={n} cap={MAX_ROUNDS}")
        if n >= MAX_ROUNDS:
            print("AUDIT-ROUNDS ESCALATE-TO-HUMAN (cap reached; a third round is a loop)")
            return 3
        return 0
    run = opts.get("run")
    verdict = opts.get("verdict")
    if not run or not verdict:
        print("audit_rounds: record needs --run and --verdict", file=sys.stderr)
        return 2
    row = {
        "at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "gen": opts.get("gen"),
        "artifact_sha256": sha,
        "run": run,
        "verdict": verdict,
        "round": len(prior) + 1,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"AUDIT-ROUNDS recorded round={row['round']} run={run} verdict={verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
