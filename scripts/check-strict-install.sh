#!/usr/bin/env bash
# check-strict-install.sh — strict-mode install gate (incident 2026-10-23, Q4 gate 2).
# Two halves:
#   BELL: a fixture package declaring engines node>=99 MUST fail under
#         --engine-strict — proves the gate can actually fire (no silent no-op).
#   REAL: this repo's packed tarball MUST install under --engine-strict on the
#         current node — proves the published engines declaration is honest.
# Requires network (npm registry) for dependency resolution. Writes only to a
# mktemp dir removed on exit.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d /tmp/abathur-strict-XXXXXX)
trap 'rm -rf "$TMP"' EXIT
FAIL=0

echo "[strict-gate] bell: fixture engines >=99 must be REFUSED under --engine-strict"
mkdir -p "$TMP/bell"
cat > "$TMP/bell/package.json" <<'EOF'
{"name":"abathur-strict-bell-fixture","version":"0.0.0","engines":{"node":">=99.0.0"},"main":"index.js"}
EOF
echo "module.exports = {};" > "$TMP/bell/index.js"
(cd "$TMP" && npm install "$TMP/bell" --engine-strict --no-save --prefix "$TMP/bell-target" >/dev/null 2>&1)
BELL_RC=$?
if [ "$BELL_RC" -eq 0 ]; then
  echo "[strict-gate] FAIL: bell did not ring — --engine-strict accepted an impossible engines declaration; the gate is a no-op on this npm"
  FAIL=1
else
  echo "[strict-gate] bell rang (rc=$BELL_RC)"
fi

echo "[strict-gate] real: this repo's tarball must install under --engine-strict"
cd "$ROOT"
TARBALL=$(npm pack --pack-destination "$TMP" 2>/dev/null | tail -1)
[ -f "$TMP/$TARBALL" ] || { echo "[strict-gate] FAIL: pack produced no tarball"; exit 2; }
(cd "$TMP" && npm install "$TMP/$TARBALL" --engine-strict --no-save --prefix "$TMP/real-target" >/dev/null 2>&1)
REAL_RC=$?
if [ "$REAL_RC" -ne 0 ]; then
  echo "[strict-gate] FAIL: tarball refused under --engine-strict on node $(node --version) — engines declaration is not honest"
  FAIL=1
else
  echo "[strict-gate] tarball installs under --engine-strict on node $(node --version)"
fi

if [ "$FAIL" -eq 0 ]; then echo "[strict-gate] PASS"; else echo "[strict-gate] FAIL"; fi
exit $FAIL
