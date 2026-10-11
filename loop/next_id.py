#!/usr/bin/env python3
"""Global SR4-id allocator: the collision fix after the 2026-10-10 double-take.

Occupancy = bank.ITEMS (built units) union proposals/sr4-NN-*.{md} (drafts)
union .omo/state/id-reservations.json (in-flight claims by any window).
Atomic claim: tmp+fsync+rename; claiming an occupied id refuses (exit 1,
fail-closed). Windows on this machine share one file -> one allocator.
"""
import datetime
import json, os, re, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RES = os.path.join(REPO, ".omo", "state", "id-reservations.json")
MIN_NEXT = 52  # SR4-52..58 are the G40 wave; allocator only serves the frontier

def occupancy():
    occ = {}
    try:
        sys.path.insert(0, HERE)
        import bank
        for k in bank.ITEMS:
            m = re.fullmatch(r"SR4-(\d+)", k)
            if m: occ.setdefault(int(m.group(1)), []).append("bank")
    except Exception as e:
        print(f"warn: bank unimportable ({e})", file=sys.stderr)
    pdir = os.path.join(HERE, "proposals")
    for f in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
        m = re.match(r"sr4-(\d+)-", f)
        if m: occ.setdefault(int(m.group(1)), []).append("draft:" + f)
    if os.path.exists(RES):
        for r in json.load(open(RES)):
            occ.setdefault(int(r["id"]), []).append("claim:" + r.get("lane", "?"))
    return occ

def load_claims():
    return json.load(open(RES)) if os.path.exists(RES) else []

def save_claims(claims):
    os.makedirs(os.path.dirname(RES), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(RES))
    with os.fdopen(fd, "w") as f:
        json.dump(claims, f, ensure_ascii=False, indent=1); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, RES)

def main():
    args = sys.argv[1:]
    if not args or args[0] == "--list":
        for i, srcs in sorted(occupancy().items()):
            print(f"SR4-{i}: {', '.join(srcs)}")
        free = next((i for i in range(MIN_NEXT, 999) if i not in occupancy()), None)
        print(f"next free: SR4-{free}")
        return 0
    if args[0] == "claim":
        # claim N --lane NAME --for PURPOSE  (N may be 'auto')
        n = args[1]
        occ = occupancy()
        if n == "auto":
            n = next((i for i in range(MIN_NEXT, 999) if i not in occ), None)
            if n is None: print("no free id", file=sys.stderr); return 2
        n = int(n)
        if n in occ:
            print(f"REFUSAL: SR4-{n} occupied by {', '.join(occ[n])} — fail-closed", file=sys.stderr)
            return 1
        lane = args[args.index("--lane") + 1] if "--lane" in args else "unnamed"
        purpose = args[args.index("--for") + 1] if "--for" in args else ""
        claims = load_claims()
        claims.append({"id": n, "lane": lane, "for": purpose,
                       "at": datetime.datetime.now(datetime.timezone.utc).strftime("%FT%TZ")})
        save_claims(claims)
        print(f"claimed SR4-{n} for lane={lane} ({purpose})")
        return 0
    print("usage: next_id.py [--list | claim N|auto --lane L --for P]", file=sys.stderr)
    return 2

if __name__ == "__main__":
    sys.exit(main())
