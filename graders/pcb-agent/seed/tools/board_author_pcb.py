#!/usr/bin/env python3
"""r17 deterministic PCB author: netlist.json + spec footprints -> placed .kicad_pcb.
RM-56 doctrine: no bytes through a model. Embeds real .kicad_mod libs from the
KiCad AppDir, injects (net N "NAME") per pad (name-match, else positional match
with WARN), shelf placement by footprint bbox + clearance, Edge.Cuts rect.
DRC gate (board_gate_pcb.py) evaluates placement-class errors; unconnected_items
are expected pre-routing and reported separately."""
import json, re, os, sys
from collections import defaultdict

ALIASES = {}
_ali = os.path.join(os.path.dirname(os.path.abspath(__file__)), "board_author_aliases.json")
if os.path.exists(_ali):
    ALIASES = {tuple(k.split("|")): v for k, v in json.load(open(_ali)).items()}

FP_ROOT = "/home/lab/.local/AppDir/share/kicad/footprints"
PLACE_MARGIN = 3.0   # mm between footprint bboxes (courtyard-ish)
GRID = 0.1


def snap(v):
    return round(v / GRID) * GRID


def forms(s):
    """top-level s-expr blocks inside a ( ... ) wrapper string."""
    out = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] == "(":
            depth = 0
            j = i
            instr = False
            while j < n:
                ch = s[j]
                if ch == '"' and (j == 0 or s[j - 1] != "\\"):
                    instr = not instr
                elif not instr:
                    if ch == "(":
                        depth += 1
                    elif ch == ")":
                        depth -= 1
                        if depth == 0:
                            break
                j += 1
            out.append(s[i:j + 1])
            i = j + 1
        else:
            i += 1
    return out


def sub_block(s, token):
    """return (block, start, end) of first block starting with token, else None"""
    for b in forms(s):
        if b.startswith(f"({token}"):
            return b
    return None


def bbox_of(km):
    """rough extent from pads + courtyard graphic lines/rects."""
    xs, ys = [], []
    for m in re.finditer(r'\(pad[^()]*?\(at ([-\d.]+)(?: ([-\d.]+))?\)(?:\s*\(size ([-\d.]+) ([-\d.]+))?', km):
        x, y = float(m.group(1)), float(m.group(2) or 0)
        w, h = (float(m.group(3)), float(m.group(4))) if m.group(3) else (1.0, 1.0)
        xs += [x - w / 2, x + w / 2]
        ys += [y - h / 2, y + h / 2]
    for m in re.finditer(r'\((?:xy|start|end|at) ([-\d.]+) ([-\d.]+)', km):
        xs.append(float(m.group(1)))
        ys.append(float(m.group(2)))
    if not xs:
        return -1, -1, 2, 2
    pad = 0.5
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad


def resolve_footprint(spec_fp):
    lib, name = spec_fp.split(":", 1)
    p = os.path.join(FP_ROOT, f"{lib}.pretty", f"{name}.kicad_mod")
    return p if os.path.exists(p) else None


def assign_nets(netlist):
    nets = sorted({n for c in netlist["components"] for n in c["pins"].values()})
    code = {n: i + 1 for i, n in enumerate(nets)}
    return nets, code


