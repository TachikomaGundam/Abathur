#!/usr/bin/env python3
"""run_candidate.py <gen> <item-id> — fresh isolated candidate session.

Turns injected verbatim one per message via --session continuation (SR4 §0.2).
Full transcript extracted post-run from the isolated opencode DB (FM-04: stdout-only
capture is banned; stdout logs kept as auxiliary evidence only).
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import looplib as L
from bank import ITEMS


def main():
    if len(sys.argv) != 3:
        print("usage: run_candidate.py <gen> <item-id>", file=sys.stderr)
        sys.exit(2)
    gen, item_id = sys.argv[1], sys.argv[2]
    item = ITEMS[item_id]
    rd = L.run_dir(gen, item_id)
    if not (L.harness_dir(gen, item_id) / "manifest.json").exists():
        print(f"REFUSAL: not seeded: {rd} (run seed_item.py first)", file=sys.stderr)
        sys.exit(1)
    if (L.harness_dir(gen, item_id) / "transcript.json").exists():
        print(f"REFUSAL: transcript already exists for {gen}/{item_id} (no re-run cherry-pick; log a bundle note per FM-05)", file=sys.stderr)
        sys.exit(1)

    env = L.build_env(gen, item_id, candidate=True)
    ws = L.workshop_dir(gen, item_id)
    title = f"loop-{gen}-{item_id}-cand"
    log = L.harness_dir(gen, item_id) / "cand.out"
    ok, detail = L.sandbox_exec_ok(gen, item_id)
    if not ok:
        print(f"NEEDS_HUMAN: sandbox cannot exec the CLI ({detail}); nothing was graded", file=sys.stderr)
        (L.harness_dir(gen, item_id) / "candidate_state.json").write_text(json.dumps(
            {"state": "INFRA_FAILED", "reason": "sandbox-exec", "detail": detail}, indent=2))
        sys.exit(3)
    missing = L.sandbox_requirements_ok(gen, item_id, item.get("sandbox_requires") or [])
    if missing:
        detail = "; ".join(f"{' '.join(m['argv'])} -> {m['detail']}" for m in missing)
        print(f"NEEDS_HUMAN: item requires tools the sandbox lacks ({detail}); nothing was graded",
              file=sys.stderr)
        (L.harness_dir(gen, item_id) / "candidate_state.json").write_text(json.dumps(
            {"state": "INFRA_FAILED", "reason": "sandbox-requires", "detail": missing}, indent=2))
        sys.exit(3)
    session_id = None
    start_turn = 0
    state_p = L.harness_dir(gen, item_id) / "candidate_state.json"
    if state_p.exists():
        # Safe to resume: a timeout kills the turn's process, not the work already in the session.
        try:
            prev = json.loads(state_p.read_text(encoding="utf-8"))
        except ValueError:
            prev = {}
        if prev.get("state") == "INFRA_FAILED" and prev.get("session_id") and prev.get("turn"):
            start_turn = int(prev["turn"]) - 1
            session_id = prev["session_id"]
            print(f"RESUMING turn {start_turn + 1} in session {session_id}")
    timeout = L.item_timeout(item_id)
    t0 = time.time()
    jail_ok, jail_detail = L.jail_tmp_private(gen, item_id)
    jail_rec = {"private": jail_ok, "detail": jail_detail,
                "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    print(f"jail /tmp private={jail_ok} ({jail_detail})")
    for i, turn in enumerate(item["turns"], 1):
        if i <= start_turn:
            continue
        rc, session_id = L.run_opencode_turn(env, ws, title, turn, log, session_id,
                                             L.DEFAULT_MODEL, timeout)
        print(f"turn {i}/{len(item['turns'])} rc={rc} session={session_id}")
        L.snapshot_db(gen, item_id, i)
        if rc != 0:
            print(f"NEEDS_HUMAN: turn {i} rc={rc} (infra failure per SR4 §0.5; do NOT grade as FAIL)", file=sys.stderr)
            state_p.write_text(json.dumps(
                {"state": "INFRA_FAILED", "turn": i, "rc": rc, "session_id": session_id}, indent=2))
            sys.exit(3)
    tx = L.extract_transcript(gen, item_id, candidate=True)
    probe = L.probe_disk(gen, item_id)
    hgf = L.hard_global_fail_scan(tx, tuple(item.get("scratch_allow", ())), jail_tmp=jail_ok)
    brs = L.boundary_read_scan(tx)
    (L.harness_dir(gen, item_id) / "candidate_state.json").write_text(json.dumps({
        "state": "COMPLETE", "session_id": session_id,
        "scanner": "hgf-v3-segmented+jail-tmp",
        "elapsed_s": round(time.time() - t0, 1),
        "turns": len(item["turns"]),
        "jail_tmp": jail_rec,
        "hard_global_fail_prescan": hgf,
        "boundary_read_anomalies": brs,
        "messages": len(tx.get("message", [])), "parts": len(tx.get("part", [])),
    }, indent=2, ensure_ascii=False))
    print(f"candidate complete: {len(tx.get('message', []))} messages, {len(tx.get('part', []))} parts, "
          f"{len(hgf)} hard-global-fail prescan hits")
    print(f"  transcript: {L.harness_dir(gen, item_id) / 'transcript.json'}")


if __name__ == "__main__":
    # spawn-completion-receipt R2: start/exit pair for every exit path (incl.
    # REFUSAL / INFRA_FAILED / crash). Registry failure never kills the runner.
    import os

    import run_registry as REG

    _gen = sys.argv[1] if len(sys.argv) == 3 else None
    _item = sys.argv[2] if len(sys.argv) == 3 else None
    if _gen:
        REG.append_event(_gen, _item, "candidate", "start", pid=os.getpid(), pgid=os.getpgrp())
    _rc = 0
    try:
        main()
    except SystemExit as exc:
        _rc = exc.code if isinstance(exc.code, int) else 1
        raise
    except BaseException:
        _rc = 1
        raise
    finally:
        if _gen:
            _state = L.harness_dir(_gen, _item) / "candidate_state.json"
            REG.append_event(_gen, _item, "candidate", "exit", rc=_rc,
                             state_path=_state if _state.exists() else None)
