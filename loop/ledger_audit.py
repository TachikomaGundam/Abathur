#!/usr/bin/env python3
"""ledger_audit — the ordering authority L-LEDGER-FIRST needs (3eb5 parliament:
same-machine clocks are not adversarial-grade; the engine session store's
event order is, and BOTH ledger appends and artifact writes are tool calls
inside that one total order). Read-only against the DB; emits L-BLIND-AUDIT
四元 receipts. MVP: two checks + a chain-head anchor line."""
import argparse, hashlib, json, os, sqlite3, sys, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DB_DEFAULT = str(Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
                 / "opencode" / "opencode.db")
LEDGER_DEFAULT = str(REPO / ".omo" / "evidence" / "INTENT-LEDGER.md")
MARKER = "INTENT-LEDGER"  # ledger appends are bash calls whose input names the file

def events(db, session_ids):
    """total order over tool/user events: (ordinal, kind, payload)"""
    q = """select m.data, p.data, m.id, p.id from message m
           left join part p on p.message_id = m.id
           where m.session_id in (%s) order by m.id, p.id""" % ",".join("?" * len(session_ids))
    out, n = [], 0
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    for mdata, pdata, mid, pid in con.execute(q, session_ids):
        try: mrole = (json.loads(mdata) or {}).get("role")
        except Exception: mrole = None
        if mrole == "user":
            out.append((n, "human", mid)); n += 1
        if pdata:
            try: p = json.loads(pdata)
            except Exception: continue
            if p.get("type") == "tool":
                inp = json.dumps((((p.get("part") or p).get("state") or {}).get("input")), ensure_ascii=False) if isinstance(p.get("part") or p, dict) else ""
                tool = (p.get("part") or p).get("tool", "?") if isinstance(p.get("part") or p, dict) else "?"
                out.append((n, "tool", {"tool": tool, "input": inp, "mid": mid})); n += 1
    con.close()
    return out

def first_write(evts, path_substr):
    for o, kind, pl in evts:
        if kind == "tool" and isinstance(pl, dict) and pl["tool"] in ("write", "edit") and path_substr in pl["input"]:
            return o
    return None

def ledger_appends(evts):
    return [o for o, kind, pl in evts if kind == "tool" and isinstance(pl, dict) and MARKER in pl["input"]]

def audit(db, ledger, artifact):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    sids = [r[0] for r in con.execute(
        "select id from session where time_updated > (strftime('%s','now','-24 hours')*1000)")]
    con.close()
    evts = events(db, sids)
    aw = first_write(evts, artifact)
    la = [o for o in ledger_appends(evts) if aw is None or o < aw]
    res = {"artifact_first_write_ordinal": aw,
           "ledger_appends_before_it": len(la),
           "verdict": ("ORDER-OK" if aw is not None and la else
                       "ORDER-VIOLATION" if aw is not None else "ARTIFACT-UNFOUND"),
           "ordinal_authority": "engine session store (read-only), human+tool event sequence",
           "sessions_scanned": len(sids),
           "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    body = json.dumps(res, ensure_ascii=False, sort_keys=True)
    out = {"receipt_path": None, "ledger_sha256": hashlib.sha256(open(ledger, "rb").read()).hexdigest(),
           "audit_output_sha256": hashlib.sha256(body.encode()).hexdigest(), "result": res}
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return res["verdict"]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DB_DEFAULT); ap.add_argument("--ledger", default=LEDGER_DEFAULT)
    ap.add_argument("--artifact", required=True)
    sys.exit(0 if audit(ap.parse_args().db, ap.parse_args().ledger, ap.parse_args().artifact) == "ORDER-OK" else 1)
