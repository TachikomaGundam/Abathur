#!/usr/bin/env python3
"""Check every quotable literal in a nomination page against disk.

Why: G65/G66 nominations each shipped a value I wrote from memory instead of
from a probe (a session id, then a closed_at timestamp).  The class is exactly
what SR4-64 (anchor-citation-hygiene) tests, and it recurred twice in one file,
so the fix is an instrument, not another careful read.

Usage:
  python3 loop/verify_nomination_literals.py .omo/evidence/loop-archive/G66/NOMINATION.md \
      --roots .omo/evidence/loop-archive/G66 .omo/evidence/loop-archive/G66CAN loop /tmp

For every sha256 (64 hex) and ISO-8601 timestamp found in the nomination, the
script looks for the same literal in the given roots (text files, <= 4 MiB).
A literal with no hit is reported UNMATCHED and the exit code is 1.

This proves only *co-location*, not attribution: a matched timestamp may still
belong to a different file than the sentence claims.  The script prints the
first matching path per literal so that attribution can be checked by eye, and
it prints line numbers in the nomination so corrections are cheap.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SHA = re.compile(r"\b[0-9a-f]{64}\b")
SHA_PREFIX = re.compile(r"\b[0-9a-f]{8,63}(?=[.\u2026])")
ISO = re.compile(r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\b")
MAX_BYTES = 4 * 1024 * 1024


def haystack(roots: list[Path]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for root in roots:
        if root.is_file():
            files = [root]
        else:
            files = [p for p in root.rglob("*") if p.is_file()]
        for p in files:
            try:
                if p.stat().st_size > MAX_BYTES:
                    continue
                out.append((str(p), p.read_text(encoding="utf-8", errors="replace")))
            except OSError:
                continue
    return out


def file_digests(roots: list[Path]) -> dict[str, str]:
    """sha256 of every file under the roots: literal -> path.

    A nomination legitimately quotes the hash OF A FILE (e.g. the judge tool at
    pack time).  Literal search cannot see that, so hashes are re-computed.
    """
    out: dict[str, str] = {}
    for root in roots:
        files = [root] if root.is_file() else [p for p in root.rglob("*") if p.is_file()]
        for p in files:
            try:
                if p.stat().st_size > MAX_BYTES:
                    continue
                out[hashlib.sha256(p.read_bytes()).hexdigest()] = str(p)
            except OSError:
                continue
    return out


def commit_times() -> dict[str, str]:
    """committer dates (UTC ISO) of the current branch history: literal -> commit.

    A nomination quoting a commit timestamp is quoting git metadata, not file
    text.  Only used when the repo is reachable; absent git is not an error.
    """
    out: dict[str, str] = {}
    try:
        proc = subprocess.run(
            ["git", "log", "--format=%cI %H", "-n", "400"],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return out
    if proc.returncode != 0:
        return out
    for line in proc.stdout.splitlines():
        parts = line.split()
        if not parts:
            continue
        # %cI keeps the committer's local offset; nominations quote UTC. Normalise.
        try:
            stamp = datetime.fromisoformat(parts[0]).astimezone(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            stamp = parts[0].replace("+00:00", "Z")
        out[stamp] = parts[1] if len(parts) > 1 else "?"
    return out


REPO = Path(__file__).resolve().parent.parent


def _facts_verdict(probe: str, entry: dict) -> tuple[str, str]:
    source = str(entry.get("source", ""))
    how = str(entry.get("how", ""))
    path = Path(source)
    if how.startswith("sha256 of file bytes"):
        if not path.is_file():
            return "MISMATCH", f"source missing {source}"
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest == probe or digest.startswith(probe):
            return "RECOMPUTED", f"sha256 {source}"
        return "MISMATCH", f"{source} hashes to {digest[:16]}"
    if how.startswith("git log -1"):
        proc = subprocess.run(["git", "log", "-1", "--format=%h", "--", source],
                              cwd=str(REPO), capture_output=True, text=True)
        got = proc.stdout.strip()
        if proc.returncode == 0 and got and (got == probe or got.startswith(probe)):
            return "RECOMPUTED", f"git commit of {source}"
        return "MISMATCH", f"{source} last commit is {got or 'none'}"
    if path.is_file() and probe in path.read_text(encoding="utf-8", errors="replace"):
        return "PRESENT", source
    return "MISMATCH", f"neither {how} nor file text in {source}"


def verify_by_facts(lines: list[str], facts_map: dict) -> int:
    known = {str(k).rstrip("\u2026"): v for k, v in facts_map.items()}
    bad = rec = present = checked = 0
    for lineno, line in enumerate(lines, 1):
        lits: list[str] = []
        lits += SHA.findall(line)
        lits += [m + "\u2026" for m in SHA_PREFIX.findall(line)]
        lits += ISO.findall(line)
        for lit in dict.fromkeys(lits):
            checked += 1
            probe = lit.rstrip("\u2026")
            entry = known.get(probe)
            if entry is None:
                bad += 1
                print(f"UNREGISTERED line {lineno:>3} {lit}")
                continue
            verdict, why = _facts_verdict(probe, entry)
            if verdict == "RECOMPUTED":
                rec += 1
                print(f"RECOMPUTED line {lineno:>3} {lit} <- {why}")
            elif verdict == "PRESENT":
                present += 1
                print(f"PRESENT     line {lineno:>3} {lit} <- verbatim in {why}")
            else:
                bad += 1
                print(f"MISMATCH    line {lineno:>3} {lit} <- {why}")
    print(f"\nchecked={checked} recomputed={rec} present={present} bad={bad} facts={len(facts_map)}")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("nomination")
    ap.add_argument("--roots", nargs="+")
    ap.add_argument("--facts")
    args = ap.parse_args()

    nom = Path(args.nomination)
    lines = nom.read_text(encoding="utf-8").splitlines()
    if args.facts:
        facts = json.loads(Path(args.facts).read_text(encoding="utf-8"))
        return verify_by_facts(lines, facts.get("facts", {}))
    if not args.roots:
        ap.error("one of --roots or --facts is required")
    root_paths = [Path(r) for r in args.roots]
    bodies = haystack(root_paths)
    digests = file_digests(root_paths)
    commits = commit_times()

    bad = 0
    checked = 0
    for lineno, line in enumerate(lines, 1):
        lits: list[str] = []
        lits += SHA.findall(line)
        lits += [m + "\u2026" for m in SHA_PREFIX.findall(line)]
        lits += ISO.findall(line)
        for lit in dict.fromkeys(lits):
            checked += 1
            probe = lit.rstrip("\u2026")
            hits = [path for path, body in bodies if probe in body and not path.endswith(nom.name)]
            if hits:
                print(f"OK       line {lineno:>3} {lit} <- {hits[0]}")
                continue
            if probe in digests:
                print(f"OK-HASH  line {lineno:>3} {lit} <- sha256 of {digests[probe]}")
                continue
            prefix_hits = [p for d, p in digests.items() if d.startswith(probe)]
            if prefix_hits:
                print(f"OK-HASH  line {lineno:>3} {lit} <- sha256 prefix of {prefix_hits[0]}")
                continue
            if probe in commits:
                print(f"OK-COMMIT line {lineno:>3} {lit} <- git commit {commits[probe][:12]}")
                continue
            bad += 1
            print(f"UNMATCH  line {lineno:>3} {lit}   (no file text, no file digest, no commit date)")
    print(f"\nchecked={checked} unmatched={bad} roots={len(bodies)} files digests={len(digests)} commits={len(commits)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
