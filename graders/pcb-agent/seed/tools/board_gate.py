#!/usr/bin/env python3
"""r17 board gate: ERC-clean + netlist-exact roundtrip for an authored sheet.
Exit 0 only when: ERC 0 errors, 0 unconnected, and EVERY spec net appears in the
export with EXACTLY its spec membership (and no extra nets). Closes the r13 D1
defect class deterministically (no model in the byte path)."""
import json, re, subprocess, sys, tempfile, os
from collections import defaultdict

def main(sch, netlist_json):
    spec = json.load(open(netlist_json))
    got = defaultdict(set)
    for c in spec["components"]:
        for p, net in c["pins"].items():
            got[net].add(f"{c['ref']}.{p}")
    with tempfile.TemporaryDirectory() as td:
        erc = os.path.join(td, "erc.json"); net = os.path.join(td, "netlist.net")
        r1 = subprocess.run(["kicad-cli", "sch", "erc", sch, "--format", "json",
                             "--severity-error", "--output", erc], capture_output=True, text=True)
        r2 = subprocess.run(["kicad-cli", "sch", "export", "netlist", sch, "-o", net],
                            capture_output=True, text=True)
        if r1.returncode or not os.path.exists(erc):
            print(f"FAIL ERC_RUN rc={r1.returncode} {r1.stderr[:200]}"); return 1
        if r2.returncode or not os.path.exists(net):
            print(f"FAIL EXPORT rc={r2.returncode} {r2.stderr[:200]}"); return 1
        d = json.load(open(erc))
        sh = d["sheets"][0].get("erc", {})
        v, u = sh.get("violations", []), sh.get("unconnected", [])
        if v or u:
            print(f"FAIL ERC violations={len(v)} unconnected={len(u)}")
            for x in v[:6]: print("  ", json.dumps(x)[:180])
            return 1
        txt = open(net).read()
        # parenthesis-balanced extraction of each (net ...) block (regex cannot
        # nest; truncation risk seen in dev round — never parse s-exprs with a
        # lazy match across closers).
        exp = defaultdict(set)
        i = 0
        while True:
            i = txt.find("(net\n", i)
            if i < 0: break
            depth = 0; j = i; instr = False
            while j < len(txt):
                ch = txt[j]
                if ch == '"' and txt[j-1] != "\\": instr = not instr
                elif not instr:
                    if ch == "(": depth += 1
                    elif ch == ")":
                        depth -= 1
                        if depth == 0: break
                j += 1
            block = txt[i:j+1]
            m = re.search(r'\(name "([^"]+)"\)', block)
            if m:
                for ref, pin in re.findall(r'ref "([^"]+)"\)\s*\(\s*pin "([^"]+)"', block):
                    exp[m.group(1)].add(f"{ref}.{pin}")
            i = j + 1
        miss = {n for n in got if exp.get(n) != got[n]}
        extra = set(exp) - set(got)
        if miss or extra:
            print(f"FAIL ROUNDTRIP {len(got)-len(miss)}/{len(got)} exact extra_nets={sorted(extra)[:5]}")
            for n in sorted(miss)[:6]:
                print("  DIFF", n, "spec-only", sorted(got[n]-exp.get(n, set()))[:3],
                      "exp-only", sorted(exp.get(n, set())-got[n])[:3])
            return 1
        print(f"PASS erc=0/0 nets={len(got)}/{len(got)} exact (members {sum(len(x) for x in got.values())} pins)")
        return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
