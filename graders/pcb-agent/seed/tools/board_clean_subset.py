#!/usr/bin/env python3
"""board_clean_subset.py — rip to the maximal DRC-plausible copper subset.

r53 forensics: adaptive pair budgets let power tracks reach into 0.5mm-pitch
component rows where 0.4mm copper CANNOT be legal (terminal lead-ins cross
neighbour pads). Until the router grows fine fan-out geometry, deliver the
honest partial: drop offending copper (shortest first) until a full pairwise
check is clean, then let native DRC adjudicate. Usage:
  board_clean_subset.py IN.kicad_pcb OUT.kicad_pcb [--dry]
"""
import re, sys, math, os

def _tok(form, key):
    i = form.find(key)
    if i < 0: return None
    j = i + len(key)
    while j < len(form) and form[j] in " \t": j += 1
    if form[j] == '"':
        k = form.find('"', j + 1); return form[j + 1:k]
    k = j
    while k < len(form) and form[k] not in " )\n": k += 1
    return form[j:k]

def _netid(f):
    mm = re.match(r"\s*(\d+)", f[f.find("(net")+4:] if "(net" in f else "")
    return int(mm.group(1)) if mm else -1


def _forms(txt, name):
    """yield the argument-text of every top-level (name ...) form (balanced)."""
    out = []; i = 0
    pat = re.compile(r"\(\s*" + name + r"\s")
    while True:
        m = pat.search(txt, i)
        if not m: break
        needle = txt[m.start():m.end()]
        i = m.start()
        d = 0; j = i
        while j < len(txt):
            if txt[j] == "(": d += 1
            elif txt[j] == ")":
                d -= 1
                if d == 0: break
            elif txt[j] == '"':
                j = txt.find('"', j + 1)
                if j < 0: break
            j += 1
        if j >= len(txt): break
        out.append((i, txt[i + len(needle):j], j)); i = j + 1
    return out

def _xy(form, key):
    i = form.find(key)
    if i < 0: return None
    parts = form[i + len(key):].lstrip().replace(")", "").split()
    try: return (float(parts[0]), float(parts[1]))
    except Exception: return None

def seg_list(txt):
    out = []
    for i, f, j in _forms(txt, "segment"):
        st, en = _xy(f, "(start"), _xy(f, "(end")
        if not st or not en: continue
        out.append(dict(x1=st[0], y1=st[1], x2=en[0], y2=en[1],
                        w=float(_tok(f, "(width") or 0.25), l=(_tok(f, "(layer") or "F.Cu")[0],
                        net=_netid(f), span=(i, j + 1)))
    return out

def via_list(txt):
    out = []
    for i, f, j in _forms(txt, "via"):
        xy = _xy(f, "(at")
        if xy:
            out.append((i, xy[0], xy[1], float(_tok(f, "(size") or 0.6), _netid(f), j))
    return out


def via_span_list(txt):
    return [dict(x1=x, y1=y, x2=x, y2=y, kind="via", span=(i, j + 1))
            for (i, x, y, _sz, _n, j) in via_list(txt)]


def pads_of(txt):
    """GLOBAL pad coords: footprint origin + pad local offset (rot 0/90/180/270).
    r53 lesson: the first fixer read pad (at) LOCALLY -> every distance check was
    garbage yet ran green; coordinate provenance must be asserted against a known
    pad position before trusting geometry."""
    pads = []
    for fi, fp, fj in _forms(txt, "footprint"):
        fo = _xy(fp, "(at") or (0.0, 0.0)
        frot = 0.0
        i = fp.find("(at")
        parts = fp[i:].lstrip("(at ").replace(")", " ").split(None, 3)
        if len(parts) >= 3:
            try: frot = float(parts[2])
            except Exception: pass
        for pi, pf, pj in _forms(fp, "pad"):
            at = _xy(pf, "(at")
            sz = _xy(pf, "(size")
            if not at or not sz: continue
            lm0 = pf.find("(layers")
            lay_txt = pf[lm0:lm0 + 160] if lm0 >= 0 else ""
            nm = _tok(pf, "(net")
            if not (nm and nm.lstrip("-").isdigit()):
                copper = any(x in lay_txt for x in ('"F.Cu"', '"B.Cu"', '"*.Cu"'))
                if not copper:
                    continue  # F.Paste/F.Mask-only: not copper, not an obstacle
            a = math.radians(frot)
            gx = fo[0] + at[0] * math.cos(a) - at[1] * math.sin(a)
            gy = fo[1] + at[0] * math.sin(a) + at[1] * math.cos(a)
            lay = "F"
            lm = pf.find("(layers")
            if lm >= 0:
                seg = pf[lm:lm + 120]
                endq = seg.find(")")
                if endq > 0: seg = seg[:endq]
                if '"B.Cu"' in seg and '"F.Cu"' not in seg: lay = "B"
            pnet = int(nm) if nm and nm.lstrip("-").isdigit() else -1
            if pnet == -1 and "np_thru_hole" in pf[:60]:
                pnet = -2  # real drill hole: universal obstacle (no owning net)
            pads.append(dict(num=_tok(pf, "(pad "), x=gx, y=gy, w=sz[0], h=sz[1],
                             net=pnet, l=lay))
    return pads

CLR = 0.26  # default-class clearance; move-half budget baked per-segment below

