#!/usr/bin/env bash
# pack-gate.sh — D-face content interception (owner law 2026-10-23:
# "D区域要拦截所有不合适的代码"). Run before ANY publish; the release
# checklist wires it. Exit 1 + named entries on any violation.
#
#   1. top-level allowlist — nothing ships outside dist/config/docs/plugin/skills
#      plus the npm-standard root files;
#   2. banned entries — foreign-line material and workspace surfaces must never
#      reach the tarball (the 0.2.8/0.2.9 pcb-agent pollution lesson);
#   3. content scan — no machine-absolute paths inside shipped files
#      (plugin/ assets are already pinned by src/test/opencode.test.ts;
#      this catches the rest).
set -uo pipefail
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

npm pack --pack-destination "$TMP" --silent >/dev/null 2>&1 || { echo "pack-gate: npm pack itself failed"; exit 2; }
TARBALL=$(ls "$TMP"/*.tgz 2>/dev/null) || { echo "pack-gate: no tarball produced"; exit 2; }
LIST=$(tar -tzf "$TARBALL")
FAIL=0

ALLOWED_RE='^package/((dist|config|docs|plugin|skills)/.+|package\.json|README\.md|LICENSE|LICENCE|CHANGELOG\.md)$'
BAD_TOP=$(printf '%s\n' "$LIST" | grep -vE "$ALLOWED_RE" || true)
if [ -n "$BAD_TOP" ]; then
  echo "pack-gate: FAIL — entries outside the allowlist:"
  printf '%s\n' "$BAD_TOP"
  FAIL=1
fi

BANNED_RE='(^|/)(graders/pcb-agent|graders/historian|loop/|handoffs/|\.omo/|__pycache__/)|/home/lab/'
HITS=$(printf '%s\n' "$LIST" | grep -E "$BANNED_RE" || true)
if [ -n "$HITS" ]; then
  echo "pack-gate: FAIL — banned entries in tarball:"
  printf '%s\n' "$HITS"
  FAIL=1
fi

mkdir "$TMP/x" && tar -xzf "$TARBALL" -C "$TMP/x"
CONTENT_HITS=$(grep -rl '/home/lab/' "$TMP/x" 2>/dev/null || true)
if [ -n "$CONTENT_HITS" ]; then
  echo "pack-gate: FAIL — machine-absolute paths inside shipped files:"
  printf '%s\n' "$CONTENT_HITS"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "pack-gate: PASS ($(printf '%s\n' "$LIST" | wc -l) entries)"
fi
exit $FAIL
