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
# the published engine does not export ABATHUR_GENOME_CANONICAL; derive from the
# launch worktree's own genome.jsonc (written by the engine each round). Env wins
# when present; missing-both still fail-closes on the [ -f "$canonical" ] guard.
canonical="${ABATHUR_GENOME_CANONICAL:-$worktree/genome.jsonc}"
[ -f "$brief_file" ] || { echo "mutate: missing brief $brief_file" >&2; exit 1; }
cp -f "$brief_file" "${ABATHUR_MUTATOR_RAW:-/tmp/abathur-mutate-raw.jsonl}.brief" 2>/dev/null || true

# clause-economy experiment guidance (2026-10-14): appended to the brief the mutator reads.
cat >> "$brief_file" <<'ECONOMY'

## Seat guidance — s41 era, post-convergence
Role-text on the routing exam (s31b) has CONVERGED: five candidate generations lost it, including a
20-line economy card. Do not touch routing/ledger-section text. The s41 netlist-manufacturability exam
is a blank slate at zero baseline: propose AT MOST one candidate whose clause makes the team check pad
pitch vs power class AT DESIGN TIME (netlist/footprint selection before copper), total added lines
<= 25, and name the trap arithmetic (0.5mm/1.0mm fine-pitch connectors on battery mains) in the clause.
