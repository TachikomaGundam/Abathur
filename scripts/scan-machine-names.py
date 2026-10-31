#!/usr/bin/env python3
"""scan-machine-names.py — refuse machine-specific tool names in executable code.

Why: the seat twice hard-coded this box's gate tool into repo code. A rule that only
asks people to be careful does not survive; a scanner does. This checks code surfaces
(scripts/, loop/, src/, .opencode/, skills/) for a closed list of local machine facts and
fails when one appears outside an allow-list of comments naming why.

Allow-list: a line may carry a machine name when it also carries ALLOW-MACHINE-NAME with a
reason after it, or when the file is historical evidence (docs/, .omo/evidence/).

Usage: scripts/scan-machine-names.py [--json]
Exit: 0 clean (or only allowed hits), 1 violations, 2 cannot answer.
"""
import fnmatch
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCAN_DIRS = ["scripts", "loop", "src", ".opencode", "skills"]
SUFFIXES = {".py", ".mjs", ".js", ".sh", ".ts", ".jsonc", ".json", ".md"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "__pycache__", ".omo"}

# Closed list of machine facts that must not be hard-coded in code. Extend only with a
# reason, so the list itself is auditable.
PATTERNS = [
    (r"\bborder\b(?!-|ed|ing)", "gate tool of this box"),
    (r"/home/lab/workspace/harness/[A-Za-z0-9_-]+", "absolute path to a sibling repo"),
    (r"/home/lab/workspace/harness/[A-Za-z0-9_-]+", "absolute path to a sibling repo"),
    (r"/home/lab/\.npm-global", "this box's install prefix"),
    (r"1456\d{2}\b", "bundled fallback port"),
    (r"\bnpu[0-9]\b", "this box's accelerator cores"),
    (r"local-qwen|qwen3\.8-flash-next", "this box's served model name"),
]
# Files whose machine names are historical record or exam fixtures, not coupling. Each
# entry states why: the scanner prints this list so the exemptions are auditable.
EXEMPT = {
    "loop/bank.py": "exam question bank: quotes past incidents as content",
    "scripts/test_rule2_fixtures.py": "test fixtures: machine names are the input under test",
    "loop/bell_hgf_five.py": "bell fixture: the probe is required to touch box paths",
    "scripts/check-frozen-a.sh": "release check: absolute defaults for this box's own artifacts",
    "scripts/sandbox-blast-radius.mjs": "blast-radius probe: sibling paths are its input",
    "scripts/plain-watch.py": "ruler: regexes match machine names on purpose",
}
EXEMPT_GLOBS = ["loop/constitution_g*.md", "loop/proposals/*"]


def exempt(rel: str) -> str:
    if rel in EXEMPT:
        return EXEMPT[rel]
    for pat in EXEMPT_GLOBS:
        if fnmatch.fnmatch(rel, pat):
            return "historical design documents or frozen exam text: record, not code"
    return ""
REASON_MIN = 8
ALLOW = "ALLOW-MACHINE-NAME"


def hits(rel: Path, text: str):
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        if ALLOW in line:
            reason = line.split(ALLOW, 1)[1].strip(" :—-")
            if len(reason) >= REASON_MIN:
                continue
            out.append((rel, i, "allow-marker without a reason", line.strip()[:120]))
            continue
        for pat, why in PATTERNS:
            if re.search(pat, line):
                out.append((rel, i, why, line.strip()[:120]))
                break
    return out


def main() -> int:
    as_json = "--json" in sys.argv[1:]
    found = []
    exempted = []
    scanned = 0
    for d in SCAN_DIRS:
        base = REPO / d
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if not path.is_file() or path.suffix not in SUFFIXES:
                continue
            if path.resolve() == Path(__file__).resolve():
                continue  # the pattern list itself is the registry, not a coupling
            rel = str(path.relative_to(REPO))
            if exempt(rel):
                exempted.append({"file": rel, "why": exempt(rel)})
                continue
            parts = set(path.relative_to(REPO).parts)
            if parts & SKIP_DIRS:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                found.append((path.relative_to(REPO), 0, "unreadable", ""))
                continue
            scanned += 1
            found.extend(hits(path.relative_to(REPO), text))
    result = {"scanned": scanned, "violations": len(found),
              "exempted": exempted,
              "rows": [{"file": str(f), "line": n, "why": w, "text": t} for f, n, w, t in found]}
    print(json.dumps(result, ensure_ascii=False, indent=1))
    print(f"SCAN-END files={result.get('scanned')} findings={len(found)}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
