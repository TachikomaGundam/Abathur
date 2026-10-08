#!/usr/bin/env python3
"""plain-watch.py — plain-speech sentry for upward reports (owner ruling 2026-10-07).

Scans the engine session database (READ-ONLY) for new assistant text messages in
this project, treats messages >= 700 chars as formal reports, and checks two
mechanical rules:
  1. closed institutional-jargon dictionary (same 10 words as loop/bank.py _JARGON)
     — any bare occurrence is a violation;
  2. sentence-length warning line (> 60 chars between 。！？ or newline) — counted,
     reported, but never a violation by itself (threshold not owner-ratified yet).

Each violating message appends one line to .omo/evidence/PLAIN-WATCH.md and fires
notify-send when a display is available. State (last seen message time) lives in
.omo/evidence/plain-watch-state.json; first run starts at "now" — the sentry
polices forward, history is audited separately, never by surprise.

Run from crontab every 5 minutes. Env overrides: OPENCODE_DB, PLAINWATCH_SINCE
(epoch-ms, test hook: scan a backdated window instead of the stored state).
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DB = Path(os.environ.get("OPENCODE_DB", str(Path.home() / ".local/share/opencode/opencode.db")))
STATE = REPO / ".omo/evidence/plain-watch-state.json"
LOG = REPO / ".omo/evidence/PLAIN-WATCH.md"
JARGON = ["铃测", "实弹", "收口", "闭环", "钳", "尺伤", "票面", "题化", "义务池", "车道"]
MIN_REPORT_CHARS = 700
LONG_SENT_CHARS = 60
SENT_SPLIT = re.compile(r"[。！？!?\n]")


def scan(since_ms: int) -> tuple[int, int, int]:
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = db.execute(
        """SELECT m.session_id, p.message_id, m.time_created, p.data
           FROM message m
           JOIN part p ON p.message_id = m.id
           JOIN session s ON s.id = m.session_id
           WHERE s.directory LIKE '%Abathur'
             AND json_extract(m.data, '$.role') = 'assistant'
             AND json_extract(p.data, '$.type') = 'text'
             AND m.time_created > ?
           ORDER BY m.time_created""",
        (since_ms,),
    ).fetchall()
    max_t, scanned, violations = since_ms, 0, 0
    for sid, mid, t, data in rows:
        scanned += 1
        max_t = max(max_t, int(t))
        try:
            text = json.loads(data).get("text", "")
        except json.JSONDecodeError:
            continue
        if len(text) < MIN_REPORT_CHARS:
            continue
        hits = {w: text.count(w) for w in JARGON if w in text}
        long_n = sum(1 for s in SENT_SPLIT.split(text) if len(s.strip()) > LONG_SENT_CHARS)
        if hits:
            violations += 1
            stamp = time.strftime("%FT%TZ", time.gmtime())
            line = f"- {stamp} VIOLATION session={sid} message={mid} jargon={hits} long_sentences={long_n}\n"
            LOG.parent.mkdir(parents=True, exist_ok=True)
            with LOG.open("a") as f:
                f.write(line)
            try:
                subprocess.run(
                    ["notify-send", "plain-watch: 汇报含机构黑话", f"{sum(hits.values())} 处裸用，见 PLAIN-WATCH.md"],
                    capture_output=True,
                    timeout=5,
                )
            except (FileNotFoundError, subprocess.TimeoutExpired):
                pass
    return max_t, scanned, violations


def main() -> int:
    if not DB.exists():
        print(f"plain-watch: engine db not found at {DB}", file=sys.stderr)
        return 2
    test_since = os.environ.get("PLAINWATCH_SINCE")
    if test_since is not None:
        since = int(test_since)
    elif STATE.exists():
        since = int(json.loads(STATE.read_text())["last_time"])
    else:
        since = int(time.time() * 1000)
    max_t, scanned, violations = scan(since)
    if test_since is None:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"last_time": max_t}) + "\n")
        os.replace(tmp, STATE)
    print(f"plain-watch: scanned={scanned} violations={violations} state_to={max_t}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
