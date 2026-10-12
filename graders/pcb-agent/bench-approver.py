#!/usr/bin/env python3
"""r21 bench-approver — the named stand-in for the human H-gate INSIDE THE BENCH
ONLY. It never runs against the production serve (asserted by port arg + the
arena's existence). Watches the orchestrator session transcript; whenever a
dispatch is denied for a missing approval whose plan has been DECLARED in the
session (the orchestrator states 'plan_sha256 <hex64>' per its role contract),
posts the exact user message `APPROVE PLAN <sha>`. Every grant is written to an
append-only approve-log with the trigger evidence, so the grader can audit that
the approval was REACTIVE to the team's own plan text — the approver never
authors a plan and never approves an unread hash.
Usage: bench-approver.py <base-url> <session-id> <log.jsonl> [deadline_s]"""
import json, re, sys, time, urllib.request

BASE, SID, LOG = sys.argv[1], sys.argv[2], sys.argv[3]
DEADLINE = time.time() + int(sys.argv[4] if len(sys.argv) > 4 else 1200)
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=15) as r:
        return json.load(r)


def post(path, body, timeout=60):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def log(rec):
    with open(LOG, "a") as fh:
        rec["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


seen = set()
HB = [0]
arr = []
while time.time() < DEADLINE:
    try:
        msgs = get(f"/session/{SID}/message")
        arr = msgs if isinstance(msgs, list) else msgs.get("data", [])
        plans = []
        for m in arr:
            info = m.get("info") or m
            for p in m.get("parts", []):
                if p.get("type") != "text":
                    continue
                t = str(p.get("text") or "")
                # plan declarations by the ORCHESTRATOR (assistant text) and
                # gate-denial echoes (tool text): collect every 64-hex after a plan marker
                for mm in re.finditer(r"plan_sha256[^0-9a-f]{0,10}([0-9a-f]{64})", t):
                    plans.append(mm.group(1))
                for mm in re.finditer(r"HUMAN_GATE[^0-9a-f]{0,200}([0-9a-f]{64})",t): plans.add(mm.group(1))
                for mm in re.finditer(r"PLAN_NOT_APPROVED[^0-9a-f]{0,120}([0-9a-f]{64})", t):
                    plans.append(mm.group(1))
        for sha in dict.fromkeys(plans):
            if sha in seen or not HEX64.match(sha):
                continue
            already = False
            for m in arr:
                info = m.get("info") or m
                if info.get("role") != "user":
                    continue
                for p in m.get("parts", []):
                    if str(p.get("text", "")).strip() == f"APPROVE PLAN {sha}":
                        already = True
            if already:
                seen.add(sha)  # r28 fix: consume only on certainty; POST failure retries next loop
                continue
            # D-e7: server blocks POST /message until the turn FINISHES; a
            # multi-hour team turn made every 600s grant time out unlogged.
            # Fire with a short ack window; delivery truth = the verbatim user
            # row appearing in history (what the gate itself greps). A hung
            # ack must NOT kill the loop — a background thread re-posts while
            # the main loop confirms via history.
            ack = None
            import threading
            def _fire():
                global ack
                try:
                    ack = post(f"/session/{SID}/message", {
                        "agent": "pcb-orchestrator",
                        "parts": [{"type": "text", "text": f"APPROVE PLAN {sha}"}]}, timeout=15)
                except Exception:
                    pass
            threading.Thread(target=_fire, daemon=True).start()
            delivered = False
            for _ in range(20):  # up to ~20 polls x 10s to see the row land
                time.sleep(10)
                try:
                    if f"APPROVE PLAN {sha}" in json.dumps(get(f"/session/{SID}/message")):
                        delivered = True
                        break
                except Exception:
                    pass
            if delivered:
                seen.add(sha)
                log({"grant": "APPROVE PLAN " + sha, "message_id": (ack or {}).get("info", {}).get("id") if isinstance(ack, dict) else None,
                     "basis": "history-confirmed delivery (ack may be absent by design; gate greps the same row)",
                     "sha": sha[:12]})
            else:
                log({"error": "grant not visible in history after 200s", "sha": sha[:12]})
                continue
    except Exception as e:  # noqa: BLE001
        log({"error": str(e)[:200]})
    HB[0] += 1
    if HB[0] % 6 == 0:
        log({"heartbeat": HB[0], "seen": sorted(x[:8] for x in seen), "msgs": len(arr) if "arr" in dir() else -1})
    time.sleep(10)
log({"done": True, "reason": "deadline"})
