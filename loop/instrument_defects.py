#!/usr/bin/env python3
"""instrument_defects.py — append-only, hash-chained record of INSTRUMENT defects.

Why this exists: `item_defects.py` records rubric/fixture defects (the item's fault).
Tooling defects — scanners, seeder, judge validator, timeout knobs, runner — had no
machine channel, so `CONDITIONAL(D1a)` could only be backed by prose. This ledger is
that channel, kept SEPARATE so `item_defect_count` keeps its historical meaning.

Design (v2, approved 2026-11-02): severity is DERIVED, never self-declared.
  blocking  <=> affected_paths intersects JUDGEMENT_PATHS
             or affected_items intersects the items of any archived bundle
  hygiene   otherwise.  Unclear cases derive blocking (fail-closed).

Writer gate: `blocking` entries require an auditor session that the engine database
shows exists and that is not part of the generation's own candidate/judge chain.
`hygiene` entries may be recorded by the seat, but only as a claim with a probe pair,
fix commits and a pinned contract blob — never as an "audited" fact.

verify-all ONLY recomputes statically: chain, fields, enum, commit existence/ancestry,
contract blob sha256, probe_before != probe_after, derived == declared severity.
It NEVER executes a probe command from the ledger (that would be code-from-data).

Writer registration and the chain genesis live OUTSIDE this file
(loop/proposals/instrument-defect-channel-20261102-v2.md); in-file claims carry no
authority, per L-STATE-ATOMIC.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEDGER = ROOT / ".omo" / "evidence" / "instrument-defects.jsonl"
ARCHIVE = ROOT / ".omo" / "evidence" / "loop-archive"
GENESIS = "0" * 64
SCHEMA = 2

JUDGEMENT_PATHS = (
    "loop/run_judge.py",
    "loop/bundle_close.py",
    "loop/looplib.py",
    "loop/draw.py",
    "loop/harvest_gen.py",
    "loop/seed_item.py",
    "loop/coverage.py",
    "loop/assertions.py",
    "loop/instrument_defects.py",
    "scripts/verify-all.sh",
    ".opencode/plugins/abathur-exam-runner.js",
)

CLASSES = (
    "scanner-false-positive",
    "seed-signature-mismatch",
    "verdict-validator-gap",
    "timeout-default",
    "bundle-field-leak",
    "draw-guard-drift",
    "other",
)

REQUIRED = ("gen", "defect_id", "class", "affected_items", "affected_paths",
            "introduced_at", "fixed_at", "probe_before", "probe_after", "contract")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


def _canon(entry: dict) -> str:
    body = {k: v for k, v in entry.items() if k != "sha256"}
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def entry_hash(entry: dict) -> str:
    return sha256_bytes(_canon(entry).encode())


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


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True)


def commit_exists(rev: str) -> bool:
    return _git("rev-parse", "--verify", f"{rev}^{{commit}}").returncode == 0


def is_ancestor(old: str, new: str) -> bool:
    return _git("merge-base", "--is-ancestor", old, new).returncode == 0


def blob_sha256(rev: str, path: str) -> str | None:
    r = _git("cat-file", "-p", f"{rev}:{path}")
    return sha256_bytes(r.stdout) if r.returncode == 0 else None


def archived_bundle_items() -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for b in sorted(ARCHIVE.glob("*/bundle.json")) if ARCHIVE.is_dir() else []:
        try:
            data = json.loads(b.read_text())
            out[b.parent.name] = {i.get("item") for i in data.get("items", []) if i.get("item")}
        except Exception:  # noqa: BLE001 - unreadable bundle is not a claim
            continue
    return out


def derive_severity(entry: dict) -> str:
    paths = set(entry.get("affected_paths") or [])
    if paths & set(JUDGEMENT_PATHS):
        return "blocking"
    items = set(entry.get("affected_items") or [])
    if items:
        for _gen, bits in archived_bundle_items().items():
            if items & bits:
                return "blocking"
    return "hygiene"


def engine_db() -> Path:
    env = os.environ.get("ABATHUR_ENGINE_DB")
    return Path(env) if env else Path.home() / ".local" / "share" / "opencode" / "opencode.db"


def session_exists(session_id: str) -> bool:
    import sqlite3
    db = engine_db()
    if not session_id or not db.is_file():
        return False
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            return conn.execute("select 1 from session where id=?", (session_id,)).fetchone() is not None
        finally:
            conn.close()
    except Exception:  # noqa: BLE001 - absence is a value
        return False


def judged_sessions(gen: str) -> set[str]:
    out: set[str] = set()
    base = ARCHIVE / gen
    if not base.is_dir():
        return out
    for st in base.glob("*/harness/candidate_state.json"):
        try:
            sid = json.loads(st.read_text()).get("session_id")
            if sid:
                out.add(sid)
        except Exception:  # noqa: BLE001
            pass
    for f in base.glob("*/judge-work/session.txt"):
        try:
            for line in f.read_text().splitlines():
                if line.startswith("judge_session="):
                    out.add(line.split("=", 1)[1].strip())
        except Exception:  # noqa: BLE001
            pass
    return out


def validate_entry(entry: dict) -> tuple[bool, list[str]]:
    msgs: list[str] = []
    if entry.get("schema") not in (None, SCHEMA):
        msgs.append(f"schema must be {SCHEMA}")
    for k in REQUIRED:
        if k in ("affected_items", "affected_paths"):
            if not isinstance(entry.get(k), list):
                msgs.append(f"missing field: {k} (list required)")
            continue
        if entry.get(k) in (None, "", {}, []):
            msgs.append(f"missing field: {k}")
    if entry.get("class") not in CLASSES:
        msgs.append(f"class not in closed enum: {entry.get('class')!r}")
    sev = derive_severity(entry)
    declared = entry.get("severity")
    if declared is not None and declared != sev:
        msgs.append(f"severity self-declared {declared!r} but derived {sev!r} (classification laundering)")
    if sev == "blocking":
        aud = entry.get("auditor") or {}
        if aud.get("kind") != "engine-session":
            msgs.append("blocking entry needs auditor.kind='engine-session'")
        elif not session_exists(aud.get("session_id", "")):
            msgs.append("auditor session not verified by engine DB")
        elif aud.get("session_id") in judged_sessions(entry.get("gen", "")):
            msgs.append("auditor session belongs to the generation's own chain")
        if not entry.get("audit_receipt"):
            msgs.append("blocking entry needs audit_receipt")
    iat, fat = entry.get("introduced_at"), entry.get("fixed_at")
    if iat and not commit_exists(iat):
        msgs.append(f"introduced_at commit not found: {iat}")
    if fat and not commit_exists(fat):
        msgs.append(f"fixed_at commit not found: {fat}")
    if iat and fat and commit_exists(iat) and commit_exists(fat) and not is_ancestor(iat, fat):
        msgs.append("introduced_at is not an ancestor of fixed_at")
    pb, pa = entry.get("probe_before") or {}, entry.get("probe_after") or {}
    for tag, pr in (("probe_before", pb), ("probe_after", pa)):
        if not pr.get("cmd") or pr.get("rc") is None or not pr.get("output_sha256"):
            msgs.append(f"{tag} needs cmd/rc/output_sha256")
    if pb.get("output_sha256") and pb.get("output_sha256") == pa.get("output_sha256"):
        msgs.append("probe_before == probe_after (vacuous evidence: nothing flipped)")
    con = entry.get("contract") or {}
    if con.get("path") and fat and commit_exists(fat):
        want = blob_sha256(fat, con["path"])
        if want is None:
            msgs.append(f"contract path absent at fixed_at: {con['path']}")
        elif con.get("blob_sha256") != want:
            msgs.append("contract.blob_sha256 does not match fixed_at blob")
    else:
        msgs.append("contract needs path + blob_sha256")
    return (not msgs), msgs


def append(entry: dict, ledger: Path = LEDGER) -> dict:
    rec = dict(entry)
    rec.setdefault("schema", SCHEMA)
    rec["severity"] = derive_severity(rec)
    ok, msgs = validate_entry(rec)
    if not ok:
        raise SystemExit("REFUSED: " + "; ".join(msgs))
    rec["prev"] = tail_hash(ledger)
    rec["sha256"] = entry_hash(rec)
    ledger.parent.mkdir(parents=True, exist_ok=True)
    with open(ledger, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    return rec


def open_blocking(gen: str, ledger: Path = LEDGER) -> list[dict]:
    return [e for e in load(ledger)
            if e.get("gen") == gen and e.get("severity") == "blocking" and not e.get("closed_at")]


def d1a_for(gen: str, ledger: Path = LEDGER) -> dict:
    entries = [e for e in load(ledger) if e.get("gen") == gen]
    return {
        "checked": True,
        "entries": len(entries),
        "blocking_open": len(open_blocking(gen, ledger)),
        "hygiene": sum(1 for e in entries if e.get("severity") == "hygiene"),
        "ids": [e.get("defect_id") for e in entries],
    }


def check(ledger: Path = LEDGER) -> tuple[bool, list[str]]:
    ok, msgs = chain_ok(ledger)
    seen: set[str] = set()
    for e in load(ledger):
        did = e.get("defect_id")
        if did in seen:
            msgs.append(f"duplicate defect_id: {did}")
        seen.add(did)
        vok, vmsgs = validate_entry(e)
        if not vok:
            msgs.extend(f"{e.get('gen')}/{did}: {m}" for m in vmsgs)
    return (not msgs), msgs


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "check"
    if cmd == "add":
        rec = append(json.loads(sys.stdin.read()))
        print(f"APPENDED {rec['gen']}/{rec['defect_id']} severity={rec['severity']} sha256={rec['sha256']}")
        return 0
    if cmd == "check":
        ok, msgs = check()
        for m in msgs:
            print("PROBLEM " + m)
        print(("INSTRUMENT-DEFECTS OK entries=%d" % len(load(LEDGER))) if ok
              else "INSTRUMENT-DEFECTS PROBLEMS %d" % len(msgs))
        return 0 if ok else 1
    if cmd == "d1a":
        print(json.dumps(d1a_for(argv[1] if len(argv) > 1 else ""), ensure_ascii=False))
        return 0
    if cmd == "derive":
        entry = json.loads(sys.stdin.read())
        print(derive_severity(entry))
        return 0
    if cmd == "list":
        for e in load(LEDGER):
            print(f"{e['gen']}/{e['defect_id']} class={e['class']} severity={e.get('severity')} "
                  f"fixed_at={e['fixed_at']} sha={e['sha256'][:12]}")
        return 0
    print(__doc__.splitlines()[0], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
