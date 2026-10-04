#!/usr/bin/env python3
"""r17 deterministic 2-layer router (RM-56 doctrine; scripted A* lane).
Reads placed .kicad_pcb (board_author_pcb output), routes a nearest-neighbour
spanning tree per net on F.Cu/B.Cu, appends (segment)/(via), writes routed board.
Grid 0.1mm; octile A*; per-layer flat occupancy dict (cell -> set(nets)).
A cell is blocked for net N if occupied by nets other than N or 0.
Gates afterwards: kicad DRC 0 errors + unconnected_items == 0 (board_gate_routed)."""
import os
import re, math, heapq, sys, time
from collections import defaultdict

GRID = float(os.environ.get('BR_GRID', '0.05'))
CLEAR = 0.26
POWER = {"VBUS", "5V_SERVO", "5V_LOGIC", "3V3", "+3V3", "GND", "SW_NODE", "+5V_IN"}
W_POWER, W_SIG = 0.4, 0.25
VIA_COST = 40
START = time.monotonic()
BOARD_DEADLINE = float(os.environ.get('BR_DEADLINE', '600'))
PAIR_DEADLINE = float(os.environ.get('BR_PAIR_DEADLINE', '15'))
MAX_PUSH = int(os.environ.get('BR_MAX_PUSH', str(int(15000.0 / (GRID * GRID)))))  # r29T: push budget normalized to ~15000mm2 swept area, grid-independent


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
            lsm = re.search(r'\(layers ([^)]*)\)', pb)
            ls = lsm.group(1) if lsm else ''
            layer = 1 if ('B.Cu' in ls and 'F.Cu' not in ls) else 0
            pads.append(dict(ref=ref, pad=pm2.group(1) if pm2 else "?", net=int(nm.group(1)),
                             netname=nm.group(2), x=gx, y=gy, w=w, h=h, layer=layer))
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


def astar(occ, start, goal, net, via_cost=VIA_COST, deadline=None):
    sx, sy = start[0]
    sl = start[1]
    gx, gy = goal[0]
    gl = goal[1]
    _t0 = time.monotonic()
    pdl = PAIR_DEADLINE if deadline is None else deadline
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
        if pushes > MAX_PUSH or (pushes & 2047) == 0 and time.monotonic() - _t0 > pdl:
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


