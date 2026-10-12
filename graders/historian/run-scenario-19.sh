#!/usr/bin/env bash
# scenario-19 run hook = run-scenario.sh (agent stage, 1200s ceiling) + the R6-termb
# 蜂判 poststage (judge-poststage-19.mjs, per-page certified shape) against the
# ACTUAL pages the agent produced. Same data flow as run-scenario-17.sh (which is
# left untouched): the shipped grader never calls a model; the LLM measurement is
# instrument output staged at run time into .bench/judge-verdicts.json, which
# grader.mjs reads as observable state (fail-closed when absent). The matrix wall
# budget is pinned via JUDGE_BENCH_DEADLINE (+S19_JUDGE_BUDGET_S, default 600s):
# a truncated matrix leaves coverage incomplete ⇒ I fail-closes, never silently.
# The LAST stdout line stays run-scenario.sh's {unit,tokensEst,turns,opencodeExit}
# meta JSON — parseRunMeta's contract — so the engine-facing format is byte-
# compatible with units 01–18.
set -euo pipefail
unit_id="${1:?usage: run-scenario-19.sh <unitId> <scenario-file> [repoRoot]}"
scenario_file="${2:?usage: run-scenario-19.sh <unitId> <scenario-file> [repoRoot]}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pages="${S19_PAGES:-_sandbox/eval19/warm-pool-dossier=en,_sandbox/eval19/warm-pool-summary=zh}"
wiki_base="${ABATHUR_WIKI_BASE:-http://localhost:3000}"
agent_timeout_s="${S19_AGENT_TIMEOUT_S:-1200}"
judge_budget_s="${S19_JUDGE_BUDGET_S:-600}"
meta=""
agent_s=0
judge_s=0
if [ "${S19_SKIP_AGENT:-0}" != "1" ]; then
  t=$SECONDS
  meta="$(timeout --foreground -k 30 "${agent_timeout_s}" bash "$here/run-scenario.sh" "$@" || true)"
  agent_s=$((SECONDS - t))
fi
page_args=()
IFS=',' read -ra specs <<< "$pages"
for s in "${specs[@]}"; do page_args+=(--page "$s"); done
t=$SECONDS
export JUDGE_BENCH_DEADLINE="$(( ( $(date +%s) + judge_budget_s ) * 1000 ))"
node "$here/judge-poststage-19.mjs" "${page_args[@]}" --wiki-base "$wiki_base" \
  --out "${ABATHUR_JUDGE_VERDICTS:-.bench/judge-verdicts.json}" \
  --ledger "${ABATHUR_JUDGE_LEDGER:-.bench/judge-ledger-${unit_id}.jsonl}" 1>&2 || echo "[run-scenario-19] judge stage FAILED (no verdicts file — grader fail-closes the 蜂判 legs)" >&2
judge_s=$((SECONDS - t))
echo "[run-scenario-19] stage walls: agent=${agent_s}s (ceiling ${agent_timeout_s}s) judge=${judge_s}s (budget ${judge_budget_s}s) (unit=${unit_id})" >&2
if [ -n "$meta" ]; then
  printf '%s\n' "$meta"
else
  printf '%s\n' "{\"unit\": \"$unit_id\", \"tokensEst\": 0, \"turns\": 0, \"opencodeExit\": -1}"
fi
