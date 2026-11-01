#!/usr/bin/env python3
"""item_defects.py — append-only, hash-chained record of ITEM (rubric) defects.

Why this exists: a judged FAIL can be the item's fault, not the candidate's. Recording
that as prose in a ledger leaves the bundle asserting a candidate failure forever, and
editing `canaries_killed` would rewrite observed evidence. Both are wrong. This module
carries the correction in ONE place: an external append-only ledger bound to the sealed
bundle's sha256, while the bundle itself is never rewritten.

Writer gate (mechanical): an entry is only accepted when it names an auditor session that
the engine's own database shows exists, and that session is not any of the judged
generation's candidate/judge sessions. A seat cannot mint its own correction.

Consumers (must exist, else the record is decoration):
  - loop/bundle_close.py injects *additive* fields (`item_defects`, `item_defect_count`)
    into NEW bundles only; it never touches `items` or `canaries_killed`.
  - scripts/verify-all.sh runs `item_defects.py check` (chain + binding + evidence).
Stale or forged entries fail closed: binding sha mismatch, broken chain, missing evidence
file, or a later-pass bundle whose item verdict is not PASS.

Schema of one entry (all fields required unless noted):
  gen, item, class, bundle_sha256, decided_at (system clock),
  claim, criteria_evidence [{path, sha256}], item_evidence [{path, sha256}],
  later_pass {gen, bundle_sha256},
  auditor {kind: "engine-session", session_id, model?}
"""
from __future__ import annotations

import json
import hashlib
import os
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / ".omo" / "evidence" / "item-defects.jsonl"
GENESIS = "0" * 64


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _canon(entry: dict) -> str:
    body = {k: v for k, v in entry.items() if k != "sha256"}
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def entry_hash(entry: dict) -> str:
    return hashlib.sha256(_canon(entry).encode()).hexdigest()


def tail_hash(ledger: Path = LEDGER) -> str:
    if not ledger.is_file():
        return GENESIS
    last = ""
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if line.strip():
            last = line
    return json.loads(last).get("sha256", GENESIS) if last else GENESIS


def load(ledger: Path = LEDGER) -> list[dict]:
    if not ledger.is_file():
        return []
    return [json.loads(x) for x in ledger.read_text(encoding="utf-8").splitlines() if x.strip()]


def chain_ok(ledger: Path = LEDGER) -> tuple[bool, list[str]]:
    msgs, prev = [], GENESIS
    for i, e in enumerate(load(ledger), 1):
        if e.get("prev") != prev:
            msgs.append(f"line {i}: prev mismatch (chain broken)")
        if e.get("sha256") != entry_hash(e):
            msgs.append(f"line {i}: sha256 does not match body")
        prev = e.get("sha256", prev)
    return (not msgs), msgs


def engine_db() -> Path:
    env = os.environ.get("ABATHUR_ENGINE_DB")
    if env:
        return Path(env)
    return Path.home() / ".local" / "share" / "opencode" / "opencode.db"


def session_facts(session_id: str) -> dict:
    db = engine_db()
    out = {"session": session_id, "db": str(db), "found": False}
    if not session_id or not db.is_file():
        out["reason"] = "no engine database"
        return out
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            row = conn.execute(
                "select title, time_created, agent, model from session where id=?",
                (session_id,)).fetchone()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001 - absence is a value
        out["reason"] = f"db error: {exc}"
        return out
    if not row:
        out["reason"] = "session not in engine database"
        return out
    out.update(found=True, title=row[0], created_ms=row[1], agent=row[2], model=row[3])
    return out


def judged_sessions(gen: str) -> set[str]:
    """Sessions that produced the papers under judgement (candidate + judge)."""
    out: set[str] = set()
    base = ROOT / ".omo" / "evidence" / "loop-archive" / gen
    for st in base.glob("*/harness/candidate_state.json") if base.is_dir() else []:
        try:
            sid = json.loads(st.read_text()).get("session_id")
            if sid:
                out.add(sid)
        except Exception:  # noqa: BLE001
            pass
    for f in base.glob("*/judge-work/session.txt") if base.is_dir() else []:
        try:
            for line in f.read_text().splitlines():
                if line.startswith("judge_session="):
                    out.add(line.split("=", 1)[1].strip())
        except Exception:  # noqa: BLE001
            pass
    return out


