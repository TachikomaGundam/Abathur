#!/usr/bin/env python3
"""r17 pcb placement gate: kicad-cli DRC must report 0 error-level violations.
unconnected_items are EXPECTED pre-routing (counted, not failing)."""
import json, subprocess, sys, os, tempfile
board = sys.argv[1]
assert board.endswith(".kicad_pcb")
pro = board[:-10] + ".kicad_pro"
if not os.path.exists(pro):
    print("FAIL no sibling .kicad_pro (design constraints live there)"); sys.exit(1)
with tempfile.TemporaryDirectory() as td:
    out = os.path.join(td, "drc.json")
    r = subprocess.run(["kicad-cli", "pcb", "drc", board, "--format", "json",
                        "--severity-error", "--output", out], capture_output=True, text=True)
    if r.returncode or not os.path.exists(out):
        print(f"FAIL load/drc rc={r.returncode} {r.stderr[:200]}"); sys.exit(1)
    d = json.load(open(out))
    v = d.get("violations", [])
    u = d.get("unconnected_items", [])
    if v:
        print(f"FAIL DRC err={len(v)}")
        for x in v[:8]: print("  ", x.get("description", "")[:100])
        sys.exit(1)
    print(f"PASS placement-DRC 0 errors; pending-route unconnected={len(u)}")
