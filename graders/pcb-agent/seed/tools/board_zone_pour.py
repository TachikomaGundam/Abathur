#!/usr/bin/env python3
"""r17 GND pour: strip greedy GND tracks, paint GND pads, raster-erode foreign
items, emit dual-layer (F.Cu+B.Cu) zone with scanline-exact boundary rings plus
stitching vias. Deterministic 0.2mm raster. Usage: board_zone_pour.py in out"""
import json, os, re, sys
from collections import defaultdict

CELL = 0.2
EDGE_INSET = 0.3
OBS_CLEAR = 0.25
HOLE_CLEAR = 0.30


def sub_blocks(s, start):
    out = []; i = start; n = len(s)
    while i < n:
        while i < n and s[i] != "(":
            i += 1
        if i >= n:
            break
        depth = 0; j = i; instr = False; esc = False
        while j < n:
            ch = s[j]
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': instr = not instr
            elif not instr:
                if ch == "(": depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0: break
            j += 1
        out.append(s[i + 1:j]); i = j + 1
        p2 = i
        while p2 < n and s[p2] in " \t\n\r":
            p2 += 1
        if p2 < n and s[p2] == ")":
            break
    return out


def parse_pads(txt):
    pads = []
    for b in sub_blocks(sub_blocks(txt, txt.index("(kicad_pcb"))[0], 0):
        if not b.startswith("footprint"):
            continue
        m0 = re.search(r'\(at ([-\d.]+) ([-\d.]+)\)', b[:b.find("(property") if "(property" in b else 200])
        ax, ay = float(m0.group(1)), float(m0.group(2))
        mr = re.search(r'\(rotate (\d+\.?\d*)\)', b[:b.find("(layer")])
        rot = __import__("math").radians(float(mr.group(1))) if mr else 0.0
        mref = re.search(r'\(property "Reference" "([^"]+)"', b)
        ref = mref.group(1) if mref else ""
        i = 0
        while True:
            i = b.find("(pad ", i)
            if i < 0: break
            d = 0; j = i; instr = False
            while j < len(b):
                c = b[j]
                if c == '"': instr = not instr
                elif not instr:
                    if c == "(": d += 1
                    elif c == ")":
                        d -= 1
                        if d == 0: break
                j += 1
            pb = b[i + 1:j]; i = j + 1
            pnum = re.match(r'pad "([^"]*)"', pb).group(1)
            sm = re.search(r'\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)', pb)
            ox, oy = float(sm.group(1)), float(sm.group(2))
            ca, sa = __import__("math").cos(rot), __import__("math").sin(rot)
            wx, wy = ax + ox * ca - oy * sa, ay + ox * sa + oy * ca
            sz = re.search(r'\(size ([-\d.]+) ([-\d.]+)\)', pb)
            w, h = float(sz.group(1)), float(sz.group(2))
            shape = "circle" if "(shape circle)" in pb or '"circle"' in pb else "rect"
            drl = re.search(r'\(drill(?: oval)? ([\d.]+)(?: ([\d.]+))?\)', pb)
            pads.append(dict(ref=ref, num=pnum, x=wx, y=wy, w=w, h=h, shape=shape,
                             drill=(float(drl.group(1)), float(drl.group(2) or drl.group(1))) if drl else None,
             bnet=(re.search(r'\(net \d+ "([^"]*)"\)', pb) or [None, None])[1]))
    return pads