def validate_entry(entry: dict, *, ledger: Path = LEDGER) -> tuple[bool, list[str]]:
    msgs: list[str] = []
    for k in ("gen", "item", "class", "bundle_sha256", "decided_at", "claim", "auditor",
              "later_pass"):
        if not entry.get(k):
            msgs.append(f"missing field: {k}")
    for k in ("criteria_evidence", "item_evidence"):
        if not isinstance(entry.get(k), list):
            msgs.append(f"missing field: {k}")
    if msgs:
        return False, msgs

    bundle = ROOT / ".omo" / "evidence" / "loop-archive" / entry["gen"] / "bundle.json"
    if not bundle.is_file():
        msgs.append(f"bundle not found: {bundle}")
    elif sha256_file(bundle) != entry["bundle_sha256"]:
        msgs.append("bundle_sha256 does not match the sealed bundle (stale or forged entry)")

    later = entry["later_pass"]
    lb = ROOT / ".omo" / "evidence" / "loop-archive" / later.get("gen", "") / "bundle.json"
    if not lb.is_file():
        msgs.append(f"later_pass bundle not found: {lb}")
    else:
        if sha256_file(lb) != later.get("bundle_sha256"):
            msgs.append("later_pass bundle_sha256 mismatch")
        try:
            data = json.loads(lb.read_text())
            hit = [i for i in data.get("items", []) if i.get("item") == entry["item"]]
            if not hit:
                msgs.append(f"later_pass bundle has no item {entry['item']}")
            elif str(hit[0].get("aggregate", hit[0].get("verdict", ""))).upper() != "PASS":
                msgs.append("later_pass item verdict is not PASS")
        except Exception as exc:  # noqa: BLE001
            msgs.append(f"later_pass bundle unreadable: {exc}")

    for key in ("criteria_evidence", "item_evidence"):
        for ptr in entry.get(key) or []:
            p = Path(ptr.get("path", ""))
            p = p if p.is_absolute() else ROOT / p
            if not p.is_file():
                msgs.append(f"{key}: missing file {p}")
            elif sha256_file(p) != ptr.get("sha256"):
                msgs.append(f"{key}: sha256 mismatch for {p}")

    aud = entry["auditor"]
    if aud.get("kind") != "engine-session":
        msgs.append("auditor.kind must be 'engine-session' (seat/self-claims are refused)")
    else:
        facts = session_facts(aud.get("session_id", ""))
        if not facts.get("found"):
            msgs.append(f"auditor session not verified by engine DB: {facts.get('reason')}")
        else:
            banned = judged_sessions(entry["gen"])
            if aud["session_id"] in banned:
                msgs.append("auditor session is part of the judged generation's own chain")
            if facts.get("created_ms", 0) / 1000.0 > time.time() + 60:
                msgs.append("auditor session creation time is in the future")
    return (not msgs), msgs


def append(entry: dict, *, ledger: Path = LEDGER) -> dict:
    ok, msgs = validate_entry(entry, ledger=ledger)
    if not ok:
        raise SystemExit("REFUSED: " + "; ".join(msgs))
    rec = dict(entry)
    rec["prev"] = tail_hash(ledger)
    rec["sha256"] = entry_hash(rec)
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with open(ledger, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    return rec


def defects_for(gen: str, ledger: Path = LEDGER) -> list[dict]:
    return [e for e in load(ledger) if e.get("gen") == gen]


def check(ledger: Path = LEDGER) -> tuple[bool, list[str]]:
    ok, msgs = chain_ok(ledger)
    for e in load(ledger):
        vok, vmsgs = validate_entry(e, ledger=ledger)
        if not vok:
            msgs.extend(f"{e.get('gen')}/{e.get('item')}: {m}" for m in vmsgs)
    return (not msgs), msgs


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "check"
    if cmd == "add":
        entry = json.loads(sys.stdin.read())
        rec = append(entry)
        print(f"APPENDED {rec['gen']}/{rec['item']} sha256={rec['sha256']} prev={rec['prev']}")
        return 0
    if cmd == "check":
        ok, msgs = check()
        for m in msgs:
            print("PROBLEM " + m)
        print(("ITEM-DEFECTS OK entries=%d" % len(load(LEDGER))) if ok else "ITEM-DEFECTS PROBLEMS %d" % len(msgs))
        return 0 if ok else 1
    if cmd == "list":
        gen = argv[1] if len(argv) > 1 else None
        for e in load(LEDGER):
            if gen and e.get("gen") != gen:
                continue
            print(f"{e['gen']}/{e['item']} class={e['class']} at={e['decided_at']} sha={e['sha256'][:12]}")
        return 0
    print(__doc__.splitlines()[0], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
