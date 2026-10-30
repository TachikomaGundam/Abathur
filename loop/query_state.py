#!/usr/bin/env python3
"""query_state.py — read-only exam state reporter (no writes, no queue mutation).

Prints the mechanical regression duty per loop/draw.py, the class map for the two
duty-bearing classes, and a one-line summary of the most recent archived bundles.
Precedent: the council asked for mechanical proof of guard state rather than prose.
Exit 0 = reported.
"""
import hashlib
import json
import sys
from pathlib import Path

LOOP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(LOOP_DIR))

import bank  # noqa: E402
import draw  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
ARCH = REPO / ".omo/evidence/loop-archive"


def main() -> int:
    session_census()  # first: long class lists below can push it past the receipt tail
    fixture_reachability()
    print(f"passes_to_clear={draw.PASSES_TO_CLEAR}")
    print(f"regression_duty={draw.regression_duty()}")

    noncanary = sorted(i for i, it in bank.ITEMS.items() if not it.get("canary"))
    print(f"non_canary_items={noncanary}")

    for cls in sorted(set(draw.CLASS_OF.values())):
        members = sorted(i for i, c in draw.CLASS_OF.items() if c == cls)
        if len(members) == 1:
            print(f"single_item_class {cls}: {members[0]}")

    bundles = sorted(ARCH.glob("G*/bundle.json"))
    for p in bundles[-6:]:
        try:
            j = json.loads(p.read_text())
        except Exception as exc:  # noqa: BLE001
            print(f"{p.parent.name}: unreadable {exc}")
            continue
        rows = [(i["item"], i.get("verdict")) for i in j.get("items", [])]
        print(f"{j.get('gen')}: state={j.get('terminal_state')} "
              f"nominatable={j.get('nominatable')} killed={j.get('canaries_killed')} items={rows}")
    session_census()
    return 0


def fixture_reachability() -> None:
    """Machine evidence for the SR4-69 fixture claim: is the named checker reachable
    from a candidate workshop, and what exactly does the seed stage plant?"""
    from looplib import workshop_dir as ws_dir

    ws = ws_dir("G63", "SR4-69")
    named = REPO / "skills/abathur-plan/plan-seg-check.mjs"
    print(f"fixture_ws={ws} exists={ws.exists()}")
    if ws.exists():
        print("fixture_seeded=" + ",".join(sorted(p.name for p in ws.iterdir())[:12]))
    for label, cand in (("ws_relative", ws / "skills/abathur-plan/plan-seg-check.mjs"),
                        ("ws_parent", ws.parent / "skills/abathur-plan/plan-seg-check.mjs"),
                        ("repo_abs", named)):
        print(f"fixture_probe[{label}]={cand} exists={cand.exists()}")
    if named.exists():
        digest = hashlib.sha256(named.read_bytes()).hexdigest()[:16]
        print(f"fixture_checker_sha256_16={digest} cwd_of_run_stage={Path.cwd()}")


