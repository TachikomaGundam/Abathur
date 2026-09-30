#!/usr/bin/env python3
"""r17 deterministic schematic author (RM-56: netlist bytes NEVER through a model).
Topology: NO wires. Every pin gets one global label anchored EXACTLY on the pin
end, rotation 180 (text left, away from body). Anchor == pin end by construction;
no dangling labels (r13 D1 defect class), no collinear merges. Grid 0.635 mm.
Usage: board_author_sch.py netlist.json -o out.kicad_sch"""
import json, re, argparse
from collections import defaultdict

G = 0.635
COLPITCH = 99.06   # column pitch (41-pin U1 fans 52mm left of anchor col)
ROWPITCH = 76.2    # row pitch; keep > 2.54 * maxpins/2 stack of neighbours
PINPITCH = 2.54    # pin vertical spacing (label height 1.27 leaves 1.27 gap)


def snap(v):
    return round(v / G) * G


def esc(s):
    return str(s).replace("\\", "\\\\").replace('"', '\\"')


class Uuid:
    def __init__(self):
        self.n = 0

    def __call__(self):
        self.n += 1
        x = f"{self.n:032x}"
        return f"{x[:8]}-{x[8:12]}-{x[12:16]}-{x[16:20]}-{x[20:32]}"


def pin_order(pins):
    return sorted(pins, key=lambda p: int(p) if p.isdigit() else 0)


def build(netlist_path, out_path):
    d = json.load(open(netlist_path))
    comps = d["components"]
    u = Uuid()
    order = sorted(comps, key=lambda c: (c["ref"][0], int(re.sub(r"\D", "", c["ref"]) or 0)))
    pos = {}
    for slot, c in enumerate(order):
        row, col = divmod(slot, 4)
        pos[c["ref"]] = (snap(60 + col * COLPITCH), snap(60 + row * ROWPITCH))
    # symbol defs: single-sided fan-left, PINPITCH spacing
    prefix_pins = {}
    pinset = {}
    for c in order:
        ref = c["ref"]
        ps = pin_order(c["pins"])
        key = "SR_" + re.sub(r"\d+$", "", ref)
        if key in prefix_pins and prefix_pins[key] != ps:
            key = "SR_" + ref
        prefix_pins.setdefault(key, ps)
        c["_key"] = key
        sx, sy = pos[ref]
        n = len(ps)
        # world y-down vs lib-symbol-local y-UP: the def emits oy=+off (up) per
        # pin slot i; the label anchor in SHEET coords must therefore SUBTRACT.
        pinset[ref] = [(p, snap(sx - 5.08), snap(sy - ((n - 1) / 2 - i) * PINPITCH))
                       for i, p in enumerate(ps)]
    labels = []
    for c in order:
        for pnum, net in c["pins"].items():
            px, py = next((ax, ay) for (pp, ax, ay) in pinset[c["ref"]] if pp == pnum)
            labels.append((net, px, py))
    L = ['(kicad_sch (version 20250114) (generator "board_author_sch") (generator_version "10.0.5")',
         f'  (uuid "{u()}")', '  (paper "A3")', '  (lib_symbols']
    for key, ps in sorted(prefix_pins.items()):
        n = len(ps)
        L.append(f'    (symbol "solar_ray:{esc(key)}"')
        L.append('      (pin_numbers (hide yes))')
        L.append('      (pin_names (offset 1.016))')
        L.append('      (exclude_from_sim no) (in_bom yes) (on_board yes)')
        L.append('      (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))')
        L.append('      (property "Value" "V" (at 0 0 0) (effects (font (size 1.27 1.27))))')
        L.append('      (property "Footprint" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))')
        L.append('      (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))')
        L.append(f'      (symbol "{esc(key)}_1_1"')
        for i, p in enumerate(ps):
            oy = snap(((n - 1) / 2 - i) * PINPITCH)
            L.append(f'        (pin passive line (at {-5.08} {oy} 0) (length 5.08)'
                     f' (name "~" (effects (font (size 1.016 1.016))))'
                     f' (number "{esc(p)}" (effects (font (size 1.016 1.016)))))')
        L.append('      )')
        L.append('      (embedded_fonts no)')
        L.append('    )')
    L.append('  )')
    for c in order:
        ref = c["ref"]
        sx, sy = pos[ref]
        L.append(f'    (symbol (lib_id "solar_ray:{esc(c["_key"])}") (at {sx} {sy} 0) (unit 1)')
        L.append('      (exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no) (fields_autoplaced no)')
        L.append(f'      (uuid "{u()}")')
        for k, v, xo in (("Reference", ref, -2.54), ("Value", c.get("mpn", ref), 2.54),
                         ("Footprint", c.get("footprint", ""), 0.0), ("Datasheet", "", 0.0)):
            L.append(f'      (property "{k}" "{esc(v)}" (at {snap(sx+xo)} {snap(sy+5.08)} 0)'
                     f' (effects (font (size 1.27 1.27)) (hide yes)))')
        for (p, _, _) in pinset[ref]:
            L.append(f'      (pin "{esc(p)}" (uuid "{u()}"))')
        L.append('    )')
    for net, x, y in labels:
        L.append(f'    (global_label "{esc(net)}" (shape passive) (at {x} {y} 180)'
                 f' (effects (font (size 1.27 1.27)) (justify left)) (uuid "{u()}"))')
    L += ['  (sheet_instances', '    (path "/" (page "1"))', '  )', '  (embedded_fonts no)', ')']
    open(out_path, "w").write("\n".join(L) + "\n")
    return len(order), len(labels)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("netlist")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args()
    s, l = build(a.netlist, a.out)
    print(f"emitted {a.out}: symbols={s} labels={l}")
