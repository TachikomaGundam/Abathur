#!/usr/bin/env python3
"""r17 deterministic 2-layer router (RM-56 doctrine; scripted A* lane).
Reads placed .kicad_pcb (board_author_pcb output), routes a nearest-neighbour
spanning tree per net on F.Cu/B.Cu, appends (segment)/(via), writes routed board.
Grid 0.1mm; octile A*; per-layer flat occupancy dict (cell -> set(nets)).
A cell is blocked for net N if occupied by nets other than N or 0.
Gates afterwards: kicad DRC 0 errors + unconnected_items == 0 (board_gate_routed)."""
import os
import re, math, heapq, sys
from collections import defaultdict

GRID = float(os.environ.get('BR_GRID', '0.05'))
CLEAR = 0.26
POWER = {"VBUS", "5V_SERVO", "5V_LOGIC", "3V3", "GND", "SW_NODE", "+5V_IN"}
W_POWER, W_SIG = 0.4, 0.25
VIA_COST = 40
MAX_PUSH = int(os.environ.get('BR_MAX_PUSH', '900000'))


def footprint_blocks(txt):
    return sub_blocks(txt, "footprint")


def sub_blocks(s, token):
    """full (token ...) blocks, balanced-paren + string-aware scan."""
    out = []
    i = 0
    pat = "(" + token + " "
    while True:
        i = s.find(pat, i)
        if i < 0:
            return out
        depth = 0
        j = i
        instr = False
        while j < len(s):
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


def pads_of(txt):
    pads = []
    for block in footprint_blocks(txt):
        fm = re.search(r'\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)', block)
        fx, fy, frot = (float(fm.group(1)), float(fm.group(2)), float(fm.group(3) or 0)) if fm else (0, 0, 0)
        refm = re.search(r'\(property "Reference" "([^"]+)"', block)
        ref = refm.group(1) if refm else "?"
        for pb in sub_blocks(block, "pad"):
            nm = re.search(r'\(net (\d+) "((?:[^"\\]|\\.)*)"\)', pb)
            if not nm:
                continue
            pm2 = re.match(r'\(pad "([^"]*)"', pb)
            at = re.search(r'\(at ([-\d.]+)(?: ([-\d.]+))?(?: ([-\d.]+))?\)', pb)
            sz = re.search(r'\(size ([-\d.]+) ([-\d.]+)\)', pb)
            px, py = (float(at.group(1)), float(at.group(2) or 0)) if at else (0, 0)
            pr = float(at.group(3) or 0) if at else 0.0
            w, h = (float(sz.group(1)), float(sz.group(2))) if sz else (1.0, 1.0)
            a = math.radians(pr + frot)
            gx = fx + px * math.cos(a) - py * math.sin(a)
            gy = fy + px * math.sin(a) + py * math.cos(a)
            pads.append(dict(ref=ref, pad=pm2.group(1) if pm2 else "?", net=int(nm.group(1)),
                             netname=nm.group(2), x=gx, y=gy, w=w, h=h))
    return pads


class Occ:
    def __init__(self):
        self.m = [{}, {}]

    def add_rect(self, x0, y0, x1, y1, l, net):
        for cx in range(int(math.floor(x0 / GRID)), int(math.ceil(x1 / GRID)) + 1):
            row = self.m[l]
            for cy in range(int(math.floor(y0 / GRID)), int(math.ceil(y1 / GRID)) + 1):
                s = row.get((cx, cy))
                if s is None:
                    row[(cx, cy)] = {net}
                else:
                    s.add(net)

    def passable(self, l, cx, cy, net):
        s = self.m[l].get((cx, cy))
        return s is None or s == {0} or net in s


def build_occ(pads):
    occ = Occ()
    for p in pads:
        if str(p.get("num", p.get("pad", "1"))) == "":
            # NPTH retention holes/screws: universal obstacle (no net may own
            # copper in a hole's clearance annulus), sentinel -2 matches nothing.
            hw, hh = p["w"] / 2 + 0.35, p["h"] / 2 + 0.35
            for l in (0, 1):
                occ.add_rect(p["x"] - hw, p["y"] - hh, p["x"] + hw, p["y"] + hh, l, -2)
            continue
        hw, hh = p["w"] / 2 + CLEAR, p["h"] / 2 + CLEAR
        # cross-layer: KiCad enforces Cu-to-Cu clearance between tracks and pads
        # on the OTHER copper layer too -> register every pad ring on BOTH layers.
        for l in (0, 1):
            occ.add_rect(p["x"] - hw, p["y"] - hh, p["x"] + hw, p["y"] + hh, l, p["net"])
    # unmark pad interiors of the net's own footprint pads as free-to-stand target cells
    return occ


def cell(x, y):
    return int(round(x / GRID)), int(round(y / GRID))


