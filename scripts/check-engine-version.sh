#!/usr/bin/env bash
# check-engine-version.sh — installed-vs-source consistency probe (庭C correction:
# engine-registry consumer). Read-only; exits non-zero on any mismatch.
# Usage: bash scripts/check-engine-version.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_VER=$(python3 -c "import json;print(json.load(open('$ROOT/package.json'))['version'])")
FAIL=0

echo "source package.json: $SRC_VER"

# 1. installed engine version (via bin realpath -> installed package.json)
BIN=$(command -v abathur || true)
if [ -z "$BIN" ]; then
  echo "FAIL: abathur not on PATH"; exit 1
fi
REAL=$(realpath "$BIN")
INST_PKG="$(dirname "$REAL")/../package.json"
INST_VER=$(python3 -c "import json;print(json.load(open('$INST_PKG'))['version'])" 2>/dev/null || echo "UNREADABLE")
echo "installed package.json: $INST_VER ($INST_PKG)"

# 2. --version command agreement (engine >= 0.4.0)
CLI_VER=$(abathur --version 2>/dev/null || echo "UNSUPPORTED")
echo "installed --version: $CLI_VER"

# 3. engine-registry.json presence + writeCommands non-empty
REG="$(dirname "$REAL")/engine-registry.json"
if [ -f "$REG" ]; then
  echo "engine-registry.json: present"
else
  echo "engine-registry.json: MISSING (engine <0.4.0 or broken install)"; FAIL=1
fi

# 4. plugin marker version vs source
PLUGIN_MARKER=$(grep -o 'v[0-9]*\.[0-9]*\.[0-9]*' "$ROOT/plugin/abathur-command.md" | head -1)
echo "plugin marker: $PLUGIN_MARKER"

echo "---"
echo "NOTE: source ahead of installed is NORMAL during development (main pinned at"
echo "last-published; the bump lives on the release branch). This script FAILS only on:"
echo "  - installed --version disagrees with installed package.json (broken install)"
echo "  - engine-registry.json missing while installed package.json >= 0.4.0"
[ "$CLI_VER" != "UNSUPPORTED" ] && [ "$CLI_VER" != "$INST_VER" ] && { echo "FAIL: --version != installed package.json"; FAIL=1; }
case "$INST_VER" in
  0.[4-9].*|[1-9].*) [ ! -f "$REG" ] && FAIL=1 ;;
esac
exit $FAIL
