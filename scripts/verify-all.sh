#!/bin/sh
# verify-all.sh <GEN> — one entry point for the checks that must pass before a generation
# is talked about as done. Each step prints its own receipt; the last line is the verdict.
# Exit: 0 all green, 1 at least one step failed, 2 bad usage.
set -u

if [ $# -ne 1 ]; then
  echo "usage: verify-all.sh <GEN>" >&2
  exit 2
fi
GEN="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

fails=0
run_step() {
  name="$1"
  shift
  out="$("$@" 2>&1)"
  rc=$?
  last="$(printf '%s\n' "$out" | tail -n 1)"
  if [ "$rc" -eq 0 ]; then
    printf 'PASS  %-12s %s\n' "$name" "$last"
  else
    fails=$((fails + 1))
    printf 'FAIL  %-12s rc=%s %s\n' "$name" "$rc" "$last"
  fi
}

run_step machine-names python3 scripts/scan-machine-names.py
run_step assertions    python3 loop/assertions.py check "$GEN"
run_step coverage      python3 loop/coverage.py "$GEN"
run_step contract      python3 loop/test_bank_contract.py

if [ "$fails" -eq 0 ]; then
  echo "VERDICT=$GEN GREEN steps=4 fails=0"
  exit 0
fi
echo "VERDICT=$GEN BLOCKED steps=4 fails=$fails"
exit 1