def session_census() -> None:
    """Read-only engine-session census: per-day session creation and size histogram."""
    import datetime
    import glob
    import sqlite3

    cands = sorted(glob.glob(str(Path.home() / ".local/share/opencode/*.db")),
                   key=lambda p: Path(p).stat().st_mtime, reverse=True)
    if not cands:
        print("census: no session store found")
        return
    for p in cands[:6]:
        st = Path(p).stat()
        print(f"census_store_candidate={Path(p).name} size={st.st_size // 1048576}MiB "
              f"mtime={datetime.datetime.fromtimestamp(st.st_mtime):%m-%d %H:%M}")
    con = sqlite3.connect(f"file:{cands[0]}?mode=ro", uri=True)
    tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
    print(f"census_store={Path(cands[0]).name} tables={tables[:12]}")
    stab = next((t for t in tables if t == "session"), None)
    if stab is None:
        if "event" not in tables:
            print("census: neither session table nor event store")
            return
        cols = [r[1] for r in con.execute("pragma table_info(event)")]
        print(f"census_event_cols={cols[:10]}")
        payload = next((c for c in ("payload", "data", "body") if c in cols), None)
        agg = next((c for c in ("aggregate_id", "session_id", "sid") if c in cols), None)
        tcol = next((c for c in ("time_created", "created", "ts", "time") if c in cols), None)
        if payload is None or agg is None:
            print("census: event store shape unrecognised")
            return
        sess: dict = {}
        for row in con.execute(f"select {agg}, {payload}" + (f", {tcol}" if tcol else "")):
            sid, raw = row[0], row[1]
            tc = row[2] if tcol else 0
            try:
                d = json.loads(raw) if isinstance(raw, str) else {}
            except Exception:  # noqa: BLE001
                d = {}
            if not tc:
                tc = d.get("time") or d.get("timestamp") or 0
            rec = sess.setdefault(sid, {"n": 0, "t0": tc or 0, "types": set()})
            rec["n"] += 1
            if tc and (not rec["t0"] or tc < rec["t0"]):
                rec["t0"] = tc
        per_day: dict = {}
        for sid, rec in sess.items():
            if not rec["t0"]:
                per_day["no-ts"] = per_day.get("no-ts", 0) + 1
                continue
            day = datetime.datetime.fromtimestamp(rec["t0"] / 1000).strftime("%m-%d")
            per_day[day] = per_day.get(day, 0) + 1
        print(f"census_sessions_total={len(sess)}")
        print("census_sessions_per_day=" +
              " ".join(f"{d}:{n}" for d, n in sorted(per_day.items())[-8:]))
        msg_tab = next((t for t in tables if t == "message"), None)
        if msg_tab:
            mcols = [r[1] for r in con.execute(f"pragma table_info({msg_tab})")]
            sc = next((c for c in ("session_id", "sessionID", "session") if c in mcols), None)
            if sc:
                sizes = dict(con.execute(f"select {sc}, count(*) from {msg_tab} group by {sc}"))
                hist = {"1": 0, "2-3": 0, "4-10": 0, ">10": 0}
                for n in sizes.values():
                    hist["1" if n == 1 else "2-3" if n <= 3 else "4-10" if n <= 10 else ">10"] += 1
                print(f"census_msg_size_hist={hist}")
        else:
            hist = {"1": 0, "2-3": 0, "4-10": 0, ">10": 0}
            for rec in sess.values():
                n = rec["n"]
                hist["1" if n == 1 else "2-3" if n <= 3 else "4-10" if n <= 10 else ">10"] += 1
            print(f"census_event_size_hist={hist} (1-event sessions = receipt-only shape)")
        return
    cols = [r[1] for r in con.execute(f"pragma table_info({stab})")]
    print(f"census_store={Path(cands[0]).name} session_cols={cols[:10]}")
    tcol = next((c for c in ("time_created", "created", "time") if c in cols), None)
    if tcol is None:
        print("census: no time column")
        return
    per_day = {}
    ids_by_day = {}
    for (tc,) in con.execute(f"select {tcol} from {stab}"):
        day = datetime.datetime.fromtimestamp(tc / 1000).strftime("%m-%d")
        per_day[day] = per_day.get(day, 0) + 1
    mtab = next((t for t in tables if t == "message"), None)
    counts: dict = {}
    hist = {"1": 0, "2-3": 0, "4-10": 0, ">10": 0}
    if mtab:
        mcols = [r[1] for r in con.execute(f"pragma table_info({mtab})")]
        sess_col = next((c for c in ("session_id", "sessionID", "session") if c in mcols), None)
        if sess_col:
            counts = dict(con.execute(f"select {sess_col}, count(*) from {mtab} group by {sess_col}"))
            for sid, n in counts.items():
                key = "1" if n == 1 else "2-3" if n <= 3 else "4-10" if n <= 10 else ">10"
                hist[key] += 1
    print("census_sessions_per_day=" +
          " ".join(f"{d}:{n}" for d, n in sorted(per_day.items())[-8:]))
    print(f"census_msg_size_hist={hist} (sessions with 1 msg = receipt-only shape)")
    title_col = next((c for c in ("title", "name", "label") if c in cols), None)
    if title_col is None:
        return
    id_col = next((c for c in ("id", "session_id") if c in cols), None)
    tiny_ids = {sid for sid, n in counts.items() if n <= 3} if (id_col and mtab) else set()
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=2)).timestamp() * 1000
    tally: dict = {}
    for tc, raw_title, sid in con.execute(
            f"select {tcol}, {title_col}, {id_col} from {stab} where {tcol} >= ?", (cutoff,)):
        label = (raw_title or "«no-title»").strip()[:18] or "«empty»"
        rec = tally.setdefault(label, {"n": 0, "tiny": 0})
        rec["n"] += 1
        if sid in tiny_ids:
            rec["tiny"] += 1
    print("census_recent_titles=" + " | ".join(
        f"{lab}×{rec['n']}(tiny {rec['tiny']})" for lab, rec in
        sorted(tally.items(), key=lambda kv: -kv[1]["n"])[:12]))


if __name__ == "__main__":
    sys.exit(main())
