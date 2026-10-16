#!/usr/bin/env python3
"""plain-watch.py — plain-speech sentry for upward reports (owner ruling 2026-10-07).

Scans the engine session database (READ-ONLY) for new assistant text messages in
this project, treats messages >= 700 chars as formal reports, and checks two
mechanical rules:
  1. closed institutional-jargon dictionary (same 10 words as loop/bank.py _JARGON)
     — any bare occurrence is a violation;
  2. sentence-length warning line (> 60 chars between 。！？ or newline) — counted,
     reported, but never a violation by itself (threshold not owner-ratified yet);
  3. RULE TWO v1 (2026-10-12, owner ruling 『做』; spec .omo/evidence/PLAIN-WATCH-RULES-SPEC.md):
     assistant messages >= 200 chars whose fenced command blocks carry outward-action
     verbs (closed family table) need same-session EARLIER tool evidence per family;
     unproven -> VIOLATION-PRESCRIPTION line. Predicate edits: append dated VERSIONS line.

Each violating message appends one line to .omo/evidence/PLAIN-WATCH.md and fires
notify-send when a display is available. State (last seen message time) lives in
.omo/evidence/plain-watch-state.json; first run starts at "now" — the sentry
polices forward, history is audited separately, never by surprise.

Run from crontab every 5 minutes. Env overrides: OPENCODE_DB, PLAINWATCH_SINCE
(epoch-ms, test hook: scan a backdated window instead of the stored state).
"""
from __future__ import annotations

import hashlib
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
STATE = Path(os.environ.get("PLAINWATCH_STATE", str(REPO / ".omo/evidence/plain-watch-state.json")))
LOG = Path(os.environ.get("PLAINWATCH_LOG", str(REPO / ".omo/evidence/PLAIN-WATCH.md")))
JARGON = ["铃测", "实弹", "收口", "闭环", "钳", "尺伤", "票面", "题化", "义务池", "车道"]
MIN_REPORT_CHARS = 700
LONG_SENT_CHARS = 60
SENT_SPLIT = re.compile(r"[。！？!?\n]")


# ---------------------------------------------------------------------------
# RULE TWO — unproven-prescription detection. VERSIONS (append-only):
#   v1 2026-10-12 initial families + pairing + exemptions (spec file dated same).
#   v1.1 2026-10-12 bypass evidence upgraded: mere mentions of the gate name must not
#        bless a window; only completed-gate output token counts as authorization.
#   v1.2 2026-10-12 ledger/state/log paths env-overridable (PLAINWATCH_LEDGER/STATE/LOG)
#        — integration tests must never target the live intent ledger.
#   v1.3 2026-10-16 bypass evidence moved to gate receipt FILE (before,after pairing);
#        stdout token retired as evidence (truncatable by caller pipes — G-82, 30 false warns).
#   v1.4 2026-10-16 pairing = cur matches ANY receipt .after (multi-hop safe); single-hop
#        before==prev falsified by concurrent shared-surface writes + multi-append intervals.
#   v1.5 2026-10-16 LEDGER-GAP advisory (superseded by v1.6 — any-after/prev schemes were
#        maskable by a raw write followed by a gate write).
#   v2.0 2026-10-16 甲案: predicate rewritten to constitutional doctrine (L-STATE-ATOMIC
#        multi-writer appends LEGAL). PREFIX-TAMPER=CRITICAL (rewritten history),
#        UNRECEIPTED-APPEND=INFO once per delta (attribution snippet). BYPASS-WRITE and
#        LEDGER-CHAIN-BREAK alarms REPEALED — they over-enforced single-writer on a
#        constitutionally shared surface (foreign legit append fired twice, owner chose
#        甲 per-seat ledgers; this predicate is now doctrine-exact).
#   v1.6 2026-10-16 receipt carries before_bytes + target_sha256(delta bytes) + payload_sha256;
#        verdict = byte-slice verification of the ledger tail against the receipt — the only
#        scheme that unmasks insertions between sanctioned appends. Gap classes: BYPASS-WRITE
#        (cur is nobody's receipt) / LEDGER-GAP (receipt present, tail-slice mismatch).
# ---------------------------------------------------------------------------
PRESCRIPTION_MIN_CHARS = 200
VERB_FAMILIES = [
    ("push",        r"git\s+push",                            r"ls-remote|show-ref|rev-parse|rev-list|for-each-ref|branch\s+-a"),
    ("tag-new",     r"git\s+tag\s+(?!-l\b)(?!-d\b)",         r"cat-file|show-ref|for-each-ref|ls-remote"),
    ("publish",     r"npm\s+publish|npm\s+version",            r"pack\s+--dry-run|npm\s+test|npm\s+view|--test"),
    ("file-rm",     r"\brm\s+-[rf]",                           r"\bls\b|stat|cat-file|find\b"),
    ("inplace-sed", r"sed\s+-i",                                r"\bgrep\b|\bcat\b|read|head\b"),
    ("net-mutate",  r"curl\s+[^\n]*-X\s*(POST|PUT|DELETE|PATCH)", r"curl"),
    ("border-push", r"border\s+push",                           r"border[^\"]{0,40}check|\bcheck\b"),
    ("promote",     r"abathur\s+(promote|tombstone)",            r"INTENT-LEDGER|approve|批准"),
    ("repo-new",    r"gh\s+repo\s+create",                      r"gh\s+api|repo\s+list|ls-remote"),
]

def _citations_out(block: str) -> str:
    """Exemption 1: content inside paired CJK quotes or inline backticks is citation."""
    b = re.sub(r"「[^」]*」", "", block)
    b = re.sub(r"`[^`\n]*`", "", b)
    return b