def astar(occ, start, goal, net, via_cost=VIA_COST):
    sx, sy = start[0]
    sl = start[1]
    gx, gy = goal[0]
    gl = goal[1]
    h0 = abs(sx - gx) + abs(sy - gy)
    heap = [(h0, 0, sx, sy, sl)]
    gsc = {(sx, sy, sl): 0}
    came = {}
    pushes = 0
    while heap:
        _, g, x, y, l = heapq.heappop(heap)
        if x == gx and y == gy and l == gl:
            path = [(x, y, l)]
            while (x, y, l) in came:
                x, y, l = came[(x, y, l)]
                path.append((x, y, l))
            return path[::-1]
        pushes += 1
        if pushes > MAX_PUSH:
            return None
        for dx, dy, dl, dc in ((1, 0, 0, 10), (-1, 0, 0, 10), (0, 1, 0, 10), (0, -1, 0, 10),
                               (0, 0, 1, VIA_COST), (0, 0, -1, VIA_COST)):
            nx, ny, nl = x + dx, y + dy, l + dl
            if nl < 0 or nl > 1:
                continue
            if dx and dy:  # no diagonal corner cutting: both flanks must be open
                if not (occ.passable(l, x + dx, y, net) and occ.passable(l, x, y + dy, net)):
                    continue
            if not occ.passable(nl, nx, ny, net):
                continue
            if dl:  # via may stand on its OWN pad (pinning) but never touch a
                # foreign pad/box: cells whose net-set excludes us (or incl. the
                # -7 gauntlet sentinel) are landing-banned.
                bad = False
                for ll in (0, 1):
                    for m in (occ.m[ll], occ.m[1 - ll]):
                        for ox in range(-3, 4):
                            for oy in range(-3, 4):
                                ss = m.get((nx + ox, ny + oy))
                                if ss is None:
                                    continue
                                if -7 in ss or (net not in ss and ss != {0}):
                                    bad = True
                                    break
                            if bad: break
                        if bad: break
                    if bad:
                        break
                if bad:
                    continue
            ng = g + (via_cost if dl else dc)
            if ng < gsc.get((nx, ny, nl), 1e18):
                gsc[(nx, ny, nl)] = ng
                came[(nx, ny, nl)] = (x, y, l)
                heapq.heappush(heap, (ng + abs(nx - gx) + abs(ny - gy) + (0 if nl == gl else VIA_COST), ng, nx, ny, nl))
    return None


def simplify(path):
    if len(path) <= 2:
        return path
    out = [path[0]]
    for i in range(1, len(path) - 1):
        x0, y0, l0 = path[i - 1]
        x1, y1, l1 = path[i]
        x2, y2, l2 = path[i + 1]
        if (x1 - x0, y1 - y0, l1 - l0) != (x2 - x1, y2 - y1, l2 - l1):
            out.append(path[i])
    out.append(path[-1])
    return out


def occ_track(occ, path, net, width):
    """register a laid path (cells + clearance ring) into occupancy for OTHER nets."""
    r = 2 if width < 0.35 else 3
    for (cx, cy, l) in path:
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                occ.add_rect((cx + dx) * GRID, (cy + dy) * GRID,
                             (cx + dx) * GRID, (cy + dy) * GRID, l, net)


