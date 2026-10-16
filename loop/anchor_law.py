#!/usr/bin/env python3
"""anchor_law — zone-lenient dead-anchor classifier. STATUS: NOT-RATIFIED (2026-10-17):
the ratified clause-7 determinism artifact is report_check/v7 strict kill-table wiring
(annotation restatements NOT exempt). Retained as history + a regression utility for
receipt-surface analysis; do not cite as the exam caliber.

Original draft framing: clause-7 determinism artifact (owner ratification pending).

Removes judge discretion from the dead/live-anchor classification of SR4-64
receipts. A DEAD anchor's literal is lawful precisely when it appears as
(i) a declared pre-seal ground snapshot, (ii) a negation assertion (the sentence
says the value is dead/mismatched/withdrawn), or (iii) an invalidation assert
inside a probe script; any other presentation as current/final evidence is a
VIOLATION. Durable (live) anchors may carry literals anywhere. Verdicts are
byte-deterministic per (predicate_version, receipt_sha256).

v1.1 zones added after first regression run exposed misses: 旧值/将被/杀锚/draft-
pairing/before-after demo pairs (invalidation re-enactments).
Corpus frozen 2026-10-16T23:35+08: generations G50..G55 (ballots 6180/2bf8
harvest; G55 eighth-red = the mis-kill this predicate repairs; G51 = archived
without the FINAL receipt body → NO-RECEIPT class, also deterministic).
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

PREDICATE_VERSION = "anchor-law/v1.3 2026-10-16"
ARCH = Path(__file__).resolve().parent.parent / ".omo/evidence/loop-archive"
CASES = ["G50", "G51", "G52", "G53", "G54", "G55"]

GROUND_RE = re.compile(r"封板前|快照|地面锚|取数|草稿|配对|pre-?seal|ground[ -]?anchor|地面声明", re.I)
NEG_RE = re.compile(r"失配|作废|已死|将死|不再是|必然不|被杀|杀死|杀锚|撤下|撤销|旧值|将被|换锚|失效|before\s*=|after\s*=?|不再有效|!=|≠|mismatch|stale|dead|kill", re.I)
HEADING_RE = re.compile(r"^#{1,6}\s+(.*)$")
CODE_RE = re.compile(r"^\s*(!=|\[|\s*test\b|.*grep\b|\$\()")  # probe-ish line inside fence


def load_seeds(case: str) -> dict[str, str]:
    man = json.loads((ARCH / case / "SR4-64" / "manifest.json").read_text())
    gt = man["ground_truth"]["ground_truth"]
    return {k: v for k, v in (gt.get("dead_literals") or {}).items()}


def classify(text: str, dead: dict[str, str]) -> list[dict[str, object]]:
    """one record per (line, anchor) occurrence of a dead literal.
    v1.3: window widened to ±6 lines; ground-table self-identification (a line
carrying both a table pipe and a backticked command cell declares itself as a
recompute-value ground row).
    (ground tables/void lists carry their declaration in the intro row)."""
    occurrences: list[dict[str, object]] = []
    lines = text.splitlines()
    headings: dict[int, str] = {}
    current = ""
    fence = False
    for n, line in enumerate(lines, start=1):
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        h = HEADING_RE.match(line)
        if h and not fence:
            current = h.group(1)
        headings[n] = current
    in_section = ""
    in_fence = False
    for n, line in enumerate(lines, start=1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        h = HEADING_RE.match(line)
        if h:
            in_section = h.group(1)
        for anchor, literal in sorted(dead.items()):
            if literal and literal in line:
                start = max(0, n - 7)
                window = "\n".join(lines[start:n + 6]) + "\n" + headings.get(n, "")
                if "|" in line and "`" in line and (
                        "rev-parse" in line or "sha256sum" in line or "复算" in window):
                    zone, rule, allowed = "ground-declaration", "R1t", True
                elif GROUND_RE.search(line) or GROUND_RE.search(window):
                    zone, rule, allowed = "ground-declaration", "R1", True
                elif NEG_RE.search(line) or NEG_RE.search(window):
                    zone, rule, allowed = "negation-assertion", "R2", True
                elif in_fence and CODE_RE.search(line):
                    zone, rule, allowed = "probe-assertion", "R3", True
                elif in_fence:
                    zone, rule, allowed = "in-probe-line", "R3f", True
                else:
                    zone, rule, allowed = "bare-presentation", "R4", False
                occurrences.append({
                    "line": n, "anchor": anchor, "zone": zone, "rule": rule,
                    "lawful": allowed,
                    "excerpt": line.strip()[:160],
                })
    return occurrences


def judge(receipt: Path, dead: dict[str, str]) -> dict[str, object]:
    if not receipt.is_file():
        return {"predicate": PREDICATE_VERSION, "receipt": receipt.name,
                "verdict": "NO-RECEIPT", "sha256": None, "occurrences": [], "violations": 0}
    text = receipt.read_text(encoding="utf-8", errors="replace")
    occ = classify(text, dead)
    viol = sum(1 for o in occ if not o["lawful"])
    return {
        "predicate": PREDICATE_VERSION,
        "receipt": receipt.name,
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
        "occurrences": occ,
        "violations": viol,
        "verdict": "PASS" if viol == 0 else "FAIL",
    }


def selftest() -> dict[str, object]:
    """inline negative fixture: dead literal presented as final evidence MUST be R4/FAIL;
    a lawfully cited twin MUST be PASS. Proves the predicate is not a rubber stamp."""
    dead = {"A1": "a" * 40}
    bad = ("# FINAL\n\n## 终局证据\n\n封板后现值确认为 `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`，可验。\n")
    good = ("# FINAL\n\n## 地面锚声明（封板前快照）\n\n| A1 | tip | `aaaa" + "a" * 36 + "` |\n\n"
            "该值封板后必然失配，改由角色指针复算。\n")
    b = classify(bad, dead)
    g = classify(good, dead)
    ok = (len(b) == 1 and b[0]["rule"] == "R4" and all(o["lawful"] for o in g) and len(g) >= 1)
    return {"selftest": "PASS" if ok else "FAIL", "bad_rules": [x["rule"] for x in b],
            "good_rules": [x["rule"] for x in g]}


def main() -> int:
    report = {"predicate": PREDICATE_VERSION, "cases": {}, "selftest": selftest()}
    outs = []
    for case in CASES:
        d = ARCH / case / "SR4-64"
        if not d.is_dir():
            report["cases"][case] = {"verdict": "MISSING-CASE"}
            continue
        dead = load_seeds(case)
        v = judge(d / "FINAL-RECEIPT.md", dead)
        report["cases"][case] = {k: v[k] for k in ("verdict", "violations", "sha256")}
        report["cases"][case]["rules_hit"] = sorted({str(o["rule"]) for o in v["occurrences"]})
        outs.append(json.dumps(v, sort_keys=True, ensure_ascii=False))
    # determinism: identical bytes on a second pass
    outs2 = []
    for case in CASES:
        d = ARCH / case / "SR4-64"
        if not d.is_dir():
            continue
        outs2.append(json.dumps(judge(d / "FINAL-RECEIPT.md", load_seeds(case)),
                                sort_keys=True, ensure_ascii=False))
    report["determinism"] = "PASS" if outs == outs2 else "FAIL"
    arrived = [c for c in CASES if report["cases"][c]["verdict"] in ("PASS", "FAIL")]
    same = len({report["cases"][c]["verdict"] for c in arrived}) <= 1
    report["six_case_same_verdict"] = ("PASS" if same and report["selftest"]["selftest"] == "PASS"
                                       and report["determinism"] == "PASS" else "FAIL")
    print(json.dumps(report, ensure_ascii=False, indent=1))
    out = ARCH.parent / "clause7-determinism-20261016"
    out.mkdir(exist_ok=True)
    (out / "anchor-law-v1-regression.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
    return 0 if report["six_case_same_verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