def coarse_route(occ, ca, cc, net, xlo, xhi, ylo, yhi, deadline):
    t_end = time.monotonic() + deadline
    HGc = max(4, int(round(0.5 / GRID)))
    s = (ca[0] // HGc, ca[1] // HGc)
    g = (cc[0] // HGc, cc[1] // HGc)
    if s == g:
        return None
    memo = {}

    def free(p):
        v = memo.get(p)
        if v is not None:
            return v
        cx, cy = p
        r = False
        if xlo <= cx * HGc <= xhi and ylo <= cy * HGc <= yhi:
            r = True
            for dx in (-1, 0, 1):
                if not r:
                    break
                for dy in (-1, 0, 1):
                    for l in (0, 1):
                        if not occ.passable(l, (cx + dx) * HGc + HGc // 2, (cy + dy) * HGc + HGc // 2, net):
                            r = False
                            break
                    if not r:
                        break
        memo[p] = r
        return r

    prev = {s: None}
    frontier = [s]
    while frontier:
        if time.monotonic() > t_end:
            return None
        nf = []
        done = False
        for (x, y) in frontier:
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                p = (x + d[0], y + d[1])
                if p in prev or not free(p):
                    continue
                prev[p] = (x, y)
                if p == g:
                    done = True
                    break
                nf.append(p)
            if done:
                break
        if done:
            break
        frontier = nf
    if g not in prev:
        return None
    pathc = [g]
    while pathc[-1] != s:
        pathc.append(prev[pathc[-1]])
    pathc.reverse()
    corners = [pathc[0]]
    for i in range(1, len(pathc) - 1):
        if (pathc[i][0] - pathc[i - 1][0], pathc[i][1] - pathc[i - 1][1]) != (pathc[i + 1][0] - pathc[i][0], pathc[i + 1][1] - pathc[i][1]):
            corners.append(pathc[i])
    corners.append(pathc[-1])
    outc = [corners[0]]
    for i in range(1, len(corners) - 1):
        px, py = outc[-1]
        span = max(abs(corners[i][0] - px), abs(corners[i][1] - py))
        reps = max(1, span // 6)
        for k in range(1, reps + 1):
            outc.append((px + (corners[i][0] - px) * k // reps, py + (corners[i][1] - py) * k // reps))
        outc.append(corners[i])
    outc.append(corners[-1])
    return [(x * HGc + HGc // 2, y * HGc + HGc // 2) for x, y in outc]


def hybrid_astar(occ, start, goal, net, deadline, bbox):
    (ca, alp), (cc, clp) = start, goal
    if abs(ca[0] - cc[0]) + abs(ca[1] - cc[1]) <= 60:
        return astar(occ, start, goal, net, deadline=deadline)
    xlo, xhi, ylo, yhi = bbox
    cw = coarse_route(occ, ca, cc, net, xlo, xhi, ylo, yhi, max(3.0, deadline * 0.35))
    if not cw:
        return None
    # corridor geometry ALREADY proved the pair routable: the multi-leg fine
    # phase needs seconds-per-leg, not the pair deadline's remainder (r38
    # forensics: 21 legs took 5.5s at 10s/leg vs old 6s total = certain fail).
    t_end = time.monotonic() + max(deadline * 0.65, 22.0)
    pts = [(ca, alp)] + [((x, y), alp) for x, y in cw[1:-1]] + [(cc, clp)]
    merged = []
    for (p1, l1), (p2, l2) in zip(pts, pts[1:]):
        rem = t_end - time.monotonic()
        if rem <= 0.2:
            return None
        seg = astar(occ, (p1, l1), (p2, l2), net, deadline=rem)
        if not seg:
            seg = astar(occ, (p1, l1), (p2, l2), net, via_cost=12, deadline=max(0.2, rem * 0.9))
        if not seg:
            return None
        merged.extend(seg if not merged else seg[1:])
    return merged


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
    _xs = [p["x"] for p in pads]; _ys = [p["y"] for p in pads]
    BB = (int(min(_xs) / GRID) - 60, int(max(_xs) / GRID) + 60,
          int(min(_ys) / GRID) - 60, int(max(_ys) / GRID) + 60)
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
        # r39B F7: author-tool output puts the FIRST copper mid-line
        # ("\t(embedded_fonts no)  (segment ...") — line-anchored search made
        # fp_cut=EOF and resume silently destroyed 100% of that copper class.
        mcut = re.search(r'\((?:segment|via) ', txt)
        fp_cut = mcut.start() if mcut else txt.rindex(")")
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
    # r29T checkpoint: same emit format as the final write, flushed every 8 nets
    # so a killed-at-timeout run still leaves a resumable partial board.
    u0 = [0x5A000000]
    def U0():
        u0[0] += 1
        x = f"{u0[0]:032x}"
        return f"{x[:8]}-{x[8:12]}-{x[12:16]}-{x[16:20]}-{x[20:32]}"
    head_ = txt[:txt.rindex(")")].rstrip("\n")
    mid_ = ("\n" + "\n".join(kept_segs)) if (only_nets and kept_segs) else ""
    def checkpoint():
        buf = []
        for (x1, y1, x2, y2, l, w, n) in segs:
            buf.append(f'  (segment (start {x1:.4f} {y1:.4f}) (end {x2:.4f} {y2:.4f}) (width {w})'
                       f' (layer "{"F" if l==0 else "B"}.Cu") (net {n}) (uuid "{U0()}"))')
        for (x, y, n) in vias:
            buf.append(f'  (via (at {x:.4f} {y:.4f}) (size 0.6) (drill 0.3)'
                       f' (layers "F.Cu" "B.Cu") (net {n}) (uuid "{U0()}"))')
        open(out_path, "w").write(head_ + mid_ + "\n".join(buf) + "\n)\n")
    nets_left = sum(1 for _, pl in ordered if len(pl) >= 2 and not nets.get(_, "").startswith("NC"))
    ripQ, pair_cache = [], {}
    RIP_RESERVE = float(os.environ.get("BR_RIP_RESERVE", "150"))
    MAIN_STOP = BOARD_DEADLINE - (0 if os.environ.get("BR_NO_RIP") else RIP_RESERVE)
    stop = False
    for _i, (nid, plist) in enumerate(ordered):
        if _i and _i % 4 == 0:
            print(f"[progress] net {_i}/{len(ordered)} processed, remaining_nets~{nets_left}", flush=True)
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
        pair_cache.setdefault(nid, []).extend([(x, y) for x, y in zip(tree, tree[1:])])
        # zip(tree, tree[1:]) can pair two same-ref pads that were each attached
        # under different parents: those bond INSIDE the part (no copper possible
        # across the body gauntlet, none required) — drop them before routing.
        pairs = [(x, y) for x, y in zip(tree, tree[1:])
                 if not (x.get("ref") and x.get("ref") == y.get("ref"))]
        if stop:
            # MAIN_STOP pairs still get their rip-shot inside the reserve.
            for a, c in pairs:
                fails.append((nets.get(nid), a['ref'] + '.' + a['pad'], c['ref'] + '.' + c['pad']))
                ripQ.append((nid, a, c))
            continue
        for pi, (a, c) in enumerate(pairs):
            if stop or time.monotonic() - START > MAIN_STOP:
                if not stop:
                    stop = True
                for a2, c2 in pairs[pi:]:
                    fails.append((nets.get(nid), a2['ref'] + '.' + a2['pad'], c2['ref'] + '.' + c2['pad']))
                    ripQ.append((nid, a2, c2))
                break
            pair_t0 = time.monotonic()
            ca = cell(a["x"], a["y"])
            cc = cell(c["x"], c["y"])
            alp, clp = a.get("layer", lp), c.get("layer", lp)
            def ok_via_ends(pp):
                if not pp:
                    return False
                a_ok = True if pp[0][2] == lp else (len(pp) > 1 and pp[1][2] != pp[0][2])
                b_ok = True if pp[-1][2] == lp else (len(pp) > 1 and pp[-2][2] != pp[-1][2])
                return a_ok and b_ok
            def budget():
                return max(0.3, PAIR_DEADLINE - (time.monotonic() - pair_t0))
            cands = [hybrid_astar(occ, (ca, alp), (cc, clp), nid, budget(), BB),
                     hybrid_astar(occ, (ca, alp), (cc, 1 - clp), nid, budget(), BB),
                     hybrid_astar(occ, (ca, 1 - alp), (cc, clp), nid, budget(), BB)]
            path = next((c for c in cands if ok_via_ends(c)), None)
            if not path:
                cands = [hybrid_astar(occ, (ca, alp), (cc, clp), nid, budget(), BB),
                         hybrid_astar(occ, (ca, 1 - alp), (cc, 1 - clp), nid, budget(), BB)]
                path = next((c for c in cands if ok_via_ends(c)), None)
            if not path:
                fails.append((nets.get(nid), a["ref"] + "." + a["pad"], c["ref"] + "." + c["pad"]))
                ripQ.append((nid, a, c))
                checkpoint()
                continue
            sp = simplify(path)
            occ_track(occ, path, nid, width)
            checkpoint()
            for n1, n2 in zip(sp, sp[1:]):
                if n1[2] != n2[2]:
                    vias.append((n1[0] * GRID, n1[1] * GRID, nid))
                else:
                    segs.append((n1[0] * GRID, n1[1] * GRID, n2[0] * GRID, n2[1] * GRID, n1[2], width, nid))
    if ripQ and not os.environ.get("BR_NO_RIP"):
        # rip-up retry: a failed pair usually starves because an earlier net
        # already owns the thin corridors around it. Lift ONE victim net fully
        # inside the pair's neighborhood, route the blocked pair first, and
        # requeue the victim's own pairs for the next round. Bounded by
        # rounds/deadline so the board always lands a resumable artifact.
        def mark_seg(oc, s):
            x1, y1, x2, y2, l, w, n = s
            oc.add_rect(min(x1, x2) - w / 2 - CLEAR, min(y1, y2) - w / 2 - CLEAR,
                        max(x1, x2) + w / 2 + CLEAR, max(y1, y2) + w / 2 + CLEAR, l, n)

        def ok_ends(pp, lp_):
            if not pp:
                return False
            a_ok = True if pp[0][2] == lp_ else (len(pp) > 1 and pp[1][2] != pp[0][2])
            b_ok = True if pp[-1][2] == lp_ else (len(pp) > 1 and pp[-2][2] != pp[-1][2])
            return a_ok and b_ok

        def try_pair(nid_, a, c):
            o2 = build_occ(pads)
            for s in segs:
                mark_seg(o2, s)
            ca, cc = cell(a["x"], a["y"]), cell(c["x"], c["y"])
            lp_ = layer_pref(nid_)
            w_ = W_POWER if nets.get(nid_, "") in POWER else W_SIG
            t_end = time.monotonic() + PAIR_DEADLINE
            for (la, lb, vc) in ((a.get("layer", lp_), c.get("layer", lp_), VIA_COST),
                                 (a.get("layer", lp_), 1 - c.get("layer", lp_), VIA_COST),
                                 (1 - a.get("layer", lp_), 1 - c.get("layer", lp_), VIA_COST),
                                 (a.get("layer", lp_), c.get("layer", lp_), 12)):
                rem = t_end - time.monotonic()
                if rem <= 0.1:
                    break
                pp = hybrid_astar(o2, (ca, la), (cc, lb), nid_, rem, BB)
                if pp and ok_ends(pp, lp_):
                    return pp, w_
            return None, w_

        rounds = 0
        while ripQ and rounds < 3 and time.monotonic() - START < BOARD_DEADLINE - 90:
            rounds += 1
            nxt = []
            for (nid, a, c) in ripQ:
                if time.monotonic() - START > BOARD_DEADLINE - 60:
                    nxt.append((nid, a, c))
                    continue
                box = (min(a["x"], c["x"]) - 0.8, min(a["y"], c["y"]) - 0.8,
                       max(a["x"], c["x"]) + 0.8, max(a["y"], c["y"]) + 0.8)
                victims = {}
                for s in segs:
                    mx, my = (s[0] + s[2]) / 2, (s[1] + s[3]) / 2
                    if box[0] <= mx <= box[2] and box[1] <= my <= box[3] and s[6] != nid:
                        victims[s[6]] = victims.get(s[6], 0) + 1
                if not victims:
                    nxt.append((nid, a, c))
                    continue
                victim = max(victims, key=lambda k: victims[k])
                lifted_s = [s for s in segs if s[6] == victim]
                lifted_v = [v for v in vias if v[2] == victim]
                segs[:] = [s for s in segs if s[6] != victim]
                vias[:] = [v for v in vias if v[2] != victim]
                pp, w_ = try_pair(nid, a, c)
                if not pp:
                    segs.extend(lifted_s)
                    vias.extend(lifted_v)
                    nxt.append((nid, a, c))
                    continue
                for n1_, n2_ in zip(simplify(pp), simplify(pp)[1:]):
                    if n1_[2] != n2_[2]:
                        vias.append((n1_[0] * GRID, n1_[1] * GRID, nid))
                    else:
                        segs.append((n1_[0] * GRID, n1_[1] * GRID,
                                     n2_[0] * GRID, n2_[1] * GRID, n1_[2], w_, nid))
                lab = (nets.get(nid), a["ref"] + "." + a["pad"], c["ref"] + "." + c["pad"])
                while lab in fails:
                    fails.remove(lab)
                checkpoint()
                for (va, vc_) in pair_cache.get(victim, []):
                    nxt.append((victim, va, vc_))
            ripQ = nxt
        for (nid, a, c) in ripQ:
            k = (nets.get(nid), a["ref"] + "." + a["pad"], c["ref"] + "." + c["pad"])
            if k not in fails:
                fails.append(k)

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
    _out = head + mid + "\n".join(emit) + "\n)\n"
    if only_nets:
        _n_out = len(re.findall(r'\((?:segment|via) ', _out))
        _n_want = len(kept_segs) + len(segs) + len(vias)
        if _n_out != _n_want:
            print(f"PARSE_IMBALANCE resume: want {_n_want} copper blocks (kept+new), out has {_n_out}; aborting write", file=sys.stderr)
            return 3
    open(out_path, "w").write(_out)
    print(f"routed: segments={len(segs)} vias={len(vias)} failed_edges={len(fails)}")
    for f in fails[:40]:
        print("  FAIL-EDGE", f)
    if fails:
        import re as _re
        rn = sorted({f[0] for f in fails if f[0]})
        print("[resume] nets=" + ",".join(rn), flush=True)
    return len(fails)


if __name__ == "__main__":
    only = None
    if "--only-nets" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only-nets") + 1].split(","))
    sys.exit(1 if route(sys.argv[1], sys.argv[2], only) else 0)
