#!/usr/bin/env python3
"""audit_rounds.py — mechanical stop-loss for repeated blind audits of one document.

Why keyed by document, not by artifact hash: a per-hash cap never fires when the author
edits between rounds, because every edit mints a new hash. The loop the owner objected to
was exactly that pattern (eleven rounds, each a "new" artifact). The cap therefore counts
rounds per (generation, document); the artifact hash is recorded for the trail.

Usage:
  audit_rounds.py check  --gen G67 --doc nomination
  audit_rounds.py record --gen G67 --doc nomination --sha <sha256> --run <runid> --verdict <v>

Exit: 0 allowed / recorded, 2 usage, 3 escalate to human.
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


def parse(argv: list[str]) -> tuple:
    if not argv or argv[0] not in ("check", "record"):
        return None, None
    opts: dict[str, str] = {}
    i = 1
    while i < len(argv):
        if argv[i].startswith("--") and i + 1 < len(argv):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            i += 1
    return argv[0], opts


def main() -> int:
    action, opts = parse(sys.argv[1:])
    if action is None:
        print("usage: audit_rounds.py check|record --gen <G> --doc <name> [...]", file=sys.stderr)
        return 2
    gen = opts.get("gen")
    doc = opts.get("doc")
    if not gen or not doc:
        print("audit_rounds: --gen and --doc are required", file=sys.stderr)
        return 2
    prior = [r for r in rows() if r.get("gen") == gen and r.get("doc") == doc]
    if action == "check":
        n = len(prior)
        print(f"AUDIT-ROUNDS {gen}/{doc} used={n} cap={MAX_ROUNDS}")
        if n >= MAX_ROUNDS:
            print("AUDIT-ROUNDS ESCALATE-TO-HUMAN (cap reached; another round is a loop)")
            return 3
        return 0
    sha = opts.get("sha")
    run = opts.get("run")
    verdict = opts.get("verdict")
    if not run or not verdict:
        print("audit_rounds: record needs --run and --verdict", file=sys.stderr)
        return 2
    if sha and not SHA.match(sha.lower()):
        print(f"audit_rounds: not a sha256: {sha!r}", file=sys.stderr)
        return 2
    row = {
        "at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "gen": gen,
        "doc": doc,
        "artifact_sha256": (sha or "").lower() or None,
        "run": run,
        "verdict": verdict,
        "round": len(prior) + 1,
    }
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"AUDIT-ROUNDS recorded {gen}/{doc} round={row['round']} run={run} verdict={verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