def d2p(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L2))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))

def seg_seg(a, b):
    # conservative: min of endpoint-to-segment distances both ways (collinear
    # crossing misses are caught by the true-crossing test below)
    def cross(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0])
    p1,p2 = (a['x1'],a['y1']),(a['x2'],a['y2']); p3,p4 = (b['x1'],b['y1']),(b['x2'],b['y2'])
    d1,d2,d3,d4 = cross(p3,p4,p1),cross(p3,p4,p2),cross(p1,p2,p3),cross(p1,p2,p4)
    if ((d1>1e-9)!=(d2>1e-9) or abs(d1)<=1e-9) and ((d3>1e-9)!=(d4>1e-9) or abs(d3)<=1e-9):
        return 0.0
    return min(d2p(*p1,p3[0],p3[1],p4[0],p4[1]), d2p(*p2,p3[0],p3[1],p4[0],p4[1]),
               d2p(*p3,p1[0],p1[1],p2[0],p2[1]), d2p(*p4,p1[0],p1[1],p2[0],p2[1]))

def needed(sa, sb):   # min centre-to-centre distance between two traces
    return sa/2 + sb/2 + CLR

def pad_dist(s, p):
    # distance from segment to pad RECTANGLE (axis-aligned; rotations are rare
    # and only make the pad bigger here -> ring uses the circumscribed circle
    # radius to stay safe)
    r = math.hypot(p['w'], p['h']) / 2.0
    return d2p(p['x'], p['y'], s['x1'], s['y1'], s['x2'], s['y2']) - r

def main():
    # absolute-clean rip loop: cut OUR copper (Track/Via in the violation's own
    # item descriptions) until native DRC reports zero hard errors attributable
    # to us. Pad-vs-pad classes we cannot fix by cutting (solder_mask_bridge =
    # pad-to-pad; hole_clearance without a Via item = NPTH vs pad geometry).
    txt = open(sys.argv[1]).read()
    dst = sys.argv[2]
    KCLI = os.environ.get("KICAD_CLI", "/home/lab/bin/kicad-cli")
    import subprocess, json as _json
    open(dst, "w").write(txt)
    dropped = [0, 0]
    for rnd in range(40):
        tmp = dst + f".x{rnd}.json"
        try:
            subprocess.run([KCLI, "pcb", "drc", dst, "--severity-error",
                            "--format", "json", "--output", tmp], timeout=200, capture_output=True)
            doc = _json.load(open(tmp))
        except Exception as e:
            print(f"drc round {rnd} failed: {e}"); break
        viol = [v for v in doc.get("violations", []) if v.get("type") != "starved_thermal"]
        target = None
        for v in viol:
            ty = v.get("type")
            for it in v.get("items", []):
                descs = [(it.get("description") or "")] + [
                    (s.get("description") or "") for s in it.get("stack", [])]
                pos = it.get("pos") or {}
                for stk in it.get("stack", []):
                    sp = stk.get("pos") or {}
                    if sp and (sp.get("x") != pos.get("x") or sp.get("y") != pos.get("y")):
                        pos = sp
                        break
                is_tr = any("Track [" in d for d in descs)
                is_via = any(d.strip().startswith("Via") for d in descs)
                if not (is_tr or is_via):
                    continue
                if ty == "solder_mask_bridge":
                    continue
                # hole_clearance on OUR copper (track riding an NPTH ring or a
                # stitch via too close to J1 holes) IS cuttable — r53/dgtest: the
                # old skip-when-not-via rule left all 12 rail-vs-hole violations
                # uncut. Cut the smallest copper the violation names.
                if ty == "hole_clearance" and not (is_via or is_tr):
                    continue
                px, py = pos.get("x"), pos.get("y")
                if px is None:
                    continue
                # item pos = offending point on OUR copper: locate the block
                best = None
                lists = []
                if is_via:
                    lists += via_span_list(txt)
                if is_tr:
                    lists += seg_list(txt)
                if not lists:
                    lists = via_span_list(txt) + seg_list(txt)
                for s in lists:
                    x1, y1 = (s["x1"], s["y1"]) if "x1" in s else (s.get("at", (0, 0))[0], s.get("at", (0, 0))[1])
                    x2, y2 = (s["x2"], s["y2"]) if "x2" in s else (x1, y1)
                    lo_x, hi_x = min(x1, x2) - 0.03, max(x1, x2) + 0.03
                    lo_y, hi_y = min(y1, y2) - 0.03, max(y1, y2) + 0.03
                    if lo_x <= px <= hi_x and lo_y <= py <= hi_y:
                        L = math.hypot(x2 - x1, y2 - y1)
                        if best is None or L < best[0]:
                            best = (L, s["span"])
                if best:
                    target = best[1]
                    break
            if target:
                break
        if target is None:
            left = [v.get("type") for v in viol]
            from collections import Counter
            print("no cuttable copper violations remain:", dict(Counter(left)))
            break
        txt = txt[:target[0]] + txt[target[1]:]
        dropped[0 if txt[target[0]:target[0] + 12].lstrip().startswith("(segment") else 1] += 1
        open(dst, "w").write(txt)
    else:
        print("hit round cap")
    print(f"clean_subset: dropped_segs={dropped[0]} dropped_vias={dropped[1]}")

if __name__ == '__main__':
    main()