def route(board_path, out_path, only_nets=None):
    txt = open(board_path).read()
    pads = pads_of(txt)
    nets = {int(m.group(1)): m.group(2) for m in re.finditer(r'\(net (\d+) "([^"]*)"\)', txt)}
    occ = build_occ(pads)
    # r17: J1 USB-C gauntlet — F.Cu inside the pad rows is forbidden (0.85mm pad
    # pitch admits no 0.2mm pair); D+/D-, VBUS, CC and shield stubs are forced
    # to B.Cu / the south channel. Sentinel net -7 closes the box to every net.
    # (gauntlet experiment retired: foreign SMD pads only exist on their own
    # layer's map — B.Cu threads between the J1 rows are clearance-legal.)
    by_net = defaultdict(list)
    for p in pads:
        if p["net"]:
            by_net[p["net"]].append(p)
    # order: power/GND first, prefer bottom layer (B=1); signals then on F=0
    def layer_pref(nid):
        return 1 if nets.get(nid, "") in POWER else 0
    ordered = sorted(by_net.items(), key=lambda kv: (nets.get(kv[0], "") not in POWER, -len(kv[1])))
    segs, vias, fails = [], [], []
    kept_segs = []
    if only_nets:
        fp_cut = txt.index("(footprint")
        root_end = len(txt) - 1
        tail_blocks = [m.group(0) for m in re.finditer(r'\(segment [^\n]*\)|\(via [^\n]*\)', txt[fp_cut:])]
        newblocks = []
        for blk in tail_blocks:
            mn2 = re.search(r'\(net (\d+)\)', blk)
            name2 = nets.get(int(mn2.group(1)), "") if mn2 else ""
            if name2 in only_nets:
                continue
            newblocks.append(blk)
            mm = re.search(r'\(segment \(start ([-\d.]+) ([-\d.]+)\) \(end ([-\d.]+) ([-\d.]+)\) \(width ([.\d]+)\) \(layer "([FB])\.Cu"\)', blk)
            mv = re.search(r'\(via \(at ([-\d.]+) ([-\d.]+)', blk)
            if mm:
                x1_, y1_, x2_, y2_ = (float(mm.group(i)) for i in (2, 3, 4, 5))
                w_ = float(mm.group(5)); l_ = 0 if mm.group(6) == "F" else 1
                nn_ = max(1, int(max(abs(x2_ - x1_), abs(y2_ - y1_)) / GRID))
                pts = [(cell(x1_ + (x2_ - x1_) * k / nn_, y1_ + (y2_ - y1_) * k / nn_)[0], cell(x1_ + (x2_ - x1_) * k / nn_, y1_ + (y2_ - y1_) * k / nn_)[1], l_) for k in range(nn_ + 1)]
                occ_track(occ, pts, -1, w_)
            elif mv:
                vx, vy = float(mv.group(1)), float(mv.group(2))
                for l_ in (0, 1):
                    occ.add_rect(vx - 0.4, vy - 0.4, vx + 0.4, vy + 0.4, l_, -1)
        kept_segs = newblocks
        ordered = [kv for kv in ordered if nets.get(kv[0], "") in only_nets]
        txt = txt[:fp_cut] + "\n".join(newblocks) + "\n)\n"
    for nid, plist in ordered:
        if len(plist) < 2:
            continue
        if nets.get(nid, "").startswith("NC"):
            continue  # NC nets are floating-on-purpose groups: copper would
                      # only weld foreign pads together inside connector gauntlets
        width = W_POWER if nets.get(nid, "") in POWER else W_SIG
        root = min(plist, key=lambda q: (q["x"], q["y"]))
        remaining = [q for q in plist if q is not root]
        tree = [root]
        while remaining:
            best = None
            for a in tree:
                for q in remaining:
                    if a.get("ref") and q.get("ref") == a["ref"]:
                        continue  # same-part pins bond internally: no copper
                    dist = abs(q["x"] - a["x"]) + abs(q["y"] - a["y"])
                    if best is None or dist < best[0]:
                        best = (dist, q)
            if best is None:
                break
            tree.append(best[1])
            remaining.remove(best[1])
        lp = layer_pref(nid)
        for a, c in zip(tree, tree[1:]):
            ca = cell(a["x"], a["y"])
            cc = cell(c["x"], c["y"])
            def ok_via_ends(pp):
                if not pp:
                    return False
                a_ok = True if pp[0][2] == lp else (len(pp) > 1 and pp[1][2] != pp[0][2])
                b_ok = True if pp[-1][2] == lp else (len(pp) > 1 and pp[-2][2] != pp[-1][2])
                return a_ok and b_ok
            cands = [astar(occ, (ca, lp), (cc, lp), nid),
                     astar(occ, (ca, lp), (cc, 1 - lp), nid),
                     astar(occ, (ca, 1 - lp), (cc, lp), nid)]
            path = next((c for c in cands if ok_via_ends(c)), None)
            if not path:
                cands = [astar(occ, (ca, lp), (cc, lp), nid, via_cost=12),
                         astar(occ, (ca, lp), (cc, 1 - lp), nid, via_cost=12)]
                path = next((c for c in cands if ok_via_ends(c)), None)
            if not path:
                fails.append((nets.get(nid), a["ref"] + "." + a["pad"], c["ref"] + "." + c["pad"]))
                continue
            sp = simplify(path)
            occ_track(occ, path, nid, width)
            for n1, n2 in zip(sp, sp[1:]):
                if n1[2] != n2[2]:
                    vias.append((n1[0] * GRID, n1[1] * GRID, nid))
                else:
                    segs.append((n1[0] * GRID, n1[1] * GRID, n2[0] * GRID, n2[1] * GRID, n1[2], width, nid))
    u = [0x5A000000]
    def U():
        u[0] += 1
        x = f"{u[0]:032x}"
        return f"{x[:8]}-{x[8:12]}-{x[12:16]}-{x[16:20]}-{x[20:32]}"
    emit = []
    for (x1, y1, x2, y2, l, w, n) in segs:
        emit.append(f'  (segment (start {x1:.4f} {y1:.4f}) (end {x2:.4f} {y2:.4f}) (width {w})'
                    f' (layer "{"F" if l==0 else "B"}.Cu") (net {n}) (uuid "{U()}"))')
    for (x, y, n) in vias:
        emit.append(f'  (via (at {x:.4f} {y:.4f}) (size 0.6) (drill 0.3)'
                    f' (layers "F.Cu" "B.Cu") (net {n}) (uuid "{U()}"))')
    head = txt[:txt.rindex(")")].rstrip("\n")
    mid = ("\n" + "\n".join(kept_segs)) if (only_nets and kept_segs) else ""
    open(out_path, "w").write(head + mid + "\n".join(emit) + "\n)\n")
    print(f"routed: segments={len(segs)} vias={len(vias)} failed_edges={len(fails)}")
    for f in fails[:12]:
        print("  FAIL-EDGE", f)
    return len(fails)


if __name__ == "__main__":
    only = None
    if "--only-nets" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only-nets") + 1].split(","))
    sys.exit(1 if route(sys.argv[1], sys.argv[2], only) else 0)
