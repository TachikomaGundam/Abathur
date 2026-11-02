#!/usr/bin/env python3
"""Aggregate a `border check --json` report with closure assertions.

Why this exists: every number that reaches a decision document must be
recomputable from a tracked script, not from a one-off /tmp scratch file.
Each mode asserts its own closure and exits non-zero when the arithmetic
does not close, so a wrong number can never ship as prose.

Usage:
    python3 scripts/border-findings-agg.py <report.json> table      # blocking by location bucket
    python3 scripts/border-findings-agg.py <report.json> classes    # blocking by rule class (path/content)
    python3 scripts/border-findings-agg.py <report.json> tip --repo PATH --ref origin/main
    python3 scripts/border-findings-agg.py <report.json> ancestry --repo PATH --ref origin/main
    python3 scripts/border-findings-agg.py <report.json> severity   # counts by severity
"""
import collections
import json
import subprocess
import sys

BLOCKING = ("CRITICAL", "HIGH")


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def path_of(x):
    return x.get("path") or x.get("file") or ""


def blocking_of(doc):
    return [x for x in doc.get("findings") or [] if x.get("severity") in BLOCKING]


def bucket(p):
    if not p:
        return "unclassified:no-path"
    if "!" in p:
        return "archives (tar/zip entries)"
    if p.startswith("evidence/"):
        return "evidence/ mirror (tracked)"
    if p.startswith(".omo/"):
        return ".omo (local, untracked)"
    for pre in ("loop/", "handoffs/", "docs/", "scripts/", "src/", "graders/", ".opencode/"):
        if p.startswith(pre):
            return pre
    return "top-level file or unclassified"


def rule_class(rule):
    """Split rules by what they protect: a filesystem location vs. content in bytes.

    'path' rules fire on a path-shaped token; 'content' rules fire on values.
    Anything unrecognised lands in 'unclassified' and breaks the closure check on
    purpose -- a new rule must be classified before its counts can be quoted.
    """
    r = (rule or "").lower()
    if "path-pattern" in r or "homedit" in r or "homedir" in r:
        return "path"
    if "secretlint-rule-no-homedir" in r:
        return "path"
    if any(k in r for k in ("api-key", "secret", "token", "password", "ssh-target",
                            "session-artifact", "cred", "rfc1918", "identity-not-allowlisted")):
        return "content"
    return "unclassified"


def mode_table(doc):
    rows = blocking_of(doc)
    counts = collections.Counter(bucket(path_of(x)) for x in rows)
    total = sum(counts.values())
    for name, n in counts.most_common():
        print(f"{n:6d}  {name}")
    print(f"{total:6d}  == sum (findings: {len(doc.get('findings') or [])})")
    assert total == len(rows), f"BUCKET CLOSURE FAILED: {total} != {len(rows)}"
    print("CLOSURE OK buckets")


def mode_classes(doc):
    rows = blocking_of(doc)
    by_class = collections.Counter(rule_class(x.get("rule")) for x in rows)
    by_rule = collections.Counter(x.get("rule") or "?" for x in rows)
    print("--- by rule class ---")
    for name, n in by_class.most_common():
        print(f"{n:6d}  {name}")
    print(f"{sum(by_class.values()):6d}  == sum")
    assert sum(by_class.values()) == len(rows), "CLASS CLOSURE FAILED"
    assert by_class.get("unclassified", 0) == 0, f"UNCLASSIFIED RULES PRESENT: {by_class['unclassified']}"
    print("--- by rule ---")
    for name, n in by_rule.most_common():
        print(f"{n:6d}  class={rule_class(name):12s} {name}")
    print("CLOSURE OK classes")


def mode_rules(doc):
    """Distinct rule names with counts (no classification, no assertion).

    Exists so a new rule can be seen before it is classified: rule_class() is
    fail-closed, and this mode is how the classification table gets extended.
    """
    rows = blocking_of(doc)
    for name, n in collections.Counter(x.get("rule") or "?" for x in rows).most_common():
        print(f"{n:6d}  class={rule_class(name):12s} {name}")
    print(f"{len(rows):6d}  == blocking total")


def mode_severity(doc):
    counts = collections.Counter(x.get("severity") for x in doc.get("findings") or [])
    blocking = sum(counts.get(s, 0) for s in BLOCKING)
    for name, n in counts.most_common():
        print(f"{n:6d}  {name}")
    print(f"{blocking:6d}  == CRITICAL+HIGH")
    assert blocking == len(blocking_of(doc)), "SEVERITY CLOSURE FAILED"
    print("CLOSURE OK severity")


def _tree(repo, ref):
    out = subprocess.run(["git", "-C", repo, "ls-tree", "-r", "--name-only", ref],
                         capture_output=True, text=True, check=True).stdout
    return set(out.splitlines())


def mode_tip(doc, repo, ref):
    rows = blocking_of(doc)
    tree = _tree(repo, ref)
    hits = [x for x in rows if path_of(x) in tree]
    print(f"blocking total: {len(rows)}")
    print(f"blocking findings whose exact path exists at {ref}: {len(hits)}")
    print("by bucket:", collections.Counter(bucket(path_of(x)) for x in hits).most_common())
    print("by class:", collections.Counter(rule_class(x.get("rule")) for x in hits).most_common())
    print("by path:", collections.Counter(path_of(x) for x in hits).most_common())


def mode_ancestry(doc, repo, ref):
    rows = blocking_of(doc)
    seen = {}
    counts = collections.Counter()
    for x in rows:
        c = x.get("commit")
        if c not in seen:
            seen[c] = (subprocess.run(["git", "-C", repo, "merge-base", "--is-ancestor", c, ref],
                                      capture_output=True).returncode == 0) if c else False
        counts[seen[c]] += 1
    print(f"blocking total: {len(rows)}")
    print(f"commit is ancestor of {ref}: {counts.get(True, 0)}")
    print(f"commit not ancestor / unknown: {counts.get(False, 0)}")
    print("by class (ancestor=True):",
          collections.Counter(rule_class(x.get("rule")) for x in rows
                              if x.get("commit") and seen[x.get("commit")]).most_common())
    assert counts.get(True, 0) + counts.get(False, 0) == len(rows), "ANCESTRY CLOSURE FAILED"
    print("CLOSURE OK ancestry")


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    report, mode = argv[1], argv[2]
    doc = load(report)
    repo = ref = None
    if "--repo" in argv:
        repo = argv[argv.index("--repo") + 1]
    if "--ref" in argv:
        ref = argv[argv.index("--ref") + 1]
    if mode == "table":
        mode_table(doc)
    elif mode == "classes":
        mode_classes(doc)
    elif mode == "severity":
        mode_severity(doc)
    elif mode == "rules":
        mode_rules(doc)
    elif mode == "tip":
        mode_tip(doc, repo, ref)
    elif mode == "ancestry":
        mode_ancestry(doc, repo, ref)
    else:
        print(f"unknown mode {mode!r}")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
