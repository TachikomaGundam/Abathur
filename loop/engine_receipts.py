#!/usr/bin/env python3
"""engine_receipts.py — read the judge's engine database as a second, engine-authored source.

Why: every other input to the close gate is a file this repository writes, so a
verdict file can be edited and the gate cannot tell. The judge session runs with
HOME=<harness>/judge-home, so the engine writes its own session/message rows there.
The candidate cannot reach that directory, and the rows are produced by the engine
rather than by the seat's code. Reading them gives one fact the seat does not author:
a session with this id existed, under this title, at this time.

Limits stated plainly: the database is still a plain file on the same uid, so a
deliberate edit is possible; it is only out of reach of the candidate, not of the
operator. It raises the cost of silent forgery, it does not remove the trust root.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path


def judge_db(hd2: Path) -> Path:
    return hd2 / "judge-home" / ".local" / "share" / "opencode" / "opencode.db"


def _iso(ms):
    if ms is None:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ms / 1000.0))


def receipt(hd2: Path, session_id: str) -> dict:
    """Engine-side facts about one session. Never raises: absence is a value."""
    db = judge_db(hd2)
    out = {"session": session_id, "db": str(db), "found": False}
    if not session_id or not db.is_file():
        out["reason"] = "no engine database for this judge home"
        return out
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            row = conn.execute(
                "select title, time_created, agent, model, tokens_input, tokens_output"
                " from session where id=?", (session_id,)).fetchone()
            if not row:
                out["reason"] = "session id absent from the engine database"
                return out
            title, created, agent, model, tin, tout = row
            msgs, first, last = conn.execute(
                "select count(*), min(time_created), max(time_created)"
                " from session_message where session_id=?", (session_id,)).fetchone()
            out.update({
                "found": True,
                "title": title,
                "created_ms": created,
                "created_utc": _iso(created),
                "agent": agent,
                "model": model,
                "tokens_input": tin,
                "tokens_output": tout,
                "messages": msgs,
                "first_message_utc": _iso(first),
                "last_message_utc": _iso(last),
            })
            return out
        finally:
            conn.close()
    except Exception as exc:  # a broken database is a missing receipt, not a pass
        out["reason"] = f"engine database unreadable: {exc}"
        return out


def check(hd2: Path, session_id: str, *, not_after: Path | None, tolerance_s: int = 120) -> dict:
    """Receipt plus a time bound: the session must predate the artifact it vouches for."""
    out = receipt(hd2, session_id)
    out["ok"] = False
    if not out["found"]:
        return out
    if not_after is not None and not_after.is_file():
        bound = int(not_after.stat().st_mtime * 1000) + tolerance_s * 1000
        out["not_after"] = str(not_after)
        out["bound_ms"] = bound
        if out["created_ms"] is None or out["created_ms"] > bound:
            out["reason"] = "session created after the artifact it is cited for"
            return out
    out["ok"] = True
    return out


def session_from_receipt(path: Path) -> str | None:
    """Pull `session=ses_…` out of a queue result or judge-work/session.txt."""
    if not path.is_file():
        return None
    try:
        if path.suffix == ".json":
            body = json.loads(path.read_text())
            text = f"{body.get('tail') or ''}"
        else:
            text = path.read_text(errors="replace")
    except Exception:
        return None
    for token in text.replace("\n", " ").split():
        if token.startswith("session=ses_"):
            return token.split("=", 1)[1].strip(",;")
    return None


if __name__ == "__main__":
    import sys
    print(json.dumps(receipt(Path(sys.argv[1]), sys.argv[2]), ensure_ascii=False, indent=2))
