#!/usr/bin/env bash
# Run hook (task 14): spawn the scenario agent headless, record the transcript
# at $ABATHUR_TRANSCRIPT (adapter contract, plan line 120), and print the last
# stdout line {tokensEst, turns} for parseRunMeta. opencode is invoked exactly
# as historian's README prescribes: `opencode run --command historian --message
# "<scenario Brief>"` — the Brief section of the scenario file is the prompt.
# --auto auto-approves the plugin tools (the wiki sandbox is the blast radius;
# kernel seals + _sandbox-only writes bound it, plan todo 14).
#
# S4 engine seam — RUN CARDS: the bench's ACTIVE TREE may carry operator/
# mutator run cards under abathur-notes/*.md (the genome's entire mutation
# space). When present they are appended VERBATIM to the brief fenced under a
# `## Run card` heading, so candidate mutations actually reach the evaluated
# agent (the severed-channel fix, swarm-A finding #1). repoRoot comes from the
# OPTIONAL 3rd argv, else it is derived from the scenario path: runCommand
# renders `{repoRoot}/{unit.path}` with units under scenarios/, so
# repoRoot = dirname(dirname(scenario_file)). With no notes the brief — and
# therefore the transcript — stays byte-identical to the pre-seam script
# (F1 invariant: incumbent runs must never grow a run-card section).
set -euo pipefail
unit_id="${1:?usage: run-scenario.sh <unitId> <scenario-file> [repoRoot]}"
scenario_file="${2:?usage: run-scenario.sh <unitId> <scenario-file> [repoRoot]}"
# Per-unit hook dispatch (s19 autopsy 2026-09-25): a unit may own a hook script
# run-scenario-<NN>.sh that wraps THIS agent stage plus an instrumented poststage
# (e.g. the R6-termb 蜂判 for scenario-19). The registered runCommand is one
# genome-global string, so the dispatch lives here rather than in the spec: when
# this unit owns a hook and we are not already running inside it (recursion guard
# set on the way in), defer to the hook. Units without a hook — and every caller
# that passes an id with no matching file — fall through byte-identical (F1).
_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "$unit_id" in
  scenario-*)
    _hook="$_here/run-scenario-${unit_id#scenario-}.sh"
    if [ -f "$_hook" ] && [ -z "${ABATHUR_HOOK_INNER:-}" ]; then
      exec env ABATHUR_HOOK_INNER=1 bash "$_hook" "$@"
    fi
    ;;
esac
[ -f "$scenario_file" ] || { echo "run-scenario: missing scenario file $scenario_file" >&2; exit 2; }
[ -n "${ABATHUR_TRANSCRIPT:-}" ] || { echo "run-scenario: ABATHUR_TRANSCRIPT not set" >&2; exit 2; }
key="${ABATHUR_WIKI_KEY_FILE:-}"
if [ -n "$key" ] && [ -f "$key" ] && [ ! -f "$HOME/.wikijs-api-key" ]; then
  mkdir -p "$HOME"
  install -m 600 "$key" "$HOME/.wikijs-api-key"
fi
bin="${opencodeBin:-opencode}"
brief="$(awk '/^##[[:space:]]*Brief/{f=1;next} f && /^## /{exit} f' "$scenario_file")"
[ -n "$brief" ] || { echo "run-scenario: empty Brief section in $scenario_file" >&2; exit 2; }
repo_root="${3:-$(dirname "$(dirname "$scenario_file")")}"
notes_dir="$repo_root/abathur-notes"
if [ -d "$notes_dir" ]; then
  notes=()
  while IFS= read -r -d '' note; do notes+=("$note"); done \
    < <(find "$notes_dir" -maxdepth 1 -type f -name '*.md' -print0 | LC_ALL=C sort -z)
  if [ "${#notes[@]}" -gt 0 ]; then
    card=""
    card_sep=""
    for note in "${notes[@]}"; do
      card+="${card_sep}$(cat "$note")"
      card_sep=$'\n\n'
    done
    brief="$brief"$'\n\n## Run card\n\n'"$card"
  fi
fi
mkdir -p "$(dirname "$ABATHUR_TRANSCRIPT")"
status=0
# Model pinning: the transcript carries no model identity and benchProvenance
# only copies spec.bench.agentModel (declaration-vs-declaration), so the run
# MUST execute the claimed model or A/B honesty dies to provider-default drift.
# The engine already exports ABATHUR_AGENT_MODEL in the unit sandbox env
# (fixture.ts sandboxEnv); unset/empty keeps the argv byte-identical (F1).
model_args=()
if [ -n "${ABATHUR_AGENT_MODEL:-}" ]; then
  model_args=(--model "$ABATHUR_AGENT_MODEL")
fi
"$bin" run --command historian --auto --format json "${model_args[@]}" --message "$brief" >"${ABATHUR_TRANSCRIPT}.raw" 2>/dev/null || status=$?
# Campaign-1 channel fix (task-07-launch-blockers.md): plugin startup banners print to
# the agent's stdout and contaminate the captured JSONL. ONLY the known
# `[persistence-watchdog]` line is stripped into the grader-facing transcript —
# unknown non-JSON lines SURVIVE so the grader's corruption fail-closed stays
# honest — and a clean stream passes through byte-identical (F1 invariant).
# The verbatim capture remains at ${ABATHUR_TRANSCRIPT}.raw for audit.
LC_ALL=C grep -v '^\[persistence-watchdog\]' "${ABATHUR_TRANSCRIPT}.raw" >"$ABATHUR_TRANSCRIPT" || true
python3 - "$ABATHUR_TRANSCRIPT" "$unit_id" "$status" <<'PY'
import json, sys
path, unit, status = sys.argv[1], sys.argv[2], int(sys.argv[3])
tokens = turns = 0
try:
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            part = ev.get("part") or {}
            if ev.get("type") == "step_finish" or part.get("type") == "step-finish":
                turns += 1
                total = (part.get("tokens") or {}).get("total")
                if isinstance(total, (int, float)):
                    tokens += int(total)
except FileNotFoundError:
    pass
print(json.dumps({"unit": unit, "tokensEst": tokens, "turns": turns, "opencodeExit": status}))
PY
exit 0
