#!/usr/bin/env python3
"""check-citations.py <doc.md> [--strict-symbols] — verify every path:line citation.

Why: two audit rounds were rejected for citations that could not be recomputed
(a file that does not exist; line numbers past EOF). Prose-level correction failed
twice, so the check is mechanical and runs BEFORE a document is submitted to audit.

Checks, each fail-closed:
  1. the cited path exists (relative to repo root, or absolute);
  2. every cited line number is within the file's line count;
  3. with --strict-symbols: if the same markdown line also contains a backticked
     token, that token must appear in the cited source line.

Exit 0 = all citations recompute; 1 = at least one problem; 2 = bad usage.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CITE = re.compile(r"([\w][\w./-]*\.(?:py|sh|js|mjs|ts|md|json)):(\d+)(?:-(\d+))?")
TICK = re.compile(r"`([^`]+)`")


def source_lines(p: Path) -> list[str] | None:
    try:
        return p.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None


def resolve(raw: str) -> tuple[Path | None, str]:
    p = Path(raw)
    if p.is_absolute():
        return (p, "") if p.is_file() else (None, "absolute path missing")
    hits = [c for c in (ROOT / raw, ROOT / "loop" / raw, ROOT / "scripts" / raw) if c.is_file()]
    if not hits:
        return None, "cited path missing"
    if len(hits) > 1 and len({h.resolve() for h in hits}) > 1:
        return None, f"ambiguous bare name ({', '.join(str(h) for h in hits)})"
    return hits[0], ""


def check(doc: Path, strict_symbols: bool) -> list[str]:
    problems: list[str] = []
    for i, line in enumerate(doc.read_text(encoding="utf-8").splitlines(), 1):
        for m in CITE.finditer(line):
            raw, first, last = m.group(1), int(m.group(2)), m.group(3)
            p, why = resolve(raw)
            src = source_lines(p) if p else None
            if src is None:
                problems.append(f"{doc.name}:{i}: {raw}: {why}")
                continue
            hi = int(last) if last else first
            if first < 1 or hi > len(src):
                problems.append(f"{doc.name}:{i}: {raw}:{first}{'-' + last if last else ''} "
                                f"past EOF (file has {len(src)} lines)")
                continue
            if strict_symbols:
                ticks = [t.strip().strip("'\"") for t in TICK.findall(line)]
                idents = [t for t in ticks if re.fullmatch(r"[A-Za-z_][\w.]*", t)]
                span = "\n".join(src[first - 1:hi])
                near = [t for t in idents
                        if 0 <= m.start() - line.rfind(f"`{t}`") <= 40]
                if near and not any(t.split(".")[-1] in span for t in near):
                    problems.append(f"{doc.name}:{i}: {raw}:{first} does not contain "
                                    f"{near[-1]} (claimed symbol absent)")
    return problems


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    doc = Path(args[0])
    if not doc.is_absolute():
        doc = ROOT / doc
    if not doc.is_file():
        print(f"no such document: {doc}", file=sys.stderr)
        return 2
    problems = check(doc, "--strict-symbols" in argv)
    for p in problems:
        print("PROBLEM " + p)
    print(f"CITATIONS {'OK' if not problems else 'PROBLEMS'} doc={doc.name} problems={len(problems)}")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
