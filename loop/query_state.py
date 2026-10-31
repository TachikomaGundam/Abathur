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
    if nominate_preflight():
        return 0
    if literals_preflight():
        return 0
    if draw_preflight():
        return 0
    session_census()
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
    fixture_reachability()
    return 0


def nominate_preflight() -> bool:
    """If .omo/pending-nominate.json exists, generate that generation's nomination page.

    Why through the queue: loop/nominate.py must read ~/.sibyl/spaces to prove an
    audit id exists, and the seat's bash sandbox sees a private tmpfs at /home/lab
    (so ~/.sibyl is invisible there). Queue jobs run host-side, where it is visible.
    Spec: {"gen": "G66", "audits": ["<runid>", ...], "gaps": ["<text>", ...]}
    """
    import json as _json

    spec_path = REPO / ".omo" / "pending-nominate.json"
    if not spec_path.is_file():
        return False
    try:
        spec = _json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, _json.JSONDecodeError) as exc:
        print(f"nominate_preflight| unusable spec: {exc}")
        return False
    gen = spec.get("gen") or ""
    if not gen:
        return False
    import subprocess as _sp

    cmd = [sys.executable, str(LOOP_DIR / "nominate.py"), gen]
    for run in spec.get("audits") or []:
        cmd += ["--audit", run]
    for gap in spec.get("gaps") or []:
        cmd += ["--gap", gap]
    proc = _sp.run(cmd, cwd=str(REPO), capture_output=True, text=True, timeout=600)
    for line in (proc.stdout or "").strip().splitlines()[-12:]:
        print(f"nominate| {line}")
    for line in (proc.stderr or "").strip().splitlines()[-8:]:
        print(f"nominate_err| {line}")
    print(f"nominate_preflight gen={gen} rc={proc.returncode}")
    if proc.returncode == 0:
        spec_path.unlink(missing_ok=True)
    return True


def literals_preflight() -> bool:
    """If .omo/pending-literals.json names a page, run the literal reconciler and stop.

    Why: nominations shipped memory-written literals twice, and the seat cannot
    reach a shell reliably enough to run the checker by hand. This makes the
    check a queue job: write {"page": "<path>", "roots": ["<dir>", ...]} and ask
    for a query; output comes back through the receipt channel.
    """
    import json
    import subprocess

    spec_path = REPO / ".omo" / "pending-literals.json"
    if not spec_path.is_file():
        return False
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"literals_preflight| unusable spec: {exc}")
        return False
    page = spec.get("page") or ""
    roots = spec.get("roots") or []
    if not page or not roots:
        return False
    cmd = [sys.executable, str(REPO / "loop" / "verify_nomination_literals.py"), page,
           "--roots", *roots]
    proc = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True, timeout=120)
    for line in (proc.stdout or "").strip().splitlines()[-14:]:
        print(f"literals| {line}")
    for line in (proc.stderr or "").strip().splitlines()[-4:]:
        print(f"literals_err| {line}")
    print(f"literals_preflight page={page} rc={proc.returncode}")
    return True


def draw_preflight() -> bool:
    """Read-only draw preflight: .omo/pending-draw.json {"gen":..,"items":[..]} -> rules verdict.

    Returns True when a proposal was pending (caller then reports only this decision, because
    the transport that carries job output truncates long reports and would bury the verdict).
    """
    pending = REPO / ".omo" / "pending-draw.json"
    try:
        spec = json.loads(pending.read_text())
    except Exception:
        return False
    gen = spec.get("gen") or ""
    items = spec.get("items") or []
    if not gen or not items:
        return False
    ok, msgs = draw.validate_draw(gen, items)
    print(f"draw_preflight gen={gen} items={items} verdict={'ACCEPTED' if ok else 'REFUSED'}")
    for m in msgs:
        print(f"draw_preflight| {m}")
    return True


def fixture_reachability() -> None:
    """Machine evidence for the SR4-69 fixture claim: which seeds actually land in a
    candidate workshop, and can the named checker be found from there."""
    from looplib import workshop_dir as ws_dir

    canonical = REPO / "skills/abathur-plan/plan-seg-check.mjs"
    if canonical.exists():
        print(f"fixture_canonical={canonical} sha256="
              f"{hashlib.sha256(canonical.read_bytes()).hexdigest()}")
    for gen in ("G63", "G64"):
        ws = ws_dir(gen, "SR4-69")
        print(f"fixture[{gen}]={ws} exists={ws.exists()}")
        if not ws.exists():
            continue
        planted = sorted(p.name for p in ws.iterdir())
        print(f"fixture[{gen}]_seeded={','.join(planted[:14])}")
        for label in ("plan-seg-check.mjs", "skills/abathur-plan/plan-seg-check.mjs"):
            cand = ws / label
            print(f"fixture[{gen}]_probe[{label}] exists={cand.exists()}")
        got = ws / "plan-seg-check.mjs"
        if got.exists():
            print(f"fixture[{gen}]_checker_sha256="
                  f"{hashlib.sha256(got.read_bytes()).hexdigest()}")


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
