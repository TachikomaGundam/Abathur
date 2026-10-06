#!/usr/bin/env bash
# engine-lane shim: map unit.id -> right grader+phase (v3 only knows s31/s32)
# usage: grader-engine.sh <unit.id> <scenario-path> [repoRoot-ignored]
set -u
here="$(cd "$(dirname "$0")" && pwd)"
unit="$1"; scen="$2"
case "$unit" in
  s31*) exec node "$here/grader-v3.mjs" "$unit" "$scen" s31 ;;
  s32*) exec node "$here/grader-v3.mjs" "$unit" "$scen" s32 ;;
esac
if [[ "$unit" == *phaseA* ]]; then
  exec node "$here/grader-v2.mjs" "$unit" "$scen" phaseA
else
  exec node "$here/grader-v2.mjs" "$unit" "$scen" phaseB
fi
