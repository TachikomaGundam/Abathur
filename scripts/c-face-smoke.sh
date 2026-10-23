#!/usr/bin/env bash
# c-face-smoke.sh — C-face isolation smoke (四隔离 C 面): pack -> install into a
# throwaway prefix with a CLEAN environment -> probe -> discard. Proves the
# package works from a real install, not from the worktree. Read-only against
# the repo; writes only under a mktemp dir that it removes on exit.
# Usage: bash scripts/c-face-smoke.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP=$(mktemp -d /tmp/abathur-cface-XXXXXX)
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
echo "[c-face] npm pack (dry build already required: run npm test first)"
TARBALL=$(npm pack --pack-destination "$TMP" 2>/dev/null | tail -1)
[ -f "$TMP/$TARBALL" ] || { echo "[c-face] FAIL: pack produced no tarball"; exit 1; }
SHA=$(sha256sum "$TMP/$TARBALL" | cut -d' ' -f1)
echo "[c-face] tarball: $TARBALL sha256=$SHA"

echo "[c-face] installing into $TMP/prefix with clean env"
env -i HOME="$TMP/home" PATH="/usr/local/bin:/usr/bin:/bin" \
  npm install -g --prefix "$TMP/prefix" "$TMP/$TARBALL" >/dev/null 2>&1 \
  || { echo "[c-face] FAIL: clean-env install failed"; exit 1; }

BIN="$TMP/prefix/bin/abathur"
[ -x "$BIN" ] || BIN="$TMP/prefix/bin/abathur.cmd"
echo "[c-face] probing installed binary"
VER=$(env -i PATH="/usr/local/bin:/usr/bin:/bin" "$BIN" --version 2>/dev/null || echo "UNSUPPORTED")
echo "[c-face] --version: $VER"
env -i PATH="/usr/local/bin:/usr/bin:/bin" "$BIN" --help >/dev/null 2>&1 \
  || { echo "[c-face] FAIL: --help non-zero in clean env"; exit 1; }
[ -f "$TMP/prefix/lib/node_modules/@tachikomagundam/abathur/dist/engine-registry.json" ] \
  && echo "[c-face] engine-registry.json: present in install" \
  || echo "[c-face] note: engine-registry.json absent (expected for <0.4.0)"
echo "[c-face] PASS (tarball sha256=$SHA)"
