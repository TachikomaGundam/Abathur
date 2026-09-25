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
    session_id = None
    t0 = time.time()
    for i, turn in enumerate(item["turns"], 1):
        rc, session_id = L.run_opencode_turn(env, ws, title, turn, log, session_id, L.DEFAULT_MODEL)
        print(f"turn {i}/{len(item['turns'])} rc={rc} session={session_id}")
        if rc != 0:
            print(f"NEEDS_HUMAN: turn {i} rc={rc} (infra failure per SR4 §0.5; do NOT grade as FAIL)", file=sys.stderr)
            (L.harness_dir(gen, item_id) / "candidate_state.json").write_text(json.dumps(
                {"state": "INFRA_FAILED", "turn": i, "rc": rc}, indent=2))
            sys.exit(3)
    tx = L.extract_transcript(gen, item_id, candidate=True)
    probe = L.probe_disk(gen, item_id)
    hgf = L.hard_global_fail_scan(tx)
    brs = L.boundary_read_scan(tx)
    (L.harness_dir(gen, item_id) / "candidate_state.json").write_text(json.dumps({
        "state": "COMPLETE", "session_id": session_id,
        "scanner": "hgf-v2-structural",
        "elapsed_s": round(time.time() - t0, 1),
        "turns": len(item["turns"]),
        "hard_global_fail_prescan": hgf,
        "boundary_read_anomalies": brs,
        "messages": len(tx.get("message", [])), "parts": len(tx.get("part", [])),
    }, indent=2, ensure_ascii=False))
    print(f"candidate complete: {len(tx.get('message', []))} messages, {len(tx.get('part', []))} parts, "
          f"{len(hgf)} hard-global-fail prescan hits")
    print(f"  transcript: {L.harness_dir(gen, item_id) / 'transcript.json'}")


if __name__ == "__main__":
    main()
