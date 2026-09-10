#!/usr/bin/env bash
# Run hook (task 14): spawn the scenario agent headless, record the transcript
# at $ABATHUR_TRANSCRIPT (adapter contract, plan line 120), and print the last
# stdout line {tokensEst, turns} for parseRunMeta. opencode is invoked exactly
# as historian's README prescribes: `opencode run --command historian --message
# "<scenario Brief>"` — the Brief section of the scenario file is the prompt.
# --auto auto-approves the plugin tools (the wiki sandbox is the blast radius;
# kernel seals + _sandbox-only writes bound it, plan todo 14).
set -euo pipefail
unit_id="${1:?usage: run-scenario.sh <unitId> <scenario-file>}"
scenario_file="${2:?usage: run-scenario.sh <unitId> <scenario-file>}"
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
mkdir -p "$(dirname "$ABATHUR_TRANSCRIPT")"
status=0
"$bin" run --command historian --auto --format json --message "$brief" >"$ABATHUR_TRANSCRIPT" 2>/dev/null || status=$?
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
