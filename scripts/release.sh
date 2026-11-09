#!/usr/bin/env bash
# release.sh — one human action for a prepared release.
# Usage: ./scripts/release.sh v0.5.7
# Requires an interactive terminal, a prepared tag, and a gate: PASS receipt.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; shift; fi
TAG="${1:-}"
[ -n "$TAG" ] || { echo "usage: $0 [--dry-run] vX.Y.Z" >&2; exit 2; }
case "$TAG" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "release: bad tag $TAG" >&2; exit 2 ;; esac
VERSION="${TAG#v}"

die() { printf 'release: %s\n' "$*" >&2; exit 1; }
[ -t 0 ] || die "run this in an interactive terminal (human gate)"
cd "$ROOT"

git diff --quiet || die "tracked worktree has unstaged changes"
git diff --cached --quiet || die "index has staged changes"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "tag $TAG does not exist; run npm run release:prepare first"
git merge-base --is-ancestor "$TAG^{}" HEAD || die "tag $TAG is not an ancestor of HEAD"

git show "$TAG:docs/release/$TAG.md" 2>/dev/null | grep -q '^gate: PASS' || die "tag $TAG has no receipt with gate: PASS"

command -v gh >/dev/null || die "gh is required to wait for the publish workflow"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated"

if [ "$DRY_RUN" = "1" ]; then
  echo "DRY-RUN: would acquire lease $TAG, push origin main refs/tags/$TAG, wait for publish, install @tachikomagundam/abathur@$VERSION"
  exit 0
fi

cleanup() { sh "$ROOT/scripts/release-lease.sh" release >/dev/null 2>&1 || true; }
trap cleanup EXIT

sh "$ROOT/scripts/release-lease.sh" acquire "$TAG" "${USER:-human}"
git push origin main "refs/tags/$TAG"
sh "$ROOT/scripts/release-lease.sh" release
trap - EXIT

COMMIT="$(git rev-parse "$TAG^{}")"
RUN_ID="$(gh run list --workflow publish.yml --commit "$COMMIT" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
[ -n "$RUN_ID" ] || die "no publish workflow run found for $COMMIT"
echo "release: waiting for publish run $RUN_ID"
timeout 900 gh run watch "$RUN_ID" --exit-status

for _ in $(seq 1 12); do
  if npm view "@tachikomagundam/abathur@$VERSION" version >/dev/null 2>&1; then break; fi
  sleep 5
done
npm view "@tachikomagundam/abathur@$VERSION" version >/dev/null 2>&1 || die "npm has no @tachikomagundam/abathur@$VERSION after publish"

npm install -g "@tachikomagundam/abathur@$VERSION"
abathur rules validate
npm ls -g @tachikomagundam/abathur --depth=0

echo "RELEASE OK $TAG"