def author(netlist_path, out_path, rot_by_ref=None):
    d = json.load(open(netlist_path))
    comps = d["components"]
    nets, ncode = assign_nets(d)
    uuidn = [0]

    def U():
        uuidn[0] += 1
        x = f"{uuidn[0]:032x}"
        return f"{x[:8]}-{x[8:12]}-{x[12:16]}-{x[16:20]}-{x[20:32]}"

    # ---- layout pass: shelf by bbox heights
    items = []
    warn = []
    for c in sorted(comps, key=lambda c: (c["ref"][0], int(re.sub(r"\D", "", c["ref"]) or 0))):
        fpp = resolve_footprint(c["footprint"])
        if not fpp:
            warn.append(f"NO-FOOTPRINT {c['ref']} {c['footprint']}")
            continue
        km = open(fpp).read()
        x0, y0, x1, y1 = bbox_of(km)
        items.append([c, km, snap(x1 - x0) + PLACE_MARGIN, snap(y1 - y0) + PLACE_MARGIN, (x0, y0)])
    COL_W = 120.0
    cx, cy, rowh = 10.0, 10.0, 0.0
    placed = []
    for it in items:
        if cx + it[2] > COL_W:
            cx = 10.0
            cy += rowh
            rowh = 0.0
        placed.append((it, snap(cx), snap(cy)))
        cx += it[2]
        rowh = max(rowh, it[3])
    board_w, board_h = snap(COL_W + 20), snap(cy + rowh + 20)

    # ---- emit
    L = ['(kicad_pcb (version 20260206) (generator "board_author_pcb") (generator_version "10.0")',
         '  (general (thickness 1.6) (legacy_teardrops no))',
         '  (paper "A3")',
         '  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (32 "B.Adhes" user "B.Adhesive") '
         '(33 "F.Adhes" user "F.Adhesive") (34 "B.Paste" user) (35 "F.Paste" user) '
         '(36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen") '
         '(38 "B.Mask" user) (39 "F.Mask" user) (40 "Dwgs.User" user "User.Drawings") '
         '(44 "Edge.Cuts" user) (45 "Margin" user "BoardOutline") (46 "B.CrtYd" user "B.Courtyard") '
         '(47 "F.CrtYd" user "F.Courtyard") (48 "B.Fab" user) (49 "F.Fab" user) (50 "User.1" user))',
         '  (setup (pad_to_mask_clearance 0))',
         '  (net_class "Default" "" (clearance 0.2) (trace_width 0.25) (via_dia 0.6) (via_drill 0.3) (uvia_dia 0.3) (uvia_drill 0.1)'
         + " " + "".join(f'(add_net "{esc(n)}")' for n in sorted(nets)) + ')']
    L.append('  (net 0 "")')
    for n in nets:
        L.append(f'  (net {ncode[n]} "{n.replace(chr(92), chr(92)*2).replace(chr(34), chr(92)+chr(34))}")')
    # Edge.Cuts rectangle
    pts = [(5, 5), (board_w, 5), (board_w, board_h - 5), (5, board_h - 5), (5, 5)]
    for i in range(4):
        L.append(f'  (gr_line (start {pts[i][0]} {pts[i][1]}) (end {pts[i+1][0]} {pts[i+1][1]})'
                 f' (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (uuid "{U()}"))')
    for (it, px, py) in placed:
        c, km, _, _, (x0, y0) = it
        ref = c["ref"]
        pins = c["pins"]
        # pad name -> net number string; match footprint pad names
        fp_padnames = re.findall(r'\(pad "([^"]*)"', km)  # file order; '' = np/mount hole
        named = [n for n in fp_padnames if n]
        mapping = {}
        alias = ALIASES.get((ref, c["footprint"]))
        if alias:
            mapping = dict(alias)
        elif set(pins) <= set(named):
            pass  # identity match on covered pins; extra pads (shell/np) stay net 0
        elif len(named) == len(pins):
            order_pins = sorted(pins, key=lambda pin: int(pin) if pin.isdigit() else 0)
            for fpn, spp in zip(named, order_pins):
                mapping.setdefault(fpn, spp)
            warn.append(f"POSITIONAL-MAP {ref} {c['footprint']}: {len(named)} pads zipped to spec pins — NO authority table, verify datasheet")
        else:
            warn.append(f"NO-AUTHORITY-MAP {ref} {c['footprint']}: pads {sorted(set(named))[:8]} vs spec pins {sorted(pins)[:8]} -> design-data GAP, net 0 (refusing to guess)")
        # origin so that bbox min lands at px,py
        ox, oy = snap(px - x0), snap(py - y0)
        head = f'  (footprint "{esc(c["footprint"])}" (layer "F.Cu") (uuid "{U()}") (at {ox} {oy})'
        head += (f' (property "Reference" "{esc(ref)}" (at 0 -1 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))'
                 f' (property "Value" "{esc(c.get("mpn", ref))}" (at 0 1 0) (layer "F.Fab") (effects (font (size 1 1) (thickness 0.15))))')
        body = km[km.index("(attr"):] if "(attr" in km else km[km.rindex(")"):]
        # inject nets into pad blocks
        out_km = []
        pos = 0
        for pb in forms(body):
            m = re.match(r'\(pad "([^"]+)"', pb)
            s, e = body.find(pb, pos), body.find(pb, pos) + len(pb)
            if m:
                padname = m.group(1)
                pin = None if padname == "" else mapping.get(padname, padname if padname in pins else None)
                if pin is not None:
                    net = pins[pin]
                    ins = f' (net {ncode[net]} "{esc(net)}")'
                    pb = pb[:-1] + ins + ")"
                pos = e
            out_km.append((s, pb))
        rebuilt = body
        for s, pb in reversed(out_km):
            e = s + None if False else s
        # simpler: replace each original pad block string once
        # (do textual replacement with count=1 on the ORIGINAL blocks)
        for orig_pb in [b for b in forms(body) if b.startswith('(pad ')]:
            new_pb = next(p for (s, p) in out_km if s == body.find(orig_pb))
            rebuilt = rebuilt.replace(orig_pb, new_pb, 1)
        rebuilt = rebuilt[:rebuilt.rindex(")")]  # strip trailing close of fp file
        L.append(head + "\n" + rebuilt + "\n  )")
    L.append(')\n')
    open(out_path, "w").write("\n".join(x for x in L if x) + "\n")
    pro = out_path[:-len(".kicad_pcb")] + ".kicad_pro"
    import json as _j
    _j.dump({
        "board": {"design_settings": {
            "defaults": {"board_outline_line_width": 0.1, "copper_line_width": 0.2,
                         "solder_mask_clearance": 0.0, "solder_mask_min_width": 0.0,
                         "allow_soldermask_bridges_in_footprints": True},
            "drc_exclusions": [],
            "rules": {"min_hole_to_hole": 0.15, "min_through_hole_diameter": 0.15,
                      "min_clearance": 0.2, "min_connection": 0.0,
                      "min_copper_edge_clearance": 0.1, "min_hole_clearance": 0.15,
                      "min_silk_clearance": 0.0, "min_text_height": 0.8,
                      "min_text_thickness": 0.12, "min_track_width": 0.15,
                      "min_via_annular_width": 0.1, "min_via_diameter": 0.45,
                      "solder_mask_to_copper_clearance": 0.0, "use_height_for_length_calcs": True}}},
        "libraries": {"fp_files": []},
        "meta": {"filename": pro.split("/")[-1], "version": 3},
        "net_settings": {"classes": [{"name": "Default", "clearance": 0.2,
            "trace_width": 0.25, "via_dia": 0.6, "via_drill": 0.2, "uvia_dia": 0.3,
            "uvia_drill": 0.1, "allow_soldermask_bridges_in_footprints": True}],
            "meta": {"version": 3}},
        "pcbnew": {"last_paths": {}},
        "sheets": [], "text_variables": {}},
        open(pro, "w"), indent=1)
    return nets, warn, board_w, board_h


def esc(s):
    return str(s).replace("\\", "\\\\").replace('"', '\\"')


if __name__ == "__main__":
    nl = sys.argv[1]
    out = sys.argv[2]
    nets, warn, w, h = author(nl, out)
    print(f"authored {out}: nets={len(nets)} board={w}x{h}mm")
    for x in warn:
        print("WARN", x)
