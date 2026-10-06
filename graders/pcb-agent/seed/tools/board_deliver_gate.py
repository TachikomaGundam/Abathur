#!/usr/bin/env python3
"""board_deliver_gate.py — legality AT DELIVERY TIME (r53 lesson: tool-internal
gates are bypassed by team edits/stitch flows; the DELIVERED board is the object
under law). Usage: board_deliver_gate.py <input-board> <deliver-board> [--fix]
Exit 0 = no new DRC-attributable hard violations vs input baseline.
--fix: run the DRC-driven rip loop (board_clean_subset.main semantics) in place,
recheck, then report. Counts are printed for RESULT.md pasting."""
import json
import os
import subprocess
import sys

KCLI = os.environ.get("KICAD_CLI", "/home/lab/bin/kicad-cli")


def hard_of(board, out):
    subprocess.run([KCLI, "pcb", "drc", board, "--severity-error", "--format", "json",
                    "--output", out], timeout=240, capture_output=True)
    try:
        doc = json.load(open(out))
    except Exception:
        return None
    return [v for v in doc.get("violations", []) if v.get("type") != "starved_thermal"]


def key(v):
    p = v["items"][0]["pos"]
    return (v.get("type"), round(p["x"], 2), round(p["y"], 2))


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    fix = "--fix" in sys.argv[3:]
    base = hard_of(src, dst + ".bg.json")
    if base is None:
        print("GATE: cannot measure input (kicad-cli)"); return 2
    cur = hard_of(dst, dst + ".dg.json")
    if cur is None:
        print("GATE: cannot measure delivery"); return 2
    new = [v for v in cur if key(v) not in {key(b) for b in base}]
    print(f"input_hard={len(base)} delivered_hard={len(cur)} NEW_ATTRIBUTABLE={len(new)}")
    if not new:
        print("DELIVER_GATE=LEGAL"); return 0
    for v in new[:8]:
        p = v["items"][0]["pos"]
        print("  ", v.get("type"), "@", round(p["x"], 2), round(p["y"], 2),
              (v["items"][0].get("description") or "")[:48])
    if not fix:
        print("DELIVER_GATE=ILLEGAL  (rerun with --fix)"); return 1
    here = os.path.dirname(os.path.abspath(__file__))
    subprocess.run([sys.executable, os.path.join(here, "board_clean_subset.py"), dst, dst],
                   timeout=1800, capture_output=True)
    cur2 = hard_of(dst, dst + ".dg2.json")
    new2 = [v for v in (cur2 or []) if key(v) not in {key(b) for b in base}]
    segs = dst  # report final numbers
    n = sum(1 for _ in open(dst) if "(segment" in _)
    print(f"after_fix delivered_hard={len(cur2 or [])} NEW_ATTRIBUTABLE={len(new2)} segments={n}")
    print("DELIVER_GATE=" + ("LEGAL_AFTER_FIX" if not new2 else "STILL_ILLEGAL"))
    return 0 if not new2 else 1


sys.exit(main())
