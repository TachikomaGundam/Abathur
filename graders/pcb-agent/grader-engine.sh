#!/usr/bin/env bash
# engine-lane shim: map unit.id -> grader-v3 phase arg
# usage: grader-engine.sh <unit.id> <scenario-path> <repoRoot>
set -u
unit="$1"; scen="$2"
case "$unit" in
  s31*) phase=s31 ;;
  s32*) phase=s32 ;;
  *phaseA*) phase=phaseA ;;
  *) phase=phaseB ;;
esac
exec node /home/lab/workspace/harness/Abathur/graders/pcb-agent/grader-v3.mjs "$unit" "$scen" "$phase"
