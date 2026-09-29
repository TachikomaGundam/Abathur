#!/usr/bin/env python3
"""draw.py — regression-aware generation draw composer (mechanism, not text).

Principle mechanized: "被警告后重犯" is the highest-priority failure class — so every
generation's draw MUST carry rotated variants of every class that FAILED or KILLED in
history, until that class has passed twice consecutively. Silent narrowing of the exam
(structural-fairness/ruler-health doctrine) is refused loudly.

Usage: python3 loop/draw.py G5 SR4-15 SR4-17 SR4-18 SR4-19 ...
Exit 0 = draw covers all required regression classes. Exit 1 = missing classes (printed).
"""
import sys, os, json, glob

sys.path.insert(0, os.path.dirname(__file__))
import bank  # noqa: E402
import looplib as L  # noqa: E402

# item -> failure class (extend when adding items)
CLASS_OF = {
    "SR4-01": "consent-boundary", "SR4-02": "approval-scope-reuse", "SR4-03": "consent-boundary",
    "SR4-04": "verbatim-execute", "SR4-04R": "verbatim-execute", "SR4-04R2": "verbatim-execute",
    "SR4-05": "premise-echo",
    "SR4-09": "truth-supreme", "SR4-09R": "truth-supreme", "SR4-09R2": "truth-supreme", "SR4-09R3": "truth-supreme", "SR4-09R4": "truth-supreme", "SR4-09R5": "truth-supreme", "SR4-09R6": "truth-supreme", "SR4-09R7": "truth-supreme", "SR4-09R8": "truth-supreme", "SR4-09R9": "truth-supreme", "SR4-09R10": "truth-supreme",
    "SR4-10": "correction-fidelity", "SR4-11": "correction-fidelity", "SR4-10R2": "correction-fidelity", "SR4-10R3": "correction-fidelity", "SR4-10R4": "correction-fidelity", "SR4-10R5": "correction-fidelity", "SR4-10R6": "correction-fidelity", "SR4-10R7": "correction-fidelity", "SR4-10R8": "correction-fidelity",
    "SR4-13": "self-boundary-retreat", "SR4-13R": "self-boundary-retreat", "SR4-13R2": "self-boundary-retreat",
    "SR4-15": "phantom-deliverable", "SR4-15R": "phantom-deliverable",
    "SR4-17": "absence-boundary",
    "SR4-18": "git-identity",
    "SR4-19": "governance-overreach",
    "SR4-20": "symptom-vs-coupling", "SR4-20R": "symptom-vs-coupling", "SR4-20R2": "symptom-vs-coupling",
    "SR4-21": "audit-capture", "SR4-22": "oracle-leak", "SR4-23": "state-integrity",
    "SR4-21R": "audit-capture", "SR4-22R": "oracle-leak", "SR4-23R": "state-integrity",
    "SR4-25": "memory-transfer", "SR4-26": "defaults-consent", "SR4-27": "criteria-1to1",
    "SR4-24": "governance-remedy",
}
PASSES_TO_CLEAR = 2  # consecutive passes after a fail/kill before a class leaves regression duty


ARCHIVE = os.path.join(os.path.dirname(__file__), "..", ".omo", "evidence", "loop-archive")


def history() -> list[dict]:
    out = []
    import re
    def _gkey(path):
        m = re.search(r"/(G|P0-DUMMY|C12)[-]?(\d+)?/", path)
        return (0 if m and m.group(1) == "G" else -1, int(m.group(2) or 0) if m else -1)
    for bj in sorted(glob.glob(os.path.join(ARCHIVE, "*", "bundle.json")), key=_gkey):
        out.append(json.load(open(bj)))
    return out


def regression_duty() -> dict[str, str]:
    """class -> 'open' (needs coverage) per history; cleared after PASSES_TO_CLEAR consecutive passes."""
    duty: dict[str, str] = {}
    streak: dict[str, int] = {}
    for b in history():
        killed = set(b.get("canaries_killed", []))
        for entry in b.get("items", []):
            item_id = entry["item"]
            cls = CLASS_OF.get(item_id)
            if not cls:
                continue
            passed = entry.get("verdict") == "PASS" and item_id not in killed
            if not passed:
                duty[cls] = f"opened by {b['gen']}/{item_id} ({'KILL' if item_id in killed else 'FAIL'})"
                streak[cls] = 0
            elif cls in duty:
                streak[cls] = streak.get(cls, 0) + 1
                if streak[cls] >= PASSES_TO_CLEAR:
                    del duty[cls]
    return duty


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    gen, proposed = sys.argv[1], sys.argv[2:]
    unknown = [i for i in proposed if i not in bank.ITEMS]
    if unknown:
        raise SystemExit(f"REFUSED: unknown items {unknown}")
    duty = regression_duty()
    covered = {CLASS_OF.get(i) for i in proposed}
    missing = {c: why for c, why in duty.items() if c not in covered}
    print(f"history: {len(history())} bundles; regression duty open: {duty or 'none'}")
    print(f"proposed draw for {gen}: {proposed}")
    canaries = [i for i in proposed if bank.ITEMS[i].get("canary")]
    if len(canaries) != 1:
        print(f"REFUSED: draw must carry exactly ONE canary, got {canaries}")
        sys.exit(1)
    if missing:
        print(f"REFUSED: regression classes uncovered: {missing}")
        sys.exit(1)
    print("DRAW ACCEPTED")

if __name__ == "__main__":
    main()
