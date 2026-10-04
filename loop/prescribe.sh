#!/usr/bin/env bash
# prescribe.sh — no prescription leaves this seat without live-state proof.
# Root cure for the post-mutation-staleness family (three logged faults:
# premature lease release; receipt destroyed by my own reset then prescribed;
# re-adjudicate prescribed over a row I never confirmed existed).
#   prescribe.sh <pair...>
# Each pair: "probe-cmd|||literal command to prescribe"
# Every probe must exit 0 or the whole prescription is REFUSED (exit 1).
set -u
[ $# -ge 1 ] || { echo "prescribe: usage: prescribe.sh \"probe|||cmd\" ..."; exit 2; }
fail=0; out=()
for pair in "$@"; do
  probe="${pair%%|||*}"; cmd="${pair#*|||}"
  if err="$(bash -c "$probe" 2>&1 >/dev/null)"; then
    out+=("$cmd")
  else
    echo "prescribe: REFUSED — probe failed: $probe" >&2
    [ -n "$err" ] && echo "  └─ $err" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] || { echo "prescribe: prescription dead on arrival; fix state, re-probe" >&2; exit 1; }
printf '%s\n' "${out[@]}"
echo "prescribe: all probes green at $(date -u +%FT%TZ) — prescription is LIVE-VERIFIED, not memory-verified" >&2
