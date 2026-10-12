#!/usr/bin/env bash
# scenario-17 run hook = run-scenario.sh (agent stage, c7 ≤8min band) + the 蜂判
# poststage (judge-poststage.mjs) against the ACTUAL pages the agent produced.
# Mirrors the .bench/transcripts flow: the shipped grader never calls a model;
# the LLM measurement is instrument output staged at run time into
# .bench/judge-verdicts.json, which grader.mjs reads as observable state
# (fail-closed when absent). The LAST stdout line stays run-scenario.sh's
# {unit,tokensEst,turns,opencodeExit} meta JSON — parseRunMeta's contract — so
# the engine-facing format is byte-compatible with units 01–16.
set -euo pipefail
unit_id="${1:?usage: run-scenario-17.sh <unitId> <scenario-file> [repoRoot]}"
scenario_file="${2:?usage: run-scenario-17.sh <unitId> <scenario-file> [repoRoot]}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dossier="${S17_DOSSIER:-_sandbox/eval17/gpu-warm-pool-dossier}"
wiki_base="${ABATHUR_WIKI_BASE:-http://localhost:3000}"
meta=""
agent_s=0
judge_s=0
if [ "${S17_SKIP_AGENT:-0}" != "1" ]; then
  t=$SECONDS
  meta="$(bash "$here/run-scenario.sh" "$@")"
  agent_s=$((SECONDS - t))
fi
t=$SECONDS
node "$here/judge-poststage.mjs" --page "$dossier" --wiki-base "$wiki_base" \
  --out "${ABATHUR_JUDGE_VERDICTS:-.bench/judge-verdicts.json}" \
  --ledger "${ABATHUR_JUDGE_LEDGER:-.bench/judge-ledger-${unit_id}.jsonl}" 1>&2 || echo "[run-scenario-17] judge stage FAILED (no verdicts file — grader fail-closes the 蜂判 legs)" >&2
judge_s=$((SECONDS - t))
echo "[run-scenario-17] stage walls: agent=${agent_s}s judge=${judge_s}s (unit=${unit_id})" >&2
if [ -n "$meta" ]; then
  printf '%s\n' "$meta"
else
  printf '%s\n' "{\"unit\": \"$unit_id\", \"tokensEst\": 0, \"turns\": 0, \"opencodeExit\": -1}"
fi
