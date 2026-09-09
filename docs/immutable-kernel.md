# The Immutable Kernel — what self-evolution may and may not touch

This is the human-facing contract of `genomes/abathur-self.jsonc` (plan todo 11).
It is finalized by todo 15; until then it is the seed's authoritative companion.

## The sealed set

`kernel.immutableGlobs` on the abathur-self genome seals:

| Pattern | Why it is sealed |
|---|---|
| `src/core/stats.ts` | the selection gate itself — nomination math, Bonferroni, budget verdicts |
| `src/core/ledger.ts` | append-only evidence: friction queue + generation rows |
| `src/core/ids.ts` | canonical JSON + fingerprints — the identity of every genome/row/tree |
| `src/core/genome.ts` | registry semantics: registration, superset rule, fail-closed coverage |
| `src/core/promote.ts` | the human-only gate: second sealed-path pass, CAS ref move, manifest regen |
| `src/bench/toy.*`, `src/bench/fixture.*` | the bench adapters — how every score is produced |
| `graders/**` | grader contract schemas — what "correct" means per bench |
| `genomes/**` | every genome spec, including this seed and the toy-smoke fixtures |
| `scripts/copy-assets.mjs`, `package.json`, `tsconfig.json` | the toolchain itself |

Self cannot unseal: a candidate diff touching any sealed file is rejected at the
path stage (`validateCandidate`), the kernel audit refuses runs against a drifted
working tree (exit 1, before any state exists), and only the human `promote`
command ever reseals the manifest — from the promoted tree, never the worktree.

**Consequence (accepted):** v1 self-evolution cannot change dependencies or
build configuration. `package.json` and `tsconfig.json` ride outside the
overlaid `src/**` and would otherwise slip into a promoted generation
score-neutrally and silently reseal on installer re-add (plan round-2 #2).
Toolchain changes are a human PR, not an evolution candidate.

## Why tests run from a snapshot, not from the candidate

Fitness-hack class (plan 11c, oracle Critical #1): if the candidate's own tree
supplies the test suite, a candidate can delete or weaken the tests it is graded
by and score better while getting worse. The self-bench therefore composes:

1. **Trusted tree** = `snapshotCommit(incumbent)` — sealed kernel files, the
   test suite (`src/test/**`), the golden-replay fixtures + expected digests,
   and toolchain config, all read-only from the incumbent commit.
2. **Overlay** = candidate `src/**` files matching no seal and not under
   `src/test/**` (candidate test edits are dropped by the allowlist; deletions
   are unrepresentable in a copy-only overlay, matching udiff v1's
   modify/create-only contract).
3. **Build** with the harness-pinned toolchain: the repo's own `tsc` against the
   harness install's `node_modules` — never candidate-supplied build scripts,
   never `npm ci`. Caps: build 180 s, suite 900 s, replay 120 s; a build timeout
   is inconclusive, a suite/replay timeout scores nothing.
4. **Score** = `node --test dist/test/**/*.test.js` over the overlaid build plus
   the golden toy-replay digest (`selfbench/replay.mjs`, expected from the
   TRUSTED copy). Pure incumbent-vs-incumbent is degenerate and forbidden; the
   incumbent build is the baseline, candidates are the overlaid builds.

The candidate worktree's own tests are never executed, and the scorer is invoked
with snapshot paths only — structurally, nothing in `self-eval`/`self-snapshot`
imports `promote.ts`; `self-eval` reports fitness, the operator promotes.

## Friction digest

Every `run` appends structured `friction_digest` records to the global queue
`<configDir>/friction.jsonl` (stalls, repeated rejections by stage, inconclusive
causes, CLI errors). Records are schema-validated, strings are echo-sanitized
and bounded, and digests covering val-unit runs carry counts/timings/status
codes only — scenario text and assertion diffs can never enter the queue.
