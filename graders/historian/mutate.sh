#!/usr/bin/env bash
# Mutator wrapper for the historian live run (task 14). Invoked by the run-loop
# as `bash mutate.sh <brief-file> <worktree> <model>` with cwd = the throwaway
# launch worktree (reflect.ts contract). The REAL candidate source is a headless
# `opencode run` child: it reads the reflection brief and proposes exactly one
# mutation — a new RUN CARD under abathur-notes/ (never a sealed path;
# kernel.immutableGlobs is enforced independently by the driver's PathPolicy).
# Run cards are the delivery seam (S4): run-scenario.sh appends them VERBATIM to
# every scenario brief under a `## Run card` heading, so a candidate tree's
# mutation genuinely steers the benched agent and score deltas are attributable.
# The wrapper deterministically packages the model's run card as a unified CREATE
# diff (creation diffs have no context to drift) and appends a genome.jsonc
# create-diff carrying the resolved spec bytes (plan 184: every sealed tree
# must contain genome.jsonc so bundle export self-describes; plan 181 requires
# it for the lineage). On unparseable model output the wrapper degrades to a
# packaging-only candidate — honest, logged, never a fabricated mutation.
set -uo pipefail
brief_file="${1:?usage: mutate.sh <brief-file> <worktree> <model>}"
worktree="${2:?usage: mutate.sh <brief-file> <worktree> <model>}"
model="${3:?usage: mutate.sh <brief-file> <worktree> <model>}"
canonical="${ABATHUR_GENOME_CANONICAL:?mutate.sh requires ABATHUR_GENOME_CANONICAL (resolved spec, canonical JSON)}"
[ -f "$brief_file" ] || { echo "mutate: missing brief $brief_file" >&2; exit 1; }
cp -f "$brief_file" "${ABATHUR_MUTATOR_RAW:-/tmp/abathur-mutate-raw.jsonl}.brief" 2>/dev/null || true
[ -f "$canonical" ] || { echo "mutate: missing canonical spec $canonical" >&2; exit 1; }
bin="${ABATHUR_OPENCODE_BIN:-opencode}"

prompt="You are the genome mutator of the Abathur evolution harness. Read the reflection brief below (evidence from the incumbent bench of the historian wiki-skill genome). Propose exactly ONE improvement the genome owner can act on: create a NEW RUN CARD under the path prefix abathur-notes/ (slug .md). A run card is the genome's mutation delivery channel: at bench time run-scenario.sh appends abathur-notes/*.md VERBATIM to every scenario brief, fenced under a \`## Run card\` heading, so the bench agent reads your card as part of its own instructions — write direct, actionable guidance the historian agent can follow, not a description of the change. Output ONLY a single JSON object, no prose, shape:
{\"rationale\": \"<one sentence, <=400 chars>\", \"path\": \"abathur-notes/<slug>.md\", \"content\": \"<full markdown file contents>\"}
Do not modify any other path. Scenarios, rubric.md, seed_sandbox.sh, baseline/ and README.md are immutable.

BRIEF:
$(cat "$brief_file")"

raw="${ABATHUR_MUTATOR_RAW:-/tmp/abathur-mutate-raw.jsonl}"
"$bin" run --model "$model" --format json --message "$prompt" >"$raw" 2>/dev/null
rc=$?
echo "mutate: opencode rc=$rc raw=$raw" >&2

python3 - "$raw" "$canonical" "$rc" <<'PY'
import json, re, sys

raw, canonical_path, rc = sys.argv[1], sys.argv[2], int(sys.argv[3])

def create_diff(path, text):
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    body = "".join("+" + ln + "\n" for ln in lines)
    return f"--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{len(lines)} @@\n{body}"

def last_text_events(path):
    texts = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                part = ev.get("part") or {}
                if ev.get("type") == "text" and isinstance(part.get("text"), str):
                    texts.append(part["text"])
    except FileNotFoundError:
        pass
    return texts

proposal = None
for text in reversed(last_text_events(raw)):
    candidate = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", candidate, re.S)
    if fence:
        candidate = fence.group(1)
    start, end = candidate.find("{"), candidate.rfind("}")
    if start < 0 or end <= start:
        continue
    try:
        doc = json.loads(candidate[start : end + 1])
    except ValueError:
        continue
    if isinstance(doc, dict):
        proposal = doc
        break

spec_text = open(canonical_path, encoding="utf-8").read()
packaging = create_diff("genome.jsonc", spec_text if spec_text.endswith("\n") else spec_text + "\n")

if isinstance(proposal, dict):
    path = proposal.get("path")
    content = proposal.get("content")
    rationale = proposal.get("rationale")
    if (
        isinstance(path, str)
        and re.fullmatch(r"abathur-notes/[a-z0-9][a-z0-9._-]{0,63}\.md", path)
        and isinstance(content, str)
        and 0 < len(content) < 200000
        and isinstance(rationale, str)
        and 0 < len(rationale) <= 4000
        and "\x00" not in content
    ):
        content = content.replace("\r", "")
        if not content.endswith("\n"):
            content += "\n"
        candidate = {"id": "mutate-live", "rationale": rationale, "diffs": [create_diff(path, content), packaging]}
        print(json.dumps({"candidates": [candidate]}))
        sys.exit(0)

print(json.dumps({
    "candidates": [{
        "id": "mutate-package-only",
        "rationale": "packaging-only candidate: model output unparseable or path rejected (opencode rc=%d); lineage genome.jsonc added, no skill mutation proposed" % rc,
        "diffs": [packaging],
    }]
}))
PY