def prescription_findings(text: str):
    if len(text) < PRESCRIPTION_MIN_CHARS:
        return []
    if text.lstrip().startswith("#") and "回执索引" in text:
        pass  # exemption 2 handled per-block below only when opener present pre-fence
    out = []
    pre = text.split("```")[0]
    if "回执索引" in pre:
        return []
    for m in re.finditer(r"```[^\n]*\n(.*?)```", text, re.S):
        block = m.group(1)
        for fam, vpat, _need in VERB_FAMILIES:
            body = _citations_out(block)
            if not re.search(vpat, body):
                continue
            if not re.search(r"^(?:\s*)(?:cd\b[^&\n]*(?:&&|;|\n))?\s*(git|npm|rm|sed|curl|border|abathur|gh)\b", body, re.M):
                continue  # must read as shell lines, not prose
            hit = next(l for l in body.splitlines() if re.search(vpat, l))
            out.append((fam, re.sub(r"\s+", " ", hit)[:60]))
    return out

def evidence_ok(fam: str, prior_tools_blob: str) -> bool:
    for f, _v, need in VERB_FAMILIES:
        if f == fam:
            return bool(re.search(need, prior_tools_blob))
    return False


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
        stamp = time.strftime("%FT%TZ", time.gmtime())
        LOG.parent.mkdir(parents=True, exist_ok=True)
        if len(text) >= MIN_REPORT_CHARS:
            hits = {w: text.count(w) for w in JARGON if w in text}
            long_n = sum(1 for s in SENT_SPLIT.split(text) if len(s.strip()) > LONG_SENT_CHARS)
            if hits:
                violations += 1
                with LOG.open("a") as f:
                    f.write(f"- {stamp} VIOLATION session={sid} message={mid} jargon={hits} long_sentences={long_n}\n")
        # ---- RULE TWO: unproven outward-action prescriptions ----
        for fam, excerpt in prescription_findings(text):
            blob = "\n".join(
                r[0]
                for r in db.execute(
                    "SELECT p.data FROM message m2 JOIN part p ON p.message_id = m2.id"
                    " WHERE m2.session_id = ? AND m2.time_created <= ?"
                    " AND json_extract(p.data, '$.type') = 'tool'",
                    (sid, int(t)),
                ).fetchall()
            )
            if not evidence_ok(fam, blob):
                violations += 1
                with LOG.open("a") as f:
                    f.write(
                        f"- {stamp} VIOLATION-PRESCRIPTION session={sid} message={mid}"
                        f" family={fam} need=earlier-tool-evidence block={excerpt!r}\n"
                    )
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
    # ---- RULE THREE v2.0 (甲案, owner ruling 2026-10-16) ----
    # CONSTITUTIONAL PREDICATE (L-STATE-ATOMIC: 追加式证据账本多写者合法, 仅重写/删除既往=断链):
    #   CRITICAL  PREFIX-TAMPER  — a gate receipt's recorded prefix (bytes 0..after_bytes)
    #            no longer hashes to its recorded `after`: history was rewritten/deleted.
    #   INFO      UNRECEIPTED-APPEND — new tail content not covered by any receipt: legal
    #            under multi-writer doctrine; logged once per delta with an attribution
    #            snippet (v1.x flagged these as BYPASS/CHAIN-BREAK = ruler wrote a law
    #            stricter than the constitution; that predicate is hereby repealed).
    led = Path(os.environ.get("PLAINWATCH_LEDGER", str(REPO / ".omo/evidence/INTENT-LEDGER.md")))
    if led.exists():
        cur = hashlib.sha256(led.read_bytes()).hexdigest()
        prev_sha = None
        if test_since is None and STATE.exists():
            prev_sha = json.loads(STATE.read_text()).get("ledger_sha")
        recs: list = []
        rcv = led.parent / ".g82-receipts.jsonl"
        if rcv.exists():
            for ln in rcv.read_text().splitlines():
                try:
                    recs.append(json.loads(ln))
                except json.JSONDecodeError:
                    continue
        stamp_t = time.strftime("%FT%TZ", time.gmtime())
        raw = led.read_bytes()
        problems: list = []
        for r in recs:
            ab = r.get("after_bytes")
            af = r.get("after")
            if ab is None or af is None or int(ab) > len(raw):
                continue
            if hashlib.sha256(raw[:int(ab)]).hexdigest() != af:
                problems.append(f"PREFIX-TAMPER receipt {str(r.get('ts'))} prefix {int(ab)}B no longer hashes to {af[:12]}")
        max_ab = max([int(r["after_bytes"]) for r in recs if "after_bytes" in r], default=0)
        tail = raw[max_ab:]
        st0 = json.loads(STATE.read_text()) if STATE.exists() else {}
        if tail.strip():
            seen_tail = st0.get("tail_seen_sha")
            if hashlib.sha256(tail).hexdigest() != seen_tail:
                with LOG.open("a") as f:
                    f.write(f"- {stamp_t} INFO UNRECEIPTED-APPEND {len(tail)}B after last receipt; attribution-head: {tail[:120].decode('utf-8', 'replace').strip()!r}\n")
        else:
            seen_tail = st0.get("tail_seen_sha")
        if test_since is None:
            STATE.parent.mkdir(parents=True, exist_ok=True)
            st = json.loads(STATE.read_text()) if STATE.exists() else {}
            st.update({"last_time": max_t, "ledger_sha": cur,
                       "tail_seen_sha": hashlib.sha256(tail).hexdigest() if tail.strip() else None})
            tmp = STATE.with_suffix(".tmp")
            tmp.write_text(json.dumps(st) + "\n")
            os.replace(tmp, STATE)
        for msg in problems:
            violations += 1
            with LOG.open("a") as f:
                f.write(f"- {stamp_t} CRITICAL {msg}\n")
    print(f"plain-watch: scanned={scanned} violations={violations} state_to={max_t}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