def rings_from_rects(rects, x0, y0):
    segs = set()
    for (xa, ya, xb, yb) in rects:
        ax, ay = x0 + (xa - 1) * CELL, y0 + (ya - 1) * CELL
        bx, by = x0 + (xb - 1) * CELL, y0 + (yb - 1) * CELL
        segs.add(((ax, ay), (bx, ay)))
        segs.add(((bx, ay), (bx, by)))
        segs.add(((bx, by), (ax, by)))
        segs.add(((ax, by), (ax, ay)))
    kill = set()
    for a, b in segs:
        if (b, a) in segs:
            kill.add((a, b)); kill.add((b, a))
    eout = defaultdict(list)
    for a, b in segs - kill:
        eout[a].append(b)
    rings = []
    for st in list(eout.keys()):
        while eout[st]:
            stack = [st]; trail = []
            cur = st
            while True:
                outs = eout[cur]
                if not outs:
                    break
                nxt = outs.pop()
                stack.append(nxt)
                cur = nxt
                if cur == st:
                    break
            if cur == st and len(stack) >= 5:
                rings.append(stack[:-1])
            elif cur != st:
                for q in reversed(stack[stack.index(st) + 1:]):
                    eout.setdefault(stack[stack.index(q)][0], [])
    def area(r):
        return sum(r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1] for k in range(len(r) - 1)) / 2.0
    out = []
    for r in rings:
        rr = []
        for q in r:
            if not rr or rr[-1] != q:
                rr.append(q)
        if len(rr) >= 5 and rr[0] == rr[-1]:
            rr = rr[:-1]
        if len(rr) >= 4 and abs(area(rr)) > 0.5:
            out.append(rr)
    return out


