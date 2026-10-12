#!/usr/bin/env bash
# Reset hook (task 14, closes Metis #3): historian's seed_sandbox.sh SKIPs
# existing pages, so a mutated/consumed _sandbox fixture never self-restores.
# resetCommand deletes EVERY _sandbox/* page by id (wiki-ops hard delete) and
# refreshes the wiki cache, making back-to-back generations state-equal.
# Runs with cwd = the unit sandbox, HOME = sandbox home (key installed by the
# seed wrapper; mirrorSandboxHome rebuilds the home on reset too, so ensure it).
set -euo pipefail
base="${ABATHUR_WIKI_BASE:?reset-sandbox.sh requires ABATHUR_WIKI_BASE in env}"
ops="${ABATHUR_WIKI_OPS:?reset-sandbox.sh requires ABATHUR_WIKI_OPS in env}"
key="${ABATHUR_WIKI_KEY_FILE:-}"
if [ -n "$key" ] && [ -f "$key" ] && [ ! -f "$HOME/.wikijs-api-key" ]; then
  mkdir -p "$HOME"
  install -m 600 "$key" "$HOME/.wikijs-api-key"
fi
[ -f "$HOME/.wikijs-api-key" ] || { echo "reset-sandbox: no wiki key at $HOME/.wikijs-api-key" >&2; exit 1; }
n=0
while read -r id; do
  [ -n "$id" ] || continue
  if ! python3 "$ops" delete "$id" --confirm >/dev/null 2>&1; then
    # A parent delete cascades to its children: tolerate iff the row is really gone.
    if python3 - "$base" "$id" <<'GONE'
import json, pathlib, sys, urllib.request
base, pid = sys.argv[1].rstrip("/"), int(sys.argv[2])
token = open(pathlib.Path.home() / ".wikijs-api-key").read().strip()
req = urllib.request.Request(
    base + "/graphql",
    data=json.dumps({"query": "{ pages { single(id: %d) { id } } }" % pid}).encode(),
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
doc = json.load(urllib.request.urlopen(req, timeout=20))
single = (doc.get("data") or {}).get("pages") or {}
raise SystemExit(0 if single.get("single") is None else 1)
GONE
    then
      echo "reset-sandbox: page $id already gone (cascade)" >&2
    else
      echo "reset-sandbox: delete $id failed" >&2
      exit 1
    fi
  fi
  n=$((n + 1))
done < <(python3 - "$base" <<'PY'
import json, pathlib, sys, urllib.request
base, token = sys.argv[1].rstrip("/"), open(pathlib.Path.home() / ".wikijs-api-key").read().strip()
req = urllib.request.Request(
    base + "/graphql",
    data=json.dumps({"query": "{ pages { list { id path } } }"}).encode(),
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
doc = json.load(urllib.request.urlopen(req, timeout=20))
if "errors" in doc:
    raise SystemExit("reset-sandbox: graphql %s" % json.dumps(doc["errors"])[:200])
for r in doc["data"]["pages"]["list"]:
    if r["path"] == "_sandbox" or r["path"].startswith("_sandbox/"):
        print(r["id"])
PY
)
python3 "$ops" cache-refresh >/dev/null 2>&1 || true
echo "reset-sandbox: deleted $n _sandbox page(s), cache refreshed"
