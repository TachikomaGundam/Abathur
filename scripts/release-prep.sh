#!/bin/sh
# release-prep.sh — run the gate BEFORE any release decision, never after.
#
# Owner order 2026-11-01 (verbatim): "七、过闸才允许决定发布，而非决定发布了再过闸。"
#
# Order enforced here, mechanically:
#   1. machine-name scan (no box-specific literals in code)
#   2. publish pre-check -> dispatches the gate tool named in the machine registry
#   3. only if the gate answers PASS does this script print the release steps
# A gate that cannot answer (rc=2) is NOT a pass: it stops the release.
#
# Usage: sh scripts/release-prep.sh <version>
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
VER=${1:-}
if [ -z "$VER" ]; then
  echo "usage: sh scripts/release-prep.sh <version>"
  exit 2
fi
OUT="$REPO/docs/release/$VER-gate.txt"
mkdir -p "$REPO/docs/release"
: > "$OUT"

log() { printf '%s\n' "$*" | tee -a "$OUT"; }

log "RELEASE-PREP version=$VER at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log "--- step 1/2 machine-name scan"
python3 "$REPO/scripts/scan-machine-names.py" >>"$OUT" 2>&1
scan_rc=$?
log "scan_rc=$scan_rc"
if [ "$scan_rc" -ne 0 ]; then
  log "RELEASE-BLOCKED reason=machine-names-in-code"
  exit 1
fi

log "--- step 2/2 publish pre-check"
sh "$REPO/scripts/publish-precheck.sh" >>"$OUT" 2>&1
gate_rc=$?
log "gate_rc=$gate_rc"
if [ "$gate_rc" -ne 0 ]; then
  case "$gate_rc" in
    1) log "RELEASE-BLOCKED reason=gate-blocked"; exit 1 ;;
    *) log "RELEASE-BLOCKED reason=gate-cannot-answer rc=$gate_rc"; exit 2 ;;
  esac
fi

log "GATE-PASS version=$VER"
log "  next (human, in a terminal):"
log "    node $REPO/scripts/release-isolated.mjs $VER"
log "  the gate receipt for this run is: $OUT"
exit 0