def main(inp, outp):
    txt = open(inp).read()
    mw = re.search(r'\n\)?\s*\(nets\s*\n(.*?)\n\)', txt, re.S)
    if mw:
        txt = txt[:mw.start()] + "\n" + mw.group(1) + txt[mw.end():]
        print("REPAIR: unwrapped KiCad-8 style (nets) wrapper to root (net) tokens, removed stray close (r39B)")
    nm = dict((m.group(2).strip('"'), int(m.group(1))) for m in
              re.finditer(r'\(net (\d+) "([^"]+)"\)', txt))
    gnd_code = nm.get("GND")
    assert gnd_code is not None, "no GND net"
    POW = [x for x in (os.environ.get("PCB_POWER_ZONE_NETS", "5V_SERVO,5V_LOGIC,3V3,VBUS")).split(",") if x]
    pcode = {n: nm[n] for n in POW if n in nm}
    padby = defaultdict(list)
    prect = {}
    pwr_codes = set(pcode.values())

    root_children = sub_blocks(sub_blocks(txt, txt.index("(kicad_pcb"))[0], 0)
    xs, ys = [], []
    for b in root_children:
        if b.startswith("gr_line") and "Edge.Cuts" in b:
            for mm in re.finditer(r'\((?:start|end) ([-\d.]+) ([-\d.]+)\)', b):
                xs.append(float(mm.group(1))); ys.append(float(mm.group(2)))
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    spec = "/home/lab/workspace/pcb-local-repro/solar_ray_v2/circuit/netlist.json"
    pad_net = {}
    for c in json.load(open(spec))["components"]:
        for pin, net in c["pins"].items():
            pad_net[(c["ref"], pin)] = net
    pads = parse_pads(txt)
    for pd_ in pads:
        pd_["net"] = pd_["bnet"] or pad_net.get((pd_["ref"], pd_["num"]), "?")
        padby[pd_["net"]].append(pd_)
    for n_, ps in padby.items():
        if n_ in pcode:
            xs_ = [pd_["x"] - pd_["w"] / 2 for pd_ in ps] + [pd_["x"] + pd_["w"] / 2 for pd_ in ps]
            ys_ = [pd_["y"] - pd_["h"] / 2 for pd_ in ps] + [pd_["y"] + pd_["h"] / 2 for pd_ in ps]
            prect[n_] = (min(xs_) - 1.2, min(ys_) - 1.2, max(xs_) + 1.2, max(ys_) + 1.2)
    gnd_name = "GND"
    keep = []
    nstrip = 0
    fp_i = next(i for i, b in enumerate(root_children) if b.startswith("footprint"))
    for b in root_children[fp_i:]:
        if b.startswith("segment") or b.startswith("via"):
            mn = re.search(r'\(net (\d+)\)', b)
            if mn and int(mn.group(1)) in ({gnd_code} | pwr_codes):
                nstrip += 1
                continue
        keep.append("(" + b + ")")
    W = int((x1 - x0) / CELL) + 2
    H = int((y1 - y0) / CELL) + 2
    occ = bytearray(W * H)
    rawpad = bytearray(W * H)

    def cx(v): return int((v - x0) / CELL) + 1
    def cy(v): return int((v - y0) / CELL) + 1

    def mark_rect(xa, ya, xb, yb, r, arr):
        gx0, gx1 = sorted((cx(xa), cx(xb)))
        gy0, gy1 = sorted((cy(ya), cy(yb)))
        pad = int(r / CELL) + 1
        for gy in range(max(0, gy0 - pad), min(H, gy1 + pad + 1)):
            for gx in range(max(0, gx0 - pad), min(W, gx1 + pad + 1)):
                arr[gy * W + gx] = 1
    for blk in keep:
        if blk.startswith("(segment"):
            m1 = re.search(r'\(start ([-\d.]+) ([-\d.]+)\) \(end ([-\d.]+) ([-\d.]+)\)', blk)
            if m1:
                xa, ya, xb, yb = (float(m1.group(i)) for i in (1, 2, 3, 4))
                n_ = int(max(abs(xb - xa), abs(yb - ya)) / (CELL / 2)) + 1
                for k in range(n_ + 1):
                    t = k / n_
                    mark_rect(xa + (xb - xa) * t - CELL, ya + (yb - ya) * t - CELL,
                              xa + (xb - xa) * t + CELL, ya + (yb - ya) * t + CELL, 0.15, occ)
        elif blk.startswith("(via"):
            m2 = re.search(r'\(via \(at ([-\d.]+) ([-\d.]+)\)', blk)
            if m2:
                mark_rect(float(m2.group(1)), float(m2.group(2)),
                          float(m2.group(1)), float(m2.group(2)), 0.55, occ)
    for p_ in pads:
        mark_rect(p_["x"] - p_["w"] / 2, p_["y"] - p_["h"] / 2,
                  p_["x"] + p_["w"] / 2, p_["y"] + p_["h"] / 2, 0.5, rawpad)
        if p_["net"] != gnd_name:
            if p_["drill"]:
                mark_rect(p_["x"] - p_["w"] / 2, p_["y"] - p_["h"] / 2,
                          p_["x"] + p_["w"] / 2, p_["y"] + p_["h"] / 2, 0.5, occ)
            else:
                mark_rect(p_["x"] - p_["w"] / 2, p_["y"] - p_["h"] / 2,
                          p_["x"] + p_["w"] / 2, p_["y"] + p_["h"] / 2, 0.5, occ)
    for blk in keep:
        if blk.startswith("(segment"):
            m1 = re.search(r'\(start ([-\d.]+) ([-\d.]+)\) \(end ([-\d.]+) ([-\d.]+)\)', blk)
            if m1:
                xa, ya, xb, yb = (float(m1.group(i)) for i in (1, 2, 3, 4))
                nseg = int(max(abs(xb - xa), abs(yb - ya)) / (CELL / 2)) + 1
                for k in range(nseg + 1):
                    t = k / nseg
                    px_, py_ = xa + (xb - xa) * t, ya + (yb - ya) * t
                    mark_rect(px_ - CELL, py_ - CELL, px_ + CELL, py_ + CELL, 0.1, occ)
    bx0, by0, bx1, by1 = x0 + EDGE_INSET, y0 + EDGE_INSET, x1 - EDGE_INSET, y1 - EDGE_INSET
    outline_pts = f"(xy {bx0:.4f} {by0:.4f}) (xy {bx1:.4f} {by0:.4f}) (xy {bx1:.4f} {by1:.4f}) (xy {bx0:.4f} {by1:.4f}) (xy {bx0:.4f} {by0:.4f})"
    # fine-pitch connector keepout: no pour under USB-C-class parts (0.85mm rows)
    kx = [pd_ for pd_ in pads if pd_["ref"] in {"J1"}]
    KEEPOUT_RECT = None
    if kx:
        hx0 = min(p_["x"] - p_["w"] / 2 for p_ in kx) - 0.3
        hy0 = min(p_["y"] - p_["h"] / 2 for p_ in kx) - 0.3
        hx1 = max(p_["x"] + p_["w"] / 2 for p_ in kx) + 0.3
        hy1 = max(p_["y"] + p_["h"] / 2 for p_ in kx) + 0.3
        KEEPOUT_RECT = (hx0, hy0, hx1, hy1)
        _ = KEEPOUT_RECT
    outline = outline_pts
    z = []
    for LI, LAY in enumerate(["F.Cu", "B.Cu"]):
        z += [f'(zone (net {gnd_code}) (net_name "GND") (layer "{LAY}") (priority 3) (uuid "5a000000-0000-0000-0000-00000000cafe{LI}")',
              '  (hatch edge 0.508)',
              '  (connect_pads (clearance 0))',
              '  (min_thickness 0.2)',
              '  (filled_areas_thickness no)',
              '  (fill yes (thermal_gap 0.4) (thermal_bridge_width 0.5))',
              f'  (polygon (pts {outline}))',
              ')']
    def rectpts(xa, ya, xb, yb):
        return f"(xy {xa:.4f} {ya:.4f}) (xy {xb:.4f} {ya:.4f}) (xy {xb:.4f} {yb:.4f}) (xy {xa:.4f} {yb:.4f}) (xy {xa:.4f} {ya:.4f})"
    def rect_subtract(r0, hs):
        # KiCad zone outlines are single-loop: multi-loop "holes" become bowtie
        # self-intersections and refill misfills GND-adjacent corners (r37
        # forensic: PTH GND pads disconnected only with power zones on).
        # Correct shape = axis-aligned decomposition into hole-free sub-rects.
        x0, y0, x1, y1 = r0
        X = sorted({x0, x1} | {v for h in hs for v in (h[0], h[2]) if x0 < v < x1})
        Y = sorted({y0, y1} | {v for h in hs for v in (h[1], h[3]) if y0 < v < y1})
        def bad(i, j):
            mx, my = (X[i] + X[i + 1]) / 2, (Y[j] + Y[j + 1]) / 2
            return any(h[0] <= mx <= h[2] and h[1] <= my <= h[3] for h in hs)
        nx, ny = len(X) - 1, len(Y) - 1
        free = [[not bad(i, j) for i in range(nx)] for j in range(ny)]
        out = []
        for j in range(ny):
            i = 0
            while i < nx:
                if free[j][i]:
                    k = i
                    while k + 1 < nx and free[j][k + 1]:
                        k += 1
                    j2 = j
                    while j2 + 1 < ny and all(free[j2 + 1][ii] for ii in range(i, k + 1)):
                        j2 += 1
                    out.append((X[i], Y[j], X[k + 1], Y[j2 + 1]))
                    for jj in range(j, j2 + 1):
                        for ii in range(i, k + 1):
                            free[jj][ii] = False
                    i = k + 1
                else:
                    i += 1
        return out

    for zi, (n_, rc) in enumerate(sorted(prect.items())):
        holes = []
        for n2, r2 in prect.items():
            if n2 == n_:
                continue
            holes.append((r2[0] + 0.05, r2[1] + 0.05, r2[2] - 0.05, r2[3] - 0.05))
        for pd_ in pads:
            if pd_["net"] != "GND":
                continue
            hx0, hy0 = pd_["x"] - pd_["w"] / 2 - 0.30, pd_["y"] - pd_["h"] / 2 - 0.30
            hx1, hy1 = pd_["x"] + pd_["w"] / 2 + 0.30, pd_["y"] + pd_["h"] / 2 + 0.30
            if hx1 < rc[0] or hx0 > rc[2] or hy1 < rc[1] or hy0 > rc[3]:
                continue
            holes.append((hx0, hy0, hx1, hy1))
        subr = rect_subtract(rc, holes)
        subr = [(a + 0.12, b + 0.12, c - 0.12, dd - 0.12) for a, b, c, dd in subr if c - a > 0.4 and dd - b > 0.4]
        for si, sr in enumerate(subr):
            for LI, LAY in enumerate(["F.Cu", "B.Cu"]):
                z += [f'(zone (net {pcode[n_]}) (net_name "{n_}") (layer "{LAY}") (priority 2) (uuid "5a00cbfe-0000-0000-0000-{zi:02d}{si:02d}{LI:02d}000000")',
                      '  (hatch edge 0.508)',
                      '  (connect_pads (clearance 0))',
                      '  (min_thickness 0.2)',
                      '  (fill yes (thermal_gap 0.4) (thermal_bridge_width 0.5))',
                      f'  (polygon (pts {rectpts(*sr)}))',
                      ')']
    if KEEPOUT_RECT:
        for LI, LAY in enumerate(["F.Cu", "B.Cu"]):
            k = KEEPOUT_RECT
            z += [f'(zone (net -1) (net_name "") (layer "{LAY}") (uuid "5a000000-0000-0000-0000-00000000cdfe{LI}")',
                  '  (hatch edge 0.508)',
                  '  (priority 15)',
                  f'  (polygon (pts (xy {k[0]:.4f} {k[1]:.4f}) (xy {k[2]:.4f} {k[1]:.4f}) (xy {k[2]:.4f} {k[3]:.4f}) (xy {k[0]:.4f} {k[3]:.4f}) (xy {k[0]:.4f} {k[1]:.4f})))',
                  ')']
    stitch = 0
    step = max(1, int(4.0 / CELL))
    for gy in range(1, H - 1, step):
        for gx in range(1, W - 1, step):
            rr = int(0.55 / CELL)
            vxc, vyc = x0 + (gx - 1) * CELL, y0 + (gy - 1) * CELL
            if not (x0 + 1.0 < vxc < x1 - 1.0 and y0 + 1.0 < vyc < y1 - 1.0):
                continue  # board-edge via guard: copper_edge_clearance class
            if any(rc[0] + 0.3 < vxc < rc[2] - 0.3 and rc[1] + 0.3 < vyc < rc[3] - 0.3 for rc in prect.values()):
                continue  # GND via must not land inside a power zone
            if KEEPOUT_RECT and KEEPOUT_RECT[0] - 0.2 < vxc < KEEPOUT_RECT[2] + 0.2 and KEEPOUT_RECT[1] - 0.2 < vyc < KEEPOUT_RECT[3] + 0.2:
                continue  # fine-pitch connector keepout
            if any(occ[max(0, min(H - 1, gy + dy2)) * W + max(0, min(W - 1, gx + dx2))] or
                   rawpad[max(0, min(H - 1, gy + dy2)) * W + max(0, min(W - 1, gx + dx2))]
                   for dx2 in range(-rr, rr + 1) for dy2 in range(-rr, rr + 1)):
                continue
            stitch += 1
            z.append(f'(via (at {x0 + (gx - 1) * CELL:.4f} {y0 + (gy - 1) * CELL:.4f}) (size 0.6) (drill 0.3)'
                     f' (layers "F.Cu" "B.Cu") (net {gnd_code}) (uuid "00000000-0000-0000-0000-{stitch:012d}cafe0"))')
    print(f"stripped={nstrip} pads={len(pads)} stitch-vias={stitch} zones={2 + 2 * len(prect)} (GND x2 + power x{2 * len(prect)}, native refill)")
    # GND net-class -> solid pad connection (kills starved_thermal at pour rims)
    head = re.sub(r'(\(net_class "GND"[^\n]*?)(\s*\)\s*)$',
                  r'\1 (pad_connection "solid")\2',
                  txt[:txt.index("(footprint")].rstrip("\n"))
    body = "\n".join(keep if keep else [])
    tail = "\n".join(z)
    out_txt = head + "\n" + body + "\n" + tail + "\n)\n"
    n_in = len(re.findall(r'\(segment ', txt)) - nstrip
    n_out = len(re.findall(r'\(segment ', out_txt))
    if n_out != n_in:
        sys.stderr.write(f"PARSE_IMBALANCE pour: expected {n_in} segment(s) to survive, output has {n_out} — refusing to emit copper-losing board\n")
        sys.exit(3)
    open(outp, "w").write(out_txt)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
