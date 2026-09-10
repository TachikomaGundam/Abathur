#!/usr/bin/env bash
# Seed hook wrapper (task 14). The fixture adapter runs hooks with
# HOME=<sandbox>/.sandbox-home; wiki-ops and historian's seed_sandbox.sh read
# ~/.wikijs-api-key, so the key must land in the sandbox home first. Then the
# genome repo's own seed_sandbox.sh runs unchanged (plan: seedCommand →
# seed_sandbox.sh), and the post-seed wiki snapshot is recorded to
# .bench/wiki-pre.json — the grader diffs created/updated/deleted against it.
set -euo pipefail
real_seed="${1:?usage: seed-wrapped.sh <path-to-seed_sandbox.sh>}"
[ -f "$real_seed" ] || { echo "seed-wrapped: missing $real_seed" >&2; exit 1; }
base="${ABATHUR_WIKI_BASE:?seed-wrapped.sh requires ABATHUR_WIKI_BASE in env}"
key="${ABATHUR_WIKI_KEY_FILE:-}"
if [ -n "$key" ] && [ -f "$key" ] && [ ! -f "$HOME/.wikijs-api-key" ]; then
  mkdir -p "$HOME"
  install -m 600 "$key" "$HOME/.wikijs-api-key"
fi
bash "$real_seed"
mkdir -p .bench
python3 - "$base" > .bench/wiki-pre.json <<'PY'
import json, os, pathlib, sys, urllib.request
base, token = sys.argv[1].rstrip("/"), open(pathlib.Path.home() / ".wikijs-api-key").read().strip()
req = urllib.request.Request(
    base + "/graphql",
    data=json.dumps({"query": "{ pages { list { id path locale updatedAt } } }"}).encode(),
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
doc = json.load(urllib.request.urlopen(req, timeout=20))
if "errors" in doc:
    raise SystemExit("wiki-pre: graphql %s" % json.dumps(doc["errors"])[:200])
print(json.dumps(doc["data"]["pages"]["list"]))
PY
echo "seed-wrapped: wiki-pre.json rows=$(python3 -c 'import json;print(len(json.load(open(".bench/wiki-pre.json"))))')"
