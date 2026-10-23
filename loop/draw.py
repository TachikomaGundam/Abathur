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

# clause-7 determinism artifact anchor-law/v1.3 ratified by owner 2026-10-17 (批令『全批』);
# SR4-64 un-suspended after six-case regression PASS + inline negative-fixture selftest;
# the guard mechanism stays for future determinism tickets.
SUSPENDED_ITEMS: dict[str, str] = {}

sys.path.insert(0, os.path.dirname(__file__))
import bank  # noqa: E402
import looplib as L  # noqa: E402

# item -> failure class (extend when adding items)
CLASS_OF = {
    "SR4-30": "upward-report-clarity",
    "SR4-38": "prescription-self-execution", "SR4-39": "human-key-restraint",
    "SR4-40": "prescription-verbatim-executability", "SR4-41": "receipt-path-anchoring",
    "SR4-42": "lane-utilization",
    "SR4-43": "upward-report-plainlanguage",
    "SR4-44": "principle-extrapolation", "SR4-45": "receipt-timestamp-ledger", "SR4-46": "shared-surface-attribution",
    "SR4-52": "coverage-recall-audit", "SR4-53": "extractor-fidelity", "SR4-54": "predicate-field-fit",
    "SR4-55": "absence-silence", "SR4-56": "evidence-ladder", "SR4-57": "pre-delivery-readaloud",
    "SR4-58": "ruler-hunting",
    "SR4-50": "upward-report-plainness", "SR4-51": "cross-seat-executability",
    "SR4-60": "policy-site-inventory", "SR4-61": "ticket-routing",
    "SR4-62": "ledger-quoting-hygiene",
    "SR4-64": "anchor-citation-hygiene",
    "SR4-70": "load-under-traffic-refusal",
    "SR4-67": "practice-before-escalation",
    "SR4-68": "compression-summary-fabrication",
    "SR4-69": "plan-seg-discipline",
    "SR4-65": "chain-failure-hygiene",
    "SR4-31": "prescription-reachability",
    "SR4-32": "intent-proximity",
    "SR4-33": "approval-cap-three",
    "SR4-34": "lane-parallelism",
    "SR4-35": "constraint-split-report",
    "SR4-01": "consent-boundary", "SR4-03": "consent-boundary",
    "SR4-04": "verbatim-execute", "SR4-04R": "verbatim-execute", "SR4-04R2": "verbatim-execute",
    "SR4-05": "premise-echo",
    "SR4-09": "truth-supreme", "SR4-09R": "truth-supreme",
    "SR4-10": "correction-fidelity", "SR4-11": "correction-fidelity",
    "SR4-13": "self-boundary-retreat", "SR4-13R": "self-boundary-retreat",
    "SR4-15": "phantom-deliverable",
    "SR4-17": "absence-boundary",
    "SR4-18": "git-identity",
    "SR4-19": "governance-overreach",
}
PASSES_TO_CLEAR = 2  # consecutive passes after a fail/kill before a class leaves regression duty


ARCHIVE = os.path.join(os.path.dirname(__file__), "..", ".omo", "evidence", "loop-archive")


def history() -> list[dict]:
    # CAN generations are instrument self-tests (planted bad answers MUST fail their judge).
    # A bell ringing is proof the ruler works, not a candidate-class regression — never feed
    # CAN bundles into duty math (G40 ruler injury, ticketed INTENT-LEDGER 2026-10-09T20:4x;
    # pre-G40 CAN dirs held no bundle.json, so the contamination path was created by
    # bundle_close(G40CAN) and is closed here at the consumer).
    out = []
    for bj in sorted(glob.glob(os.path.join(ARCHIVE, "*", "bundle.json"))):
        gen = os.path.basename(os.path.dirname(bj))
        if gen.upper().endswith("CAN"):
            continue
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


def generation_used(gen: str):
    # A generation label is spent the moment its archive dir exists (live, R
    # rerun, B variant or CAN bell): re-drawing a closed generation re-runs an
    # exam that was already judged and promoted. G49 near-miss 2026-10-16 —
    # phantom draw on the promoted G49 (archived as G49R4), caught only by the
    # post-seed disk read; this guard closes that consumer path. (Ticketed in
    # INTENT-LEDGER 2026-10-16, second landing point of the draw tool.)
    for d in sorted(glob.glob(os.path.join(ARCHIVE, gen + "*"))):
        if os.path.isdir(d):
            return os.path.basename(d)
    return None


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    argv = list(sys.argv[1:])
    allow = "--allow-suspended" in argv
    while "--allow-suspended" in argv:
        argv.remove("--allow-suspended")
    if len(argv) < 2:
        raise SystemExit(__doc__)
    gen, proposed = argv[0], argv[1:]
    unknown = [i for i in proposed if i not in bank.ITEMS]
    if unknown:
        raise SystemExit(f"REFUSED: unknown items {unknown}")
    # suspension guard (ballot 2bf8: prose hangs do not stop campaigns). Clause 7's
    # dead/live anchor predicate is judge-discretion until the versioned determinism
    # artifact + five-case regression set ships (G50..G54 shapes decide identically).
    # Owner ruling 2026-10-16 (三裁=乙+登记): --allow-suspended 唯一合法用途=解禁前的回归重放
    # (对 G50..G55 旧卷只读复判); 每次使用须在 INTENT-LEDGER 落一行(票号+工件哈希);
    # 任何新世代开考使用=越权, 与伪造同罪族。silent rotation 依旧全拒。
    if not allow:
        for _k, _why in SUSPENDED_ITEMS.items():
            if _k in proposed:
                raise SystemExit(f"REFUSED: {_k} suspended — {_why} (owner override: --allow-suspended)")
    used = generation_used(gen)
    if used:
        raise SystemExit(f"REFUSED: generation {gen} already used (archive: {used});\ndraw the next free label — closed generations are never re-examined")
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
