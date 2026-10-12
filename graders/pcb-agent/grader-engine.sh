#!/usr/bin/env bash
# engine-lane shim: map unit.id -> right grader+phase (v3 only knows s31/s32)
# usage: grader-engine.sh <unit.id> <scenario-path> [repoRoot-ignored]
set -u
here="$(cd "$(dirname "$0")" && pwd)"
unit="$1"; scen="$2"
[ -n "${PCB_FORCE_ARENA:-}" ] || export PCB_FORCE_ARENA="/tmp/r20-arena-$(basename "$3")-$unit"  # D-e12 mirror of runner default; $3 = {repoRoot} per arm
out=$(
  case "$unit" in
    s31*) node "$here/grader-v3.mjs" "$unit" "$scen" s31 ;;
    s32*) node "$here/grader-v3.mjs" "$unit" "$scen" s32 ;;
    *phaseA*) node "$here/grader-v2.mjs" "$unit" "$scen" phaseA ;;
    *) node "$here/grader-v2.mjs" "$unit" "$scen" phaseB ;;
  esac
)
# engine parseGraderLine contract: metrics.tokensEst + metrics.turns (numeric
# bookkeeping the fixture adapter demands; measurement semantics untouched).
printf '%s\n' "$out" | tail -1 | python3 -c '
import sys, json, os
line = sys.stdin.read().strip()
d = json.loads(line)
tdir = os.environ.get("PCB_OUT_DIR", f"/tmp/r20-out-{d.get("unit","")}")
tr = os.path.join(tdir, "transcript.json")
turns = -1
try:
    arr = json.load(open(tr))
    arr = arr if isinstance(arr, list) else arr.get("data", [])
    turns = len(arr)
except Exception:
    pass
tok = int(os.path.getsize(tr) / 4) if os.path.exists(tr) else 0
m = d.setdefault("metrics", {})
m.setdefault("tokensEst", tok); m.setdefault("turns", max(turns, 0))
print(json.dumps(d))'

